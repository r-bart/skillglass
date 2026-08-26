import { cp, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assertAdapterAdmission, inspectAdapterAdmission, type AdapterOperationRequest } from "@forge/adapter-api"
import {
  canonicalPath,
  observed,
  type ProjectScope,
  type SkillInstallation,
  type SourceRoot,
} from "@forge/domain"
import { createApprovedRootPolicy, hashDirectorySource } from "@forge/scanner"
import { afterEach, describe, expect, it } from "vitest"

import {
  FOLDER_ADAPTER_CAPABILITIES,
  FolderAdapter,
  type FolderRootConfiguration,
} from "../src/index.js"

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/valid-root", import.meta.url))
const NOW = new Date("2026-08-26T12:00:00.000Z")
const TOKEN = "folder_selection_token_abcdefghijklmnopqrstuvwxyz_0123456789"
const temporaryDirectories: string[] = []

async function temporaryRoot(): Promise<string> {
  const temporary = await mkdtemp(path.join(tmpdir(), "forge-folder-adapter-"))
  temporaryDirectories.push(temporary)
  const rootPath = path.join(temporary, "skills")
  await cp(FIXTURE_ROOT, rootPath, { recursive: true })
  return realpath(rootPath)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function configuration(rootPath: string, overrides: Partial<FolderRootConfiguration> = {}): FolderRootConfiguration {
  return {
    candidateId: "candidate_folder",
    canonicalPath: canonicalPath(rootPath),
    scope: { kind: "global" },
    access: "read-write",
    writableWithoutElevation: true,
    defaultIncluded: false,
    ...overrides,
  }
}

function approvedRoot(rootPath: string, overrides: Partial<SourceRoot> = {}): SourceRoot {
  return {
    id: "root_folder",
    adapterId: "folder",
    canonicalPath: canonicalPath(rootPath),
    kind: "global",
    access: "read-write",
    discovery: observed({ source: "test-approval" }),
    ...overrides,
  }
}

const discoveryContext = {
  homeDirectory: canonicalPath("/home/example"),
  workingDirectory: canonicalPath("/workspace/example"),
  projects: [] as readonly ProjectScope[],
}

async function observations(adapter: FolderAdapter, root: SourceRoot) {
  const values = []
  for await (const value of adapter.scanRoot(root)) values.push(value)
  return values
}

async function operationFixture(rootPath: string) {
  const adapter = new FolderAdapter({ roots: [configuration(rootPath)], now: () => NOW })
  const root = approvedRoot(rootPath)
  const rootPolicy = await createApprovedRootPolicy([{
    rootId: root.id,
    path: rootPath,
    kind: root.kind,
    access: root.access,
    writableWithoutElevation: true,
  }])
  const scanned = await observations(adapter, root)
  const alpha = scanned.find(({ snapshot }) => snapshot.name.value === "alpha")
  if (alpha === undefined) throw new Error("alpha fixture was not scanned")
  const hashResult = await hashDirectorySource(path.join(rootPath, "alpha"))
  if (hashResult.manifest === undefined) throw new Error("alpha fixture did not hash")

  const install: AdapterOperationRequest = {
    request: {
      kind: "install-local",
      source: { kind: "directory", selectionToken: TOKEN, suggestedName: "alpha-copy", treeHash: hashResult.manifest.treeHash },
      targetRootId: root.id,
    },
    targetRoot: root,
    sourceManifest: hashResult.manifest,
    rootPolicy,
  }
  const update: AdapterOperationRequest = {
    request: {
      kind: "update-from-local",
      installationId: alpha.installation.id,
      expectedSnapshotId: alpha.snapshot.id,
    },
    targetRoot: root,
    installation: alpha.installation,
    sourceManifest: hashResult.manifest,
    rootPolicy,
  }
  const edit: AdapterOperationRequest = {
    request: {
      kind: "update-entry-content",
      installationId: alpha.installation.id,
      expectedSnapshotId: alpha.snapshot.id,
      content: "---\nname: alpha\ndescription: Edited\n---\n",
    },
    targetRoot: root,
    installation: alpha.installation,
    rootPolicy,
  }
  return { adapter, root, alpha, install, update, edit }
}

describe("generic Agent Skills folder discovery", () => {
  it("returns only roots explicitly supplied to the adapter", async () => {
    const empty = new FolderAdapter({ roots: [] })
    await expect(empty.discoverRoots(discoveryContext)).resolves.toEqual([])

    const rootPath = await temporaryRoot()
    const projectPath = canonicalPath(path.dirname(rootPath))
    const adapter = new FolderAdapter({
      roots: [
        configuration(rootPath),
        configuration(path.join(rootPath, "project-skills"), {
          candidateId: "candidate_project",
          canonicalPath: canonicalPath(path.join(rootPath, "project-skills")),
          scope: { kind: "project", projectId: "project_alpha", projectPath },
          access: "missing",
          writableWithoutElevation: false,
        }),
      ],
    })

    const roots = await adapter.discoverRoots(discoveryContext)
    expect(roots).toHaveLength(2)
    expect(roots).toContainEqual(expect.objectContaining({
      candidateId: "candidate_folder",
      kind: "global",
      defaultIncluded: false,
      evidence: expect.objectContaining({ kind: "observed", source: "explicit-folder-configuration" }),
    }))
    expect(roots).toContainEqual(expect.objectContaining({
      candidateId: "candidate_project",
      kind: "project",
      projectPath,
    }))
  })

  it("keeps valid and invalid installations, resources, raw source, identities and hashes", async () => {
    const rootPath = await temporaryRoot()
    const adapter = new FolderAdapter({ roots: [configuration(rootPath)], now: () => NOW })
    const root = approvedRoot(rootPath)

    const first = await observations(adapter, root)
    const second = await observations(adapter, root)
    expect(first).toHaveLength(2)

    const alpha = first.find(({ snapshot }) => snapshot.name.value === "alpha")
    const broken = first.find(({ installation }) => installation.canonicalPath.endsWith(`${path.sep}broken`))
    expect(alpha).toBeDefined()
    expect(alpha?.snapshot.rawSource).toContain("custom-field: preserved")
    expect(alpha?.snapshot.files.map(({ canonicalPath: file }) => path.basename(file))).toEqual(
      expect.arrayContaining(["SKILL.md", "guide.md"]),
    )
    expect(alpha?.snapshot.findings).toEqual([])
    expect(alpha?.installation.scope).toBe("global")
    expect(alpha?.provenance).toEqual(expect.objectContaining({ kind: "local", managedBy: "user" }))

    expect(broken?.snapshot.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FRONTMATTER_DESCRIPTION_REQUIRED", severity: "error" }),
      expect.objectContaining({ code: "RESOURCE_REFERENCE_BROKEN", severity: "warning" }),
    ]))
    expect(broken?.snapshot.name.value).toBe("broken")
    expect(broken?.snapshot.description.evidence.kind).toBe("unknown")

    expect(second.map(({ installation }) => installation.id).sort()).toEqual(
      first.map(({ installation }) => installation.id).sort(),
    )
    expect(second.map(({ snapshot }) => snapshot.contentHash).sort()).toEqual(
      first.map(({ snapshot }) => snapshot.contentHash).sort(),
    )
  })

  it("derives project scope but reports precedence and runtime state as unsupported", async () => {
    const rootPath = await temporaryRoot()
    const projectId = "project_alpha"
    const config = configuration(rootPath, {
      scope: { kind: "project", projectId, projectPath: canonicalPath(path.dirname(rootPath)) },
    })
    const root = approvedRoot(rootPath, { kind: "project", projectId })
    const adapter = new FolderAdapter({ roots: [config], now: () => NOW })
    const [alpha] = await observations(adapter, root)
    if (alpha === undefined) throw new Error("fixture was not scanned")

    expect(alpha.installation.scope).toEqual({ projectId })
    await expect(adapter.resolveScope({
      targetScope: { projectId },
      key: "alpha",
      candidates: [alpha.installation],
    })).resolves.toEqual([expect.objectContaining({ status: "unsupported" })])
    await expect(adapter.describeBinding({ installation: alpha.installation, targetScope: { projectId } })).resolves.toEqual(
      expect.objectContaining({ relationship: "owned", runtimeState: "unsupported", evidence: expect.objectContaining({ kind: "derived" }) }),
    )
  })
})

describe("folder adapter operations and admission", () => {
  it("passes the shared adapter admission kit with declarative, contained plans", async () => {
    const rootPath = await temporaryRoot()
    const fixture = await operationFixture(rootPath)
    const captureState = async () => (await readdir(rootPath)).sort()
    const admissionFixture = {
      discoveryContext,
      operationProbes: [
        { capability: "installToUserRoot" as const, request: fixture.install, captureState },
        { capability: "updateWritableInstallation" as const, request: fixture.update, captureState },
        { capability: "editLocal" as const, request: fixture.edit, captureState },
      ],
    }

    const report = await inspectAdapterAdmission(fixture.adapter, admissionFixture)
    expect(report).toEqual({ adapterId: "folder", passed: true, issues: [] })
    await expect(assertAdapterAdmission(fixture.adapter, admissionFixture)).resolves.toBeUndefined()
  })

  it("builds root-ID-relative install, update and edit plans without mutating files", async () => {
    const rootPath = await temporaryRoot()
    const fixture = await operationFixture(rootPath)
    const before = await readdir(rootPath)
    const results = await Promise.all([
      fixture.adapter.planOperation(fixture.install),
      fixture.adapter.planOperation(fixture.update),
      fixture.adapter.planOperation(fixture.edit),
    ])
    expect(await readdir(rootPath)).toEqual(before)

    for (const result of results) {
      expect(result.status).toBe("planned")
      if (result.status !== "planned") continue
      expect(result.plan.operation.targetRootId).toBe(fixture.root.id)
      expect(result.plan.steps).not.toHaveLength(0)
      expect(result.plan.steps.every((step) => step.rootId === fixture.root.id && !path.isAbsolute(step.relativePath))).toBe(true)
      expect(result.plan.postconditions.every((condition) => condition.rootId === fixture.root.id && !path.isAbsolute(condition.relativePath))).toBe(true)
    }
  })

  it("rejects unconfigured, read-only, stale and colliding write targets", async () => {
    const rootPath = await temporaryRoot()
    const fixture = await operationFixture(rootPath)

    const unconfigured = new FolderAdapter({ roots: [] })
    await expect(unconfigured.planOperation(fixture.install)).rejects.toMatchObject({ code: "ROOT_NOT_CONFIGURED" })

    const readOnlyAdapter = new FolderAdapter({
      roots: [configuration(rootPath, { access: "read-only", writableWithoutElevation: false })],
    })
    await expect(readOnlyAdapter.planOperation({
      ...fixture.install,
      targetRoot: approvedRoot(rootPath, { access: "read-only" }),
    })).rejects.toMatchObject({ code: "ROOT_NOT_WRITABLE" })

    if (fixture.edit.request.kind !== "update-entry-content") throw new Error("edit fixture has the wrong kind")
    await expect(fixture.adapter.planOperation({
      ...fixture.edit,
      request: { ...fixture.edit.request, expectedSnapshotId: "snapshot_stale" },
    })).rejects.toMatchObject({ code: "SNAPSHOT_STALE" })

    const installPlan = await fixture.adapter.planOperation(fixture.install)
    if (installPlan.status !== "planned") throw new Error("install fixture was not planned")
    await mkdir(path.join(rootPath, installPlan.plan.steps[0]?.relativePath ?? "missing"))
    await expect(fixture.adapter.planOperation(fixture.install)).rejects.toMatchObject({ code: "DESTINATION_COLLISION" })
  })

  it("rejects an installation whose path escapes its approved root", async () => {
    const rootPath = await temporaryRoot()
    const fixture = await operationFixture(rootPath)
    const escaped: SkillInstallation = {
      ...fixture.alpha.installation,
      canonicalPath: canonicalPath(path.join(path.dirname(rootPath), "outside")),
      entryFile: canonicalPath(path.join(path.dirname(rootPath), "outside", "SKILL.md")),
    }
    await expect(fixture.adapter.planOperation({ ...fixture.edit, installation: escaped })).rejects.toMatchObject({
      code: "INSTALLATION_OUTSIDE_ROOT",
    })
  })
})

describe("folder adapter capabilities", () => {
  it("does not claim host precedence, runtime state, permissions or telemetry", () => {
    expect(FOLDER_ADAPTER_CAPABILITIES).toEqual(expect.objectContaining({
      resolvePrecedence: "unsupported",
      observeRuntimeState: "unsupported",
      permissionDeclarations: "unsupported",
      triggerTelemetry: "unsupported",
      usageTelemetry: "unsupported",
    }))
  })
})
