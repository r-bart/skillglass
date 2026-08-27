import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { enumerateSkillResources, validatePortableRelativePath, validateSkillDirectory } from "./index.js"

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const fixtures = path.join(repository, "packages/test-fixtures/imports/directories")
const temporary: string[] = []

afterEach(async () => Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))))

describe("directory/resource validation", () => {
  it("enumerates an inert valid skill and resolves its declared resource", async () => {
    const result = await validateSkillDirectory(path.join(fixtures, "basic-skill"))
    expect(result.valid).toBe(true)
    expect(result.resources.map(({ path }) => path)).toEqual(["references/guide.md"])
    expect(result.references).toEqual([expect.objectContaining({ rawTarget: "references/guide.md", resolvedPath: "references/guide.md", kind: "local", exists: true })])
  })

  it("returns missing and malformed folders as findings rather than dropping them", async () => {
    const missing = await validateSkillDirectory(path.join(fixtures, "missing-entry"))
    expect(missing.valid).toBe(false)
    expect(missing.findings).toContainEqual(expect.objectContaining({ code: "SKILL_ENTRY_MISSING" }))
  })

  it("ignores only contractual metadata while retaining ordinary resources", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forge-metadata-"))
    temporary.push(directory)
    await mkdir(path.join(directory, ".git"))
    await Promise.all([
      writeFile(path.join(directory, "SKILL.md"), "---\nname: metadata\ndescription: metadata fixture\n---\n"),
      writeFile(path.join(directory, ".DS_Store"), "ignored macOS metadata"),
      writeFile(path.join(directory, "Thumbs.db"), "ignored Windows metadata"),
      writeFile(path.join(directory, ".git/config"), "ignored repository metadata"),
    ])
    const result = await enumerateSkillResources(directory)
    expect(result.files.map(({ path }) => path)).toEqual(["SKILL.md"])
    expect(result.ignoredEntries).toEqual(expect.arrayContaining([".DS_Store", ".git", "Thumbs.db"]))
  })

  it("normalizes Unicode resource paths to NFC", async () => {
    const result = await enumerateSkillResources(path.join(fixtures, "unicode-skill"))
    expect(result.files.map(({ path }) => path)).toContain("references/café.md")
  })

  it("reports broken, external, absolute, and traversal references", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forge-validation-"))
    temporary.push(directory)
    await writeFile(path.join(directory, "SKILL.md"), "---\nname: unsafe\ndescription: refs\n---\n[missing](missing.md) [web](https://example.com/x) [file](file:///etc/passwd) [escape](%2e%2e/secret) [absolute](/etc/passwd)\n")
    const result = await validateSkillDirectory(directory)
    const codes = result.findings.map(({ code }) => code)
    expect(codes).toContain("RESOURCE_REFERENCE_BROKEN")
    expect(codes.filter((code) => code === "RESOURCE_EXTERNAL_REFERENCE")).toHaveLength(2)
    expect(codes.filter((code) => code === "RESOURCE_REFERENCE_OUTSIDE_ROOT")).toHaveLength(2)
    expect(result.valid).toBe(false)
  })

  it("never follows a symlink resource", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forge-link-"))
    temporary.push(directory)
    await writeFile(path.join(directory, "SKILL.md"), "---\nname: linked\ndescription: link fixture\n---\n")
    await symlink(path.join(fixtures, "basic-skill/references"), path.join(directory, "references"), "dir")
    const result = await enumerateSkillResources(directory)
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "SOURCE_LINK_REJECTED" }))
    expect(result.files.map(({ path }) => path)).toEqual(["SKILL.md"])
  })

  it("enforces portable path boundaries and aliases", () => {
    expect(validatePortableRelativePath(`${"a".repeat(255)}/file`).findings).toEqual([])
    expect(validatePortableRelativePath(`${"a".repeat(256)}/file`).findings).toContainEqual(expect.objectContaining({ code: "PATH_SEGMENT_LIMIT" }))
    expect(validatePortableRelativePath("a/../secret").findings).toContainEqual(expect.objectContaining({ code: "PATH_TRAVERSAL" }))
    expect(validatePortableRelativePath("CON.txt").findings).toContainEqual(expect.objectContaining({ code: "PATH_WINDOWS_RESERVED" }))
    expect(validatePortableRelativePath("café.md").normalized).toBe("café.md")
    expect(validatePortableRelativePath("cafe\u0301.md").normalized).toBe("café.md")
  })

  it("rejects files larger than the frozen single-file ceiling before reading content", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forge-limit-"))
    temporary.push(directory)
    await mkdir(path.join(directory, "assets"))
    await writeFile(path.join(directory, "SKILL.md"), "---\nname: large\ndescription: large\n---\n")
    const oversized = path.join(directory, "assets/large.bin")
    const handle = await import("node:fs/promises").then(({ open }) => open(oversized, "w"))
    await handle.truncate(10 * 1024 * 1024 + 1)
    await handle.close()
    const result = await enumerateSkillResources(directory)
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "FILE_SIZE_LIMIT" }))
  })
})
