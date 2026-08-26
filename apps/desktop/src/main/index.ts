import { app, BrowserWindow, protocol } from "electron"
import { join } from "node:path"

import { FORGE_SCHEME, registerForgeProtocol } from "./protocol.js"
import { createMainWindow } from "./window.js"
import { createOnboardingComposition, type OnboardingComposition } from "./onboarding/composition.js"
import { applyE2eProcessPathOverrides, useE2eBuiltAssets } from "./e2e-test-seam.js"

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

app.whenReady().then(async () => {
  if (usesBuiltAssets) {
    registerForgeProtocol(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`))
  }

  onboarding = await createOnboardingComposition(() => mainWindow)
  mainWindow = await createMainWindow(usesBuiltAssets)
  await onboarding.startPersistedScan()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(usesBuiltAssets).then((window) => {
        mainWindow = window
      })
    }
  })
})

app.on("before-quit", () => {
  onboarding?.dispose()
  onboarding = undefined
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
