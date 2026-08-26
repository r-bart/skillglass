import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const RELEASE_EXTENSIONS = Object.freeze({
  linux: new Set([".deb", ".rpm"]),
  macos: new Set([".zip"]),
  windows: new Set([".exe"]),
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
  const tag = valueAfter("--tag")
  const commit = valueAfter("--commit")
  if (source === undefined || destination === undefined || platform === undefined || tag === undefined || commit === undefined) {
    throw new Error("collect requires --source, --destination, --platform, --tag, and --commit")
  }
  const extensions = RELEASE_EXTENSIONS[platform]
  if (extensions === undefined) throw new Error(`Unsupported release platform: ${platform}`)
  const version = releaseVersion(tag)
  const candidates = (await regularFiles(source)).filter((candidate) => extensions.has(path.extname(candidate).toLowerCase()))
  if (candidates.length !== extensions.size) {
    throw new Error(`Expected ${extensions.size} ${platform} release artifact(s), found ${candidates.length}`)
  }
  await mkdir(destination, { recursive: true })
  const artifacts = []
  for (const candidate of candidates) {
    const extension = path.extname(candidate).toLowerCase()
    const name = `forge-v${version}-${platform}-${process.arch}${extension}`
    const output = path.join(destination, name)
    await cp(candidate, output, { errorOnExist: true, force: false })
    const details = await stat(output)
    artifacts.push({ name, bytes: details.size, sha256: await sha256(output) })
  }
  await writeFile(path.join(destination, `target-${platform}.json`), `${JSON.stringify({
    schemaVersion: 1,
    platform,
    architecture: process.arch,
    tag,
    commit,
    node: process.version,
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
    product: "Forge",
    tag,
    commit,
    workflowRunId: runId,
    electron: packageJson.devDependencies.electron,
    signing: "no-trusted-publisher-identity-policy-pending",
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
