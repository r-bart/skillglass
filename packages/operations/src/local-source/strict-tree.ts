import { constants } from "node:fs"
import { createHash } from "node:crypto"
import { lstat, open, opendir } from "node:fs/promises"
import path from "node:path"

import { createLocalSourceManifest, type LocalSourceManifestV1, type ManifestFileV1 } from "@forge/scanner"

import { LocalSourceError } from "./errors.js"
import { admitPortablePath, assertUniquePortablePaths, bytewisePathSort } from "./path-policy.js"
import { LOCAL_SOURCE_LIMITS } from "./types.js"

export interface StrictTreeInspection {
  readonly manifest: LocalSourceManifestV1
  /** Included directory paths below root, including otherwise empty directories. */
  readonly directories: readonly string[]
}

function changed(
  left: Readonly<{ dev: bigint; ino: bigint; size: bigint; mtimeMs: bigint }>,
  right: Readonly<{ dev: bigint; ino: bigint; size: bigint; mtimeMs: bigint }>,
): boolean {
  return left.dev !== right.dev || left.ino !== right.ino || left.size !== right.size || left.mtimeMs !== right.mtimeMs
}

async function hashRegularFile(filename: string, expectedSize: number): Promise<Readonly<{ byteLength: number; sha256: string }>> {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const hash = createHash("sha256")
  let byteLength = 0
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || Number(before.size) !== expectedSize) {
      throw new LocalSourceError("SOURCE_CHANGED", "Staged file changed before hashing")
    }
    const buffer = Buffer.allocUnsafe(64 * 1_024)
    while (byteLength < expectedSize) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length, expectedSize - byteLength), byteLength)
      if (result.bytesRead === 0) throw new LocalSourceError("SOURCE_CHANGED", "Staged file was truncated while hashing")
      byteLength += result.bytesRead
      if (byteLength > LOCAL_SOURCE_LIMITS.singleIncludedFileBytes) {
        throw new LocalSourceError("RESOURCE_LIMIT", "Staged file exceeds local-source-v1")
      }
      hash.update(buffer.subarray(0, result.bytesRead))
    }
    const after = await handle.stat({ bigint: true })
    if (changed(before, after) || Number(after.size) !== byteLength) {
      throw new LocalSourceError("SOURCE_CHANGED", "Staged file changed while hashing")
    }
  } finally {
    await handle.close()
  }
  return { byteLength, sha256: hash.digest("hex") }
}

/** Hashes every entry, including metadata normally ignored at source admission. */
export async function inspectStrictTree(root: string): Promise<StrictTreeInspection> {
  const rootStats = await lstat(root, { bigint: true })
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new LocalSourceError("SOURCE_TYPE", "Expected a real staged directory")
  }
  const files: ManifestFileV1[] = []
  const paths: Array<{ path: string; kind: "file" | "directory" }> = []
  const directories: string[] = []
  let total = 0
  const visit = async (directory: string, parent: string): Promise<void> => {
    const handle = await opendir(directory)
    for await (const entry of handle) {
      const raw = parent === "" ? entry.name : `${parent}/${entry.name}`
      const logical = admitPortablePath(raw).normalized
      const absolute = path.join(directory, entry.name)
      const stats = await lstat(absolute, { bigint: true })
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Staged tree contains a link or special entry", { path: logical })
      }
      if (stats.dev !== rootStats.dev) {
        throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Staged tree crosses a mount or reparse boundary", { path: logical })
      }
      if (stats.isDirectory()) {
        directories.push(logical)
        if (directories.length > LOCAL_SOURCE_LIMITS.includedDirectories) {
          throw new LocalSourceError("RESOURCE_LIMIT", "Staged tree contains too many directories")
        }
        paths.push({ path: logical, kind: "directory" })
        await visit(absolute, logical)
      } else {
        const hashed = await hashRegularFile(absolute, Number(stats.size))
        total += hashed.byteLength
        if (files.length + 1 > LOCAL_SOURCE_LIMITS.includedRegularFiles || total > LOCAL_SOURCE_LIMITS.directoryIncludedBytes) {
          throw new LocalSourceError("RESOURCE_LIMIT", "Staged tree exceeds local-source-v1")
        }
        paths.push({ path: logical, kind: "file" })
        files.push({ path: logical, ...hashed })
      }
    }
  }
  await visit(root, "")
  assertUniquePortablePaths(paths)
  files.sort((left, right) => bytewisePathSort(left.path, right.path))
  directories.sort(bytewisePathSort)
  return { manifest: createLocalSourceManifest(files), directories }
}

export async function hashStrictTree(root: string): Promise<LocalSourceManifestV1> {
  return inspectStrictTree(root).then(({ manifest }) => manifest)
}

export function expectedNonEmptyDirectories(manifest: LocalSourceManifestV1): readonly string[] {
  const directories = new Set<string>()
  for (const file of manifest.files) {
    const segments = file.path.split("/")
    for (let length = 1; length < segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"))
    }
  }
  return [...directories].sort(bytewisePathSort)
}

export function strictTreeMatchesManifest(
  inspection: StrictTreeInspection,
  expected: LocalSourceManifestV1,
): boolean {
  return inspection.manifest.treeHash === expected.treeHash &&
    JSON.stringify(inspection.manifest.files) === JSON.stringify(expected.files) &&
    JSON.stringify(inspection.directories) === JSON.stringify(expectedNonEmptyDirectories(expected))
}
