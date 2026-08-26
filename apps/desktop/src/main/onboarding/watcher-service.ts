import type { SourceRoot } from "@forge/domain"
import {
  RootWatcherReconciler,
  type ExternalChangeInvalidation,
  type JournalMutation,
  type WatchBatch,
  type WatchSourceFactory,
  type WatcherFinding,
} from "@forge/scanner"

export interface ApprovedRootWatcherServiceOptions {
  readonly debounceMs?: number
  readonly watchSourceFactory?: WatchSourceFactory
  readonly onReconcile: (batch: WatchBatch) => Promise<void> | void
  readonly onInvalidatePlans: (invalidation: ExternalChangeInvalidation) => Promise<void> | void
  readonly onFinding?: (finding: WatcherFinding) => void
}

/**
 * Owns the production watcher lifecycle as root approval changes. Replacing a
 * root set always closes the previous native watcher before observing the new
 * set, so removed approvals cannot keep producing events.
 */
export class ApprovedRootWatcherService {
  readonly #options: ApprovedRootWatcherServiceOptions
  #current: RootWatcherReconciler | undefined
  #disposed = false

  constructor(options: ApprovedRootWatcherServiceOptions) {
    this.#options = options
  }

  async replaceApprovedRoots(roots: readonly SourceRoot[]): Promise<void> {
    if (this.#disposed) throw new Error("Approved root watcher service is disposed")
    await this.#current?.dispose()
    this.#current = undefined
    const observable = roots.filter(({ access }) => access !== "missing" && access !== "denied")
    if (observable.length === 0) return
    const watcher = new RootWatcherReconciler({
      approvedRoots: observable,
      ...(this.#options.debounceMs === undefined ? {} : { debounceMs: this.#options.debounceMs }),
      ...(this.#options.watchSourceFactory === undefined ? {} : { watchSourceFactory: this.#options.watchSourceFactory }),
      onReconcile: this.#options.onReconcile,
      onInvalidatePlans: this.#options.onInvalidatePlans,
      ...(this.#options.onFinding === undefined ? {} : { onFinding: this.#options.onFinding }),
    })
    watcher.start()
    this.#current = watcher
    try {
      await watcher.ready()
    } catch (error) {
      if (this.#current === watcher) this.#current = undefined
      await watcher.dispose()
      throw error
    }
  }

  recordJournalMutation(input: JournalMutation): void {
    this.#current?.recordJournalMutation(input)
  }

  async flush(): Promise<void> {
    await this.#current?.flush()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#current?.dispose()
    this.#current = undefined
  }
}
