import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { assertAdapterAdmission, inspectAdapterAdmission, type AdapterOperationRequest } from "@forge/adapter-api"
import { canonicalPath, type SourceRoot } from "@forge/domain"
import { createApprovedRootPolicy } from "@forge/scanner"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CodexAdapter } from "../src/index.js"

const HASH = "a".repeat(64)
const OTHER_HASH = "b".repeat(64)
const TOKEN = "selection_token_abcdefghijklmnopqrstuvwxyz_0123456789"
const FIXED_NOW = new Date("2026-08-26T12:00:00.000Z")
const SOURCE_FIXTURE = path.resolve(process.cwd(), "packages/test-fixtures/codex")

interface GoldenManifest {
  readonly roots: readonly Readonly<{ path: string; scope: "REPO" | "USER" | "ADMIN"; mutableByForge: boolean }>[]
  readonly expectedInstallations: readonly Readonly<{ path: string; name: string; scope: "REPO" | "USER" | "ADMIN"; runtimeState: "unknown" | "disabled" }>[]
}

let temporaryDirectory: string
let fixtureRoot: string
let home: string
let repositoryRoot: string
let workingDirectory: string
let adminRoot: string
let configFile: string
let manifest: GoldenManifest

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "forge-codex-adapter-"))
  fixtureRoot = path.join(temporaryDirectory, "codex")
  await cp(SOURCE_FIXTURE, fixtureRoot, { recursive: true })
  fixtureRoot = await realpath(fixtureRoot)
  home = path.join(fixtureRoot, "home")
  repositoryRoot = path.join(fixtureRoot, "workspace")
  workingDirectory = path.join(repositoryRoot, "services", "api", "src")
  adminRoot = path.join(fixtureRoot, "admin", "etc", "codex", "skills")
  configFile = path.join(home, ".codex", "config.toml")
  await writeFile(configFile, (await readFile(configFile, "utf8")).replaceAll("__FIXTURE_ROOT__", fixtureRoot))
  manifest = JSON.parse(await readFile(path.join(fixtureRoot, "fixture-manifest.json"), "utf8")) as GoldenManifest
})

afterEach(async () => {
  if (temporaryDirectory.includes(`${path.sep}forge-codex-adapter-`)) {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

function adapter(): CodexAdapter {
  return new CodexAdapter({ adminSkillsRoot: adminRoot, configFile, now: () => FIXED_NOW })
}

function context() {
  return {
    homeDirectory: canonicalPath(home),
    workingDirectory: canonicalPath(workingDirectory),
    repositoryRoot: canonicalPath(repositoryRoot),
    projects: [{
      id: "project_fixture",
      displayName: "Fixture repository",
      canonicalPath: canonicalPath(repositoryRoot),
      adapterIds: ["codex"],
    }],
  }
}

function sourceRoot(candidate: Awaited<ReturnType<CodexAdapter["discoverRoots"]>>[number]): SourceRoot {
  return {
    id: candidate.candidateId,
    adapterId: candidate.adapterId,
    canonicalPath: candidate.canonicalPath,
    kind: candidate.kind,
    ...(candidate.kind === "project" ? { projectId: "project_fixture" } : {}),
    access: candidate.access,
    discovery: candidate.evidence,
  }
}

async function rootsAndObservations(instance = adapter()) {
  const candidates = await instance.discoverRoots(context())
  const observations = []
  for (const candidate of candidates) {
    for await (const observation of instance.scanRoot(sourceRoot(candidate))) observations.push(observation)
  }
  return { candidates, observations }
}

describe("Codex verified root discovery", () => {
  it("walks CWD through repository root, then USER and present-only read-only ADMIN", async () => {
    const { candidates } = await rootsAndObservations()
    expect(candidates.map((candidate) => ({
      path: path.relative(fixtureRoot, candidate.canonicalPath).split(path.sep).join("/"),
      scope: candidate.kind === "project" ? "REPO" : candidate.kind === "global" ? "USER" : "ADMIN",
      mutableByForge: candidate.writableWithoutElevation,
    }))).toEqual(manifest.roots.map(({ path: rootPath, scope, mutableByForge }) => ({ path: rootPath, scope, mutableByForge })))
    expect(candidates.at(-1)).toMatchObject({ kind: "system", access: "read-only", writableWithoutElevation: false })
  })

  it("does not discover an absent ADMIN root or undocumented ~/.codex/skills", async () => {
    const instance = new CodexAdapter({ adminSkillsRoot: path.join(fixtureRoot, "absent-admin") })
    const candidates = await instance.discoverRoots(context())
    expect(candidates.some(({ canonicalPath: candidate }) => candidate.includes(`${path.sep}.codex${path.sep}skills`))).toBe(false)
    expect(candidates.some(({ kind }) => kind === "system")).toBe(false)
  })

  it("never walks above the injected repository root", async () => {
    const outsideRoot = path.join(fixtureRoot, ".agents", "skills")
    const candidates = await adapter().discoverRoots(context())
    expect(candidates.some(({ canonicalPath: candidate }) => candidate === outsideRoot)).toBe(false)
    expect(candidates.filter(({ kind }) => kind === "project")).toHaveLength(4)
  })

  it("discovers an explicitly registered project from an unrelated working directory", async () => {
    const candidates = await adapter().discoverRoots({
      homeDirectory: canonicalPath(home),
      workingDirectory: canonicalPath(temporaryDirectory),
      projects: [{
        id: "project_fixture",
        displayName: "Fixture repository",
        canonicalPath: canonicalPath(repositoryRoot),
        adapterIds: ["codex"],
      }],
    })
    expect(candidates).toContainEqual(expect.objectContaining({
      kind: "project",
      canonicalPath: canonicalPath(path.join(repositoryRoot, ".agents", "skills")),
      projectPath: canonicalPath(repositoryRoot),
    }))
  })
})

describe("Codex inventory semantics", () => {
  it("matches all ten golden installation observations", async () => {
    const { observations } = await rootsAndObservations()
    const actual = observations.map((observation) => ({
      path: path.relative(fixtureRoot, observation.installation.canonicalPath).split(path.sep).join("/"),
      name: observation.snapshot.name.evidence.kind === "unknown" ? undefined : observation.snapshot.name.value,
      scope: observation.installation.scope === "global" ? "USER" : observation.installation.scope === "system" ? "ADMIN" : "REPO",
    })).sort((left, right) => left.path.localeCompare(right.path))
    const expected = manifest.expectedInstallations.map(({ path: expectedPath, name, scope }) => ({ path: expectedPath, name, scope })).sort((left, right) => left.path.localeCompare(right.path))
    expect(actual).toEqual(expected)
    expect(observations.every(({ provenance }) => provenance.kind === "unknown")).toBe(true)
  })

  it("keeps duplicate names as coexisting candidates with no winner", async () => {
    const instance = adapter()
    const { observations } = await rootsAndObservations(instance)
    const duplicates = observations.filter(({ snapshot }) => snapshot.name.evidence.kind !== "unknown" && snapshot.name.value === "duplicate-skill")
    const [resolution] = await instance.resolveScope({ targetScope: { projectId: "project_fixture" }, key: "duplicate-skill", candidates: duplicates.map(({ installation }) => installation) })
    expect(duplicates).toHaveLength(3)
    expect(resolution).toMatchObject({ status: "conflict", candidateInstallationIds: expect.arrayContaining(duplicates.map(({ installation }) => installation.id)) })
    expect(resolution).not.toHaveProperty("winnerInstallationId")
  })

  it("observes only the exact configured-disabled entry and leaves all others unknown", async () => {
    const instance = adapter()
    const { observations } = await rootsAndObservations(instance)
    for (const observation of observations) {
      const binding = await instance.describeBinding({ installation: observation.installation, targetScope: "global" })
      const name = observation.snapshot.name.evidence.kind === "unknown" ? "" : observation.snapshot.name.value
      expect(binding.runtimeState).toBe(name === "disabled-skill" ? "disabled" : "unknown")
    }
  })

  it("keeps byte-identical installations independently addressable and editable", async () => {
    const instance = adapter()
    const candidates = await instance.discoverRoots(context())
    const userCandidate = candidates.find(({ kind }) => kind === "global")
    if (userCandidate === undefined) throw new Error("Fixture USER root is missing")
    const userRoot = sourceRoot(userCandidate)
    const original = path.join(userRoot.canonicalPath, "personal-skill")
    await cp(original, path.join(userRoot.canonicalPath, "personal-skill-copy"), { recursive: true })
    const copies = []
    for await (const observation of instance.scanRoot(userRoot)) {
      if (observation.snapshot.name.evidence.kind !== "unknown" && observation.snapshot.name.value === "personal-skill") {
        copies.push(observation)
      }
    }
    expect(copies).toHaveLength(2)
    expect(new Set(copies.map(({ snapshot }) => snapshot.contentHash))).toHaveProperty("size", 1)
    expect(new Set(copies.map(({ snapshot }) => snapshot.id))).toHaveProperty("size", 2)
    expect(copies.every(({ snapshot, installation }) => snapshot.installationId === installation.id)).toBe(true)

    const rootPolicy = await createApprovedRootPolicy([{
      rootId: userRoot.id,
      path: userRoot.canonicalPath,
      kind: userRoot.kind,
      access: userRoot.access,
      writableWithoutElevation: true,
    }])
    for (const copy of copies) {
      const result = await instance.planOperation({
        request: {
          kind: "update-entry-content",
          installationId: copy.installation.id,
          expectedSnapshotId: copy.snapshot.id,
          content: `${copy.snapshot.rawSource}\n# independently editable\n`,
        },
        targetRoot: userRoot,
        installation: copy.installation,
        rootPolicy,
      })
      expect(result).toMatchObject({
        status: "planned",
        plan: {
          steps: [expect.objectContaining({ expectedBeforeHash: copy.snapshot.contentHash })],
        },
      })
    }
  })

  it("does not advertise dependency support until agents/openai.yaml is parsed", async () => {
    const instance = adapter()
    expect((await instance.capabilities()).dependencies).toBe("unknown")
    expect(await instance.capabilityEvidence()).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "dependencies", state: "unknown" }),
    ]))
  })
})

describe("Codex safe operation planning and admission", () => {
  it("passes the shared admission kit without mutating fixture state", async () => {
    const instance = adapter()
    const { candidates, observations } = await rootsAndObservations(instance)
    const userCandidate = candidates.find(({ kind }) => kind === "global")
    const personal = observations.find(({ snapshot }) => snapshot.name.evidence.kind !== "unknown" && snapshot.name.value === "personal-skill")
    if (userCandidate === undefined || personal === undefined) throw new Error("Fixture invariant failed")
    const userRoot = sourceRoot(userCandidate)
    const rootPolicy = await createApprovedRootPolicy([{
      rootId: userRoot.id,
      path: userRoot.canonicalPath,
      kind: userRoot.kind,
      access: userRoot.access,
      writableWithoutElevation: true,
    }])
    const install: AdapterOperationRequest = {
      request: { kind: "install-local", source: { kind: "directory", selectionToken: TOKEN, suggestedName: "local-skill", treeHash: HASH }, targetRootId: userRoot.id },
      targetRoot: userRoot, rootPolicy,
    }
    const update: AdapterOperationRequest = {
      request: { kind: "update-from-local", installationId: personal.installation.id, expectedSnapshotId: personal.snapshot.id },
      targetRoot: userRoot, installation: personal.installation,
      sourceManifest: { contract: "local-source-v1", hashAlgorithm: "forge-tree-v1", treeHash: OTHER_HASH, files: [] },
      rootPolicy,
    }
    const edit: AdapterOperationRequest = {
      request: { kind: "update-entry-content", installationId: personal.installation.id, expectedSnapshotId: personal.snapshot.id, content: "---\nname: personal-skill\ndescription: Changed\n---\n" },
      targetRoot: userRoot, installation: personal.installation, rootPolicy,
    }
    const captureState = async () => ({ config: await readFile(configFile, "utf8"), skill: await readFile(personal.installation.entryFile, "utf8") })
    const fixture = {
      discoveryContext: context(),
      operationProbes: [
        { capability: "installToUserRoot" as const, request: install, captureState },
        { capability: "updateWritableInstallation" as const, request: update, captureState },
        { capability: "editLocal" as const, request: edit, captureState },
      ],
    }
    expect(await inspectAdapterAdmission(instance, fixture)).toEqual({ adapterId: "codex", passed: true, issues: [] })
    await expect(assertAdapterAdmission(instance, fixture)).resolves.toBeUndefined()
  })

  it("rejects ADMIN, unapproved roots, stale observations, and paths outside the target root", async () => {
    const instance = adapter()
    const { candidates, observations } = await rootsAndObservations(instance)
    const adminCandidate = candidates.find(({ kind }) => kind === "system")
    const userCandidate = candidates.find(({ kind }) => kind === "global")
    const personal = observations.find(({ snapshot }) => snapshot.name.evidence.kind !== "unknown" && snapshot.name.value === "personal-skill")
    if (adminCandidate === undefined || userCandidate === undefined || personal === undefined) throw new Error("Fixture invariant failed")
    const admin = sourceRoot(adminCandidate)
    const user = sourceRoot(userCandidate)
    const adminPolicy = await createApprovedRootPolicy([{ rootId: admin.id, path: admin.canonicalPath, kind: admin.kind, access: admin.access, writableWithoutElevation: false }])
    const adminResult = await instance.planOperation({ request: { kind: "install-local", source: { kind: "directory", selectionToken: TOKEN, suggestedName: "local-skill", treeHash: HASH }, targetRootId: admin.id }, targetRoot: admin, rootPolicy: adminPolicy })
    expect(adminResult).toMatchObject({ status: "unavailable", capabilityState: "unsupported" })

    const userPolicy = await createApprovedRootPolicy([{ rootId: user.id, path: user.canonicalPath, kind: user.kind, access: user.access, writableWithoutElevation: true }])
    const stale = await instance.planOperation({
      request: { kind: "update-from-local", installationId: personal.installation.id, expectedSnapshotId: "snapshot_stale" },
      targetRoot: user, installation: personal.installation,
      sourceManifest: { contract: "local-source-v1", hashAlgorithm: "forge-tree-v1", treeHash: HASH, files: [] },
      rootPolicy: userPolicy,
    })
    expect(stale.status).toBe("unavailable")
    const outside: SourceRoot = { ...user, id: "unapproved_root", canonicalPath: canonicalPath(repositoryRoot) }
    const outsideResult = await instance.planOperation({ request: { kind: "install-local", source: { kind: "directory", selectionToken: TOKEN, suggestedName: "local-skill", treeHash: HASH }, targetRootId: outside.id }, targetRoot: outside, rootPolicy: userPolicy })
    expect(outsideResult.status).toBe("unavailable")
  })

  it("has no activation or configuration-write operation", () => {
    const instance = adapter()
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(instance))).not.toEqual(expect.arrayContaining(["activate", "deactivate", "writeConfig"]))
  })
})
