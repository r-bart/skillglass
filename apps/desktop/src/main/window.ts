import { BrowserWindow, screen, session, shell } from "electron"
import { randomBytes } from "node:crypto"
import type { BrowserWindowConstructorOptions } from "electron"
import { join } from "node:path"

import { FORGE_APP_ORIGIN } from "./protocol.js"
import {
  DEVELOPMENT_STYLE_NONCE,
  contentSecurityPolicy,
  createSecureWebPreferences,
  isAllowedExternalUrl,
} from "./security.js"

export const PREFERRED_CONTENT_SIZE = { width: 1420, height: 892 } as const
export const MINIMUM_CONTENT_SIZE = { width: 760, height: 520 } as const

export interface DisplayWorkAreaSize {
  readonly width: number
  readonly height: number
}

export function developmentDockIconPath(
  appPath: string,
  usesBuiltAssets: boolean,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "darwin" || usesBuiltAssets) return undefined
  return join(appPath, "../../branding/Skillglass.png")
}

function clampPreferredDimension(preferred: number, minimum: number, available: number): number {
  return Math.max(minimum, Math.min(preferred, Math.floor(available)))
}

/**
 * Calculates the platform-specific, display-aware BrowserWindow options without
 * accessing Electron runtime state. Keeping this pure lets the native chrome
 * contract be verified in the regular unit-test process.
 */
export function calculateWindowOptions(
  workArea: DisplayWorkAreaSize,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  const nativeChromeOptions: BrowserWindowConstructorOptions =
    platform === "darwin"
      ? {
          // Retain the native traffic lights while allowing the app topbar to
          // occupy the titlebar area.
          titleBarStyle: "hiddenInset",
        }
      : platform === "win32" || platform === "linux"
        ? {
            // Electron supplies the native caption controls in this overlay;
            // the renderer must reserve the matching topbar height.
            titleBarStyle: "hidden",
            titleBarOverlay: {
              color: "#101013",
              symbolColor: "#f4f4f6",
              height: 46,
            },
          }
        : {}

  return {
    title: "Skillglass",
    width: clampPreferredDimension(
      PREFERRED_CONTENT_SIZE.width,
      MINIMUM_CONTENT_SIZE.width,
      workArea.width,
    ),
    height: clampPreferredDimension(
      PREFERRED_CONTENT_SIZE.height,
      MINIMUM_CONTENT_SIZE.height,
      workArea.height,
    ),
    minWidth: MINIMUM_CONTENT_SIZE.width,
    minHeight: MINIMUM_CONTENT_SIZE.height,
    useContentSize: true,
    show: false,
    backgroundColor: "#0b0b0d",
    ...nativeChromeOptions,
  }
}

function openAllowedExternalUrl(candidate: string): void {
  if (!isAllowedExternalUrl(candidate)) return
  void shell.openExternal(candidate).catch(() => {
    // Opening an allowlisted URL is optional and must never destabilize Forge.
  })
}

function installDefaultDenyPermissions(): void {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

function installContentSecurityPolicy(isPackaged: boolean, styleNonce: string): void {
  const policy = contentSecurityPolicy(isPackaged, styleNonce)

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
  const styleNonce = isPackaged
    ? randomBytes(18).toString("base64url")
    : DEVELOPMENT_STYLE_NONCE
  installDefaultDenyPermissions()
  installContentSecurityPolicy(isPackaged, styleNonce)

  const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

  const window = new BrowserWindow({
    ...calculateWindowOptions(activeDisplay.workArea),
    webPreferences: createSecureWebPreferences(join(__dirname, "preload.js"), isPackaged, styleNonce),
  })

  if (isPackaged) window.setMenu(null)
  window.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault()
    openAllowedExternalUrl(url)
  })
  window.webContents.on("will-attach-webview", (event) => {
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
