import { cp, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { AdapterOperationPlan } from "@forge/adapter-api"
import { FilesystemApprovedRootPolicy } from "@forge/scanner"
import type { StoredProvenance } from "@forge/storage"
import { afterEach, describe, expect, it } from "vitest"

import {
  ApprovedRootLocalSourceUpdateFileSystem,
  FileSystemLocalSourceAdmission,
  FileSystemLocalSourceMaterializer,
  LocalSourceProvenanceRepository,
  LocalSourceUpdateCoordinator,
  MemoryOperationRepository,
  OperationEngine,
  inspectDirectorySource,
  inspectStrictTree,
  type LocalImportProvenanceV1,
  type LocalSourceUpdateObservation,
} from "../src/index.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fixtureRoot = path.join(repositoryRoot, "packages/test-fixtures/imports/directories/basic-skill")
const temporaryDirectories: string[] = []
const NOW = "2026-08-26T12:00:00.000Z"

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-local-update-"))
  temporaryDirectories.push(directory)
  return directory
}

class MemoryProvenanceStore {
  readonly records = new Map<string, StoredProvenance>()

  putProvenance(provenance: StoredProvenance): void {
    this.records.set(provenance.id, structuredClone(provenance))
  }

  getProvenance(id: string): StoredProvenance | undefined {
    const provenance = this.records.get(id)
    return provenance === undefined ? undefined : structuredClone(provenance)
  }
}

function updateAdapterPlan(observation: LocalSourceUpdateObservation, planId = "adapter-plan-local-update"): AdapterOperationPlan {
  if (observation.installedTreeHash === undefined || observation.sourceTreeHash === undefined) {
    throw new Error("available observation must include both hashes")
  }
  return {
    capability: "updateWritableInstallation",
    operation: {
      planId,
      kind: "update-from-local",
      status: "planned",
      createdAt: NOW,
      expiresAt: "2026-08-26T12:14:00.000Z",
      adapterId: "codex",
      installationIds: [observation.installationId],
      targetRootId: "skills-root",
      affectedScopes: [{ kind: "global" }],
      affectedEntries: [{ action: "modify", rootId: "skills-root", relativePath: "installed-skill" }],
      preconditions: [], conflicts: [], warnings: [], undo: "persistent",
      summary: "Update from verified local source",
    },
    steps: [{
      kind: "replace-installation",
      rootId: "skills-root",
      relativePath: "installed-skill",
      expectedBeforeHash: observation.installedTreeHash,
      sourceTreeHash: observation.sourceTreeHash,
    }],
    postconditions: [{
      kind: "tree-hash-equals",
      rootId: "skills-root",
      relativePath: "installed-skill",
      expectedHash: observation.sourceTreeHash,
    }],
  }
}

async function updateHarness() {
  const sourcePath = await temporaryDirectory()
  await cp(fixtureRoot, sourcePath, { recursive: true })
  await writeFile(path.join(sourcePath, "obsolete.txt"), "remove me\n")
  const targetRoot = await temporaryDirectory()
  const destination = path.join(targetRoot, "installed-skill")
  await cp(sourcePath, destination, { recursive: true })
  const policy = await FilesystemApprovedRootPolicy.create([{
    rootId: "skills-root", path: targetRoot, kind: "global", access: "read-write", writableWithoutElevation: true,
  }])
  const original = await inspectDirectorySource(sourcePath, NOW)
  const installed = await inspectStrictTree(destination)
  const provenance: LocalImportProvenanceV1 = {
    contract: "local-source-v1",
    kind: "forge-import",
    managedBy: "forge",
    sourceKind: "directory",
    sourceLocator: await realpath(sourcePath),
    sourceObservedAt: NOW,
    sourceIdentity: original.identity,
    sourceTreeHash: original.manifest.treeHash,
    ignoredEntries: original.ignoredEntries,
    sourceManifest: original.manifest,
    targetRootId: "skills-root",
    installationId: "installation-local-one",
    destinationCanonicalPath: await realpath(destination),
    createdByJournalId: "journal-install-v1",
    installedHash: installed.manifest.treeHash,
    installedTreeHash: installed.manifest.treeHash,
    installedManifest: installed.manifest,
  }
  const operationRepository = new MemoryOperationRepository()
  const fileSystem = new ApprovedRootLocalSourceUpdateFileSystem(policy)
  const engine = new OperationEngine({
    repository: operationRepository,
    fileSystem,
    clock: { now: () => new Date(NOW) },
    ids: { next: (() => { let id = 0; return () => `update-event-${String(id++)}` })() },
  })
  await engine.recoverStartup()
  const store = new MemoryProvenanceStore()
  const provenanceRepository = new LocalSourceProvenanceRepository(store)
  provenanceRepository.persist("provenance-v1", provenance)
  const coordinator = new LocalSourceUpdateCoordinator({
    admission: new FileSystemLocalSourceAdmission(),
    rootPolicy: policy,
    materializer: new FileSystemLocalSourceMaterializer(policy),
    engine,
    provenance: provenanceRepository,
    now: () => new Date(NOW),
    mintObservationId: (() => { let id = 0; return () => `opaque-observation-${String(id++)}` })(),
  })
  const makeV2 = async (): Promise<void> => {
    await writeFile(path.join(sourcePath, "references/guide.md"), "# Guide v2\n\nVerified update.\n")
    await writeFile(path.join(sourcePath, "new-reference.md"), "new\n")
    await unlink(path.join(sourcePath, "obsolete.txt"))
  }
  return {
    sourcePath, targetRoot, destination, policy, provenance, operationRepository, store,
    provenanceRepository, coordinator, makeV2,
  }
}

describe("local-source update discovery", () => {
  it("reports current and then available with source/current/base hashes", async () => {
    const harness = await updateHarness()
    await expect(harness.coordinator.observePersisted("provenance-v1", "explicit")).resolves.toMatchObject({
      state: "current",
      trigger: "explicit",
      baseTreeHash: harness.provenance.installedTreeHash,
      installedTreeHash: harness.provenance.installedTreeHash,
      sourceTreeHash: harness.provenance.sourceTreeHash,
    })
    await harness.makeV2()
    const available = await harness.coordinator.observe(harness.provenance, "watcher")
    expect(available).toMatchObject({
      state: "available",
      trigger: "watcher",
      baseTreeHash: harness.provenance.installedTreeHash,
      installedTreeHash: harness.provenance.installedTreeHash,
    })
    expect(available.sourceTreeHash).not.toBe(harness.provenance.sourceTreeHash)
    expect(available.observationId).not.toContain(harness.sourcePath)
  })

  it("reports diverged and refuses planning after local installation edits", async () => {
    const harness = await updateHarness()
    await harness.makeV2()
    await writeFile(path.join(harness.destination, "references/guide.md"), "local edit\n")
    const observation = await harness.coordinator.observe(harness.provenance, "explicit")
    expect(observation).toMatchObject({ state: "diverged", reason: expect.stringContaining("recorded base") })
    await expect(harness.coordinator.prepare({
      observationId: observation.observationId,
      adapterPlan: updateAdapterPlan({ ...observation, installedTreeHash: observation.installedTreeHash ?? harness.provenance.installedTreeHash }),
      journalId: "journal-refused",
      provenanceId: "provenance-refused",
    })).rejects.toMatchObject({ code: "UPDATE_CONFLICT" })
    expect(await readFile(path.join(harness.destination, "references/guide.md"), "utf8")).toBe("local edit\n")
  })

  it("reports unknown when the persisted source is missing", async () => {
    const harness = await updateHarness()
    await rm(harness.sourcePath, { recursive: true })
    const observation = await harness.coordinator.observe(harness.provenance, "watcher")
    expect(observation).toMatchObject({ state: "unknown" })
    expect(observation).not.toHaveProperty("sourceTreeHash")
  })

  it("reports unknown when a source path now names a replacement object", async () => {
    const harness = await updateHarness()
    const moved = `${harness.sourcePath}-moved`
    temporaryDirectories.push(moved)
    await cp(harness.sourcePath, moved, { recursive: true })
    await rm(harness.sourcePath, { recursive: true })
    await cp(moved, harness.sourcePath, { recursive: true })
    await expect(harness.coordinator.observe(harness.provenance, "explicit")).resolves.toMatchObject({
      state: "unknown",
      reason: expect.stringContaining("replaced"),
    })
  })
})

describe("local-source update apply", () => {
  it("refuses a source change after preview without touching the destination", async () => {
    const harness = await updateHarness()
    await harness.makeV2()
    const observation = await harness.coordinator.observe(harness.provenance, "explicit")
    const prepared = await harness.coordinator.prepare({
      observationId: observation.observationId,
      adapterPlan: updateAdapterPlan(observation, "update-stale-source"),
      journalId: "journal-stale-source",
      provenanceId: "provenance-stale-source",
    })
    await writeFile(path.join(harness.sourcePath, "references/guide.md"), "changed after preview\n")
    await expect(harness.coordinator.execute(prepared)).rejects.toMatchObject({ code: "UPDATE_CONFLICT" })
    expect(await readFile(path.join(harness.destination, "references/guide.md"), "utf8")).toContain("exact LF-terminated")
    expect(harness.store.getProvenance("provenance-stale-source")).toBeUndefined()
  })

  it("applies a verified complete diff, persists provenance, and undoes after restart", async () => {
    const harness = await updateHarness()
    await harness.makeV2()
    const admittedV2 = await inspectDirectorySource(harness.sourcePath, NOW)
    const observation = await harness.coordinator.observePersisted("provenance-v1", "explicit")
    const prepared = await harness.coordinator.prepare({
      observationId: observation.observationId,
      adapterPlan: updateAdapterPlan(observation, "update-verified"),
      journalId: "journal-update-v2",
      provenanceId: "provenance-v2",
    })
    expect(prepared.preview).toEqual([
      expect.objectContaining({ action: "create", relativePath: "installed-skill/new-reference.md" }),
      expect.objectContaining({ action: "delete", relativePath: "installed-skill/obsolete.txt" }),
      expect.objectContaining({ action: "modify", relativePath: "installed-skill/references/guide.md" }),
    ])
    const executed = await harness.coordinator.execute(prepared)
    expect(executed.plan).toMatchObject({ state: "committed", undoStatus: "available" })
    expect(await inspectStrictTree(harness.destination)).toMatchObject({ manifest: admittedV2.manifest })
    expect(executed.provenance).toMatchObject({
      kind: "forge-import",
      managedBy: "forge",
      sourceTreeHash: admittedV2.manifest.treeHash,
      installedHash: admittedV2.manifest.treeHash,
      installedTreeHash: admittedV2.manifest.treeHash,
      previousInstalledTreeHash: harness.provenance.installedTreeHash,
      updatedByJournalId: "journal-update-v2",
    })

    const reconstructed = new LocalSourceProvenanceRepository(harness.store).reconstruct("provenance-v2")
    expect(reconstructed).toEqual(executed.provenance)

    const restartedPolicy = await FilesystemApprovedRootPolicy.create([{
      rootId: "skills-root", path: harness.targetRoot, kind: "global", access: "read-write", writableWithoutElevation: true,
    }])
    const restarted = new OperationEngine({
      repository: harness.operationRepository,
      fileSystem: new ApprovedRootLocalSourceUpdateFileSystem(restartedPolicy),
      clock: { now: () => new Date(NOW) },
      ids: { next: () => "restart-update-event" },
    })
    await restarted.recoverStartup()
    await expect(restarted.undo(prepared.plan.id)).resolves.toMatchObject({ undoStatus: "completed" })
    expect((await inspectStrictTree(harness.destination)).manifest).toEqual(harness.provenance.installedManifest)
    await expect(readFile(path.join(harness.destination, "new-reference.md"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(path.join(harness.destination, "obsolete.txt"), "utf8")).toBe("remove me\n")
  })

  it("rejects a mismatched adapter replacement without creating a plan", async () => {
    const harness = await updateHarness()
    await harness.makeV2()
    const observation = await harness.coordinator.observe(harness.provenance, "explicit")
    const adapter = updateAdapterPlan(observation, "update-adapter-conflict")
    const admittedStep = adapter.steps[0]
    if (admittedStep?.kind !== "replace-installation") throw new Error("test adapter must replace an installation")
    await expect(harness.coordinator.prepare({
      observationId: observation.observationId,
      adapterPlan: { ...adapter, steps: [{ ...admittedStep, sourceTreeHash: "f".repeat(64) }] },
      journalId: "journal-adapter-conflict",
      provenanceId: "provenance-adapter-conflict",
    })).rejects.toMatchObject({ code: "UPDATE_CONFLICT" })
    expect(await harness.operationRepository.get("update-adapter-conflict")).toBeUndefined()
  })
})
