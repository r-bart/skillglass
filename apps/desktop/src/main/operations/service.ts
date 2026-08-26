import { createHash, randomUUID } from "node:crypto"
import path from "node:path"

import type { SkillRuntimeAdapter } from "@forge/adapter-api"
import {
  type AckDto,
  type ConfirmOperationInput,
  type LocalSourceSelectionDto,
  type OperationHistoryDto,
  type OperationPlanDto,
  type OperationRequestDto,
  type OperationResultDto,
  type SelectLocalSourceInput,
  type UndoOperationInput,
} from "@forge/contracts"
import type { SourceRoot } from "@forge/domain"
import {
  ContentUpdateCoordinator,
  LocalInstallCoordinator,
  LocalSourceError,
  LocalSourceProvenanceRepository,
  LocalSourceUpdateCoordinator,
  OperationConflictError,
  OperationInterruptedError,
  SourceSelectionService,
  parseLocalImportProvenanceV1,
  parseLocalSourceCommitMetadata,
  type LocalImportProvenanceV1,
  type LocalSourceUpdateObservation,
  type PreparedLocalInstall,
  type PreparedLocalSourceUpdate,
  type StorageOperationRepository,
} from "@forge/operations"
import type {
  ProjectionRepository,
  SettingsRepository,
  UpdateObservationRepository,
} from "@forge/storage"
import type { ApprovedRootPolicy, ExternalChangeInvalidation } from "@forge/scanner"

import { PrivateSourceLeaseRepository } from "./artifact-leases.js"

const UPDATE_UNDO_PREFIX = "operations.local-source-update-undo.v1."
const LOCAL_COMMIT_APPLIED_PREFIX = "operations.local-source-commit-applied.v1."

type PendingLocalOperation =
  | Readonly<{ kind: "install"; prepared: PreparedLocalInstall }>
  | Readonly<{ kind: "update"; prepared: PreparedLocalSourceUpdate }>

interface PersistedUpdateUndo {
  readonly version: 1
  readonly provenanceId: string
  readonly previous: LocalImportProvenanceV1
}

export interface DesktopOperationServiceOptions {
  readonly selections: SourceSelectionService
  readonly installs: LocalInstallCoordinator
  readonly updates: LocalSourceUpdateCoordinator
  readonly contentUpdates: ContentUpdateCoordinator
  readonly repository: StorageOperationRepository
  readonly projections: ProjectionRepository
  readonly settings: SettingsRepository
  readonly updateObservations: UpdateObservationRepository
  readonly provenance: LocalSourceProvenanceRepository
  readonly rootPolicy: ApprovedRootPolicy
  readonly approvedRoots: () => readonly SourceRoot[]
  readonly adapterForRoot: (root: SourceRoot) => SkillRuntimeAdapter
  readonly rescan: () => Promise<void>
  readonly recoveryRootId: string
  readonly leases: PrivateSourceLeaseRepository
  readonly now?: () => Date
  readonly ids?: () => string
  readonly onInventoryChanged?: (installationIds: readonly string[]) => void
  readonly onCompleted?: (result: OperationResultDto) => void
}

function suffix(planId: string): string {
  return createHash("sha256").update(planId).digest("hex").slice(0, 24)
}

function operationId(next: () => string): string {
  return `operation_${next().replaceAll("-", "").slice(0, 96)}`
}

function unavailableReason(result: Awaited<ReturnType<SkillRuntimeAdapter["planOperation"]>>): never {
  if (result.status === "unavailable") throw new Error(`Operación no disponible: ${result.reason}`)
  throw new Error("El adapter no produjo un plan válido")
}

function classify(error: unknown): OperationResultDto["status"] {
  if (error instanceof OperationConflictError || (error instanceof LocalSourceError && error.code === "UPDATE_CONFLICT")) return "conflict"
  if (error instanceof LocalSourceError && ["SOURCE_CHANGED", "SELECTION_EXPIRED", "SELECTION_UNKNOWN"].includes(error.code)) return "stale"
  return "failed"
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "La operación no se pudo completar"
}

function containsPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function pathsOverlap(left: string, right: string): boolean {
  return containsPath(left, right) || containsPath(right, left)
}

function parseUndo(value: unknown): PersistedUpdateUndo | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || typeof candidate.provenanceId !== "string" || candidate.provenanceId.length === 0) return undefined
  return { version: 1, provenanceId: candidate.provenanceId, previous: parseLocalImportProvenanceV1(candidate.previous) }
}

export class DesktopOperationService {
  readonly #selections: SourceSelectionService
  readonly #installs: LocalInstallCoordinator
  readonly #updates: LocalSourceUpdateCoordinator
  readonly #contentUpdates: ContentUpdateCoordinator
  readonly #repository: StorageOperationRepository
  readonly #projections: ProjectionRepository
  readonly #settings: SettingsRepository
  readonly #updateObservations: UpdateObservationRepository
  readonly #provenance: LocalSourceProvenanceRepository
  readonly #rootPolicy: ApprovedRootPolicy
  readonly #approvedRoots: () => readonly SourceRoot[]
  readonly #adapterForRoot: (root: SourceRoot) => SkillRuntimeAdapter
  readonly #rescan: () => Promise<void>
  readonly #recoveryRootId: string
  readonly #leases: PrivateSourceLeaseRepository
  readonly #now: () => Date
  readonly #ids: () => string
  readonly #onInventoryChanged: (installationIds: readonly string[]) => void
  readonly #onCompleted: (result: OperationResultDto) => void
  readonly #pending = new Map<string, PendingLocalOperation>()
  readonly #observations = new Map<string, LocalSourceUpdateObservation>()
  readonly #invalidatedPlans = new Map<string, string>()

  constructor(options: DesktopOperationServiceOptions) {
    this.#selections = options.selections
    this.#installs = options.installs
    this.#updates = options.updates
    this.#contentUpdates = options.contentUpdates
    this.#repository = options.repository
    this.#projections = options.projections
    this.#settings = options.settings
    this.#updateObservations = options.updateObservations
    this.#provenance = options.provenance
    this.#rootPolicy = options.rootPolicy
    this.#approvedRoots = options.approvedRoots
    this.#adapterForRoot = options.adapterForRoot
    this.#rescan = options.rescan
    this.#recoveryRootId = options.recoveryRootId
    this.#leases = options.leases
    this.#now = options.now ?? (() => new Date())
    this.#ids = options.ids ?? randomUUID
    this.#onInventoryChanged = options.onInventoryChanged ?? (() => undefined)
    this.#onCompleted = options.onCompleted ?? (() => undefined)
  }

  async selectLocalSource(input: SelectLocalSourceInput): Promise<LocalSourceSelectionDto | null> {
    try {
      const selection = await this.#selections.select(input.kind)
      if (selection === undefined) return null
      if (selection.kind === "directory") {
        return {
          kind: "directory",
          selectionToken: selection.selectionToken,
          displayName: selection.displayName,
          treeHash: selection.treeHash,
          expiresAt: selection.expiresAt,
        }
      }
      if (selection.archiveSha256 === undefined) throw new LocalSourceError("ARCHIVE_MALFORMED", "Verified ZIP has no archive hash")
      return {
        kind: "zip",
        selectionToken: selection.selectionToken,
        displayName: selection.displayName,
        archiveSha256: selection.archiveSha256,
        treeHash: selection.treeHash,
        expiresAt: selection.expiresAt,
      }
    } catch (error) {
      if (input.kind === "zip" && error instanceof LocalSourceError && [
        "PATH_INVALID", "PATH_COLLISION", "PAYLOAD_AMBIGUOUS", "ARCHIVE_MALFORMED",
      ].includes(error.code)) {
        throw new Error(`El ZIP contiene una ruta no segura. ${error.message}`, { cause: error })
      }
      throw error
    }
  }

  async plan(input: OperationRequestDto): Promise<OperationPlanDto> {
    if (input.kind === "update-entry-content") return this.#contentUpdates.plan(input)
    return input.kind === "install-local" ? this.#planInstall(input) : this.#planSourceUpdate(input)
  }

  async confirm(input: ConfirmOperationInput): Promise<OperationResultDto> {
    const invalidation = this.#invalidatedPlans.get(input.planId)
    if (invalidation !== undefined) {
      const plan = await this.#repository.get(input.planId)
      this.#invalidatedPlans.delete(input.planId)
      const result = this.#result(
        input.planId,
        "stale",
        [...(plan?.installationIds ?? [])],
        invalidation,
        false,
      )
      this.#onCompleted(result)
      return result
    }
    const pending = this.#pending.get(input.planId)
    if (pending === undefined) {
      const result = await this.#contentUpdates.confirm(input.planId)
      if (result.status === "committed") await this.refreshUpdates()
      this.#onCompleted(result)
      return result
    }
    const result = pending.kind === "install"
      ? await this.#confirmInstall(pending.prepared)
      : await this.#confirmSourceUpdate(pending.prepared)
    this.#onCompleted(result)
    return result
  }

  async undo(input: UndoOperationInput): Promise<OperationResultDto> {
    const existing = await this.#repository.get(input.journalId)
    const result = await this.#contentUpdates.undo(input.journalId)
    if (result.status === "committed") {
      const undo = parseUndo(this.#settings.get<unknown>(`${UPDATE_UNDO_PREFIX}${input.journalId}`))
      if (undo !== undefined) {
        this.#provenance.persist(undo.provenanceId, undo.previous)
        this.#settings.delete(`${UPDATE_UNDO_PREFIX}${input.journalId}`)
      }
      for (const installationId of existing?.installationIds ?? []) {
        if (this.#projections.getInstallation(installationId) === undefined) this.#updateObservations.delete(installationId)
      }
      await this.refreshUpdates()
    }
    this.#onCompleted(result)
    return result
  }

  history(): Promise<OperationHistoryDto> {
    return Promise.resolve(this.#contentUpdates.history())
  }

  invalidatePlansForExternalChange(invalidation: ExternalChangeInvalidation): readonly string[] {
    const root = this.#approvedRoots().find(({ id }) => id === invalidation.rootId)
    if (root === undefined) return []
    const changed = invalidation.paths.map((candidate) => path.resolve(candidate))
    const invalidated: string[] = []
    for (const plan of this.#repository.listPlans()) {
      if (plan.state !== "planned") continue
      const overlaps = plan.affectedPaths
        .filter(({ rootId }) => rootId === root.id)
        .map(({ relativePath }) => path.resolve(root.canonicalPath, relativePath))
        .some((affected) => changed.some((candidate) => pathsOverlap(affected, candidate)))
      if (!overlaps) continue
      this.#invalidatedPlans.set(plan.id, "Los archivos cambiaron fuera de Forge; revisa y crea un nuevo plan")
      invalidated.push(plan.id)
    }
    return invalidated
  }

  /** Replays idempotent projection effects after the persisted roots are rescanned. */
  async recoverCommittedLocalState(): Promise<void> {
    const plans = this.#repository.listPlans()
      .filter((plan) => plan.state === "committed" && plan.undoStatus === "available")
      .filter((plan) => this.#settings.get(`${LOCAL_COMMIT_APPLIED_PREFIX}${plan.id}`) === undefined)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    const recoveredInstallations = new Set<string>()
    for (const plan of plans) {
      const completion = parseLocalSourceCommitMetadata(plan)
      if (completion === undefined) continue
      if (completion.kind === "install") {
        const installation = this.#projections.getInstallation(completion.provenance.installationId) ??
          this.#projections.listInstallations().find((candidate) =>
            candidate.adapterId === plan.adapterId &&
            candidate.canonicalPath === completion.provenance.destinationCanonicalPath)
        if (installation === undefined) {
          throw new OperationConflictError(`Committed installation ${plan.id} is missing after recovery scan`)
        }
        const provenance: LocalImportProvenanceV1 = {
          ...completion.provenance,
          installationId: installation.id,
        }
        this.#provenance.persist(installation.provenanceId, provenance)
        this.#persistRecoveredBase(provenance)
        recoveredInstallations.add(installation.id)
      } else {
        const installation = this.#projections.getInstallation(completion.provenance.installationId)
        if (installation === undefined || installation.provenanceId !== completion.provenanceId) {
          throw new OperationConflictError(`Committed source update ${plan.id} no longer matches its installation`)
        }
        this.#provenance.persist(completion.provenanceId, completion.provenance)
        this.#persistRecoveredBase(completion.provenance)
        recoveredInstallations.add(completion.provenance.installationId)
      }
      this.#leases.delete(plan.id)
      this.#markLocalCommitApplied(plan.id)
    }
    if (recoveredInstallations.size > 0) {
      await this.refreshUpdates()
      this.#onInventoryChanged([...recoveredInstallations])
    }
  }

  async refreshUpdates(): Promise<AckDto> {
    const changed: string[] = []
    for (const installation of this.#projections.listInstallations()) {
      try {
        if (this.#provenance.reconstruct(installation.provenanceId) === undefined) continue
        const observation = await this.#updates.observePersisted(installation.provenanceId, "explicit")
        this.#observations.set(installation.id, observation)
        this.#persistObservation(observation)
        changed.push(installation.id)
      } catch {
        // Non-local or corrupt provenance is not an update-capable local source.
      }
    }
    if (changed.length > 0) this.#onInventoryChanged(changed)
    return { ok: true }
  }

  async #planInstall(input: Extract<OperationRequestDto, { kind: "install-local" }>): Promise<OperationPlanDto> {
    const root = this.#requireRoot(input.targetRootId)
    const source = await this.#selections.inspectForPlanning(input.source.selectionToken, input.source)
    const adapter = this.#adapterForRoot(root)
    const planned = await adapter.planOperation({ request: input, targetRoot: root, sourceManifest: source.manifest, rootPolicy: this.#rootPolicy })
    if (planned.status !== "planned") return unavailableReason(planned)
    const sourcePath = `.forge-source-${suffix(planned.plan.operation.planId)}`
    this.#leases.put({
      version: 1,
      planId: planned.plan.operation.planId,
      rootId: this.#recoveryRootId,
      relativePath: sourcePath,
      expectedHash: source.manifest.treeHash,
      createdAt: this.#now().toISOString(),
    })
    try {
      const prepared = await this.#installs.prepare({ source: input.source, adapterPlan: planned.plan, journalId: planned.plan.operation.planId })
      this.#pending.set(prepared.plan.id, { kind: "install", prepared })
      return {
        ...planned.plan.operation,
        installationIds: [...prepared.plan.installationIds],
        affectedEntries: prepared.preview.map((entry) => ({
          action: entry.action,
          rootId: entry.rootId,
          relativePath: entry.relativePath,
          ...(entry.byteLength === undefined ? {} : { afterByteLength: entry.byteLength }),
          ...(entry.sha256 === undefined ? {} : { afterSha256: entry.sha256 }),
        })),
        destinationLabel: prepared.provenance.destinationCanonicalPath,
      }
    } catch (error) {
      this.#leases.delete(planned.plan.operation.planId)
      throw error
    }
  }

  async #planSourceUpdate(input: Extract<OperationRequestDto, { kind: "update-from-local" }>): Promise<OperationPlanDto> {
    const installation = this.#projections.getInstallation(input.installationId)
    if (installation === undefined || installation.snapshotId !== input.expectedSnapshotId) {
      throw new OperationConflictError("La instalación cambió desde que se abrió el inspector")
    }
    const root = this.#requireRoot(installation.rootId)
    const observation = await this.#updates.observePersisted(installation.provenanceId, "explicit")
    this.#observations.set(installation.id, observation)
    this.#persistObservation(observation)
    if (observation.state !== "available") {
      throw new LocalSourceError("UPDATE_CONFLICT", observation.state === "diverged"
        ? "La instalación contiene cambios locales y no se sobrescribirá"
        : `La actualización local no está disponible: ${observation.state}`)
    }
    const sourceManifest = this.#updates.sourceManifestForObservation(observation.observationId)
    const adapter = this.#adapterForRoot(root)
    const planned = await adapter.planOperation({ request: input, targetRoot: root, installation, sourceManifest, rootPolicy: this.#rootPolicy })
    if (planned.status !== "planned") return unavailableReason(planned)
    const sourcePath = `.forge-update-source-${suffix(planned.plan.operation.planId)}`
    this.#leases.put({
      version: 1,
      planId: planned.plan.operation.planId,
      rootId: this.#recoveryRootId,
      relativePath: sourcePath,
      expectedHash: sourceManifest.treeHash,
      createdAt: this.#now().toISOString(),
    })
    try {
      const prepared = await this.#updates.prepare({
        observationId: observation.observationId,
        adapterPlan: planned.plan,
        journalId: planned.plan.operation.planId,
        provenanceId: installation.provenanceId,
      })
      const undo: PersistedUpdateUndo = { version: 1, provenanceId: installation.provenanceId, previous: prepared.previousProvenance }
      this.#settings.set(`${UPDATE_UNDO_PREFIX}${prepared.plan.id}`, undo, this.#now().toISOString())
      this.#pending.set(prepared.plan.id, { kind: "update", prepared })
      return {
        ...planned.plan.operation,
        affectedEntries: prepared.preview.map((entry) => ({ ...entry })),
        destinationLabel: `${adapter.displayName} · ${prepared.plan.artifacts.destination.relativePath}`,
      }
    } catch (error) {
      this.#leases.delete(planned.plan.operation.planId)
      throw error
    }
  }

  async #confirmInstall(prepared: PreparedLocalInstall): Promise<OperationResultDto> {
    try {
      const executed = await this.#installs.execute(prepared)
      this.#leases.delete(prepared.plan.id)
      await this.#rescan()
      const installed = this.#projections.listInstallations().find((candidate) =>
        candidate.adapterId === prepared.plan.adapterId && candidate.canonicalPath === executed.provenance.destinationCanonicalPath)
      if (installed === undefined) throw new Error("La instalación confirmada no apareció en el inventario")
      const provenance: LocalImportProvenanceV1 = { ...executed.provenance, installationId: installed.id }
      this.#provenance.persist(installed.provenanceId, provenance)
      this.#updateObservations.put({
        installationId: installed.id,
        state: "current",
        observedAt: this.#now().toISOString(),
        baseTreeHash: provenance.installedTreeHash,
        installedTreeHash: provenance.installedTreeHash,
        sourceTreeHash: provenance.sourceTreeHash,
      })
      this.#markLocalCommitApplied(executed.plan.id)
      this.#pending.delete(prepared.plan.id)
      this.#onInventoryChanged([installed.id])
      return this.#result(executed.plan.id, "committed", [installed.id], "Skill instalada", true)
    } catch (error) {
      if (!(error instanceof OperationInterruptedError)) {
        this.#leases.delete(prepared.plan.id)
        this.#pending.delete(prepared.plan.id)
      }
      return this.#result(prepared.plan.id, classify(error), [...prepared.plan.installationIds], safeMessage(error), false)
    }
  }

  async #confirmSourceUpdate(prepared: PreparedLocalSourceUpdate): Promise<OperationResultDto> {
    try {
      const executed = await this.#updates.execute(prepared)
      this.#leases.delete(prepared.plan.id)
      await this.#rescan()
      this.#updateObservations.put({
        installationId: executed.provenance.installationId,
        state: "current",
        observedAt: this.#now().toISOString(),
        baseTreeHash: executed.provenance.installedTreeHash,
        installedTreeHash: executed.provenance.installedTreeHash,
        sourceTreeHash: executed.provenance.sourceTreeHash,
      })
      this.#markLocalCommitApplied(executed.plan.id)
      this.#pending.delete(prepared.plan.id)
      this.#onInventoryChanged([executed.provenance.installationId])
      return this.#result(executed.plan.id, "committed", [executed.provenance.installationId], "Skill actualizada desde su fuente local", true)
    } catch (error) {
      if (!(error instanceof OperationInterruptedError)) {
        this.#leases.delete(prepared.plan.id)
        this.#pending.delete(prepared.plan.id)
      }
      return this.#result(prepared.plan.id, classify(error), [...prepared.plan.installationIds], safeMessage(error), false)
    }
  }

  #persistObservation(observation: LocalSourceUpdateObservation): void {
    this.#updateObservations.put({
      installationId: observation.installationId,
      state: observation.state,
      observedAt: observation.observedAt,
      baseTreeHash: observation.baseTreeHash,
      ...(observation.installedTreeHash === undefined ? {} : { installedTreeHash: observation.installedTreeHash }),
      ...(observation.sourceTreeHash === undefined ? {} : { sourceTreeHash: observation.sourceTreeHash }),
    })
  }

  #persistRecoveredBase(provenance: LocalImportProvenanceV1): void {
    this.#updateObservations.put({
      installationId: provenance.installationId,
      state: "current",
      observedAt: this.#now().toISOString(),
      baseTreeHash: provenance.installedTreeHash,
      installedTreeHash: provenance.installedTreeHash,
      sourceTreeHash: provenance.sourceTreeHash,
    })
  }

  #markLocalCommitApplied(planId: string): void {
    this.#settings.set(
      `${LOCAL_COMMIT_APPLIED_PREFIX}${planId}`,
      { version: 1 },
      this.#now().toISOString(),
    )
  }

  #requireRoot(rootId: string): SourceRoot {
    const root = this.#approvedRoots().find(({ id }) => id === rootId)
    if (root === undefined) throw new Error("La carpeta de destino ya no está aprobada")
    return root
  }

  #result(
    planId: string,
    status: OperationResultDto["status"],
    installationIds: readonly string[],
    message: string,
    undoAvailable: boolean,
  ): OperationResultDto {
    return {
      operationId: operationId(this.#ids),
      planId,
      journalId: planId,
      status,
      finishedAt: this.#now().toISOString(),
      installationIds: [...installationIds],
      message,
      issues: status === "committed" ? [] : [{ code: status, message }],
      undoAvailable: status === "committed" && undoAvailable,
    }
  }
}
