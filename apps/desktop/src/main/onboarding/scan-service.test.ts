import type { BindingInput, InstallationObservation, ResolutionInput, SkillRuntimeAdapter } from "@forge/adapter-api"
import {
  canonicalPath,
  evidenced,
  observed,
  resolveEffectiveSkill,
  unknown,
  type SourceRoot,
} from "@forge/domain"
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

function observation(id: string): InstallationObservation {
  const installationId = `installation_${id}`
  const snapshotId = `snapshot_${id}`
  const directory = canonicalPath(`/virtual/.agents/skills/${id}`)
  return {
    installation: {
      id: installationId,
      adapterId: "codex",
      rootId: root.id,
      canonicalPath: directory,
      entryFile: canonicalPath(`${directory}/SKILL.md`),
      scope: "global",
      snapshotId,
      provenanceId: `provenance_${id}`,
      access: "read-only",
    },
    snapshot: {
      id: snapshotId,
      installationId,
      contentHash: "a".repeat(64),
      observedAt: "2026-08-26T12:00:00.000Z",
      name: evidenced("duplicate", observed({ source: "SKILL.md" })),
      description: unknown({ source: "SKILL.md" }),
      declaredVersion: unknown({ source: "codex" }),
      files: [], requirements: [], findings: [], rawSource: "---\nname: duplicate\n---\n",
    },
    provenanceId: `provenance_${id}`,
    provenance: { kind: "unknown", managedBy: "unknown" },
    observedScope: "global",
    evidence: observed({ source: "fixture" }),
  }
}

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

  it("persists adapter-owned disabled state and collision evidence without choosing a winner", async () => {
    const observations = [observation("one"), observation("two")]
    const adapter = {
      id: "codex",
      async *scanRoot() {
        yield* observations
      },
      describeBinding({ installation, targetScope }: BindingInput) {
        return Promise.resolve({
          installationId: installation.id,
          targetScope,
          relationship: "owned" as const,
          runtimeState: installation.id === "installation_two" ? "disabled" as const : "unknown" as const,
          evidence: observed({ source: "config.toml" }),
        })
      },
      resolveScope({ targetScope, key, candidates }: ResolutionInput) {
        return Promise.resolve([resolveEffectiveSkill({
          adapterId: "codex",
          targetScope,
          key,
          candidateInstallationIds: candidates.map(({ id }) => id),
          semantics: "supported",
        })])
      },
    } as unknown as SkillRuntimeAdapter
    const store = openForgeStore({ path: ":memory:" })
    const service = new ApprovedRootScanService({ codexAdapter: adapter, projects: [], store })

    await service.scan([root])

    expect(store.inventory.list({ scope: { kind: "global" }, runtimeStates: ["disabled"] }).items)
      .toHaveLength(1)
    const detail = store.inventory.inspect("installation_two")
    expect(detail?.scopeBinding).toMatchObject({ runtimeState: "disabled", evidence: { source: "config.toml" } })
    expect(detail?.precedence).toMatchObject({
      status: "conflict",
      candidateInstallationIds: ["installation_one", "installation_two"],
    })
    expect(detail?.precedence).not.toHaveProperty("winnerInstallationId")
    store.close()
  })

  it("keeps root scan findings in the renderer event instead of dropping them", async () => {
    const store = openForgeStore({ path: ":memory:" })
    const onInventoryChanged = vi.fn()
    const service = new ApprovedRootScanService({ codexAdapter: emptyAdapter, projects: [], store, onInventoryChanged })
    await service.scan([{ ...root, access: "missing" }], "watcher")
    expect(onInventoryChanged).toHaveBeenCalledWith(expect.objectContaining({
      reason: "watcher",
      findings: [expect.objectContaining({
        code: "ROOT_MISSING",
        severity: "warning",
        rootId: root.id,
      })],
    }))
    store.close()
  })

  it("forwards structured adapter omissions through the inventory event", async () => {
    const adapter = {
      ...emptyAdapter,
      async *scanRoot(_root: SourceRoot, context?: { reportFinding(finding: { code: "SYMLINK_OUTSIDE_APPROVED_ROOT"; severity: "warning"; message: string; path: string; targetPath: string }): void }) {
        context?.reportFinding({
          code: "SYMLINK_OUTSIDE_APPROVED_ROOT",
          severity: "warning",
          message: "Skipped external link",
          path: "/virtual/.agents/skills/link",
          targetPath: "/virtual/external/skill",
        })
        yield* []
      },
    } as unknown as SkillRuntimeAdapter
    const store = openForgeStore({ path: ":memory:" })
    const onInventoryChanged = vi.fn()
    await new ApprovedRootScanService({ codexAdapter: adapter, projects: [], store, onInventoryChanged }).scan([root])

    expect(onInventoryChanged).toHaveBeenCalledWith(expect.objectContaining({
      findings: [expect.objectContaining({
        code: "SYMLINK_OUTSIDE_APPROVED_ROOT",
        rootId: root.id,
        targetPath: "/virtual/external/skill",
      })],
    }))
    store.close()
  })
})
