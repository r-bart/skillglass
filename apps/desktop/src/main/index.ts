import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron"
import { join } from "node:path"

import { FORGE_SCHEME, registerForgeProtocol } from "./protocol.js"
import { attachWindowCloseHandler, createMainWindow, developmentDockIconPath } from "./window.js"
import { createOnboardingComposition, type OnboardingComposition } from "./onboarding/composition.js"
import { applyE2eProcessPathOverrides, useE2eBuiltAssets } from "./e2e-test-seam.js"
import { applyUserDataCommandLineOverride } from "./user-data-path.js"
import { isTrustedRendererUrl } from "./security.js"
import {
  WindowCloseGuard,
  registerWindowCloseGuardIpc,
  sendCloseRequest,
  type CloseDialogOptions,
} from "./window-close-guard.js"

applyUserDataCommandLineOverride(app)
applyE2eProcessPathOverrides(app)
const usesBuiltAssets = app.isPackaged || useE2eBuiltAssets()

protocol.registerSchemesAsPrivileged([
  {
    scheme: FORGE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: false,
      allowServiceWorkers: false,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
      codeCache: true,
      allowExtensions: false,
    },
  },
])

app.enableSandbox()

let mainWindow: BrowserWindow | undefined
let onboarding: OnboardingComposition | undefined
let closeGuard: WindowCloseGuard | undefined
let unregisterCloseIpc: (() => void) | undefined
let removeWindowCloseHandler: (() => void) | undefined

function preferredLocale(): "es" | "en" {
  return app.getLocale().toLocaleLowerCase("en-US").startsWith("es") ? "es" : "en"
}

async function showCloseDialog(
  window: BrowserWindow,
  options: CloseDialogOptions,
): Promise<"stay" | "discard"> {
  const locale = options.locale
  if (options.kind === "unsaved") {
    const result = await dialog.showMessageBox(window, locale === "es" ? {
      type: "warning",
      title: "Cambios sin guardar",
      message: "Tienes cambios sin guardar",
      detail: "Si sales ahora, perderás el borrador actual.",
      buttons: ["Seguir editando", "Descartar cambios"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    } : {
      type: "warning",
      title: "Unsaved changes",
      message: "You have unsaved changes",
      detail: "If you leave now, the current draft will be lost.",
      buttons: ["Keep editing", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return result.response === 1 ? "discard" : "stay"
  }
  const busy = options.kind === "busy"
  await dialog.showMessageBox(window, locale === "es" ? {
    type: "info",
    title: busy ? "Operación en curso" : "No se puede comprobar el borrador",
    message: busy ? "Skillglass está terminando una operación" : "No se ha podido comprobar si hay cambios sin guardar",
    detail: busy ? "Espera a que termine y vuelve a intentarlo." : "La ventana seguirá abierta para proteger tu trabajo.",
    buttons: ["Seguir editando"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  } : {
    type: "info",
    title: busy ? "Operation in progress" : "Draft could not be checked",
    message: busy ? "Skillglass is finishing an operation" : "Skillglass could not check for unsaved changes",
    detail: busy ? "Wait for it to finish and try again." : "The window will stay open to protect your work.",
    buttons: ["Keep editing"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return "stay"
}

function installCloseGuard(): void {
  closeGuard ??= new WindowCloseGuard({
    currentWindow: () => mainWindow,
    hasActiveOperation: () => onboarding?.hasActiveConfirmedOperation() === true,
    sendRequest: sendCloseRequest,
    showDialog: showCloseDialog,
    defaultLocale: preferredLocale,
    quit: () => app.quit(),
  })
  unregisterCloseIpc ??= registerWindowCloseGuardIpc({
    ipcMain,
    guard: closeGuard,
    currentWindow: () => mainWindow,
    isTrustedSender: (url) => isTrustedRendererUrl(
      url,
      usesBuiltAssets,
      ...(usesBuiltAssets ? [] : [MAIN_WINDOW_VITE_DEV_SERVER_URL]),
    ),
  })
}

function protectWindow(window: BrowserWindow): void {
  removeWindowCloseHandler?.()
  removeWindowCloseHandler = attachWindowCloseHandler(window, (event) => {
    closeGuard?.handleWindowClose(window, event)
  })
  window.once("closed", () => {
    removeWindowCloseHandler = undefined
    if (mainWindow === window) mainWindow = undefined
  })
}

app.whenReady().then(async () => {
  const dockIcon = developmentDockIconPath(app.getAppPath(), usesBuiltAssets)
  if (dockIcon !== undefined) app.dock?.setIcon(dockIcon)

  if (usesBuiltAssets) {
    registerForgeProtocol(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`))
  }

  onboarding = await createOnboardingComposition(() => mainWindow)
  installCloseGuard()
  mainWindow = await createMainWindow(usesBuiltAssets)
  protectWindow(mainWindow)
  await onboarding.startPersistedScan()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(usesBuiltAssets).then((window) => {
        mainWindow = window
        protectWindow(window)
      })
    }
  })
}).catch((reason: unknown) => {
  console.error("Skillglass failed during startup", reason)
  app.exit(1)
})

app.on("before-quit", (event) => {
  if (closeGuard?.handleBeforeQuit(event) === false) return
  onboarding?.dispose()
  onboarding = undefined
  unregisterCloseIpc?.()
  unregisterCloseIpc = undefined
  closeGuard?.dispose()
  closeGuard = undefined
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
