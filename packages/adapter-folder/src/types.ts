import type { CanonicalPath, RootAccess } from "@forge/domain"

export type FolderRootScope =
  | Readonly<{ kind: "global" }>
  | Readonly<{
      kind: "project"
      projectId: string
      projectPath: CanonicalPath
    }>

/** A folder root exists only after the user has explicitly configured it. */
export interface FolderRootConfiguration {
  readonly candidateId: string
  readonly canonicalPath: CanonicalPath
  readonly scope: FolderRootScope
  readonly access: RootAccess
  readonly writableWithoutElevation: boolean
  readonly defaultIncluded?: boolean
}

export interface FolderAdapterOptions {
  readonly roots: readonly FolderRootConfiguration[]
  readonly now?: () => Date
}

export type FolderAdapterErrorCode =
  | "ROOT_NOT_CONFIGURED"
  | "ROOT_ADAPTER_MISMATCH"
  | "ROOT_NOT_WRITABLE"
  | "ROOT_SCOPE_INVALID"
  | "INSTALLATION_REQUIRED"
  | "INSTALLATION_ROOT_MISMATCH"
  | "INSTALLATION_NOT_WRITABLE"
  | "SNAPSHOT_STALE"
  | "SOURCE_MANIFEST_REQUIRED"
  | "SOURCE_HASH_MISMATCH"
  | "SOURCE_ENTRY_MISSING"
  | "DESTINATION_COLLISION"
  | "INSTALLATION_OUTSIDE_ROOT"

export class FolderAdapterError extends Error {
  readonly code: FolderAdapterErrorCode

  constructor(code: FolderAdapterErrorCode, message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options)
    this.name = "FolderAdapterError"
    this.code = code
  }
}
