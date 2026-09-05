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
  OperationInterruptedError,
  OperationEngine,
  ProjectionContentFileSystem,
  SourceSelectionService,
  StorageOperationRepository,
  type OperationPlan,
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
const openStores: ReturnType<typeof openForgeStore>[] = []
const RECOVERY_ROOT_ID = "forge-recovery-v1"

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close()
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

interface HarnessOptions {
  readonly targetRoot?: string
  readonly recoveryRoot?: string
  readonly sourceRoot?: string
  readonly databasePath?: string
  readonly afterPersist?: (plan: OperationPlan) => Promise<void> | void
  readonly onSkillAdded?: (installationIds: readonly string[]) => void
}

async function harness(options: HarnessOptions = {}) {
  const targetRoot = options.targetRoot ?? await temporaryDirectory()
  const recoveryRoot = options.recoveryRoot ?? await temporaryDirectory()
  const sourceRoot = options.sourceRoot ?? await temporaryDirectory()
  if (options.sourceRoot === undefined) await cp(fixtureRoot, sourceRoot, { recursive: true })
  const databasePath = options.databasePath ?? path.join(await temporaryDirectory(), "forge.sqlite")
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
  const store = openForgeStore({ path: databasePath })
  openStores.push(store)
  store.projections.replaceInventory({ projects: [], roots: [root], installations: [] })
  const policy = await RefreshableApprovedRootPolicy.create([root], [recovery])
  const repository = new StorageOperationRepository(store.operations)
  const contentFileSystem = new ProjectionContentFileSystem(store.projections, [recovery])
  const treeFileSystem = new ApprovedRootLocalInstallFileSystem(policy)
  const operationFileSystem = new ArtifactFileSystemRouter(contentFileSystem, treeFileSystem)
  const engine = new OperationEngine({
    repository,
    fileSystem: operationFileSystem,
    ...(options.afterPersist === undefined ? {} : { afterPersist: options.afterPersist }),
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
    fileSystem: operationFileSystem,
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
    ...(options.onSkillAdded === undefined ? {} : { onSkillAdded: options.onSkillAdded }),
  })
  return { targetRoot, recoveryRoot, sourceRoot, databasePath, root, store, service, rescan }
}

describe("desktop local operation integration", () => {
  it("reports a confirmed filesystem operation as active until its durable work finishes", async () => {
    let releaseApplying: (() => void) | undefined
    let reachedApplying: (() => void) | undefined
    const applying = new Promise<void>((resolve) => { reachedApplying = resolve })
    const hold = new Promise<void>((resolve) => { releaseApplying = resolve })
    const test = await harness({
      afterPersist: async (persisted) => {
        if (persisted.state !== "applying") return
        reachedApplying?.()
        await hold
      },
    })
    const content = "---\nname: close-safe\ndescription: Close safely\n---\n\n# Close safe\n"
    const plan = await test.service.plan({
      kind: "create-skill",
      targetRootId: test.root.id,
      skillKey: "close-safe",
      content,
    })

    const confirmation = test.service.confirm({ planId: plan.planId })
    await applying
    expect(test.service.hasActiveConfirmedOperation()).toBe(true)
    releaseApplying?.()
    await expect(confirmation).resolves.toMatchObject({ status: "committed" })
    expect(test.service.hasActiveConfirmedOperation()).toBe(false)
    test.store.close()
  })

  it("creates a reviewed SKILL.md atomically, returns the observed installation, and can undo it", async () => {
    const added: string[][] = []
    const test = await harness({ onSkillAdded: (installationIds) => added.push([...installationIds]) })
    const content = "---\nname: contract-review\ndescription: Review contracts safely\n---\n\n# Contract review\n"
    const destination = path.join(test.targetRoot, "contract-review")

    const plan = await test.service.plan({
      kind: "create-skill",
      targetRootId: test.root.id,
      skillKey: "contract-review",
      content,
    })

    await expect(readFile(path.join(destination, "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    expect(plan).toMatchObject({
      kind: "create-skill",
      targetRootId: test.root.id,
      affectedEntries: [{ action: "create", relativePath: "contract-review/SKILL.md" }],
    })

    const created = await test.service.confirm({ planId: plan.planId })
    expect(created).toMatchObject({ status: "committed", message: "Skill creada", undoAvailable: true })
    expect(created.installationIds).toHaveLength(1)
    expect(added).toEqual([[created.installationIds[0]]])
    expect(await readFile(path.join(destination, "SKILL.md"), "utf8")).toBe(content)
    expect((await test.service.history()).items).toContainEqual(expect.objectContaining({
      journalId: plan.planId,
      kind: "create-skill",
      undoAvailable: true,
    }))

    await expect(test.service.undo({ journalId: plan.planId })).resolves.toMatchObject({
      status: "committed",
      message: "Creación deshecha",
    })
    await expect(readFile(path.join(destination, "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    test.store.close()
  })

  it("invalidates a persisted preview when a watcher reports an overlapping external change", async () => {
    const test = await harness()
    const selection = await test.service.selectLocalSource({ kind: "directory" })
    if (selection?.kind !== "directory") throw new Error("directory selection was cancelled")
    const suggestedName = path.basename(test.sourceRoot)
    const plan = await test.service.plan({
      kind: "install-local",
      targetRootId: test.root.id,
      source: {
        kind: "directory",
        selectionToken: selection.selectionToken,
        suggestedName,
        treeHash: selection.treeHash,
      },
    })
    expect(test.service.invalidatePlansForExternalChange({
      rootId: test.root.id,
      paths: [path.join(test.root.canonicalPath, suggestedName, "SKILL.md")],
      observedAt: "2026-08-26T12:00:00.000Z",
    })).toEqual([plan.planId])

    const result = await test.service.confirm({ planId: plan.planId })
    expect(result).toMatchObject({ status: "stale", undoAvailable: false })
    await expect(readFile(path.join(test.targetRoot, suggestedName, "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
    test.store.close()
  })

  it("installs, discovers an update, applies it, persists provenance, and undoes", async () => {
    const added: string[][] = []
    const test = await harness({ onSkillAdded: (installationIds) => added.push([...installationIds]) })
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
    expect(added).toEqual([[installed.installationIds[0]]])
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

  it("reconstructs committed install and source-update provenance/base rows after SQLite restart", async () => {
    let interruptedInstall = false
    const first = await harness({
      afterPersist: (persisted) => {
        if (!interruptedInstall && persisted.kind === "install" && persisted.state === "committed") {
          interruptedInstall = true
          throw new OperationInterruptedError("crash after durable install commit")
        }
      },
    })
    const selection = await first.service.selectLocalSource({ kind: "directory" })
    if (selection?.kind !== "directory") throw new Error("directory selection was cancelled")
    const installPlan = await first.service.plan({
      kind: "install-local",
      targetRootId: first.root.id,
      source: {
        kind: "directory",
        selectionToken: selection.selectionToken,
        suggestedName: path.basename(first.sourceRoot),
        treeHash: selection.treeHash,
      },
    })
    expect(await first.service.confirm({ planId: installPlan.planId })).toMatchObject({ status: "failed" })
    expect(first.store.operations.getPlan(installPlan.planId)?.state).toBe("committed")
    first.store.close()

    let interruptedUpdate = false
    const second = await harness({
      targetRoot: first.targetRoot,
      recoveryRoot: first.recoveryRoot,
      sourceRoot: first.sourceRoot,
      databasePath: first.databasePath,
      afterPersist: (persisted) => {
        if (!interruptedUpdate && persisted.kind === "update-source" && persisted.state === "committed") {
          interruptedUpdate = true
          throw new OperationInterruptedError("crash after durable source-update commit")
        }
      },
    })
    await second.rescan()
    await second.service.recoverCommittedLocalState()
    const recoveredInstall = second.store.projections.listInstallations()[0]
    if (recoveredInstall === undefined) throw new Error("recovered installation missing")
    const recoveredInstallProvenance = new LocalSourceProvenanceRepository(second.store.snapshots)
      .reconstruct(recoveredInstall.provenanceId)
    expect(recoveredInstallProvenance).toMatchObject({
      kind: "forge-import",
      installedTreeHash: selection.treeHash,
      createdByJournalId: installPlan.planId,
    })
    expect(second.store.updates.get(recoveredInstall.id)).toMatchObject({
      state: "current",
      baseTreeHash: selection.treeHash,
    })

    await writeFile(path.join(second.sourceRoot, "references/guide.md"), "# Recovered v2\n")
    await second.service.refreshUpdates()
    const installation = second.store.projections.getInstallation(recoveredInstall.id)
    if (installation === undefined) throw new Error("installation missing before recovered update")
    const updatePlan = await second.service.plan({
      kind: "update-from-local",
      installationId: installation.id,
      expectedSnapshotId: installation.snapshotId,
    })
    expect(await second.service.confirm({ planId: updatePlan.planId })).toMatchObject({ status: "failed" })
    expect(second.store.operations.getPlan(updatePlan.planId)?.state).toBe("committed")
    second.store.close()

    const third = await harness({
      targetRoot: first.targetRoot,
      recoveryRoot: first.recoveryRoot,
      sourceRoot: first.sourceRoot,
      databasePath: first.databasePath,
    })
    await third.rescan()
    await third.service.recoverCommittedLocalState()
    await third.service.recoverCommittedLocalState()
    const recoveredUpdate = third.store.projections.getInstallation(recoveredInstall.id)
    if (recoveredUpdate === undefined) throw new Error("updated installation missing after restart")
    const provenance = new LocalSourceProvenanceRepository(third.store.snapshots)
      .reconstruct(recoveredUpdate.provenanceId)
    expect(provenance).toMatchObject({
      updatedByJournalId: updatePlan.planId,
      previousInstalledTreeHash: selection.treeHash,
    })
    expect(third.store.updates.get(recoveredUpdate.id)).toMatchObject({
      state: "current",
      baseTreeHash: provenance?.installedTreeHash,
      installedTreeHash: provenance?.installedTreeHash,
      sourceTreeHash: provenance?.sourceTreeHash,
    })
    third.store.close()
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
