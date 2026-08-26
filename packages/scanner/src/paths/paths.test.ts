import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import {
  canonicalizeLexicalPath,
  createApprovedRootPolicy,
  deduplicateApprovedRoots,
  FilesystemApprovedRootPolicy,
  isPathContained,
  PathAuthorizationError,
  resolveCanonicalPath,
  type ApprovedRootInput,
  type PathAuthorizationErrorCode,
} from "./index.js"

const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-paths-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await chmod(directory, 0o700).catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

function approvedRoot(
  pathValue: string,
  overrides: Partial<ApprovedRootInput> = {},
): ApprovedRootInput {
  return {
    rootId: "root_primary",
    path: pathValue,
    kind: "user-added",
    access: "read-write",
    writableWithoutElevation: true,
    ...overrides,
  }
}

async function expectPathError(
  promise: Promise<unknown>,
  code: PathAuthorizationErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "PathAuthorizationError",
    code,
  })
}

describe("lexical canonicalization and containment", () => {
  it("normalizes POSIX paths and strips non-root trailing separators", () => {
    expect(
      canonicalizeLexicalPath("../skills/./alpha/", {
        flavor: "posix",
        cwd: "/workspace/project",
      }),
    ).toBe("/workspace/skills/alpha")
  })

  it("normalizes Windows paths with stable drive casing", () => {
    expect(
      canonicalizeLexicalPath("c:\\workspace\\skills\\..\\skills\\alpha\\", {
        flavor: "win32",
        cwd: "C:\\workspace",
      }),
    ).toBe("C:\\workspace\\skills\\alpha")
  })

  it("rejects empty and null-byte paths", () => {
    expect(() => canonicalizeLexicalPath("")).toThrowError(
      expect.objectContaining({ code: "INVALID_PATH" }),
    )
    expect(() => canonicalizeLexicalPath("bad\0path")).toThrowError(
      expect.objectContaining({ code: "INVALID_PATH" }),
    )
  })

  it("uses path segments rather than vulnerable string prefixes", () => {
    expect(isPathContained("/tmp/skills", "/tmp/skills/alpha")).toBe(true)
    expect(isPathContained("/tmp/skills", "/tmp/skills")).toBe(true)
    expect(isPathContained("/tmp/skills", "/tmp/skills-evil/alpha")).toBe(false)
    expect(isPathContained("/tmp/skills", "/tmp/skills/../escape")).toBe(false)
  })

  it("models Windows containment case-insensitively without a Windows host", () => {
    const semantics = { flavor: "win32" as const }
    expect(
      isPathContained(
        "C:\\Users\\Forge\\Skills",
        "c:\\users\\forge\\skills\\alpha",
        semantics,
      ),
    ).toBe(true)
    expect(
      isPathContained(
        "C:\\Users\\Forge\\Skills",
        "C:\\Users\\Forge\\SkillsOther\\alpha",
        semantics,
      ),
    ).toBe(false)
  })
})

describe("realpath aliases and cycles", () => {
  it("resolves existing symlink or junction aliases", async () => {
    const temporary = await makeTemporaryDirectory()
    const target = path.join(temporary, "target")
    const alias = path.join(temporary, "alias")
    await mkdir(target)
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir")

    const resolvedTarget = await resolveCanonicalPath(target)
    const resolvedAlias = await resolveCanonicalPath(alias)
    expect(resolvedAlias.canonicalPath).toBe(resolvedTarget.canonicalPath)
  })

  it("resolves the nearest existing ancestor for a future destination", async () => {
    const temporary = await makeTemporaryDirectory()
    const target = path.join(temporary, "target")
    const alias = path.join(temporary, "alias")
    await mkdir(target)
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir")

    const resolution = await resolveCanonicalPath(
      path.join(alias, "future", "SKILL.md"),
      { allowMissing: true },
    )
    expect(resolution.exists).toBe(false)
    expect(resolution.canonicalPath).toBe(
      path.join(await resolveCanonicalPath(target).then((item) => item.canonicalPath), "future", "SKILL.md"),
    )
    expect(resolution.existingAncestor).toBe(
      await resolveCanonicalPath(target).then((item) => item.canonicalPath),
    )
  })

  it.skipIf(process.platform === "win32")(
    "reports a symlink cycle instead of recursing",
    async () => {
      const temporary = await makeTemporaryDirectory()
      const cycleA = path.join(temporary, "cycle-a")
      const cycleB = path.join(temporary, "cycle-b")
      await symlink(cycleB, cycleA)
      await symlink(cycleA, cycleB)

      await expectPathError(resolveCanonicalPath(cycleA), "SYMLINK_CYCLE")
    },
  )

  it("does not mistake a broken link for a safe missing destination", async () => {
    const temporary = await makeTemporaryDirectory()
    const broken = path.join(temporary, "broken")
    await symlink(path.join(temporary, "absent"), broken)

    await expectPathError(
      resolveCanonicalPath(path.join(broken, "SKILL.md"), {
        allowMissing: true,
      }),
      "PATH_NOT_FOUND",
    )
  })
})

describe("approved root deduplication", () => {
  it("deduplicates physical aliases and maps their IDs to one root", async () => {
    const temporary = await makeTemporaryDirectory()
    const root = path.join(temporary, "skills")
    const alias = path.join(temporary, "skills-alias")
    await mkdir(root)
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir")

    const roots = await deduplicateApprovedRoots([
      approvedRoot(root),
      approvedRoot(alias, { rootId: "root_alias" }),
    ])

    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({
      rootId: "root_primary",
      aliasRootIds: ["root_alias"],
    })
  })

  it("merges duplicate permissions conservatively", async () => {
    const temporary = await makeTemporaryDirectory()
    const root = path.join(temporary, "skills")
    const alias = path.join(temporary, "skills-alias")
    await mkdir(root)
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir")

    const roots = await deduplicateApprovedRoots([
      approvedRoot(root),
      approvedRoot(alias, {
        rootId: "root_managed_alias",
        kind: "managed",
        access: "read-only",
        writableWithoutElevation: false,
      }),
    ])

    expect(roots[0]).toMatchObject({
      kind: "managed",
      access: "read-only",
      writableWithoutElevation: false,
    })
  })

  it("rejects duplicate and empty root IDs", async () => {
    const temporary = await makeTemporaryDirectory()
    await expectPathError(
      deduplicateApprovedRoots([
        approvedRoot(temporary),
        approvedRoot(temporary, { rootId: "root_primary" }),
      ]),
      "DUPLICATE_ROOT_ID",
    )
    await expectPathError(
      deduplicateApprovedRoots([approvedRoot(temporary, { rootId: "" })]),
      "DUPLICATE_ROOT_ID",
    )
  })
})

describe("FilesystemApprovedRootPolicy", () => {
  it("uses an opaque approved ID and authorizes reads in repository fixtures", async () => {
    const fixtureRoot = fileURLToPath(
      new URL("../../../test-fixtures/codex/home/.agents/skills/", import.meta.url),
    )
    const policy = await createApprovedRootPolicy([
      approvedRoot(fixtureRoot, {
        rootId: "fixture_root",
        access: "read-only",
        writableWithoutElevation: false,
      }),
    ])

    const result = await policy.authorizeRead(
      "fixture_root",
      path.join("personal-skill", "SKILL.md"),
    )
    expect(result).toBe(
      await resolveCanonicalPath(
        path.join(fixtureRoot, "personal-skill", "SKILL.md"),
      ).then((item) => item.canonicalPath),
    )
    await expectPathError(
      policy.authorizeRead(fixtureRoot, "personal-skill/SKILL.md"),
      "ROOT_NOT_APPROVED",
    )
  })

  it("authorizes existing and future writes inside a writable root", async () => {
    const temporary = await makeTemporaryDirectory()
    const root = path.join(temporary, "skills")
    const existing = path.join(root, "existing.md")
    await mkdir(root)
    await writeFile(existing, "content")
    const policy = await FilesystemApprovedRootPolicy.create([approvedRoot(root)])

    await expect(policy.authorizeWrite("root_primary", "existing.md")).resolves.toBe(
      await resolveCanonicalPath(existing).then((item) => item.canonicalPath),
    )
    await expect(
      policy.authorizeWrite("root_primary", "new/deep/SKILL.md"),
    ).resolves.toBe(path.join(await resolveCanonicalPath(root).then((item) => item.canonicalPath), "new", "deep", "SKILL.md"))
  })

  it("rejects lexical traversal, prefix siblings, and external symlink escapes", async () => {
    const temporary = await makeTemporaryDirectory()
    const root = path.join(temporary, "skills")
    const outside = path.join(temporary, "skills-evil")
    await mkdir(root)
    await mkdir(outside)
    await writeFile(path.join(outside, "secret.md"), "secret")
    await symlink(
      outside,
      path.join(root, "external"),
      process.platform === "win32" ? "junction" : "dir",
    )
    const policy = await FilesystemApprovedRootPolicy.create([approvedRoot(root)])

    await expectPathError(
      policy.authorizeRead("root_primary", "../skills-evil/secret.md"),
      "PATH_OUTSIDE_ROOT",
    )
    await expectPathError(
      policy.authorizeRead("root_primary", path.join(outside, "secret.md")),
      "PATH_OUTSIDE_ROOT",
    )
    await expectPathError(
      policy.authorizeRead("root_primary", "external/secret.md"),
      "PATH_OUTSIDE_ROOT",
    )
    await expectPathError(
      policy.authorizeWrite("root_primary", "external/new.md"),
      "PATH_OUTSIDE_ROOT",
    )
  })

  it.each([
    ["managed", "read-write", true, "ROOT_MANAGED"],
    ["system", "read-write", true, "ROOT_SYSTEM"],
    ["user-added", "denied", false, "ROOT_DENIED"],
    ["user-added", "missing", false, "ROOT_MISSING"],
    ["user-added", "read-only", false, "ROOT_READ_ONLY"],
    ["user-added", "read-write", false, "ROOT_NOT_WRITABLE"],
  ] as const)(
    "rejects writes for %s/%s roots without elevation",
    async (kind, rootAccess, writableWithoutElevation, expectedCode) => {
      const temporary = await makeTemporaryDirectory()
      const root = path.join(temporary, "skills")
      if (rootAccess !== "missing") await mkdir(root)
      const policy = await FilesystemApprovedRootPolicy.create([
        approvedRoot(root, {
          kind,
          access: rootAccess,
          writableWithoutElevation,
        }),
      ])

      await expectPathError(
        policy.authorizeWrite("root_primary", "new-skill"),
        expectedCode,
      )
    },
  )

  it("rejects reads for denied and missing roots", async () => {
    const temporary = await makeTemporaryDirectory()
    const deniedPolicy = await FilesystemApprovedRootPolicy.create([
      approvedRoot(temporary, {
        access: "denied",
        writableWithoutElevation: false,
      }),
    ])
    const missingPolicy = await FilesystemApprovedRootPolicy.create([
      approvedRoot(path.join(temporary, "missing"), {
        access: "missing",
        writableWithoutElevation: false,
      }),
    ])

    await expectPathError(
      deniedPolicy.authorizeRead("root_primary", "."),
      "ROOT_DENIED",
    )
    await expectPathError(
      missingPolicy.authorizeRead("root_primary", "."),
      "ROOT_MISSING",
    )
  })

  it("invalidates authorization when the approved root is replaced", async () => {
    const temporary = await makeTemporaryDirectory()
    const root = path.join(temporary, "skills")
    const moved = path.join(temporary, "old-skills")
    await mkdir(root)
    const policy = await FilesystemApprovedRootPolicy.create([approvedRoot(root)])
    await import("node:fs/promises").then(({ rename }) => rename(root, moved))
    await mkdir(root)

    await expectPathError(
      policy.authorizeWrite("root_primary", "new-skill"),
      "ROOT_CHANGED",
    )
  })

  it("does not expose any privilege-elevation API", () => {
    expect(Object.getOwnPropertyNames(FilesystemApprovedRootPolicy.prototype)).toEqual([
      "constructor",
      "getApprovedRoots",
      "authorizeRead",
      "authorizeWrite",
    ])
    expect(PathAuthorizationError).toBeTypeOf("function")
  })
})
