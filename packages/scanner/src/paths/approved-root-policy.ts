import { access, stat } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"

import type { CanonicalPath } from "@forge/domain"

import {
  nativePathFlavor,
  pathImplementation,
  resolveCanonicalPath,
} from "./canonicalize.js"
import { assertPathContained } from "./containment.js"
import { deduplicateApprovedRoots } from "./dedupe.js"
import {
  PathAuthorizationError,
  type ApprovedRoot,
  type ApprovedRootInput,
  type ApprovedRootPolicy,
  type PathSemantics,
} from "./types.js"

interface RegisteredRoot {
  readonly root: ApprovedRoot
  readonly identity?: string
}

function filesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }
  return typeof error.code === "string" ? error.code : undefined
}

function unavailableRootError(root: ApprovedRoot): PathAuthorizationError | undefined {
  if (root.access === "denied") {
    return new PathAuthorizationError(
      "ROOT_DENIED",
      "The approved root is not accessible without elevation",
      { rootId: root.rootId },
    )
  }
  if (root.access === "missing") {
    return new PathAuthorizationError("ROOT_MISSING", "The approved root is missing", {
      rootId: root.rootId,
    })
  }
  return undefined
}

function writePolicyError(root: ApprovedRoot): PathAuthorizationError | undefined {
  if (root.kind === "managed") {
    return new PathAuthorizationError(
      "ROOT_MANAGED",
      "Managed roots are read-only in Forge",
      { rootId: root.rootId },
    )
  }
  if (root.kind === "system") {
    return new PathAuthorizationError(
      "ROOT_SYSTEM",
      "System roots are read-only in Forge",
      { rootId: root.rootId },
    )
  }
  const unavailable = unavailableRootError(root)
  if (unavailable !== undefined) return unavailable
  if (root.access === "read-only") {
    return new PathAuthorizationError(
      "ROOT_READ_ONLY",
      "The approved root is read-only",
      { rootId: root.rootId },
    )
  }
  if (!root.writableWithoutElevation) {
    return new PathAuthorizationError(
      "ROOT_NOT_WRITABLE",
      "The approved root is not writable without elevation",
      { rootId: root.rootId },
    )
  }
  return undefined
}

async function identityOf(candidate: string): Promise<string> {
  const stats = await stat(candidate)
  return `${stats.dev.toString()}:${stats.ino.toString()}`
}

export class FilesystemApprovedRootPolicy implements ApprovedRootPolicy {
  readonly #roots: readonly ApprovedRoot[]
  readonly #byId: ReadonlyMap<string, RegisteredRoot>
  readonly #semantics: PathSemantics

  private constructor(
    roots: readonly ApprovedRoot[],
    byId: ReadonlyMap<string, RegisteredRoot>,
    semantics: PathSemantics,
  ) {
    this.#roots = roots
    this.#byId = byId
    this.#semantics = semantics
  }

  static async create(
    inputs: readonly ApprovedRootInput[],
    semantics: PathSemantics = {},
  ): Promise<FilesystemApprovedRootPolicy> {
    const roots = await deduplicateApprovedRoots(inputs, semantics)
    const byId = new Map<string, RegisteredRoot>()

    for (const root of roots) {
      let identity: string | undefined
      if (root.access !== "missing" && root.access !== "denied") {
        identity = await identityOf(root.canonicalPath)
      }
      const registration: RegisteredRoot = {
        root,
        ...(identity === undefined ? {} : { identity }),
      }
      byId.set(root.rootId, registration)
      for (const aliasRootId of root.aliasRootIds) {
        byId.set(aliasRootId, registration)
      }
    }

    return new FilesystemApprovedRootPolicy(roots, byId, semantics)
  }

  getApprovedRoots(): readonly ApprovedRoot[] {
    return this.#roots
  }

  async authorizeRead(rootId: string, candidate: string): Promise<CanonicalPath> {
    const registration = await this.#resolveUsableRoot(rootId)
    const requested = this.#candidatePath(registration.root, candidate)
    const resolved = await resolveCanonicalPath(requested, this.#semantics)
    assertPathContained(
      registration.root.canonicalPath,
      resolved.canonicalPath,
      this.#semantics,
    )

    try {
      await access(resolved.canonicalPath, fsConstants.R_OK)
    } catch (error) {
      const code = filesystemErrorCode(error)
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new PathAuthorizationError("PATH_NOT_FOUND", "Path does not exist", {
          rootId,
          cause: error,
        })
      }
      throw new PathAuthorizationError(
        "FILESYSTEM_DENIED",
        "The filesystem denied read access without elevation",
        { rootId, cause: error },
      )
    }

    return resolved.canonicalPath
  }

  async authorizeWrite(rootId: string, candidate: string): Promise<CanonicalPath> {
    const registration = this.#getRegistration(rootId)
    const policyError = writePolicyError(registration.root)
    if (policyError !== undefined) throw policyError
    await this.#assertRootUnchanged(registration, rootId)

    const requested = this.#candidatePath(registration.root, candidate)
    const resolved = await resolveCanonicalPath(requested, {
      ...this.#semantics,
      allowMissing: true,
    })
    assertPathContained(
      registration.root.canonicalPath,
      resolved.canonicalPath,
      this.#semantics,
    )

    const implementation = pathImplementation(
      this.#semantics.flavor ?? nativePathFlavor(),
    )
    const writeProbe = resolved.exists
      ? resolved.canonicalPath
      : resolved.existingAncestor

    // A destination can only be used if the existing entry (when present) and
    // its parent are writable by the current process. No chmod, chown, helper,
    // UAC, sudo, or other elevation path exists here.
    try {
      await access(writeProbe, fsConstants.W_OK)
      if (resolved.exists) {
        await access(implementation.dirname(resolved.canonicalPath), fsConstants.W_OK)
      }
    } catch (error) {
      throw new PathAuthorizationError(
        "ROOT_NOT_WRITABLE",
        "The destination is not writable without elevation",
        { rootId, cause: error },
      )
    }

    return resolved.canonicalPath
  }

  #getRegistration(rootId: string): RegisteredRoot {
    const registration = this.#byId.get(rootId)
    if (registration === undefined) {
      throw new PathAuthorizationError(
        "ROOT_NOT_APPROVED",
        "The root ID is not approved",
        { rootId },
      )
    }
    return registration
  }

  async #resolveUsableRoot(rootId: string): Promise<RegisteredRoot> {
    const registration = this.#getRegistration(rootId)
    const unavailable = unavailableRootError(registration.root)
    if (unavailable !== undefined) throw unavailable
    await this.#assertRootUnchanged(registration, rootId)
    return registration
  }

  async #assertRootUnchanged(
    registration: RegisteredRoot,
    rootId: string,
  ): Promise<void> {
    try {
      const current = await resolveCanonicalPath(
        registration.root.canonicalPath,
        this.#semantics,
      )
      const currentIdentity = await identityOf(current.canonicalPath)
      if (
        current.canonicalPath !== registration.root.canonicalPath ||
        currentIdentity !== registration.identity
      ) {
        throw new PathAuthorizationError(
          "ROOT_CHANGED",
          "The approved root changed after approval",
          { rootId },
        )
      }
    } catch (error) {
      if (error instanceof PathAuthorizationError) throw error
      throw new PathAuthorizationError(
        "ROOT_CHANGED",
        "The approved root changed after approval",
        { rootId, cause: error },
      )
    }
  }

  #candidatePath(root: ApprovedRoot, candidate: string): string {
    if (candidate.includes("\0")) {
      throw new PathAuthorizationError(
        "INVALID_PATH",
        "Path cannot contain a null byte",
        { rootId: root.rootId },
      )
    }
    const implementation = pathImplementation(
      this.#semantics.flavor ?? nativePathFlavor(),
    )
    if (candidate === "" || candidate === ".") return root.canonicalPath
    return implementation.isAbsolute(candidate)
      ? candidate
      : implementation.resolve(root.canonicalPath, candidate)
  }
}

export async function createApprovedRootPolicy(
  inputs: readonly ApprovedRootInput[],
  semantics: PathSemantics = {},
): Promise<ApprovedRootPolicy> {
  return FilesystemApprovedRootPolicy.create(inputs, semantics)
}
