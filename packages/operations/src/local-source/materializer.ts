import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises"
import path from "node:path"

import type { ApprovedRootPolicy, LocalSourceManifestV1 } from "@forge/scanner"

import type { ArtifactRef } from "../core/index.js"
import { LocalSourceError } from "./errors.js"
import { inspectStrictTree, strictTreeMatchesManifest } from "./strict-tree.js"
import { validateAdmittedSkillTree } from "./skill-validation.js"
import type { AdmittedLocalSource, LocalSourceMaterializerPort } from "./types.js"
import { streamArchiveEntry } from "./zip.js"

async function writeChunks(
  target: string,
  produce: (write: (chunk: Buffer) => Promise<void>) => Promise<void>,
): Promise<void> {
  const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  let completed = false
  try {
    let position = 0
    await produce(async (chunk) => {
      let offset = 0
      while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset, position)
        offset += result.bytesWritten
        position += result.bytesWritten
      }
    })
    await handle.sync()
    completed = true
  } finally {
    try {
      await handle.close()
    } finally {
      if (!completed) {
        try { await unlink(target) } catch { /* The exclusive file is already absent or externally changed. */ }
      }
    }
  }
}

async function assertNoLinkedComponent(root: string, source: string, relativeFile: string): Promise<void> {
  const relativeSource = path.relative(root, source)
  if (relativeSource === "" || relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
    throw new LocalSourceError("SOURCE_CHANGED", "Source entry moved outside its selected tree", { path: relativeFile })
  }
  let current = root
  for (const segment of relativeSource.split(path.sep)) {
    current = path.join(current, segment)
    const stats = await lstat(current)
    if (stats.isSymbolicLink()) {
      throw new LocalSourceError("SOURCE_CHANGED", "Source gained a link after preview", { path: relativeFile })
    }
  }
  if (await realpath(current) !== current) {
    throw new LocalSourceError("SOURCE_CHANGED", "Source path no longer resolves inside its selected tree", { path: relativeFile })
  }
}

async function copyRegularFile(root: string, source: string, relativeFile: string, target: string): Promise<void> {
  await assertNoLinkedComponent(root, source, relativeFile)
  const sourceHandle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await sourceHandle.stat()
    if (!before.isFile()) throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "Source entry stopped being a regular file")
    await writeChunks(target, async (write) => {
      const buffer = Buffer.allocUnsafe(64 * 1_024)
      let position = 0
      while (position < before.size) {
        const result = await sourceHandle.read(buffer, 0, Math.min(buffer.length, before.size - position), position)
        if (result.bytesRead === 0) throw new LocalSourceError("SOURCE_CHANGED", "Source file was truncated during staging")
        await write(buffer.subarray(0, result.bytesRead))
        position += result.bytesRead
      }
    })
    const after = await sourceHandle.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new LocalSourceError("SOURCE_CHANGED", "Source file changed during staging")
    }
    await assertNoLinkedComponent(root, source, relativeFile)
  } finally {
    await sourceHandle.close()
  }
}

async function removeCreated(createdFiles: readonly string[], createdDirectories: readonly string[]): Promise<void> {
  for (const file of [...createdFiles].reverse()) {
    try { await unlink(file) } catch { /* Leave uncertain paths in place. */ }
  }
  for (const directory of [...createdDirectories].reverse()) {
    try { await rmdir(directory) } catch { /* Never recursively delete. */ }
  }
}

export class FileSystemLocalSourceMaterializer implements LocalSourceMaterializerPort {
  readonly #policy: ApprovedRootPolicy

  constructor(policy: ApprovedRootPolicy) {
    this.#policy = policy
  }

  async materialize(source: AdmittedLocalSource, destination: ArtifactRef): Promise<LocalSourceManifestV1> {
    if (destination.kind !== "tree" || destination.relativePath.includes("/") || destination.relativePath.includes("\\")) {
      throw new LocalSourceError("PATH_INVALID", "Private source staging must be a direct child of its approved cache root")
    }
    const canonical = await this.#policy.authorizeWrite(destination.rootId, destination.relativePath)
    const createdFiles: string[] = []
    const createdDirectories: string[] = []
    const ownedDirectories = new Set<string>()
    try {
      await mkdir(canonical, { mode: 0o700 })
      createdDirectories.push(canonical)
      ownedDirectories.add(canonical)
      const ensureParent = async (relativeFile: string): Promise<string> => {
        const segments = relativeFile.split("/")
        let current: string = canonical
        for (const segment of segments.slice(0, -1)) {
          current = path.join(current, segment)
          try {
            await mkdir(current, { mode: 0o700 })
            createdDirectories.push(current)
            ownedDirectories.add(current)
          } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error
            if (!ownedDirectories.has(current)) {
              throw new LocalSourceError("STAGING_MISMATCH", "An unowned staging directory appeared during materialization")
            }
            const stats = await lstat(current)
            if (stats.isSymbolicLink() || !stats.isDirectory()) throw new LocalSourceError("STAGING_MISMATCH", "Staging parent is not a real directory")
          }
        }
        return path.join(canonical, ...segments)
      }
      if (source.kind === "directory") {
        const sourceEntries = new Map(source.directoryEntries?.map((entry) => [entry.payloadPath, entry.sourcePath]))
        for (const file of source.manifest.files) {
          const target = await ensureParent(file.path)
          const sourcePath = sourceEntries.get(file.path)
          if (sourcePath === undefined) {
            throw new LocalSourceError("SOURCE_CHANGED", "Admitted directory lost its private source entry map", { path: file.path })
          }
          await copyRegularFile(source.sourceLocator, sourcePath, file.path, target)
          createdFiles.push(target)
        }
      } else {
        const entries = source.archiveEntries
        if (entries === undefined) throw new LocalSourceError("ARCHIVE_MALFORMED", "Admitted ZIP has no private entry map")
        for (const entry of entries) {
          if (entry.ignored || entry.kind === "directory" || entry.payloadPath === undefined) continue
          const target = await ensureParent(entry.payloadPath)
          await writeChunks(target, async (write) => {
            await streamArchiveEntry(source.sourceLocator, entry, write, source.identity)
          })
          createdFiles.push(target)
        }
      }
      const staged = await inspectStrictTree(canonical)
      if (!strictTreeMatchesManifest(staged, source.manifest)) {
        throw new LocalSourceError("STAGING_MISMATCH", "Staged files do not exactly match admitted source manifest")
      }
      await validateAdmittedSkillTree(canonical, staged.manifest)
      return staged.manifest
    } catch (error) {
      await removeCreated(createdFiles, createdDirectories)
      if (error instanceof LocalSourceError) throw error
      throw new LocalSourceError("SOURCE_IO", "Could not stage admitted local source", { cause: error })
    }
  }

  async removeExact(destination: ArtifactRef, expectedTreeHash: string): Promise<boolean> {
    const canonical = await this.#policy.authorizeWrite(destination.rootId, destination.relativePath)
    try {
      const inspection = await inspectStrictTree(canonical)
      if (inspection.manifest.treeHash !== expectedTreeHash) return false
      const expectedDirectories = inspection.manifest.files.flatMap(({ path: relative }) => {
        const segments = relative.split("/")
        return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))
      })
      if (new Set(expectedDirectories).size !== inspection.directories.length) return false
      const files = inspection.manifest.files.map(({ path: relative }) => path.join(canonical, ...relative.split("/")))
      const directories = inspection.directories.map((relative) => path.join(canonical, ...relative.split("/")))
      for (const file of files) await unlink(file)
      for (const directory of [...directories].sort((left, right) => right.length - left.length)) await rmdir(directory)
      await rmdir(canonical)
      return true
    } catch {
      return false
    }
  }
}
