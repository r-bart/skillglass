import { Buffer } from "node:buffer"

import { LOCAL_SOURCE_LIMITS_V1, type ScannerFinding } from "./types.js"

const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

export interface PortablePathResult {
  readonly normalized?: string
  readonly collisionKey?: string
  readonly findings: readonly ScannerFinding[]
}

export function validatePortableRelativePath(input: string): PortablePathResult {
  const findings: ScannerFinding[] = []
  if (
    input.startsWith("/") ||
    input.startsWith("\\") ||
    /^[A-Za-z]:/.test(input) ||
    /^\\\\/.test(input) ||
    /^\\[?.]\\/.test(input)
  ) {
    findings.push({ code: "PATH_ABSOLUTE", severity: "error", message: "Paths must be relative", path: input })
    return { findings }
  }
  if (containsControlCharacter(input)) {
    findings.push({ code: "PATH_CONTROL_CHARACTER", severity: "error", message: "Paths cannot contain control characters", path: input })
    return { findings }
  }

  const rawSegments = input.split(/[\\/]/)
  const normalizedSegments: string[] = []
  for (const rawSegment of rawSegments) {
    const segment = rawSegment.normalize("NFC")
    if (segment.length === 0 || segment === "." || segment === "..") {
      findings.push({ code: "PATH_TRAVERSAL", severity: "error", message: "Paths cannot contain empty, dot, or parent segments", path: input })
      continue
    }
    if (segment.endsWith(" ") || segment.endsWith(".") || segment.includes(":")) {
      findings.push({ code: "PATH_NOT_PORTABLE", severity: "error", message: "Path is not portable across supported platforms", path: input })
    }
    if (RESERVED_WINDOWS_BASENAME.test(segment)) {
      findings.push({ code: "PATH_WINDOWS_RESERVED", severity: "error", message: "Path uses a Windows-reserved basename", path: input })
    }
    if (Buffer.byteLength(segment, "utf8") > LOCAL_SOURCE_LIMITS_V1.pathSegmentUtf8Bytes) {
      findings.push({ code: "PATH_SEGMENT_LIMIT", severity: "error", message: "A path segment exceeds the local-source-v1 limit", path: input })
    }
    normalizedSegments.push(segment)
  }
  const normalized = normalizedSegments.join("/")
  if (normalizedSegments.length > LOCAL_SOURCE_LIMITS_V1.relativeNestingSegments) {
    findings.push({ code: "PATH_DEPTH_LIMIT", severity: "error", message: "Path nesting exceeds the local-source-v1 limit", path: input })
  }
  if (Buffer.byteLength(normalized, "utf8") > LOCAL_SOURCE_LIMITS_V1.relativePathUtf8Bytes) {
    findings.push({ code: "PATH_LENGTH_LIMIT", severity: "error", message: "Path exceeds the local-source-v1 UTF-8 limit", path: input })
  }
  return findings.length > 0
    ? { findings }
    : { normalized, collisionKey: normalized.toLocaleLowerCase("en-US"), findings }
}

export function isIgnoredMetadata(relativePath: string): boolean {
  const segments = relativePath.split("/")
  const basename = segments.at(-1) ?? ""
  const lower = basename.toLocaleLowerCase("en-US")
  if (lower === ".ds_store" || lower === "thumbs.db" || lower === "desktop.ini") return true
  if (basename.startsWith("._")) return true
  return segments.some((segment) => segment === ".git" || segment === ".hg" || segment === ".svn")
}
