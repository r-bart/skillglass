import type {
  ProjectScope,
  Provenance,
  SkillInstallation,
  SkillSnapshot,
  SourceRoot,
} from "@forge/domain"
import type {
  InstallationDetailDto,
  InventoryPageDto,
  InventoryQuery,
} from "@forge/contracts"

export interface InventoryProjection {
  readonly projects: readonly ProjectScope[]
  readonly roots: readonly SourceRoot[]
  readonly installations: readonly SkillInstallation[]
}

export interface StoredProvenance {
  readonly id: string
  readonly installationId: string
  readonly observedAt: string
  readonly value: Provenance
}

export type OperationPlanState =
  | "planned"
  | "preconditions-checked"
  | "staged"
  | "snapshot-created"
  | "applying"
  | "verifying"
  | "committed"
  | "rolling-back"
  | "rolled-back"
  | "recovery-required"
  | "blocked"
  | "expired"
  | "failed"

export interface StoredOperationPlan {
  readonly id: string
  readonly kind: string
  readonly state: OperationPlanState
  readonly createdAt: string
  readonly updatedAt: string
  readonly expiresAt?: string
  readonly adapterId: string
  /** Complete validated application-layer plan. Paths remain private to main. */
  readonly payload: unknown
}

export interface JournalStep {
  readonly id: string
  readonly planId: string
  readonly sequence: number
  readonly state: OperationPlanState
  readonly createdAt: string
  readonly payload: unknown
}

export type RecoveryState = "pending" | "resolved" | "conflict"

export interface RecoveryRecord {
  readonly id: string
  readonly planId: string
  readonly state: RecoveryState
  readonly createdAt: string
  readonly updatedAt: string
  readonly payload: unknown
}

export interface SettingsRepository {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown, updatedAt?: string): void
  delete(key: string): boolean
  entries(): ReadonlyArray<Readonly<{ key: string; value: unknown; updatedAt: string }>>
}

export interface ProjectionRepository {
  /**
   * Atomically replaces only the reconstructible inventory projection.
   * Snapshot, provenance, operation, journal and recovery history is retained.
   */
  replaceInventory(projection: InventoryProjection): void
  listProjects(): readonly ProjectScope[]
  listRoots(): readonly SourceRoot[]
  listInstallations(): readonly SkillInstallation[]
  getInstallation(id: string): SkillInstallation | undefined
}

export interface InventoryQueryRepository {
  list(query: InventoryQuery): InventoryPageDto
  inspect(installationId: string): InstallationDetailDto | undefined
}

export interface SnapshotRepository {
  put(snapshot: SkillSnapshot): void
  get(id: string): SkillSnapshot | undefined
  listForInstallation(installationId: string): readonly SkillSnapshot[]
  putProvenance(provenance: StoredProvenance): void
  getProvenance(id: string): StoredProvenance | undefined
}

export interface OperationJournalRepository {
  putPlan(plan: StoredOperationPlan): void
  getPlan(id: string): StoredOperationPlan | undefined
  updatePlanState(id: string, state: OperationPlanState, updatedAt?: string): boolean
  appendStep(step: JournalStep): void
  listSteps(planId: string): readonly JournalStep[]
  putRecovery(record: RecoveryRecord): void
  getRecovery(id: string): RecoveryRecord | undefined
  listPendingRecovery(): readonly RecoveryRecord[]
}

export interface ForgeStore {
  readonly projections: ProjectionRepository
  readonly inventory: InventoryQueryRepository
  readonly snapshots: SnapshotRepository
  readonly operations: OperationJournalRepository
  readonly settings: SettingsRepository
  readonly path: string
  close(): void
}

export interface OpenForgeStoreOptions {
  /** Injected by the Electron main process, normally below app.getPath("userData"). */
  readonly path: string
}
