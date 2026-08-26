import { constants as fsConstants, type Stats } from "node:fs"
import {
  access,
  lstat,
  realpath,
  stat,
} from "node:fs/promises"
import path from "node:path"

import { canonicalPath, type CanonicalPath } from "@forge/domain"

import {
  PathAuthorizationError,
  type CanonicalPathResolution,
  type PathFlavor,
  type PathSemantics,
} from "./types.js"

export function nativePathFlavor(): PathFlavor {
  return process.platform === "win32" ? "win32" : "posix"
}

export function pathImplementation(flavor: PathFlavor = nativePathFlavor()) {
  return flavor === "win32" ? path.win32 : path.posix
}

function validatePathInput(input: string): void {
  if (input.length === 0) {
    throw new PathAuthorizationError("INVALID_PATH", "Path cannot be empty")
  }

  if (input.includes("\0")) {
    throw new PathAuthorizationError(
      "INVALID_PATH",
      "Path cannot contain a null byte",
    )
  }
}

/**
 * Normalizes path syntax without consulting the filesystem. This is useful for
 * displaying missing/denied roots, but it does not prove filesystem identity.
 */
export function canonicalizeLexicalPath(
  input: string,
  semantics: PathSemantics = {},
): CanonicalPath {
  validatePathInput(input)
  const flavor = semantics.flavor ?? nativePathFlavor()
  const implementation = pathImplementation(flavor)
  const cwd = semantics.cwd ?? process.cwd()
  const resolved = implementation.resolve(cwd, input)
  const parsed = implementation.parse(resolved)
  let normalized = implementation.normalize(resolved)

  if (normalized !== parsed.root && normalized.endsWith(implementation.sep)) {
    normalized = normalized.slice(0, -1)
  }

  if (flavor === "win32" && /^[a-z]:/.test(normalized)) {
    normalized = `${normalized[0]?.toUpperCase()}${normalized.slice(1)}`
  }

  return canonicalPath(normalized)
}

function filesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }

  return typeof error.code === "string" ? error.code : undefined
}

function translateFilesystemError(error: unknown): never {
  const code = filesystemErrorCode(error)

  if (code === "ELOOP") {
    throw new PathAuthorizationError(
      "SYMLINK_CYCLE",
      "A symlink or junction cycle was detected",
      { cause: error },
    )
  }

  if (code === "EACCES" || code === "EPERM") {
    throw new PathAuthorizationError(
      "FILESYSTEM_DENIED",
      "The filesystem denied access without elevation",
      { cause: error },
    )
  }

  if (code === "ENOENT" || code === "ENOTDIR") {
    throw new PathAuthorizationError("PATH_NOT_FOUND", "Path does not exist", {
      cause: error,
    })
  }

  throw error
}

function statsIdentity(stats: Stats): string {
  return `${stats.dev.toString()}:${stats.ino.toString()}`
}

async function lstatIfPresent(candidate: string): Promise<Stats | undefined> {
  try {
    return await lstat(candidate)
  } catch (error) {
    const code = filesystemErrorCode(error)
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    translateFilesystemError(error)
  }
}

/**
 * Resolves symlinks/junctions with realpath. For a future write destination it
 * resolves the nearest existing ancestor, then appends only nonexistent path
 * segments. A broken link is never treated as an ordinary missing path.
 */
export async function resolveCanonicalPath(
  input: string,
  options: PathSemantics & { readonly allowMissing?: boolean } = {},
): Promise<CanonicalPathResolution> {
  const flavor = options.flavor ?? nativePathFlavor()
  if (flavor !== nativePathFlavor()) {
    throw new PathAuthorizationError(
      "INVALID_PATH",
      "Filesystem canonicalization requires native path semantics",
    )
  }

  const implementation = pathImplementation(flavor)
  const absolute = canonicalizeLexicalPath(input, options)
  let cursor: string = absolute
  const missingSegments: string[] = []

  for (;;) {
    try {
      const resolved = await realpath(cursor)
      const resolvedStats = await stat(resolved)
      const combined =
        missingSegments.length === 0
          ? resolved
          : implementation.join(resolved, ...missingSegments)

      return {
        canonicalPath: canonicalizeLexicalPath(combined, options),
        exists: missingSegments.length === 0,
        identity: statsIdentity(resolvedStats),
        existingAncestor: canonicalizeLexicalPath(resolved, options),
      }
    } catch (error) {
      const code = filesystemErrorCode(error)
      if (code === "ELOOP") translateFilesystemError(error)
      if (code === "EACCES" || code === "EPERM") {
        translateFilesystemError(error)
      }

      if (code !== "ENOENT" && code !== "ENOTDIR") throw error
      if (!options.allowMissing) translateFilesystemError(error)

      // lstat can see a broken symlink even though realpath reports ENOENT.
      // Such a link is an unresolved alias and is rejected, never authorized as
      // a new destination.
      const unresolvedEntry = await lstatIfPresent(cursor)
      if (unresolvedEntry?.isSymbolicLink()) {
        throw new PathAuthorizationError(
          "PATH_NOT_FOUND",
          "A broken symlink or junction cannot be authorized",
          { cause: error },
        )
      }

      const parent = implementation.dirname(cursor)
      if (parent === cursor) translateFilesystemError(error)
      missingSegments.unshift(implementation.basename(cursor))
      cursor = parent
    }
  }
}

export async function assertReadable(candidate: string): Promise<void> {
  try {
    await access(candidate, fsConstants.R_OK)
  } catch (error) {
    translateFilesystemError(error)
  }
}

export async function assertWritable(candidate: string): Promise<void> {
  try {
    await access(candidate, fsConstants.W_OK)
  } catch (error) {
    const code = filesystemErrorCode(error)
    if (code === "EACCES" || code === "EPERM") {
      throw new PathAuthorizationError(
        "ROOT_NOT_WRITABLE",
        "The destination is not writable without elevation",
        { cause: error },
      )
    }
    translateFilesystemError(error)
  }
}
