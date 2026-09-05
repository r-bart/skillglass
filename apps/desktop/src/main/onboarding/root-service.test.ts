import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { FolderAdapter } from "@forge/adapter-folder"
import type { DiscoveryContext, SkillRuntimeAdapter } from "@forge/adapter-api"
import { canonicalPath, observed, type ProjectScope } from "@forge/domain"
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

function folderAdapter(defaultIncluded = true, suggestCompatibleCodexSkillsRoot = false) {
  return new FolderAdapter({ roots: [{
    candidateId: "candidate_fixture",
    canonicalPath: canonicalPath(temporaryRoot),
    scope: { kind: "global" },
    access: "read-write",
    writableWithoutElevation: true,
    defaultIncluded,
  }], suggestCompatibleCodexSkillsRoot })
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

  it("can propose roots when the discovery home is a virtual missing path", async () => {
    const service = new RootService({
      adapters: [folderAdapter()],
      discoveryContext: {
        ...context(),
        homeDirectory: canonicalPath(path.join(temporaryRoot, "missing", "home")),
      },
      settings: new MemoryRootApprovalSettingsRepository(),
      picker: { selectDirectory: () => Promise.resolve(null) },
    })

    await expect(service.state()).resolves.toMatchObject({
      status: "required",
      proposedRoots: [expect.objectContaining({ candidateId: "candidate_fixture" })],
    })
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

  it("proposes an existing compatible Codex folder without adding it to a persisted approval", async () => {
    const compatible = path.join(temporaryRoot, ".codex", "skills")
    await mkdir(compatible, { recursive: true })
    const settings = new MemoryRootApprovalSettingsRepository()
    const first = new RootService({
      adapters: [folderAdapter()], discoveryContext: context(), settings,
      picker: { selectDirectory: () => Promise.resolve(null) },
    })
    await first.approveRoots(["candidate_fixture"])
    const scans: Array<readonly { canonicalPath: string }[]> = []
    const restored = new RootService({
      adapters: [folderAdapter(true, true)],
      discoveryContext: context(), settings,
      picker: { selectDirectory: () => Promise.resolve(null) },
      onApprovalPersisted: (roots) => { scans.push(roots); return Promise.resolve() },
    })

    const state = await restored.state()
    expect(state.proposedRoots).toContainEqual(expect.objectContaining({
      adapterId: "folder",
      displayName: "Carpeta compatible con SKILL.md · Añadida por ti",
      displayPath: await realpath(compatible),
    }))
    expect(state.selectedCandidateIds).toEqual(["candidate_fixture"])
    await restored.scanPersistedApproval()
    expect(scans).toHaveLength(1)
    expect(scans[0]).toHaveLength(1)
    expect(scans[0]?.[0]?.canonicalPath).toBe(canonicalPath(temporaryRoot))
  })

  it("restores a disappeared approved root as missing without aborting startup", async () => {
    const persistedRoot = path.join(temporaryRoot, "persisted-root")
    await mkdir(persistedRoot)
    const settings = new MemoryRootApprovalSettingsRepository()
    const first = new RootService({
      adapters: [new FolderAdapter({ roots: [{
        candidateId: "candidate_persisted",
        canonicalPath: canonicalPath(persistedRoot),
        scope: { kind: "global" },
        access: "read-write",
        writableWithoutElevation: true,
        defaultIncluded: true,
      }] })],
      discoveryContext: context(),
      settings,
      picker: { selectDirectory: () => Promise.resolve(null) },
    })
    await first.approveRoots(["candidate_persisted"])
    await rm(persistedRoot, { recursive: true })
    const scans: Array<readonly { access: string }[]> = []
    const restored = new RootService({
      adapters: [new FolderAdapter({ roots: [] })],
      discoveryContext: context(),
      settings,
      picker: { selectDirectory: () => Promise.resolve(null) },
      onApprovalPersisted: (roots) => { scans.push(roots); return Promise.resolve() },
    })

    await expect(restored.state()).resolves.toMatchObject({
      status: "complete",
      approvedRoots: [{ access: "missing", writableWithoutElevation: false }],
    })
    await expect(restored.scanPersistedApproval()).resolves.toBe(true)
    expect(scans.at(-1)).toMatchObject([{ access: "missing" }])
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

  it("keeps a manually selected provider plugin folder read-only after canonicalization", async () => {
    const pluginFolder = path.join(temporaryRoot, ".codex", "plugins", "cache", "example")
    await mkdir(pluginFolder, { recursive: true })
    const service = new RootService({
      adapters: [new FolderAdapter({ roots: [] })], discoveryContext: context(),
      settings: new MemoryRootApprovalSettingsRepository(),
      picker: { selectDirectory: () => Promise.resolve(pluginFolder) },
    })

    await expect(service.selectAdditionalRoot("folder")).resolves.toMatchObject({
      kind: "managed",
      access: "read-only",
      writableWithoutElevation: false,
    })
  })

  it("refreshes project root proposals without scanning when the native project picker persists a project", async () => {
    const projectRoot = path.join(temporaryRoot, "Acme")
    const skillsRoot = path.join(projectRoot, ".agents", "skills")
    await mkdir(skillsRoot, { recursive: true })
    let projects: readonly ProjectScope[] = []
    let scans = 0
    const adapter = {
      id: "codex",
      displayName: "Codex",
      discoverRoots: (discovery: DiscoveryContext) => Promise.resolve(discovery.projects.map((project) => ({
        candidateId: "candidate_project",
        adapterId: "codex",
        canonicalPath: canonicalPath(skillsRoot),
        kind: "project" as const,
        projectPath: project.canonicalPath,
        access: "read-write" as const,
        writableWithoutElevation: true,
        evidence: observed({ source: "test-project" }),
        defaultIncluded: true,
      }))),
    } as unknown as SkillRuntimeAdapter
    const service = new RootService({
      adapters: [adapter],
      discoveryContext: () => ({ ...context(), projects }),
      settings: new MemoryRootApprovalSettingsRepository(),
      picker: { selectDirectory: () => Promise.resolve(null) },
      projectPicker: {
        selectProject: () => {
          projects = [{
            id: "project_acme",
            displayName: "Acme",
            canonicalPath: canonicalPath(projectRoot),
            adapterIds: ["codex"],
          }]
          return Promise.resolve(true)
        },
      },
      onApprovalPersisted: () => { scans += 1; return Promise.resolve() },
    })

    expect((await service.state()).proposedRoots).toEqual([])
    await expect(service.selectProject()).resolves.toMatchObject({
      status: "required",
      proposedRoots: [{ kind: "project", displayPath: skillsRoot }],
      selectedCandidateIds: ["candidate_project"],
    })
    expect(scans).toBe(0)
  })
})
