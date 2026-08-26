import type { SourceRoot } from "@forge/domain"
import {
  FilesystemApprovedRootPolicy,
  type ApprovedRootInput,
  type ApprovedRootPolicy,
} from "@forge/scanner"

function rootInput(root: SourceRoot): ApprovedRootInput {
  return {
    rootId: root.id,
    path: root.canonicalPath,
    kind: root.kind,
    access: root.access,
    writableWithoutElevation: root.access === "read-write" && root.kind !== "managed" && root.kind !== "system",
  }
}

/** Stable coordinator-facing policy whose user-approved delegate can be refreshed atomically. */
export class RefreshableApprovedRootPolicy implements ApprovedRootPolicy {
  readonly #privateRoots: readonly ApprovedRootInput[]
  #delegate: ApprovedRootPolicy

  private constructor(delegate: ApprovedRootPolicy, privateRoots: readonly ApprovedRootInput[]) {
    this.#delegate = delegate
    this.#privateRoots = privateRoots
  }

  static async create(
    roots: readonly SourceRoot[],
    privateRoots: readonly ApprovedRootInput[] = [],
  ): Promise<RefreshableApprovedRootPolicy> {
    const delegate = await FilesystemApprovedRootPolicy.create([
      ...roots.map(rootInput),
      ...privateRoots,
    ])
    return new RefreshableApprovedRootPolicy(delegate, privateRoots)
  }

  async replaceApprovedRoots(roots: readonly SourceRoot[]): Promise<void> {
    const next = await FilesystemApprovedRootPolicy.create([
      ...roots.map(rootInput),
      ...this.#privateRoots,
    ])
    this.#delegate = next
  }

  authorizeRead(rootId: string, candidate: string) {
    return this.#delegate.authorizeRead(rootId, candidate)
  }

  authorizeWrite(rootId: string, candidate: string) {
    return this.#delegate.authorizeWrite(rootId, candidate)
  }

  getApprovedRoots() {
    return this.#delegate.getApprovedRoots()
  }
}
