import type { SkillRuntimeAdapter } from "@forge/adapter-api"
import { canonicalPath, observed, type SourceRoot } from "@forge/domain"
import { openForgeStore } from "@forge/storage"
import { describe, expect, it, vi } from "vitest"

import { ApprovedRootScanService } from "./scan-service.js"

const root: SourceRoot = {
  id: "root_fixture",
  adapterId: "codex",
  canonicalPath: canonicalPath("/virtual/.agents/skills"),
  kind: "global",
  access: "read-only",
  discovery: observed({ source: "fixture" }),
}

const emptyAdapter = {
  id: "codex",
  async *scanRoot() {
    // A read-only empty root is a valid scan result.
  },
} as unknown as SkillRuntimeAdapter

describe("approved-root scan integration", () => {
  it("rejects an unapproved first scan and persists approved roots before projection events", async () => {
    const store = openForgeStore({ path: ":memory:" })
    const onInventoryChanged = vi.fn()
    const service = new ApprovedRootScanService({ codexAdapter: emptyAdapter, projects: [], store, onInventoryChanged })
    await expect(service.scan([])).rejects.toThrow("persisted approval")
    expect(store.projections.listRoots()).toEqual([])
    await service.scan([root])
    expect(store.projections.listRoots()).toEqual([root])
    expect(onInventoryChanged).toHaveBeenCalledWith(expect.objectContaining({ reason: "root-approval", installationIds: [] }))
    store.close()
  })
})
