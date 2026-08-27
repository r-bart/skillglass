import { createHash } from "node:crypto"
import { lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { createLocalSourceManifest, type ApprovedRootPolicy } from "@forge/scanner"

import type { ArtifactObservation, ArtifactRef, FileSystemPort, TreeContentEntry } from "../core/index.js"
import { sourceIdentity } from "./directory.js"
import { LocalSourceError } from "./errors.js"
import { FileSystemLocalSourceMaterializer } from "./materializer.js"
import { admitPortablePath, assertUniquePortablePaths, bytewisePathSort } from "./path-policy.js"
import { inspectStrictTree, strictTreeMatchesManifest } from "./strict-tree.js"

function filesystemCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

const TRANSIENT_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"])

async function renameWithTransientRetry(sourcePath: string, destinationPath: string): Promise<void> {
  const maximumAttempts = 8
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath)
      return
    } catch (error) {
      if (!TRANSIENT_RENAME_CODES.has(filesystemCode(error) ?? "") || attempt === maximumAttempts) {
        throw error
      }
      // Windows can briefly retain a directory handle after validation or a
      // watcher event. Retrying the same sibling rename preserves atomicity.
      await delay(attempt * 25)
    }
  }
}

function assertTree(reference: ArtifactRef): void {
  if (reference.kind !== "tree") {
    throw new LocalSourceError("SOURCE_TYPE", "Local install filesystem accepts tree artifacts only")
  }
}

/** Filesystem implementation for local-install plans over approved roots. */
export class ApprovedRootLocalInstallFileSystem implements FileSystemPort {
  readonly #policy: ApprovedRootPolicy
  readonly #materializer: FileSystemLocalSourceMaterializer
  constructor(policy: ApprovedRootPolicy) {
    this.#policy = policy
    this.#materializer = new FileSystemLocalSourceMaterializer(policy)
  }

  async authorize(reference: ArtifactRef, access: "read" | "write"): Promise<void> {
    assertTree(reference)
    if (access === "read") {
      await this.#policy.authorizeRead(reference.rootId, reference.relativePath)
    } else {
      await this.#policy.authorizeWrite(reference.rootId, reference.relativePath)
    }
  }

  async observe(reference: ArtifactRef): Promise<ArtifactObservation> {
    assertTree(reference)
    try {
      const canonical = await this.#policy.authorizeRead(reference.rootId, reference.relativePath)
      return { exists: true, hash: (await inspectStrictTree(canonical)).manifest.treeHash }
    } catch (error) {
      if (filesystemCode(error) === "ENOENT" || (
        typeof error === "object" && error !== null && "code" in error && error.code === "PATH_NOT_FOUND"
      )) return { exists: false }
      throw error
    }
  }

  async copyExclusive(source: ArtifactRef, destination: ArtifactRef): Promise<void> {
    assertTree(source)
    assertTree(destination)
    const sourcePath = await this.#policy.authorizeRead(source.rootId, source.relativePath)
    const inspected = await inspectStrictTree(sourcePath)
    if (!strictTreeMatchesManifest(inspected, inspected.manifest)) {
      throw new LocalSourceError("STAGING_MISMATCH", "Operation source contains unexpected empty directories")
    }
    await this.#materializer.materialize({
      contract: "local-source-v1",
      kind: "directory",
      sourceLocator: sourcePath,
      identity: await sourceIdentity(sourcePath),
      observedAt: new Date().toISOString(),
      manifest: inspected.manifest,
      ignoredEntries: { count: 0, categories: [] },
      directoryEntries: inspected.manifest.files.map((file) => ({
        payloadPath: file.path,
        sourcePath: path.join(sourcePath, ...file.path.split("/")),
      })),
    }, destination)
  }

  async writeFileExclusive(): Promise<void> {
    throw new LocalSourceError("SOURCE_TYPE", "Local install filesystem does not write direct-content artifacts")
  }

  async writeTreeExclusive(destination: ArtifactRef, entries: readonly TreeContentEntry[]): Promise<void> {
    assertTree(destination)
    const canonical = await this.#policy.authorizeWrite(destination.rootId, destination.relativePath)
    const admitted = entries.map((entry) => ({
      path: admitPortablePath(entry.relativePath).normalized,
      content: entry.content,
      kind: "file" as const,
    })).sort((left, right) => bytewisePathSort(left.path, right.path))
    assertUniquePortablePaths(admitted)
    const manifest = createLocalSourceManifest(admitted.map((entry) => ({
      path: entry.path,
      byteLength: Buffer.byteLength(entry.content, "utf8"),
      sha256: createHash("sha256").update(entry.content).digest("hex"),
    })))
    const createdFiles: string[] = []
    const createdDirectories: string[] = []
    const ownedDirectories = new Set<string>()
    try {
      await mkdir(canonical, { mode: 0o700 })
      createdDirectories.push(canonical)
      ownedDirectories.add(canonical)
      for (const entry of admitted) {
        const segments = entry.path.split("/")
        let parent: string = canonical
        for (const segment of segments.slice(0, -1)) {
          parent = path.join(parent, segment)
          if (ownedDirectories.has(parent)) continue
          await mkdir(parent, { mode: 0o700 })
          createdDirectories.push(parent)
          ownedDirectories.add(parent)
        }
        const target = path.join(canonical, ...segments)
        const handle = await open(target, "wx", 0o600)
        createdFiles.push(target)
        try {
          await handle.writeFile(entry.content, "utf8")
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
      const inspected = await inspectStrictTree(canonical)
      if (!strictTreeMatchesManifest(inspected, manifest)) {
        throw new LocalSourceError("STAGING_MISMATCH", "Created content does not match its planned manifest")
      }
    } catch (error) {
      for (const file of [...createdFiles].reverse()) {
        try { await unlink(file) } catch { /* Preserve uncertain paths. */ }
      }
      for (const directory of [...createdDirectories].reverse()) {
        try { await rmdir(directory) } catch { /* Never recursively delete. */ }
      }
      throw error
    }
  }

  async replace(source: ArtifactRef, destination: ArtifactRef, mode: "create" | "update"): Promise<void> {
    assertTree(source)
    assertTree(destination)
    const sourcePath = await this.#policy.authorizeWrite(source.rootId, source.relativePath)
    const destinationPath = await this.#policy.authorizeWrite(destination.rootId, destination.relativePath)
    if (path.dirname(sourcePath) !== path.dirname(destinationPath)) {
      throw new LocalSourceError("DESTINATION_NOT_WRITABLE", "Install publication requires same-filesystem sibling staging")
    }
    let destinationExists = false
    try {
      const destinationStats = await lstat(destinationPath)
      if (destinationStats.isSymbolicLink() || !destinationStats.isDirectory()) {
        throw new LocalSourceError("UPDATE_CONFLICT", "Update destination is not a real directory")
      }
      destinationExists = true
    } catch (error) {
      if (error instanceof LocalSourceError) throw error
      if (filesystemCode(error) !== "ENOENT") throw error
    }
    if (!destinationExists) {
      if (mode === "update") {
        throw new LocalSourceError("UPDATE_CONFLICT", "Update destination disappeared before replacement")
      }
      await renameWithTransientRetry(sourcePath, destinationPath)
      return
    }
    if (mode === "create") {
      throw new LocalSourceError("DESTINATION_COLLISION", "Install destination appeared after preview")
    }

    const previous = await inspectStrictTree(destinationPath)
    const displacedName = `.forge-displaced-${createHash("sha256")
      .update(JSON.stringify([source.relativePath, destination.relativePath]))
      .digest("hex").slice(0, 24)}`
    const destinationParent = path.posix.dirname(destination.relativePath.replaceAll("\\", "/"))
    const displacedRelativePath = destinationParent === "." ? displacedName : `${destinationParent}/${displacedName}`
    const displaced: ArtifactRef = { rootId: destination.rootId, relativePath: displacedRelativePath, kind: "tree" }
    const displacedPath = await this.#policy.authorizeWrite(displaced.rootId, displaced.relativePath)
    try {
      await lstat(displacedPath)
      throw new LocalSourceError("UPDATE_CONFLICT", "A prior replacement artifact blocks this update")
    } catch (error) {
      if (error instanceof LocalSourceError) throw error
      if (filesystemCode(error) !== "ENOENT") throw error
    }

    await renameWithTransientRetry(destinationPath, displacedPath)
    try {
      await renameWithTransientRetry(sourcePath, destinationPath)
    } catch (error) {
      try {
        await renameWithTransientRetry(displacedPath, destinationPath)
      } catch (restoreError) {
        throw new LocalSourceError("UPDATE_CONFLICT", "Replacement failed and the previous tree could not be restored", { cause: restoreError })
      }
      throw error
    }
    if (!(await this.#materializer.removeExact(displaced, previous.manifest.treeHash))) {
      throw new LocalSourceError("UPDATE_CONFLICT", "Replaced tree changed before conservative cleanup")
    }
  }

  async removeExact(reference: ArtifactRef, expectedHash: string): Promise<boolean> {
    assertTree(reference)
    return this.#materializer.removeExact(reference, expectedHash)
  }
}

/** Update-only filesystem capability; installs deliberately retain absent-destination publication. */
export class ApprovedRootLocalSourceUpdateFileSystem extends ApprovedRootLocalInstallFileSystem {
  // Retained as an explicit capability name; replacement mode is selected by the engine.
}
