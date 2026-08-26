import { app, BrowserWindow, protocol } from "electron"
import { join } from "node:path"

import { FORGE_SCHEME, registerForgeProtocol } from "./protocol.js"
import { createMainWindow } from "./window.js"

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

app.whenReady().then(async () => {
  if (app.isPackaged) {
    registerForgeProtocol(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`))
  }

  await createMainWindow(app.isPackaged)

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(app.isPackaged)
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
