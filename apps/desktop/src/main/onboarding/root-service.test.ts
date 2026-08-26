import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { FolderAdapter } from "@forge/adapter-folder"
import { canonicalPath } from "@forge/domain"
import { openForgeStore } from "@forge/storage"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { RootService } from "./root-service.js"
import { ForgeRootApprovalSettingsRepository, MemoryRootApprovalSettingsRepository } from "./settings-repository.js"

let temporaryRoot: string

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "forge-root-service-"))
})

afterEach(async () => {
  if (temporaryRoot.includes(`${path.sep}forge-root-service-`)) await rm(temporaryRoot, { recursive: true, force: true })
})

function folderAdapter(defaultIncluded = true) {
  return new FolderAdapter({ roots: [{
    candidateId: "candidate_fixture",
    canonicalPath: canonicalPath(temporaryRoot),
    scope: { kind: "global" },
    access: "read-write",
    writableWithoutElevation: true,
    defaultIncluded,
  }] })
}

function context() {
  return {
    homeDirectory: canonicalPath(temporaryRoot),
    workingDirectory: canonicalPath(temporaryRoot),
    projects: [],
  }
}

describe("approved root onboarding gate", () => {
  it("persists approval documents through the application settings repository", () => {
    const store = openForgeStore({ path: ":memory:" })
    const repository = new ForgeRootApprovalSettingsRepository(store.settings)
    repository.save({
      version: 1,
      updatedAt: "2026-08-26T12:00:00.000Z",
      candidates: [],
      selectedCandidateIds: [],
    })
    expect(new ForgeRootApprovalSettingsRepository(store.settings).load()).toMatchObject({ version: 1, selectedCandidateIds: [] })
    store.close()
  })

  it("does not scan until a non-empty approval is persisted", async () => {
    const settings = new MemoryRootApprovalSettingsRepository()
    const ordering: string[] = []
    const service = new RootService({
      adapters: [folderAdapter()],
      discoveryContext: context(),
      settings,
      picker: { selectDirectory: () => Promise.resolve(null) },
      onApprovalPersisted: (roots) => {
        expect(settings.load()?.selectedCandidateIds).toEqual(["candidate_fixture"])
        expect(roots).toHaveLength(1)
        ordering.push("scan")
        return Promise.resolve()
      },
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    })

    expect(await service.state()).toMatchObject({ status: "required", selectedCandidateIds: ["candidate_fixture"], approvedRoots: [] })
    expect(await service.scanPersistedApproval()).toBe(false)
    expect(ordering).toEqual([])
    await service.approveRoots(["candidate_fixture"])
    expect(ordering).toEqual(["scan"])
    expect((await service.state()).status).toBe("complete")
  })

  it("restores persisted approval and permits startup scan after restart", async () => {
    const settings = new MemoryRootApprovalSettingsRepository()
    const first = new RootService({
      adapters: [folderAdapter()], discoveryContext: context(), settings,
      picker: { selectDirectory: () => Promise.resolve(null) },
    })
    await first.approveRoots(["candidate_fixture"])
    let scans = 0
    const restored = new RootService({
      adapters: [folderAdapter()], discoveryContext: context(), settings,
      picker: { selectDirectory: () => Promise.resolve(null) },
      onApprovalPersisted: () => { scans += 1; return Promise.resolve() },
    })
    expect(await restored.state()).toMatchObject({ status: "complete", selectedCandidateIds: ["candidate_fixture"] })
    expect(await restored.scanPersistedApproval()).toBe(true)
    expect(scans).toBe(1)
  })

  it("accepts only proposed opaque IDs", async () => {
    const service = new RootService({
      adapters: [folderAdapter(false)], discoveryContext: context(),
      settings: new MemoryRootApprovalSettingsRepository(),
      picker: { selectDirectory: () => Promise.resolve(null) },
    })
    await expect(service.approveRoots([temporaryRoot])).rejects.toThrow("Unknown or expired")
    await expect(service.approveRoots([])).rejects.toThrow("At least one")
  })

  it("adds a directory only through the native picker as a user-added candidate", async () => {
    const service = new RootService({
      adapters: [new FolderAdapter({ roots: [] })], discoveryContext: context(),
      settings: new MemoryRootApprovalSettingsRepository(),
      picker: { selectDirectory: () => Promise.resolve(temporaryRoot) },
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    })
    const selected = await service.selectAdditionalRoot("folder")
    expect(selected).toMatchObject({ adapterId: "folder", kind: "user-added", access: "read-write" })
    expect(selected?.candidateId).toMatch(/^candidate_[a-f0-9]{32}$/u)
    expect((await service.state()).selectedCandidateIds).toContain(selected?.candidateId)
    await expect(service.selectAdditionalRoot("codex")).rejects.toThrow("native directory selection")
  })
})
