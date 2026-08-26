import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { FolderAdapter } from "@forge/adapter-folder"
import { canonicalInstallationIdentity, canonicalPath, observed, type SourceRoot } from "@forge/domain"
import {
  ApprovedRootInstallTargetPolicy,
  ApprovedRootLocalInstallFileSystem,
  ArtifactFileSystemRouter,
  ContentUpdateCoordinator,
  FileSystemLocalSourceAdmission,
  FileSystemLocalSourceMaterializer,
  LocalInstallCoordinator,
  LocalSourceError,
  LocalSourceProvenanceRepository,
  LocalSourceUpdateCoordinator,
  OperationEngine,
  ProjectionContentFileSystem,
  SourceSelectionService,
  StorageOperationRepository,
} from "@forge/operations"
import type { ApprovedRootInput } from "@forge/scanner"
import { openForgeStore } from "@forge/storage"
import { afterEach, describe, expect, it } from "vitest"

import { PrivateSourceLeaseRepository, recoverPrivateSourceLeases } from "./artifact-leases.js"
import { RefreshableApprovedRootPolicy } from "./root-policy.js"
import { DesktopOperationService } from "./service.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
const fixtureRoot = path.join(repositoryRoot, "packages/test-fixtures/imports/directories/basic-skill")
const temporaryDirectories: string[] = []
const RECOVERY_ROOT_ID = "forge-recovery-v1"

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-main-operations-"))
  temporaryDirectories.push(directory)
  return directory
}

function folderInstallationId(candidate: string): string {
  const identity = canonicalInstallationIdentity({ adapterId: "folder", canonicalPath: canonicalPath(candidate) })
  return `installation_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`
}

async function harness() {
  const targetRoot = await temporaryDirectory()
  const recoveryRoot = await temporaryDirectory()
  const sourceRoot = await temporaryDirectory()
  await cp(fixtureRoot, sourceRoot, { recursive: true })
  const canonicalTargetRoot = await realpath(targetRoot)
  const root: SourceRoot = {
    id: "root_user_skills",
    adapterId: "folder",
    canonicalPath: canonicalPath(canonicalTargetRoot),
    kind: "user-added",
    access: "read-write",
    discovery: observed({ source: "integration-test" }),
  }
  const recovery: ApprovedRootInput = {
    rootId: RECOVERY_ROOT_ID,
    path: recoveryRoot,
    kind: "user-added",
    access: "read-write",
    writableWithoutElevation: true,
  }
  const adapter = new FolderAdapter({ roots: [{
    candidateId: root.id,
    canonicalPath: root.canonicalPath,
    scope: { kind: "global" },
    access: "read-write",
    writableWithoutElevation: true,
  }] })
  const store = openForgeStore({ path: ":memory:" })
  store.projections.replaceInventory({ projects: [], roots: [root], installations: [] })
  const policy = await RefreshableApprovedRootPolicy.create([root], [recovery])
  const repository = new StorageOperationRepository(store.operations)
  const contentFileSystem = new ProjectionContentFileSystem(store.projections, [recovery])
  const treeFileSystem = new ApprovedRootLocalInstallFileSystem(policy)
  const engine = new OperationEngine({
    repository,
    fileSystem: new ArtifactFileSystemRouter(contentFileSystem, treeFileSystem),
  })
  await engine.recoverStartup()
  const leases = new PrivateSourceLeaseRepository(store.settings)
  await recoverPrivateSourceLeases(leases, treeFileSystem)
  const admission = new FileSystemLocalSourceAdmission()
  const selections = new SourceSelectionService({
    admission,
    dialog: { selectDirectory: () => Promise.resolve(sourceRoot), selectZipFile: () => Promise.resolve(undefined) },
  })
  const materializer = new FileSystemLocalSourceMaterializer(policy)
  const provenance = new LocalSourceProvenanceRepository(store.snapshots)
  const installs = new LocalInstallCoordinator({
    selections,
    targets: new ApprovedRootInstallTargetPolicy(policy),
    materializer,
    engine,
    installationId: (_adapterId, candidate) => folderInstallationId(candidate),
    privateSourceRootId: RECOVERY_ROOT_ID,
  })
  const updates = new LocalSourceUpdateCoordinator({
    admission,
    rootPolicy: policy,
    materializer,
    engine,
    provenance,
    recoveryRootId: RECOVERY_ROOT_ID,
  })
  const rescan = async (): Promise<void> => {
    const observations = []
    for await (const observation of adapter.scanRoot(root)) observations.push(observation)
    for (const observation of observations) {
      if (store.snapshots.get(observation.snapshot.id) === undefined) store.snapshots.put(observation.snapshot)
      if (store.snapshots.getProvenance(observation.provenanceId) === undefined) {
        store.snapshots.putProvenance({
          id: observation.provenanceId,
          installationId: observation.installation.id,
          observedAt: observation.snapshot.observedAt,
          value: observation.provenance,
        })
      }
    }
    store.projections.replaceInventory({
      projects: [], roots: [root], installations: observations.map(({ installation }) => installation),
    })
  }
  const contentUpdates = new ContentUpdateCoordinator({
    projections: store.projections,
    snapshots: store.snapshots,
    repository,
    fileSystem: contentFileSystem,
    engine,
    rescan,
    recoveryRootId: RECOVERY_ROOT_ID,
  })
  let id = 0
  const service = new DesktopOperationService({
    selections,
    installs,
    updates,
    contentUpdates,
    repository,
    projections: store.projections,
    settings: store.settings,
    updateObservations: store.updates,
    provenance,
    rootPolicy: policy,
    approvedRoots: () => [root],
    adapterForRoot: () => adapter,
    rescan,
    recoveryRootId: RECOVERY_ROOT_ID,
    leases,
    ids: () => `integration${String(id++)}`,
  })
  return { targetRoot, recoveryRoot, sourceRoot, root, store, service }
}

describe("desktop local operation integration", () => {
  it("installs, discovers an update, applies it, persists provenance, and undoes", async () => {
    const test = await harness()
    const selection = await test.service.selectLocalSource({ kind: "directory" })
    if (selection?.kind !== "directory") throw new Error("directory selection was cancelled")
    const installPlan = await test.service.plan({
      kind: "install-local",
      targetRootId: test.root.id,
      source: {
        kind: "directory",
        selectionToken: selection.selectionToken,
        suggestedName: path.basename(test.sourceRoot),
        treeHash: selection.treeHash,
      },
    })
    const destination = path.join(await realpath(test.targetRoot), path.basename(test.sourceRoot))
    expect(installPlan.destinationLabel).toBe(destination)
    expect(JSON.stringify(installPlan)).not.toContain(test.sourceRoot)
    expect(installPlan.affectedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "create", relativePath: `${path.basename(test.sourceRoot)}/SKILL.md` }),
    ]))

    const installed = await test.service.confirm({ planId: installPlan.planId })
    expect(installed).toMatchObject({ status: "committed", undoAvailable: true })
    expect(await readFile(path.join(destination, "SKILL.md"), "utf8")).toContain("basic-skill")
    expect(test.store.projections.listInstallations()).toHaveLength(1)
    expect(test.store.projections.listInstallations()[0]?.id).toBe(folderInstallationId(destination))
    expect(test.store.inventory.list({ scope: { kind: "all" } }).items[0]?.status.update).toBe("current")
    expect(await test.store.snapshots.getProvenance(test.store.projections.listInstallations()[0]!.provenanceId)).toMatchObject({
      value: { contract: "local-source-v1", kind: "forge-import", managedBy: "forge" },
    })
    expect(await readdir(test.recoveryRoot)).toEqual([])

    await writeFile(path.join(test.sourceRoot, "references/guide.md"), "# Guide v2\n")
    await test.service.refreshUpdates()
    const currentInstallation = test.store.projections.listInstallations()[0]
    if (currentInstallation === undefined) throw new Error("installed skill missing after rescan")
    expect(test.store.inventory.inspect(currentInstallation.id)?.installation.status.update).toBe("available")
    const updatePlan = await test.service.plan({
      kind: "update-from-local",
      installationId: currentInstallation.id,
      expectedSnapshotId: currentInstallation.snapshotId,
    })
    expect(updatePlan.affectedEntries).toEqual([
      expect.objectContaining({ action: "modify", relativePath: `${path.basename(test.sourceRoot)}/references/guide.md` }),
    ])
    const updated = await test.service.confirm({ planId: updatePlan.planId })
    expect(updated.status).toBe("committed")
    expect(await readFile(path.join(destination, "references/guide.md"), "utf8")).toBe("# Guide v2\n")
    expect(test.store.projections.listInstallations()).toHaveLength(1)
    expect(test.store.inventory.inspect(currentInstallation.id)?.installation.status.update).toBe("current")

    const undone = await test.service.undo({ journalId: updatePlan.planId })
    expect(undone.status).toBe("committed")
    expect(await readFile(path.join(destination, "references/guide.md"), "utf8")).toContain("exact LF-terminated")
    expect(test.store.inventory.inspect(currentInstallation.id)?.installation.status.update).toBe("available")
    expect((await test.service.history()).items.map(({ kind }) => kind)).toContain("update-from-local")
  })

  it("returns the Spanish unsafe-path message without exposing a selected ZIP path", async () => {
    const test = await harness()
    const unsafeSelections = new SourceSelectionService({
      dialog: { selectDirectory: () => Promise.resolve(undefined), selectZipFile: () => Promise.resolve("/private/unsafe.zip") },
      admission: { inspect: () => Promise.reject(new LocalSourceError("PATH_INVALID", "Traversal entry")) },
    })
    const service = Object.create(test.service) as DesktopOperationService
    Object.defineProperty(service, "selectLocalSource", {
      value: async () => {
        try { await unsafeSelections.select("zip") } catch (error) {
          if (error instanceof LocalSourceError) throw new Error(`El ZIP contiene una ruta no segura. ${error.message}`, { cause: error })
          throw error
        }
        return null
      },
    })
    await expect(service.selectLocalSource({ kind: "zip" })).rejects.toThrow("ruta no segura")
    await expect(service.selectLocalSource({ kind: "zip" })).rejects.not.toThrow("/private/unsafe.zip")
  })
})
