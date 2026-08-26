import { stat } from "node:fs/promises"

import type { RootAccess, RootKind } from "@forge/domain"

import {
  canonicalizeLexicalPath,
  nativePathFlavor,
  resolveCanonicalPath,
} from "./canonicalize.js"
import {
  PathAuthorizationError,
  type ApprovedRoot,
  type ApprovedRootInput,
  type PathSemantics,
} from "./types.js"

interface MutableApprovedRoot {
  rootId: string
  aliasRootIds: string[]
  canonicalPath: ApprovedRoot["canonicalPath"]
  kind: RootKind
  access: RootAccess
  writableWithoutElevation: boolean
}

const ACCESS_RESTRICTION: Record<RootAccess, number> = {
  "read-write": 0,
  "read-only": 1,
  missing: 2,
  denied: 3,
}

const KIND_RESTRICTION: Record<RootKind, number> = {
  global: 0,
  project: 0,
  "user-added": 0,
  managed: 1,
  system: 2,
}

function moreRestrictiveAccess(left: RootAccess, right: RootAccess): RootAccess {
  return ACCESS_RESTRICTION[left] >= ACCESS_RESTRICTION[right] ? left : right
}

function moreRestrictiveKind(left: RootKind, right: RootKind): RootKind {
  return KIND_RESTRICTION[left] >= KIND_RESTRICTION[right] ? left : right
}

function pathKey(path: string, semantics: PathSemantics): string {
  const flavor = semantics.flavor ?? nativePathFlavor()
  const caseSensitive = semantics.caseSensitive ?? flavor !== "win32"
  return caseSensitive ? path : path.toLocaleLowerCase("en-US")
}

async function canonicalizeRoot(
  input: ApprovedRootInput,
  semantics: PathSemantics,
): Promise<MutableApprovedRoot> {
  let canonical = canonicalizeLexicalPath(input.path, semantics)

  if (input.access !== "missing" && input.access !== "denied") {
    const resolution = await resolveCanonicalPath(input.path, semantics)
    canonical = resolution.canonicalPath
    const rootStats = await stat(canonical)
    if (!rootStats.isDirectory()) {
      throw new PathAuthorizationError(
        "ROOT_NOT_DIRECTORY",
        "An approved root must be a directory",
        { rootId: input.rootId },
      )
    }
  }

  return {
    rootId: input.rootId,
    aliasRootIds: [],
    canonicalPath: canonical,
    kind: input.kind,
    access: input.access,
    writableWithoutElevation: input.writableWithoutElevation,
  }
}

/**
 * Resolves physical aliases and merges duplicate capabilities conservatively.
 * Any managed/system/read-only alias makes the physical root equally
 * restrictive through every alias ID, preventing a privilege bypass.
 */
export async function deduplicateApprovedRoots(
  inputs: readonly ApprovedRootInput[],
  semantics: PathSemantics = {},
): Promise<readonly ApprovedRoot[]> {
  const ids = new Set<string>()
  const canonicalRoots: MutableApprovedRoot[] = []
  const byIdentity = new Map<string, MutableApprovedRoot>()

  for (const input of inputs) {
    if (input.rootId.length === 0 || ids.has(input.rootId)) {
      throw new PathAuthorizationError(
        "DUPLICATE_ROOT_ID",
        "Approved root IDs must be non-empty and unique",
        { rootId: input.rootId },
      )
    }
    ids.add(input.rootId)

    const candidate = await canonicalizeRoot(input, semantics)
    // realpath has already collapsed symlink/junction aliases. Comparing its
    // canonical result is safer than relying on inode values, which can be
    // unavailable or non-unique on some Windows filesystems.
    const identityKey = `path:${pathKey(candidate.canonicalPath, semantics)}`
    const existing = byIdentity.get(identityKey)

    if (existing === undefined) {
      canonicalRoots.push(candidate)
      byIdentity.set(identityKey, candidate)
      continue
    }

    existing.aliasRootIds.push(candidate.rootId)
    existing.kind = moreRestrictiveKind(existing.kind, candidate.kind)
    existing.access = moreRestrictiveAccess(existing.access, candidate.access)
    existing.writableWithoutElevation =
      existing.writableWithoutElevation &&
      candidate.writableWithoutElevation &&
      existing.access === "read-write" &&
      existing.kind !== "managed" &&
      existing.kind !== "system"
  }

  return canonicalRoots.map((root) =>
    Object.freeze({
      ...root,
      aliasRootIds: Object.freeze([...root.aliasRootIds]),
    }),
  )
}
