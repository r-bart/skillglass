import type { ParsedSkillSource } from "../parser/index.js"

export const LOCAL_SOURCE_LIMITS_V1 = Object.freeze({
  directoryIncludedBytes: 100 * 1024 * 1024,
  singleIncludedFileBytes: 10 * 1024 * 1024,
  includedRegularFiles: 2_000,
  includedDirectories: 512,
  relativeNestingSegments: 16,
  relativePathUtf8Bytes: 1_024,
  pathSegmentUtf8Bytes: 255,
})

export interface ScannerFinding {
  readonly code: string
  readonly severity: "warning" | "error"
  readonly message: string
  readonly path?: string
}

export interface LocalSourceFile {
  readonly path: string
  readonly absolutePath: string
  readonly byteLength: number
  readonly kind: "entry" | "resource"
}

export interface DirectoryEnumeration {
  readonly root: string
  readonly files: readonly LocalSourceFile[]
  readonly ignoredEntries: readonly string[]
  readonly findings: readonly ScannerFinding[]
  readonly includedBytes: number
}

export interface ResourceReference {
  readonly source: string
  readonly rawTarget: string
  readonly resolvedPath?: string
  readonly kind: "local" | "anchor" | "external" | "unsafe"
  readonly exists?: boolean
}

export interface SkillDirectoryValidation extends DirectoryEnumeration {
  readonly parsed?: ParsedSkillSource
  readonly resources: readonly LocalSourceFile[]
  readonly references: readonly ResourceReference[]
  readonly valid: boolean
}
