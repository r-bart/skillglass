import {
  ADAPTER_CAPABILITY_NAMES,
  defineAdapterCapabilities,
  type AdapterCapabilities,
  type CapabilityEvidence,
} from "@forge/adapter-api"
import { derived, observed, unknownEvidence } from "@forge/domain"

export const FOLDER_ADAPTER_CAPABILITIES: AdapterCapabilities = defineAdapterCapabilities({
  discoverGlobalRoots: "supported",
  discoverProjectRoots: "supported",
  parseSkill: "supported",
  enumerateResources: "supported",
  resolvePrecedence: "unsupported",
  observeRuntimeState: "unsupported",
  installToUserRoot: "supported",
  updateWritableInstallation: "supported",
  editLocal: "supported",
  declaredVersions: "unknown",
  sourceProvenance: "derived",
  updateDiscovery: "supported",
  dependencies: "unknown",
  permissionDeclarations: "unsupported",
  triggerTelemetry: "unsupported",
  usageTelemetry: "unsupported",
})

const NOTES: Readonly<Partial<Record<keyof AdapterCapabilities, string>>> = {
  discoverGlobalRoots: "Only roots explicitly configured by the user are returned.",
  discoverProjectRoots: "Project scope comes from the explicit root configuration.",
  resolvePrecedence: "The Agent Skills folder convention does not define host precedence.",
  observeRuntimeState: "A folder alone does not expose harness runtime state.",
  installToUserRoot: "Plans require an approved root writable without elevation.",
  updateWritableInstallation: "Plans require a writable installation and verified local content.",
  editLocal: "Plans target only the installation entry file under its approved root.",
  sourceProvenance: "A directly observed folder is local user-managed provenance.",
  updateDiscovery: "Forge-managed local provenance can be compared by content hash.",
}

export const FOLDER_ADAPTER_CAPABILITY_EVIDENCE: readonly CapabilityEvidence[] =
  ADAPTER_CAPABILITY_NAMES.map((capability) => {
    const state = FOLDER_ADAPTER_CAPABILITIES[capability]
    const source = `folder-convention:${capability}`
    return {
      capability,
      state,
      evidence: [
        state === "unknown"
          ? unknownEvidence({ source })
          : state === "derived"
            ? derived({ source })
            : observed({ source }),
      ],
      ...(NOTES[capability] === undefined ? {} : { note: NOTES[capability] }),
    }
  })
