import path from "node:path"

import { canonicalPath, observed, type SourceRoot } from "@forge/domain"
import { describe, expect, it, vi } from "vitest"

import { RootWatcherReconciler } from "./root-watcher-reconciler.js"
import type { WatchEventKind, WatchSource } from "./types.js"

class FakeWatchSource implements WatchSource {
  all: ((kind: WatchEventKind, path: string) => void) | undefined
  error: ((error: unknown) => void) | undefined
  readonly close = vi.fn(() => Promise.resolve())

  onAll(listener: (kind: WatchEventKind, path: string) => void): void { this.all = listener }
  onError(listener: (error: unknown) => void): void { this.error = listener }
  emit(kind: WatchEventKind, candidate: string): void { this.all?.(kind, candidate) }
}

function root(access: SourceRoot["access"] = "read-write"): SourceRoot {
  return {
    id: "root-1",
    adapterId: "fixture",
    canonicalPath: canonicalPath(path.resolve("/tmp/forge-watcher/root")),
    kind: "global",
    access,
    discovery: observed({ source: "test" }),
  }
}

describe("RootWatcherReconciler", () => {
  it("debounces bursts, correlates journal events, and invalidates only external edits", async () => {
    const source = new FakeWatchSource()
    const reconcile = vi.fn()
    const invalidate = vi.fn()
    const watcher = new RootWatcherReconciler({
      approvedRoots: [root()],
      debounceMs: 5,
      watchSourceFactory: () => source,
      onReconcile: reconcile,
      onInvalidatePlans: invalidate,
    })
    watcher.start()
    const ownPath = path.resolve("/tmp/forge-watcher/root/own/SKILL.md")
    const externalPath = path.resolve("/tmp/forge-watcher/root/external/SKILL.md")
    watcher.recordJournalMutation({ journalId: "journal-42", paths: [path.dirname(ownPath)] })
    source.emit("change", ownPath)
    source.emit("change", ownPath)
    source.emit("add", externalPath)
    source.emit("change", externalPath)
    await watcher.flush()

    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(reconcile.mock.calls.map(([batch]) => batch)).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: "self", journalId: "journal-42" }),
      expect.objectContaining({ origin: "external" }),
    ]))
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ paths: [externalPath] }))
    await watcher.dispose()
    expect(source.close).toHaveBeenCalledOnce()
  })

  it("watches a currently missing root and reconciles when it appears", async () => {
    const source = new FakeWatchSource()
    const reconcile = vi.fn()
    const invalidate = vi.fn()
    const missing = root("missing")
    const watcher = new RootWatcherReconciler({
      approvedRoots: [missing],
      debounceMs: 0,
      watchSourceFactory: (paths) => {
        expect(paths).toEqual([missing.canonicalPath])
        return source
      },
      onReconcile: reconcile,
      onInvalidatePlans: invalidate,
    })
    expect(() => watcher.start()).not.toThrow()
    source.emit("addDir", missing.canonicalPath)
    await watcher.flush()
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      rootId: missing.id,
      origin: "external",
      events: [{ kind: "addDir", path: missing.canonicalPath }],
    }))
    expect(invalidate).toHaveBeenCalledOnce()
    await watcher.dispose()
  })

  it("drops pending callbacks and ignores filesystem events after disposal", async () => {
    const source = new FakeWatchSource()
    const reconcile = vi.fn()
    const watcher = new RootWatcherReconciler({
      approvedRoots: [root()],
      debounceMs: 50,
      watchSourceFactory: () => source,
      onReconcile: reconcile,
      onInvalidatePlans: vi.fn(),
    })
    watcher.start()
    source.emit("change", path.resolve("/tmp/forge-watcher/root/SKILL.md"))
    await watcher.dispose()
    source.emit("change", path.resolve("/tmp/forge-watcher/root/late.md"))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(reconcile).not.toHaveBeenCalled()
  })
})
