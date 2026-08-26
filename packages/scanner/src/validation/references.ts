import path from "node:path"

import type { ResourceReference, ScannerFinding } from "./types.js"

interface ReferenceValidation {
  readonly references: readonly ResourceReference[]
  readonly findings: readonly ScannerFinding[]
}

function markdownTargets(source: string): readonly string[] {
  const targets: string[] = []
  const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g
  for (const match of source.matchAll(inline)) {
    const target = match[1] ?? match[2]
    if (target !== undefined) targets.push(target)
  }
  const definitions = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm
  for (const match of source.matchAll(definitions)) {
    const target = match[1] ?? match[2]
    if (target !== undefined) targets.push(target)
  }
  return targets
}

export function validateResourceReferences(
  rawBody: string,
  availablePaths: ReadonlySet<string>,
  sourcePath = "SKILL.md",
): ReferenceValidation {
  const references: ResourceReference[] = []
  const findings: ScannerFinding[] = []
  for (const rawTarget of markdownTargets(rawBody)) {
    if (rawTarget.startsWith("#")) {
      references.push({ source: sourcePath, rawTarget, kind: "anchor" })
      continue
    }
    if (/^(?:https?:|mailto:|data:|file:|javascript:|[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawTarget)) {
      references.push({ source: sourcePath, rawTarget, kind: "external" })
      findings.push({ code: "RESOURCE_EXTERNAL_REFERENCE", severity: "error", message: "External resource references are not admitted", path: sourcePath })
      continue
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0] ?? "")
    } catch {
      references.push({ source: sourcePath, rawTarget, kind: "unsafe" })
      findings.push({ code: "RESOURCE_REFERENCE_INVALID_ENCODING", severity: "error", message: "Resource reference is not valid percent-encoded text", path: sourcePath })
      continue
    }
    const slashPath = decoded.replaceAll("\\", "/")
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), slashPath)).normalize("NFC")
    if (slashPath.startsWith("/") || /^[A-Za-z]:/.test(slashPath) || resolved === ".." || resolved.startsWith("../")) {
      references.push({ source: sourcePath, rawTarget, kind: "unsafe" })
      findings.push({ code: "RESOURCE_REFERENCE_OUTSIDE_ROOT", severity: "error", message: "Resource reference escapes the skill root", path: sourcePath })
      continue
    }
    const exists = availablePaths.has(resolved)
    references.push({ source: sourcePath, rawTarget, resolvedPath: resolved, kind: "local", exists })
    if (!exists) {
      findings.push({ code: "RESOURCE_REFERENCE_BROKEN", severity: "warning", message: `Referenced resource does not exist: ${resolved}`, path: sourcePath })
    }
  }
  return { references, findings }
}
