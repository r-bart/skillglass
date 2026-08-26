import type { LocalSourceManifestV1 } from "@forge/scanner"
import type { AdapterOperationPlan } from "@forge/adapter-api"

import type { ArtifactRef, OperationPlan } from "../core/index.js"

export const LOCAL_SOURCE_LIMITS = Object.freeze({
  directoryIncludedBytes: 100 * 1_024 * 1_024,
  zipArchiveBytes: 25 * 1_024 * 1_024,
  zipExpandedIncludedBytes: 100 * 1_024 * 1_024,
  singleIncludedFileBytes: 10 * 1_024 * 1_024,
  includedRegularFiles: 2_000,
  includedDirectories: 512,
  relativeNestingSegments: 16,
  relativePathUtf8Bytes: 1_024,
  pathSegmentUtf8Bytes: 255,
  zipCompressionRatio: 100,
})

export type LocalSourceKind = "directory" | "zip"

export interface LocalSourceSelection {
  readonly kind: LocalSourceKind
  readonly selectionToken: string
  readonly displayName: string
  readonly treeHash: string
  readonly archiveSha256?: string
  readonly expiresAt: string
}

export interface IgnoredEntrySummary {
  readonly count: number
  readonly categories: readonly string[]
}

export interface SourceIdentity {
  readonly device: string
  readonly inode: string
  readonly size: number
  readonly modifiedMilliseconds: number
}

export interface ArchiveEntry {
  readonly rawName: string
  readonly payloadPath?: string
  readonly kind: "file" | "directory"
  readonly compressionMethod: 0 | 8
  readonly flags: number
  readonly crc32: number
  readonly compressedBytes: number
  readonly expandedBytes: number
  readonly dataOffset: number
  readonly localRecordStart: number
  readonly localRecordEnd: number
  readonly ignored: boolean
}

export interface DirectorySourceEntry {
  readonly payloadPath: string
  readonly sourcePath: string
}

/** Private main-process admission object. sourceLocator is never an IPC DTO. */
export interface AdmittedLocalSource {
  readonly contract: "local-source-v1"
  readonly kind: LocalSourceKind
  readonly sourceLocator: string
  readonly identity: SourceIdentity
  readonly observedAt: string
  readonly manifest: LocalSourceManifestV1
  readonly archiveSha256?: string
  readonly payloadWrapper?: string
  readonly ignoredEntries: IgnoredEntrySummary
  readonly directoryEntries?: readonly DirectorySourceEntry[]
  readonly archiveEntries?: readonly ArchiveEntry[]
}

export interface NativeSourceDialogPort {
  selectDirectory(): Promise<string | undefined>
  selectZipFile(): Promise<string | undefined>
}

export interface LocalSourceAdmissionPort {
  inspect(kind: LocalSourceKind, path: string, observedAt: string): Promise<AdmittedLocalSource>
}

export interface LocalInstallTarget {
  readonly rootId: string
  readonly childSegment: string
  readonly canonicalPath: string
}

export interface LocalInstallTargetPort {
  authorizeAbsentDirectChild(rootId: string, childSegment: string): Promise<LocalInstallTarget>
}

export interface LocalSourceMaterializerPort {
  materialize(source: AdmittedLocalSource, destination: ArtifactRef): Promise<LocalSourceManifestV1>
  removeExact(destination: ArtifactRef, expectedTreeHash: string): Promise<boolean>
}

export interface LocalInstallPreviewEntry {
  readonly action: "create"
  readonly rootId: string
  readonly relativePath: string
  readonly byteLength?: number
  readonly sha256?: string
}

export interface LocalImportProvenanceDraftV1 {
  readonly contract: "local-source-v1"
  readonly sourceKind: LocalSourceKind
  readonly sourceLocator: string
  readonly sourceObservedAt: string
  readonly sourceTreeHash: string
  readonly archiveSha256?: string
  readonly payloadWrapper?: string
  readonly ignoredEntries: IgnoredEntrySummary
  readonly sourceManifest: LocalSourceManifestV1
  readonly targetRootId: string
  readonly installationId: string
  readonly destinationCanonicalPath: string
  readonly createdByJournalId: string
}

export interface LocalImportProvenanceV1 extends LocalImportProvenanceDraftV1 {
  readonly installedTreeHash: string
  readonly installedManifest: LocalSourceManifestV1
}

export interface PreparedLocalInstall {
  readonly plan: OperationPlan
  readonly preview: readonly LocalInstallPreviewEntry[]
  readonly provenance: LocalImportProvenanceDraftV1
  /** Private Forge-owned materialization; never serialize this object to IPC. */
  readonly sourceArtifact: ArtifactRef
  readonly selectionToken: string
  readonly adapterPlan: AdapterOperationPlan
}

export interface LocalSourceClaim {
  readonly kind: LocalSourceKind
  readonly selectionToken: string
  readonly treeHash: string
  readonly archiveSha256?: string
}

export interface PrepareLocalInstallInput {
  readonly source: LocalSourceClaim
  readonly adapterPlan: AdapterOperationPlan
  readonly journalId: string
}

export interface LocalInstallExecutionResult {
  readonly plan: OperationPlan
  readonly provenance: LocalImportProvenanceV1
}
