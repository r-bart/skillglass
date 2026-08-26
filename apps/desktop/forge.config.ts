import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import { FusesPlugin } from "@electron-forge/plugin-fuses"
import { MakerDeb } from "@electron-forge/maker-deb"
import { MakerRpm } from "@electron-forge/maker-rpm"
import { MakerSquirrel } from "@electron-forge/maker-squirrel"
import { MakerZIP } from "@electron-forge/maker-zip"
import { VitePlugin } from "@electron-forge/plugin-vite"
import { FuseV1Options, FuseVersion } from "@electron/fuses"

const execFileAsync = promisify(execFile)

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
      path.join(outputPath, "Forge.app"),
    ])
  }
}

export const FORGE_PACKAGER_CONFIG = {
  asar: true,
  name: "Forge",
  executableName: "Forge",
  appBundleId: "app.skillforge.desktop",
  appCategoryType: "public.app-category.developer-tools",
  osxSign: {
    identity: "-",
    identityValidation: false,
    hardenedRuntime: false,
    continueOnError: false,
  },
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
    new MakerSquirrel({ name: "forge" }),
    new MakerZIP({}, ["darwin"]),
    new MakerDeb({}),
    new MakerRpm({}),
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
