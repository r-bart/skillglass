import path from "node:path"

import { canonicalPath, type SourceRoot } from "@forge/domain"
import type { WatchBatch, WatchEventKind, WatchSource, WatchSourceFactory } from "@forge/scanner"
import { describe, expect, it, vi } from "vitest"

import { ApprovedRootWatcherService } from "./watcher-service.js"

class MemoryWatchSource implements WatchSource {
  #listener: ((kind: WatchEventKind, path: string) => void) | undefined
  readonly close = vi.fn(() => Promise.resolve())
  readonly #readyError: Error | undefined

  constructor(readyError?: Error) {
    this.#readyError = readyError
  }

  onAll(listener: (kind: WatchEventKind, path: string) => void): void {
    this.#listener = listener
  }

  onError(listener: (error: unknown) => void): void {
    void listener
  }

  ready(): Promise<void> {
    return this.#readyError === undefined ? Promise.resolve() : Promise.reject(this.#readyError)
  }

  emit(kind: WatchEventKind, candidate: string): void {
    this.#listener?.(kind, candidate)
  }
}

function root(id: string, candidate: string, access: SourceRoot["access"] = "read-write"): SourceRoot {
  return {
    id,
    adapterId: "folder",
    canonicalPath: canonicalPath(candidate),
    kind: "global",
    access,
    discovery: { kind: "observed", source: "test" },
  }
}

describe("approved root watcher lifecycle", () => {
  it("replaces native watchers and stops observing removed approvals", async () => {
    const sources: MemoryWatchSource[] = []
    const factory: WatchSourceFactory = () => {
      const source = new MemoryWatchSource()
      sources.push(source)
      return source
    }
    const reconciled: WatchBatch[] = []
    const service = new ApprovedRootWatcherService({
      debounceMs: 0,
      watchSourceFactory: factory,
      onReconcile: (batch) => { reconciled.push(batch) },
      onInvalidatePlans: () => Promise.resolve(),
    })
    const firstRoot = path.resolve("/tmp/forge-watch-first")
    const secondRoot = path.resolve("/tmp/forge-watch-second")

    await service.replaceApprovedRoots([root("first", firstRoot)])
    sources[0]?.emit("change", path.join(firstRoot, "one", "SKILL.md"))
    await service.flush()
    await service.replaceApprovedRoots([root("second", secondRoot)])
    sources[0]?.emit("change", path.join(firstRoot, "late", "SKILL.md"))
    sources[1]?.emit("change", path.join(secondRoot, "two", "SKILL.md"))
    await service.flush()

    expect(sources[0]?.close).toHaveBeenCalledOnce()
    expect(reconciled).toHaveLength(2)
    expect(reconciled[1]).toMatchObject({ rootId: "second", origin: "external" })
    await service.dispose()
    expect(sources[1]?.close).toHaveBeenCalledOnce()
  })

  it("skips missing and denied roots without opening a native watcher", async () => {
    const factory = vi.fn<WatchSourceFactory>()
    const service = new ApprovedRootWatcherService({
      watchSourceFactory: factory,
      onReconcile: () => Promise.resolve(),
      onInvalidatePlans: () => Promise.resolve(),
    })
    await service.replaceApprovedRoots([
      root("missing", path.resolve("/tmp/missing"), "missing"),
      root("denied", path.resolve("/tmp/denied"), "denied"),
    ])
    expect(factory).not.toHaveBeenCalled()
    await service.dispose()
  })

  it("closes a native watcher exactly once when readiness fails", async () => {
    const source = new MemoryWatchSource(new Error("watch startup failed"))
    const service = new ApprovedRootWatcherService({
      watchSourceFactory: () => source,
      onReconcile: () => Promise.resolve(),
      onInvalidatePlans: () => Promise.resolve(),
    })
    await expect(service.replaceApprovedRoots([
      root("failing", path.resolve("/tmp/failing")),
    ])).rejects.toThrow("watch startup failed")
    expect(source.close).toHaveBeenCalledOnce()
    await service.dispose()
    expect(source.close).toHaveBeenCalledOnce()
  })
})
