import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { createLocalSourceManifest, forgeTreeHash, hashDirectorySource, hashFile } from "./index.js"

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))))

describe("forge-tree-v1", () => {
  it("matches the independently frozen fixture vector exactly", async () => {
    const expected = JSON.parse(await readFile(path.join(repository, "packages/test-fixtures/imports/expected/basic-skill.manifest.json"), "utf8")) as unknown
    const result = await hashDirectorySource(path.join(repository, "packages/test-fixtures/imports/directories/basic-skill"))
    expect(result.findings).toEqual([])
    expect(result.manifest).toEqual(expected)
  })

  it("is stable across input traversal order and normalizes paths to NFC", () => {
    const files = [
      { path: "z.txt", byteLength: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
      { path: "cafe\u0301.txt", byteLength: 1, sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb" },
    ]
    const left = createLocalSourceManifest(files)
    const right = createLocalSourceManifest([...files].reverse())
    expect(left).toEqual(right)
    expect(left.files[0]?.path).toBe("café.txt")
    expect(forgeTreeHash(left.files)).toBe(left.treeHash)
  })

  it("hashes raw bytes so CRLF and LF are different", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forge-hash-"))
    temporary.push(directory)
    const lf = path.join(directory, "lf")
    const crlf = path.join(directory, "crlf")
    await writeFile(lf, "a\nb\n")
    await writeFile(crlf, "a\r\nb\r\n")
    expect((await hashFile(lf)).sha256).not.toBe((await hashFile(crlf)).sha256)
  })

  it("detects a size change while streaming instead of accepting a stale manifest", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forge-hash-size-"))
    temporary.push(directory)
    const file = path.join(directory, "file")
    await writeFile(file, "raw bytes")
    await expect(hashFile(file, 1)).rejects.toMatchObject({ code: "FILE_SIZE_CHANGED" })
  })
})
