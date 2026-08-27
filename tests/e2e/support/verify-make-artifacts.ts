import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const makeRoot = path.join(repositoryRoot, "apps", "desktop", "out", "make")

async function regularFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await regularFiles(candidate))
    else if (entry.isFile() && (await stat(candidate)).size > 0) files.push(candidate)
  }
  return files
}

const platformExtensions: Readonly<Record<NodeJS.Platform, readonly string[] | undefined>> = {
  aix: undefined,
  android: undefined,
  darwin: [".zip"],
  freebsd: undefined,
  haiku: undefined,
  linux: [".deb", ".rpm"],
  openbsd: undefined,
  sunos: undefined,
  win32: [".exe", ".nupkg"],
  cygwin: undefined,
  netbsd: undefined,
}

const expected = platformExtensions[process.platform]
if (expected === undefined) throw new Error(`Unsupported release platform: ${process.platform}`)
const artifacts = await regularFiles(makeRoot)
const distributables = artifacts.filter((artifact) =>
  expected.some((extension) => artifact.toLocaleLowerCase("en-US").endsWith(extension)))
const matched = distributables.filter((artifact) => {
  const basename = path.basename(artifact).toLocaleLowerCase("en-US")
  return basename.startsWith("forge") || basename.startsWith("skill forge") || basename.startsWith("skill-forge")
})
const foreign = distributables.filter((artifact) => !matched.includes(artifact))
if (foreign.length > 0) {
  throw new Error(`Forge make emitted stale or misnamed distributables: ${foreign.join(", ")}`)
}
if (matched.length === 0) {
  throw new Error(`Forge make produced no ${expected.join("/")} artifacts below ${makeRoot}`)
}
if (process.platform === "darwin" && matched.length !== 1) {
  throw new Error(`Forge macOS make must emit one ZIP, received: ${matched.join(", ")}`)
}
process.stdout.write(`${matched.map((artifact) => path.relative(repositoryRoot, artifact)).join("\n")}\n`)
