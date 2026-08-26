import { describe, expect, expectTypeOf, it } from "vitest"

import {
  derived,
  evidenced,
  inferred,
  isEvidenced,
  observed,
  unknown,
  unknownEvidence,
  type Evidenced,
} from "./evidence.js"

describe("evidence", () => {
  it("creates observed and derived evidence without adding absent fields", () => {
    expect(observed()).toEqual({ kind: "observed" })
    expect(
      derived({ source: "frontmatter", observedAt: "2026-08-26T10:00:00Z" }),
    ).toEqual({
      kind: "derived",
      source: "frontmatter",
      observedAt: "2026-08-26T10:00:00Z",
    })
  })

  it("accepts heuristic confidence only in the inclusive 0..1 range", () => {
    expect(inferred({ confidence: 0 })).toEqual({
      kind: "inferred",
      confidence: 0,
    })
    expect(inferred({ confidence: 1 })).toEqual({
      kind: "inferred",
      confidence: 1,
    })
    expect(() => inferred({ confidence: -0.01 })).toThrow(RangeError)
    expect(() => inferred({ confidence: 1.01 })).toThrow(RangeError)
    expect(() => inferred({ confidence: Number.NaN })).toThrow(RangeError)
  })

  it("couples known values to non-unknown evidence", () => {
    const claim = evidenced("forge", observed({ source: "SKILL.md" }))

    expect(claim).toEqual({
      value: "forge",
      evidence: { kind: "observed", source: "SKILL.md" },
    })
    expect(isEvidenced(claim)).toBe(true)
  })

  it("represents unknown without a fabricated value", () => {
    const claim: Evidenced<string> = unknown({ source: "missing-frontmatter" })

    expect(claim).toEqual({
      evidence: { kind: "unknown", source: "missing-frontmatter" },
    })
    expect("value" in claim).toBe(false)
    expect(isEvidenced(claim)).toBe(false)
    expect(unknownEvidence()).toEqual({ kind: "unknown" })
  })

  it("narrows known and unknown claims by their evidence kind", () => {
    const claim: Evidenced<number> = Math.random() > -1
      ? evidenced(42, derived())
      : unknown()

    if (isEvidenced(claim)) {
      expectTypeOf(claim.value).toEqualTypeOf<number>()
      expect(claim.value).toBe(42)
    }
  })
})
