import { describe, expect, it } from "vitest"

import { contentSecurityPolicy, createSecureWebPreferences, isTrustedRendererUrl } from "./security.js"

describe("desktop security policy", () => {
  it("keeps renderer and preload sandboxed without Node integration", () => {
    const preferences = createSecureWebPreferences("/absolute/preload.js")

    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
    })
  })

  it("does not permit eval, objects, frames, forms, or arbitrary production connections", () => {
    const policy = contentSecurityPolicy(true)

    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain("'unsafe-inline'")
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("form-action 'none'")
  })

  it("accepts only the packaged Forge origin", () => {
    expect(isTrustedRendererUrl("forge://app/index.html", true)).toBe(true)
    expect(isTrustedRendererUrl("forge://evil/index.html", true)).toBe(false)
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
})
