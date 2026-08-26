import { constants } from "node:fs"
import { createHash } from "node:crypto"
import { lstat, open, opendir, realpath } from "node:fs/promises"
import path from "node:path"

import {
  createLocalSourceManifest,
  type LocalSourceManifestV1,
  type ManifestFileV1,
} from "@forge/scanner"

import { LocalSourceError } from "./errors.js"
import { DirectorySourceLimitCounter } from "./limits.js"
import {
  admitPortablePath,
  assertUniquePortablePaths,
  bytewisePathSort,
  isIgnoredArchiveMetadata,
} from "./path-policy.js"
import { validateAdmittedSkillTree } from "./skill-validation.js"
import {
  LOCAL_SOURCE_LIMITS,
  type AdmittedLocalSource,
  type IgnoredEntrySummary,
  type SourceIdentity,
} from "./types.js"

interface SourceFile {
  readonly path: string
  readonly absolutePath: string
  readonly device: bigint
  readonly inode: bigint
  readonly size: number
  readonly modifiedMilliseconds: number
}

interface DirectoryIdentity {
  readonly absolutePath: string
  readonly device: bigint
  readonly inode: bigint
  readonly modifiedMilliseconds: number
}

export async function sourceIdentity(pathname: string): Promise<SourceIdentity> {
  const stats = await lstat(pathname, { bigint: true })
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    size: Number(stats.size),
    modifiedMilliseconds: Number(stats.mtimeMs),
  }
}

function identityChanged(
  expected: Readonly<{ device: bigint; inode: bigint; modifiedMilliseconds: number }>,
  actual: Readonly<{ dev: bigint; ino: bigint; mtimeMs: bigint }>,
): boolean {
  return expected.device !== actual.dev || expected.inode !== actual.ino ||
    expected.modifiedMilliseconds !== Number(actual.mtimeMs)
}

function ignoredCategory(relativePath: string): string {
  const segments = relativePath.split("/")
  if (segments.some((segment) => segment === ".git" || segment === ".hg" || segment === ".svn")) {
    return "vcs"
  }
  if (segments.at(-1)?.startsWith("._") === true) return "apple-double"
  return "os-metadata"
}

async function enumerateDirectory(root: string): Promise<Readonly<{
  files: readonly SourceFile[]
  directories: readonly DirectoryIdentity[]
  ignoredEntries: IgnoredEntrySummary
}>> {
  const rootStats = await lstat(root, { bigint: true })
  const files: SourceFile[] = []
  const directories: DirectoryIdentity[] = []
  const paths: Array<{ path: string; kind: "file" | "directory" }> = []
  const ignored: string[] = []
  const limits = new DirectorySourceLimitCounter()

  const visit = async (directory: string, logicalParent: string): Promise<void> => {
    const directoryStats = await lstat(directory, { bigint: true })
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Directory source changed into a link or special entry", { path: logicalParent })
    }
    if (directoryStats.dev !== rootStats.dev) {
      throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Directory source crosses a mount or reparse boundary", { path: logicalParent })
    }
    directories.push({
      absolutePath: directory,
      device: directoryStats.dev,
      inode: directoryStats.ino,
      modifiedMilliseconds: Number(directoryStats.mtimeMs),
    })
    const handle = await opendir(directory)
    for await (const entry of handle) {
      const logicalRaw = logicalParent === "" ? entry.name : `${logicalParent}/${entry.name}`
      const logical = admitPortablePath(logicalRaw).normalized
      const candidate = path.join(directory, entry.name)
      const stats = await lstat(candidate, { bigint: true })
      if (stats.isSymbolicLink()) {
        throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Directory sources cannot contain links or junctions", { path: logical })
      }
      if (stats.dev !== rootStats.dev) {
        throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Directory sources cannot cross a mount or reparse boundary", { path: logical })
      }
      const ignoredEntry = isIgnoredArchiveMetadata(logical)
      if (stats.isDirectory()) {
        if (ignoredEntry) {
          ignored.push(logical)
          continue
        }
        limits.includeDirectory(logical)
        paths.push({ path: logical, kind: "directory" })
        await visit(candidate, logical)
      } else if (stats.isFile()) {
        if (ignoredEntry) {
          ignored.push(logical)
          continue
        }
        const size = Number(stats.size)
        limits.includeFile(size, logical)
        paths.push({ path: logical, kind: "file" })
        files.push({
          path: logical,
          absolutePath: candidate,
          device: stats.dev,
          inode: stats.ino,
          size,
          modifiedMilliseconds: Number(stats.mtimeMs),
        })
      } else {
        throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Only regular files and directories are admitted", { path: logical })
      }
    }
  }

  await visit(root, "")
  assertUniquePortablePaths(paths)
  return {
    files: files.sort((left, right) => bytewisePathSort(left.path, right.path)),
    directories,
    ignoredEntries: {
      count: ignored.length,
      categories: [...new Set(ignored.map(ignoredCategory))].sort(),
    },
  }
}

async function hashSourceFile(file: SourceFile): Promise<Omit<ManifestFileV1, "path">> {
  const handle = await open(file.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const hash = createHash("sha256")
  let byteLength = 0
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || identityChanged(file, before) || Number(before.size) !== file.size) {
      throw new LocalSourceError("SOURCE_CHANGED", "Source file changed before hashing", { path: file.path })
    }
    const buffer = Buffer.allocUnsafe(64 * 1_024)
    while (byteLength < file.size) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length, file.size - byteLength), byteLength)
      if (result.bytesRead === 0) throw new LocalSourceError("SOURCE_CHANGED", "Source file was truncated while hashing", { path: file.path })
      byteLength += result.bytesRead
      if (byteLength > LOCAL_SOURCE_LIMITS.singleIncludedFileBytes) {
        throw new LocalSourceError("RESOURCE_LIMIT", "Source file exceeded the single-file limit while hashing", { path: file.path })
      }
      hash.update(buffer.subarray(0, result.bytesRead))
    }
    const after = await handle.stat({ bigint: true })
    if (identityChanged(file, after) || Number(after.size) !== byteLength) {
      throw new LocalSourceError("SOURCE_CHANGED", "Source file changed while hashing", { path: file.path })
    }
  } finally {
    await handle.close()
  }
  return { byteLength, sha256: hash.digest("hex") }
}

async function hashEnumeration(
  files: readonly SourceFile[],
  directories: readonly DirectoryIdentity[],
): Promise<LocalSourceManifestV1> {
  const manifestFiles: ManifestFileV1[] = []
  let totalBytes = 0
  for (const file of files) {
    const hashed = await hashSourceFile(file)
    totalBytes += hashed.byteLength
    if (totalBytes > LOCAL_SOURCE_LIMITS.directoryIncludedBytes) {
      throw new LocalSourceError("RESOURCE_LIMIT", "Directory source exceeded its byte limit while hashing")
    }
    manifestFiles.push({ path: file.path, ...hashed })
  }
  for (const directory of directories) {
    const current = await lstat(directory.absolutePath, { bigint: true })
    if (!current.isDirectory() || current.isSymbolicLink() || identityChanged(directory, current)) {
      throw new LocalSourceError("SOURCE_CHANGED", "Directory source changed while it was inspected")
    }
  }
  return createLocalSourceManifest(manifestFiles)
}

export async function inspectDirectorySource(
  selectedPath: string,
  observedAt: string,
): Promise<AdmittedLocalSource> {
  try {
    const selectedStats = await lstat(selectedPath)
    if (selectedStats.isSymbolicLink() || !selectedStats.isDirectory()) {
      throw new LocalSourceError("SOURCE_TYPE", "Selected directory source must be a real directory")
    }
    const canonical = await realpath(selectedPath)
    const canonicalStats = await lstat(canonical)
    if (
      !canonicalStats.isDirectory() || canonicalStats.isSymbolicLink() ||
      canonicalStats.dev !== selectedStats.dev || canonicalStats.ino !== selectedStats.ino
    ) throw new LocalSourceError("SOURCE_CHANGED", "Selected directory changed during canonicalization")
    const enumeration = await enumerateDirectory(canonical)
    const manifest = await hashEnumeration(enumeration.files, enumeration.directories)
    await validateAdmittedSkillTree(canonical, manifest)
    return {
      contract: "local-source-v1",
      kind: "directory",
      sourceLocator: canonical,
      identity: await sourceIdentity(canonical),
      observedAt,
      manifest,
      ignoredEntries: enumeration.ignoredEntries,
      directoryEntries: enumeration.files.map((file) => ({
        payloadPath: file.path,
        sourcePath: file.absolutePath,
      })),
    }
  } catch (error) {
    if (error instanceof LocalSourceError) throw error
    throw new LocalSourceError("SOURCE_IO", "Could not safely inspect the selected directory", {
      path: selectedPath,
      cause: error,
    })
  }
}
