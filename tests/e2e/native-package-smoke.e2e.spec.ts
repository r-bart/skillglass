import { spawn, type ChildProcess } from "node:child_process"
import { access, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const outputRoot = path.join(repositoryRoot, "apps", "desktop", "out")

async function packagedExecutable(): Promise<string> {
  const packageRoot = path.join(outputRoot, `Forge-${process.platform}-${process.arch}`)
  const executable = process.platform === "darwin"
    ? path.join(packageRoot, "Forge.app", "Contents", "MacOS", "Forge")
    : path.join(packageRoot, process.platform === "win32" ? "Forge.exe" : "Forge")
  await access(executable)
  return executable
}

interface PackagedProcess {
  readonly child: ChildProcess
  readonly stderr: Buffer[]
}

function startPackaged(executable: string, home: string, chromiumData: string): PackagedProcess {
  const stderr: Buffer[] = []
  const appData = path.join(home, "app-data")
  const child = spawn(executable, [`--user-data-dir=${chromiumData}`], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: appData,
      LOCALAPPDATA: path.join(home, "local-app-data"),
      XDG_CONFIG_HOME: path.join(home, "config"),
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  })
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))
  return { child, stderr }
}

async function waitForDatabase(process: PackagedProcess, databasePath: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error(`Packaged Forge exited before opening SQLite:\n${Buffer.concat(process.stderr).toString("utf8")}`)
    }
    try {
      await access(databasePath)
      return
    } catch {
      // Startup is asynchronous; keep polling the one required userData path.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Packaged Forge did not create forge.sqlite:\n${Buffer.concat(process.stderr).toString("utf8")}`)
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForExit(child: ChildProcess, timeoutMilliseconds: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    const timeout = setTimeout(() => {
      child.off("exit", onExit)
      resolve(false)
    }, timeoutMilliseconds)
    child.once("exit", onExit)
  })
}

async function stopPackaged(process: PackagedProcess): Promise<void> {
  if (hasExited(process.child)) {
    throw new Error(`Packaged Forge exited unexpectedly:\n${Buffer.concat(process.stderr).toString("utf8")}`)
  }
  process.child.kill("SIGTERM")
  if (await waitForExit(process.child, 10_000)) return

  // A desktop bundle is not required to behave like a POSIX daemon. Escalate so
  // the smoke test also proves SQLite survives an interrupted packaged process.
  process.child.kill("SIGKILL")
  if (!await waitForExit(process.child, 5_000)) {
    throw new Error(`Packaged Forge could not be terminated:\n${Buffer.concat(process.stderr).toString("utf8")}`)
  }
}

test("native packaged app launches twice and reopens its SQLite store", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "forge-package-smoke-"))
  const home = path.join(fixture, "home")
  const chromiumData = path.join(fixture, "chromium-data")
  const executable = await packagedExecutable()
  try {
    await Promise.all([mkdir(home), mkdir(chromiumData)])
    const firstLaunch = startPackaged(executable, home, chromiumData)
    const databasePath = path.join(chromiumData, "forge.sqlite")
    await waitForDatabase(firstLaunch, databasePath)
    await stopPackaged(firstLaunch)

    const first = new DatabaseSync(databasePath)
    expect(first.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
    expect(first.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ])
    first.prepare(`
      INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
    `).run("package-smoke.marker", JSON.stringify("first-launch"), new Date().toISOString())
    first.close()

    const secondLaunch = startPackaged(executable, home, chromiumData)
    await waitForDatabase(secondLaunch, databasePath)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(secondLaunch.child.exitCode).toBeNull()
    await stopPackaged(secondLaunch)
    const reopened = new DatabaseSync(databasePath)
    expect(reopened.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
    expect(reopened.prepare("SELECT value_json FROM settings WHERE key = ?").get("package-smoke.marker")).toEqual({
      value_json: JSON.stringify("first-launch"),
    })
    reopened.close()
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
