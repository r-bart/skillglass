import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..")
const releaseAssetsScript = path.join(repositoryRoot, ".github", "scripts", "release-assets.mjs")
const temporaryRoots: string[] = []
const toolchain = {
  schemaVersion: 1,
  baseImage: `archlinux:base-devel@sha256:${"a".repeat(64)}`,
  node: "v24.19.0",
  pacman: "7.0.0",
  makepkg: "7.0.0",
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "skillglass-release-assets-"))
  temporaryRoots.push(directory)
  return directory
}

async function writeLinuxSource(source: string, formats = ["deb", "rpm", "pkg.tar.zst"]): Promise<void> {
  await mkdir(source, { recursive: true })
  await Promise.all([
    ...formats.map((format) => writeFile(path.join(source, `skillglass.${format}`), format)),
    writeFile(path.join(source, "arch-toolchain.json"), `${JSON.stringify(toolchain)}\n`),
  ])
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("repository release asset collection", () => {
  it("refuses to label an artifact for a different architecture than the build process", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "source")
    const destination = path.join(root, "destination")
    const otherArchitecture = process.arch === "arm64" ? "x64" : "arm64"
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, "skillglass.zip"), "zip")

    await expect(execFileAsync(process.execPath, [
      releaseAssetsScript,
      "collect",
      "--source", source,
      "--destination", destination,
      "--platform", "macos",
      "--architecture", otherArchitecture,
      "--tag", "v1.0.0",
      "--commit", "0123456789abcdef",
    ], { cwd: repositoryRoot })).rejects.toThrow(
      `Release architecture ${otherArchitecture} does not match build process ${process.arch}`,
    )
  })

  it("collects and names every Linux format including the compound Pacman suffix", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "source")
    const destination = path.join(root, "destination")
    await writeLinuxSource(source)
    await writeFile(path.join(source, "notes.txt"), "unrelated build output")

    await execFileAsync(process.execPath, [
      releaseAssetsScript,
      "collect",
      "--source", source,
      "--destination", destination,
      "--platform", "linux",
      "--tag", "v0.9.0",
      "--commit", "0123456789abcdef",
    ], { cwd: repositoryRoot })

    const files = (await readdir(destination)).sort()
    expect(files).toEqual([
      `skillglass-v0.9.0-linux-${process.arch}.deb`,
      `skillglass-v0.9.0-linux-${process.arch}.pkg.tar.zst`,
      `skillglass-v0.9.0-linux-${process.arch}.rpm`,
      "target-linux.json",
    ])
    const target = JSON.parse(await readFile(path.join(destination, "target-linux.json"), "utf8")) as {
      artifacts: { name: string }[]
      toolchain: typeof toolchain
    }
    expect(target.artifacts.map(({ name }) => name).sort()).toEqual(files.slice(0, 3))
    expect(target.toolchain).toEqual(toolchain)
  })

  it("fails closed when the Pacman artifact is absent", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "source")
    const destination = path.join(root, "destination")
    await writeLinuxSource(source, ["deb", "rpm"])

    await expect(execFileAsync(process.execPath, [
      releaseAssetsScript,
      "collect",
      "--source", source,
      "--destination", destination,
      "--platform", "linux",
      "--tag", "v0.9.0",
      "--commit", "0123456789abcdef",
    ], { cwd: repositoryRoot })).rejects.toThrow("Expected one linux .pkg.tar.zst release artifact, found 0")
  })

  it("fails closed when a release format is duplicated in nested maker output", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "source")
    const destination = path.join(root, "destination")
    await writeLinuxSource(source)
    await mkdir(path.join(source, "duplicate"))
    await writeFile(path.join(source, "duplicate", "skillglass-copy.pkg.tar.zst"), "duplicate")

    await expect(execFileAsync(process.execPath, [
      releaseAssetsScript,
      "collect",
      "--source", source,
      "--destination", destination,
      "--platform", "linux",
      "--tag", "v0.9.0",
      "--commit", "0123456789abcdef",
    ], { cwd: repositoryRoot })).rejects.toThrow("Expected one linux .pkg.tar.zst release artifact, found 2")
  })

  it("fails closed when Linux toolchain provenance is absent", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "source")
    const destination = path.join(root, "destination")
    await mkdir(source)
    await Promise.all([
      writeFile(path.join(source, "skillglass.deb"), "deb"),
      writeFile(path.join(source, "skillglass.rpm"), "rpm"),
      writeFile(path.join(source, "skillglass.pkg.tar.zst"), "pacman"),
    ])

    await expect(execFileAsync(process.execPath, [
      releaseAssetsScript,
      "collect",
      "--source", source,
      "--destination", destination,
      "--platform", "linux",
      "--tag", "v0.9.0",
      "--commit", "0123456789abcdef",
    ], { cwd: repositoryRoot })).rejects.toThrow("Expected one Linux Arch toolchain record, found 0")
  })
})
