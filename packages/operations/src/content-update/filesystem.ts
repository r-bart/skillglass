import { createHash } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { copyFile, lstat, open, readFile, rename, unlink } from "node:fs/promises"
import path from "node:path"

import type { ProjectionRepository } from "@forge/storage"
import { FilesystemApprovedRootPolicy, type ApprovedRootInput, type ApprovedRootPolicy } from "@forge/scanner"

import type { ArtifactObservation, ArtifactRef, FileSystemPort } from "../core/index.js"
import { OperationConflictError, OperationValidationError } from "../core/index.js"

function assertFile(reference: ArtifactRef): void {
  if (reference.kind !== "file") {
    throw new OperationValidationError("Direct content updates accept file artifacts only")
  }
}

function fileHash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex")
}

function filesystemCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

/** Resolves every root ID from the current persisted projection, never from renderer paths. */
export class ProjectionContentFileSystem implements FileSystemPort {
  readonly #projections: ProjectionRepository
  readonly #additionalRoots: readonly ApprovedRootInput[]

  constructor(projections: ProjectionRepository, additionalRoots: readonly ApprovedRootInput[] = []) {
    this.#projections = projections
    this.#additionalRoots = additionalRoots
  }

  async #policy(): Promise<ApprovedRootPolicy> {
    return FilesystemApprovedRootPolicy.create([
      ...this.#projections.listRoots().map((root) => ({
        rootId: root.id,
        path: root.canonicalPath,
        kind: root.kind,
        access: root.access,
        writableWithoutElevation: root.access === "read-write" && root.kind !== "managed" && root.kind !== "system",
      })),
      ...this.#additionalRoots,
    ])
  }

  async #readPath(reference: ArtifactRef): Promise<string> {
    assertFile(reference)
    return (await this.#policy()).authorizeRead(reference.rootId, reference.relativePath)
  }

  async #writePath(reference: ArtifactRef): Promise<string> {
    assertFile(reference)
    return (await this.#policy()).authorizeWrite(reference.rootId, reference.relativePath)
  }

  async authorize(reference: ArtifactRef, access: "read" | "write"): Promise<void> {
    if (access === "read") await this.#readPath(reference)
    else await this.#writePath(reference)
  }

  async observe(reference: ArtifactRef): Promise<ArtifactObservation> {
    try {
      const candidate = await this.#readPath(reference)
      const stats = await lstat(candidate)
      if (!stats.isFile()) throw new OperationConflictError("Operation artifact is not a regular file")
      return { exists: true, hash: fileHash(await readFile(candidate)) }
    } catch (error) {
      if (filesystemCode(error) === "ENOENT" || (
        typeof error === "object" && error !== null && "code" in error && error.code === "PATH_NOT_FOUND"
      )) return { exists: false }
      throw error
    }
  }

  async copyExclusive(source: ArtifactRef, destination: ArtifactRef): Promise<void> {
    const sourcePath = await this.#readPath(source)
    const destinationPath = await this.#writePath(destination)
    await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL)
    const handle = await open(destinationPath, "r")
    try { await handle.sync() } finally { await handle.close() }
  }

  async writeFileExclusive(destination: ArtifactRef, content: string): Promise<void> {
    const destinationPath = await this.#writePath(destination)
    const handle = await open(destinationPath, "wx")
    try {
      await handle.writeFile(content, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async replace(source: ArtifactRef, destination: ArtifactRef): Promise<void> {
    const sourcePath = await this.#writePath(source)
    const destinationPath = await this.#writePath(destination)
    if (path.dirname(sourcePath) !== path.dirname(destinationPath)) {
      throw new OperationValidationError("Content publication requires sibling staging")
    }
    await rename(sourcePath, destinationPath)
  }

  async removeExact(reference: ArtifactRef, expectedHash: string): Promise<boolean> {
    const observed = await this.observe(reference)
    if (!observed.exists) return true
    if (observed.hash !== expectedHash) return false
    await unlink(await this.#writePath(reference))
    return true
  }
}
