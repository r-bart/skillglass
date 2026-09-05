import { canonicalPath, observed, type SourceRoot } from "@forge/domain"
import { describe, expect, it, vi } from "vitest"

import { ScanCoordinator } from "./scan-coordinator.js"
import type { ScanEvent, ScannableAdapter } from "./types.js"

function root(id: string, access: SourceRoot["access"] = "read-write"): SourceRoot {
  return {
    id,
    adapterId: "fixture",
    canonicalPath: canonicalPath(`/tmp/forge-scanner/${id}`),
    kind: "global",
    access,
    discovery: observed({ source: "test" }),
  }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe("ScanCoordinator", () => {
  it("bounds root concurrency and cooperatively yields during a heavy scan", async () => {
    let active = 0
    let maximumActive = 0
    let timerHadATurn = false
    let observationsBeforeTimer = 0
    setTimeout(() => { timerHadATurn = true }, 0)
    const adapter: ScannableAdapter<number> = {
      id: "fixture",
      async *scanRoot() {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        try {
          for (let index = 0; index < 80; index += 1) {
            if (!timerHadATurn) observationsBeforeTimer += 1
            yield index
          }
        } finally {
          active -= 1
        }
      },
    }
    const yielded = vi.fn(async () => new Promise<void>((resolve) => setImmediate(resolve)))
    const coordinator = new ScanCoordinator({
      adapters: [adapter],
      approvedRoots: [root("a"), root("b"), root("c"), root("d")],
      concurrency: 2,
      yieldEvery: 8,
      yieldControl: yielded,
    })
    const events = await collect(coordinator.scan())

    expect(events.filter(({ kind }) => kind === "observation")).toHaveLength(320)
    expect(maximumActive).toBe(2)
    expect(yielded).toHaveBeenCalled()
    expect(timerHadATurn).toBe(true)
    expect(observationsBeforeTimer).toBeLessThan(320)
    expect(events.at(-1)).toMatchObject({ kind: "progress", progress: { phase: "completed" } })
  })

  it("reports missing and unhandled roots without calling an adapter or aborting", async () => {
    const adapter: ScannableAdapter<number> = {
      id: "fixture",
      scanRoot: vi.fn(async function* () { yield 1 }),
    }
    const unknown = { ...root("unknown"), adapterId: "absent" }
    const coordinator = new ScanCoordinator({
      adapters: [adapter],
      approvedRoots: [root("missing", "missing"), unknown, root("valid")],
    })
    const events = await collect(coordinator.scan())
    const findings = events.filter(
      (event): event is Extract<ScanEvent<number>, { kind: "finding" }> => event.kind === "finding",
    )

    expect(findings.map(({ finding }) => finding.code)).toEqual(expect.arrayContaining([
      "ROOT_MISSING",
      "ADAPTER_NOT_FOUND",
    ]))
    expect(events.filter(({ kind }) => kind === "observation")).toHaveLength(1)
    expect(adapter.scanRoot).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ kind: "progress", progress: { phase: "completed", completedRoots: 3 } })
  })

  it("enriches adapter findings with the approved root identity and keeps valid observations", async () => {
    const adapter: ScannableAdapter<number> = {
      id: "fixture",
      async *scanRoot(_root, context) {
        context?.reportFinding({
          code: "SYMLINK_OUTSIDE_APPROVED_ROOT",
          severity: "warning",
          message: "Skipped external link",
          path: "/tmp/forge-scanner/a/link",
          targetPath: "/tmp/outside/skill",
        })
        yield 1
      },
    }
    const events = await collect(new ScanCoordinator({
      adapters: [adapter],
      approvedRoots: [root("a")],
    }).scan())

    expect(events).toContainEqual({
      kind: "finding",
      finding: {
        code: "SYMLINK_OUTSIDE_APPROVED_ROOT",
        severity: "warning",
        message: "Skipped external link",
        rootId: "a",
        adapterId: "fixture",
        path: "/tmp/forge-scanner/a/link",
        targetPath: "/tmp/outside/skill",
      },
    })
    expect(events.filter(({ kind }) => kind === "observation")).toHaveLength(1)
  })

  it("stops an in-flight scan without converting cancellation into a failure", async () => {
    const adapter: ScannableAdapter<number> = {
      id: "fixture",
      async *scanRoot() {
        for (let index = 0; index < 100; index += 1) yield index
      },
    }
    const coordinator = new ScanCoordinator({ adapters: [adapter], approvedRoots: [root("a")], yieldEvery: 1 })
    const events: ScanEvent<number>[] = []
    for await (const event of coordinator.scan()) {
      events.push(event)
      if (event.kind === "observation") coordinator.stop()
    }
    expect(events.filter(({ kind }) => kind === "observation")).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ kind: "progress", progress: { phase: "stopped" } })
    expect(events.some((event) => event.kind === "finding")).toBe(false)
  })
})
