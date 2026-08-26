import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

import { LOCAL_SOURCE_LIMITS_V1, validatePortableRelativePath } from "../validation/index.js"
import type { LocalSourceFile } from "../validation/index.js"
import { SourceHashError, type LocalSourceManifestV1, type ManifestFileV1 } from "./types.js"

function bytewisePathOrder(left: ManifestFileV1, right: ManifestFileV1): number {
  return Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"))
}

export function forgeTreeHash(files: readonly ManifestFileV1[]): string {
  const hash = createHash("sha256")
  hash.update("forge-tree-v1\0", "utf8")
  for (const file of [...files].sort(bytewisePathOrder)) {
    const pathBytes = Buffer.from(file.path.normalize("NFC"), "utf8")
    hash.update("file\0", "utf8")
    hash.update(`${pathBytes.length}\0`, "utf8")
    hash.update(pathBytes)
    hash.update("\0", "utf8")
    hash.update(`${file.byteLength}\0`, "utf8")
    hash.update(file.sha256.toLowerCase(), "utf8")
    hash.update("\0", "utf8")
  }
  return hash.digest("hex")
}

export function createLocalSourceManifest(files: readonly ManifestFileV1[]): LocalSourceManifestV1 {
  const normalized = files.map((file) => {
    const result = validatePortableRelativePath(file.path)
    if (result.normalized === undefined) throw new TypeError(`Invalid manifest path: ${file.path}`)
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new TypeError(`Invalid SHA-256 for ${file.path}`)
    if (!Number.isSafeInteger(file.byteLength) || file.byteLength < 0) throw new TypeError(`Invalid byte length for ${file.path}`)
    return { ...file, path: result.normalized, sha256: file.sha256.toLowerCase() }
  }).sort(bytewisePathOrder)
  return {
    contract: "local-source-v1",
    hashAlgorithm: "forge-tree-v1",
    files: normalized,
    treeHash: forgeTreeHash(normalized),
  }
}

export async function hashFile(filePath: string, expectedByteLength?: number): Promise<Omit<ManifestFileV1, "path">> {
  const hash = createHash("sha256")
  let byteLength = 0
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += bytes.length
    if (byteLength > LOCAL_SOURCE_LIMITS_V1.singleIncludedFileBytes) {
      throw new SourceHashError("FILE_SIZE_LIMIT", "File exceeded local-source-v1 while streaming")
    }
    hash.update(bytes)
  }
  if (expectedByteLength !== undefined && byteLength !== expectedByteLength) {
    throw new SourceHashError("FILE_SIZE_CHANGED", "File size changed between enumeration and hashing")
  }
  return { byteLength, sha256: hash.digest("hex") }
}

export async function hashFiles(files: readonly LocalSourceFile[]): Promise<LocalSourceManifestV1> {
  const manifestFiles: ManifestFileV1[] = []
  let totalBytes = 0
  for (const file of [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))) {
    const hashed = await hashFile(file.absolutePath, file.byteLength)
    totalBytes += hashed.byteLength
    if (totalBytes > LOCAL_SOURCE_LIMITS_V1.directoryIncludedBytes) {
      throw new SourceHashError("SOURCE_SIZE_LIMIT", "Source exceeded local-source-v1 while streaming")
    }
    manifestFiles.push({ path: file.path, ...hashed })
  }
  return createLocalSourceManifest(manifestFiles)
}
