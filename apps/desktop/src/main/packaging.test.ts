import { readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"

import { FuseV1Options } from "@electron/fuses"

import { DEVELOPMENT_STYLE_NONCE } from "./security.js"

import config, {
  finalizeDarwinAdHocSignature,
  FORGE_FUSE_OPTIONS,
  FORGE_LICENSE_PATH,
  FORGE_LINUX_MAKER_OPTIONS,
  FORGE_PACKAGER_CONFIG,
  SKILL_FORGE_EXECUTABLE_NAME,
  SKILL_FORGE_ICON_PATH,
  SKILL_FORGE_PRODUCT_NAME,
} from "../../forge.config.js"
import mainVite from "../../vite.main.config.js"
import preloadVite from "../../vite.preload.config.js"
import rendererVite from "../../vite.renderer.config.js"

describe("desktop distributable policy", () => {
  it("packages only the Skill Forge product in an integrity-protected ASAR", () => {
    expect(FORGE_PACKAGER_CONFIG).toMatchObject({
      asar: true,
      name: SKILL_FORGE_PRODUCT_NAME,
      executableName: SKILL_FORGE_EXECUTABLE_NAME,
      icon: SKILL_FORGE_ICON_PATH,
      appBundleId: "app.skillforge.desktop",
      extraResource: [FORGE_LICENSE_PATH],
      prune: true,
    })
    expect(config.makers.map((maker) => maker.constructor.name)).toEqual([
      "MakerSquirrel",
      "MakerZIP",
      "MakerDeb",
      "MakerRpm",
    ])
    expect(FORGE_LINUX_MAKER_OPTIONS).toMatchObject({
      name: "forge",
      productName: SKILL_FORGE_PRODUCT_NAME,
      bin: SKILL_FORGE_EXECUTABLE_NAME,
      license: "Apache-2.0",
      categories: ["Development"],
    })
  })

  it("ships the Forge Apache license as a distribution resource", async () => {
    expect(FORGE_LICENSE_PATH).toMatch(/\/LICENSE$/)
    await expect(readFile(FORGE_LICENSE_PATH, "utf8")).resolves.toContain(
      "Apache License\n                           Version 2.0, January 2004",
    )
  })

  it("uses explicit ad-hoc signing without claiming the future Developer ID policy", () => {
    expect(FORGE_PACKAGER_CONFIG.osxSign).toEqual({
      identity: "-",
      identityValidation: false,
      hardenedRuntime: false,
      continueOnError: false,
    })
  })

  it("re-seals the final macOS bundle deeply after fuses and fails closed", async () => {
    const run = vi.fn(() => Promise.resolve())
    await finalizeDarwinAdHocSignature({
      platform: "darwin",
      outputPaths: ["/tmp/Skill Forge-darwin-arm64"],
    }, run)
    expect(run).toHaveBeenCalledWith("/usr/bin/codesign", [
      "--force",
      "--deep",
      "--sign",
      "-",
      "/tmp/Skill Forge-darwin-arm64/Skill Forge.app",
    ])

    await expect(finalizeDarwinAdHocSignature({
      platform: "darwin",
      outputPaths: ["/tmp/Skill Forge-darwin-arm64"],
    }, () => Promise.reject(new Error("codesign failed")))).rejects.toThrow("codesign failed")
  })

  it("locks down Electron execution and ASAR loading fuses", () => {
    expect(FORGE_FUSE_OPTIONS.strictlyRequireAllFuses).toBe(true)
    expect(FORGE_FUSE_OPTIONS[FuseV1Options.RunAsNode]).toBe(false)
    expect(FORGE_FUSE_OPTIONS[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
    expect(FORGE_FUSE_OPTIONS[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
    expect(FORGE_FUSE_OPTIONS[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true)
    expect(FORGE_FUSE_OPTIONS[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)
    expect(FORGE_FUSE_OPTIONS[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(false)
  })

  it("does not publish production source maps", () => {
    expect(mainVite).toMatchObject({ build: { sourcemap: false } })
    expect(preloadVite).toMatchObject({ build: { sourcemap: false } })
    expect(rendererVite).toMatchObject({ build: { sourcemap: false } })
    expect(rendererVite).toMatchObject({ html: { cspNonce: DEVELOPMENT_STYLE_NONCE } })
  })

  it("declares the CommonJS main bundle with a CommonJS extension", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
      main?: string
    }
    expect(manifest.main).toBe(".vite/build/main.cjs")
    expect(mainVite).toMatchObject({
      build: {
        rollupOptions: {
          output: { entryFileNames: "main.cjs" },
        },
      },
    })
  })

  it("has no updater or privilege-elevation production dependency", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>
    }
    const dependencies = Object.keys(manifest.dependencies ?? {})
    expect(dependencies).not.toEqual(expect.arrayContaining([
      "electron-updater",
      "update-electron-app",
      "auto-launch",
      "sudo-prompt",
      "node-windows",
    ]))
  })

  it("keeps the Linux Electron sandbox enabled in native smoke tests", async () => {
    const workflow = await readFile(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8")
    const releaseWorkflow = await readFile(new URL("../../../../.github/workflows/release.yml", import.meta.url), "utf8")
    expect(workflow).toContain("sudo chown root:root apps/desktop/out/Skill\\ Forge-linux-*/chrome-sandbox")
    expect(workflow).toContain("sudo chmod 4755 apps/desktop/out/Skill\\ Forge-linux-*/chrome-sandbox")
    expect(releaseWorkflow).toContain("sudo chown root:root apps/desktop/out/Skill\\ Forge-linux-*/chrome-sandbox")
    expect(releaseWorkflow).toContain("sudo chmod 4755 apps/desktop/out/Skill\\ Forge-linux-*/chrome-sandbox")
    expect(workflow).not.toContain("--no-sandbox")
    expect(releaseWorkflow).not.toContain("--no-sandbox")
  })
})
