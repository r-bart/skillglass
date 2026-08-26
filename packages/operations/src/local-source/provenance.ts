import { createLocalSourceManifest, type LocalSourceManifestV1, type ManifestFileV1 } from "@forge/scanner"
import type { SnapshotRepository } from "@forge/storage"

import type { OperationPlan } from "../core/index.js"
import { LocalSourceError } from "./errors.js"
import { admitPortablePath, assertUniquePortablePaths, bytewisePathSort } from "./path-policy.js"
import type { LocalImportProvenanceV1, SourceIdentity } from "./types.js"

type ProvenanceStore = Pick<SnapshotRepository, "getProvenance" | "putProvenance">

export const LOCAL_SOURCE_COMMIT_METADATA_V1 = "forge-local-source-commit-v1"

export type LocalSourceCommitMetadataV1 =
  | Readonly<{
      kind: "install"
      provenance: LocalImportProvenanceV1
    }>
  | Readonly<{
      kind: "update-source"
      provenanceId: string
      provenance: LocalImportProvenanceV1
    }>

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocalSourceError("SOURCE_INVALID", `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LocalSourceError("SOURCE_INVALID", `${label} must be a non-empty string`)
  }
  return value
}

function date(value: unknown, label: string): string {
  const result = string(value, label)
  if (!Number.isFinite(Date.parse(result))) throw new LocalSourceError("SOURCE_INVALID", `${label} must be an ISO date-time`)
  return result
}

function hash(value: unknown, label: string): string {
  const result = string(value, label)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new LocalSourceError("SOURCE_INVALID", `${label} must be a SHA-256 hash`)
  return result
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label)
}

function identity(value: unknown): SourceIdentity {
  const candidate = record(value, "sourceIdentity")
  const size = candidate.size
  const modifiedMilliseconds = candidate.modifiedMilliseconds
  if (!Number.isSafeInteger(size) || (size as number) < 0 || !Number.isSafeInteger(modifiedMilliseconds)) {
    throw new LocalSourceError("SOURCE_INVALID", "sourceIdentity numeric fields must be safe non-negative integers")
  }
  return {
    device: string(candidate.device, "sourceIdentity.device"),
    inode: string(candidate.inode, "sourceIdentity.inode"),
    size: size as number,
    modifiedMilliseconds: modifiedMilliseconds as number,
  }
}

function manifest(value: unknown, label: string): LocalSourceManifestV1 {
  const candidate = record(value, label)
  if (candidate.contract !== "local-source-v1" || candidate.hashAlgorithm !== "forge-tree-v1" || !Array.isArray(candidate.files)) {
    throw new LocalSourceError("SOURCE_INVALID", `${label} is not a local-source-v1 manifest`)
  }
  const files: ManifestFileV1[] = candidate.files.map((entry, index) => {
    const file = record(entry, `${label}.files[${String(index)}]`)
    const filePath = admitPortablePath(string(file.path, `${label}.files.path`)).normalized
    if (!Number.isSafeInteger(file.byteLength) || (file.byteLength as number) < 0) {
      throw new LocalSourceError("SOURCE_INVALID", `${label}.files.byteLength must be a safe non-negative integer`)
    }
    return {
      path: filePath,
      byteLength: file.byteLength as number,
      sha256: hash(file.sha256, `${label}.files.sha256`),
    }
  })
  assertUniquePortablePaths(files.map((file) => ({ path: file.path, kind: "file" as const })))
  files.sort((left, right) => bytewisePathSort(left.path, right.path))
  const rebuilt = createLocalSourceManifest(files)
  if (hash(candidate.treeHash, `${label}.treeHash`) !== rebuilt.treeHash) {
    throw new LocalSourceError("SOURCE_INVALID", `${label} tree hash does not match its files`)
  }
  return rebuilt
}

/** Parses persisted JSON defensively instead of trusting its compile-time shape. */
export function parseLocalImportProvenanceV1(value: unknown): LocalImportProvenanceV1 {
  const candidate = record(value, "provenance")
  if (candidate.contract !== "local-source-v1" || candidate.kind !== "forge-import" || candidate.managedBy !== "forge") {
    throw new LocalSourceError("SOURCE_INVALID", "Record is not Forge local-source-v1 provenance")
  }
  if (candidate.sourceKind !== "directory" && candidate.sourceKind !== "zip") {
    throw new LocalSourceError("SOURCE_INVALID", "Local source kind is invalid")
  }
  const sourceManifest = manifest(candidate.sourceManifest, "sourceManifest")
  const installedManifest = manifest(candidate.installedManifest, "installedManifest")
  const sourceTreeHash = hash(candidate.sourceTreeHash, "sourceTreeHash")
  const installedTreeHash = hash(candidate.installedTreeHash, "installedTreeHash")
  if (sourceManifest.treeHash !== sourceTreeHash || installedManifest.treeHash !== installedTreeHash || candidate.installedHash !== installedTreeHash) {
    throw new LocalSourceError("SOURCE_INVALID", "Provenance hashes do not match their manifests")
  }
  const ignored = record(candidate.ignoredEntries, "ignoredEntries")
  if (!Number.isSafeInteger(ignored.count) || (ignored.count as number) < 0 ||
    !Array.isArray(ignored.categories) || !ignored.categories.every((category) => typeof category === "string")) {
    throw new LocalSourceError("SOURCE_INVALID", "Ignored-entry summary is invalid")
  }
  const archiveSha256 = candidate.archiveSha256 === undefined ? undefined : hash(candidate.archiveSha256, "archiveSha256")
  if ((candidate.sourceKind === "zip") !== (archiveSha256 !== undefined)) {
    throw new LocalSourceError("SOURCE_INVALID", "ZIP provenance must contain an archive hash")
  }
  const previousInstalledTreeHash = candidate.previousInstalledTreeHash === undefined
    ? undefined
    : hash(candidate.previousInstalledTreeHash, "previousInstalledTreeHash")
  const updatedByJournalId = optionalString(candidate.updatedByJournalId, "updatedByJournalId")
  return {
    contract: "local-source-v1",
    kind: "forge-import",
    managedBy: "forge",
    sourceKind: candidate.sourceKind,
    sourceLocator: string(candidate.sourceLocator, "sourceLocator"),
    sourceObservedAt: date(candidate.sourceObservedAt, "sourceObservedAt"),
    sourceIdentity: identity(candidate.sourceIdentity),
    sourceTreeHash,
    ...(archiveSha256 === undefined ? {} : { archiveSha256 }),
    ...(candidate.payloadWrapper === undefined ? {} : { payloadWrapper: string(candidate.payloadWrapper, "payloadWrapper") }),
    ignoredEntries: { count: ignored.count as number, categories: [...ignored.categories] as string[] },
    sourceManifest,
    targetRootId: string(candidate.targetRootId, "targetRootId"),
    installationId: string(candidate.installationId, "installationId"),
    destinationCanonicalPath: string(candidate.destinationCanonicalPath, "destinationCanonicalPath"),
    createdByJournalId: string(candidate.createdByJournalId, "createdByJournalId"),
    installedHash: installedTreeHash,
    installedTreeHash,
    installedManifest,
    ...(previousInstalledTreeHash === undefined ? {} : { previousInstalledTreeHash }),
    ...(updatedByJournalId === undefined ? {} : { updatedByJournalId }),
  }
}

/** Builds the durable, private completion effect stored inside an operation plan. */
export function localSourceCommitMetadata(
  value: LocalSourceCommitMetadataV1,
): NonNullable<OperationPlan["commitMetadata"]> {
  return {
    contract: LOCAL_SOURCE_COMMIT_METADATA_V1,
    value: structuredClone(value),
  }
}

/** Returns undefined for unrelated plans and rejects malformed matching metadata. */
export function parseLocalSourceCommitMetadata(
  plan: Pick<OperationPlan, "kind" | "commitMetadata">,
): LocalSourceCommitMetadataV1 | undefined {
  const metadata = plan.commitMetadata
  if (metadata?.contract !== LOCAL_SOURCE_COMMIT_METADATA_V1) return undefined
  const candidate = record(metadata.value, "local source commit metadata")
  const provenance = parseLocalImportProvenanceV1(candidate.provenance)
  if (candidate.kind === "install" && plan.kind === "install") {
    return { kind: "install", provenance }
  }
  if (candidate.kind === "update-source" && plan.kind === "update-source") {
    const provenanceId = string(candidate.provenanceId, "local source commit provenanceId")
    return { kind: "update-source", provenanceId, provenance }
  }
  throw new LocalSourceError("SOURCE_INVALID", "Local source commit metadata does not match its operation")
}

/** Storage adapter that retains the complete local provenance in the existing provenance journal. */
export class LocalSourceProvenanceRepository {
  readonly #store: ProvenanceStore

  constructor(store: ProvenanceStore) {
    this.#store = store
  }

  persist(id: string, provenance: LocalImportProvenanceV1): void {
    if (id.length === 0) throw new LocalSourceError("SOURCE_INVALID", "Provenance ID cannot be empty")
    const validated = parseLocalImportProvenanceV1(provenance)
    this.#store.putProvenance({
      id,
      installationId: validated.installationId,
      observedAt: validated.sourceObservedAt,
      value: validated,
    })
  }

  reconstruct(id: string): LocalImportProvenanceV1 | undefined {
    const stored = this.#store.getProvenance(id)
    if (stored === undefined) return undefined
    const provenance = parseLocalImportProvenanceV1(stored.value)
    if (stored.installationId !== provenance.installationId) {
      throw new LocalSourceError("SOURCE_INVALID", "Stored provenance installation identity is inconsistent")
    }
    return provenance
  }
}
