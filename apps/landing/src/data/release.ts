export type ReleaseStatus = "pending" | "published"
const RELEASE_DOWNLOAD_BASE = "https://github.com/r-bart/skillglass/releases/download"

export interface ReleaseTarget {
  readonly id: "macos-arm64" | "windows-x64" | "linux-deb-x64" | "linux-rpm-x64" | "linux-pacman-x64"
  readonly platform: "macOS" | "Windows" | "Linux"
  readonly architecture: "Apple Silicon" | "x64"
  readonly package: "ZIP" | "EXE" | "DEB" | "RPM" | "Pacman"
  readonly fileName: string
  readonly signing: "ad-hoc" | "unsigned"
  readonly verification: "pending" | "candidate" | "verified"
}

interface ReleaseBase {
  readonly version: "1.0.0"
  readonly tag: "v1.0.0"
  readonly targets: readonly ReleaseTarget[]
}

export interface PendingRelease extends ReleaseBase {
  readonly status: "pending"
}

export interface PublishedReleaseAsset extends ReleaseTarget {
  readonly verification: "verified"
  readonly url: `https://github.com/r-bart/skillglass/releases/download/${string}`
}

export interface PublishedRelease extends ReleaseBase {
  readonly status: "published"
  readonly assets: readonly PublishedReleaseAsset[]
  readonly checksumsUrl: `https://github.com/r-bart/skillglass/releases/download/${string}/SHA256SUMS.txt`
}

export type SkillglassRelease = PendingRelease | PublishedRelease

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`)
}

/**
 * Validates the complete public-release boundary. This is intentionally called
 * again by publishedAssets so a hand-edited data object cannot expose an
 * unverified or incorrectly addressed download during the landing build.
 */
export function definePublishedRelease(release: PublishedRelease): PublishedRelease {
  if (release.tag !== `v${release.version}`) {
    throw new TypeError(`Release tag must be exactly v${release.version}`)
  }
  assertUnique(release.targets.map(({ id }) => id), "Release target IDs")
  assertUnique(release.targets.map(({ fileName }) => fileName), "Release target filenames")
  assertUnique(release.assets.map(({ id }) => id), "Published asset IDs")
  assertUnique(release.assets.map(({ fileName }) => fileName), "Published asset filenames")

  const targetsById = new Map(release.targets.map((target) => [target.id, target]))
  for (const asset of release.assets) {
    if (asset.verification !== "verified") {
      throw new TypeError(`Published asset ${asset.fileName} must be verified`)
    }
    const target = targetsById.get(asset.id)
    if (target === undefined ||
      target.fileName !== asset.fileName ||
      target.platform !== asset.platform ||
      target.architecture !== asset.architecture ||
      target.package !== asset.package ||
      target.signing !== asset.signing) {
      throw new TypeError(`Published asset ${asset.fileName} must match its release target`)
    }
    const expectedUrl = `${RELEASE_DOWNLOAD_BASE}/${release.tag}/${asset.fileName}`
    if (asset.url !== expectedUrl) {
      throw new TypeError(`Published asset URL must be exactly ${expectedUrl}`)
    }
  }

  const expectedChecksumsUrl = `${RELEASE_DOWNLOAD_BASE}/${release.tag}/SHA256SUMS.txt`
  if (release.checksumsUrl !== expectedChecksumsUrl) {
    throw new TypeError(`Checksums URL must be exactly ${expectedChecksumsUrl}`)
  }
  return release
}

/**
 * Keep this pending until the public GitHub release exists and every URL below
 * has been checked without an authenticated session. A pending release cannot
 * expose an active binary link because its type has no `assets` property.
 */
export const skillglassRelease: SkillglassRelease = {
  status: "pending",
  version: "1.0.0",
  tag: "v1.0.0",
  targets: [
    {
      id: "macos-arm64",
      platform: "macOS",
      architecture: "Apple Silicon",
      package: "ZIP",
      fileName: "skillglass-v1.0.0-macos-arm64.zip",
      signing: "ad-hoc",
      verification: "pending",
    },
    {
      id: "windows-x64",
      platform: "Windows",
      architecture: "x64",
      package: "EXE",
      fileName: "skillglass-v1.0.0-windows-x64.exe",
      signing: "unsigned",
      verification: "pending",
    },
    {
      id: "linux-deb-x64",
      platform: "Linux",
      architecture: "x64",
      package: "DEB",
      fileName: "skillglass-v1.0.0-linux-x64.deb",
      signing: "unsigned",
      verification: "pending",
    },
    {
      id: "linux-rpm-x64",
      platform: "Linux",
      architecture: "x64",
      package: "RPM",
      fileName: "skillglass-v1.0.0-linux-x64.rpm",
      signing: "unsigned",
      verification: "pending",
    },
    {
      id: "linux-pacman-x64",
      platform: "Linux",
      architecture: "x64",
      package: "Pacman",
      fileName: "skillglass-v1.0.0-linux-x64.pkg.tar.zst",
      signing: "unsigned",
      verification: "pending",
    },
  ],
}

export function publishedAssets(release: SkillglassRelease): readonly PublishedReleaseAsset[] {
  if (release.status !== "published") return []
  return definePublishedRelease(release).assets.filter(({ verification }) => verification === "verified")
}
