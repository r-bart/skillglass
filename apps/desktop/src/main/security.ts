import type { IpcMainInvokeEvent, WebPreferences } from "electron"

export const EXTERNAL_LINK_ORIGINS = [
  "https://github.com",
] as const

const DEVELOPMENT_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:*",
  "media-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

export function contentSecurityPolicy(isPackaged: boolean): string {
  return isPackaged ? PRODUCTION_CSP : DEVELOPMENT_CSP
}

export function createSecureWebPreferences(preload: string, isPackaged: boolean): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    devTools: !isPackaged,
    enableWebSQL: false,
    navigateOnDragDrop: false,
    plugins: false,
    safeDialogs: true,
    spellcheck: false,
    webviewTag: false,
  }
}

export function isAllowedExternalUrl(
  candidate: string,
  allowedOrigins: readonly string[] = EXTERNAL_LINK_ORIGINS,
): boolean {
  if (candidate.length > 2_048) return false
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      allowedOrigins.includes(url.origin)
  } catch {
    return false
  }
}

export function isTrustedIpcSender(
  event: IpcMainInvokeEvent,
  isTrustedUrl: (url: string) => boolean,
): boolean {
  const frame = event.senderFrame
  if (frame === null || frame !== event.sender.mainFrame) return false
  return frame.url === event.sender.getURL() && isTrustedUrl(frame.url)
}

export function isTrustedRendererUrl(
  candidate: string,
  isPackaged: boolean,
  developmentServerUrl?: string,
): boolean {
  try {
    const url = new URL(candidate)

    if (isPackaged) {
      return url.protocol === "forge:" &&
        url.hostname === "app" &&
        url.username === "" &&
        url.password === "" &&
        url.port === ""
    }

    if (developmentServerUrl === undefined) {
      return false
    }

    return url.origin === new URL(developmentServerUrl).origin
  } catch {
    return false
  }
}
