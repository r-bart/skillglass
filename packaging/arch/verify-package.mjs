import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, readdir, readlink } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const repositoryRoot = path.resolve(import.meta.dirname, "../..")
const nodeArch = "x64"
const packageArch = "x86_64"

async function fileDigest(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function archivedEntryDigest(archivePath, entryPath) {
  return await new Promise((resolve, reject) => {
    const child = spawn("bsdtar", ["-xOf", archivePath, entryPath], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const hash = createHash("sha256")
    let stderr = ""
    child.stdout.on("data", (chunk) => hash.update(chunk))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Could not extract ${entryPath} from the Arch package: ${stderr.trim()}`))
        return
      }
      resolve(hash.digest("hex"))
    })
  })
}

async function sourceBundleManifest(directory, relativeDirectory = "") {
  const paths = new Set()
  const symlinks = new Map()
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    const installedPath = `opt/skillglass/${relativePath}`
    const sourcePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      paths.add(`${installedPath}/`)
      const nested = await sourceBundleManifest(sourcePath, relativePath)
      for (const nestedPath of nested.paths) paths.add(nestedPath)
      for (const [nestedPath, target] of nested.symlinks) symlinks.set(nestedPath, target)
    } else if (entry.isFile()) {
      paths.add(installedPath)
    } else if (entry.isSymbolicLink()) {
      paths.add(installedPath)
      symlinks.set(installedPath, await readlink(sourcePath))
    } else {
      throw new Error(`Electron bundle contains an unsupported filesystem entry: ${sourcePath}`)
    }
  }
  return { paths, symlinks }
}

const makeRoot = path.join(repositoryRoot, "apps", "desktop", "out", "make", "arch", nodeArch)
const packages = (await readdir(makeRoot)).filter((candidate) => candidate.endsWith(".pkg.tar.zst"))
if (packages.length !== 1) throw new Error(`Expected one Arch package below ${makeRoot}, found ${packages.length}`)

const packagePath = path.join(makeRoot, packages[0])
const packageInfo = execFileSync("pacman", ["-Qip", packagePath], { encoding: "utf8" })
const packageFiles = execFileSync("pacman", ["-Qlp", packagePath], { encoding: "utf8" })
const archiveListing = execFileSync("bsdtar", ["-tvf", packagePath], { encoding: "utf8" })
const desktopEntry = await readFile(path.join(repositoryRoot, "packaging", "arch", "skillglass.desktop"), "utf8")
const desktopPackage = JSON.parse(
  await readFile(path.join(repositoryRoot, "apps", "desktop", "package.json"), "utf8"),
)
const packageVersion = desktopPackage.version.replaceAll("-", "_")
const escapedPackageVersion = packageVersion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const expectedInfo = [
  /^Name\s*:\s*skillglass$/mu,
  new RegExp(`^Version\\s*:\\s*${escapedPackageVersion}-1$`, "mu"),
  new RegExp(`^Architecture\\s*:\\s*${packageArch}$`, "mu"),
  /^Licenses\s*:\s*Apache-2\.0$/mu,
]
for (const expectation of expectedInfo) {
  if (!expectation.test(packageInfo)) throw new Error(`Arch package metadata did not match ${expectation}`)
}

const installedPaths = new Set(packageFiles.split(/\r?\n/u).filter(Boolean).map((line) => {
  const match = /^skillglass\s+\/(.+)$/u.exec(line)
  if (match === null) throw new Error(`Could not parse packaged path: ${line}`)
  return match[1]
}))
const sourceBundleRoot = path.join(repositoryRoot, "apps", "desktop", "out", `Skillglass-linux-${nodeArch}`)
const sourceManifest = await sourceBundleManifest(sourceBundleRoot)
const integrationPaths = new Set([
  "opt/",
  "opt/skillglass/",
  "usr/",
  "usr/bin/",
  "usr/share/",
  "usr/share/applications/",
  "usr/share/icons/",
  "usr/share/icons/hicolor/",
  "usr/share/icons/hicolor/1024x1024/",
  "usr/share/icons/hicolor/1024x1024/apps/",
  "usr/share/licenses/",
  "usr/share/licenses/skillglass/",
  "usr/bin/skillglass",
  "usr/share/applications/skillglass.desktop",
  "usr/share/icons/hicolor/1024x1024/apps/skillglass.png",
  "usr/share/licenses/skillglass/LICENSE",
])
const expectedInstalledPaths = new Set([...integrationPaths, ...sourceManifest.paths])
const missingPaths = [...expectedInstalledPaths].filter((candidate) => !installedPaths.has(candidate))
const unexpectedPaths = [...installedPaths].filter((candidate) => !expectedInstalledPaths.has(candidate))
if (missingPaths.length > 0) {
  throw new Error(`Arch package is missing paths from the tested Electron bundle: ${missingPaths.join(", ")}`)
}
if (unexpectedPaths.length > 0) {
  throw new Error(`Arch package contains unexpected paths: ${unexpectedPaths.join(", ")}`)
}
const setuidEntries = archiveListing.split(/\r?\n/u).filter((line) => /^[bcdlps-][r-][w-][sS]/u.test(line))
if (
  setuidEntries.length !== 1
  || !/^-rwsr-xr-x\s+\d+\s+root\s+root\s+.*opt\/skillglass\/chrome-sandbox$/u.test(setuidEntries[0])
) {
  throw new Error(`Arch package must contain only the expected setuid Chromium sandbox helper: ${setuidEntries.join(", ")}`)
}
const archivedSymlinks = new Map()
for (const line of archiveListing.split(/\r?\n/u)) {
  const match = /\s((?:opt\/skillglass|usr\/bin)\/.*?) -> (.*)$/u.exec(line)
  if (match !== null) archivedSymlinks.set(match[1], match[2])
}
const expectedSymlinks = new Map(sourceManifest.symlinks)
expectedSymlinks.set("usr/bin/skillglass", "/opt/skillglass/skillglass")
if (archivedSymlinks.size !== expectedSymlinks.size) {
  throw new Error("Arch package symlink set does not match the tested Electron bundle")
}
for (const [symlinkPath, target] of expectedSymlinks) {
  if (archivedSymlinks.get(symlinkPath) !== target) {
    throw new Error(`Arch package symlink differs from the tested Electron bundle: ${symlinkPath}`)
  }
}
if (!desktopEntry.includes("Exec=/usr/bin/skillglass") || !desktopEntry.includes("Icon=skillglass")) {
  throw new Error("Arch desktop entry does not point at the packaged launcher and icon")
}
const sourceAsarPath = path.join(sourceBundleRoot, "resources", "app.asar")
if (
  await archivedEntryDigest(packagePath, "opt/skillglass/resources/app.asar")
  !== await fileDigest(sourceAsarPath)
) {
  throw new Error("Arch package app.asar does not match the tested Electron bundle")
}

process.stdout.write(`${path.relative(repositoryRoot, packagePath)}\n`)
