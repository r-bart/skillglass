import type {
  InstallationAccess,
  Provenance,
  ScopeBinding,
  SkillStatus,
  ValidationFinding,
} from "./entities.js"

export function composeValidity(
  findings?: readonly ValidationFinding[],
): SkillStatus["validity"] {
  if (findings === undefined) return "unknown"
  if (findings.some(({ severity }) => severity === "error")) return "invalid"
  if (findings.some(({ severity }) => severity === "warning")) return "warning"
  return "valid"
}

export function composeRuntimeState(
  binding?: ScopeBinding,
): SkillStatus["runtimeState"] {
  if (binding === undefined) return "unknown"
  if (binding.relationship === "shadowed") return "shadowed"
  if (binding.runtimeState === "enabled") return "enabled"
  if (binding.runtimeState === "disabled") return "disabled"
  if (binding.runtimeState === "unsupported") return "unsupported"
  if (
    binding.relationship === "inherited" ||
    binding.runtimeState === "inherit"
  ) {
    return "inherited"
  }
  return "unknown"
}

export interface SourceStatusInput {
  readonly access?: InstallationAccess
  readonly provenance?: Provenance
  readonly locallyModified?: boolean
}

export function composeSourceStatus({
  access,
  provenance,
  locallyModified,
}: SourceStatusInput): SkillStatus["source"] {
  if (locallyModified === true) return "modified"
  if (access === "read-only") return "read-only"
  if (provenance?.kind === "local") return "local"
  if (
    provenance?.managedBy === "forge" ||
    provenance?.managedBy === "runtime" ||
    provenance?.kind === "forge-import" ||
    provenance?.kind === "registry" ||
    provenance?.kind === "package" ||
    provenance?.kind === "plugin" ||
    provenance?.kind === "system"
  ) {
    return "managed"
  }
  return "unknown"
}

export interface ComposeSkillStatusInput extends SourceStatusInput {
  readonly findings?: readonly ValidationFinding[]
  readonly binding?: ScopeBinding
  readonly update?: SkillStatus["update"]
  readonly usage?: SkillStatus["usage"]
}

export function composeSkillStatus(
  input: ComposeSkillStatusInput = {},
): SkillStatus {
  return {
    validity: composeValidity(input.findings),
    runtimeState: composeRuntimeState(input.binding),
    source: composeSourceStatus(input),
    update: input.update ?? "unknown",
    usage: input.usage ?? "unavailable",
  }
}
