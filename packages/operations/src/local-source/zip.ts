import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, realpath, type FileHandle } from "node:fs/promises"
import { createInflateRaw } from "node:zlib"

import { createLocalSourceManifest, type ManifestFileV1 } from "@forge/scanner"

import { LocalSourceError } from "./errors.js"
import { assertZipArchiveByteSize } from "./limits.js"
import {
  admitPortablePath,
  assertUniqueImplicitDirectories,
  assertUniquePortablePaths,
  isIgnoredArchiveMetadata,
} from "./path-policy.js"
import { sourceIdentity } from "./directory.js"
import {
  LOCAL_SOURCE_LIMITS,
  type AdmittedLocalSource,
  type ArchiveEntry,
  type SourceIdentity,
} from "./types.js"

const EOCD = 0x06054b50
const ZIP64_EOCD = 0x06064b50
const ZIP64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const DATA_DESCRIPTOR = 0x08074b50

interface CentralEntry {
  readonly rawName: string
  readonly rawNameBytes: Buffer
  readonly kind: "file" | "directory"
  readonly flags: number
  readonly compressionMethod: 0 | 8
  readonly crc32: number
  readonly compressedBytes: number
  readonly expandedBytes: number
  readonly localHeaderOffset: number
  readonly externalAttributes: number
  readonly unixHost: boolean
  readonly zip64: boolean
}

export interface ArchiveDescriptionEntry {
  readonly kind: "file" | "directory" | "symlink" | "special"
  readonly name: string
  readonly compressedBytes: number
  readonly expandedBytes: number
  readonly compressionMethod?: number
  readonly encrypted?: boolean
}

interface AdmittedMetadataEntry {
  readonly sourceIndex: number
  readonly rawName: string
  readonly payloadPath?: string
  readonly kind: "file" | "directory"
  readonly ignored: boolean
}

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new LocalSourceError("ARCHIVE_SIZE_LIMIT", `${label} exceeds the safe ZIP limit`)
  }
  return Number(value)
}

async function readExact(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset)
    if (result.bytesRead === 0) throw new LocalSourceError("ARCHIVE_MALFORMED", "Unexpected end of ZIP file")
    offset += result.bytesRead
  }
  return buffer
}

function decodeName(bytes: Buffer, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw new LocalSourceError("PATH_INVALID", "Non-ASCII ZIP names must declare UTF-8")
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new LocalSourceError("PATH_INVALID", "ZIP entry name is not valid UTF-8", { cause: error })
  }
}

function zip64Values(
  extra: Buffer,
  fields: readonly ("expanded" | "compressed" | "offset" | "disk")[],
): Readonly<Record<string, number>> {
  let cursor = 0
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor)
    const size = extra.readUInt16LE(cursor + 2)
    const dataStart = cursor + 4
    const dataEnd = dataStart + size
    if (dataEnd > extra.length) throw new LocalSourceError("ARCHIVE_MALFORMED", "Malformed ZIP extra field")
    if (id === 0x0001) {
      let valueCursor = dataStart
      const values: Record<string, number> = {}
      for (const field of fields) {
        const width = field === "disk" ? 4 : 8
        if (valueCursor + width > dataEnd) throw new LocalSourceError("ARCHIVE_MALFORMED", "Truncated ZIP64 extra field")
        values[field] = width === 8
          ? safeNumber(extra.readBigUInt64LE(valueCursor), `ZIP64 ${field}`)
          : extra.readUInt32LE(valueCursor)
        valueCursor += width
      }
      return values
    }
    cursor = dataEnd
  }
  throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP64 sentinel has no ZIP64 extra field")
}

function determineEntryKind(rawName: string, unixHost: boolean, externalAttributes: number): "file" | "directory" {
  const unixType = (externalAttributes >>> 16) & 0xf000
  if (unixHost && unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000) {
    throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "ZIP contains a link or special Unix entry", { path: rawName })
  }
  const unsafeDosType = (externalAttributes & (0x8 | 0x40 | 0x400)) !== 0
  if (unsafeDosType) {
    throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "ZIP contains a volume, device, or reparse entry", { path: rawName })
  }
  const directory = rawName.endsWith("/") || rawName.endsWith("\\") || unixType === 0x4000 || (externalAttributes & 0x10) !== 0
  if (directory && unixType === 0x8000) throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP file type conflicts with its name", { path: rawName })
  return directory ? "directory" : "file"
}

function validateResourceLimits(entries: readonly ArchiveDescriptionEntry[]): void {
  let compressed = 0
  let expanded = 0
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry.compressedBytes) || entry.compressedBytes < 0 ||
      !Number.isSafeInteger(entry.expandedBytes) || entry.expandedBytes < 0
    ) throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP entry sizes must be non-negative safe integers", { path: entry.name })
    if (entry.encrypted === true) throw new LocalSourceError("ARCHIVE_ENCRYPTED", "Encrypted ZIP entries are not admitted")
    if (entry.compressionMethod !== undefined && entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new LocalSourceError("ARCHIVE_METHOD", "Only STORE and DEFLATE ZIP methods are admitted")
    }
    if (entry.expandedBytes > 0 && entry.compressedBytes === 0) {
      throw new LocalSourceError("COMPRESSION_RATIO_LIMIT", "Non-empty ZIP entry has zero compressed bytes", { path: entry.name })
    }
    if (entry.compressedBytes > 0 && entry.expandedBytes / entry.compressedBytes > LOCAL_SOURCE_LIMITS.zipCompressionRatio) {
      throw new LocalSourceError("COMPRESSION_RATIO_LIMIT", "A ZIP entry exceeds the compression-ratio limit", { path: entry.name })
    }
    compressed += entry.compressedBytes
    expanded += entry.expandedBytes
  }
  if (compressed > 0 && expanded / compressed > LOCAL_SOURCE_LIMITS.zipCompressionRatio) {
    throw new LocalSourceError("COMPRESSION_RATIO_LIMIT", "ZIP exceeds the aggregate compression-ratio limit")
  }
}

export function admitArchiveDescription(
  entries: readonly ArchiveDescriptionEntry[],
  archive: Readonly<{ encrypted?: boolean; multiDisk?: boolean }> = {},
): Readonly<{ entries: readonly AdmittedMetadataEntry[]; payloadWrapper?: string }> {
  if (archive.encrypted === true) throw new LocalSourceError("ARCHIVE_ENCRYPTED", "Encrypted archives are not admitted")
  if (archive.multiDisk === true) throw new LocalSourceError("ARCHIVE_MULTIDISK", "Multi-disk archives are not admitted")
  validateResourceLimits(entries)

  const validated = entries.map((entry, sourceIndex) => {
    if (entry.kind === "symlink" || entry.kind === "special") {
      throw new LocalSourceError("UNSUPPORTED_ENTRY_TYPE", "ZIP contains a link or special entry", { path: entry.name })
    }
    const pathWithoutDirectorySlash = entry.kind === "directory"
      ? entry.name.replace(/[\\/]$/u, "")
      : entry.name
    const admitted = admitPortablePath(pathWithoutDirectorySlash)
    return {
      sourceIndex,
      rawName: entry.name,
      normalized: admitted.normalized,
      kind: entry.kind,
      ignored: isIgnoredArchiveMetadata(admitted.normalized),
    }
  })
  assertUniquePortablePaths(validated.map(({ normalized: path, kind }) => ({ path, kind })))
  assertUniqueImplicitDirectories(validated.map(({ normalized }) => normalized))
  const included = validated.filter(({ ignored }) => !ignored)
  const hasRootSkill = included.some(({ normalized, kind }) => kind === "file" && normalized === "SKILL.md")
  let wrapper: string | undefined
  if (!hasRootSkill) {
    const topLevels = new Set(included.map(({ normalized }) => normalized.split("/")[0]))
    const candidate = topLevels.size === 1 ? [...topLevels][0] : undefined
    if (candidate === undefined || !included.some(({ normalized, kind }) => kind === "file" && normalized === `${candidate}/SKILL.md`)) {
      throw new LocalSourceError("PAYLOAD_AMBIGUOUS", "ZIP does not contain one unambiguous skill payload")
    }
    wrapper = candidate
  }
  const admittedEntries: AdmittedMetadataEntry[] = []
  for (const entry of validated) {
    if (entry.ignored) {
      admittedEntries.push({ sourceIndex: entry.sourceIndex, rawName: entry.rawName, kind: entry.kind, ignored: true })
      continue
    }
    const payloadPath = wrapper === undefined ? entry.normalized : entry.normalized.slice(wrapper.length + 1)
    if (payloadPath === "") {
      admittedEntries.push({ sourceIndex: entry.sourceIndex, rawName: entry.rawName, kind: entry.kind, ignored: false })
      continue
    }
    admittedEntries.push({ sourceIndex: entry.sourceIndex, rawName: entry.rawName, payloadPath, kind: entry.kind, ignored: false })
  }
  if (!admittedEntries.some(({ payloadPath, kind }) => kind === "file" && payloadPath === "SKILL.md")) {
    throw new LocalSourceError("SKILL_ENTRY_MISSING", "ZIP payload has no root SKILL.md")
  }

  const includedFiles = admittedEntries.filter(({ ignored, kind }) => !ignored && kind === "file")
  if (includedFiles.length > LOCAL_SOURCE_LIMITS.includedRegularFiles) {
    throw new LocalSourceError("RESOURCE_LIMIT", "ZIP contains too many regular files")
  }
  for (const entry of includedFiles) {
    if ((entries[entry.sourceIndex]?.expandedBytes ?? 0) > LOCAL_SOURCE_LIMITS.singleIncludedFileBytes) {
      throw new LocalSourceError("RESOURCE_LIMIT", "A ZIP entry exceeds the single-file limit", { path: entry.rawName })
    }
  }
  const directoryPaths = new Set<string>()
  for (const entry of admittedEntries) {
    if (entry.ignored || entry.payloadPath === undefined) continue
    const segments = entry.payloadPath.split("/")
    const directoryLength = entry.kind === "directory" ? segments.length : segments.length - 1
    for (let length = 1; length <= directoryLength; length += 1) directoryPaths.add(segments.slice(0, length).join("/"))
  }
  if (directoryPaths.size > LOCAL_SOURCE_LIMITS.includedDirectories) {
    throw new LocalSourceError("RESOURCE_LIMIT", "ZIP contains too many directories")
  }
  const includedExpanded = admittedEntries.reduce((total, entry) => {
    if (entry.ignored || entry.kind !== "file") return total
    return total + (entries[entry.sourceIndex]?.expandedBytes ?? 0)
  }, 0)
  if (includedExpanded > LOCAL_SOURCE_LIMITS.zipExpandedIncludedBytes) {
    throw new LocalSourceError("EXPANDED_SIZE_LIMIT", "ZIP expanded payload exceeds local-source-v1")
  }
  return { entries: admittedEntries, ...(wrapper === undefined ? {} : { payloadWrapper: `${wrapper}/` }) }
}

async function locateDirectory(handle: FileHandle, archiveSize: number): Promise<{ entries: number; offset: number; size: number }> {
  const tailLength = Math.min(archiveSize, 65_557)
  const tailStart = archiveSize - tailLength
  const tail = await readExact(handle, tailStart, tailLength)
  let index = -1
  for (let cursor = tail.length - 22; cursor >= 0; cursor -= 1) {
    if (tail.readUInt32LE(cursor) === EOCD && cursor + 22 + tail.readUInt16LE(cursor + 20) === tail.length) {
      index = cursor
      break
    }
  }
  if (index < 0) throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP end-of-central-directory record is missing")
  const disk = tail.readUInt16LE(index + 4)
  const centralDisk = tail.readUInt16LE(index + 6)
  const diskEntries = tail.readUInt16LE(index + 8)
  const totalEntries = tail.readUInt16LE(index + 10)
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new LocalSourceError("ARCHIVE_MULTIDISK", "Multi-disk ZIP archives are not admitted")
  }
  let entries = totalEntries
  let size = tail.readUInt32LE(index + 12)
  let offset = tail.readUInt32LE(index + 16)
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const eocdAbsolute = tailStart + index
    if (eocdAbsolute < 20) throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP64 locator is missing")
    const locator = await readExact(handle, eocdAbsolute - 20, 20)
    if (locator.readUInt32LE(0) !== ZIP64_LOCATOR || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) {
      throw new LocalSourceError("ARCHIVE_MULTIDISK", "Invalid or multi-disk ZIP64 locator")
    }
    const zip64Offset = safeNumber(locator.readBigUInt64LE(8), "ZIP64 directory offset")
    const record = await readExact(handle, zip64Offset, 56)
    if (record.readUInt32LE(0) !== ZIP64_EOCD || record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) {
      throw new LocalSourceError("ARCHIVE_MULTIDISK", "Invalid or multi-disk ZIP64 directory")
    }
    entries = safeNumber(record.readBigUInt64LE(32), "ZIP64 entry count")
    if (safeNumber(record.readBigUInt64LE(24), "ZIP64 disk entry count") !== entries) throw new LocalSourceError("ARCHIVE_MULTIDISK", "ZIP64 entry counts differ by disk")
    size = safeNumber(record.readBigUInt64LE(40), "ZIP64 central size")
    offset = safeNumber(record.readBigUInt64LE(48), "ZIP64 central offset")
  }
  if (offset + size > archiveSize) throw new LocalSourceError("ARCHIVE_MALFORMED", "Central directory lies outside the archive")
  return { entries, offset, size }
}

async function readCentralEntries(handle: FileHandle, directory: { entries: number; offset: number; size: number }): Promise<readonly CentralEntry[]> {
  const entries: CentralEntry[] = []
  let cursor = directory.offset
  for (let ordinal = 0; ordinal < directory.entries; ordinal += 1) {
    const header = await readExact(handle, cursor, 46)
    if (header.readUInt32LE(0) !== CENTRAL) throw new LocalSourceError("ARCHIVE_MALFORMED", "Malformed central-directory entry")
    const versionMadeBy = header.readUInt16LE(4)
    const flags = header.readUInt16LE(8)
    const method = header.readUInt16LE(10)
    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0 || (flags & 0x2000) !== 0) throw new LocalSourceError("ARCHIVE_ENCRYPTED", "Encrypted ZIP entries are not admitted")
    if (method !== 0 && method !== 8) throw new LocalSourceError("ARCHIVE_METHOD", "Only STORE and DEFLATE ZIP methods are admitted")
    const nameLength = header.readUInt16LE(28)
    const extraLength = header.readUInt16LE(30)
    const commentLength = header.readUInt16LE(32)
    const nameBytes = await readExact(handle, cursor + 46, nameLength)
    const extra = await readExact(handle, cursor + 46 + nameLength, extraLength)
    const rawExpanded = header.readUInt32LE(24)
    const rawCompressed = header.readUInt32LE(20)
    const rawOffset = header.readUInt32LE(42)
    const rawDisk = header.readUInt16LE(34)
    const zip64Fields = [
      ...(rawExpanded === 0xffffffff ? ["expanded" as const] : []),
      ...(rawCompressed === 0xffffffff ? ["compressed" as const] : []),
      ...(rawOffset === 0xffffffff ? ["offset" as const] : []),
      ...(rawDisk === 0xffff ? ["disk" as const] : []),
    ]
    const zip64 = zip64Fields.length > 0 ? zip64Values(extra, zip64Fields) : {}
    const disk = rawDisk === 0xffff ? zip64.disk : rawDisk
    if (disk !== 0) throw new LocalSourceError("ARCHIVE_MULTIDISK", "ZIP entry belongs to another disk")
    const rawName = decodeName(nameBytes, (flags & 0x800) !== 0)
    const externalAttributes = header.readUInt32LE(38)
    const unixHost = (versionMadeBy >>> 8) === 3
    entries.push({
      rawName,
      rawNameBytes: nameBytes,
      kind: determineEntryKind(rawName, unixHost, externalAttributes),
      flags,
      compressionMethod: method,
      crc32: header.readUInt32LE(16),
      compressedBytes: rawCompressed === 0xffffffff ? zip64.compressed ?? -1 : rawCompressed,
      expandedBytes: rawExpanded === 0xffffffff ? zip64.expanded ?? -1 : rawExpanded,
      localHeaderOffset: rawOffset === 0xffffffff ? zip64.offset ?? -1 : rawOffset,
      externalAttributes,
      unixHost,
      zip64: zip64Fields.length > 0,
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== directory.offset + directory.size) throw new LocalSourceError("ARCHIVE_MALFORMED", "Central-directory size is inconsistent")
  return entries
}

async function resolveLocalRecords(handle: FileHandle, entries: readonly CentralEntry[], centralOffset: number): Promise<readonly ArchiveEntry[]> {
  const resolved: ArchiveEntry[] = []
  for (const entry of entries) {
    const header = await readExact(handle, entry.localHeaderOffset, 30)
    if (header.readUInt32LE(0) !== LOCAL) throw new LocalSourceError("ARCHIVE_MALFORMED", "Local ZIP header is missing")
    const flags = header.readUInt16LE(6)
    const method = header.readUInt16LE(8)
    if (flags !== entry.flags || method !== entry.compressionMethod) throw new LocalSourceError("ARCHIVE_MALFORMED", "Local and central ZIP headers disagree")
    const nameLength = header.readUInt16LE(26)
    const extraLength = header.readUInt16LE(28)
    const name = await readExact(handle, entry.localHeaderOffset + 30, nameLength)
    if (!name.equals(entry.rawNameBytes)) throw new LocalSourceError("ARCHIVE_MALFORMED", "Local and central ZIP names disagree")
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength
    let recordEnd = dataOffset + entry.compressedBytes
    if ((flags & 0x8) !== 0) {
      const descriptor = await readExact(handle, recordEnd, entry.zip64 ? 24 : 16)
      const signatureBytes = descriptor.readUInt32LE(0) === DATA_DESCRIPTOR ? 4 : 0
      const crc = descriptor.readUInt32LE(signatureBytes)
      const compressed = entry.zip64
        ? safeNumber(descriptor.readBigUInt64LE(signatureBytes + 4), "ZIP64 descriptor compressed size")
        : descriptor.readUInt32LE(signatureBytes + 4)
      const expanded = entry.zip64
        ? safeNumber(descriptor.readBigUInt64LE(signatureBytes + 12), "ZIP64 descriptor expanded size")
        : descriptor.readUInt32LE(signatureBytes + 8)
      if (crc !== entry.crc32 || compressed !== entry.compressedBytes || expanded !== entry.expandedBytes) {
        throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP data descriptor is inconsistent")
      }
      recordEnd += signatureBytes + (entry.zip64 ? 20 : 12)
    } else {
      const localCrc = header.readUInt32LE(14)
      const localCompressed = header.readUInt32LE(18)
      const localExpanded = header.readUInt32LE(22)
      if (localCrc !== entry.crc32 || (localCompressed !== 0xffffffff && localCompressed !== entry.compressedBytes) || (localExpanded !== 0xffffffff && localExpanded !== entry.expandedBytes)) {
        throw new LocalSourceError("ARCHIVE_MALFORMED", "Local ZIP sizes or CRC disagree with central directory")
      }
    }
    if (recordEnd > centralOffset) throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP entry overlaps the central directory")
    resolved.push({
      rawName: entry.rawName,
      kind: entry.kind,
      compressionMethod: entry.compressionMethod,
      flags,
      crc32: entry.crc32,
      compressedBytes: entry.compressedBytes,
      expandedBytes: entry.expandedBytes,
      dataOffset,
      localRecordStart: entry.localHeaderOffset,
      localRecordEnd: recordEnd,
      ignored: false,
    })
  }
  const ordered = [...resolved].sort((left, right) => left.localRecordStart - right.localRecordStart)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (previous !== undefined && current !== undefined && current.localRecordStart < previous.localRecordEnd) {
      throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP local records overlap")
    }
  }
  return resolved
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let value = 0; value < 256; value += 1) {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    table[value] = crc >>> 0
  }
  return table
})()

function updateCrc(crc: number, chunk: Uint8Array): number {
  let result = crc
  for (const byte of chunk) result = (CRC_TABLE[(result ^ byte) & 0xff] ?? 0) ^ (result >>> 8)
  return result >>> 0
}

export async function streamArchiveEntry(
  archivePath: string,
  entry: ArchiveEntry,
  onChunk?: (chunk: Buffer) => Promise<void> | void,
  expectedIdentity?: SourceIdentity,
): Promise<Readonly<{ byteLength: number; sha256: string }>> {
  const hash = createHash("sha256")
  let bytes = 0
  let crc = 0xffffffff
  const handle = await open(archivePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || (expectedIdentity !== undefined && (
      before.dev.toString() !== expectedIdentity.device ||
      before.ino.toString() !== expectedIdentity.inode ||
      before.size !== expectedIdentity.size ||
      Math.trunc(before.mtimeMs) !== expectedIdentity.modifiedMilliseconds
    ))) throw new LocalSourceError("SOURCE_CHANGED", "ZIP changed before entry streaming", { path: entry.rawName })
    if (entry.compressedBytes > 0 || entry.expandedBytes > 0) {
      const compressed = handle.createReadStream({
        start: entry.dataOffset,
        end: entry.dataOffset + entry.compressedBytes - 1,
        autoClose: false,
      })
      const output = entry.compressionMethod === 8 ? compressed.pipe(createInflateRaw()) : compressed
      for await (const rawChunk of output) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array)
        bytes += chunk.length
        if (bytes > entry.expandedBytes || bytes > LOCAL_SOURCE_LIMITS.singleIncludedFileBytes) {
          throw new LocalSourceError("EXPANDED_SIZE_LIMIT", "ZIP emitted more bytes than declared or allowed", { path: entry.rawName })
        }
        hash.update(chunk)
        crc = updateCrc(crc, chunk)
        await onChunk?.(chunk)
      }
    }
    const after = await handle.stat()
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) throw new LocalSourceError("SOURCE_CHANGED", "ZIP changed while streaming an entry", { path: entry.rawName })
  } catch (error) {
    if (error instanceof LocalSourceError) throw error
    throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP entry failed decompression", { path: entry.rawName, cause: error })
  } finally {
    await handle.close()
  }
  crc = (crc ^ 0xffffffff) >>> 0
  if (bytes !== entry.expandedBytes || crc !== entry.crc32) {
    throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP entry CRC or expanded size is inconsistent", { path: entry.rawName })
  }
  return { byteLength: bytes, sha256: hash.digest("hex") }
}

async function hashRawArchive(archivePath: string, expectedIdentity: SourceIdentity): Promise<string> {
  const hash = createHash("sha256")
  let bytes = 0
  const handle = await open(archivePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (
      before.dev.toString() !== expectedIdentity.device || before.ino.toString() !== expectedIdentity.inode ||
      before.size !== expectedIdentity.size || Math.trunc(before.mtimeMs) !== expectedIdentity.modifiedMilliseconds
    ) throw new LocalSourceError("SOURCE_CHANGED", "ZIP changed before raw hashing")
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > LOCAL_SOURCE_LIMITS.zipArchiveBytes) throw new LocalSourceError("ARCHIVE_SIZE_LIMIT", "ZIP exceeds the archive byte limit")
      hash.update(buffer)
    }
    const after = await handle.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new LocalSourceError("SOURCE_CHANGED", "ZIP changed while raw hashing")
    }
  } finally {
    await handle.close()
  }
  if (bytes !== expectedIdentity.size) throw new LocalSourceError("SOURCE_CHANGED", "ZIP changed while it was being hashed")
  return hash.digest("hex")
}

export async function inspectZipSource(selectedPath: string, observedAt: string): Promise<AdmittedLocalSource> {
  let handle: FileHandle | undefined
  try {
    const stats = await lstat(selectedPath)
    if (stats.isSymbolicLink() || !stats.isFile()) throw new LocalSourceError("SOURCE_TYPE", "Selected ZIP must be a real regular file")
    assertZipArchiveByteSize(stats.size)
    const canonical = await realpath(selectedPath)
    const identity = await sourceIdentity(canonical)
    if (
      stats.dev.toString() !== identity.device || stats.ino.toString() !== identity.inode ||
      stats.size !== identity.size || Math.trunc(stats.mtimeMs) !== identity.modifiedMilliseconds
    ) throw new LocalSourceError("SOURCE_CHANGED", "Selected ZIP changed during canonicalization")
    handle = await open(canonical, "r")
    const directory = await locateDirectory(handle, stats.size)
    const central = await readCentralEntries(handle, directory)
    const resolved = await resolveLocalRecords(handle, central, directory.offset)
    const description = central.map((entry) => ({
      kind: entry.kind,
      name: entry.rawName,
      compressedBytes: entry.compressedBytes,
      expandedBytes: entry.expandedBytes,
      compressionMethod: entry.compressionMethod,
      encrypted: (entry.flags & 1) !== 0,
    } as const))
    const metadata = admitArchiveDescription(description)
    const bySource = new Map(metadata.entries.map((entry) => [entry.sourceIndex, entry]))
    const manifestFiles: ManifestFileV1[] = []
    const archiveEntries: ArchiveEntry[] = []
    let actualIncludedBytes = 0
    for (let index = 0; index < resolved.length; index += 1) {
      const entry = resolved[index]
      const admitted = bySource.get(index)
      if (entry === undefined || admitted === undefined) throw new LocalSourceError("ARCHIVE_MALFORMED", "ZIP admission lost an entry")
      const enriched: ArchiveEntry = {
        ...entry,
        ...(admitted.payloadPath === undefined ? {} : { payloadPath: admitted.payloadPath }),
        ignored: admitted.ignored,
      }
      archiveEntries.push(enriched)
      if (entry.kind === "directory") continue
      const hashed = await streamArchiveEntry(canonical, enriched, undefined, identity)
      if (admitted.ignored) continue
      actualIncludedBytes += hashed.byteLength
      if (actualIncludedBytes > LOCAL_SOURCE_LIMITS.zipExpandedIncludedBytes) throw new LocalSourceError("EXPANDED_SIZE_LIMIT", "ZIP emitted too many included bytes")
      if (admitted.payloadPath === undefined) throw new LocalSourceError("ARCHIVE_MALFORMED", "Included ZIP file has no payload path")
      manifestFiles.push({ path: admitted.payloadPath, ...hashed })
    }
    const ignored = metadata.entries.filter(({ ignored }) => ignored)
    return {
      contract: "local-source-v1",
      kind: "zip",
      sourceLocator: canonical,
      identity,
      observedAt,
      manifest: createLocalSourceManifest(manifestFiles),
      archiveSha256: await hashRawArchive(canonical, identity),
      ...(metadata.payloadWrapper === undefined ? {} : { payloadWrapper: metadata.payloadWrapper }),
      ignoredEntries: {
        count: ignored.length,
        categories: [...new Set(ignored.map(({ rawName }) => rawName.startsWith("__MACOSX/") ? "macos-wrapper" : "metadata"))].sort(),
      },
      archiveEntries,
    }
  } catch (error) {
    if (error instanceof LocalSourceError) throw error
    throw new LocalSourceError("SOURCE_IO", "Could not safely inspect the selected ZIP", { path: selectedPath, cause: error })
  } finally {
    await handle?.close()
  }
}
