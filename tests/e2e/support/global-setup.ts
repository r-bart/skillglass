import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function packageDesktop(): Promise<void> {
  return rm(path.join(repositoryRoot, "apps", "desktop", "out"), { recursive: true, force: true }).then(() => new Promise((resolve, reject) => {
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
  }))
}

export default async function globalSetup(): Promise<void> {
  if (process.env.FORGE_E2E_EXECUTABLE === undefined && process.env.FORGE_E2E_SKIP_PACKAGE !== "1") {
    await packageDesktop()
  }
}
