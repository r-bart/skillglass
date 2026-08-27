import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { FusesPlugin } from "@electron-forge/plugin-fuses"
import { MakerDeb, type MakerDebConfig } from "@electron-forge/maker-deb"
import { MakerRpm, type MakerRpmConfig } from "@electron-forge/maker-rpm"
import { MakerSquirrel } from "@electron-forge/maker-squirrel"
import { MakerZIP } from "@electron-forge/maker-zip"
import { VitePlugin } from "@electron-forge/plugin-vite"
import { FuseV1Options, FuseVersion } from "@electron/fuses"

const execFileAsync = promisify(execFile)
export const SKILL_FORGE_PRODUCT_NAME = "Skill Forge"
export const SKILL_FORGE_EXECUTABLE_NAME = process.platform === "linux" ? "skill-forge" : SKILL_FORGE_PRODUCT_NAME
export const SKILL_FORGE_ICON_PATH = fileURLToPath(new URL("../../branding/SkillForge.icon", import.meta.url))
export const SKILL_FORGE_ICON_ICO_PATH = fileURLToPath(new URL("../../branding/SkillForge.ico", import.meta.url))
export const SKILL_FORGE_ICON_PNG_PATH = fileURLToPath(new URL("../../branding/SkillForge.png", import.meta.url))
export const FORGE_LICENSE_PATH = fileURLToPath(new URL("../../LICENSE", import.meta.url))

export async function finalizeDarwinAdHocSignature(
  packageResult: Readonly<{ platform: string; outputPaths: readonly string[] }>,
  run: (executable: string, args: readonly string[]) => Promise<unknown> = execFileAsync,
): Promise<void> {
  if (packageResult.platform !== "darwin") return
  for (const outputPath of packageResult.outputPaths) {
    await run("/usr/bin/codesign", [
      "--force",
      "--deep",
      "--sign",
      "-",
      path.join(outputPath, `${SKILL_FORGE_PRODUCT_NAME}.app`),
    ])
  }
}

export const FORGE_PACKAGER_CONFIG = {
  asar: true,
  name: SKILL_FORGE_PRODUCT_NAME,
  executableName: SKILL_FORGE_EXECUTABLE_NAME,
  icon: SKILL_FORGE_ICON_PATH,
  appBundleId: "app.skillforge.desktop",
  appCategoryType: "public.app-category.developer-tools",
  osxSign: {
    identity: "-",
    identityValidation: false,
    hardenedRuntime: false,
    continueOnError: false,
  },
  extraResource: [FORGE_LICENSE_PATH],
  prune: true,
} as const

export const FORGE_FUSE_OPTIONS = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // Electron 43 ships only the context snapshot in the packaged app. Enabling
  // this fuse without bundling a browser-process snapshot makes the binary
  // fail before main executes.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
} as const

export const FORGE_LINUX_MAKER_OPTIONS: NonNullable<MakerDebConfig["options"]> & NonNullable<MakerRpmConfig["options"]> = {
  name: "forge",
  productName: SKILL_FORGE_PRODUCT_NAME,
  genericName: "Agent skill manager",
  description: "Local-first inventory and safe updater for agent skills",
  productDescription: "Discover, inspect, install, and safely update agent skills without changing harness activation.",
  bin: SKILL_FORGE_EXECUTABLE_NAME,
  icon: SKILL_FORGE_ICON_PNG_PATH,
  license: "Apache-2.0",
  categories: ["Development"],
}

const config = {
  packagerConfig: FORGE_PACKAGER_CONFIG,
  rebuildConfig: {},
  hooks: {
    postPackage: async (_forgeConfig: unknown, packageResult: Readonly<{
      platform: string
      outputPaths: readonly string[]
    }>) => finalizeDarwinAdHocSignature(packageResult),
  },
  makers: [
    new MakerSquirrel({ name: "forge", setupIcon: SKILL_FORGE_ICON_ICO_PATH }),
    new MakerZIP({}, ["darwin"]),
    new MakerDeb({ options: FORGE_LINUX_MAKER_OPTIONS }),
    new MakerRpm({ options: FORGE_LINUX_MAKER_OPTIONS }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    new FusesPlugin(FORGE_FUSE_OPTIONS),
  ],
}

export default config
