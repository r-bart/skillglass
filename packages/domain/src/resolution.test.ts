import { describe, expect, it } from "vitest"

import { evidenced, observed } from "./evidence.js"
import { resolveEffectiveSkill } from "./resolution.js"

const base = {
  adapterId: "codex",
  targetScope: { projectId: "forge" } as const,
  key: "review",
}

describe("effective skill resolution", () => {
  it("resolves a sole candidate from the candidate set", () => {
    expect(
      resolveEffectiveSkill({
        ...base,
        candidateInstallationIds: ["only"],
        semantics: "supported",
      }),
    ).toEqual({
      ...base,
      winnerInstallationId: "only",
      candidateInstallationIds: ["only"],
      reason: {
        value: "Only candidate in the effective scope",
        evidence: { kind: "derived", source: "candidate-set" },
      },
      status: "resolved",
    })
  })

  it("does not invent a winner for duplicate candidates", () => {
    const forward = resolveEffectiveSkill({
      ...base,
      candidateInstallationIds: ["second", "first"],
      semantics: "supported",
    })
    const reverse = resolveEffectiveSkill({
      ...base,
      candidateInstallationIds: ["first", "second"],
      semantics: "supported",
    })

    expect(forward).toEqual(reverse)
    expect(forward).toMatchObject({
      candidateInstallationIds: ["first", "second"],
      status: "conflict",
    })
    expect("winnerInstallationId" in forward).toBe(false)
  })

  it("deduplicates repeated observations without turning array order into precedence", () => {
    const result = resolveEffectiveSkill({
      ...base,
      candidateInstallationIds: ["same", "same"],
      semantics: "supported",
    })

    expect(result.status).toBe("resolved")
    expect(result.candidateInstallationIds).toEqual(["same"])
    expect(result.winnerInstallationId).toBe("same")
  })

  it("accepts an adapter-proven winner only when it is a candidate", () => {
    const reason = evidenced(
      "Project root has documented precedence",
      observed({ source: "codex-adapter" }),
    )
    const result = resolveEffectiveSkill({
      ...base,
      candidateInstallationIds: ["global", "project"],
      semantics: "supported",
      provenWinner: { installationId: "project", reason },
    })

    expect(result).toMatchObject({
      winnerInstallationId: "project",
      status: "resolved",
      reason,
    })
    expect(() =>
      resolveEffectiveSkill({
        ...base,
        candidateInstallationIds: ["global", "project"],
        semantics: "supported",
        provenWinner: { installationId: "absent", reason },
      }),
    ).toThrow("The proven winner must be one of the candidates")
  })

  it.each(["unsupported", "unknown"] as const)(
    "keeps candidates unresolved when semantics are %s",
    (semantics) => {
      const result = resolveEffectiveSkill({
        ...base,
        candidateInstallationIds: ["one", "two"],
        semantics,
      })

      expect(result.status).toBe(semantics)
      expect("winnerInstallationId" in result).toBe(false)
      expect(result.reason).toEqual({
        evidence: { kind: "unknown", source: "adapter-resolution" },
      })
    },
  )

  it("rejects winner claims when adapter resolution is not supported", () => {
    expect(() =>
      resolveEffectiveSkill({
        ...base,
        candidateInstallationIds: ["one"],
        semantics: "unsupported",
        provenWinner: {
          installationId: "one",
          reason: evidenced("claimed", observed()),
        },
      }),
    ).toThrow(
      "A winner cannot be proven when resolution semantics are not supported",
    )
  })

  it("keeps an empty supported candidate set unknown", () => {
    const result = resolveEffectiveSkill({
      ...base,
      candidateInstallationIds: [],
      semantics: "supported",
    })

    expect(result.status).toBe("unknown")
    expect(result.reason).toEqual({
      evidence: { kind: "unknown", source: "candidate-set" },
    })
  })

  it("rejects empty domain keys and candidate IDs", () => {
    expect(() =>
      resolveEffectiveSkill({
        ...base,
        adapterId: "",
        candidateInstallationIds: [],
        semantics: "supported",
      }),
    ).toThrow("Adapter ID cannot be empty")
    expect(() =>
      resolveEffectiveSkill({
        ...base,
        key: "",
        candidateInstallationIds: [],
        semantics: "supported",
      }),
    ).toThrow("Effective skill key cannot be empty")
    expect(() =>
      resolveEffectiveSkill({
        ...base,
        candidateInstallationIds: [""],
        semantics: "supported",
      }),
    ).toThrow("Candidate installation ID cannot be empty")
  })

  it("does not mutate the caller's candidate array", () => {
    const candidates = Object.freeze(["z", "a"])
    resolveEffectiveSkill({
      ...base,
      candidateInstallationIds: candidates,
      semantics: "supported",
    })
    expect(candidates).toEqual(["z", "a"])
  })
})
