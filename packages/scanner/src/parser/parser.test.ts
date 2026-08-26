import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { parseSkillFile, parseSkillSource } from "./index.js"

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("SKILL.md parser", () => {
  it("parses the import fixture and preserves every source character", async () => {
    const file = path.join(repository, "packages/test-fixtures/imports/directories/basic-skill/SKILL.md")
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(file, "utf8"))
    const parsed = await parseSkillFile(file)
    expect(parsed).toMatchObject({ name: "basic-skill", description: "A minimal local import fixture.", rawSource: source, findings: [] })
    expect(parsed.rawBody).toBe("\n# Basic skill\n\nRead [the guide](references/guide.md) without executing bundled content.\n")
  })

  it("preserves CRLF, Unicode, body, and unknown nested frontmatter blocks", () => {
    const source = "---\r\nname: café\r\ndescription: 'Descripción'\r\nfuture:\r\n  nested: true\r\n  list: [α, β]\r\n---\r\n# Héllo\r\n"
    const parsed = parseSkillSource(source)
    expect(parsed.rawSource).toBe(source)
    expect(parsed.rawFrontmatter).toBe("name: café\r\ndescription: 'Descripción'\r\nfuture:\r\n  nested: true\r\n  list: [α, β]\r\n")
    expect(parsed.rawBody).toBe("# Héllo\r\n")
    expect(parsed.fields.find(({ key }) => key === "future")?.raw).toBe("future:\r\n  nested: true\r\n  list: [α, β]\r\n")
    expect(parsed).toMatchObject({ name: "café", description: "Descripción", findings: [] })
  })

  it("supports quoted and block string scalars without rewriting them", () => {
    const parsed = parseSkillSource('---\nname: "quoted\\nname"\ndescription: |\n  first\n  second\nx-extra: {keep: exactly}\n---\nbody')
    expect(parsed.name).toBe("quoted\nname")
    expect(parsed.description).toBe("first\nsecond")
    expect(parsed.fields.at(-1)?.raw).toBe("x-extra: {keep: exactly}\n")
  })

  it.each([
    ["no frontmatter", "FRONTMATTER_REQUIRED"],
    ["---\nname: only\n---\n", "FRONTMATTER_DESCRIPTION_REQUIRED"],
    ["---\nname: []\ndescription: ok\n---\n", "FRONTMATTER_NAME_INVALID"],
    ["---\nname: one\nname: two\ndescription: ok\n---\n", "FRONTMATTER_NAME_DUPLICATE"],
    ["---\nnot yaml\nname: ok\ndescription: ok\n---\n", "FRONTMATTER_MALFORMED"],
  ])("returns invalid source as a finding (%s)", (source, code) => {
    expect(parseSkillSource(source).findings).toContainEqual(expect.objectContaining({ code, severity: "error" }))
  })

  it("reports invalid UTF-8 instead of executing or discarding the file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forge-parser-"))
    temporary.push(directory)
    const file = path.join(directory, "SKILL.md")
    await writeFile(file, Buffer.from([0xff, 0xfe, 0x61]))
    const parsed = await parseSkillFile(file)
    expect(parsed.rawSource.length).toBeGreaterThan(0)
    expect(parsed.findings.map(({ code }) => code)).toContain("SKILL_SOURCE_INVALID_UTF8")
  })

  it("parses all documented Codex fixture installations", async () => {
    const root = path.join(repository, "packages/test-fixtures/codex")
    const manifest = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(root, "fixture-manifest.json"), "utf8"))) as { expectedInstallations: Array<{ path: string }> }
    const parsed = await Promise.all(manifest.expectedInstallations.map(({ path: installation }) => parseSkillFile(path.join(root, installation, "SKILL.md"))))
    expect(parsed).toHaveLength(10)
    expect(parsed.every(({ findings }) => findings.length === 0)).toBe(true)
  })
})
