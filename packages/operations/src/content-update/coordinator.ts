import { createHash, randomUUID } from "node:crypto"
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
  createContentTreePlan,
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
  if (kind === "create-content-tree") return "create-skill"
  if (kind === "update-source") return "update-from-local"
  return "update-entry-content"
}

const CREATE_SKILL_METADATA = "create-skill-v1"

function createdSkillMetadata(plan: OperationPlan): { rootId: string; relativePath: string } | undefined {
  if (plan.commitMetadata?.contract !== CREATE_SKILL_METADATA) return undefined
  const value = plan.commitMetadata.value
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const rootId = "rootId" in value ? value.rootId : undefined
  const relativePath = "relativePath" in value ? value.relativePath : undefined
  return typeof rootId === "string" && typeof relativePath === "string"
    ? { rootId, relativePath }
    : undefined
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
    if (input.kind === "create-skill") return this.#planCreate(input)
    if (input.kind !== "update-entry-content") {
      throw new OperationValidationError("This coordinator accepts direct content authoring only")
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

  async #planCreate(input: Extract<OperationRequestDto, { kind: "create-skill" }>): Promise<OperationPlanDto> {
    const root = this.#projections.listRoots().find(({ id }) => id === input.targetRootId)
    if (root === undefined) throw new OperationValidationError("Approved root not found")
    if (root.access !== "read-write" || root.kind === "managed" || root.kind === "system") {
      throw new OperationValidationError("The approved root is read-only")
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.skillKey)) {
      throw new OperationValidationError("Skill key must use lowercase letters, numbers, and hyphens")
    }
    const suffix = this.#ids().replaceAll("-", "")
    const createdAt = this.#now().toISOString()
    const plan = createContentTreePlan({
      id: `plan_${suffix}`,
      createdAt,
      expiresAt: new Date(this.#now().getTime() + 15 * 60_000).toISOString(),
      adapterId: root.adapterId,
      destination: { rootId: root.id, relativePath: input.skillKey },
      stage: { rootId: root.id, relativePath: `.${input.skillKey}.forge-stage-${suffix}` },
      entries: [{ relativePath: "SKILL.md", content: input.content }],
      commitMetadata: {
        contract: CREATE_SKILL_METADATA,
        value: { rootId: root.id, relativePath: input.skillKey },
      },
    })
    await this.#engine.register(plan)
    const entryHash = createHash("sha256").update(input.content).digest("hex")
    return {
      planId: plan.id,
      kind: "create-skill",
      status: "planned",
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt ?? plan.createdAt,
      adapterId: plan.adapterId,
      installationIds: [],
      targetRootId: root.id,
      affectedScopes: [root.kind === "project" && root.projectId !== undefined
        ? { kind: "project", projectId: root.projectId }
        : { kind: "global" }],
      affectedEntries: [{
        action: "create",
        rootId: root.id,
        relativePath: `${input.skillKey}/SKILL.md`,
        afterByteLength: Buffer.byteLength(input.content, "utf8"),
        afterSha256: entryHash,
      }],
      preconditions: [{
        code: "destination-absent",
        message: "La carpeta de destino debe seguir libre hasta confirmar",
        relativePath: input.skillKey,
      }],
      conflicts: [],
      warnings: [],
      undo: "persistent",
      summary: `Crear ${input.skillKey}/SKILL.md`,
      destinationLabel: path.join(root.canonicalPath, input.skillKey),
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
      const creation = createdSkillMetadata(result)
      const createdInstallation = creation === undefined || undo
        ? undefined
        : (() => {
            const root = this.#projections.listRoots().find(({ id: rootId }) => rootId === creation.rootId)
            if (root === undefined) return undefined
            const canonicalDestination = path.resolve(root.canonicalPath, creation.relativePath)
            return this.#projections.listInstallations().find((candidate) =>
              candidate.rootId === root.id && path.resolve(candidate.canonicalPath) === canonicalDestination)
          })()
      if (creation !== undefined && !undo && createdInstallation === undefined) {
        throw new OperationConflictError("La skill creada no apareció en el inventario tras el escaneo")
      }
      const installationIds = createdInstallation === undefined
        ? [...result.installationIds]
        : [createdInstallation.id]
      return {
        operationId: `operation_${this.#ids().replaceAll("-", "")}`,
        planId: result.id,
        journalId: result.id,
        status: "committed",
        finishedAt: this.#now().toISOString(),
        installationIds,
        message: undo
          ? creation === undefined ? "Actualización deshecha" : "Creación deshecha"
          : creation === undefined ? "Skill actualizada" : "Skill creada",
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
