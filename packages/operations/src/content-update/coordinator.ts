import { randomUUID } from "node:crypto"
import path from "node:path"

import type {
  OperationHistoryDto,
  OperationPlanDto,
  OperationRequestDto,
  OperationResultDto,
} from "@forge/contracts"
import type { ProjectionRepository, SnapshotRepository } from "@forge/storage"

import {
  OperationConflictError,
  OperationEngine,
  OperationValidationError,
  createContentUpdatePlan,
  type FileSystemPort,
  type OperationPlan,
} from "../core/index.js"
import { StorageOperationRepository } from "../core/storage-repository.js"

export interface ContentUpdateCoordinatorOptions {
  readonly projections: ProjectionRepository
  readonly snapshots: SnapshotRepository
  readonly repository: StorageOperationRepository
  readonly fileSystem: FileSystemPort
  readonly engine: OperationEngine
  readonly rescan: () => Promise<void>
  readonly now?: () => Date
  readonly ids?: () => string
  /** Private, non-scanned approved root for restart-safe snapshots. */
  readonly recoveryRootId?: string
}

function relativeContained(root: string, candidate: string): string {
  const relative = path.relative(root, candidate)
  if (relative.length === 0 || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new OperationValidationError("Installation entry is not contained by its approved root")
  }
  return relative.split(path.sep).join("/")
}

function publicKind(kind: OperationPlan["kind"]): OperationPlanDto["kind"] {
  if (kind === "install") return "install-local"
  if (kind === "update-source") return "update-from-local"
  return "update-entry-content"
}

export class ContentUpdateCoordinator {
  readonly #projections: ProjectionRepository
  readonly #snapshots: SnapshotRepository
  readonly #repository: StorageOperationRepository
  readonly #fileSystem: FileSystemPort
  readonly #engine: OperationEngine
  readonly #rescan: () => Promise<void>
  readonly #now: () => Date
  readonly #ids: () => string
  readonly #recoveryRootId: string | undefined

  constructor(options: ContentUpdateCoordinatorOptions) {
    this.#projections = options.projections
    this.#snapshots = options.snapshots
    this.#repository = options.repository
    this.#fileSystem = options.fileSystem
    this.#engine = options.engine
    this.#rescan = options.rescan
    this.#now = options.now ?? (() => new Date())
    this.#ids = options.ids ?? (() => randomUUID())
    this.#recoveryRootId = options.recoveryRootId
  }

  async plan(input: OperationRequestDto): Promise<OperationPlanDto> {
    if (input.kind !== "update-entry-content") {
      throw new OperationValidationError("This coordinator accepts direct content updates only")
    }
    const installation = this.#projections.getInstallation(input.installationId)
    if (installation === undefined) throw new OperationValidationError("Installation not found")
    if (installation.access !== "read-write") {
      throw new OperationValidationError("This installation is read-only")
    }
    if (installation.snapshotId !== input.expectedSnapshotId) {
      throw new OperationConflictError("Installation changed after the editor was opened")
    }
    const root = this.#projections.listRoots().find(({ id }) => id === installation.rootId)
    if (root === undefined || root.access !== "read-write" || root.kind === "managed" || root.kind === "system") {
      throw new OperationValidationError("The approved root is read-only")
    }
    const snapshot = this.#snapshots.get(input.expectedSnapshotId)
    if (snapshot === undefined || snapshot.installationId !== installation.id) {
      throw new OperationConflictError("The expected snapshot is no longer available")
    }
    const entry = snapshot.files.find(({ canonicalPath }) => canonicalPath === installation.entryFile)
    if (entry === undefined) throw new OperationValidationError("The entry file was not observed in the snapshot")
    const relativeEntry = relativeContained(root.canonicalPath, installation.entryFile)
    const destination = { rootId: root.id, relativePath: relativeEntry, kind: "file" as const }
    const observed = await this.#fileSystem.observe(destination)
    if (!observed.exists || observed.hash !== entry.contentHash) {
      throw new OperationConflictError("Entry content changed after the last scan")
    }
    const suffix = this.#ids().replaceAll("-", "")
    const filename = path.posix.basename(relativeEntry)
    const directory = path.posix.dirname(relativeEntry)
    const sibling = (name: string) => directory === "." ? name : `${directory}/${name}`
    const createdAt = this.#now().toISOString()
    const plan = createContentUpdatePlan({
      id: `plan_${suffix}`,
      createdAt,
      expiresAt: new Date(this.#now().getTime() + 15 * 60_000).toISOString(),
      adapterId: installation.adapterId,
      installationIds: [installation.id],
      destination,
      expectedBeforeHash: entry.contentHash,
      content: input.content,
      stage: { rootId: root.id, relativePath: sibling(`.${filename}.forge-stage-${suffix}`) },
      snapshot: {
        rootId: this.#recoveryRootId ?? root.id,
        relativePath: this.#recoveryRootId === undefined
          ? sibling(`.${filename}.forge-snapshot-${suffix}`)
          : `.forge-content-snapshot-${suffix}`,
      },
    })
    await this.#engine.register(plan)
    return {
      planId: plan.id,
      kind: "update-entry-content",
      status: "planned",
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt ?? plan.createdAt,
      adapterId: plan.adapterId,
      installationIds: [installation.id],
      targetRootId: root.id,
      affectedScopes: [typeof installation.scope === "object"
        ? { kind: "project", projectId: installation.scope.projectId }
        : { kind: "global" }],
      affectedEntries: [{ action: "modify", rootId: root.id, installationId: installation.id, relativePath: relativeEntry }],
      preconditions: [{ code: "snapshot-match", message: "El snapshot y el contenido observado deben seguir sin cambios", relativePath: relativeEntry }],
      conflicts: [],
      warnings: [],
      undo: "persistent",
      summary: `Actualizar ${relativeEntry}`,
    }
  }

  async confirm(planId: string): Promise<OperationResultDto> {
    return this.#mutate(planId, false)
  }

  async undo(journalId: string): Promise<OperationResultDto> {
    return this.#mutate(journalId, true)
  }

  history(): OperationHistoryDto {
    return {
      items: this.#repository.listPlans()
        .filter((plan) => plan.state === "committed")
        .map((plan) => ({
          journalId: plan.id,
          kind: publicKind(plan.kind),
          installationIds: [...plan.installationIds],
          createdAt: plan.createdAt,
          undoAvailable: plan.undoStatus === "available",
        })),
    }
  }

  async #mutate(id: string, undo: boolean): Promise<OperationResultDto> {
    const existing = await this.#repository.get(id)
    if (existing === undefined) throw new OperationValidationError("Operation not found")
    try {
      const result = undo ? await this.#engine.undo(id) : await this.#engine.execute(id)
      await this.#rescan()
      return {
        operationId: `operation_${this.#ids().replaceAll("-", "")}`,
        planId: result.id,
        journalId: result.id,
        status: "committed",
        finishedAt: this.#now().toISOString(),
        installationIds: [...result.installationIds],
        message: undo ? "Actualización deshecha" : "Skill actualizada",
        issues: [],
        undoAvailable: !undo && result.undoStatus === "available",
      }
    } catch (error) {
      const conflict = error instanceof OperationConflictError
      return {
        operationId: `operation_${this.#ids().replaceAll("-", "")}`,
        planId: existing.id,
        journalId: existing.id,
        status: conflict ? "conflict" : "failed",
        finishedAt: this.#now().toISOString(),
        installationIds: [...existing.installationIds],
        message: error instanceof Error ? error.message : "Operation failed",
        issues: [{ code: conflict ? "external-change" : "operation-failed", message: error instanceof Error ? error.message : "Operation failed" }],
        undoAvailable: false,
      }
    }
  }
}
