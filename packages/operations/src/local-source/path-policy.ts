import { Buffer } from "node:buffer"

import { isIgnoredMetadata, validatePortableRelativePath } from "@forge/scanner"

import { LocalSourceError } from "./errors.js"

const REPOSITORY_DIRECTORIES = new Set([".git", ".hg", ".svn"])

export interface AdmittedPath {
  readonly normalized: string
  readonly collisionKey: string
}

function unicodeDefaultCaseFold(value: string): string {
  // ECMAScript has no direct toCaseFold API. Upper-then-lower applies the
  // Unicode default mappings, including expansions such as sharp-s -> ss.
  return value.normalize("NFC").toUpperCase().toLowerCase()
}

export function admitPortablePath(rawPath: string): AdmittedPath {
  const result = validatePortableRelativePath(rawPath)
  if (result.normalized === undefined || result.collisionKey === undefined) {
    const finding = result.findings[0]
    throw new LocalSourceError(
      "PATH_INVALID",
      finding?.message ?? "Archive entry path is not portable",
      { path: rawPath },
    )
  }
  return { normalized: result.normalized, collisionKey: unicodeDefaultCaseFold(result.normalized) }
}

export function portableCollisionKey(path: string): string {
  return admitPortablePath(path).collisionKey
}

export function portableNameCollisionKey(name: string): string {
  return unicodeDefaultCaseFold(name)
}

export function isIgnoredArchiveMetadata(normalized: string): boolean {
  const segments = normalized.split("/")
  if (segments[0] === "__MACOSX") return true
  if (isIgnoredMetadata(normalized)) return true
  return segments.some((segment) => REPOSITORY_DIRECTORIES.has(segment))
}

export function bytewisePathSort(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

export function assertUniquePortablePaths(
  entries: readonly Readonly<{ path: string; kind: "file" | "directory" }>[],
): void {
  const normalized = new Map<string, "file" | "directory">()
  const portable = new Map<string, string>()
  for (const entry of entries) {
    const admitted = admitPortablePath(entry.path)
    const existingKind = normalized.get(admitted.normalized)
    if (existingKind !== undefined || portable.has(admitted.collisionKey)) {
      throw new LocalSourceError("PATH_COLLISION", "Source contains a duplicate or portable path collision", { path: entry.path })
    }
    normalized.set(admitted.normalized, entry.kind)
    portable.set(admitted.collisionKey, admitted.normalized)
  }
  for (const [path, kind] of normalized) {
    const segments = path.split("/")
    for (let length = 1; length < segments.length; length += 1) {
      const prefix = segments.slice(0, length).join("/")
      if (normalized.get(prefix) === "file") {
        throw new LocalSourceError("PATH_COLLISION", "A file conflicts with a descendant path", { path })
      }
    }
    if (kind === "file" && [...normalized.keys()].some((candidate) => candidate.startsWith(`${path}/`))) {
      throw new LocalSourceError("PATH_COLLISION", "A file conflicts with a directory prefix", { path })
    }
  }
}

export function assertUniqueImplicitDirectories(paths: readonly string[]): void {
  const byCollisionKey = new Map<string, string>()
  for (const candidate of paths) {
    const segments = candidate.split("/")
    for (let length = 1; length < segments.length; length += 1) {
      const directory = segments.slice(0, length).join("/")
      const key = unicodeDefaultCaseFold(directory)
      const previous = byCollisionKey.get(key)
      if (previous !== undefined && previous !== directory) {
        throw new LocalSourceError("PATH_COLLISION", "Source contains a portable directory collision", { path: directory })
      }
      byCollisionKey.set(key, directory)
    }
  }
}
