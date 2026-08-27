export type OperationKind = "install" | "create-content-tree" | "update-source" | "update-content"

export interface TreeContentEntry {
  readonly relativePath: string
  readonly content: string
}

export type OperationState =
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

export type ArtifactKind = "file" | "tree"

/** A private main-process path. It is always relative to an approved root ID. */
export interface RootRelativePath {
  readonly rootId: string
  readonly relativePath: string
}

export interface ArtifactRef extends RootRelativePath {
  readonly kind: ArtifactKind
}

export type ArtifactExpectation =
  | Readonly<{ exists: false }>
  | Readonly<{ exists: true; hash: string }>

export interface OperationPrecondition {
  readonly code:
    | "source-hash"
    | "destination-absent"
    | "destination-hash"
    | "stage-absent"
    | "snapshot-absent"
    | "approved-read"
    | "approved-write"
  readonly path: RootRelativePath
  readonly expected?: string
}

export interface OperationPostcondition {
  readonly code: "destination-hash"
  readonly path: RootRelativePath
  readonly expected: string
}

export type BackupStrategy =
  | Readonly<{ kind: "none-created-installation" }>
  | Readonly<{ kind: "snapshot"; artifact: ArtifactRef; expectedHash: string }>

export type UndoStrategy =
  | Readonly<{
      kind: "remove-created"
      artifact: ArtifactRef
      expectedHash: string
    }>
  | Readonly<{
      kind: "restore-snapshot"
      destination: ArtifactRef
      snapshot: ArtifactRef
      expectedCurrentHash: string
      restoredHash: string
    }>

export type UndoStatus =
  | "pending"
  | "available"
  | "applying"
  | "completed"
  | "recovery-required"

export interface OperationArtifacts {
  readonly destination: ArtifactRef
  readonly stage: ArtifactRef
  readonly source?: ArtifactRef
  readonly snapshot?: ArtifactRef
}

export interface OperationPlan {
  readonly id: string
  readonly revision: number
  readonly kind: OperationKind
  readonly state: OperationState
  /** Durable marker set before the first live destination mutation. */
  readonly applyStarted: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly expiresAt?: string
  readonly adapterId: string
  readonly installationIds: readonly string[]
  readonly artifacts: OperationArtifacts
  readonly expectedSourceHash?: string
  readonly expectedBefore: ArtifactExpectation
  readonly expectedAfterHash: string
  /** Present only for update-content; persisted so restart recovery is deterministic. */
  readonly content?: string
  /** Present only for create-content-tree; persisted for deterministic restart recovery. */
  readonly treeContent?: readonly TreeContentEntry[]
  /**
   * Opaque, operation-specific data required to finish idempotent projections
   * after a filesystem commit. It is durable with the plan and must be parsed
   * defensively by the owning operation module before use.
   */
  readonly commitMetadata?: Readonly<{
    contract: string
    value: unknown
  }>
  readonly preconditions: readonly OperationPrecondition[]
  readonly affectedPaths: readonly RootRelativePath[]
  readonly backup: BackupStrategy
  readonly postconditions: readonly OperationPostcondition[]
  readonly undo: UndoStrategy
  readonly undoStatus: UndoStatus
}

export type JournalEventKind =
  | "state-transition"
  | "undo-applying"
  | "undo-completed"
  | "undo-conflict"

export interface OperationJournalEvent {
  readonly id: string
  readonly planId: string
  readonly sequence: number
  readonly kind: JournalEventKind
  readonly state: OperationState
  readonly createdAt: string
  readonly details: Readonly<Record<string, string | number | boolean | null>>
}

export interface ArtifactObservation {
  readonly exists: boolean
  readonly hash?: string
}

/**
 * Filesystem capability used by the operation engine. Implementations must not
 * elevate privileges or follow links outside the root represented by rootId.
 */
export interface FileSystemPort {
  authorize(path: ArtifactRef, access: "read" | "write"): Promise<void>
  observe(path: ArtifactRef): Promise<ArtifactObservation>
  copyExclusive(source: ArtifactRef, destination: ArtifactRef): Promise<void>
  writeFileExclusive(destination: ArtifactRef, content: string): Promise<void>
  writeTreeExclusive(destination: ArtifactRef, entries: readonly TreeContentEntry[]): Promise<void>
  /** Atomically replaces destination where supported and consumes source. */
  replace(
    source: ArtifactRef,
    destination: ArtifactRef,
    mode: "create" | "update",
  ): Promise<void>
  /** Removes only when the complete current artifact matches expectedHash. */
  removeExact(path: ArtifactRef, expectedHash: string): Promise<boolean>
}

/**
 * insert and transition must persist the plan and journal event atomically.
 * transition is compare-and-swap on expectedRevision.
 */
export interface OperationRepository {
  insert(plan: OperationPlan, event: OperationJournalEvent): Promise<void>
  transition(
    expectedRevision: number,
    plan: OperationPlan,
    event: OperationJournalEvent,
  ): Promise<void>
  get(planId: string): Promise<OperationPlan | undefined>
  listRecoverable(): Promise<readonly OperationPlan[]>
  listEvents(planId: string): Promise<readonly OperationJournalEvent[]>
}

export interface OperationClock {
  now(): Date
}

export interface OperationIdFactory {
  next(): string
}

export interface OperationEngineOptions {
  readonly repository: OperationRepository
  readonly fileSystem: FileSystemPort
  readonly clock?: OperationClock
  readonly ids?: OperationIdFactory
  /** Test/process-crash seam called only after durable persistence. */
  readonly afterPersist?: (
    plan: OperationPlan,
    event: OperationJournalEvent,
  ) => Promise<void> | void
}

export interface RecoveryOutcome {
  readonly planId: string
  readonly state: OperationState
  readonly undoStatus: UndoStatus
}
