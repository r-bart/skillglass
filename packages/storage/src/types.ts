import type {
  EffectiveSkill,
  ProjectScope,
  Provenance,
  ScopeBinding,
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
  /** Reconstructible adapter-owned visibility/runtime observations. */
  readonly bindings?: readonly ScopeBinding[]
  /** Reconstructible adapter-owned collision/precedence results. */
  readonly effectiveSkills?: readonly EffectiveSkill[]
}

export interface StoredProvenance {
  readonly id: string
  readonly installationId: string
  readonly observedAt: string
  readonly value: Provenance
}

export interface StoredUpdateObservation {
  readonly installationId: string
  readonly state: "current" | "available" | "diverged" | "unknown"
  readonly observedAt: string
  readonly baseTreeHash: string
  readonly installedTreeHash?: string
  readonly sourceTreeHash?: string
}

export interface UpdateObservationRepository {
  put(observation: StoredUpdateObservation): void
  get(installationId: string): StoredUpdateObservation | undefined
  list(): readonly StoredUpdateObservation[]
  delete(installationId: string): boolean
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
  listBindings(): readonly ScopeBinding[]
  listEffectiveSkills(): readonly EffectiveSkill[]
}

export interface InventoryQueryRepository {
  list(query: InventoryQuery): InventoryPageDto
  inspect(installationId: string): InstallationDetailDto | undefined
}

export interface SnapshotRepository {
  put(snapshot: SkillSnapshot): void
  get(id: string): SkillSnapshot | undefined
  listForInstallation(installationId: string): readonly SkillSnapshot[]
  /** Applies the 30-snapshot/90-day target without deleting current projections. */
  prune(options: Readonly<{
    now: Date
    latestPerInstallation?: number
    maxAgeDays?: number
    storageCeilingBytes?: number
  }>): number
  putProvenance(provenance: StoredProvenance): void
  getProvenance(id: string): StoredProvenance | undefined
}

export interface OperationJournalRepository {
  putPlan(plan: StoredOperationPlan): void
  /** Atomically persists a new core plan and its first journal event. */
  insertPlanWithStep(plan: StoredOperationPlan, step: JournalStep): void
  getPlan(id: string): StoredOperationPlan | undefined
  listPlans(): readonly StoredOperationPlan[]
  updatePlanState(id: string, state: OperationPlanState, updatedAt?: string): boolean
  /** CAS on the revision stored in payload; persists plan and event atomically. */
  transitionPlanWithStep(
    expectedRevision: number,
    plan: StoredOperationPlan,
    step: JournalStep,
  ): boolean
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
  readonly updates: UpdateObservationRepository
  readonly path: string
  close(): void
}

export interface OpenForgeStoreOptions {
  /** Injected by the Electron main process, normally below app.getPath("userData"). */
  readonly path: string
  /** Restrict the parent directory to the current user. Enable only for a Forge-owned directory. */
  readonly privateDirectory?: boolean
}
