import type { WebPreferences } from "electron"

const DEVELOPMENT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

export function contentSecurityPolicy(isPackaged: boolean): string {
  return isPackaged ? PRODUCTION_CSP : DEVELOPMENT_CSP
}

export function createSecureWebPreferences(preload: string): WebPreferences {
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
    enableWebSQL: false,
    navigateOnDragDrop: false,
    plugins: false,
    safeDialogs: true,
    spellcheck: false,
    webviewTag: false,
  }
}

export function isTrustedRendererUrl(
  candidate: string,
  isPackaged: boolean,
  developmentServerUrl?: string,
): boolean {
  try {
    const url = new URL(candidate)

    if (isPackaged) {
      return url.protocol === "forge:" && url.hostname === "app"
    }

    if (developmentServerUrl === undefined) {
      return false
    }

    return url.origin === new URL(developmentServerUrl).origin
  } catch {
    return false
  }
}
