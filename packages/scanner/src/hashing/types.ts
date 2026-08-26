import type { ScannerFinding } from "../validation/index.js"

export interface ManifestFileV1 {
  readonly path: string
  readonly byteLength: number
  readonly sha256: string
}

export interface LocalSourceManifestV1 {
  readonly contract: "local-source-v1"
  readonly hashAlgorithm: "forge-tree-v1"
  readonly files: readonly ManifestFileV1[]
  readonly treeHash: string
}

export interface HashDirectoryResult {
  readonly manifest?: LocalSourceManifestV1
  readonly ignoredEntries: readonly string[]
  readonly findings: readonly ScannerFinding[]
}

export class SourceHashError extends Error {
  readonly code: "FILE_SIZE_CHANGED" | "FILE_SIZE_LIMIT" | "SOURCE_SIZE_LIMIT"

  constructor(code: SourceHashError["code"], message: string) {
    super(message)
    this.name = "SourceHashError"
    this.code = code
  }
}
