import { BrowserWindow, session } from "electron"
import { join } from "node:path"

import { FORGE_APP_ORIGIN } from "./protocol.js"
import { contentSecurityPolicy, createSecureWebPreferences } from "./security.js"

function installDefaultDenyPermissions(): void {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

function installContentSecurityPolicy(isPackaged: boolean): void {
  const policy = contentSecurityPolicy(isPackaged)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    })
  })
}

export async function createMainWindow(isPackaged: boolean): Promise<BrowserWindow> {
  installDefaultDenyPermissions()
  installContentSecurityPolicy(isPackaged)

  const window = new BrowserWindow({
    title: "Forge",
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: "#111318",
    webPreferences: createSecureWebPreferences(join(__dirname, "preload.js")),
  })

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault()
  })
  window.once("ready-to-show", () => {
    window.show()
  })

  if (isPackaged) {
    await window.loadURL(`${FORGE_APP_ORIGIN}/index.html`)
  } else {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  }

  return window
}
