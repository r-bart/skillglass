import type {
  CanonicalPath,
  RootAccess,
  RootKind,
} from "@forge/domain"

export type PathFlavor = "posix" | "win32"

export interface PathSemantics {
  readonly flavor?: PathFlavor
  readonly cwd?: string
  readonly caseSensitive?: boolean
}

export interface CanonicalPathResolution {
  readonly canonicalPath: CanonicalPath
  readonly exists: boolean
  /** Identity of the existing path, or of the nearest existing ancestor. */
  readonly identity?: string
  readonly existingAncestor: CanonicalPath
}

export interface ApprovedRootInput {
  readonly rootId: string
  readonly path: string
  readonly kind: RootKind
  readonly access: RootAccess
  readonly writableWithoutElevation: boolean
}

export interface ApprovedRoot {
  readonly rootId: string
  readonly aliasRootIds: readonly string[]
  readonly canonicalPath: CanonicalPath
  readonly kind: RootKind
  readonly access: RootAccess
  readonly writableWithoutElevation: boolean
}

export type PathAuthorizationErrorCode =
  | "INVALID_PATH"
  | "DUPLICATE_ROOT_ID"
  | "ROOT_NOT_APPROVED"
  | "ROOT_NOT_DIRECTORY"
  | "ROOT_CHANGED"
  | "ROOT_MANAGED"
  | "ROOT_SYSTEM"
  | "ROOT_DENIED"
  | "ROOT_MISSING"
  | "ROOT_READ_ONLY"
  | "ROOT_NOT_WRITABLE"
  | "PATH_NOT_FOUND"
  | "PATH_OUTSIDE_ROOT"
  | "FILESYSTEM_DENIED"
  | "SYMLINK_CYCLE"

export class PathAuthorizationError extends Error {
  readonly code: PathAuthorizationErrorCode
  readonly rootId: string | undefined

  constructor(
    code: PathAuthorizationErrorCode,
    message: string,
    options: { readonly rootId?: string; readonly cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = "PathAuthorizationError"
    this.code = code
    this.rootId = options.rootId
  }
}

export interface ApprovedRootPolicy {
  authorizeRead(rootId: string, candidate: string): Promise<CanonicalPath>
  authorizeWrite(rootId: string, candidate: string): Promise<CanonicalPath>
  getApprovedRoots(): readonly ApprovedRoot[]
}
