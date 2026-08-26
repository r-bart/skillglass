import { LocalSourceError } from "./errors.js"
import { LOCAL_SOURCE_LIMITS } from "./types.js"

export class DirectorySourceLimitCounter {
  #files = 0
  #directories = 0
  #bytes = 0

  includeDirectory(path?: string): void {
    this.#directories += 1
    if (this.#directories > LOCAL_SOURCE_LIMITS.includedDirectories) {
      throw new LocalSourceError("RESOURCE_LIMIT", "Directory source contains too many directories", path === undefined ? {} : { path })
    }
  }

  includeFile(byteLength: number, path?: string): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new LocalSourceError("RESOURCE_LIMIT", "Source file size is invalid", path === undefined ? {} : { path })
    }
    if (byteLength > LOCAL_SOURCE_LIMITS.singleIncludedFileBytes) {
      throw new LocalSourceError("RESOURCE_LIMIT", "A source file exceeds the single-file limit", path === undefined ? {} : { path })
    }
    this.#files += 1
    this.#bytes += byteLength
    if (this.#files > LOCAL_SOURCE_LIMITS.includedRegularFiles) {
      throw new LocalSourceError("RESOURCE_LIMIT", "Directory source contains too many regular files")
    }
    if (this.#bytes > LOCAL_SOURCE_LIMITS.directoryIncludedBytes) {
      throw new LocalSourceError("RESOURCE_LIMIT", "Directory source exceeds the included-byte limit")
    }
  }
}

export function assertZipArchiveByteSize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > LOCAL_SOURCE_LIMITS.zipArchiveBytes) {
    throw new LocalSourceError("ARCHIVE_SIZE_LIMIT", "ZIP exceeds the 25 MiB archive limit")
  }
}
