import { randomUUID } from "node:crypto"

import {
  OperationConcurrencyError,
  OperationConflictError,
  OperationInterruptedError,
  OperationNotReadyError,
  OperationValidationError,
} from "./errors.js"
import { assertOperationPlan } from "./plans.js"
import type {
  ArtifactExpectation,
  ArtifactObservation,
  ArtifactRef,
  JournalEventKind,
  OperationEngineOptions,
  OperationJournalEvent,
  OperationPlan,
  OperationState,
  RecoveryOutcome,
  UndoStatus,
} from "./types.js"

const TERMINAL_STATES: readonly OperationState[] = [
  "committed",
  "rolled-back",
  "recovery-required",
]

const ALLOWED_TRANSITIONS: Readonly<Record<OperationState, readonly OperationState[]>> = {
  planned: ["preconditions-checked", "rolling-back", "recovery-required"],
  "preconditions-checked": ["staged", "rolling-back", "recovery-required"],
  staged: ["snapshot-created", "rolling-back", "recovery-required"],
  "snapshot-created": ["applying", "rolling-back", "recovery-required"],
  applying: ["verifying", "rolling-back", "recovery-required"],
  verifying: ["committed", "rolling-back", "recovery-required"],
  committed: ["recovery-required"],
  "rolling-back": ["rolled-back", "recovery-required"],
  "rolled-back": [],
  "recovery-required": [],
}

function observationMatches(
  observation: ArtifactObservation,
  expectation: ArtifactExpectation,
): boolean {
  return expectation.exists
    ? observation.exists && observation.hash === expectation.hash
    : !observation.exists
}

function exactObservation(observation: ArtifactObservation, hash: string): boolean {
  return observation.exists && observation.hash === hash
}

function detailValue(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export class OperationEngine {
  readonly #repository: OperationEngineOptions["repository"]
  readonly #fileSystem: OperationEngineOptions["fileSystem"]
  readonly #clock: NonNullable<OperationEngineOptions["clock"]>
  readonly #ids: NonNullable<OperationEngineOptions["ids"]>
  readonly #afterPersist: NonNullable<OperationEngineOptions["afterPersist"]>
  #ready = false
  #mutationActive = false

  constructor(options: OperationEngineOptions) {
    this.#repository = options.repository
    this.#fileSystem = options.fileSystem
    this.#clock = options.clock ?? { now: () => new Date() }
    this.#ids = options.ids ?? { next: () => randomUUID() }
    this.#afterPersist = options.afterPersist ?? (() => undefined)
  }

  get ready(): boolean {
    return this.#ready
  }

  /** Resolves all durable incomplete work before enabling any new mutation. */
  async recoverStartup(): Promise<readonly RecoveryOutcome[]> {
    return this.#exclusive(async () => {
      this.#ready = false
      const outcomes: RecoveryOutcome[] = []
      for (const persisted of await this.#repository.listRecoverable()) {
        let plan = await this.#requirePlan(persisted.id)
        if (plan.undoStatus === "applying") {
          plan = await this.#recoverUndo(plan)
        } else if (!TERMINAL_STATES.includes(plan.state)) {
          plan = await this.#recoverOperation(plan)
        }
        outcomes.push({ planId: plan.id, state: plan.state, undoStatus: plan.undoStatus })
      }
      this.#ready = true
      return outcomes
    })
  }

  /** Persists the preview before it can be confirmed or executed. */
  async register(plan: OperationPlan): Promise<OperationPlan> {
    assertOperationPlan(plan)
    if (plan.state !== "planned" || plan.revision !== 0 || plan.undoStatus !== "pending") {
      throw new OperationValidationError("A new plan must start at planned revision zero")
    }
    const event = this.#event(plan, "state-transition", { registered: true })
    await this.#repository.insert(plan, event)
    await this.#afterPersist(plan, event)
    return plan
  }

  async execute(planId: string): Promise<OperationPlan> {
    this.#assertReady()
    return this.#exclusive(async () => {
      let plan = await this.#requirePlan(planId)
      if (plan.state !== "planned") {
        throw new OperationValidationError(`Plan ${plan.id} is not awaiting confirmation`)
      }
      try {
        this.#assertNotExpired(plan)
        await this.#checkPreconditions(plan)
        plan = await this.#transition(plan, "preconditions-checked", {
          preconditions: plan.preconditions.length,
        })

        await this.#createStage(plan)
        plan = await this.#transition(plan, "staged", {
          stagedHash: plan.expectedAfterHash,
        })

        await this.#createSnapshot(plan)
        plan = await this.#transition(plan, "snapshot-created", {
          snapshot: plan.artifacts.snapshot !== undefined,
        })

        plan = await this.#transition(plan, "applying", {}, plan.undoStatus, true)
        await this.#fileSystem.replace(
          plan.artifacts.stage,
          plan.artifacts.destination,
          plan.kind === "install" ? "create" : "update",
        )

        plan = await this.#transition(plan, "verifying", {})
        await this.#verifyPostconditions(plan)
        return await this.#transition(
          plan,
          "committed",
          { verifiedHash: plan.expectedAfterHash },
          "available",
        )
      } catch (error) {
        if (error instanceof OperationInterruptedError) throw error
        plan = await this.#requirePlan(planId)
        if (!TERMINAL_STATES.includes(plan.state)) {
          await this.#rollback(plan, error)
        }
        throw error
      }
    })
  }

  async undo(planId: string): Promise<OperationPlan> {
    this.#assertReady()
    return this.#exclusive(async () => {
      let plan = await this.#requirePlan(planId)
      if (plan.state !== "committed" || plan.undoStatus !== "available") {
        throw new OperationValidationError(`Plan ${plan.id} has no available undo`)
      }
      await this.#checkUndoPreconditions(plan)
      plan = await this.#persistUndo(plan, "applying", "undo-applying", {})
      try {
        await this.#applyUndo(plan, false)
        return await this.#persistUndo(plan, "completed", "undo-completed", {})
      } catch (error) {
        if (error instanceof OperationInterruptedError) throw error
        plan = await this.#requirePlan(planId)
        const destination = await this.#fileSystem.observe(plan.artifacts.destination)
        if (exactObservation(destination, plan.expectedAfterHash)) {
          await this.#persistUndo(plan, "available", "undo-conflict", {
            reason: detailValue(error),
          })
        } else {
          await this.#markRecoveryRequired(plan, `Undo failed after changing destination: ${detailValue(error)}`)
        }
        throw error
      }
    })
  }

  async #checkPreconditions(plan: OperationPlan): Promise<void> {
    const { source, destination, stage, snapshot } = plan.artifacts
    if (source !== undefined) await this.#fileSystem.authorize(source, "read")
    await this.#fileSystem.authorize(destination, "write")
    await this.#fileSystem.authorize(stage, "write")
    if (snapshot !== undefined) await this.#fileSystem.authorize(snapshot, "write")

    if (source !== undefined) {
      const observed = await this.#fileSystem.observe(source)
      if (!exactObservation(observed, plan.expectedSourceHash ?? "")) {
        throw new OperationConflictError("Source changed after the operation preview")
      }
    }
    const destinationObserved = await this.#fileSystem.observe(destination)
    if (!observationMatches(destinationObserved, plan.expectedBefore)) {
      throw new OperationConflictError("Destination changed after the operation preview")
    }
    if ((await this.#fileSystem.observe(stage)).exists) {
      throw new OperationConflictError("Stage path already exists")
    }
    if (snapshot !== undefined && (await this.#fileSystem.observe(snapshot)).exists) {
      throw new OperationConflictError("Snapshot path already exists")
    }
  }

  async #createStage(plan: OperationPlan): Promise<void> {
    if (plan.kind === "update-content") {
      await this.#fileSystem.writeFileExclusive(plan.artifacts.stage, plan.content ?? "")
    } else {
      const source = plan.artifacts.source
      if (source === undefined) throw new OperationValidationError("Source artifact is missing")
      await this.#fileSystem.copyExclusive(source, plan.artifacts.stage)
    }
    const staged = await this.#fileSystem.observe(plan.artifacts.stage)
    if (!exactObservation(staged, plan.expectedAfterHash)) {
      throw new OperationConflictError("Staged content does not match the planned hash")
    }
  }

  async #createSnapshot(plan: OperationPlan): Promise<void> {
    const snapshot = plan.artifacts.snapshot
    if (snapshot === undefined) return
    if (!plan.expectedBefore.exists) {
      throw new OperationValidationError("Snapshot requires an existing destination")
    }
    await this.#fileSystem.copyExclusive(plan.artifacts.destination, snapshot)
    const observed = await this.#fileSystem.observe(snapshot)
    if (!exactObservation(observed, plan.expectedBefore.hash)) {
      throw new OperationConflictError("Snapshot does not match the pre-apply hash")
    }
  }

  async #verifyPostconditions(plan: OperationPlan): Promise<void> {
    const observed = await this.#fileSystem.observe(plan.artifacts.destination)
    if (!exactObservation(observed, plan.expectedAfterHash)) {
      throw new OperationConflictError("Applied content failed hash verification")
    }
  }

  async #recoverOperation(plan: OperationPlan): Promise<OperationPlan> {
    const destination = await this.#fileSystem.observe(plan.artifacts.destination)
    if (
      (plan.state === "applying" || plan.state === "verifying") &&
      exactObservation(destination, plan.expectedAfterHash)
    ) {
      if (plan.state === "applying") {
        plan = await this.#transition(plan, "verifying", { recoveredAfterApply: true })
      }
      await this.#verifyPostconditions(plan)
      return this.#transition(
        plan,
        "committed",
        { recoveredCommit: true },
        "available",
      )
    }
    return this.#rollback(plan, new OperationInterruptedError("Recovered interrupted operation"))
  }

  async #rollback(plan: OperationPlan, cause: unknown): Promise<OperationPlan> {
    try {
      if (plan.state !== "rolling-back") {
        plan = await this.#transition(plan, "rolling-back", {
          cause: detailValue(cause),
        })
      }
      const destination = await this.#fileSystem.observe(plan.artifacts.destination)
      if (!plan.applyStarted) {
        // Preconditions/staging/snapshot work never touched the live destination.
      } else if (plan.kind === "install") {
        if (exactObservation(destination, plan.expectedAfterHash)) {
          if (!(await this.#fileSystem.removeExact(plan.artifacts.destination, plan.expectedAfterHash))) {
            throw new OperationConflictError("Created destination could not be removed exactly")
          }
        } else if (destination.exists) {
          throw new OperationConflictError("Install destination contains unowned changes")
        }
      } else if (plan.expectedBefore.exists) {
        if (exactObservation(destination, plan.expectedAfterHash)) {
          await this.#restoreSnapshot(plan)
        } else if (!exactObservation(destination, plan.expectedBefore.hash)) {
          throw new OperationConflictError("Update destination no longer matches before or after hash")
        }
      }
      await this.#cleanupExact(plan.artifacts.stage, plan.expectedAfterHash)
      if (plan.artifacts.snapshot !== undefined && plan.expectedBefore.exists) {
        await this.#cleanupExact(plan.artifacts.snapshot, plan.expectedBefore.hash)
      }
      return await this.#transition(plan, "rolled-back", {})
    } catch (error) {
      if (error instanceof OperationInterruptedError) throw error
      plan = await this.#requirePlan(plan.id)
      return this.#markRecoveryRequired(plan, detailValue(error))
    }
  }

  async #restoreSnapshot(plan: OperationPlan): Promise<void> {
    const snapshot = plan.artifacts.snapshot
    if (snapshot === undefined || !plan.expectedBefore.exists) {
      throw new OperationValidationError("A restorable snapshot is missing")
    }
    const snapshotObserved = await this.#fileSystem.observe(snapshot)
    if (!exactObservation(snapshotObserved, plan.expectedBefore.hash)) {
      throw new OperationConflictError("Recovery snapshot changed or is missing")
    }
    await this.#cleanupExact(plan.artifacts.stage, plan.expectedAfterHash)
    await this.#fileSystem.copyExclusive(snapshot, plan.artifacts.stage)
    await this.#fileSystem.replace(plan.artifacts.stage, plan.artifacts.destination, "update")
    const restored = await this.#fileSystem.observe(plan.artifacts.destination)
    if (!exactObservation(restored, plan.expectedBefore.hash)) {
      throw new OperationConflictError("Restored destination failed hash verification")
    }
  }

  async #cleanupExact(path: ArtifactRef, expectedHash: string): Promise<void> {
    const observed = await this.#fileSystem.observe(path)
    if (!observed.exists) return
    if (!exactObservation(observed, expectedHash) || !(await this.#fileSystem.removeExact(path, expectedHash))) {
      throw new OperationConflictError("Owned recovery artifact changed unexpectedly")
    }
  }

  async #applyUndo(plan: OperationPlan, recovering: boolean): Promise<void> {
    const destination = await this.#fileSystem.observe(plan.artifacts.destination)
    if (plan.undo.kind === "remove-created") {
      if (!destination.exists && recovering) return
      if (!exactObservation(destination, plan.undo.expectedHash)) {
        throw new OperationConflictError("Undo refused because the installed tree changed")
      }
      if (!(await this.#fileSystem.removeExact(plan.undo.artifact, plan.undo.expectedHash))) {
        throw new OperationConflictError("Undo could not remove the exact created tree")
      }
      return
    }

    if (exactObservation(destination, plan.undo.restoredHash) && recovering) return
    if (!exactObservation(destination, plan.undo.expectedCurrentHash)) {
      throw new OperationConflictError("Undo refused because content changed after commit")
    }
    const snapshot = await this.#fileSystem.observe(plan.undo.snapshot)
    if (!exactObservation(snapshot, plan.undo.restoredHash)) {
      throw new OperationConflictError("Undo snapshot changed or is missing")
    }
    await this.#cleanupExact(plan.artifacts.stage, plan.expectedAfterHash)
    await this.#fileSystem.copyExclusive(plan.undo.snapshot, plan.artifacts.stage)
    await this.#fileSystem.replace(plan.artifacts.stage, plan.undo.destination, "update")
    const restored = await this.#fileSystem.observe(plan.undo.destination)
    if (!exactObservation(restored, plan.undo.restoredHash)) {
      throw new OperationConflictError("Undo restoration failed hash verification")
    }
  }

  async #checkUndoPreconditions(plan: OperationPlan): Promise<void> {
    const destination = await this.#fileSystem.observe(plan.artifacts.destination)
    const expectedCurrentHash =
      plan.undo.kind === "remove-created"
        ? plan.undo.expectedHash
        : plan.undo.expectedCurrentHash
    if (!exactObservation(destination, expectedCurrentHash)) {
      throw new OperationConflictError("Undo refused because content changed after commit")
    }
    if (plan.undo.kind === "restore-snapshot") {
      const snapshot = await this.#fileSystem.observe(plan.undo.snapshot)
      if (!exactObservation(snapshot, plan.undo.restoredHash)) {
        throw new OperationConflictError("Undo snapshot changed or is missing")
      }
    }
  }

  async #recoverUndo(plan: OperationPlan): Promise<OperationPlan> {
    try {
      await this.#applyUndo(plan, true)
      return this.#persistUndo(plan, "completed", "undo-completed", { recovered: true })
    } catch (error) {
      if (error instanceof OperationInterruptedError) throw error
      return this.#markRecoveryRequired(plan, `Interrupted undo is ambiguous: ${detailValue(error)}`)
    }
  }

  async #markRecoveryRequired(plan: OperationPlan, reason: string): Promise<OperationPlan> {
    if (plan.state === "recovery-required") return plan
    return this.#transition(plan, "recovery-required", { reason }, "recovery-required")
  }

  async #transition(
    plan: OperationPlan,
    state: OperationState,
    details: OperationJournalEvent["details"],
    undoStatus: UndoStatus = plan.undoStatus,
    applyStarted: boolean = plan.applyStarted,
  ): Promise<OperationPlan> {
    if (!ALLOWED_TRANSITIONS[plan.state].includes(state)) {
      throw new OperationValidationError(`Invalid operation transition ${plan.state} -> ${state}`)
    }
    return this.#persist(plan, state, undoStatus, "state-transition", details, applyStarted)
  }

  async #persistUndo(
    plan: OperationPlan,
    undoStatus: UndoStatus,
    kind: Exclude<JournalEventKind, "state-transition">,
    details: OperationJournalEvent["details"],
  ): Promise<OperationPlan> {
    return this.#persist(plan, plan.state, undoStatus, kind, details, plan.applyStarted)
  }

  async #persist(
    plan: OperationPlan,
    state: OperationState,
    undoStatus: UndoStatus,
    kind: JournalEventKind,
    details: OperationJournalEvent["details"],
    applyStarted: boolean,
  ): Promise<OperationPlan> {
    const next: OperationPlan = {
      ...plan,
      revision: plan.revision + 1,
      state,
      applyStarted,
      undoStatus,
      updatedAt: this.#clock.now().toISOString(),
    }
    const event = this.#event(next, kind, details)
    await this.#repository.transition(plan.revision, next, event)
    await this.#afterPersist(next, event)
    return next
  }

  #event(
    plan: OperationPlan,
    kind: JournalEventKind,
    details: OperationJournalEvent["details"],
  ): OperationJournalEvent {
    return {
      id: this.#ids.next(),
      planId: plan.id,
      sequence: plan.revision,
      kind,
      state: plan.state,
      createdAt: this.#clock.now().toISOString(),
      details,
    }
  }

  #assertNotExpired(plan: OperationPlan): void {
    if (plan.expiresAt !== undefined && this.#clock.now().getTime() >= Date.parse(plan.expiresAt)) {
      throw new OperationConflictError("Operation preview expired before confirmation")
    }
  }

  #assertReady(): void {
    if (!this.#ready) {
      throw new OperationNotReadyError("Startup recovery must finish before mutations are accepted")
    }
  }

  async #requirePlan(planId: string): Promise<OperationPlan> {
    const plan = await this.#repository.get(planId)
    if (plan === undefined) throw new OperationValidationError(`Unknown operation plan ${planId}`)
    assertOperationPlan(plan)
    return plan
  }

  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.#mutationActive) {
      throw new OperationConcurrencyError("Another Forge filesystem mutation is active")
    }
    this.#mutationActive = true
    try {
      return await work()
    } finally {
      this.#mutationActive = false
    }
  }
}
