import { createHash } from "node:crypto"
import { lstat } from "node:fs/promises"
import path from "node:path"

import { app, dialog, ipcMain, type BrowserWindow } from "electron"

import { CodexAdapter } from "@forge/adapter-codex"
import { FolderAdapter } from "@forge/adapter-folder"
import {
  IPC_EVENT_CHANNELS,
  InventoryChangedEventSchema,
  RootsChangedEventSchema,
} from "@forge/contracts"
import { canonicalPath, type ProjectScope } from "@forge/domain"
import { resolveCanonicalPath } from "@forge/scanner"
import { openForgeStore } from "@forge/storage"

import { isTrustedRendererUrl } from "../security.js"
import { registerOnboardingIpc } from "./ipc.js"
import { RootService } from "./root-service.js"
import { ApprovedRootScanService } from "./scan-service.js"
import { ForgeRootApprovalSettingsRepository } from "./settings-repository.js"

function projectId(candidate: string): string {
  return `project_${createHash("sha256").update(candidate).digest("hex").slice(0, 32)}`
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
  const projects: readonly ProjectScope[] = canonicalRepository === undefined ? [] : [{
    id: projectId(canonicalRepository),
    displayName: path.basename(canonicalRepository),
    canonicalPath: canonicalRepository,
    adapterIds: ["codex", "folder"],
  }]
  const context = {
    homeDirectory: canonicalPath(home),
    workingDirectory: canonicalPath(workingDirectory),
    ...(canonicalRepository === undefined ? {} : { repositoryRoot: canonicalPath(canonicalRepository) }),
    projects,
  }
  const store = openForgeStore({ path: path.join(app.getPath("userData"), "forge.sqlite") })
  const codexAdapter = new CodexAdapter()
  const folderAdapter = new FolderAdapter({ roots: [] })
  const send = (channel: string, payload: unknown): void => {
    const window = currentWindow()
    if (window !== undefined && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const scanService = new ApprovedRootScanService({
    codexAdapter,
    projects,
    store,
    onInventoryChanged: (event) => send(IPC_EVENT_CHANNELS.inventoryChanged, InventoryChangedEventSchema.parse(event)),
  })
  const rootService = new RootService({
    adapters: [codexAdapter, folderAdapter],
    discoveryContext: context,
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
    onApprovalPersisted: async (roots) => {
      await scanService.scan(roots)
      send(IPC_EVENT_CHANNELS.rootsChanged, RootsChangedEventSchema.parse({
        rootIds: roots.map(({ id }) => id),
        observedAt: new Date().toISOString(),
      }))
    },
  })
  const developmentServerUrl = app.isPackaged ? undefined : MAIN_WINDOW_VITE_DEV_SERVER_URL
  const unregister = registerOnboardingIpc({
    ipcMain,
    rootService,
    isTrustedSender: (url) => isTrustedRendererUrl(
      url,
      app.isPackaged,
      ...(developmentServerUrl === undefined ? [] : [developmentServerUrl]),
    ),
  })
  return {
    rootService,
    startPersistedScan: () => rootService.scanPersistedApproval(),
    dispose: () => {
      unregister()
      store.close()
    },
  }
}
