import type { Evidence } from "@forge/domain"

export const ADAPTER_CAPABILITY_NAMES = [
  "discoverGlobalRoots",
  "discoverProjectRoots",
  "parseSkill",
  "enumerateResources",
  "resolvePrecedence",
  "observeRuntimeState",
  "installToUserRoot",
  "updateWritableInstallation",
  "editLocal",
  "declaredVersions",
  "sourceProvenance",
  "updateDiscovery",
  "dependencies",
  "permissionDeclarations",
  "triggerTelemetry",
  "usageTelemetry",
] as const

export type AdapterCapabilityName = (typeof ADAPTER_CAPABILITY_NAMES)[number]

export type CapabilityState =
  | "supported"
  | "read-only"
  | "derived"
  | "inferred"
  | "unsupported"
  | "unknown"

export type AdapterCapabilities = Readonly<
  Record<AdapterCapabilityName, CapabilityState>
>

export type MutatingAdapterCapability =
  | "installToUserRoot"
  | "updateWritableInstallation"
  | "editLocal"

export const MUTATING_ADAPTER_CAPABILITIES = [
  "installToUserRoot",
  "updateWritableInstallation",
  "editLocal",
] as const satisfies readonly MutatingAdapterCapability[]

export interface CapabilityEvidence {
  readonly capability: AdapterCapabilityName
  readonly state: CapabilityState
  readonly evidence: readonly Evidence[]
  readonly note?: string
}

/** Freezes a complete capability declaration and rejects missing/extra keys. */
export function defineAdapterCapabilities(
  capabilities: AdapterCapabilities,
): AdapterCapabilities {
  const declared = Object.keys(capabilities)
  const expected = new Set<string>(ADAPTER_CAPABILITY_NAMES)

  for (const capability of ADAPTER_CAPABILITY_NAMES) {
    if (!(capability in capabilities)) {
      throw new TypeError(`Missing adapter capability: ${capability}`)
    }
  }
  for (const capability of declared) {
    if (!expected.has(capability)) {
      throw new TypeError(`Unknown adapter capability: ${capability}`)
    }
  }

  return Object.freeze({ ...capabilities })
}

export function capabilityForOperationKind(
  kind: "create-skill" | "install-local" | "update-from-local" | "update-entry-content",
): MutatingAdapterCapability {
  switch (kind) {
    case "create-skill":
    case "install-local":
      return "installToUserRoot"
    case "update-from-local":
      return "updateWritableInstallation"
    case "update-entry-content":
      return "editLocal"
  }
}
