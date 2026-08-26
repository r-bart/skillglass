import type { SourceRoot } from "@forge/domain"

import { yieldToEventLoop } from "../workers/index.js"
import { AsyncEventQueue } from "./async-event-queue.js"
import type {
  ScanCoordinatorOptions,
  ScanEvent,
  ScanFinding,
  ScanProgress,
  ScannableAdapter,
} from "./types.js"

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Scan scheduling values must be positive integers")
  }
  return value
}

function causeCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function message(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The approved root could not be scanned"
}

/**
 * Coordinates read-only adapter scans. It never writes to a root or persists a
 * projection; consumers decide what to do with the streamed observations.
 */
export class ScanCoordinator<TObservation> {
  readonly #adapters: ReadonlyMap<string, ScannableAdapter<TObservation>>
  readonly #roots: readonly SourceRoot[]
  readonly #concurrency: number
  readonly #yieldEvery: number
  readonly #yieldControl: () => Promise<void>
  #state: "idle" | "scanning" | "stopped" | "disposed" = "idle"

  constructor(options: ScanCoordinatorOptions<TObservation>) {
    const adapters = new Map<string, ScannableAdapter<TObservation>>()
    for (const adapter of options.adapters) {
      if (adapters.has(adapter.id)) throw new TypeError(`Duplicate scan adapter: ${adapter.id}`)
      adapters.set(adapter.id, adapter)
    }
    this.#adapters = adapters
    this.#roots = Object.freeze([...options.approvedRoots])
    this.#concurrency = positiveInteger(options.concurrency, 2)
    this.#yieldEvery = positiveInteger(options.yieldEvery, 25)
    this.#yieldControl = options.yieldControl ?? yieldToEventLoop
  }

  async *scan(): AsyncIterable<ScanEvent<TObservation>> {
    if (this.#state !== "idle") throw new Error("A scan coordinator can only be started once")
    this.#state = "scanning"
    const queue = new AsyncEventQueue<ScanEvent<TObservation>>()
    let cursor = 0
    let completedRoots = 0
    let activeRoots = 0
    let observationCount = 0
    let findingCount = 0
    let workSinceYield = 0

    const progress = (phase: ScanProgress["phase"], rootId?: string): void => {
      queue.push({
        kind: "progress",
        progress: {
          phase,
          totalRoots: this.#roots.length,
          completedRoots,
          activeRoots,
          observationCount,
          findingCount,
          ...(rootId === undefined ? {} : { rootId }),
        },
      })
    }
    const finding = (value: ScanFinding): void => {
      findingCount += 1
      queue.push({ kind: "finding", finding: value })
    }
    const cooperativeYield = async (): Promise<void> => {
      workSinceYield += 1
      if (workSinceYield < this.#yieldEvery) return
      workSinceYield = 0
      await this.#yieldControl()
    }

    const scanRoot = async (root: SourceRoot): Promise<void> => {
      activeRoots += 1
      progress("root-started", root.id)
      try {
        if (root.access === "missing" || root.access === "denied") {
          finding({
            code: root.access === "missing" ? "ROOT_MISSING" : "ROOT_DENIED",
            severity: "warning",
            message: root.access === "missing"
              ? "The approved root is currently missing; it was skipped safely"
              : "The approved root is not readable without elevation; it was skipped safely",
            rootId: root.id,
            adapterId: root.adapterId,
            path: root.canonicalPath,
          })
          return
        }
        const adapter = this.#adapters.get(root.adapterId)
        if (adapter === undefined) {
          finding({
            code: "ADAPTER_NOT_FOUND",
            severity: "error",
            message: `No adapter is registered for ${root.adapterId}`,
            rootId: root.id,
            adapterId: root.adapterId,
            path: root.canonicalPath,
          })
          return
        }
        try {
          for await (const observation of adapter.scanRoot(root)) {
            if (this.#state !== "scanning") break
            observationCount += 1
            queue.push({
              kind: "observation",
              rootId: root.id,
              adapterId: adapter.id,
              observation,
            })
            await cooperativeYield()
          }
        } catch (error) {
          const code = causeCode(error)
          finding({
            code: "ROOT_SCAN_FAILED",
            severity: "error",
            message: message(error),
            rootId: root.id,
            adapterId: root.adapterId,
            path: root.canonicalPath,
            ...(code === undefined ? {} : { causeCode: code }),
          })
        }
      } finally {
        activeRoots -= 1
        completedRoots += 1
        progress("root-completed", root.id)
        await cooperativeYield()
      }
    }

    const worker = async (): Promise<void> => {
      while (this.#state === "scanning") {
        const index = cursor
        cursor += 1
        const root = this.#roots[index]
        if (root === undefined) return
        await scanRoot(root)
      }
    }

    progress("started")
    const workerCount = Math.min(this.#concurrency, Math.max(this.#roots.length, 1))
    void Promise.all(Array.from({ length: workerCount }, () => worker()))
      .then(() => {
        progress(this.#state === "scanning" ? "completed" : "stopped")
      })
      .finally(() => queue.close())

    try {
      yield* queue
    } finally {
      if (this.#state === "scanning") this.stop()
    }
  }

  stop(): void {
    if (this.#state === "scanning" || this.#state === "idle") this.#state = "stopped"
  }

  dispose(): void {
    this.stop()
    this.#state = "disposed"
  }
}
