import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { canonicalPath, evidenced, observed, unknown, type SkillSnapshot } from "@forge/domain"
import { openForgeStore, type ForgeStore } from "@forge/storage"
import { afterEach, describe, expect, it } from "vitest"

import {
  ContentUpdateCoordinator,
  OperationEngine,
  ProjectionContentFileSystem,
  StorageOperationRepository,
  type OperationPlan,
} from "../src/index.js"

const NOW = "2026-08-26T10:00:00.000Z"

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forge-content-update-"))
  temporary.push(directory)
  const rootPath = path.join(directory, "skills")
  const skillPath = path.join(rootPath, "review")
  const entryPath = path.join(skillPath, "SKILL.md")
  const databasePath = path.join(directory, "forge.sqlite")
  const original = "---\nname: review\n---\n\n# Review\n"
  await mkdir(skillPath, { recursive: true })
  await writeFile(entryPath, original, "utf8")
  const snapshot: SkillSnapshot = {
    id: "snapshot_original",
    installationId: "installation_review",
    contentHash: sha256("tree-original"),
    observedAt: NOW,
    name: evidenced("review", observed({ source: "SKILL.md" })),
    description: unknown({ source: "SKILL.md" }),
    declaredVersion: unknown({ source: "SKILL.md" }),
    files: [{ canonicalPath: canonicalPath(entryPath), contentHash: sha256(original), size: Buffer.byteLength(original) }],
    requirements: [],
    findings: [],
    rawSource: original,
  }
  const store = openForgeStore({ path: databasePath })
  store.snapshots.put(snapshot)
  store.snapshots.putProvenance({
    id: "provenance_review",
    installationId: "installation_review",
    observedAt: NOW,
    value: { kind: "local", managedBy: "user" },
  })
  store.projections.replaceInventory({
    projects: [],
    roots: [{
      id: "root_global",
      adapterId: "codex",
      canonicalPath: canonicalPath(rootPath),
      kind: "global",
      access: "read-write",
      discovery: observed({ source: "test" }),
    }],
    installations: [{
      id: "installation_review",
      adapterId: "codex",
      rootId: "root_global",
      canonicalPath: canonicalPath(skillPath),
      entryFile: canonicalPath(entryPath),
      scope: "global",
      snapshotId: snapshot.id,
      provenanceId: "provenance_review",
      access: "read-write",
    }],
  })
  return { databasePath, entryPath, original, store }
}

function coordinator(store: ForgeStore, afterPersist?: (plan: OperationPlan) => Promise<void> | void) {
  const repository = new StorageOperationRepository(store.operations)
  const fileSystem = new ProjectionContentFileSystem(store.projections)
  const engine = new OperationEngine({
    repository,
    fileSystem,
    clock: { now: () => new Date(NOW) },
    ...(afterPersist === undefined ? {} : { afterPersist }),
  })
  const service = new ContentUpdateCoordinator({
    projections: store.projections,
    snapshots: store.snapshots,
    repository,
    fileSystem,
    engine,
    rescan: () => Promise.resolve(),
    now: () => new Date(NOW),
    ids: (() => {
      let next = 0
      return () => `fixture${++next}`
    })(),
  })
  return { repository, engine, service }
}

describe("direct content update", () => {
  it("does not mutate during preview, rejects external changes, and preserves them", async () => {
    const { store, entryPath, original } = await fixture()
    const { engine, service } = coordinator(store)
    await engine.recoverStartup()
    const updated = `${original}\nNueva regla verificable.`
    const plan = await service.plan({
      kind: "update-entry-content",
      installationId: "installation_review",
      expectedSnapshotId: "snapshot_original",
      content: updated,
    })
    expect(await readFile(entryPath, "utf8")).toBe(original)

    await writeFile(entryPath, "external change", "utf8")
    const result = await service.confirm(plan.planId)
    expect(result.status).toBe("conflict")
    expect(await readFile(entryPath, "utf8")).toBe("external change")
    store.close()
  })

  it("rechecks the entry after durable applying and preserves a concurrent edit", async () => {
    const { store, entryPath, original } = await fixture()
    const external = "external edit during applying"
    const { engine, service } = coordinator(store, async (persisted) => {
      if (persisted.state === "applying") await writeFile(entryPath, external, "utf8")
    })
    await engine.recoverStartup()
    const plan = await service.plan({
      kind: "update-entry-content",
      installationId: "installation_review",
      expectedSnapshotId: "snapshot_original",
      content: `${original}\nPlanned content.`,
    })

    await expect(service.confirm(plan.planId)).resolves.toMatchObject({ status: "conflict" })
    expect(await readFile(entryPath, "utf8")).toBe(external)
    expect(await new StorageOperationRepository(store.operations).get(plan.planId)).toMatchObject({
      state: "rolled-back",
      applyStarted: true,
    })
    store.close()
  })

  it("persists an exact snapshot and can undo after reopening SQLite", async () => {
    const { store, databasePath, entryPath, original } = await fixture()
    const first = coordinator(store)
    await first.engine.recoverStartup()
    const updated = `${original}\nNueva regla verificable.`
    const plan = await first.service.plan({
      kind: "update-entry-content",
      installationId: "installation_review",
      expectedSnapshotId: "snapshot_original",
      content: updated,
    })
    expect((await first.service.confirm(plan.planId)).message).toBe("Skill actualizada")
    expect(await readFile(entryPath, "utf8")).toBe(updated)
    store.close()

    const reopened = openForgeStore({ path: databasePath })
    const restarted = coordinator(reopened)
    await restarted.engine.recoverStartup()
    expect(restarted.service.history().items).toEqual([
      expect.objectContaining({ journalId: plan.planId, undoAvailable: true }),
    ])
    expect((await restarted.service.undo(plan.planId)).message).toBe("Actualización deshecha")
    expect(await readFile(entryPath, "utf8")).toBe(original)
    expect(restarted.service.history().items[0]?.undoAvailable).toBe(false)
    reopened.close()
  })
})
