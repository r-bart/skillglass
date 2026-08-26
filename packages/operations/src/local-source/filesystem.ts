import { createHash } from "node:crypto"
import { lstat, rename } from "node:fs/promises"
import path from "node:path"

import type { ApprovedRootPolicy } from "@forge/scanner"

import type { ArtifactObservation, ArtifactRef, FileSystemPort } from "../core/index.js"
import { sourceIdentity } from "./directory.js"
import { LocalSourceError } from "./errors.js"
import { FileSystemLocalSourceMaterializer } from "./materializer.js"
import { inspectStrictTree, strictTreeMatchesManifest } from "./strict-tree.js"

function filesystemCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
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
  readonly #allowExistingDestination: boolean

  constructor(policy: ApprovedRootPolicy, options: { readonly allowExistingDestination?: boolean } = {}) {
    this.#policy = policy
    this.#materializer = new FileSystemLocalSourceMaterializer(policy)
    this.#allowExistingDestination = options.allowExistingDestination ?? false
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

  async replace(source: ArtifactRef, destination: ArtifactRef): Promise<void> {
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
      await rename(sourcePath, destinationPath)
      return
    }
    if (!this.#allowExistingDestination) {
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

    await rename(destinationPath, displacedPath)
    try {
      await rename(sourcePath, destinationPath)
    } catch (error) {
      try {
        await rename(displacedPath, destinationPath)
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
  constructor(policy: ApprovedRootPolicy) {
    super(policy, { allowExistingDestination: true })
  }
}
