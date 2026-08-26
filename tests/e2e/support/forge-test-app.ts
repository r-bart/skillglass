import { createHash } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const e2eMainEntrypoint = path.join(repositoryRoot, "apps", "desktop", ".vite", "build", "main.cjs")

const encoder = new TextEncoder()

interface ForgeBusinessFixture {
  readonly root: string
  readonly home: string
  readonly userData: string
  readonly projectRoot: string
  readonly projectSkillRoot: string
  readonly globalRoot: string
  readonly globalSkillRoot: string
  readonly globalSkillEntry: string
  readonly invalidSkillEntry: string
  readonly managedSkillsRoot: string
  readonly managedSkillRoot: string
  readonly installDirectorySource: string
  readonly installDestination: string
  readonly traversalZipSource: string
  readonly originalHarnessConfig: string
  readonly scanAuditPath: string
  readonly elevationAuditPath: string
  readonly elevationShimDirectory: string
  readScanAudit(): Promise<string[]>
  readGlobalSkill(): Promise<string>
  installDestinationExists(): Promise<boolean>
  changeInstallSource(text: string): Promise<void>
  changeInstalledSkill(text: string): Promise<void>
  readInstalledSkill(): Promise<string>
  traversalEscapeExists(): Promise<boolean>
  readHarnessConfig(): Promise<string>
  readElevationAudit(): Promise<string[]>
  dispose(): Promise<void>
}

export interface LaunchForgeOptions {
  readonly onboarded?: boolean
}

export interface ForgeTestApplication {
  readonly page: Page
  close(): Promise<void>
  restart(): Promise<void>
  installFromDirectory(source: string): Promise<void>
  installFromZip(source: string): Promise<void>
}

function skillSource(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`
}

async function createSkill(directory: string, source: string): Promise<string> {
  await mkdir(directory, { recursive: true })
  const entry = path.join(directory, "SKILL.md")
  await writeFile(entry, source, "utf8")
  return entry
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Minimal single-entry STORE archive. The unsafe name is intentionally preserved verbatim. */
async function writeStoredZip(file: string, entryName: string, content: string): Promise<void> {
  const name = Buffer.from(entryName, "utf8")
  const payload = Buffer.from(content, "utf8")
  const checksum = crc32(payload)
  const flags = 0x0800

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE((3 << 8) | 20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38)

  const centralOffset = local.length + name.length + payload.length
  const centralSize = central.length + name.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)

  await writeFile(file, Buffer.concat([local, name, payload, central, name, end]))
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function eventuallyAbsent(candidate: string, timeoutMs = 2_000): Promise<boolean> {
  if (!(await exists(candidate))) return false
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    if (!(await exists(candidate))) return false
  }
  return true
}

async function readAuditLines(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf8")
  return raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

async function createElevationShims(directory: string, auditPath: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  if (process.platform === "win32") {
    const script = `@echo off\r\n>>"${auditPath}" echo %~nx0 %*\r\nexit /b 97\r\n`
    for (const name of ["sudo.cmd", "pkexec.cmd", "doas.cmd", "runas.cmd", "powershell.cmd", "pwsh.cmd"]) {
      await writeFile(path.join(directory, name), script, "utf8")
    }
    return
  }
  const escapedAudit = auditPath.replaceAll("'", "'\\''")
  const script = `#!/bin/sh\nprintf '%s\\n' "$0 $*" >> '${escapedAudit}'\nexit 97\n`
  for (const name of ["sudo", "pkexec", "doas", "osascript"]) {
    const executable = path.join(directory, name)
    await writeFile(executable, script, "utf8")
    await chmod(executable, 0o755)
  }
}

export async function createForgeBusinessFixture(): Promise<ForgeBusinessFixture> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forge-business-e2e-")))
  const home = path.join(root, "home")
  const userData = path.join(root, "user-data")
  const projectRoot = path.join(root, "Acme Web")
  const globalRoot = path.join(home, ".agents", "skills")
  const globalSkillRoot = path.join(globalRoot, "global-review")
  const projectSkillRoot = path.join(projectRoot, ".agents", "skills", "project-release")
  const invalidSkillRoot = path.join(globalRoot, "broken-frontmatter")
  const managedSkillsRoot = path.join(root, "managed", "skills")
  const managedSkillRoot = path.join(managedSkillsRoot, "managed-audit")
  const installDirectorySource = path.join(root, "sources", "local-installable")
  const installDestination = path.join(globalRoot, "local-installable")
  const traversalZipSource = path.join(root, "sources", "traversal.zip")
  const traversalEscape = path.join(globalRoot, "escaped-by-zip")
  const harnessConfig = path.join(home, ".codex", "config.toml")
  const scanAuditPath = path.join(root, "scan-audit.jsonl")
  const elevationAuditPath = path.join(root, "elevation-audit.log")
  const elevationShimDirectory = path.join(root, "elevation-shims")
  const originalHarnessConfig = "[features]\nskills = true\n"

  await Promise.all([
    mkdir(userData, { recursive: true }),
    mkdir(path.join(projectRoot, ".git"), { recursive: true }),
    mkdir(path.dirname(harnessConfig), { recursive: true }),
    mkdir(path.dirname(traversalZipSource), { recursive: true }),
  ])
  const globalSkillEntry = await createSkill(
    globalSkillRoot,
    skillSource("global-review", "Review global de cambios", "Comprueba riesgos antes de entregar."),
  )
  await createSkill(
    projectSkillRoot,
    skillSource("project-release", "Release del proyecto", "Prepara la release de Acme Web."),
  )
  const invalidSkillEntry = await createSkill(
    invalidSkillRoot,
    "---\nname: [broken\ndescription: Frontmatter inválido\n---\n\n# broken-frontmatter\n",
  )
  await createSkill(
    managedSkillRoot,
    skillSource("managed-audit", "Auditoría gestionada", "Contenido administrado y solo legible."),
  )
  await createSkill(
    installDirectorySource,
    skillSource("local-installable", "Instalable local", "Versión de origen 1"),
  )
  await Promise.all([
    writeFile(harnessConfig, originalHarnessConfig, "utf8"),
    writeFile(scanAuditPath, "", "utf8"),
    writeFile(elevationAuditPath, "", "utf8"),
    writeStoredZip(
      traversalZipSource,
      "../escaped-by-zip/SKILL.md",
      skillSource("escaped-by-zip", "No debe escapar", "Esta entrada nunca debe materializarse."),
    ),
    createElevationShims(elevationShimDirectory, elevationAuditPath),
  ])
  if (process.platform !== "win32") {
    await chmod(managedSkillRoot, 0o555)
    await chmod(path.join(managedSkillRoot, "SKILL.md"), 0o444)
    await chmod(managedSkillsRoot, 0o555)
  }

  return {
    root,
    home,
    userData,
    projectRoot,
    projectSkillRoot,
    globalRoot,
    globalSkillRoot,
    globalSkillEntry,
    invalidSkillEntry,
    managedSkillsRoot,
    managedSkillRoot,
    installDirectorySource,
    installDestination,
    traversalZipSource,
    originalHarnessConfig,
    scanAuditPath,
    elevationAuditPath,
    elevationShimDirectory,
    async readScanAudit() {
      const batches = await readAuditLines(scanAuditPath)
      return batches.flatMap((line) => JSON.parse(line) as string[])
    },
    readGlobalSkill: () => readFile(globalSkillEntry, "utf8"),
    // An undo is requested through asynchronous Electron IPC. Acceptance checks
    // ask whether the destination remains, so tolerate only that bounded handoff;
    // a destination that is genuinely left behind still returns true.
    installDestinationExists: () => eventuallyAbsent(installDestination),
    async changeInstallSource(text) {
      await writeFile(
        path.join(installDirectorySource, "SKILL.md"),
        skillSource("local-installable", "Instalable local", text),
        "utf8",
      )
    },
    async changeInstalledSkill(text) {
      await writeFile(
        path.join(installDestination, "SKILL.md"),
        skillSource("local-installable", "Instalable local", text),
        "utf8",
      )
    },
    readInstalledSkill: () => readFile(path.join(installDestination, "SKILL.md"), "utf8"),
    traversalEscapeExists: () => exists(traversalEscape),
    readHarnessConfig: () => readFile(harnessConfig, "utf8"),
    readElevationAudit: () => readAuditLines(elevationAuditPath),
    async dispose() {
      if (process.platform !== "win32") {
        await chmod(managedSkillsRoot, 0o755).catch(() => undefined)
        await chmod(managedSkillRoot, 0o755).catch(() => undefined)
        await chmod(path.join(managedSkillRoot, "SKILL.md"), 0o644).catch(() => undefined)
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function collectFiles(root: string, directory = root): Promise<ReadonlyArray<Readonly<{
  relativePath: string
  content: Buffer
}>>> {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => Buffer.compare(encoder.encode(left.name), encoder.encode(right.name)))
  const files: Array<Readonly<{ relativePath: string; content: Buffer }>> = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    const stats = await lstat(absolute)
    if (stats.isSymbolicLink()) throw new TypeError(`Tree hash refuses symbolic link: ${absolute}`)
    if (stats.isDirectory()) files.push(...await collectFiles(root, absolute))
    else if (stats.isFile()) {
      files.push({
        relativePath: path.relative(root, absolute).split(path.sep).join("/"),
        content: await readFile(absolute),
      })
    } else throw new TypeError(`Tree hash refuses special entry: ${absolute}`)
  }
  return files
}

/** Stable content hash used only for before/after assertions in the acceptance suite. */
export async function readTreeHash(root: string): Promise<string> {
  const hash = createHash("sha256")
  for (const file of await collectFiles(root)) {
    const contentHash = createHash("sha256").update(file.content).digest("hex")
    hash.update(file.relativePath)
    hash.update("\0")
    hash.update(String(file.content.length))
    hash.update("\0")
    hash.update(contentHash)
    hash.update("\n")
  }
  return hash.digest("hex")
}

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

async function configuredExecutable(): Promise<string | undefined> {
  const configured = process.env.FORGE_E2E_EXECUTABLE
  if (configured === undefined) return undefined
  if (!path.isAbsolute(configured)) throw new TypeError("FORGE_E2E_EXECUTABLE must be absolute")
  if (!await exists(configured)) throw new Error(`FORGE_E2E_EXECUTABLE does not exist: ${configured}`)
  return configured
}

async function injectNativeSelection(application: ElectronApplication, selectedPath: string): Promise<void> {
  await application.evaluate(({ dialog }, selection) => {
    dialog.showOpenDialog = () => Promise.resolve({
      canceled: false,
      filePaths: [selection],
      bookmarks: [],
    })
  }, selectedPath)
}

async function firstVisible(locators: readonly Locator[]): Promise<Locator | undefined> {
  for (const locator of locators) {
    if (await locator.count() > 0 && await locator.first().isVisible()) return locator.first()
  }
  return undefined
}

async function triggerLocalSourcePicker(page: Page, kind: "directory" | "zip"): Promise<void> {
  const directNames = kind === "directory"
    ? [/Instalar desde carpeta/i, /Elegir carpeta/i, /Carpeta local/i]
    : [/Instalar desde ZIP/i, /Elegir ZIP/i, /Archivo ZIP/i]
  const direct = await firstVisible(directNames.map((name) => page.getByRole("button", { name })))
  if (direct !== undefined) {
    await direct.click()
    return
  }

  const opener = await firstVisible([
    page.getByRole("button", { name: "Instalar skill", exact: true }),
    page.getByRole("button", { name: "Instalar", exact: true }),
    page.getByRole("button", { name: /Añadir skill/i }),
  ])
  if (opener === undefined) {
    throw new Error("Forge must expose an accessible local-install action in the inventory toolbar")
  }
  await opener.click()
  const choice = await firstVisible(directNames.map((name) => page.getByRole("button", { name })))
  if (choice === undefined) {
    throw new Error(`Forge must expose an accessible ${kind === "directory" ? "directory" : "ZIP"} source choice`)
  }
  await choice.click()
}

class RunningForge implements ForgeTestApplication {
  readonly #fixture: ForgeBusinessFixture
  #application: ElectronApplication
  #page: Page
  #closed = false

  constructor(fixture: ForgeBusinessFixture, application: ElectronApplication, page: Page) {
    this.#fixture = fixture
    this.#application = application
    this.#page = page
  }

  get page(): Page {
    return this.#page
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#application.close()
    await this.#fixture.dispose()
  }

  async restart(): Promise<void> {
    if (this.#closed) throw new Error("Cannot restart a closed Forge test application")
    await this.#application.close()
    const launched = await launchElectron(this.#fixture)
    this.#application = launched.application
    this.#page = launched.page
    await this.#page.getByRole("heading", { name: "Inventario" }).waitFor()
  }

  async installFromDirectory(source: string): Promise<void> {
    await injectNativeSelection(this.#application, source)
    await triggerLocalSourcePicker(this.#page, "directory")
  }

  async installFromZip(source: string): Promise<void> {
    await injectNativeSelection(this.#application, source)
    await triggerLocalSourcePicker(this.#page, "zip")
  }
}

async function launchElectron(fixture: ForgeBusinessFixture): Promise<Readonly<{
  application: ElectronApplication
  page: Page
}>> {
  const executablePath = await configuredExecutable()
  const inherited = stringEnvironment()
  const pathKey = process.platform === "win32"
    ? Object.keys(inherited).find((key) => key.toLocaleLowerCase("en-US") === "path") ?? "Path"
    : "PATH"
  const inheritedPath = inherited[pathKey] ?? ""
  const environment = {
    ...inherited,
    HOME: fixture.home,
    USERPROFILE: fixture.home,
    FORGE_E2E: "1",
    FORGE_E2E_HOME: fixture.home,
    FORGE_E2E_USER_DATA: fixture.userData,
    FORGE_E2E_ADMIN_SKILLS_ROOT: fixture.managedSkillsRoot,
    FORGE_E2E_SCAN_AUDIT: fixture.scanAuditPath,
    FORGE_E2E_ELEVATION_AUDIT: fixture.elevationAuditPath,
    [pathKey]: `${fixture.elevationShimDirectory}${path.delimiter}${inheritedPath}`,
  }
  const application = await electron.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    cwd: fixture.projectRoot,
    env: environment,
    args: [
      ...(executablePath === undefined ? [e2eMainEntrypoint] : []),
      `--user-data-dir=${fixture.userData}`,
    ],
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(10_000)
  return { application, page }
}

export async function launchForge(
  fixture: ForgeBusinessFixture,
  options: LaunchForgeOptions = {},
): Promise<ForgeTestApplication> {
  const projectSkills = path.join(fixture.projectRoot, ".agents", "skills")
  const hiddenProjectSkills = `${projectSkills}.e2e-hidden`
  const hiddenManagedSkills = `${fixture.managedSkillsRoot}.e2e-hidden`
  if (options.onboarded !== true) {
    await rename(projectSkills, hiddenProjectSkills)
    await rename(fixture.managedSkillsRoot, hiddenManagedSkills)
  }
  let launched: Awaited<ReturnType<typeof launchElectron>>
  try {
    launched = await launchElectron(fixture)
    await launched.page.getByRole("heading", { name: "Carpetas de skills" }).waitFor()
  } finally {
    if (options.onboarded !== true) {
      await rename(hiddenProjectSkills, projectSkills)
      await rename(hiddenManagedSkills, fixture.managedSkillsRoot)
    }
  }
  const app = new RunningForge(fixture, launched.application, launched.page)

  if (options.onboarded === true) {
    const submit = launched.page.getByRole("button", { name: "Escanear carpetas aprobadas" })
    await submit.click()
    await launched.page.getByRole("heading", { name: "Inventario" }).waitFor()
  } else {
    const checkboxes = launched.page.getByRole("checkbox")
    for (let index = 0; index < await checkboxes.count(); index += 1) {
      const checkbox = checkboxes.nth(index)
      if (await checkbox.isChecked()) await checkbox.uncheck()
    }
  }
  return app
}
