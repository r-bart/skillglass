import { spawn } from "node:child_process"
import { copyFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function packageDesktop(): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
    const child = spawn(command, ["--filter", "@forge/desktop", "package"], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Electron packaging failed (${signal ?? `exit ${String(code)}`})`))
    })
  })
}

export default async function globalSetup(): Promise<void> {
  if (process.env.FORGE_E2E_EXECUTABLE === undefined && process.env.FORGE_E2E_SKIP_PACKAGE !== "1") {
    await packageDesktop()
  }
  if (process.env.FORGE_E2E_EXECUTABLE === undefined) {
    const build = path.join(repositoryRoot, "apps", "desktop", ".vite", "build")
    // Forge emits CommonJS while the source package is ESM. The .cjs copy lets
    // Playwright's instrumentable development Electron load the exact bundle.
    await copyFile(path.join(build, "main.js"), path.join(build, "main.cjs"))
  }
}
