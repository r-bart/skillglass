import {
  EvidenceSchema,
  OperationPlanDtoSchema,
  OperationRequestDtoSchema,
  RelativeDisplayPathSchema,
  Sha256Schema,
} from "@forge/contracts"

import {
  ADAPTER_CAPABILITY_NAMES,
  MUTATING_ADAPTER_CAPABILITIES,
  capabilityForOperationKind,
  type MutatingAdapterCapability,
} from "./capabilities.js"
import type {
  AdapterOperationPlan,
  AdapterOperationRequest,
  DiscoveryContext,
  SkillRuntimeAdapter,
} from "./types.js"

export type AdapterAdmissionIssueCode =
  | "ADAPTER_ID_INVALID"
  | "ADAPTER_DISPLAY_NAME_INVALID"
  | "CAPABILITY_DECLARATION_INVALID"
  | "CAPABILITY_EVIDENCE_INVALID"
  | "ROOT_CANDIDATE_INVALID"
  | "ROOT_CANDIDATE_DUPLICATE"
  | "PLANNING_MUTATED_STATE"
  | "OPERATION_REQUEST_INVALID"
  | "DECORATIVE_OPERATION_SUCCESS"
  | "OPERATION_UNAVAILABLE_MISMATCH"
  | "OPERATION_PLAN_INVALID"
  | "OPERATION_POSTCONDITION_INVALID"

export interface AdapterAdmissionIssue {
  readonly code: AdapterAdmissionIssueCode
  readonly message: string
}

export interface AdapterOperationProbe {
  readonly capability: MutatingAdapterCapability
  readonly request: AdapterOperationRequest
  /** Snapshot of externally observable state; planning must leave it unchanged. */
  readonly captureState: () => unknown | Promise<unknown>
}

export interface AdapterAdmissionFixture {
  readonly discoveryContext: DiscoveryContext
  readonly operationProbes?: readonly AdapterOperationProbe[]
}

export interface AdapterAdmissionReport {
  readonly adapterId: string
  readonly passed: boolean
  readonly issues: readonly AdapterAdmissionIssue[]
}

export class AdapterAdmissionError extends Error {
  readonly report: AdapterAdmissionReport

  constructor(report: AdapterAdmissionReport) {
    super(
      `Adapter ${report.adapterId || "<missing>"} failed admission:\n${report.issues
        .map((issue) => `- ${issue.code}: ${issue.message}`)
        .join("\n")}`,
    )
    this.name = "AdapterAdmissionError"
    this.report = report
  }
}

function isOpaqueId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(value)
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value)
}

function snapshot(value: unknown): string {
  return JSON.stringify(value)
}

function validatePlan(
  candidate: AdapterOperationPlan,
  probe: AdapterOperationProbe,
): AdapterAdmissionIssue[] {
  const issues: AdapterAdmissionIssue[] = []
  const parsed = OperationPlanDtoSchema.safeParse(candidate.operation)
  if (!parsed.success) {
    issues.push({
      code: "OPERATION_PLAN_INVALID",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
    })
    return issues
  }

  const expectedCapability = capabilityForOperationKind(candidate.operation.kind)
  if (
    candidate.capability !== probe.capability ||
    candidate.capability !== expectedCapability ||
    candidate.operation.status !== "planned" ||
    candidate.operation.targetRootId !== probe.request.targetRoot.id ||
    candidate.steps.length === 0
  ) {
    issues.push({
      code: "OPERATION_PLAN_INVALID",
      message: "A supported mutation must produce a planned, matching, non-empty declarative plan",
    })
  }

  for (const step of candidate.steps) {
    if (
      step.rootId !== probe.request.targetRoot.id ||
      !RelativeDisplayPathSchema.safeParse(step.relativePath).success
    ) {
      issues.push({
        code: "OPERATION_PLAN_INVALID",
        message: "Every filesystem step must use the requested root ID and a contained relative path",
      })
    }
  }

  if (candidate.postconditions.length === 0) {
    issues.push({
      code: "OPERATION_POSTCONDITION_INVALID",
      message: "A supported mutation plan must contain a verifiable postcondition",
    })
  }
  for (const postcondition of candidate.postconditions) {
    if (
      postcondition.rootId !== probe.request.targetRoot.id ||
      !RelativeDisplayPathSchema.safeParse(postcondition.relativePath).success ||
      !Sha256Schema.safeParse(postcondition.expectedHash).success
    ) {
      issues.push({
        code: "OPERATION_POSTCONDITION_INVALID",
        message: "Postconditions require the requested root, a contained relative path, and a SHA-256 hash",
      })
    }
  }

  return issues
}

/** Runs framework-agnostic contract checks reusable by every adapter package. */
export async function inspectAdapterAdmission(
  adapter: SkillRuntimeAdapter,
  fixture: AdapterAdmissionFixture,
): Promise<AdapterAdmissionReport> {
  const issues: AdapterAdmissionIssue[] = []
  if (!isOpaqueId(adapter.id)) {
    issues.push({ code: "ADAPTER_ID_INVALID", message: "Adapter ID must be a non-path opaque ID" })
  }
  if (adapter.displayName.trim().length === 0) {
    issues.push({ code: "ADAPTER_DISPLAY_NAME_INVALID", message: "Adapter display name cannot be empty" })
  }

  const capabilities = await adapter.capabilities()
  const capabilityNames = new Set<string>(ADAPTER_CAPABILITY_NAMES)
  const capabilityStates = new Set([
    "supported",
    "read-only",
    "derived",
    "inferred",
    "unsupported",
    "unknown",
  ])
  for (const name of ADAPTER_CAPABILITY_NAMES) {
    if (!(name in capabilities) || !capabilityStates.has(capabilities[name])) {
      issues.push({ code: "CAPABILITY_DECLARATION_INVALID", message: `Missing capability ${name}` })
    }
  }
  for (const name of Object.keys(capabilities)) {
    if (!capabilityNames.has(name)) {
      issues.push({ code: "CAPABILITY_DECLARATION_INVALID", message: `Unknown capability ${name}` })
    }
  }

  const evidence = await adapter.capabilityEvidence()
  const evidencedCapabilities = new Set<string>()
  for (const declaration of evidence) {
    if (evidencedCapabilities.has(declaration.capability)) {
      issues.push({ code: "CAPABILITY_EVIDENCE_INVALID", message: `Duplicate evidence declaration for ${declaration.capability}` })
    }
    evidencedCapabilities.add(declaration.capability)
    if (
      capabilities[declaration.capability] !== declaration.state ||
      declaration.evidence.length === 0 ||
      declaration.evidence.some((item) => !EvidenceSchema.safeParse(item).success)
    ) {
      issues.push({ code: "CAPABILITY_EVIDENCE_INVALID", message: `Invalid evidence declaration for ${declaration.capability}` })
    }
  }
  for (const capability of ADAPTER_CAPABILITY_NAMES) {
    if (!evidencedCapabilities.has(capability)) {
      issues.push({ code: "CAPABILITY_EVIDENCE_INVALID", message: `Missing evidence declaration for ${capability}` })
    }
  }

  const candidates = await adapter.discoverRoots(fixture.discoveryContext)
  const ids = new Set<string>()
  for (const candidate of candidates) {
    if (ids.has(candidate.candidateId)) {
      issues.push({ code: "ROOT_CANDIDATE_DUPLICATE", message: `Duplicate candidate ID ${candidate.candidateId}` })
    }
    ids.add(candidate.candidateId)
    if (
      candidate.adapterId !== adapter.id ||
      !isOpaqueId(candidate.candidateId) ||
      !isAbsolutePath(candidate.canonicalPath) ||
      candidate.canonicalPath.includes("\0") ||
      (candidate.writableWithoutElevation && candidate.access !== "read-write") ||
      (candidate.kind === "project") !== (candidate.projectPath !== undefined) ||
      !EvidenceSchema.safeParse(candidate.evidence).success
    ) {
      issues.push({ code: "ROOT_CANDIDATE_INVALID", message: `Invalid root candidate ${candidate.candidateId}` })
    }
  }

  const probes = fixture.operationProbes ?? []
  const probedCapabilities = new Set(probes.map((probe) => probe.capability))
  for (const capability of MUTATING_ADAPTER_CAPABILITIES) {
    if (!probedCapabilities.has(capability)) {
      issues.push({ code: "OPERATION_PLAN_INVALID", message: `Mutation ${capability} requires an admission probe` })
    }
  }

  for (const probe of probes) {
    const declaredState = capabilities[probe.capability]
    const requestCapability = capabilityForOperationKind(probe.request.request.kind)
    const requestParsed = OperationRequestDtoSchema.safeParse(probe.request.request)
    if (
      !requestParsed.success ||
      requestCapability !== probe.capability ||
      probe.request.targetRoot.adapterId !== adapter.id ||
      !isOpaqueId(probe.request.targetRoot.id) ||
      !isAbsolutePath(probe.request.targetRoot.canonicalPath) ||
      (probe.request.request.kind === "install-local" &&
        probe.request.request.targetRootId !== probe.request.targetRoot.id)
    ) {
      issues.push({ code: "OPERATION_REQUEST_INVALID", message: `Invalid admission request for ${probe.capability}` })
    }
    const before = snapshot(await probe.captureState())
    const result = await adapter.planOperation(probe.request)
    const after = snapshot(await probe.captureState())
    if (before !== after) {
      issues.push({ code: "PLANNING_MUTATED_STATE", message: `Planning ${probe.capability} changed observable state` })
    }

    if (declaredState === "supported") {
      if (result.status !== "planned") {
        issues.push({ code: "OPERATION_PLAN_INVALID", message: `Supported capability ${probe.capability} did not return a plan` })
      } else {
        issues.push(...validatePlan(result.plan, probe))
      }
    } else if (result.status === "planned") {
      issues.push({ code: "DECORATIVE_OPERATION_SUCCESS", message: `${probe.capability} returned success while declared ${declaredState}` })
    } else if (
      result.capability !== probe.capability ||
      result.capabilityState !== declaredState ||
      result.reason.trim().length === 0 ||
      !EvidenceSchema.safeParse(result.evidence).success
    ) {
      issues.push({ code: "OPERATION_UNAVAILABLE_MISMATCH", message: `Unavailable result does not match ${probe.capability}:${declaredState}` })
    }
  }

  return Object.freeze({ adapterId: adapter.id, passed: issues.length === 0, issues: Object.freeze(issues) })
}

export async function assertAdapterAdmission(
  adapter: SkillRuntimeAdapter,
  fixture: AdapterAdmissionFixture,
): Promise<void> {
  const report = await inspectAdapterAdmission(adapter, fixture)
  if (!report.passed) throw new AdapterAdmissionError(report)
}
