import path from "node:path"

import type { SourceRoot } from "@forge/domain"

import { createChokidarWatchSource } from "./chokidar-source.js"
import { JournalEventCorrelator } from "./journal-correlator.js"
import type {
  JournalMutation,
  RootWatcherReconcilerOptions,
  WatchBatch,
  WatchEvent,
  WatchEventKind,
  WatchSource,
  WatchSourceFactory,
  WatcherFinding,
} from "./types.js"

interface PendingBatch {
  readonly root: SourceRoot
  readonly origin: "external" | "self"
  readonly journalId?: string
  readonly events: Map<string, WatchEvent>
  timer: ReturnType<typeof setTimeout>
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Unknown watcher error"
}

/**
 * Turns filesystem bursts into reconciliation requests. Self-generated events
 * remain observable and carry their journal ID; only external batches
 * invalidate plans. Neither path ever performs a filesystem mutation.
 */
export class RootWatcherReconciler {
  readonly #roots: readonly SourceRoot[]
  readonly #debounceMs: number
  readonly #factory: WatchSourceFactory
  readonly #now: () => Date
  readonly #onReconcile: RootWatcherReconcilerOptions["onReconcile"]
  readonly #onInvalidatePlans: RootWatcherReconcilerOptions["onInvalidatePlans"]
  readonly #onFinding: (finding: WatcherFinding) => void
  readonly #correlator: JournalEventCorrelator
  readonly #pending = new Map<string, PendingBatch>()
  readonly #callbacks = new Set<Promise<void>>()
  #watcher: WatchSource | undefined
  #state: "idle" | "started" | "disposed" = "idle"

  constructor(options: RootWatcherReconcilerOptions) {
    const debounceMs = options.debounceMs ?? 100
    if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) {
      throw new TypeError("Watcher debounce must be a non-negative integer")
    }
    this.#roots = Object.freeze([...options.approvedRoots].sort(
      (left, right) => right.canonicalPath.length - left.canonicalPath.length,
    ))
    this.#debounceMs = debounceMs
    this.#factory = options.watchSourceFactory ?? createChokidarWatchSource
    this.#now = options.now ?? (() => new Date())
    this.#onReconcile = options.onReconcile
    this.#onInvalidatePlans = options.onInvalidatePlans
    this.#onFinding = options.onFinding ?? (() => undefined)
    this.#correlator = new JournalEventCorrelator(this.#now)
  }

  start(): void {
    if (this.#state !== "idle") throw new Error("Root watcher can only be started once")
    this.#state = "started"
    const watcher = this.#factory(this.#roots.map(({ canonicalPath }) => canonicalPath))
    this.#watcher = watcher
    watcher.onAll((kind, candidate) => this.#receive(kind, candidate))
    watcher.onError((error) => {
      this.#onFinding({ code: "WATCHER_ERROR", severity: "warning", message: errorMessage(error) })
    })
  }

  async ready(): Promise<void> {
    if (this.#state !== "started") throw new Error("Root watcher must be started before waiting for readiness")
    await this.#watcher?.ready?.()
  }

  recordJournalMutation(input: JournalMutation): void {
    if (this.#state === "disposed") throw new Error("Root watcher is disposed")
    this.#correlator.record(input)
  }

  clearJournalMutation(journalId: string): void {
    this.#correlator.clear(journalId)
  }

  async flush(): Promise<void> {
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    await Promise.all(pending.map(async (batch) => {
      clearTimeout(batch.timer)
      await this.#deliver(batch)
    }))
    await Promise.all([...this.#callbacks])
  }

  async dispose(): Promise<void> {
    if (this.#state === "disposed") return
    this.#state = "disposed"
    for (const batch of this.#pending.values()) clearTimeout(batch.timer)
    this.#pending.clear()
    this.#correlator.dispose()
    const watcher = this.#watcher
    this.#watcher = undefined
    if (watcher !== undefined) await watcher.close()
    await Promise.all([...this.#callbacks])
  }

  #receive(kind: WatchEventKind, candidate: string): void {
    if (this.#state !== "started") return
    const resolved = path.resolve(candidate)
    const root = this.#roots.find(({ canonicalPath }) => isWithin(canonicalPath, resolved))
    if (root === undefined) return
    const journalId = this.#correlator.correlate(resolved)
    const origin = journalId === undefined ? "external" : "self"
    const key = `${root.id}\0${origin}\0${journalId ?? ""}`
    const existing = this.#pending.get(key)
    if (existing !== undefined) {
      clearTimeout(existing.timer)
      existing.events.set(`${kind}\0${resolved}`, { kind, path: resolved })
      existing.timer = setTimeout(() => this.#scheduleDelivery(key), this.#debounceMs)
      return
    }
    const events = new Map<string, WatchEvent>()
    events.set(`${kind}\0${resolved}`, { kind, path: resolved })
    const batch: PendingBatch = {
      root,
      origin,
      ...(journalId === undefined ? {} : { journalId }),
      events,
      timer: setTimeout(() => this.#scheduleDelivery(key), this.#debounceMs),
    }
    this.#pending.set(key, batch)
  }

  #scheduleDelivery(key: string): void {
    const batch = this.#pending.get(key)
    if (batch === undefined || this.#state !== "started") return
    this.#pending.delete(key)
    const callback = this.#deliver(batch).finally(() => this.#callbacks.delete(callback))
    this.#callbacks.add(callback)
  }

  async #deliver(pending: PendingBatch): Promise<void> {
    const observedAt = this.#now().toISOString()
    const events = [...pending.events.values()].sort((left, right) =>
      left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind),
    )
    const batch: WatchBatch = {
      rootId: pending.root.id,
      adapterId: pending.root.adapterId,
      origin: pending.origin,
      ...(pending.journalId === undefined ? {} : { journalId: pending.journalId }),
      events,
      observedAt,
    }
    try {
      if (pending.origin === "external") {
        await this.#onInvalidatePlans({
          rootId: pending.root.id,
          paths: [...new Set(events.map(({ path: eventPath }) => eventPath))],
          observedAt,
        })
      }
      await this.#onReconcile(batch)
    } catch (error) {
      this.#onFinding({
        code: "WATCHER_CALLBACK_FAILED",
        severity: "warning",
        message: errorMessage(error),
      })
    }
  }
}
