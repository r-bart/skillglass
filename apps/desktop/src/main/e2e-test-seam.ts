import { appendFileSync } from "node:fs"
import path from "node:path"

import type { App } from "electron"

import type { SourceRoot } from "@forge/domain"

const ENABLED = "1"

function active(): boolean {
  const developmentElectron = (process as NodeJS.Process & { readonly defaultApp?: boolean }).defaultApp === true
  return developmentElectron && process.env.FORGE_E2E === ENABLED
}

function absoluteEnvironmentPath(name: string): string | undefined {
  if (!active()) return undefined
  const value = process.env[name]
  if (value === undefined) return undefined
  if (!path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`)
  return path.normalize(value)
}

/** Process-path overrides are accepted only by explicitly marked E2E launches. */
export function applyE2eProcessPathOverrides(electronApp: Pick<App, "setPath">): void {
  const home = absoluteEnvironmentPath("FORGE_E2E_HOME")
  const userData = absoluteEnvironmentPath("FORGE_E2E_USER_DATA")
  if (home !== undefined) electronApp.setPath("home", home)
  if (userData !== undefined) electronApp.setPath("userData", userData)
}

/** Allows the real Codex adapter to observe an isolated read-only admin fixture. */
export function e2eAdminSkillsRoot(): string | undefined {
  return absoluteEnvironmentPath("FORGE_E2E_ADMIN_SKILLS_ROOT")
}

/** Source Electron uses the production Vite output without weakening release fuses. */
export function useE2eBuiltAssets(): boolean {
  return active()
}

/** Records the actual scan boundary; it never initiates or alters a scan. */
export function auditE2eScan(roots: readonly SourceRoot[]): void {
  const auditPath = absoluteEnvironmentPath("FORGE_E2E_SCAN_AUDIT")
  if (auditPath === undefined) return
  appendFileSync(auditPath, `${JSON.stringify(roots.map(({ canonicalPath }) => canonicalPath))}\n`, "utf8")
}
