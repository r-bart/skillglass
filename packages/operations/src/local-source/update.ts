import { createHash, randomUUID } from "node:crypto"
import { lstat } from "node:fs/promises"
import path from "node:path"

import type { AdapterFilesystemStep, AdapterOperationPlan } from "@forge/adapter-api"
import type { ApprovedRootPolicy, LocalSourceManifestV1, ManifestFileV1 } from "@forge/scanner"

import { OperationInterruptedError, createSourceUpdatePlan, type ArtifactRef, type OperationEngine } from "../core/index.js"
import { LocalSourceError } from "./errors.js"
import { admitPortablePath, bytewisePathSort } from "./path-policy.js"
import {
  LocalSourceProvenanceRepository,
  localSourceCommitMetadata,
  parseLocalSourceCommitMetadata,
} from "./provenance.js"
import { inspectStrictTree, strictTreeMatchesManifest, type StrictTreeInspection } from "./strict-tree.js"
import type {
  AdmittedLocalSource,
  LocalImportProvenanceV1,
  LocalSourceAdmissionPort,
  LocalSourceMaterializerPort,
  LocalSourceUpdateExecutionResult,
  LocalSourceUpdateObservation,
  LocalSourceUpdatePreviewEntry,
  LocalSourceUpdateTrigger,
  PrepareLocalSourceUpdateInput,
  PreparedLocalSourceUpdate,
  SourceIdentity,
} from "./types.js"

type EnginePort = Pick<OperationEngine, "execute" | "register">

export interface LocalSourceUpdateCoordinatorOptions {
  readonly admission: LocalSourceAdmissionPort
  readonly rootPolicy: ApprovedRootPolicy
  readonly materializer: LocalSourceMaterializerPort
  readonly engine: EnginePort
  readonly provenance: LocalSourceProvenanceRepository
  readonly now?: () => Date
  readonly mintObservationId?: () => string
  /** Private, non-scanned approved root for source materializations and snapshots. */
  readonly recoveryRootId?: string
}

interface DestinationInspection {
  readonly artifact: ArtifactRef
  readonly canonicalPath: string
  readonly inspection?: StrictTreeInspection
  readonly divergentReason?: string
}

interface InternalObservation {
  readonly public: LocalSourceUpdateObservation
  readonly provenance: LocalImportProvenanceV1
  readonly source?: AdmittedLocalSource
  readonly destination?: DestinationInspection
}

interface PendingUpdate {
  readonly prepared: PreparedLocalSourceUpdate
  readonly source: AdmittedLocalSource
  readonly destination: DestinationInspection
}

function filesystemCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

function opaqueSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24)
}

function sameStableSourceObject(left: SourceIdentity, right: SourceIdentity): boolean {
  if (left.device !== right.device || left.inode !== right.inode) return false
  if (left.createdNanoseconds !== undefined && right.createdNanoseconds !== undefined &&
    left.createdNanoseconds !== right.createdNanoseconds) return false
  return true
}

function samePreviewSource(left: AdmittedLocalSource, right: AdmittedLocalSource): boolean {
  return left.kind === right.kind && left.sourceLocator === right.sourceLocator &&
    JSON.stringify(left.identity) === JSON.stringify(right.identity) &&
    left.manifest.treeHash === right.manifest.treeHash && left.archiveSha256 === right.archiveSha256 &&
    JSON.stringify(left.manifest.files) === JSON.stringify(right.manifest.files)
}

function optionalReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return "Safe source comparison could not be completed"
}

function requireUpdateStep(
  plan: AdapterOperationPlan,
  destination: ArtifactRef,
  installedHash: string,
  sourceHash: string,
): AdapterFilesystemStep & { kind: "replace-installation" } {
  const operation = plan.operation
  if (operation.kind !== "update-from-local" || operation.status !== "planned" || operation.conflicts.length > 0) {
    throw new LocalSourceError("UPDATE_CONFLICT", "Adapter did not admit a local-source update plan")
  }
  const steps = plan.steps.filter((step): step is AdapterFilesystemStep & { kind: "replace-installation" } =>
    step.kind === "replace-installation")
  if (steps.length !== 1 || plan.steps.length !== 1) {
    throw new LocalSourceError("SOURCE_INVALID", "Local-source update must contain one replace-installation step")
  }
  const step = steps[0]
  if (step === undefined || step.rootId !== destination.rootId || step.relativePath !== destination.relativePath ||
    step.expectedBeforeHash !== installedHash || step.sourceTreeHash !== sourceHash ||
    operation.targetRootId !== destination.rootId) {
    throw new LocalSourceError("UPDATE_CONFLICT", "Adapter update step does not match the verified trees")
  }
  if (!plan.postconditions.some((postcondition) => postcondition.kind === "tree-hash-equals" &&
    postcondition.rootId === destination.rootId && postcondition.relativePath === destination.relativePath &&
    postcondition.expectedHash === sourceHash)) {
    throw new LocalSourceError("SOURCE_INVALID", "Adapter update has no matching tree-hash postcondition")
  }
  return step
}

function fileMap(manifest: LocalSourceManifestV1): Map<string, ManifestFileV1> {
  return new Map(manifest.files.map((file) => [file.path, file]))
}

function previewEntries(
  rootId: string,
  childSegment: string,
  installed: LocalSourceManifestV1,
  source: LocalSourceManifestV1,
): readonly LocalSourceUpdatePreviewEntry[] {
  const before = fileMap(installed)
  const after = fileMap(source)
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort(bytewisePathSort)
  return paths.flatMap((relativePath): LocalSourceUpdatePreviewEntry[] => {
    const oldFile = before.get(relativePath)
    const newFile = after.get(relativePath)
    if (oldFile?.sha256 === newFile?.sha256 && oldFile?.byteLength === newFile?.byteLength) return []
    return [{
      action: oldFile === undefined ? "create" : newFile === undefined ? "delete" : "modify",
      rootId,
      relativePath: `${childSegment}/${relativePath}`,
      ...(oldFile === undefined ? {} : { beforeByteLength: oldFile.byteLength, beforeSha256: oldFile.sha256 }),
      ...(newFile === undefined ? {} : { afterByteLength: newFile.byteLength, afterSha256: newFile.sha256 }),
    }]
  })
}

export class LocalSourceUpdateCoordinator {
  readonly #admission: LocalSourceAdmissionPort
  readonly #rootPolicy: ApprovedRootPolicy
  readonly #materializer: LocalSourceMaterializerPort
  readonly #engine: EnginePort
  readonly #provenance: LocalSourceProvenanceRepository
  readonly #now: NonNullable<LocalSourceUpdateCoordinatorOptions["now"]>
  readonly #mintObservationId: NonNullable<LocalSourceUpdateCoordinatorOptions["mintObservationId"]>
  readonly #recoveryRootId: string | undefined
  readonly #observations = new Map<string, InternalObservation>()
  readonly #pending = new Map<string, PendingUpdate>()

  constructor(options: LocalSourceUpdateCoordinatorOptions) {
    this.#admission = options.admission
    this.#rootPolicy = options.rootPolicy
    this.#materializer = options.materializer
    this.#engine = options.engine
    this.#provenance = options.provenance
    this.#now = options.now ?? (() => new Date())
    this.#mintObservationId = options.mintObservationId ?? randomUUID
    this.#recoveryRootId = options.recoveryRootId
  }

  async observe(provenance: LocalImportProvenanceV1, trigger: LocalSourceUpdateTrigger): Promise<LocalSourceUpdateObservation> {
    const internal = await this.#inspect(provenance, trigger, this.#mintObservationId())
    this.#observations.set(internal.public.observationId, internal)
    return internal.public
  }

  async observePersisted(provenanceId: string, trigger: LocalSourceUpdateTrigger): Promise<LocalSourceUpdateObservation> {
    const provenance = this.#provenance.reconstruct(provenanceId)
    if (provenance === undefined) throw new LocalSourceError("SELECTION_UNKNOWN", "Local-source provenance does not exist")
    return this.observe(provenance, trigger)
  }

  /** Main-process-only adapter planning data for one still-live opaque observation. */
  sourceManifestForObservation(observationId: string): LocalSourceManifestV1 {
    const observed = this.#observations.get(observationId)
    if (observed?.public.state !== "available" || observed.source === undefined) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Update observation has no verified available source")
    }
    return observed.source.manifest
  }

  async prepare(input: PrepareLocalSourceUpdateInput): Promise<PreparedLocalSourceUpdate> {
    const planId = input.adapterPlan.operation.planId
    const existing = this.#pending.get(planId)
    if (existing !== undefined) {
      if (existing.prepared.observation.observationId !== input.observationId) {
        throw new LocalSourceError("UPDATE_CONFLICT", "Plan ID is already bound to another update observation")
      }
      return existing.prepared
    }
    const observed = this.#observations.get(input.observationId)
    if (observed === undefined) throw new LocalSourceError("SELECTION_UNKNOWN", "Update observation is unknown to this process")
    if (observed.public.state !== "available" || observed.source === undefined || observed.destination?.inspection === undefined) {
      throw new LocalSourceError("UPDATE_CONFLICT", `Local-source update is ${observed.public.state}, not available`)
    }
    if (input.journalId.length === 0 || input.provenanceId.length === 0) {
      throw new LocalSourceError("SOURCE_INVALID", "Journal and provenance IDs cannot be empty")
    }

    const refreshed = await this.#inspect(observed.provenance, observed.public.trigger, observed.public.observationId)
    this.#assertObservationUnchanged(observed, refreshed)
    const source = refreshed.source
    const destination = refreshed.destination
    if (source === undefined || destination?.inspection === undefined) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Verified update trees became unavailable")
    }
    requireUpdateStep(input.adapterPlan, destination.artifact, destination.inspection.manifest.treeHash, source.manifest.treeHash)

    const suffix = opaqueSuffix(planId)
    const sourceArtifact: ArtifactRef = {
      rootId: this.#recoveryRootId ?? destination.artifact.rootId,
      relativePath: `.forge-update-source-${suffix}`,
      kind: "tree",
    }
    try {
      const materialized = await this.#materializer.materialize(source, sourceArtifact)
      if (materialized.treeHash !== source.manifest.treeHash || JSON.stringify(materialized.files) !== JSON.stringify(source.manifest.files)) {
        throw new LocalSourceError("STAGING_MISMATCH", "Private update source differs from its verified manifest")
      }
      const adapterExpiry = Date.parse(input.adapterPlan.operation.expiresAt)
      if (!Number.isFinite(adapterExpiry)) throw new LocalSourceError("SOURCE_INVALID", "Adapter expiry must be valid")
      const committedProvenance: LocalImportProvenanceV1 = {
        contract: "local-source-v1",
        kind: "forge-import",
        managedBy: "forge",
        sourceKind: source.kind,
        sourceLocator: source.sourceLocator,
        sourceObservedAt: source.observedAt,
        sourceIdentity: source.identity,
        sourceTreeHash: source.manifest.treeHash,
        ...(source.archiveSha256 === undefined ? {} : { archiveSha256: source.archiveSha256 }),
        ...(source.payloadWrapper === undefined ? {} : { payloadWrapper: source.payloadWrapper }),
        ignoredEntries: source.ignoredEntries,
        sourceManifest: source.manifest,
        targetRootId: observed.provenance.targetRootId,
        installationId: observed.provenance.installationId,
        destinationCanonicalPath: observed.provenance.destinationCanonicalPath,
        createdByJournalId: observed.provenance.createdByJournalId,
        installedHash: source.manifest.treeHash,
        installedTreeHash: source.manifest.treeHash,
        installedManifest: source.manifest,
        previousInstalledTreeHash: observed.provenance.installedTreeHash,
        updatedByJournalId: input.journalId,
      }
      const plan = createSourceUpdatePlan({
        id: planId,
        createdAt: input.adapterPlan.operation.createdAt,
        expiresAt: input.adapterPlan.operation.expiresAt,
        adapterId: input.adapterPlan.operation.adapterId,
        installationIds: [observed.provenance.installationId],
        source: sourceArtifact,
        sourceHash: source.manifest.treeHash,
        destination: destination.artifact,
        expectedBeforeHash: destination.inspection.manifest.treeHash,
        stage: { rootId: destination.artifact.rootId, relativePath: `.forge-update-stage-${suffix}` },
        snapshot: {
          rootId: this.#recoveryRootId ?? destination.artifact.rootId,
          relativePath: `.forge-update-snapshot-${suffix}`,
        },
        commitMetadata: localSourceCommitMetadata({
          kind: "update-source",
          provenanceId: input.provenanceId,
          provenance: committedProvenance,
        }),
      })
      const prepared: PreparedLocalSourceUpdate = {
        plan,
        preview: previewEntries(destination.artifact.rootId, destination.artifact.relativePath,
          destination.inspection.manifest, source.manifest),
        observation: observed.public,
        previousProvenance: observed.provenance,
        sourceArtifact,
        adapterPlan: input.adapterPlan,
        journalId: input.journalId,
        provenanceId: input.provenanceId,
      }
      await this.#engine.register(plan)
      this.#pending.set(planId, { prepared, source, destination })
      return prepared
    } catch (error) {
      await this.#materializer.removeExact(sourceArtifact, source.manifest.treeHash)
      throw error
    }
  }

  async execute(prepared: PreparedLocalSourceUpdate): Promise<LocalSourceUpdateExecutionResult> {
    const pending = this.#pending.get(prepared.plan.id)
    if (pending === undefined || pending.prepared !== prepared) {
      throw new LocalSourceError("SELECTION_UNKNOWN", "Prepared update is not owned by this process")
    }
    try {
      const refreshed = await this.#inspect(prepared.previousProvenance, prepared.observation.trigger, prepared.observation.observationId)
      this.#assertObservationUnchanged({
        public: prepared.observation,
        provenance: prepared.previousProvenance,
        source: pending.source,
        destination: pending.destination,
      }, refreshed)
      if (refreshed.source === undefined || refreshed.destination?.inspection === undefined ||
        !samePreviewSource(pending.source, refreshed.source)) {
        throw new LocalSourceError("UPDATE_CONFLICT", "Local source changed after the update preview")
      }
      const result = await this.#engine.execute(prepared.plan.id)
      if (result.state !== "committed") throw new LocalSourceError("STAGING_MISMATCH", "Source update did not commit")
      const installed = await inspectStrictTree(refreshed.destination.canonicalPath)
      if (!strictTreeMatchesManifest(installed, refreshed.source.manifest)) {
        throw new LocalSourceError("STAGING_MISMATCH", "Committed update differs from the verified source")
      }
      const completion = parseLocalSourceCommitMetadata(result)
      if (completion?.kind !== "update-source" || completion.provenanceId !== prepared.provenanceId) {
        throw new LocalSourceError("SOURCE_INVALID", "Committed source update has no durable provenance")
      }
      const provenance = completion.provenance
      this.#provenance.persist(completion.provenanceId, provenance)
      await this.#materializer.removeExact(prepared.sourceArtifact, refreshed.source.manifest.treeHash)
      this.#pending.delete(prepared.plan.id)
      this.#observations.delete(prepared.observation.observationId)
      return { plan: result, provenanceId: prepared.provenanceId, provenance }
    } catch (error) {
      if (!(error instanceof OperationInterruptedError)) {
        await this.#materializer.removeExact(prepared.sourceArtifact, pending.source.manifest.treeHash)
        this.#pending.delete(prepared.plan.id)
        this.#observations.delete(prepared.observation.observationId)
      }
      throw error
    }
  }

  async #inspect(
    provenance: LocalImportProvenanceV1,
    trigger: LocalSourceUpdateTrigger,
    observationId: string,
  ): Promise<InternalObservation> {
    const observedAt = this.#now().toISOString()
    const base = {
      observationId,
      installationId: provenance.installationId,
      trigger,
      observedAt,
      baseTreeHash: provenance.installedTreeHash,
    }
    let source: AdmittedLocalSource
    try {
      source = await this.#admission.inspect(provenance.sourceKind, provenance.sourceLocator, observedAt)
      if (source.sourceLocator !== provenance.sourceLocator || !sameStableSourceObject(source.identity, provenance.sourceIdentity)) {
        throw new LocalSourceError("SOURCE_CHANGED", "Persisted local source was replaced")
      }
    } catch (error) {
      return { public: { ...base, state: "unknown", reason: optionalReason(error) }, provenance }
    }

    let destination: DestinationInspection
    try {
      destination = await this.#inspectDestination(provenance)
    } catch (error) {
      return {
        public: {
          ...base,
          state: "unknown",
          sourceTreeHash: source.manifest.treeHash,
          ...(source.archiveSha256 === undefined ? {} : { archiveSha256: source.archiveSha256 }),
          reason: optionalReason(error),
        },
        provenance,
        source,
      }
    }
    const common = {
      ...base,
      sourceTreeHash: source.manifest.treeHash,
      ...(source.archiveSha256 === undefined ? {} : { archiveSha256: source.archiveSha256 }),
    }
    if (destination.inspection === undefined) {
      return {
        public: { ...common, state: "diverged", reason: destination.divergentReason ?? "Installed tree is missing" },
        provenance, source, destination,
      }
    }
    const installedTreeHash = destination.inspection.manifest.treeHash
    if (!strictTreeMatchesManifest(destination.inspection, provenance.installedManifest)) {
      return {
        public: { ...common, state: "diverged", installedTreeHash, reason: "Installed tree differs from its recorded base" },
        provenance, source, destination,
      }
    }
    return {
      public: {
        ...common,
        state: source.manifest.treeHash === installedTreeHash ? "current" : "available",
        installedTreeHash,
      },
      provenance, source, destination,
    }
  }

  async #inspectDestination(provenance: LocalImportProvenanceV1): Promise<DestinationInspection> {
    const root = this.#rootPolicy.getApprovedRoots().find((candidate) =>
      candidate.rootId === provenance.targetRootId || candidate.aliasRootIds.includes(provenance.targetRootId))
    if (root === undefined) throw new LocalSourceError("DESTINATION_NOT_WRITABLE", "Installation root is no longer approved")
    const relative = path.relative(root.canonicalPath, provenance.destinationCanonicalPath)
    const admitted = admitPortablePath(relative).normalized
    if (admitted.includes("/")) throw new LocalSourceError("PATH_INVALID", "Updated installation must remain a direct root child")
    const lexicalPath = path.join(root.canonicalPath, admitted)
    if (path.resolve(lexicalPath) !== path.resolve(provenance.destinationCanonicalPath)) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Persisted destination no longer identifies the approved child")
    }
    const artifact: ArtifactRef = { rootId: provenance.targetRootId, relativePath: admitted, kind: "tree" }
    const writable = await this.#rootPolicy.authorizeWrite(artifact.rootId, artifact.relativePath)
    if (path.resolve(writable) !== path.resolve(provenance.destinationCanonicalPath)) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Destination canonical identity changed")
    }
    try {
      const stats = await lstat(lexicalPath)
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        return { artifact, canonicalPath: lexicalPath, divergentReason: "Installed path is no longer a real directory" }
      }
    } catch (error) {
      if (filesystemCode(error) === "ENOENT") return { artifact, canonicalPath: lexicalPath, divergentReason: "Installed tree is missing" }
      throw error
    }
    const readable = await this.#rootPolicy.authorizeRead(artifact.rootId, artifact.relativePath)
    if (path.resolve(readable) !== path.resolve(provenance.destinationCanonicalPath)) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Destination resolved through an unexpected filesystem object")
    }
    return { artifact, canonicalPath: readable, inspection: await inspectStrictTree(readable) }
  }

  #assertObservationUnchanged(before: InternalObservation, after: InternalObservation): void {
    if (after.public.state !== "available" || before.public.baseTreeHash !== after.public.baseTreeHash ||
      before.public.installedTreeHash !== after.public.installedTreeHash ||
      before.public.sourceTreeHash !== after.public.sourceTreeHash || before.public.archiveSha256 !== after.public.archiveSha256) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Source or installed tree changed after update discovery")
    }
    if (before.source !== undefined && after.source !== undefined && !samePreviewSource(before.source, after.source)) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Local source identity changed after update discovery")
    }
  }
}
