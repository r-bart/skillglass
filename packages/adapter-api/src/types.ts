import type { OperationPlanDto, OperationRequestDto } from "@forge/contracts"
import type {
  CanonicalPath,
  EffectiveSkill,
  Evidence,
  InstallationScope,
  ProjectScope,
  Provenance,
  ScopeBinding,
  SkillInstallation,
  SkillSnapshot,
  SourceRoot,
  TargetScope,
  ValidationFinding,
} from "@forge/domain"
import type {
  ApprovedRootPolicy,
  LocalSourceManifestV1,
  ParsedSkillSource,
  ScanRootContext,
  SkillDirectoryValidation,
} from "@forge/scanner"

import type {
  AdapterCapabilities,
  CapabilityEvidence,
  CapabilityState,
  MutatingAdapterCapability,
} from "./capabilities.js"

export interface DiscoveryContext {
  readonly homeDirectory: CanonicalPath
  readonly workingDirectory: CanonicalPath
  readonly repositoryRoot?: CanonicalPath
  readonly projects: readonly ProjectScope[]
}

export interface RootCandidate {
  /** Stable opaque identity; never a filesystem path. */
  readonly candidateId: string
  readonly adapterId: string
  readonly canonicalPath: CanonicalPath
  readonly kind: SourceRoot["kind"]
  readonly projectPath?: CanonicalPath
  readonly access: SourceRoot["access"]
  readonly writableWithoutElevation: boolean
  readonly evidence: Evidence
  readonly defaultIncluded: boolean
}

export interface SkillObservation {
  readonly canonicalPath: CanonicalPath
  readonly entryFile: CanonicalPath
  readonly parsed: ParsedSkillSource
  readonly validation: SkillDirectoryValidation
}

export interface InstallationObservation {
  readonly installation: SkillInstallation
  readonly snapshot: SkillSnapshot
  readonly provenanceId: string
  readonly provenance: Provenance
  readonly observedScope: InstallationScope
  readonly evidence: Evidence
}

export interface ResolutionInput {
  readonly targetScope: TargetScope
  readonly key: string
  readonly candidates: readonly SkillInstallation[]
}

export interface BindingInput {
  readonly installation: SkillInstallation
  readonly targetScope: TargetScope
}

export interface AdapterOperationRequest {
  readonly request: OperationRequestDto
  readonly targetRoot: SourceRoot
  readonly installation?: SkillInstallation
  readonly sourceManifest?: LocalSourceManifestV1
  /** Re-authorizes all proposed paths immediately before execution. */
  readonly rootPolicy: ApprovedRootPolicy
}

export type AdapterFilesystemStep =
  | Readonly<{
      kind: "create-installation"
      rootId: string
      relativePath: string
      sourceTreeHash: string
    }>
  | Readonly<{
      kind: "replace-installation"
      rootId: string
      relativePath: string
      expectedBeforeHash: string
      sourceTreeHash: string
    }>
  | Readonly<{
      kind: "replace-entry"
      rootId: string
      relativePath: string
      expectedBeforeHash: string
      contentHash: string
    }>

export type AdapterPostcondition =
  | Readonly<{
      kind: "tree-hash-equals"
      rootId: string
      relativePath: string
      expectedHash: string
    }>
  | Readonly<{
      kind: "entry-hash-equals"
      rootId: string
      relativePath: string
      expectedHash: string
    }>

export interface AdapterOperationPlan {
  readonly operation: OperationPlanDto
  readonly capability: MutatingAdapterCapability
  readonly steps: readonly AdapterFilesystemStep[]
  readonly postconditions: readonly AdapterPostcondition[]
}

export type AdapterOperationPlanningResult =
  | Readonly<{ status: "planned"; plan: AdapterOperationPlan }>
  | Readonly<{
      status: "unavailable"
      capability: MutatingAdapterCapability
      capabilityState: Exclude<CapabilityState, "supported">
      reason: string
      evidence: Evidence
    }>

/**
 * Runtime-specific observation and planning boundary. Implementations only
 * describe writes; the core operation engine owns authorization and execution.
 */
export interface SkillRuntimeAdapter {
  readonly id: string
  readonly displayName: string

  capabilities(): Promise<AdapterCapabilities>
  capabilityEvidence(): Promise<readonly CapabilityEvidence[]>
  discoverRoots(context: DiscoveryContext): Promise<readonly RootCandidate[]>
  scanRoot(root: SourceRoot, context?: ScanRootContext): AsyncIterable<InstallationObservation>
  parseInstallation(path: CanonicalPath): Promise<SkillObservation>
  validate(snapshot: SkillSnapshot): Promise<readonly ValidationFinding[]>
  resolveScope(input: ResolutionInput): Promise<readonly EffectiveSkill[]>
  describeBinding(input: BindingInput): Promise<ScopeBinding>
  planOperation(
    request: AdapterOperationRequest,
  ): Promise<AdapterOperationPlanningResult>
}
