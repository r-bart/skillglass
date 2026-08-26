import {
  canonicalPath,
  evidenced,
  observed,
  unknown,
  type ProjectScope,
  type SkillInstallation,
  type SkillSnapshot,
  type SourceRoot,
} from "@forge/domain"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { openForgeStore } from "./sqlite-store.js"
import type { ForgeStore, StoredProvenance } from "./types.js"

const OBSERVED_AT = "2026-08-26T10:00:00.000Z"
const HASH = "a".repeat(64)

const projects: readonly ProjectScope[] = [
  {
    id: "project_acme",
    displayName: "Acme Web",
    canonicalPath: canonicalPath("/workspace/acme"),
    adapterIds: ["codex"],
  },
  {
    id: "project_beta",
    displayName: "Beta API",
    canonicalPath: canonicalPath("/workspace/beta"),
    adapterIds: ["folder"],
  },
]

const roots: readonly SourceRoot[] = [
  {
    id: "root_global",
    adapterId: "codex",
    canonicalPath: canonicalPath("/home/person/.agents/skills"),
    kind: "global",
    access: "read-write",
    discovery: observed({ source: "fixture" }),
  },
  {
    id: "root_acme",
    adapterId: "codex",
    canonicalPath: canonicalPath("/workspace/acme/.agents/skills"),
    kind: "project",
    projectId: "project_acme",
    access: "read-write",
    discovery: observed({ source: "fixture" }),
  },
  {
    id: "root_beta",
    adapterId: "folder",
    canonicalPath: canonicalPath("/workspace/beta/skills"),
    kind: "project",
    projectId: "project_beta",
    access: "read-only",
    discovery: observed({ source: "fixture" }),
  },
]

interface SkillFixture {
  readonly installation: SkillInstallation
  readonly snapshot: SkillSnapshot
  readonly provenance: StoredProvenance
}

function skillFixture(input: Readonly<{
  id: string
  name?: string
  pathName: string
  description?: string
  author?: string
  packageId?: string
  adapterId: string
  rootId: string
  scope: SkillInstallation["scope"]
  access?: SkillInstallation["access"]
  finding?: SkillSnapshot["findings"][number]
}>): SkillFixture {
  const installationId = `installation_${input.id}`
  const snapshotId = `snapshot_${input.id}`
  const provenanceId = `provenance_${input.id}`
  const root = roots.find(({ id }) => id === input.rootId)
  if (root === undefined) throw new Error(`Missing fixture root: ${input.rootId}`)
  const directory = canonicalPath(`${root.canonicalPath}/${input.pathName}`)
  const entry = canonicalPath(`${directory}/SKILL.md`)
  const frontmatter = [
    "---",
    ...(input.name === undefined ? [] : [`name: ${input.name}`]),
    ...(input.description === undefined
      ? []
      : [`description: ${input.description}`]),
    ...(input.author === undefined ? [] : [`author: ${input.author}`]),
    "---",
    "Fixture",
    "",
  ].join("\n")
  const snapshot: SkillSnapshot = {
    id: snapshotId,
    installationId,
    contentHash: HASH,
    observedAt: OBSERVED_AT,
    name: input.name === undefined
      ? unknown({ source: "frontmatter.name" })
      : evidenced(input.name, observed({ source: "frontmatter.name" })),
    description: input.description === undefined
      ? unknown({ source: "frontmatter.description" })
      : evidenced(
          input.description,
          observed({ source: "frontmatter.description" }),
        ),
    declaredVersion: unknown({ source: "frontmatter.version" }),
    files: [{ canonicalPath: entry, contentHash: HASH, size: 42 }],
    requirements: [],
    findings: input.finding === undefined ? [] : [input.finding],
    rawSource: frontmatter,
  }
  const provenance: StoredProvenance = {
    id: provenanceId,
    installationId,
    observedAt: OBSERVED_AT,
    value: {
      kind: input.packageId === undefined ? "local" : "package",
      ...(input.packageId === undefined ? {} : { packageId: input.packageId }),
      managedBy: input.packageId === undefined ? "user" : "forge",
    },
  }
  return {
    snapshot,
    provenance,
    installation: {
      id: installationId,
      adapterId: input.adapterId,
      rootId: input.rootId,
      canonicalPath: directory,
      entryFile: entry,
      scope: input.scope,
      snapshotId,
      provenanceId,
      access: input.access ?? "read-write",
    },
  }
}

const fixtures: readonly SkillFixture[] = [
  skillFixture({
    id: "global_review",
    name: "global-review",
    pathName: "global-review",
    description: "Review every release",
    author: "Ada",
    packageId: "quality-suite",
    adapterId: "codex",
    rootId: "root_global",
    scope: "global",
  }),
  skillFixture({
    id: "project_release",
    name: "project-release",
    pathName: "project-release",
    description: "Release Acme Web",
    author: "Grace",
    adapterId: "codex",
    rootId: "root_acme",
    scope: { projectId: "project_acme" },
  }),
  skillFixture({
    id: "broken_frontmatter",
    pathName: "broken-frontmatter",
    adapterId: "folder",
    rootId: "root_beta",
    scope: { projectId: "project_beta" },
    access: "read-only",
    finding: {
      code: "FRONTMATTER_REQUIRED",
      severity: "error",
      message: "No se pudo leer el frontmatter",
      source: "core",
    },
  }),
]

let store: ForgeStore

beforeEach(() => {
  store = openForgeStore({ path: ":memory:" })
  for (const fixture of fixtures) {
    store.snapshots.put(fixture.snapshot)
    store.snapshots.putProvenance(fixture.provenance)
  }
  store.projections.replaceInventory({
    projects,
    roots,
    installations: fixtures.map(({ installation }) => installation),
  })
})

afterEach(() => store.close())

describe("StoredInventoryQueryRepository", () => {
  it("distinguishes the whole machine, true global, and project-effective scopes", () => {
    expect(store.inventory.list({ scope: { kind: "all" } }).items.map(({ key }) => key))
      .toEqual(["broken-frontmatter", "global-review", "project-release"])

    expect(store.inventory.list({ scope: { kind: "global" } }).items.map(({ key }) => key))
      .toEqual(["global-review"])

    expect(store.inventory.list({
      scope: { kind: "project", projectId: "project_acme" },
    }).items.map(({ key }) => key)).toEqual([
      "global-review",
      "project-release",
    ])

    expect(store.inventory.list({
      scope: { kind: "project", projectId: "project_beta" },
    }).items.map(({ key }) => key)).toEqual(["broken-frontmatter"])

    expect(store.inventory.list({
      scope: { kind: "project", projectId: "project_missing" },
    }).items).toEqual([])
  })

  it("maps domain evidence without inventing values and keeps invalid skills visible", () => {
    const page = store.inventory.list({ scope: { kind: "all" } })
    const observedItem = page.items.find(({ key }) => key === "global-review")
    const invalidItem = page.items.find(({ key }) => key === "broken-frontmatter")

    expect(observedItem).toMatchObject({
      name: {
        state: "known",
        value: "global-review",
        evidence: { kind: "observed" },
      },
      author: { state: "known", value: "Ada" },
      packageId: { state: "known", value: "quality-suite" },
    })
    expect(invalidItem).toMatchObject({
      key: "broken-frontmatter",
      name: {
        state: "unknown",
        evidence: { kind: "unknown", source: "frontmatter.name" },
      },
      status: { validity: "invalid", source: "read-only" },
    })
    expect(invalidItem?.name).not.toHaveProperty("value")
  })

  it("searches metadata and applies evidence-aware filters and grouping", () => {
    expect(store.inventory.list({
      scope: { kind: "all" },
      search: "acme web",
    }).items.map(({ key }) => key)).toEqual(["project-release"])

    expect(store.inventory.list({
      scope: { kind: "all" },
      authors: ["Ada"],
      provenanceKinds: ["package"],
      sourceStates: ["managed"],
      groupBy: "author",
    }).items.map(({ key }) => key)).toEqual(["global-review"])

    expect(store.inventory.list({
      scope: { kind: "all" },
      validity: ["invalid"],
      adapterIds: ["folder"],
      sourceStates: ["read-only"],
    }).items.map(({ key }) => key)).toEqual(["broken-frontmatter"])
  })

  it("sorts and paginates deterministically with an opaque installation cursor", () => {
    const first = store.inventory.list({
      scope: { kind: "all" },
      sort: { by: "name", direction: "desc" },
      pageSize: 2,
    })
    expect(first.items.map(({ key }) => key)).toEqual([
      "project-release",
      "global-review",
    ])
    expect(first.total).toBe(3)
    expect(first.nextCursor).toBe("installation_global_review")

    const second = store.inventory.list({
      scope: { kind: "all" },
      sort: { by: "name", direction: "desc" },
      cursor: first.nextCursor ?? undefined,
      pageSize: 2,
    })
    expect(second.items.map(({ key }) => key)).toEqual([
      "broken-frontmatter",
    ])
    expect(second.nextCursor).toBeNull()
    expect(first.projects?.map(({ displayName }) => displayName)).toEqual([
      "Acme Web",
      "Beta API",
    ])
  })
})
