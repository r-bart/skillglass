import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"

import {
  canonicalPath,
  evidenced,
  observed,
  unknown,
  type ProjectScope,
  type SkillInstallation,
  type SkillSnapshot,
  type SourceRoot,
} from "@forge/domain"
import { afterEach, describe, expect, it } from "vitest"

import { openForgeStore } from "./sqlite-store.js"
import type {
  ForgeStore,
  InventoryProjection,
  RecoveryRecord,
  StoredOperationPlan,
  StoredProvenance,
} from "./types.js"

const HASH_A = "a".repeat(64)
const OBSERVED_AT = "2026-08-26T10:00:00.000Z"
const UPDATED_AT = "2026-08-26T10:01:00.000Z"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function temporaryDatabase(): Readonly<{ directory: string; path: string }> {
  const directory = mkdtempSync(join(tmpdir(), "forge-storage-test-"))
  temporaryDirectories.push(directory)
  return { directory, path: join(directory, "nested", "forge.sqlite") }
}

function fixtures(): Readonly<{
  project: ProjectScope
  root: SourceRoot
  installation: SkillInstallation
  snapshot: SkillSnapshot
  provenance: StoredProvenance
  projection: InventoryProjection
}> {
  const project: ProjectScope = {
    id: "project:one",
    displayName: "Project One",
    canonicalPath: canonicalPath("/workspace/project-one"),
    adapterIds: ["codex"],
  }
  const root: SourceRoot = {
    id: "root:one",
    adapterId: "codex",
    canonicalPath: canonicalPath("/workspace/project-one/.agents/skills"),
    kind: "project",
    projectId: project.id,
    access: "read-write",
    discovery: observed({ source: "fixture", observedAt: OBSERVED_AT }),
  }
  const snapshot: SkillSnapshot = {
    id: "snapshot:one",
    installationId: "installation:one",
    contentHash: HASH_A,
    observedAt: OBSERVED_AT,
    name: evidenced("Example", observed({ source: "frontmatter" })),
    description: unknown({ source: "frontmatter" }),
    declaredVersion: evidenced("1.0.0", observed({ source: "frontmatter" })),
    files: [
      {
        canonicalPath: canonicalPath(
          "/workspace/project-one/.agents/skills/example/SKILL.md",
        ),
        contentHash: HASH_A,
        size: 42,
      },
    ],
    requirements: [
      {
        kind: "runtime",
        name: "codex",
        evidence: observed({ source: "frontmatter" }),
        resolution: "satisfied",
      },
    ],
    findings: [
      {
        code: "example-warning",
        severity: "warning",
        message: "A fixture warning",
        file: canonicalPath(
          "/workspace/project-one/.agents/skills/example/SKILL.md",
        ),
        range: { start: 1, end: 3 },
        source: { adapterId: "codex" },
      },
    ],
    rawSource: "---\nname: Example\n---\nFixture\n",
  }
  const provenance: StoredProvenance = {
    id: "provenance:one",
    installationId: snapshot.installationId,
    observedAt: OBSERVED_AT,
    value: {
      kind: "forge-import",
      installedHash: HASH_A,
      managedBy: "forge",
    },
  }
  const installation: SkillInstallation = {
    id: snapshot.installationId,
    adapterId: "codex",
    rootId: root.id,
    canonicalPath: canonicalPath(
      "/workspace/project-one/.agents/skills/example",
    ),
    entryFile: canonicalPath(
      "/workspace/project-one/.agents/skills/example/SKILL.md",
    ),
    scope: { projectId: project.id },
    snapshotId: snapshot.id,
    provenanceId: provenance.id,
    access: "read-write",
  }
  return {
    project,
    root,
    installation,
    snapshot,
    provenance,
    projection: {
      projects: [project],
      roots: [root],
      installations: [installation],
    },
  }
}

function seedHistory(store: ForgeStore): Readonly<{
  plan: StoredOperationPlan
  recovery: RecoveryRecord
}> {
  const plan: StoredOperationPlan = {
    id: "plan:one",
    kind: "install-local",
    state: "planned",
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    expiresAt: "2026-08-26T10:15:00.000Z",
    adapterId: "codex",
    payload: { targetRootId: "root:one", privatePath: "/not-rendered" },
  }
  store.operations.putPlan(plan)
  store.operations.appendStep({
    id: "journal-step:one",
    planId: plan.id,
    sequence: 0,
    state: "planned",
    createdAt: OBSERVED_AT,
    payload: { expectedHash: HASH_A },
  })
  const recovery: RecoveryRecord = {
    id: "recovery:one",
    planId: plan.id,
    state: "pending",
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    payload: { ownedEntries: ["SKILL.md"] },
  }
  store.operations.putRecovery(recovery)
  return { plan, recovery }
}

describe("openForgeStore", () => {
  it("creates every explicit migration with foreign keys and defensive settings", () => {
    const { path } = temporaryDatabase()
    const store = openForgeStore({ path })
    store.close()

    const database = new DatabaseSync(path)
    const tables = (
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name)
    expect(tables).toEqual(
      expect.arrayContaining([
        "findings",
        "installations",
        "journal_steps",
        "operation_plans",
        "projects",
        "provenance",
        "recovery_records",
        "roots",
        "scope_bindings",
        "effective_skills",
        "schema_migrations",
        "settings",
        "snapshots",
      ]),
    )
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 4 })
    database.exec("PRAGMA foreign_keys = ON")
    expect(() =>
      database
        .prepare(
          `INSERT INTO journal_steps(
             id, plan_id, sequence, state, created_at, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("orphan", "missing-plan", 0, "planned", OBSERVED_AT, "{}"),
    ).toThrow()
    database.close()
  })

  it("round-trips settings, observations, projections, and journal data after reopen", () => {
    const { path } = temporaryDatabase()
    const fixture = fixtures()
    let store = openForgeStore({ path })
    store.settings.set("appearance", { theme: "dark" }, OBSERVED_AT)
    store.snapshots.put(fixture.snapshot)
    store.snapshots.putProvenance(fixture.provenance)
    store.projections.replaceInventory(fixture.projection)
    const history = seedHistory(store)
    expect(
      store.operations.updatePlanState(history.plan.id, "staged", UPDATED_AT),
    ).toBe(true)
    store.close()

    store = openForgeStore({ path })
    expect(store.settings.get("appearance")).toEqual({ theme: "dark" })
    expect(store.projections.listProjects()).toEqual([fixture.project])
    expect(store.projections.listRoots()).toEqual([fixture.root])
    expect(store.projections.getInstallation(fixture.installation.id)).toEqual(
      fixture.installation,
    )
    expect(store.snapshots.get(fixture.snapshot.id)).toEqual(fixture.snapshot)
    expect(store.snapshots.getProvenance(fixture.provenance.id)).toEqual(
      fixture.provenance,
    )
    expect(store.operations.getPlan(history.plan.id)).toEqual({
      ...history.plan,
      state: "staged",
      updatedAt: UPDATED_AT,
    })
    expect(store.operations.listSteps(history.plan.id)).toEqual([
      {
        id: "journal-step:one",
        planId: history.plan.id,
        sequence: 0,
        state: "planned",
        createdAt: OBSERVED_AT,
        payload: { expectedHash: HASH_A },
      },
    ])
    expect(store.operations.listPendingRecovery()).toEqual([history.recovery])
    store.close()
  })

  it("rebuilds inventory atomically without deleting snapshots or journal history", () => {
    const store = openForgeStore({ path: temporaryDatabase().path })
    const fixture = fixtures()
    store.snapshots.put(fixture.snapshot)
    store.snapshots.putProvenance(fixture.provenance)
    store.projections.replaceInventory(fixture.projection)
    const history = seedHistory(store)

    store.projections.replaceInventory({
      projects: [],
      roots: [],
      installations: [],
    })

    expect(store.projections.listInstallations()).toEqual([])
    expect(store.snapshots.get(fixture.snapshot.id)).toEqual(fixture.snapshot)
    expect(store.snapshots.getProvenance(fixture.provenance.id)).toEqual(
      fixture.provenance,
    )
    expect(store.operations.getPlan(history.plan.id)).toEqual(history.plan)
    expect(store.operations.listSteps(history.plan.id)).toHaveLength(1)
    expect(store.operations.getRecovery(history.recovery.id)).toEqual(
      history.recovery,
    )
    store.close()
  })

  it("rolls back a projection rebuild when a foreign-key reference is invalid", () => {
    const store = openForgeStore({ path: temporaryDatabase().path })
    const fixture = fixtures()
    store.snapshots.put(fixture.snapshot)
    store.snapshots.putProvenance(fixture.provenance)
    store.projections.replaceInventory(fixture.projection)

    const invalidRoot: SourceRoot = {
      ...fixture.root,
      id: "root:invalid",
      projectId: "project:missing",
    }
    expect(() =>
      store.projections.replaceInventory({
        projects: [],
        roots: [invalidRoot],
        installations: [],
      }),
    ).toThrow()

    expect(store.projections.listInstallations()).toEqual([
      fixture.installation,
    ])
    expect(store.projections.listRoots()).toEqual([fixture.root])
    store.close()
  })

  it("keeps snapshots immutable and journal sequences unique", () => {
    const store = openForgeStore({ path: temporaryDatabase().path })
    const fixture = fixtures()
    store.snapshots.put(fixture.snapshot)
    expect(() => store.snapshots.put(fixture.snapshot)).toThrow()

    const { plan } = seedHistory(store)
    expect(() =>
      store.operations.appendStep({
        id: "journal-step:duplicate-sequence",
        planId: plan.id,
        sequence: 0,
        state: "staged",
        createdAt: UPDATED_AT,
        payload: {},
      }),
    ).toThrow()
    store.close()
  })

  it("builds a contained inspection DTO from immutable observations", () => {
    const store = openForgeStore({ path: temporaryDatabase().path })
    const fixture = fixtures()
    store.snapshots.put(fixture.snapshot)
    store.snapshots.putProvenance(fixture.provenance)
    store.projections.replaceInventory(fixture.projection)

    expect(store.inventory.inspect(fixture.installation.id)).toMatchObject({
      installation: {
        installationId: fixture.installation.id,
        adapterId: "codex",
        status: {
          validity: "warning",
          runtimeState: "unknown",
          source: "managed",
          update: "unknown",
          usage: "unavailable",
        },
      },
      snapshotId: fixture.snapshot.id,
      locationLabel: "/workspace/project-one/.agents/skills/example",
      entryFile: "SKILL.md",
      rawEntryContent: fixture.snapshot.rawSource,
      files: [{
        relativePath: "SKILL.md",
        byteLength: 42,
        sha256: HASH_A,
        kind: "entry",
      }],
      findings: [{
        code: "example-warning",
        relativeFile: "SKILL.md",
        source: { kind: "adapter", adapterId: "codex" },
      }],
      requirements: [{
        kind: "runtime",
        name: "codex",
        evidence: { kind: "observed" },
        resolution: "satisfied",
      }],
      provenance: {
        id: fixture.provenance.id,
        kind: "forge-import",
        sourceLabel: { state: "unknown", evidence: { kind: "unknown" } },
        managedBy: "forge",
      },
      capabilities: {
        canInstallSibling: true,
        canUpdateFromSource: true,
        canEditEntry: true,
        unavailableReasons: [],
      },
    })
    expect(store.inventory.inspect("installation_missing")).toBeUndefined()
    store.close()
  })

  it("never exposes edit capability for a managed read-only installation", () => {
    const store = openForgeStore({ path: temporaryDatabase().path })
    const fixture = fixtures()
    const managedRoot: SourceRoot = {
      id: fixture.root.id,
      adapterId: fixture.root.adapterId,
      canonicalPath: fixture.root.canonicalPath,
      kind: "managed",
      access: "read-only",
      discovery: fixture.root.discovery,
    }
    const managedInstallation: SkillInstallation = {
      ...fixture.installation,
      scope: "managed",
      access: "read-only",
    }
    store.snapshots.put(fixture.snapshot)
    store.snapshots.putProvenance(fixture.provenance)
    store.projections.replaceInventory({
      projects: [fixture.project],
      roots: [managedRoot],
      installations: [managedInstallation],
    })

    expect(store.inventory.inspect(managedInstallation.id)).toMatchObject({
      installation: { status: { source: "read-only" } },
      capabilities: {
        canEditEntry: false,
        canUpdateFromSource: false,
        unavailableReasons: ["Solo lectura"],
      },
    })
    store.close()
  })
})
