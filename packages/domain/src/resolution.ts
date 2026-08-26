import type { EffectiveSkill, TargetScope } from "./entities.js"
import { derived, unknown, type KnownEvidenced } from "./evidence.js"

export type ResolutionSemantics = "supported" | "unsupported" | "unknown"

export interface ProvenWinner {
  readonly installationId: string
  readonly reason: KnownEvidenced<string>
}

export interface ResolveEffectiveSkillInput {
  readonly adapterId: string
  readonly targetScope: TargetScope
  readonly key: string
  readonly candidateInstallationIds: readonly string[]
  readonly semantics: ResolutionSemantics
  /** A winner supplied with non-unknown adapter evidence. */
  readonly provenWinner?: ProvenWinner
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} cannot be empty`)
}

function candidatesInStableOrder(candidateIds: readonly string[]): string[] {
  for (const candidateId of candidateIds) {
    assertNonEmpty(candidateId, "Candidate installation ID")
  }
  return [...new Set(candidateIds)].sort()
}

/**
 * Resolves only facts justified by the candidate set or an adapter proof.
 * Candidate order is normalized and is never interpreted as precedence.
 */
export function resolveEffectiveSkill({
  adapterId,
  targetScope,
  key,
  candidateInstallationIds,
  semantics,
  provenWinner,
}: ResolveEffectiveSkillInput): EffectiveSkill {
  assertNonEmpty(adapterId, "Adapter ID")
  assertNonEmpty(key, "Effective skill key")
  const candidates = candidatesInStableOrder(candidateInstallationIds)

  if (semantics !== "supported") {
    if (provenWinner !== undefined) {
      throw new TypeError(
        "A winner cannot be proven when resolution semantics are not supported",
      )
    }

    return {
      adapterId,
      targetScope,
      key,
      candidateInstallationIds: candidates,
      reason: unknown({ source: "adapter-resolution" }),
      status: semantics,
    }
  }

  if (provenWinner !== undefined) {
    if (!candidates.includes(provenWinner.installationId)) {
      throw new TypeError("The proven winner must be one of the candidates")
    }

    return {
      adapterId,
      targetScope,
      key,
      winnerInstallationId: provenWinner.installationId,
      candidateInstallationIds: candidates,
      reason: provenWinner.reason,
      status: "resolved",
    }
  }

  if (candidates.length === 1) {
    const onlyCandidate = candidates[0]
    if (onlyCandidate === undefined) {
      throw new Error("Candidate cardinality changed during resolution")
    }

    return {
      adapterId,
      targetScope,
      key,
      winnerInstallationId: onlyCandidate,
      candidateInstallationIds: candidates,
      reason: {
        value: "Only candidate in the effective scope",
        evidence: derived({ source: "candidate-set" }),
      },
      status: "resolved",
    }
  }

  if (candidates.length > 1) {
    return {
      adapterId,
      targetScope,
      key,
      candidateInstallationIds: candidates,
      reason: {
        value: "Multiple candidates and no evidenced precedence winner",
        evidence: derived({ source: "candidate-set" }),
      },
      status: "conflict",
    }
  }

  return {
    adapterId,
    targetScope,
    key,
    candidateInstallationIds: candidates,
    reason: unknown({ source: "candidate-set" }),
    status: "unknown",
  }
}
