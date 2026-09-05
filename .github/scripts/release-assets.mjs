import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

const RELEASE_SUFFIXES = Object.freeze({
  linux: [".deb", ".rpm", ".pkg.tar.zst"],
  macos: [".zip"],
  windows: [".exe"],
})

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  if (index < 0 || index + 1 >= process.argv.length) return undefined
  return process.argv[index + 1]
}

async function regularFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await regularFiles(candidate))
    else if (entry.isFile()) files.push(candidate)
  }
  return files.sort((left, right) => left.localeCompare(right, "en"))
}

async function sha256(candidate) {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(candidate)) digest.update(chunk)
  return digest.digest("hex")
}

function releaseVersion(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
    throw new Error(`Release tag must use vMAJOR.MINOR.PATCH syntax: ${tag}`)
  }
  return tag.slice(1)
}

async function collect() {
  const source = valueAfter("--source")
  const destination = valueAfter("--destination")
  const platform = valueAfter("--platform")
  const requestedArchitecture = valueAfter("--architecture")
  const tag = valueAfter("--tag")
  const commit = valueAfter("--commit")
  if (source === undefined || destination === undefined || platform === undefined || tag === undefined || commit === undefined) {
    throw new Error("collect requires --source, --destination, --platform, --tag, and --commit")
  }
  const suffixes = RELEASE_SUFFIXES[platform]
  if (suffixes === undefined) throw new Error(`Unsupported release platform: ${platform}`)
  const architecture = requestedArchitecture ?? process.arch
  if (!/^(?:arm64|x64)$/u.test(architecture)) {
    throw new Error(`Unsupported release architecture: ${architecture}`)
  }
  if (architecture !== process.arch) {
    throw new Error(`Release architecture ${architecture} does not match build process ${process.arch}`)
  }
  const version = releaseVersion(tag)
  const sourceFiles = await regularFiles(source)
  let toolchain
  if (platform === "linux") {
    const toolchainFiles = sourceFiles.filter((candidate) => path.basename(candidate) === "arch-toolchain.json")
    if (toolchainFiles.length !== 1) {
      throw new Error(`Expected one Linux Arch toolchain record, found ${toolchainFiles.length}`)
    }
    toolchain = JSON.parse(await readFile(toolchainFiles[0], "utf8"))
    if (
      toolchain.schemaVersion !== 1
      || !/^archlinux:base-devel@sha256:[a-f0-9]{64}$/u.test(toolchain.baseImage)
      || toolchain.node !== "v24.19.0"
      || typeof toolchain.pacman !== "string"
      || toolchain.pacman.length === 0
      || typeof toolchain.makepkg !== "string"
      || toolchain.makepkg.length === 0
    ) {
      throw new Error("Linux Arch toolchain record is incomplete or invalid")
    }
  }
  const candidates = suffixes.map((suffix) => {
    const matches = sourceFiles.filter((candidate) => candidate.toLowerCase().endsWith(suffix))
    if (matches.length !== 1) {
      throw new Error(`Expected one ${platform} ${suffix} release artifact, found ${matches.length}`)
    }
    return { candidate: matches[0], suffix }
  })
  if (new Set(candidates.map(({ candidate }) => candidate)).size !== candidates.length) {
    throw new Error(`Release suffixes overlap for ${platform}`)
  }
  await mkdir(destination, { recursive: true })
  const artifacts = []
  for (const { candidate, suffix } of candidates) {
    const name = `skillglass-v${version}-${platform}-${architecture}${suffix}`
    const output = path.join(destination, name)
    await cp(candidate, output, { errorOnExist: true, force: false })
    const details = await stat(output)
    artifacts.push({ name, bytes: details.size, sha256: await sha256(output) })
  }
  await writeFile(path.join(destination, `target-${platform}.json`), `${JSON.stringify({
    schemaVersion: 1,
    platform,
    architecture,
    tag,
    commit,
    node: process.version,
    environment: {
      osRelease: os.release(),
      osVersion: os.version(),
      runnerImage: process.env.ImageOS,
      runnerImageVersion: process.env.ImageVersion,
    },
    ...(toolchain === undefined ? {} : { toolchain }),
    artifacts,
  }, null, 2)}\n`, "utf8")
}

async function manifest() {
  const directory = valueAfter("--directory")
  const tag = valueAfter("--tag")
  const commit = valueAfter("--commit")
  const runId = valueAfter("--run-id")
  if (directory === undefined || tag === undefined || commit === undefined || runId === undefined) {
    throw new Error("manifest requires --directory, --tag, --commit, and --run-id")
  }
  releaseVersion(tag)
  const files = await regularFiles(directory)
  const targetFiles = files.filter((candidate) => /^target-(?:linux|macos|windows)\.json$/u.test(path.basename(candidate)))
  if (targetFiles.length !== 3) throw new Error(`Expected metadata from three native targets, found ${targetFiles.length}`)
  const targets = await Promise.all(targetFiles.map(async (candidate) => JSON.parse(await readFile(candidate, "utf8"))))
  for (const target of targets) {
    if (target.tag !== tag || target.commit !== commit) throw new Error("Native target metadata does not match the requested tag and commit")
  }
  const artifactFiles = files.filter((candidate) => !path.basename(candidate).startsWith("target-"))
  const expected = new Map(targets.flatMap((target) => target.artifacts.map((artifact) => [artifact.name, artifact.sha256])))
  if (artifactFiles.length !== expected.size) throw new Error("Downloaded release artifacts do not match target metadata")
  for (const candidate of artifactFiles) {
    const actual = await sha256(candidate)
    if (expected.get(path.basename(candidate)) !== actual) throw new Error(`Release artifact hash mismatch: ${path.basename(candidate)}`)
  }
  const packageJson = JSON.parse(await readFile("apps/desktop/package.json", "utf8"))
  const metadataPath = path.join(directory, "build-metadata.json")
  await writeFile(metadataPath, `${JSON.stringify({
    schemaVersion: 1,
    product: "Skillglass",
    tag,
    commit,
    workflowRunId: runId,
    electron: packageJson.devDependencies.electron,
    signing: {
      macos: {
        integrity: "ad-hoc-after-electron-fuses",
        trustedPublisherIdentity: false,
        notarized: false,
      },
      windows: {
        integrity: "unsigned",
        trustedPublisherIdentity: false,
      },
      linux: {
        integrity: "unsigned",
        trustedPublisherIdentity: false,
      },
    },
    distribution: "github-repository-release-assets-only",
    targets: targets.sort((left, right) => left.platform.localeCompare(right.platform, "en")),
  }, null, 2)}\n`, "utf8")
  const checksummed = [...artifactFiles, metadataPath].sort((left, right) => path.basename(left).localeCompare(path.basename(right), "en"))
  const lines = await Promise.all(checksummed.map(async (candidate) => `${await sha256(candidate)}  ${path.basename(candidate)}`))
  await writeFile(path.join(directory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8")
  await Promise.all(targetFiles.map((candidate) => rm(candidate)))
}

const command = process.argv[2]
try {
  if (command === "collect") await collect()
  else if (command === "manifest") await manifest()
  else throw new Error("Usage: release-assets.mjs <collect|manifest> [options]")
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
