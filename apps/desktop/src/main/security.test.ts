import type { IpcMainInvokeEvent } from "electron"
import { describe, expect, it } from "vitest"

import {
  DEVELOPMENT_STYLE_NONCE,
  contentSecurityPolicy,
  createSecureWebPreferences,
  isAllowedExternalUrl,
  isTrustedIpcSender,
  isTrustedRendererUrl,
} from "./security.js"

describe("desktop security policy", () => {
  it("shares a strict Vite development style nonce without weakening CSP", () => {
    expect(DEVELOPMENT_STYLE_NONCE).toMatch(/^[A-Za-z0-9_-]{24}$/u)
    const policy = contentSecurityPolicy(false, DEVELOPMENT_STYLE_NONCE)
    expect(policy).toContain(`style-src 'self' 'nonce-${DEVELOPMENT_STYLE_NONCE}'`)
    expect(policy).not.toContain("'unsafe-inline'")
  })

  it("keeps renderer and preload sandboxed without Node integration", () => {
    const preferences = createSecureWebPreferences("/absolute/preload.js", true, "test-style-nonce")

    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: false,
      webviewTag: false,
      additionalArguments: ["--forge-style-nonce=test-style-nonce"],
    })

    expect(createSecureWebPreferences("/absolute/preload.js", false, "test-style-nonce").devTools).toBe(true)
  })

  it("does not permit eval, objects, frames, forms, or arbitrary production connections", () => {
    const policy = contentSecurityPolicy(true, "test-style-nonce")

    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain("'unsafe-inline'")
    expect(policy).toContain("style-src 'self' 'nonce-test-style-nonce'")
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain("worker-src 'none'")
    expect(policy).toContain("script-src-attr 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("form-action 'none'")
  })

  it("accepts only the packaged Forge origin", () => {
    expect(isTrustedRendererUrl("forge://app/index.html", true)).toBe(true)
    expect(isTrustedRendererUrl("forge://evil/index.html", true)).toBe(false)
    expect(isTrustedRendererUrl("forge://user@app/index.html", true)).toBe(false)
    expect(isTrustedRendererUrl("forge://app:99/index.html", true)).toBe(false)
    expect(isTrustedRendererUrl("https://example.com", true)).toBe(false)
    expect(isTrustedRendererUrl("not a url", true)).toBe(false)
  })

  it("accepts only the exact development server origin", () => {
    const developmentServer = "http://localhost:5173"

    expect(isTrustedRendererUrl("http://localhost:5173/src/renderer/main.tsx", false, developmentServer)).toBe(
      true,
    )
    expect(isTrustedRendererUrl("http://localhost:5174", false, developmentServer)).toBe(false)
    expect(isTrustedRendererUrl("https://localhost:5173", false, developmentServer)).toBe(false)
    expect(isTrustedRendererUrl("http://localhost:5173.evil.test", false, developmentServer)).toBe(false)
  })

  it("opens only credential-free HTTPS links on the explicit external origin allowlist", () => {
    expect(isAllowedExternalUrl("https://github.com/example/forge/releases")).toBe(true)
    expect(isAllowedExternalUrl("http://github.com/example/forge")).toBe(false)
    expect(isAllowedExternalUrl("https://user@github.com/example/forge")).toBe(false)
    expect(isAllowedExternalUrl("https://github.com.evil.test/example/forge")).toBe(false)
    expect(isAllowedExternalUrl("https://github.com:444/example/forge")).toBe(false)
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false)
    expect(isAllowedExternalUrl("file:///private/etc/passwd")).toBe(false)
  })

  it("accepts IPC only from the current top-level frame at the trusted URL", () => {
    const mainFrame = { url: "forge://app/index.html" }
    const trusted = ((url: string) => url === "forge://app/index.html")
    const mainEvent = {
      senderFrame: mainFrame,
      sender: { mainFrame, getURL: () => "forge://app/index.html" },
    } as unknown as IpcMainInvokeEvent
    const childEvent = {
      senderFrame: { url: "forge://app/index.html" },
      sender: { mainFrame, getURL: () => "forge://app/index.html" },
    } as unknown as IpcMainInvokeEvent
    const staleEvent = {
      senderFrame: mainFrame,
      sender: { mainFrame, getURL: () => "forge://evil/index.html" },
    } as unknown as IpcMainInvokeEvent

    expect(isTrustedIpcSender(mainEvent, trusted)).toBe(true)
    expect(isTrustedIpcSender(childEvent, trusted)).toBe(false)
    expect(isTrustedIpcSender(staleEvent, trusted)).toBe(false)
  })
})
