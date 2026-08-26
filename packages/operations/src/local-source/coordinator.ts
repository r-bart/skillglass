import { createHash } from "node:crypto"

import type { AdapterFilesystemStep, AdapterOperationPlan } from "@forge/adapter-api"

import {
  OperationInterruptedError,
  createInstallPlan,
  type OperationEngine,
} from "../core/index.js"
import { LocalSourceError } from "./errors.js"
import { inspectStrictTree, strictTreeMatchesManifest } from "./strict-tree.js"
import type {
  AdmittedLocalSource,
  LocalImportProvenanceV1,
  LocalInstallExecutionResult,
  LocalInstallTarget,
  LocalInstallTargetPort,
  LocalSourceMaterializerPort,
  PrepareLocalInstallInput,
  PreparedLocalInstall,
} from "./types.js"
import { SourceSelectionService } from "./selection.js"

type EnginePort = Pick<OperationEngine, "register" | "execute">

export interface LocalInstallCoordinatorOptions {
  readonly selections: SourceSelectionService
  readonly targets: LocalInstallTargetPort
  readonly materializer: LocalSourceMaterializerPort
  readonly engine: EnginePort
  readonly installationId?: (adapterId: string, canonicalPath: string) => string
}

interface PendingInstall {
  readonly prepared: PreparedLocalInstall
  readonly target: LocalInstallTarget
}

function opaqueSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24)
}

function defaultInstallationId(adapterId: string, canonicalPath: string): string {
  return `installation-${opaqueSuffix(JSON.stringify([adapterId, canonicalPath]))}`
}

function requireInstallStep(plan: AdapterOperationPlan, source: AdmittedLocalSource): AdapterFilesystemStep & { kind: "create-installation" } {
  const operation = plan.operation
  if (operation.kind !== "install-local" || operation.status !== "planned" || operation.conflicts.length > 0) {
    throw new LocalSourceError("SOURCE_INVALID", "Adapter did not admit a local installation plan")
  }
  const steps = plan.steps.filter((step): step is AdapterFilesystemStep & { kind: "create-installation" } => step.kind === "create-installation")
  if (steps.length !== 1 || plan.steps.length !== 1) {
    throw new LocalSourceError("SOURCE_INVALID", "Local installation must contain one create-installation step")
  }
  const step = steps[0]
  if (step === undefined || step.rootId !== operation.targetRootId || step.sourceTreeHash !== source.manifest.treeHash) {
    throw new LocalSourceError("SOURCE_CHANGED", "Adapter installation step does not match the selected source")
  }
  if (!plan.postconditions.some((postcondition) =>
    postcondition.kind === "tree-hash-equals" && postcondition.rootId === step.rootId &&
    postcondition.relativePath === step.relativePath && postcondition.expectedHash === source.manifest.treeHash
  )) throw new LocalSourceError("SOURCE_INVALID", "Adapter plan has no matching tree-hash postcondition")
  return step
}

function previewEntries(source: AdmittedLocalSource, target: LocalInstallTarget) {
  return [
    { action: "create" as const, rootId: target.rootId, relativePath: target.childSegment },
    ...source.manifest.files.map((file) => ({
      action: "create" as const,
      rootId: target.rootId,
      relativePath: `${target.childSegment}/${file.path}`,
      byteLength: file.byteLength,
      sha256: file.sha256,
    })),
  ]
}

export class LocalInstallCoordinator {
  readonly #selections: SourceSelectionService
  readonly #targets: LocalInstallTargetPort
  readonly #materializer: LocalSourceMaterializerPort
  readonly #engine: EnginePort
  readonly #installationId: NonNullable<LocalInstallCoordinatorOptions["installationId"]>
  readonly #pending = new Map<string, PendingInstall>()

  constructor(options: LocalInstallCoordinatorOptions) {
    this.#selections = options.selections
    this.#targets = options.targets
    this.#materializer = options.materializer
    this.#engine = options.engine
    this.#installationId = options.installationId ?? defaultInstallationId
  }

  async prepare(input: PrepareLocalInstallInput): Promise<PreparedLocalInstall> {
    const planId = input.adapterPlan.operation.planId
    const existing = this.#pending.get(planId)
    if (existing !== undefined) {
      if (existing.prepared.selectionToken !== input.source.selectionToken) {
        throw new LocalSourceError("SELECTION_ALREADY_CLAIMED", "Plan ID is already bound to another selection")
      }
      return existing.prepared
    }
    const source = await this.#selections.claimForPlan(input.source.selectionToken, planId, input.source)
    let sourceArtifact: PreparedLocalInstall["sourceArtifact"] | undefined
    try {
      const step = requireInstallStep(input.adapterPlan, source)
      const target = await this.#targets.authorizeAbsentDirectChild(step.rootId, step.relativePath)
      const suffix = opaqueSuffix(planId)
      sourceArtifact = { rootId: target.rootId, relativePath: `.forge-source-${suffix}`, kind: "tree" }
      const stage = { rootId: target.rootId, relativePath: `.forge-stage-${suffix}` }
      const staged = await this.#materializer.materialize(source, sourceArtifact)
      if (staged.treeHash !== source.manifest.treeHash) {
        throw new LocalSourceError("STAGING_MISMATCH", "Private source materialization changed the selected tree")
      }
      const installationId = this.#installationId(input.adapterPlan.operation.adapterId, target.canonicalPath)
      const selectionExpiry = Date.parse(this.#selections.expiresAtForPlan(input.source.selectionToken, planId))
      const adapterExpiry = Date.parse(input.adapterPlan.operation.expiresAt)
      if (!Number.isFinite(adapterExpiry) || input.journalId.length === 0) {
        throw new LocalSourceError("SOURCE_INVALID", "Adapter expiry and journal ID must be valid")
      }
      const expiresAt = new Date(Math.min(selectionExpiry, adapterExpiry)).toISOString()
      const plan = createInstallPlan({
        id: planId,
        createdAt: input.adapterPlan.operation.createdAt,
        expiresAt,
        adapterId: input.adapterPlan.operation.adapterId,
        installationIds: [installationId],
        source: sourceArtifact,
        sourceHash: source.manifest.treeHash,
        destination: { rootId: target.rootId, relativePath: target.childSegment },
        stage,
      })
      const prepared: PreparedLocalInstall = {
        plan,
        preview: previewEntries(source, target),
        provenance: {
          contract: "local-source-v1",
          sourceKind: source.kind,
          sourceLocator: source.sourceLocator,
          sourceObservedAt: source.observedAt,
          sourceTreeHash: source.manifest.treeHash,
          ...(source.archiveSha256 === undefined ? {} : { archiveSha256: source.archiveSha256 }),
          ...(source.payloadWrapper === undefined ? {} : { payloadWrapper: source.payloadWrapper }),
          ignoredEntries: source.ignoredEntries,
          sourceManifest: source.manifest,
          targetRootId: target.rootId,
          installationId,
          destinationCanonicalPath: target.canonicalPath,
          createdByJournalId: input.journalId,
        },
        sourceArtifact,
        selectionToken: input.source.selectionToken,
        adapterPlan: input.adapterPlan,
      }
      await this.#engine.register(plan)
      this.#selections.markPlanPersisted(input.source.selectionToken, planId)
      this.#pending.set(planId, { prepared, target })
      return prepared
    } catch (error) {
      if (sourceArtifact !== undefined) {
        await this.#materializer.removeExact(sourceArtifact, source.manifest.treeHash)
      }
      this.#selections.releaseUnpersistedClaim(input.source.selectionToken, planId)
      throw error
    }
  }

  async execute(prepared: PreparedLocalInstall): Promise<LocalInstallExecutionResult> {
    const pending = this.#pending.get(prepared.plan.id)
    if (pending === undefined || pending.prepared !== prepared) {
      throw new LocalSourceError("SELECTION_UNKNOWN", "Prepared install is not owned by this process")
    }
    try {
      const current = await this.#selections.reauthorizeForPlan(prepared.selectionToken, prepared.plan.id)
      if (current.manifest.treeHash !== prepared.provenance.sourceTreeHash) {
        throw new LocalSourceError("SOURCE_CHANGED", "Local source changed after preview")
      }
      const target = await this.#targets.authorizeAbsentDirectChild(
        pending.target.rootId,
        pending.target.childSegment,
      )
      if (target.canonicalPath !== pending.target.canonicalPath) {
        throw new LocalSourceError("SOURCE_CHANGED", "Install destination changed after preview")
      }
      const result = await this.#engine.execute(prepared.plan.id)
      if (result.state !== "committed") {
        throw new LocalSourceError("STAGING_MISMATCH", "Install operation did not commit")
      }
      const installed = await inspectStrictTree(target.canonicalPath)
      if (!strictTreeMatchesManifest(installed, prepared.provenance.sourceManifest)) {
        throw new LocalSourceError("STAGING_MISMATCH", "Committed installation differs from the preview")
      }
      const provenance: LocalImportProvenanceV1 = {
        ...prepared.provenance,
        installedTreeHash: installed.manifest.treeHash,
        installedManifest: installed.manifest,
      }
      await this.#materializer.removeExact(prepared.sourceArtifact, prepared.provenance.sourceTreeHash)
      this.#selections.forgetPersistedSelection(prepared.selectionToken, prepared.plan.id)
      this.#pending.delete(prepared.plan.id)
      return { plan: result, provenance }
    } catch (error) {
      if (!(error instanceof OperationInterruptedError)) {
        await this.#materializer.removeExact(prepared.sourceArtifact, prepared.provenance.sourceTreeHash)
        this.#selections.forgetPersistedSelection(prepared.selectionToken, prepared.plan.id)
        this.#pending.delete(prepared.plan.id)
      }
      throw error
    }
  }
}
