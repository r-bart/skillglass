import { OperationConcurrencyError } from "./errors.js"
import type {
  OperationJournalEvent,
  OperationPlan,
  OperationRepository,
} from "./types.js"

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Deterministic repository useful for tests and non-SQL hosts. */
export class MemoryOperationRepository implements OperationRepository {
  readonly #plans = new Map<string, OperationPlan>()
  readonly #events = new Map<string, OperationJournalEvent[]>()

  async insert(plan: OperationPlan, event: OperationJournalEvent): Promise<void> {
    if (this.#plans.has(plan.id)) {
      throw new OperationConcurrencyError(`Operation plan ${plan.id} already exists`)
    }
    this.#plans.set(plan.id, clone(plan))
    this.#events.set(plan.id, [clone(event)])
  }

  async transition(
    expectedRevision: number,
    plan: OperationPlan,
    event: OperationJournalEvent,
  ): Promise<void> {
    const current = this.#plans.get(plan.id)
    if (current === undefined || current.revision !== expectedRevision) {
      throw new OperationConcurrencyError(`Operation plan ${plan.id} changed concurrently`)
    }
    if (plan.revision !== expectedRevision + 1 || event.sequence !== plan.revision) {
      throw new OperationConcurrencyError("Plan revision and journal sequence must advance together")
    }
    const events = this.#events.get(plan.id)
    if (events === undefined) throw new OperationConcurrencyError("Journal is missing")
    this.#plans.set(plan.id, clone(plan))
    events.push(clone(event))
  }

  async get(planId: string): Promise<OperationPlan | undefined> {
    const plan = this.#plans.get(planId)
    return plan === undefined ? undefined : clone(plan)
  }

  async listRecoverable(): Promise<readonly OperationPlan[]> {
    return [...this.#plans.values()]
      .filter(
        (plan) =>
          !["committed", "rolled-back", "recovery-required"].includes(plan.state) ||
          plan.undoStatus === "applying",
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(clone)
  }

  async listEvents(planId: string): Promise<readonly OperationJournalEvent[]> {
    return (this.#events.get(planId) ?? []).map(clone)
  }
}
