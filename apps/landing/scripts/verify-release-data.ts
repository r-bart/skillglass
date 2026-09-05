import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import type {
  PublishedRelease,
  PublishedReleaseAsset,
} from "../src/data/release.js"

const releaseModuleUrl = new URL("../src/data/release.ts", import.meta.url)
type ReleaseModule = typeof import("../src/data/release.js")
const {
  definePublishedRelease,
  publishedAssets,
  skillglassRelease,
} = await import(releaseModuleUrl.href) as ReleaseModule

assert.equal(skillglassRelease.status, "pending")
assert.deepEqual(publishedAssets(skillglassRelease), [])
const desktopPackage = JSON.parse(
  await readFile(new URL("../../desktop/package.json", import.meta.url), "utf8"),
) as { version?: string }
assert.equal(desktopPackage.version, skillglassRelease.version)
assert.equal(
  new Set(skillglassRelease.targets.map(({ fileName }) => fileName)).size,
  skillglassRelease.targets.length,
  "Every planned release target must have a distinct filename",
)
assert.equal(
  new Set(skillglassRelease.targets.map(({ id }) => id)).size,
  skillglassRelease.targets.length,
  "Every planned release target must have a distinct ID",
)

assert.deepEqual(
  skillglassRelease.targets.map(({ fileName }) => fileName),
  [
    "skillglass-v1.0.0-macos-arm64.zip",
    "skillglass-v1.0.0-windows-x64.exe",
    "skillglass-v1.0.0-linux-x64.deb",
    "skillglass-v1.0.0-linux-x64.rpm",
    "skillglass-v1.0.0-linux-x64.pkg.tar.zst",
  ],
)

const firstTarget = skillglassRelease.targets[0]
assert(firstTarget !== undefined)
const verifiedAsset: PublishedReleaseAsset = {
  ...firstTarget,
  verification: "verified",
  url: "https://github.com/r-bart/skillglass/releases/download/v1.0.0/skillglass-v1.0.0-macos-arm64.zip",
}
const validPublishedRelease: PublishedRelease = {
  status: "published",
  version: "1.0.0",
  tag: "v1.0.0",
  targets: skillglassRelease.targets,
  assets: [verifiedAsset],
  checksumsUrl: "https://github.com/r-bart/skillglass/releases/download/v1.0.0/SHA256SUMS.txt",
}

assert.deepEqual(publishedAssets(definePublishedRelease(validPublishedRelease)), [verifiedAsset])

function invalidPublishedRelease(value: unknown): PublishedRelease {
  return value as PublishedRelease
}

assert.throws(
  () => definePublishedRelease(invalidPublishedRelease({ ...validPublishedRelease, tag: "v0.9.0" })),
  /tag must be exactly/u,
)
assert.throws(
  () => definePublishedRelease(invalidPublishedRelease({
    ...validPublishedRelease,
    assets: [{ ...verifiedAsset, verification: "candidate" }],
  })),
  /must be verified/u,
)
assert.throws(
  () => definePublishedRelease(invalidPublishedRelease({
    ...validPublishedRelease,
    assets: [{ ...verifiedAsset, platform: "Windows" }],
  })),
  /must match its release target/u,
)
assert.throws(
  () => publishedAssets(invalidPublishedRelease({
    ...validPublishedRelease,
    assets: [{ ...verifiedAsset, url: `${verifiedAsset.url}?download=1` }],
  })),
  /asset URL must be exactly/u,
)
assert.throws(
  () => definePublishedRelease({ ...validPublishedRelease, assets: [verifiedAsset, verifiedAsset] }),
  /asset IDs must be unique/u,
)
assert.throws(
  () => definePublishedRelease(invalidPublishedRelease({
    ...validPublishedRelease,
    targets: [firstTarget, { ...skillglassRelease.targets[1], id: firstTarget.id }],
  })),
  /target IDs must be unique/u,
)
assert.throws(
  () => definePublishedRelease(invalidPublishedRelease({
    ...validPublishedRelease,
    assets: [
      verifiedAsset,
      {
        ...skillglassRelease.targets[1],
        fileName: verifiedAsset.fileName,
        verification: "verified",
        url: verifiedAsset.url,
      },
    ],
  })),
  /asset filenames must be unique/u,
)
assert.throws(
  () => definePublishedRelease(invalidPublishedRelease({
    ...validPublishedRelease,
    checksumsUrl: "https://github.com/r-bart/skillglass/releases/download/v1.0.0/checksums.txt",
  })),
  /Checksums URL must be exactly/u,
)
