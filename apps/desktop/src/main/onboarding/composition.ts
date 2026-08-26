import { createHash } from "node:crypto"
import { access, chmod, lstat, mkdir } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"

import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron"

import { CodexAdapter } from "@forge/adapter-codex"
import { FolderAdapter, type FolderRootConfiguration } from "@forge/adapter-folder"
import {
  IPC_EVENT_CHANNELS,
  InventoryChangedEventSchema,
  OperationCompletedEventSchema,
  OperationProgressEventSchema,
  RootsChangedEventSchema,
} from "@forge/contracts"
import { canonicalInstallationIdentity, canonicalPath, type ProjectScope, type SourceRoot } from "@forge/domain"
import { resolveCanonicalPath, type ApprovedRootInput } from "@forge/scanner"
import { openForgeStore } from "@forge/storage"
import {
  ContentUpdateCoordinator,
  ApprovedRootInstallTargetPolicy,
  ApprovedRootLocalInstallFileSystem,
  ArtifactFileSystemRouter,
  FileSystemLocalSourceAdmission,
  FileSystemLocalSourceMaterializer,
  LocalInstallCoordinator,
  LocalSourceProvenanceRepository,
  LocalSourceUpdateCoordinator,
  OperationEngine,
  ProjectionContentFileSystem,
  SourceSelectionService,
  StorageOperationRepository,
} from "@forge/operations"

import { isTrustedRendererUrl } from "../security.js"
import { e2eAdminSkillsRoot, useE2eBuiltAssets } from "../e2e-test-seam.js"
import { registerInventoryIpc } from "../inventory/ipc.js"
import { InventoryService } from "../inventory/service.js"
import { registerOperationIpc } from "../operations/ipc.js"
import { DesktopOperationService } from "../operations/service.js"
import { PrivateSourceLeaseRepository, recoverPrivateSourceLeases } from "../operations/artifact-leases.js"
import { RefreshableApprovedRootPolicy } from "../operations/root-policy.js"
import { registerOnboardingIpc } from "./ipc.js"
import { RootService } from "./root-service.js"
import { ApprovedRootScanService } from "./scan-service.js"
import { ForgeRootApprovalSettingsRepository } from "./settings-repository.js"
import { ForgeProjectSettingsRepository } from "./project-settings-repository.js"
import { ApprovedRootWatcherService } from "./watcher-service.js"

function projectId(candidate: string): string {
  return `project_${createHash("sha256").update(candidate).digest("hex").slice(0, 32)}`
}

const RECOVERY_ROOT_ID = "forge-recovery-v1"

function installationId(adapterId: string, candidate: string): string {
  const identity = canonicalInstallationIdentity({ adapterId, canonicalPath: canonicalPath(candidate) })
  const digest = createHash("sha256").update(identity).digest("hex")
  return adapterId === "codex" ? `codex-installation:${digest.slice(0, 24)}` : `installation_${digest.slice(0, 32)}`
}

function folderConfiguration(root: SourceRoot, projects: readonly ProjectScope[]): FolderRootConfiguration {
  if (root.kind === "project") {
    const project = projects.find(({ id }) => id === root.projectId)
    if (project === undefined) throw new TypeError("An approved project root requires a known project")
    return {
      candidateId: root.id,
      canonicalPath: root.canonicalPath,
      scope: { kind: "project", projectId: project.id, projectPath: project.canonicalPath },
      access: root.access,
      writableWithoutElevation: root.access === "read-write",
    }
  }
  return {
    candidateId: root.id,
    canonicalPath: root.canonicalPath,
    scope: { kind: "global" },
    access: root.access,
    writableWithoutElevation: root.access === "read-write" && root.kind !== "managed" && root.kind !== "system",
  }
}

async function repositoryRoot(workingDirectory: string): Promise<string | undefined> {
  let cursor = workingDirectory
  for (;;) {
    try {
      await lstat(path.join(cursor, ".git"))
      return cursor
    } catch {
      const parent = path.dirname(cursor)
      if (parent === cursor) return undefined
      cursor = parent
    }
  }
}

async function verifiedProject(candidate: string): Promise<ProjectScope> {
  const selected = (await resolveCanonicalPath(candidate)).canonicalPath
  if (!(await lstat(selected)).isDirectory()) throw new TypeError("El proyecto seleccionado debe ser una carpeta")
  await access(selected, fsConstants.R_OK)
  const repository = await repositoryRoot(selected)
  if (repository === undefined) throw new TypeError("La carpeta seleccionada no pertenece a un repositorio Git")
  const canonicalRepository = (await resolveCanonicalPath(repository)).canonicalPath
  return {
    id: projectId(canonicalRepository),
    displayName: path.basename(canonicalRepository),
    canonicalPath: canonicalPath(canonicalRepository),
    adapterIds: ["codex", "folder"],
  }
}

async function currentlyVerifiedProjects(projects: readonly ProjectScope[]): Promise<ProjectScope[]> {
  const verified: ProjectScope[] = []
  for (const project of projects) {
    try {
      const current = await verifiedProject(project.canonicalPath)
      if (current.canonicalPath === project.canonicalPath) verified.push(current)
    } catch {
      // A missing or inaccessible saved project stays persisted but inactive.
    }
  }
  return verified
}

function uniqueProjects(projects: readonly ProjectScope[]): ProjectScope[] {
  return [...new Map(projects.map((project) => [project.canonicalPath, project])).values()]
}

export interface OnboardingComposition {
  readonly rootService: RootService
  startPersistedScan(): Promise<boolean>
  dispose(): void
}

export async function createOnboardingComposition(
  currentWindow: () => BrowserWindow | undefined,
): Promise<OnboardingComposition> {
  const home = (await resolveCanonicalPath(app.getPath("home"))).canonicalPath
  const workingDirectory = (await resolveCanonicalPath(process.cwd())).canonicalPath
  const repository = await repositoryRoot(workingDirectory)
  const canonicalRepository = repository === undefined
    ? undefined
    : (await resolveCanonicalPath(repository)).canonicalPath
  const cwdProposal: readonly ProjectScope[] = canonicalRepository === undefined ? [] : [{
    id: projectId(canonicalRepository),
    displayName: path.basename(canonicalRepository),
    canonicalPath: canonicalRepository,
    adapterIds: ["codex", "folder"],
  }]
  const store = openForgeStore({
    path: path.join(app.getPath("userData"), "forge.sqlite"),
    privateDirectory: true,
  })
  const projectSettings = new ForgeProjectSettingsRepository(store.settings)
  const projectsState: { current: ProjectScope[] } = {
    current: uniqueProjects([
      ...await currentlyVerifiedProjects(projectSettings.load()),
      ...cwdProposal,
    ]),
  }
  const discoveryContext = () => ({
    homeDirectory: canonicalPath(home),
    workingDirectory: canonicalPath(workingDirectory),
    ...(canonicalRepository === undefined ? {} : { repositoryRoot: canonicalPath(canonicalRepository) }),
    projects: projectsState.current,
  })
  const adminSkillsRoot = e2eAdminSkillsRoot()
  const codexAdapter = new CodexAdapter(
    adminSkillsRoot === undefined ? {} : { adminSkillsRoot },
  )
  const folderAdapter = new FolderAdapter({ roots: [] })
  const send = (channel: string, payload: unknown): void => {
    const window = currentWindow()
    if (window !== undefined && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const scanService = new ApprovedRootScanService({
    codexAdapter,
    projects: () => projectsState.current,
    store,
    onInventoryChanged: (event) => send(IPC_EVENT_CHANNELS.inventoryChanged, InventoryChangedEventSchema.parse(event)),
  })
  const operationPolicyState: { current?: RefreshableApprovedRootPolicy } = {}
  const watcherState: { current?: ApprovedRootWatcherService } = {}
  const rootService = new RootService({
    adapters: [codexAdapter, folderAdapter],
    discoveryContext,
    settings: new ForgeRootApprovalSettingsRepository(store.settings),
    picker: {
      async selectDirectory() {
        const result = await dialog.showOpenDialog({
          title: "Añadir carpeta de skills",
          buttonLabel: "Añadir carpeta",
          properties: ["openDirectory"],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
    },
    projectPicker: {
      async selectProject() {
        const result = await dialog.showOpenDialog({
          title: "Añadir proyecto Codex",
          buttonLabel: "Añadir proyecto",
          properties: ["openDirectory"],
        })
        const selected = result.canceled ? undefined : result.filePaths[0]
        if (selected === undefined) return false
        const project = await verifiedProject(selected)
        const persisted = uniqueProjects([...projectSettings.load(), project])
        projectSettings.save(persisted, new Date().toISOString())
        projectsState.current = uniqueProjects([...projectsState.current, project])
        return true
      },
    },
    onApprovalPersisted: async (roots) => {
      await operationPolicyState.current?.replaceApprovedRoots(roots)
      await scanService.scan(roots)
      await watcherState.current?.replaceApprovedRoots(roots)
      send(IPC_EVENT_CHANNELS.rootsChanged, RootsChangedEventSchema.parse({
        rootIds: roots.map(({ id }) => id),
        observedAt: new Date().toISOString(),
      }))
    },
  })
  await rootService.state()
  const usesBuiltAssets = app.isPackaged || useE2eBuiltAssets()
  const developmentServerUrl = usesBuiltAssets ? undefined : MAIN_WINDOW_VITE_DEV_SERVER_URL
  const unregister = registerOnboardingIpc({
    ipcMain,
    rootService,
    isTrustedSender: (url) => isTrustedRendererUrl(
      url,
      usesBuiltAssets,
      ...(developmentServerUrl === undefined ? [] : [developmentServerUrl]),
    ),
  })
  const unregisterInventory = registerInventoryIpc({
    ipcMain,
    inventoryService: new InventoryService(store.inventory, store.projections, shell),
    isTrustedSender: (url) => isTrustedRendererUrl(
      url,
      usesBuiltAssets,
      ...(developmentServerUrl === undefined ? [] : [developmentServerUrl]),
    ),
  })
  const recoveryPath = path.join(app.getPath("userData"), "operation-recovery-v1")
  await mkdir(recoveryPath, { recursive: true, mode: 0o700 })
  await chmod(recoveryPath, 0o700)
  const recoveryRoot: ApprovedRootInput = {
    rootId: RECOVERY_ROOT_ID,
    path: recoveryPath,
    kind: "user-added",
    access: "read-write",
    writableWithoutElevation: true,
  }
  const operationRootPolicy = await RefreshableApprovedRootPolicy.create(
    rootService.approvedSourceRoots(),
    [recoveryRoot],
  )
  operationPolicyState.current = operationRootPolicy
  const operationRepository = new StorageOperationRepository(store.operations)
  const contentFileSystem = new ProjectionContentFileSystem(store.projections, [recoveryRoot])
  const treeFileSystem = new ApprovedRootLocalInstallFileSystem(operationRootPolicy)
  const operationFileSystem = new ArtifactFileSystemRouter(contentFileSystem, treeFileSystem)
  const operationEngine = new OperationEngine({
    repository: operationRepository,
    fileSystem: operationFileSystem,
    afterPersist: (plan) => {
      if (!["preconditions-checked", "staged", "snapshot-created", "applying", "verifying", "rolling-back"].includes(plan.state)) return
      if (plan.state === "applying") {
        const approvedRoots = new Map(rootService.approvedSourceRoots().map((root) => [root.id, root.canonicalPath]))
        const affectedPaths = plan.affectedPaths.flatMap((affected) => {
          const rootPath = approvedRoots.get(affected.rootId)
          return rootPath === undefined ? [] : [path.resolve(rootPath, affected.relativePath)]
        })
        if (affectedPaths.length > 0) {
          watcherState.current?.recordJournalMutation({ journalId: plan.id, paths: affectedPaths })
        }
      }
      send(IPC_EVENT_CHANNELS.operationProgress, OperationProgressEventSchema.parse({
        operationId: `operation_${createHash("sha256").update(plan.id).digest("hex").slice(0, 24)}`,
        planId: plan.id,
        journalId: plan.id,
        stage: plan.state,
        message: `Operación: ${plan.state}`,
      }))
    },
  })
  await operationEngine.recoverStartup()
  const leases = new PrivateSourceLeaseRepository(store.settings)
  await recoverPrivateSourceLeases(leases, treeFileSystem)
  const provenance = new LocalSourceProvenanceRepository(store.snapshots)
  const admission = new FileSystemLocalSourceAdmission()
  const selections = new SourceSelectionService({
    admission,
    dialog: {
      async selectDirectory() {
        const result = await dialog.showOpenDialog({
          title: "Seleccionar carpeta de skill",
          buttonLabel: "Seleccionar",
          properties: ["openDirectory"],
        })
        return result.canceled ? undefined : result.filePaths[0]
      },
      async selectZipFile() {
        const result = await dialog.showOpenDialog({
          title: "Seleccionar ZIP de skill",
          buttonLabel: "Seleccionar",
          properties: ["openFile"],
          filters: [{ name: "Archivo ZIP", extensions: ["zip"] }],
        })
        return result.canceled ? undefined : result.filePaths[0]
      },
    },
  })
  const materializer = new FileSystemLocalSourceMaterializer(operationRootPolicy)
  const localInstalls = new LocalInstallCoordinator({
    selections,
    targets: new ApprovedRootInstallTargetPolicy(operationRootPolicy),
    materializer,
    engine: operationEngine,
    installationId,
    privateSourceRootId: RECOVERY_ROOT_ID,
  })
  const localUpdates = new LocalSourceUpdateCoordinator({
    admission,
    rootPolicy: operationRootPolicy,
    materializer,
    engine: operationEngine,
    provenance,
    recoveryRootId: RECOVERY_ROOT_ID,
  })
  const contentUpdates = new ContentUpdateCoordinator({
    projections: store.projections,
    snapshots: store.snapshots,
    repository: operationRepository,
    fileSystem: contentFileSystem,
    engine: operationEngine,
    recoveryRootId: RECOVERY_ROOT_ID,
    rescan: async () => {
      await rootService.scanPersistedApproval()
    },
  })
  const operationService = new DesktopOperationService({
    selections,
    installs: localInstalls,
    updates: localUpdates,
    contentUpdates,
    repository: operationRepository,
    projections: store.projections,
    settings: store.settings,
    updateObservations: store.updates,
    provenance,
    rootPolicy: operationRootPolicy,
    approvedRoots: () => rootService.approvedSourceRoots(),
    adapterForRoot: (root) => {
      if (root.adapterId === codexAdapter.id) return codexAdapter
      if (root.adapterId === "folder") {
        return new FolderAdapter({
          roots: rootService.approvedSourceRoots()
            .filter(({ adapterId }) => adapterId === "folder")
            .map((candidate) => folderConfiguration(candidate, projectsState.current)),
        })
      }
      throw new TypeError("No adapter is available for the approved root")
    },
    rescan: async () => { await rootService.scanPersistedApproval() },
    recoveryRootId: RECOVERY_ROOT_ID,
    leases,
    onInventoryChanged: (installationIds) => send(IPC_EVENT_CHANNELS.inventoryChanged, InventoryChangedEventSchema.parse({
      installationIds,
      reason: "operation",
      observedAt: new Date().toISOString(),
    })),
    onCompleted: (result) => send(IPC_EVENT_CHANNELS.operationCompleted, OperationCompletedEventSchema.parse(result)),
  })
  const watcherService = new ApprovedRootWatcherService({
    onInvalidatePlans: (invalidation) => {
      operationService.invalidatePlansForExternalChange(invalidation)
    },
    onReconcile: async () => {
      const roots = rootService.approvedSourceRoots()
      if (roots.length > 0) await scanService.scan(roots, "watcher")
    },
    onFinding: (finding) => send(IPC_EVENT_CHANNELS.inventoryChanged, InventoryChangedEventSchema.parse({
      installationIds: [],
      reason: "watcher",
      observedAt: new Date().toISOString(),
      findings: [finding],
    })),
  })
  watcherState.current = watcherService
  const unregisterOperations = registerOperationIpc({
    ipcMain,
    service: operationService,
    isTrustedSender: (url) => isTrustedRendererUrl(
      url,
      usesBuiltAssets,
      ...(developmentServerUrl === undefined ? [] : [developmentServerUrl]),
    ),
  })
  return {
    rootService,
    startPersistedScan: async () => {
      const scanned = await rootService.scanPersistedApproval()
      await operationService.recoverCommittedLocalState()
      return scanned
    },
    dispose: () => {
      unregisterOperations()
      unregisterInventory()
      unregister()
      void watcherService.dispose().finally(() => store.close())
    },
  }
}
