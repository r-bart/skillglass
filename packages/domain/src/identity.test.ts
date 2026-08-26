import { describe, expect, it } from "vitest"

import { canonicalPath } from "./entities.js"
import {
  assertUniqueCanonicalIdentities,
  canonicalInstallationIdentity,
  findCanonicalIdentityCollisions,
} from "./identity.js"

describe("canonicalPath", () => {
  it("brands a path already canonicalized by the path service", () => {
    expect(canonicalPath("/Users/me/.codex/skills/example")).toBe(
      "/Users/me/.codex/skills/example",
    )
    expect(canonicalPath("C:\\Users\\me\\.codex\\skills\\example")).toBe(
      "C:\\Users\\me\\.codex\\skills\\example",
    )
  })

  it("rejects empty and null-byte paths", () => {
    expect(() => canonicalPath("")).toThrow("Canonical path cannot be empty")
    expect(() => canonicalPath("/valid\0escape")).toThrow(
      "Canonical path cannot contain a null byte",
    )
  })
})

describe("canonical installation identity", () => {
  it("uses adapter and canonical path, never display name", () => {
    const identity = canonicalInstallationIdentity({
      adapterId: "codex",
      canonicalPath: "/skills/review",
    })

    expect(identity).toBe('["codex","/skills/review"]')
    expect(
      canonicalInstallationIdentity({
        adapterId: "folder",
        canonicalPath: "/skills/review",
      }),
    ).not.toBe(identity)
  })

  it("is unambiguous even when components contain common delimiters", () => {
    const left = canonicalInstallationIdentity({
      adapterId: "a|b",
      canonicalPath: "c",
    })
    const right = canonicalInstallationIdentity({
      adapterId: "a",
      canonicalPath: "b|c",
    })

    expect(left).not.toBe(right)
  })

  it("rejects incomplete identity components", () => {
    expect(() =>
      canonicalInstallationIdentity({ adapterId: "", canonicalPath: "/x" }),
    ).toThrow("Adapter ID cannot be empty")
    expect(() =>
      canonicalInstallationIdentity({ adapterId: "codex", canonicalPath: "" }),
    ).toThrow("Canonical path cannot be empty")
  })

  it("reports deterministic collisions within the same adapter", () => {
    const collisions = findCanonicalIdentityCollisions([
      { id: "z", adapterId: "codex", canonicalPath: canonicalPath("/same") },
      { id: "other", adapterId: "folder", canonicalPath: canonicalPath("/same") },
      { id: "a", adapterId: "codex", canonicalPath: canonicalPath("/same") },
    ])

    expect(collisions).toEqual([
      {
        identity: '["codex","/same"]',
        installationIds: ["a", "z"],
      },
    ])
    expect(() =>
      assertUniqueCanonicalIdentities([
        { id: "z", adapterId: "codex", canonicalPath: canonicalPath("/same") },
        { id: "a", adapterId: "codex", canonicalPath: canonicalPath("/same") },
      ]),
    ).toThrow("Duplicate canonical installation identities")
  })

  it("accepts identical paths owned by different adapters", () => {
    expect(() =>
      assertUniqueCanonicalIdentities([
        { id: "one", adapterId: "codex", canonicalPath: canonicalPath("/same") },
        { id: "two", adapterId: "folder", canonicalPath: canonicalPath("/same") },
      ]),
    ).not.toThrow()
  })
})
