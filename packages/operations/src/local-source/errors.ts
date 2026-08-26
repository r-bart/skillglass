export type LocalSourceErrorCode =
  | "SELECTION_CANCELLED"
  | "SELECTION_EXPIRED"
  | "SELECTION_UNKNOWN"
  | "SELECTION_ALREADY_CLAIMED"
  | "SOURCE_CHANGED"
  | "SOURCE_TYPE"
  | "SOURCE_IO"
  | "SOURCE_INVALID"
  | "ARCHIVE_MALFORMED"
  | "ARCHIVE_ENCRYPTED"
  | "ARCHIVE_MULTIDISK"
  | "ARCHIVE_METHOD"
  | "ARCHIVE_SIZE_LIMIT"
  | "EXPANDED_SIZE_LIMIT"
  | "COMPRESSION_RATIO_LIMIT"
  | "RESOURCE_LIMIT"
  | "UNSUPPORTED_ENTRY_TYPE"
  | "PATH_INVALID"
  | "PATH_COLLISION"
  | "PAYLOAD_AMBIGUOUS"
  | "SKILL_ENTRY_MISSING"
  | "DESTINATION_COLLISION"
  | "DESTINATION_NOT_WRITABLE"
  | "STAGING_MISMATCH"

export class LocalSourceError extends Error {
  override readonly name = "LocalSourceError"
  readonly code: LocalSourceErrorCode
  readonly path: string | undefined

  constructor(code: LocalSourceErrorCode, message: string, options: { path?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.code = code
    this.path = options.path
  }
}
