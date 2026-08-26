import path from "node:path"

import type { JournalMutation } from "./types.js"

interface JournalRecord {
  readonly journalId: string
  readonly paths: readonly string[]
  readonly registeredAt: number
  readonly expiresAt: number
}

function contains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/** Time-bounded correlation only; it never suppresses reconciliation. */
export class JournalEventCorrelator {
  readonly #now: () => Date
  readonly #records = new Map<string, JournalRecord>()

  constructor(now: () => Date = () => new Date()) {
    this.#now = now
  }

  record(input: JournalMutation): void {
    if (input.journalId.trim().length === 0) throw new TypeError("Journal ID cannot be empty")
    const ttlMs = input.ttlMs ?? 5_000
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new TypeError("Journal correlation TTL must be a positive integer")
    }
    if (input.paths.length === 0 || input.paths.some((candidate) => !path.isAbsolute(candidate))) {
      throw new TypeError("Journal correlation requires absolute affected paths")
    }
    const registeredAt = this.#now().getTime()
    this.#records.set(input.journalId, {
      journalId: input.journalId,
      paths: Object.freeze(input.paths.map((candidate) => path.resolve(candidate))),
      registeredAt,
      expiresAt: registeredAt + ttlMs,
    })
  }

  clear(journalId: string): void {
    this.#records.delete(journalId)
  }

  correlate(candidate: string): string | undefined {
    const at = this.#now().getTime()
    const resolved = path.resolve(candidate)
    let match: JournalRecord | undefined
    for (const [journalId, record] of this.#records) {
      if (record.expiresAt < at) {
        this.#records.delete(journalId)
        continue
      }
      if (
        record.paths.some((affected) => contains(affected, resolved)) &&
        (match === undefined || record.registeredAt > match.registeredAt)
      ) {
        match = record
      }
    }
    return match?.journalId
  }

  dispose(): void {
    this.#records.clear()
  }
}
