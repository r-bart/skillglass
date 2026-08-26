import type { SourceRoot } from "@forge/domain"

export type WatchEventKind = "add" | "addDir" | "change" | "unlink" | "unlinkDir"

export interface WatchEvent {
  readonly kind: WatchEventKind
  readonly path: string
}

export type WatchBatch = Readonly<{
  rootId: string
  adapterId: string
  origin: "external" | "self"
  journalId?: string
  events: readonly WatchEvent[]
  observedAt: string
}>

export interface ExternalChangeInvalidation {
  readonly rootId: string
  readonly paths: readonly string[]
  readonly observedAt: string
}

export interface WatcherFinding {
  readonly code: "WATCHER_ERROR" | "WATCHER_CALLBACK_FAILED"
  readonly severity: "warning"
  readonly message: string
}

export interface WatchSource {
  onAll(listener: (kind: WatchEventKind, path: string) => void): void
  onError(listener: (error: unknown) => void): void
  ready?(): Promise<void>
  close(): Promise<void>
}

export type WatchSourceFactory = (paths: readonly string[]) => WatchSource

export interface JournalMutation {
  readonly journalId: string
  readonly paths: readonly string[]
  readonly ttlMs?: number
}

export interface RootWatcherReconcilerOptions {
  readonly approvedRoots: readonly SourceRoot[]
  readonly debounceMs?: number
  readonly watchSourceFactory?: WatchSourceFactory
  readonly now?: () => Date
  readonly onReconcile: (batch: WatchBatch) => void | Promise<void>
  readonly onInvalidatePlans: (
    invalidation: ExternalChangeInvalidation,
  ) => void | Promise<void>
  readonly onFinding?: (finding: WatcherFinding) => void
}
