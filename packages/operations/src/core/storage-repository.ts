import type {
  JournalStep,
  OperationJournalRepository,
  StoredOperationPlan,
} from "@forge/storage"

import { OperationConcurrencyError } from "./errors.js"
import { assertOperationPlan } from "./plans.js"
import type {
  OperationJournalEvent,
  OperationPlan,
  OperationRepository,
} from "./types.js"

function storedPlan(plan: OperationPlan): StoredOperationPlan {
  return {
    id: plan.id,
    kind: plan.kind,
    state: plan.state,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    ...(plan.expiresAt === undefined ? {} : { expiresAt: plan.expiresAt }),
    adapterId: plan.adapterId,
    payload: plan,
  }
}

function storedEvent(event: OperationJournalEvent): JournalStep {
  return {
    id: event.id,
    planId: event.planId,
    sequence: event.sequence,
    state: event.state,
    createdAt: event.createdAt,
    payload: event,
  }
}

function corePlan(stored: StoredOperationPlan): OperationPlan {
  const plan = stored.payload as OperationPlan
  assertOperationPlan(plan)
  if (plan.id !== stored.id || plan.state !== stored.state) {
    throw new OperationConcurrencyError("Stored operation plan metadata does not match its payload")
  }
  return structuredClone(plan)
}

/** Durable adapter from the core operation state machine to Forge's SQLite journal. */
export class StorageOperationRepository implements OperationRepository {
  readonly #journal: OperationJournalRepository

  constructor(journal: OperationJournalRepository) {
    this.#journal = journal
  }

  async insert(plan: OperationPlan, event: OperationJournalEvent): Promise<void> {
    try {
      this.#journal.insertPlanWithStep(storedPlan(plan), storedEvent(event))
    } catch (error) {
      throw new OperationConcurrencyError(`Operation plan ${plan.id} already exists`, { cause: error })
    }
  }

  async transition(
    expectedRevision: number,
    plan: OperationPlan,
    event: OperationJournalEvent,
  ): Promise<void> {
    if (!this.#journal.transitionPlanWithStep(
      expectedRevision,
      storedPlan(plan),
      storedEvent(event),
    )) {
      throw new OperationConcurrencyError(`Operation plan ${plan.id} changed concurrently`)
    }
  }

  async get(planId: string): Promise<OperationPlan | undefined> {
    const stored = this.#journal.getPlan(planId)
    return stored === undefined ? undefined : corePlan(stored)
  }

  async listRecoverable(): Promise<readonly OperationPlan[]> {
    return this.#journal.listPlans()
      .map(corePlan)
      .filter((plan) =>
        !["committed", "rolled-back", "recovery-required"].includes(plan.state) ||
        plan.undoStatus === "applying")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }

  async listEvents(planId: string): Promise<readonly OperationJournalEvent[]> {
    return this.#journal.listSteps(planId).map((step) => structuredClone(step.payload as OperationJournalEvent))
  }

  listPlans(): readonly OperationPlan[] {
    return this.#journal.listPlans().map(corePlan)
  }
}
