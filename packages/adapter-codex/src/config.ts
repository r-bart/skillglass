import { readFile, realpath } from "node:fs/promises"
import path from "node:path"

import { canonicalPath, type CanonicalPath } from "@forge/domain"

function unquoteTomlString(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return undefined
  try {
    return JSON.parse(trimmed) as string
  } catch {
    return undefined
  }
}

async function canonicalizeConfiguredPath(value: string): Promise<CanonicalPath> {
  const absolute = path.resolve(value)
  try {
    return canonicalPath(await realpath(absolute))
  } catch {
    return canonicalPath(absolute)
  }
}

/** Reads only exact disabled skill entries. It intentionally has no write API. */
export async function readDisabledSkillEntries(
  configFile: string | undefined,
): Promise<ReadonlySet<CanonicalPath>> {
  if (configFile === undefined) return new Set()
  let source: string
  try {
    source = await readFile(configFile, "utf8")
  } catch {
    return new Set()
  }

  const disabled = new Set<CanonicalPath>()
  const blocks = source.split(/^\s*\[\[skills\.config\]\]\s*$/mu).slice(1)
  for (const block of blocks) {
    const nextTable = block.search(/^\s*\[\[/mu)
    const body = nextTable === -1 ? block : block.slice(0, nextTable)
    const pathMatch = /^\s*path\s*=\s*(.+?)\s*$/mu.exec(body)
    const enabledMatch = /^\s*enabled\s*=\s*(true|false)\s*$/mu.exec(body)
    if (pathMatch?.[1] === undefined || enabledMatch?.[1] !== "false") continue
    const configured = unquoteTomlString(pathMatch[1])
    if (configured !== undefined && path.isAbsolute(configured)) {
      disabled.add(await canonicalizeConfiguredPath(configured))
    }
  }
  return disabled
}
