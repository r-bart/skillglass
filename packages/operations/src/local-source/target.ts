import { lstat, readdir } from "node:fs/promises"

import type { ApprovedRootPolicy } from "@forge/scanner"

import { LocalSourceError } from "./errors.js"
import { admitPortablePath, portableCollisionKey, portableNameCollisionKey } from "./path-policy.js"
import type { LocalInstallTarget, LocalInstallTargetPort } from "./types.js"

function filesystemCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined
}

export class ApprovedRootInstallTargetPolicy implements LocalInstallTargetPort {
  readonly #policy: ApprovedRootPolicy

  constructor(policy: ApprovedRootPolicy) {
    this.#policy = policy
  }

  async authorizeAbsentDirectChild(rootId: string, childSegment: string): Promise<LocalInstallTarget> {
    const admitted = admitPortablePath(childSegment)
    if (admitted.normalized.includes("/")) throw new LocalSourceError("PATH_INVALID", "Install destination must be one direct child segment")
    let canonical: string
    try {
      canonical = await this.#policy.authorizeWrite(rootId, admitted.normalized)
    } catch (error) {
      throw new LocalSourceError("DESTINATION_NOT_WRITABLE", "Target root is not approved and writable without elevation", { cause: error })
    }
    try {
      await lstat(canonical)
      throw new LocalSourceError("DESTINATION_COLLISION", "Install destination already exists")
    } catch (error) {
      if (error instanceof LocalSourceError) throw error
      if (filesystemCode(error) !== "ENOENT") throw new LocalSourceError("DESTINATION_NOT_WRITABLE", "Could not inspect install destination", { cause: error })
    }
    const root = this.#policy.getApprovedRoots().find((candidate) => candidate.rootId === rootId || candidate.aliasRootIds.includes(rootId))
    if (root === undefined) throw new LocalSourceError("DESTINATION_NOT_WRITABLE", "Target root is no longer approved")
    const wantedKey = portableCollisionKey(admitted.normalized)
    const siblings = await readdir(root.canonicalPath)
    if (siblings.some((sibling) => portableNameCollisionKey(sibling) === wantedKey)) {
      throw new LocalSourceError("DESTINATION_COLLISION", "A portable sibling-name collision already exists")
    }
    return { rootId, childSegment: admitted.normalized, canonicalPath: canonical }
  }
}
