import type { OperationPlanDto, OperationRequestDto } from "@forge/contracts"
import {
  canonicalPath,
  observed,
  unknownEvidence,
  type CanonicalPath,
  type EffectiveSkill,
  type ScopeBinding,
  type SkillSnapshot,
  type SourceRoot,
  type ValidationFinding,
} from "@forge/domain"
import type { ApprovedRootPolicy } from "@forge/scanner"

import {
  ADAPTER_CAPABILITY_NAMES,
  capabilityForOperationKind,
  defineAdapterCapabilities,
  type AdapterCapabilities,
  type AdapterOperationPlanningResult,
  type AdapterOperationRequest,
  type BindingInput,
  type CapabilityEvidence,
  type DiscoveryContext,
  type InstallationObservation,
  type ResolutionInput,
  type RootCandidate,
  type SkillObservation,
  type SkillRuntimeAdapter,
} from "../src/index.js"

export const NOW = "2026-08-26T12:00:00.000Z"
export const LATER = "2026-08-26T12:15:00.000Z"
export const HASH = "a".repeat(64)
export const OTHER_HASH = "b".repeat(64)
export const TOKEN = "selection_token_abcdefghijklmnopqrstuvwxyz_0123456789"

export function capabilities(
  overrides: Partial<AdapterCapabilities> = {},
): AdapterCapabilities {
  return defineAdapterCapabilities({
    discoverGlobalRoots: "supported",
    discoverProjectRoots: "unsupported",
    parseSkill: "supported",
    enumerateResources: "supported",
    resolvePrecedence: "unknown",
    observeRuntimeState: "unsupported",
    installToUserRoot: "supported",
    updateWritableInstallation: "unsupported",
    editLocal: "unknown",
    declaredVersions: "unknown",
    sourceProvenance: "unknown",
    updateDiscovery: "unknown",
    dependencies: "unsupported",
    permissionDeclarations: "unsupported",
    triggerTelemetry: "unsupported",
    usageTelemetry: "unsupported",
    ...overrides,
  })
}

export function capabilityEvidence(
  declared: AdapterCapabilities,
): readonly CapabilityEvidence[] {
  return ADAPTER_CAPABILITY_NAMES.map((capability) => ({
    capability,
    state: declared[capability],
    evidence:
      declared[capability] === "unknown"
        ? [unknownEvidence({ source: `fake:${capability}` })]
        : [observed({ source: `fake:${capability}` })],
  }))
}

export const root: SourceRoot = {
  id: "root_user",
  adapterId: "fake",
  canonicalPath: canonicalPath("/home/example/.agents/skills"),
  kind: "global",
  access: "read-write",
  discovery: observed({ source: "fake-fixture" }),
}

export const rootPolicy: ApprovedRootPolicy = {
  authorizeRead(_rootId: string, candidate: string): Promise<CanonicalPath> {
    return Promise.resolve(canonicalPath(candidate))
  },
  authorizeWrite(_rootId: string, candidate: string): Promise<CanonicalPath> {
    return Promise.resolve(canonicalPath(candidate))
  },
  getApprovedRoots() {
    return []
  },
}

export const discoveryContext: DiscoveryContext = {
  homeDirectory: canonicalPath("/home/example"),
  workingDirectory: canonicalPath("/workspace/project"),
  projects: [],
}

export function operationRequest(kind: OperationRequestDto["kind"]): AdapterOperationRequest {
  const request: OperationRequestDto =
    kind === "install-local"
      ? {
          kind,
          source: { kind: "directory", selectionToken: TOKEN, treeHash: HASH },
          targetRootId: root.id,
        }
      : kind === "update-from-local"
        ? {
            kind,
            installationId: "installation_alpha",
            expectedSnapshotId: "snapshot_alpha",
            source: { kind: "directory", selectionToken: TOKEN, treeHash: HASH },
          }
        : {
            kind,
            installationId: "installation_alpha",
            expectedSnapshotId: "snapshot_alpha",
            content: "---\nname: alpha\ndescription: changed\n---\n",
          }

  return { request, targetRoot: root, rootPolicy }
}

function operationPlan(request: AdapterOperationRequest): OperationPlanDto {
  return {
    planId: `plan_${request.request.kind}`,
    kind: request.request.kind,
    status: "planned",
    createdAt: NOW,
    expiresAt: LATER,
    adapterId: "fake",
    installationIds:
      request.request.kind === "install-local"
        ? []
        : [request.request.installationId],
    targetRootId: request.targetRoot.id,
    affectedScopes: [{ kind: "global" }],
    affectedEntries: [
      {
        action: request.request.kind === "install-local" ? "create" : "modify",
        rootId: request.targetRoot.id,
        relativePath: "alpha/SKILL.md",
      },
    ],
    preconditions: [],
    conflicts: [],
    warnings: [],
    undo: "persistent",
    summary: "Fixture operation plan",
  }
}

type Planner = (
  request: AdapterOperationRequest,
  adapter: FakeAdapter,
) => AdapterOperationPlanningResult | Promise<AdapterOperationPlanningResult>

export class FakeAdapter implements SkillRuntimeAdapter {
  readonly id = "fake"
  readonly displayName = "Fake adapter"
  readonly declared: AdapterCapabilities
  readonly roots: readonly RootCandidate[]
  readonly evidence: readonly CapabilityEvidence[]
  readonly planner: Planner | undefined

  constructor(options: {
    readonly capabilities?: AdapterCapabilities
    readonly roots?: readonly RootCandidate[]
    readonly evidence?: readonly CapabilityEvidence[]
    readonly planner?: Planner
  } = {}) {
    this.declared = options.capabilities ?? capabilities()
    this.roots = options.roots ?? [
      {
        candidateId: "candidate_user",
        adapterId: this.id,
        canonicalPath: root.canonicalPath,
        kind: "global",
        access: "read-write",
        writableWithoutElevation: true,
        evidence: observed({ source: "fake-fixture" }),
        defaultIncluded: true,
      },
    ]
    this.evidence = options.evidence ?? capabilityEvidence(this.declared)
    this.planner = options.planner
  }

  capabilities(): Promise<AdapterCapabilities> {
    return Promise.resolve(this.declared)
  }

  capabilityEvidence(): Promise<readonly CapabilityEvidence[]> {
    return Promise.resolve(this.evidence)
  }

  discoverRoots(_context: DiscoveryContext): Promise<readonly RootCandidate[]> {
    void _context
    return Promise.resolve(this.roots)
  }

  scanRoot(_root: SourceRoot): AsyncIterable<InstallationObservation> {
    void _root
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }
  }

  parseInstallation(_path: CanonicalPath): Promise<SkillObservation> {
    void _path
    return Promise.reject(new Error("Not exercised by the admission fixture"))
  }

  validate(_snapshot: SkillSnapshot): Promise<readonly ValidationFinding[]> {
    void _snapshot
    return Promise.resolve([])
  }

  resolveScope(_input: ResolutionInput): Promise<readonly EffectiveSkill[]> {
    void _input
    return Promise.resolve([])
  }

  describeBinding(_input: BindingInput): Promise<ScopeBinding> {
    void _input
    return Promise.reject(new Error("Not exercised by the admission fixture"))
  }

  planOperation(request: AdapterOperationRequest): Promise<AdapterOperationPlanningResult> {
    if (this.planner !== undefined) {
      return Promise.resolve(this.planner(request, this))
    }

    const capability = capabilityForOperationKind(request.request.kind)
    const state = this.declared[capability]
    if (state !== "supported") {
      return Promise.resolve({
        status: "unavailable",
        capability,
        capabilityState: state,
        reason: `Fixture capability is ${state}`,
        evidence:
          state === "unknown"
            ? unknownEvidence({ source: "fake-planner" })
            : observed({ source: "fake-planner" }),
      })
    }

    const kind = request.request.kind === "update-entry-content" ? "replace-entry" : request.request.kind === "install-local" ? "create-installation" : "replace-installation"
    const step =
      kind === "create-installation"
        ? { kind, rootId: root.id, relativePath: "alpha", sourceTreeHash: HASH } as const
        : kind === "replace-installation"
          ? { kind, rootId: root.id, relativePath: "alpha", expectedBeforeHash: OTHER_HASH, sourceTreeHash: HASH } as const
          : { kind, rootId: root.id, relativePath: "alpha/SKILL.md", expectedBeforeHash: OTHER_HASH, contentHash: HASH } as const

    return Promise.resolve({
      status: "planned",
      plan: {
        operation: operationPlan(request),
        capability,
        steps: [step],
        postconditions: [
          {
            kind: kind === "replace-entry" ? "entry-hash-equals" : "tree-hash-equals",
            rootId: root.id,
            relativePath: kind === "replace-entry" ? "alpha/SKILL.md" : "alpha",
            expectedHash: HASH,
          },
        ],
      },
    })
  }
}
