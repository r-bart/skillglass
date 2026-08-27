import { deflateRawSync } from "node:zlib"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { AdapterOperationPlan } from "@forge/adapter-api"
import { FilesystemApprovedRootPolicy } from "@forge/scanner"
import { afterEach, describe, expect, it } from "vitest"

import {
  ApprovedRootInstallTargetPolicy,
  ApprovedRootLocalInstallFileSystem,
  DirectorySourceLimitCounter,
  FileSystemLocalSourceAdmission,
  FileSystemLocalSourceMaterializer,
  LOCAL_SOURCE_LIMITS,
  LocalInstallCoordinator,
  LocalSourceError,
  MemoryOperationRepository,
  OperationEngine,
  SourceSelectionService,
  admitArchiveDescription,
  admitPortablePath,
  assertZipArchiveByteSize,
  inspectDirectorySource,
  inspectZipSource,
  type ArchiveDescriptionEntry,
  type LocalSourceSelection,
} from "../src/index.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fixtureRoot = path.join(repositoryRoot, "packages/test-fixtures/imports")
const temporaryDirectories: string[] = []
const NOW = "2026-08-26T12:00:00.000Z"

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-local-source-"))
  temporaryDirectories.push(directory)
  return directory
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipInput {
  readonly name: string
  readonly content?: string | Buffer
  readonly kind?: "file" | "directory" | "symlink"
  readonly method?: 0 | 8
}

function makeZip(entries: readonly ZipInput[]): Buffer {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let offset = 0
  for (const input of entries) {
    const kind = input.kind ?? "file"
    const name = Buffer.from(input.name, "utf8")
    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content ?? "", "utf8")
    const method = input.method ?? 0
    const compressed = method === 8 ? deflateRawSync(content) : content
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    const localRecord = Buffer.concat([local, name, compressed])
    localRecords.push(localRecord)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(name.length, 28)
    const mode = kind === "directory" ? 0o040700 : kind === "symlink" ? 0o120777 : 0o100600
    central.writeUInt32LE((mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centralRecords.push(Buffer.concat([central, name]))
    offset += localRecord.length
  }
  const central = Buffer.concat(centralRecords)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localRecords, central, end])
}

async function writeZip(entries: readonly ZipInput[]): Promise<string> {
  const directory = await temporaryDirectory()
  const archive = path.join(directory, "fixture.zip")
  await writeFile(archive, makeZip(entries))
  return archive
}

interface ArchiveFixture {
  readonly entries: ReadonlyArray<{
    readonly kind: "file" | "directory" | "symlink" | "special" | "generated-files"
    readonly name?: string
    readonly prefix?: string
    readonly count?: number
    readonly content?: string
    readonly declaredCompressedBytes?: number
    readonly declaredExpandedBytes?: number
  }>
  readonly archive?: { readonly encrypted?: boolean; readonly multiDisk?: boolean }
  readonly expected: { readonly admitted: boolean }
}

async function archiveFixture(name: string): Promise<ArchiveFixture> {
  return JSON.parse(await readFile(path.join(fixtureRoot, "archives", name), "utf8")) as ArchiveFixture
}

function describedEntries(fixture: ArchiveFixture): ArchiveDescriptionEntry[] {
  return fixture.entries.flatMap((entry) => {
    if (entry.kind === "generated-files") {
      return Array.from({ length: entry.count ?? 0 }, (_, index) => ({
        kind: "file" as const,
        name: `${entry.prefix ?? "file-"}${String(index)}.txt`,
        compressedBytes: Buffer.byteLength(entry.content ?? ""),
        expandedBytes: Buffer.byteLength(entry.content ?? ""),
        compressionMethod: 0,
      }))
    }
    const bytes = Buffer.byteLength(entry.content ?? "")
    return [{
      kind: entry.kind,
      name: entry.name ?? "missing-name",
      compressedBytes: entry.declaredCompressedBytes ?? bytes,
      expandedBytes: entry.declaredExpandedBytes ?? bytes,
      compressionMethod: 0,
    }]
  })
}

function errorCode(error: unknown): string | undefined {
  return error instanceof LocalSourceError ? error.code : undefined
}

describe("local-source-v1 directory admission", () => {
  it("hashes the canonical fixture deterministically and excludes only frozen metadata", async () => {
    const expected = JSON.parse(await readFile(path.join(fixtureRoot, "expected/basic-skill.manifest.json"), "utf8")) as { treeHash: string }
    const source = await inspectDirectorySource(path.join(fixtureRoot, "directories/basic-skill"), NOW)
    expect(source.manifest.treeHash).toBe(expected.treeHash)
    expect(source.manifest.files.map(({ path: relativePath }) => relativePath)).toEqual(["SKILL.md", "references/guide.md"])

    const metadataDirectory = await temporaryDirectory()
    await writeFile(
      path.join(metadataDirectory, "SKILL.md"),
      await readFile(path.join(fixtureRoot, "directories/metadata-skill/SKILL.md")),
    )
    await mkdir(path.join(metadataDirectory, ".git"))
    await Promise.all([
      writeFile(path.join(metadataDirectory, ".DS_Store"), "ignored macOS metadata"),
      writeFile(path.join(metadataDirectory, "Thumbs.db"), "ignored Windows metadata"),
      writeFile(path.join(metadataDirectory, ".git/config"), "ignored repository metadata"),
    ])
    const metadata = await inspectDirectorySource(metadataDirectory, NOW)
    expect(metadata.ignoredEntries).toEqual({ count: 3, categories: ["os-metadata", "vcs"] })
    expect(metadata.manifest.files.map(({ path: relativePath }) => relativePath)).toEqual(["SKILL.md"])
  })

  it("rejects a missing SKILL.md and never follows a source symlink", async () => {
    await expect(inspectDirectorySource(path.join(fixtureRoot, "directories/missing-entry"), NOW))
      .rejects.toMatchObject({ code: "SKILL_ENTRY_MISSING" })
    const directory = await temporaryDirectory()
    await cp(path.join(fixtureRoot, "directories/basic-skill"), directory, { recursive: true })
    await symlink(path.join(directory, "SKILL.md"), path.join(directory, "linked.md"))
    await expect(inspectDirectorySource(directory, NOW)).rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY_TYPE" })
  })
})

describe("ZIP metadata and resource admission", () => {
  for (const name of [
    "valid-root.json",
    "valid-wrapper.json",
    "equivalent-basic.json",
    "reject-absolute-paths.json",
    "reject-bomb.json",
    "reject-collisions.json",
    "reject-deep-path.json",
    "reject-duplicate-entry.json",
    "reject-encrypted.json",
    "reject-limits.json",
    "reject-link.json",
    "reject-traversal.json",
    "reject-wrapper-ambiguity.json",
  ]) {
    it(`enforces declarative fixture ${name}`, async () => {
      const fixture = await archiveFixture(name)
      const operation = () => admitArchiveDescription(describedEntries(fixture), fixture.archive)
      if (fixture.expected.admitted) expect(operation()).toBeDefined()
      else expect(operation).toThrow(LocalSourceError)
    })
  }

  it("admits every exact numeric boundary and rejects boundary plus one", () => {
    const skill = { kind: "file" as const, name: "SKILL.md", compressedBytes: 1, expandedBytes: 1, compressionMethod: 0 }
    const exactFile = { kind: "file" as const, name: "asset.bin", compressedBytes: LOCAL_SOURCE_LIMITS.singleIncludedFileBytes, expandedBytes: LOCAL_SOURCE_LIMITS.singleIncludedFileBytes, compressionMethod: 0 }
    expect(() => admitArchiveDescription([skill, exactFile])).not.toThrow()
    expect(() => admitArchiveDescription([skill, { ...exactFile, expandedBytes: exactFile.expandedBytes + 1, compressedBytes: exactFile.compressedBytes + 1 }]))
      .toThrow(LocalSourceError)

    const exactRatio = { kind: "file" as const, name: "ratio.bin", compressedBytes: 10, expandedBytes: 1_000, compressionMethod: 8 }
    expect(() => admitArchiveDescription([skill, exactRatio])).not.toThrow()
    expect(() => admitArchiveDescription([skill, { ...exactRatio, expandedBytes: 1_001 }])).toThrowError(/ratio/u)

    const exactFiles = [skill, ...Array.from({ length: LOCAL_SOURCE_LIMITS.includedRegularFiles - 1 }, (_, index) => ({
      kind: "file" as const, name: `f-${String(index)}`, compressedBytes: 1, expandedBytes: 1, compressionMethod: 0,
    }))]
    expect(() => admitArchiveDescription(exactFiles)).not.toThrow()
    expect(() => admitArchiveDescription([...exactFiles, { kind: "file", name: "overflow", compressedBytes: 1, expandedBytes: 1, compressionMethod: 0 }]))
      .toThrow(LocalSourceError)

    const exactDirectories = [skill, ...Array.from({ length: LOCAL_SOURCE_LIMITS.includedDirectories }, (_, index) => ({
      kind: "directory" as const, name: `d-${String(index)}/`, compressedBytes: 0, expandedBytes: 0, compressionMethod: 0,
    }))]
    expect(() => admitArchiveDescription(exactDirectories)).not.toThrow()
    expect(() => admitArchiveDescription([...exactDirectories, { kind: "directory", name: "overflow/", compressedBytes: 0, expandedBytes: 0, compressionMethod: 0 }]))
      .toThrow(LocalSourceError)

    const exactExpanded = [skill, ...Array.from({ length: 9 }, (_, index) => ({
      kind: "file" as const,
      name: `large-${String(index)}`,
      compressedBytes: LOCAL_SOURCE_LIMITS.singleIncludedFileBytes,
      expandedBytes: LOCAL_SOURCE_LIMITS.singleIncludedFileBytes,
      compressionMethod: 0,
    })), {
      kind: "file" as const,
      name: "remainder",
      compressedBytes: LOCAL_SOURCE_LIMITS.singleIncludedFileBytes - 1,
      expandedBytes: LOCAL_SOURCE_LIMITS.singleIncludedFileBytes - 1,
      compressionMethod: 0,
    }]
    expect(() => admitArchiveDescription(exactExpanded)).not.toThrow()
    expect(() => admitArchiveDescription(exactExpanded.map((entry) =>
      entry.name === "remainder" ? { ...entry, compressedBytes: entry.compressedBytes + 1, expandedBytes: entry.expandedBytes + 1 } : entry
    ))).toThrow(LocalSourceError)

    const directoryBytes = new DirectorySourceLimitCounter()
    for (let index = 0; index < 10; index += 1) directoryBytes.includeFile(LOCAL_SOURCE_LIMITS.singleIncludedFileBytes)
    expect(() => directoryBytes.includeFile(1)).toThrow(LocalSourceError)
    const directoryCounts = new DirectorySourceLimitCounter()
    for (let index = 0; index < LOCAL_SOURCE_LIMITS.includedDirectories; index += 1) directoryCounts.includeDirectory()
    expect(() => directoryCounts.includeDirectory()).toThrow(LocalSourceError)
    const directoryFiles = new DirectorySourceLimitCounter()
    for (let index = 0; index < LOCAL_SOURCE_LIMITS.includedRegularFiles; index += 1) directoryFiles.includeFile(0)
    expect(() => directoryFiles.includeFile(0)).toThrow(LocalSourceError)
    expect(() => assertZipArchiveByteSize(LOCAL_SOURCE_LIMITS.zipArchiveBytes)).not.toThrow()
    expect(() => assertZipArchiveByteSize(LOCAL_SOURCE_LIMITS.zipArchiveBytes + 1)).toThrow(LocalSourceError)
  })

  it("rejects traversal, aliases, implicit directory collisions, and portable path overflows", () => {
    expect(() => admitPortablePath("../escape")).toThrow(LocalSourceError)
    expect(() => admitPortablePath("C:\\escape")).toThrow(LocalSourceError)
    expect(() => admitPortablePath(`${"a".repeat(256)}/file`)).toThrow(LocalSourceError)
    expect(() => admitPortablePath("a".repeat(255))).not.toThrow()
    expect(() => admitPortablePath(Array.from({ length: 5 }, () => "a".repeat(204)).join("/"))).not.toThrow()
    expect(() => admitPortablePath(`${Array.from({ length: 4 }, () => "a".repeat(204)).join("/")}/${"a".repeat(205)}`)).toThrow(LocalSourceError)
    expect(() => admitPortablePath(Array.from({ length: 16 }, () => "x").join("/"))).not.toThrow()
    expect(() => admitPortablePath(Array.from({ length: 17 }, () => "x").join("/"))).toThrow(LocalSourceError)
    expect(() => admitArchiveDescription([
      { kind: "file", name: "SKILL.md", compressedBytes: 1, expandedBytes: 1 },
      { kind: "file", name: "Straße/a", compressedBytes: 1, expandedBytes: 1 },
      { kind: "file", name: "STRASSE/b", compressedBytes: 1, expandedBytes: 1 },
    ])).toThrowError(/collision/u)
  })
})

describe("real ZIP inspection and materialization", () => {
  it("produces the directory hash for equivalent ZIP bytes and verifies staged output", async () => {
    const skill = await readFile(path.join(fixtureRoot, "directories/basic-skill/SKILL.md"))
    const guide = await readFile(path.join(fixtureRoot, "directories/basic-skill/references/guide.md"))
    const archive = await writeZip([
      { name: "wrapped/", kind: "directory" },
      { name: "wrapped/SKILL.md", content: skill, method: 8 },
      { name: "wrapped/references/guide.md", content: guide },
    ])
    const admitted = await inspectZipSource(archive, NOW)
    const directory = await inspectDirectorySource(path.join(fixtureRoot, "directories/basic-skill"), NOW)
    expect(admitted).toMatchObject({ kind: "zip", payloadWrapper: "wrapped/" })
    expect(admitted.manifest).toEqual(directory.manifest)
    expect(admitted.archiveSha256).toMatch(/^[a-f0-9]{64}$/u)

    const targetRoot = await temporaryDirectory()
    const policy = await FilesystemApprovedRootPolicy.create([{
      rootId: "root", path: targetRoot, kind: "global", access: "read-write", writableWithoutElevation: true,
    }])
    const materializer = new FileSystemLocalSourceMaterializer(policy)
    await expect(materializer.materialize(admitted, { rootId: "root", relativePath: ".stage", kind: "tree" }))
      .resolves.toEqual(directory.manifest)
    expect(await readFile(path.join(targetRoot, ".stage/references/guide.md"), "utf8")).toBe(guide.toString("utf8"))
  })

  it("rejects traversal and link ZIP entries before any destination exists", async () => {
    const traversal = await writeZip([
      { name: "SKILL.md", content: "---\nname: safe\ndescription: safe\n---\n" },
      { name: "../escape.txt", content: "escape" },
    ])
    await expect(inspectZipSource(traversal, NOW)).rejects.toMatchObject({ code: "PATH_INVALID" })

    const link = await writeZip([
      { name: "SKILL.md", content: "---\nname: safe\ndescription: safe\n---\n" },
      { name: "outside", content: "../outside", kind: "symlink" },
    ])
    await expect(inspectZipSource(link, NOW)).rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY_TYPE" })
  })

  it("rejects duplicate central names and CRC-invalid emitted bytes", async () => {
    const validSkill = "---\nname: safe\ndescription: safe\n---\n"
    const duplicate = await writeZip([
      { name: "SKILL.md", content: validSkill },
      { name: "SKILL.md", content: validSkill },
    ])
    await expect(inspectZipSource(duplicate, NOW)).rejects.toMatchObject({ code: "PATH_COLLISION" })

    const corruptedBytes = makeZip([{ name: "SKILL.md", content: validSkill }])
    const contentOffset = 30 + Buffer.byteLength("SKILL.md")
    corruptedBytes[contentOffset] = (corruptedBytes[contentOffset] ?? 0) ^ 0xff
    const directory = await temporaryDirectory()
    const corrupted = path.join(directory, "corrupted.zip")
    await writeFile(corrupted, corruptedBytes)
    await expect(inspectZipSource(corrupted, NOW)).rejects.toMatchObject({ code: "ARCHIVE_MALFORMED" })
  })

  it("rejects an archive above 25 MiB before parsing", async () => {
    const archive = await writeZip([{ name: "SKILL.md", content: "x" }])
    await truncate(archive, LOCAL_SOURCE_LIMITS.zipArchiveBytes + 1)
    await expect(inspectZipSource(archive, NOW)).rejects.toMatchObject({ code: "ARCHIVE_SIZE_LIMIT" })
  })
})

describe("opaque selection authorization", () => {
  it("expires after exactly 15 minutes and cannot be rebound to another plan", async () => {
    const sourcePath = path.join(fixtureRoot, "directories/basic-skill")
    let milliseconds = Date.parse(NOW)
    const selections = new SourceSelectionService({
      dialog: { selectDirectory: async () => sourcePath, selectZipFile: async () => undefined },
      admission: new FileSystemLocalSourceAdmission(),
      now: () => new Date(milliseconds),
      mintToken: () => "opaque-token-with-sufficient-entropy-for-test",
    })
    const selection = await selections.select("directory")
    expect(selection?.selectionToken).not.toContain(sourcePath)
    if (selection === undefined) throw new Error("selection unexpectedly cancelled")
    await selections.claimForPlan(selection.selectionToken, "plan-a", selection)
    selections.markPlanPersisted(selection.selectionToken, "plan-a")
    await expect(selections.claimForPlan(selection.selectionToken, "plan-b", selection))
      .rejects.toMatchObject({ code: "SELECTION_ALREADY_CLAIMED" })
    milliseconds += 15 * 60_000
    await expect(selections.reauthorizeForPlan(selection.selectionToken, "plan-a"))
      .rejects.toMatchObject({ code: "SELECTION_EXPIRED" })
  })

  it("detects a changed source identity and content before confirmation", async () => {
    const sourcePath = await temporaryDirectory()
    await cp(path.join(fixtureRoot, "directories/basic-skill"), sourcePath, { recursive: true })
    const selections = new SourceSelectionService({
      dialog: { selectDirectory: async () => sourcePath, selectZipFile: async () => undefined },
      admission: new FileSystemLocalSourceAdmission(), mintToken: () => "changed-source-token",
    })
    const selection = await selections.select("directory")
    if (selection === undefined) throw new Error("selection unexpectedly cancelled")
    await writeFile(path.join(sourcePath, "references/guide.md"), "changed\n")
    await expect(selections.claimForPlan(selection.selectionToken, "plan", selection))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" })
  })
})

function adapterPlan(selection: LocalSourceSelection, destination = "installed-skill"): AdapterOperationPlan {
  return {
    capability: "installToUserRoot",
    operation: {
      planId: "adapter-plan-local-install",
      kind: "install-local",
      status: "planned",
      createdAt: NOW,
      expiresAt: "2026-08-26T12:14:00.000Z",
      adapterId: "codex",
      installationIds: [],
      targetRootId: "skills-root",
      affectedScopes: [{ kind: "global" }],
      affectedEntries: [{ action: "create", rootId: "skills-root", relativePath: destination }],
      preconditions: [], conflicts: [], warnings: [], undo: "persistent",
      summary: "Install verified local source",
    },
    steps: [{ kind: "create-installation", rootId: "skills-root", relativePath: destination, sourceTreeHash: selection.treeHash }],
    postconditions: [{ kind: "tree-hash-equals", rootId: "skills-root", relativePath: destination, expectedHash: selection.treeHash }],
  }
}

async function installHarness() {
  const sourcePath = await temporaryDirectory()
  await cp(path.join(fixtureRoot, "directories/basic-skill"), sourcePath, { recursive: true })
  const targetRoot = await temporaryDirectory()
  const policy = await FilesystemApprovedRootPolicy.create([{
    rootId: "skills-root", path: targetRoot, kind: "global", access: "read-write", writableWithoutElevation: true,
  }])
  const selections = new SourceSelectionService({
    dialog: { selectDirectory: async () => sourcePath, selectZipFile: async () => undefined },
    admission: new FileSystemLocalSourceAdmission(), now: () => new Date(NOW), mintToken: () => "install-selection-token",
  })
  const selection = await selections.select("directory")
  if (selection === undefined) throw new Error("selection unexpectedly cancelled")
  const operationRepository = new MemoryOperationRepository()
  const fileSystem = new ApprovedRootLocalInstallFileSystem(policy)
  const engine = new OperationEngine({
    repository: operationRepository,
    fileSystem,
    clock: { now: () => new Date(NOW) },
    ids: { next: (() => { let next = 0; return () => `event-${String(next++)}` })() },
  })
  await engine.recoverStartup()
  const materializer = new FileSystemLocalSourceMaterializer(policy)
  const coordinator = new LocalInstallCoordinator({
    selections,
    targets: new ApprovedRootInstallTargetPolicy(policy),
    materializer,
    engine,
  })
  return { sourcePath, targetRoot, selection, operationRepository, fileSystem, engine, materializer, coordinator }
}

describe("local install coordinator and executor", () => {
  it("persists an exact preview, commits verified provenance, and undoes after restart", async () => {
    const harness = await installHarness()
    const prepared = await harness.coordinator.prepare({
      source: harness.selection,
      adapterPlan: adapterPlan(harness.selection),
      journalId: "journal-local-install",
    })
    expect(prepared.preview).toEqual([
      { action: "create", rootId: "skills-root", relativePath: "installed-skill" },
      expect.objectContaining({ action: "create", relativePath: "installed-skill/SKILL.md" }),
      expect.objectContaining({ action: "create", relativePath: "installed-skill/references/guide.md" }),
    ])
    await expect(readFile(path.join(harness.targetRoot, "installed-skill/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" })

    const executed = await harness.coordinator.execute(prepared)
    expect(executed.plan).toMatchObject({ state: "committed", undoStatus: "available" })
    expect(executed.provenance).toMatchObject({
      contract: "local-source-v1",
      sourceKind: "directory",
      sourceLocator: await realpath(harness.sourcePath),
      sourceTreeHash: harness.selection.treeHash,
      installedTreeHash: harness.selection.treeHash,
      targetRootId: "skills-root",
      destinationCanonicalPath: path.join(await realpath(harness.targetRoot), "installed-skill"),
      createdByJournalId: "journal-local-install",
    })
    expect(executed.provenance.installedManifest).toEqual(executed.provenance.sourceManifest)

    const restarted = new OperationEngine({
      repository: harness.operationRepository,
      fileSystem: new ApprovedRootLocalInstallFileSystem(await FilesystemApprovedRootPolicy.create([{
        rootId: "skills-root",
        path: harness.targetRoot,
        kind: "global",
        access: "read-write",
        writableWithoutElevation: true,
      }])),
      clock: { now: () => new Date(NOW) },
      ids: { next: () => "restart-event" },
    })
    await restarted.recoverStartup()
    await expect(restarted.undo(prepared.plan.id)).resolves.toMatchObject({ undoStatus: "completed" })
    await expect(readFile(path.join(harness.targetRoot, "installed-skill/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(path.join(harness.sourcePath, "SKILL.md"), "utf8")).toContain("basic-skill")
  })

  it("refuses a destination collision without mutating either tree", async () => {
    const harness = await installHarness()
    await mkdir(path.join(harness.targetRoot, "Installed-Skill"))
    await writeFile(path.join(harness.targetRoot, "Installed-Skill/keep.txt"), "keep")
    await expect(harness.coordinator.prepare({
      source: harness.selection,
      adapterPlan: adapterPlan(harness.selection),
      journalId: "journal-collision",
    })).rejects.toMatchObject({ code: "DESTINATION_COLLISION" })
    expect(await readFile(path.join(harness.targetRoot, "Installed-Skill/keep.txt"), "utf8")).toBe("keep")
    expect(await readFile(path.join(harness.sourcePath, "SKILL.md"), "utf8")).toContain("basic-skill")
  })

  it("rejects an adapter plan whose create step does not match the admitted manifest", async () => {
    const harness = await installHarness()
    const admittedPlan = adapterPlan(harness.selection)
    const mismatched: AdapterOperationPlan = {
      ...admittedPlan,
      steps: [{
        kind: "create-installation",
        rootId: "skills-root",
        relativePath: "installed-skill",
        sourceTreeHash: "f".repeat(64),
      }],
    }
    await expect(harness.coordinator.prepare({
      source: harness.selection,
      adapterPlan: mismatched,
      journalId: "journal-mismatch",
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
    expect(await readdir(harness.targetRoot)).toEqual([])
  })

  it("refuses confirmation after the selected source changes and leaves destination absent", async () => {
    const harness = await installHarness()
    const prepared = await harness.coordinator.prepare({
      source: harness.selection,
      adapterPlan: adapterPlan(harness.selection),
      journalId: "journal-stale",
    })
    await writeFile(path.join(harness.sourcePath, "references/guide.md"), "external change\n")
    await expect(harness.coordinator.execute(prepared)).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
    await expect(readFile(path.join(harness.targetRoot, "installed-skill/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("refuses exact removal when an added empty directory changes ownership shape", async () => {
    const harness = await installHarness()
    const admitted = await inspectDirectorySource(harness.sourcePath, NOW)
    const artifact = { rootId: "skills-root", relativePath: ".owned-stage", kind: "tree" as const }
    await harness.materializer.materialize(admitted, artifact)
    await mkdir(path.join(harness.targetRoot, ".owned-stage/external-empty"))
    await expect(harness.materializer.removeExact(artifact, admitted.manifest.treeHash)).resolves.toBe(false)
    expect(await readFile(path.join(harness.targetRoot, ".owned-stage/SKILL.md"), "utf8")).toContain("basic-skill")
  })

  it("executes an admitted wrapped ZIP through the same verified install pipeline", async () => {
    const skill = await readFile(path.join(fixtureRoot, "directories/basic-skill/SKILL.md"))
    const guide = await readFile(path.join(fixtureRoot, "directories/basic-skill/references/guide.md"))
    const archive = await writeZip([
      { name: "one-wrapper/SKILL.md", content: skill, method: 8 },
      { name: "one-wrapper/references/guide.md", content: guide },
    ])
    const targetRoot = await temporaryDirectory()
    const policy = await FilesystemApprovedRootPolicy.create([{
      rootId: "skills-root", path: targetRoot, kind: "global", access: "read-write", writableWithoutElevation: true,
    }])
    const selections = new SourceSelectionService({
      dialog: { selectDirectory: async () => undefined, selectZipFile: async () => archive },
      admission: new FileSystemLocalSourceAdmission(), now: () => new Date(NOW), mintToken: () => "zip-install-token",
    })
    const selection = await selections.select("zip")
    if (selection === undefined) throw new Error("selection unexpectedly cancelled")
    const operationRepository = new MemoryOperationRepository()
    const engine = new OperationEngine({
      repository: operationRepository,
      fileSystem: new ApprovedRootLocalInstallFileSystem(policy),
      clock: { now: () => new Date(NOW) },
      ids: { next: () => "zip-event" },
    })
    await engine.recoverStartup()
    const coordinator = new LocalInstallCoordinator({
      selections,
      targets: new ApprovedRootInstallTargetPolicy(policy),
      materializer: new FileSystemLocalSourceMaterializer(policy),
      engine,
    })
    const prepared = await coordinator.prepare({
      source: selection,
      adapterPlan: adapterPlan(selection, "from-zip"),
      journalId: "journal-zip",
    })
    const executed = await coordinator.execute(prepared)
    expect(executed.provenance).toMatchObject({
      sourceKind: "zip",
      payloadWrapper: "one-wrapper/",
      archiveSha256: selection.archiveSha256,
      installedTreeHash: selection.treeHash,
    })
    expect(await readFile(path.join(targetRoot, "from-zip/references/guide.md"), "utf8")).toBe(guide.toString("utf8"))
  })
})

describe("test helper integrity", () => {
  it("reports stable LocalSourceError codes", () => {
    expect(errorCode(new LocalSourceError("PATH_INVALID", "unsafe"))).toBe("PATH_INVALID")
  })
})
