export type EvidenceKind = "observed" | "derived" | "inferred" | "unknown"

interface EvidenceBase {
  readonly source?: string
  readonly observedAt?: string
}

export interface ObservedEvidence extends EvidenceBase {
  readonly kind: "observed"
}

export interface DerivedEvidence extends EvidenceBase {
  readonly kind: "derived"
}

export interface InferredEvidence extends EvidenceBase {
  readonly kind: "inferred"
  readonly confidence?: number
}

export interface UnknownEvidence extends EvidenceBase {
  readonly kind: "unknown"
}

export type KnownEvidence =
  | ObservedEvidence
  | DerivedEvidence
  | InferredEvidence

export type Evidence = KnownEvidence | UnknownEvidence

export interface KnownEvidenced<T> {
  readonly value: T
  readonly evidence: KnownEvidence
}

export interface UnknownEvidenced {
  readonly value?: never
  readonly evidence: UnknownEvidence
}

/**
 * An optional claim coupled to the evidence that supports it. The discriminated
 * representation makes the "unknown has no fallback value" invariant
 * impossible to violate without an explicit unsafe cast.
 */
export type Evidenced<T> = KnownEvidenced<T> | UnknownEvidenced

type EvidenceOptions = Readonly<{
  source?: string
  observedAt?: string
}>

function evidenceOptions(options: EvidenceOptions): EvidenceOptions {
  return {
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.observedAt === undefined
      ? {}
      : { observedAt: options.observedAt }),
  }
}

export function observed(options: EvidenceOptions = {}): ObservedEvidence {
  return { kind: "observed", ...evidenceOptions(options) }
}

export function derived(options: EvidenceOptions = {}): DerivedEvidence {
  return { kind: "derived", ...evidenceOptions(options) }
}

export function inferred(
  options: EvidenceOptions & Readonly<{ confidence?: number }> = {},
): InferredEvidence {
  if (
    options.confidence !== undefined &&
    (!Number.isFinite(options.confidence) ||
      options.confidence < 0 ||
      options.confidence > 1)
  ) {
    throw new RangeError("Evidence confidence must be between 0 and 1")
  }

  return {
    kind: "inferred",
    ...evidenceOptions(options),
    ...(options.confidence === undefined
      ? {}
      : { confidence: options.confidence }),
  }
}

export function unknownEvidence(
  options: EvidenceOptions = {},
): UnknownEvidence {
  return { kind: "unknown", ...evidenceOptions(options) }
}

export function evidenced<T>(
  value: T,
  evidence: KnownEvidence,
): KnownEvidenced<T> {
  return { value, evidence }
}

export function unknown<T = never>(
  options: EvidenceOptions = {},
): Evidenced<T> {
  return { evidence: unknownEvidence(options) }
}

export function isEvidenced<T>(claim: Evidenced<T>): claim is KnownEvidenced<T> {
  return claim.evidence.kind !== "unknown"
}
