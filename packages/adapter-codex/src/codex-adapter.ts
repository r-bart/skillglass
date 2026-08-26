import { createHash } from "node:crypto"
import { access, lstat, opendir, realpath } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"

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
} from "@forge/adapter-api"
import type { OperationPlanDto } from "@forge/contracts"
import {
  canonicalInstallationIdentity,
  canonicalPath,
  derived,
  evidenced,
  observed,
  resolveEffectiveSkill,
  unknown,
  unknownEvidence,
  type CanonicalPath,
  type Evidence,
  type InstallationScope,
  type ScopeBinding,
  type SkillInstallation,
  type SkillSnapshot,
  type SourceRoot,
  type ValidationFinding,
} from "@forge/domain"
import {
  hashDirectorySource,
  isPathContained,
  parseSkillSource,
  validateSkillDirectory,
} from "@forge/scanner"

import { readDisabledSkillEntries } from "./config.js"

const DOCUMENTATION_SOURCE = "https://learn.chatgpt.com/docs/build-skills"
const HASH_PATTERN = /^[a-f0-9]{64}$/u

const CAPABILITIES = defineAdapterCapabilities({
  discoverGlobalRoots: "supported",
  discoverProjectRoots: "supported",
  parseSkill: "supported",
  enumerateResources: "supported",
  resolvePrecedence: "supported",
  observeRuntimeState: "read-only",
  installToUserRoot: "supported",
  updateWritableInstallation: "supported",
  editLocal: "supported",
  declaredVersions: "unknown",
  sourceProvenance: "unknown",
  updateDiscovery: "unknown",
  dependencies: "supported",
  permissionDeclarations: "unsupported",
  triggerTelemetry: "unknown",
  usageTelemetry: "unknown",
})

export interface CodexAdapterOptions {
  /** Testable ADMIN location; production defaults to the documented path. */
  readonly adminSkillsRoot?: string
  /** Optional override. Otherwise discovery derives it from the supplied home. */
  readonly configFile?: string
  readonly now?: () => Date
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function opaqueId(prefix: string, value: string): string {
  return `${prefix}:${sha256(value).slice(0, 24)}`
}

function evidenceFor(state: AdapterCapabilities[keyof AdapterCapabilities], capability: string): Evidence {
  const source = `${DOCUMENTATION_SOURCE}#${capability}`
  return state === "unknown" ? unknownEvidence({ source }) : observed({ source })
}

async function directoryInfo(candidate: string): Promise<
  | Readonly<{ canonical: CanonicalPath; writable: boolean }>
  | undefined
> {
  try {
    const stats = await lstat(candidate)
    if (!stats.isDirectory()) return undefined
    const canonical = canonicalPath(await realpath(candidate))
    let writable = true
    try {
      await access(canonical, fsConstants.W_OK)
    } catch {
      writable = false
    }
    return { canonical, writable }
  } catch {
    return undefined
  }
}

function projectContains(repositoryRoot: string, workingDirectory: string): boolean {
  const relative = path.relative(repositoryRoot, workingDirectory)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function scopeForRoot(root: SourceRoot): InstallationScope {
  if (root.kind === "project" && root.projectId !== undefined) {
    return { projectId: root.projectId }
  }
  if (root.kind === "system") return "system"
  if (root.kind === "managed") return "managed"
  return "global"
}

function domainFindings(
  installationPath: CanonicalPath,
  findings: readonly Readonly<{ code: string; severity: "warning" | "error"; message: string; path?: string }>[],
): readonly ValidationFinding[] {
  return findings.map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    ...(finding.path === undefined
      ? {}
      : { file: canonicalPath(path.resolve(installationPath, finding.path)) }),
    source: { adapterId: "codex" },
  }))
}

function expectedHash(snapshotId: string): string {
  const tail = snapshotId.startsWith("snapshot:") ? snapshotId.slice("snapshot:".length) : snapshotId
  return HASH_PATTERN.test(tail) ? tail : sha256(snapshotId)
}

function relativeDisplay(root: SourceRoot, candidate: string): string | undefined {
  const relative = path.relative(root.canonicalPath, candidate)
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return relative === "" ? "." : undefined
  }
  return relative.split(path.sep).join("/")
}

export class CodexAdapter implements SkillRuntimeAdapter {
  readonly id = "codex"
  readonly displayName = "Codex"
  readonly #adminSkillsRoot: string
  readonly #explicitConfigFile: string | undefined
  readonly #now: () => Date
  #discoveredConfigFile: string | undefined
  #writableAuthoringRoots = new Map<string, "global" | "project">()

  constructor(options: CodexAdapterOptions = {}) {
    this.#adminSkillsRoot = options.adminSkillsRoot ?? "/etc/codex/skills"
    this.#explicitConfigFile = options.configFile
    this.#now = options.now ?? (() => new Date())
  }

  capabilities(): Promise<AdapterCapabilities> {
    return Promise.resolve(CAPABILITIES)
  }

  capabilityEvidence(): Promise<readonly CapabilityEvidence[]> {
    return Promise.resolve(ADAPTER_CAPABILITY_NAMES.map((capability) => ({
      capability,
      state: CAPABILITIES[capability],
      evidence: [evidenceFor(CAPABILITIES[capability], capability)],
      note:
        capability === "observeRuntimeState"
          ? "Only an exact configured-disabled entry is observable; every other state is unknown."
          : undefined,
    })).map(({ note, ...item }) => note === undefined ? item : { ...item, note }))
  }

  async discoverRoots(context: DiscoveryContext): Promise<readonly RootCandidate[]> {
    this.#discoveredConfigFile = this.#explicitConfigFile ?? path.join(context.homeDirectory, ".codex", "config.toml")
    this.#writableAuthoringRoots = new Map()
    const candidates: RootCandidate[] = []
    const physicalRoots = new Set<string>()
    const add = async (
      candidate: string,
      kind: "global" | "project" | "system",
      order: number,
      projectPath?: CanonicalPath,
    ): Promise<void> => {
      const info = await directoryInfo(candidate)
      if (info === undefined || physicalRoots.has(info.canonical)) return
      physicalRoots.add(info.canonical)
      const admin = kind === "system"
      candidates.push({
        candidateId: opaqueId("codex-root", `${kind}:${info.canonical}`),
        adapterId: this.id,
        canonicalPath: info.canonical,
        kind,
        ...(projectPath === undefined ? {} : { projectPath }),
        access: admin || !info.writable ? "read-only" : "read-write",
        writableWithoutElevation: !admin && info.writable,
        evidence: observed({ source: `${DOCUMENTATION_SOURCE}#root-${order}` }),
        defaultIncluded: true,
      })
      if (!admin && info.writable) this.#writableAuthoringRoots.set(info.canonical, kind)
    }

    let order = 0
    if (context.repositoryRoot !== undefined && projectContains(context.repositoryRoot, context.workingDirectory)) {
      let cursor = context.workingDirectory
      while (true) {
        await add(path.join(cursor, ".agents", "skills"), "project", order, context.repositoryRoot)
        order += 1
        if (cursor === context.repositoryRoot) break
        const parent = path.dirname(cursor)
        if (parent === cursor || !projectContains(context.repositoryRoot, parent)) break
        cursor = parent as CanonicalPath
      }
    }
    await add(path.join(context.homeDirectory, ".agents", "skills"), "global", order)
    order += 1
    await add(this.#adminSkillsRoot, "system", order)
    return candidates
  }

  async *scanRoot(root: SourceRoot): AsyncIterable<InstallationObservation> {
    if (root.adapterId !== this.id) return
    let canonicalRoot: string
    try {
      canonicalRoot = await realpath(root.canonicalPath)
    } catch {
      return
    }
    const entries = []
    try {
      const directory = await opendir(canonicalRoot)
      for await (const entry of directory) entries.push(entry)
    } catch {
      return
    }
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))
    const seenTargets = new Set<string>()
    for (const entry of entries) {
      const logicalPath = path.join(canonicalRoot, entry.name)
      let target: string
      try {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        target = await realpath(logicalPath)
        const stats = await lstat(target)
        if (!stats.isDirectory() || !isPathContained(canonicalRoot, target) || seenTargets.has(target)) continue
      } catch {
        continue
      }
      seenTargets.add(target)
      yield await this.#observeInstallation(root, canonicalPath(target))
    }
  }

  async parseInstallation(installationPath: CanonicalPath): Promise<SkillObservation> {
    const stats = await lstat(installationPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new TypeError("Codex installation parsing requires a physical directory")
    }
    const canonical = canonicalPath(await realpath(installationPath))
    const validation = await validateSkillDirectory(canonical)
    return {
      canonicalPath: canonical,
      entryFile: canonicalPath(path.join(canonical, "SKILL.md")),
      parsed: validation.parsed ?? parseSkillSource(""),
      validation,
    }
  }

  validate(snapshot: SkillSnapshot): Promise<readonly ValidationFinding[]> {
    return Promise.resolve(snapshot.findings.filter((finding) =>
      typeof finding.source !== "string" && finding.source.adapterId === this.id,
    ))
  }

  resolveScope(input: ResolutionInput): Promise<readonly ReturnType<typeof resolveEffectiveSkill>[]> {
    return Promise.resolve([resolveEffectiveSkill({
      adapterId: this.id,
      targetScope: input.targetScope,
      key: input.key,
      candidateInstallationIds: input.candidates.map(({ id }) => id),
      semantics: "supported",
    })])
  }

  async describeBinding(input: BindingInput): Promise<ScopeBinding> {
    const disabled = await readDisabledSkillEntries(this.#discoveredConfigFile)
    const isDisabled = disabled.has(input.installation.entryFile)
    return {
      installationId: input.installation.id,
      targetScope: input.targetScope,
      relationship: "owned",
      runtimeState: isDisabled ? "disabled" : "unknown",
      evidence: isDisabled
        ? observed(this.#discoveredConfigFile === undefined ? {} : { source: this.#discoveredConfigFile })
        : unknownEvidence({ source: "Codex exposes no affirmative enabled-state observation" }),
    }
  }

  async planOperation(request: AdapterOperationRequest): Promise<AdapterOperationPlanningResult> {
    const capability = capabilityForOperationKind(request.request.kind)
    const unavailable = (reason: string, evidence: Evidence = observed({ source: "forge-writable-boundary" })): AdapterOperationPlanningResult => ({
      status: "unavailable",
      capability,
      capabilityState: "unsupported",
      reason,
      evidence,
    })

    if (request.targetRoot.adapterId !== this.id) return unavailable("The target root does not belong to Codex")
    if (
      (request.targetRoot.kind !== "global" && request.targetRoot.kind !== "project") ||
      request.targetRoot.access !== "read-write"
    ) return unavailable("Codex ADMIN, SYSTEM, managed, denied, and read-only roots are inventory-only")
    if (this.#writableAuthoringRoots.get(request.targetRoot.canonicalPath) !== request.targetRoot.kind) {
      return unavailable("The target is not a discovered Codex USER or REPO authoring root")
    }
    const approved = request.rootPolicy.getApprovedRoots().find((root) =>
      (root.rootId === request.targetRoot.id || root.aliasRootIds.includes(request.targetRoot.id)) &&
      root.canonicalPath === request.targetRoot.canonicalPath &&
      root.access === "read-write" && root.writableWithoutElevation &&
      root.kind !== "managed" && root.kind !== "system",
    )
    if (approved === undefined) return unavailable("The USER or REPO root is not approved and writable without elevation")

    try {
      await request.rootPolicy.authorizeWrite(request.targetRoot.id, ".")
    } catch {
      return unavailable("The USER or REPO root failed its non-elevated write authorization")
    }

    let relativePath: string
    let installationIds: readonly string[] = []
    let action: "create" | "modify"
    let expectedBefore: string | undefined
    let expectedAfter: string
    if (request.request.kind === "install-local") {
      relativePath = request.request.source.suggestedName ?? `skill-${request.request.source.treeHash.slice(0, 12)}`
      action = "create"
      expectedAfter = request.request.source.treeHash
      try {
        await request.rootPolicy.authorizeWrite(request.targetRoot.id, relativePath)
      } catch {
        return unavailable("The proposed installation destination is not safely writable")
      }
    } else {
      const installation = request.installation
      if (
        installation === undefined || installation.adapterId !== this.id ||
        installation.rootId !== request.targetRoot.id ||
        installation.snapshotId !== request.request.expectedSnapshotId ||
        installation.access !== "read-write"
      ) return unavailable("The installation is not a current writable Codex USER/REPO observation")
      const target = request.request.kind === "update-entry-content" ? installation.entryFile : installation.canonicalPath
      const relative = relativeDisplay(request.targetRoot, target)
      if (relative === undefined) return unavailable("The installation is outside the approved root")
      relativePath = relative
      action = "modify"
      installationIds = [installation.id]
      expectedBefore = expectedHash(request.request.expectedSnapshotId)
      expectedAfter = request.request.kind === "update-entry-content"
        ? sha256(request.request.content)
        : request.sourceManifest?.treeHash ?? sha256("missing-source-manifest")
      try {
        await request.rootPolicy.authorizeWrite(request.targetRoot.id, target)
      } catch {
        return unavailable("The installation path is no longer safely writable")
      }
    }

    const createdAt = this.#now()
    const expiresAt = new Date(createdAt.getTime() + 15 * 60 * 1_000)
    const operation: OperationPlanDto = {
      planId: opaqueId("codex-plan", `${request.request.kind}:${request.targetRoot.id}:${relativePath}:${createdAt.toISOString()}`),
      kind: request.request.kind,
      status: "planned",
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      adapterId: this.id,
      installationIds: [...installationIds],
      targetRootId: request.targetRoot.id,
      affectedScopes: request.targetRoot.kind === "project" && request.targetRoot.projectId !== undefined
        ? [{ kind: "project", projectId: request.targetRoot.projectId }]
        : [{ kind: "global" }],
      affectedEntries: [{ action, rootId: request.targetRoot.id, ...(installationIds[0] === undefined ? {} : { installationId: installationIds[0] }), relativePath }],
      preconditions: [], conflicts: [], warnings: [], undo: "persistent",
      summary: request.request.kind === "install-local" ? "Install local skill into an approved Codex authoring root" : "Update an approved writable Codex skill",
    }
    const step = request.request.kind === "install-local"
      ? { kind: "create-installation" as const, rootId: request.targetRoot.id, relativePath, sourceTreeHash: expectedAfter }
      : request.request.kind === "update-from-local"
        ? { kind: "replace-installation" as const, rootId: request.targetRoot.id, relativePath, expectedBeforeHash: expectedBefore ?? sha256("missing"), sourceTreeHash: expectedAfter }
        : { kind: "replace-entry" as const, rootId: request.targetRoot.id, relativePath, expectedBeforeHash: expectedBefore ?? sha256("missing"), contentHash: expectedAfter }
    return {
      status: "planned",
      plan: {
        operation,
        capability,
        steps: [step],
        postconditions: [{
          kind: request.request.kind === "update-entry-content" ? "entry-hash-equals" : "tree-hash-equals",
          rootId: request.targetRoot.id,
          relativePath,
          expectedHash: expectedAfter,
        }],
      },
    }
  }

  async #observeInstallation(root: SourceRoot, installationPath: CanonicalPath): Promise<InstallationObservation> {
    const observation = await this.parseInstallation(installationPath)
    const hashed = await hashDirectorySource(installationPath)
    const contentHash = hashed.manifest?.treeHash ?? sha256(`${installationPath}:${JSON.stringify(observation.validation.findings)}`)
    const installationId = opaqueId("codex-installation", canonicalInstallationIdentity({ adapterId: this.id, canonicalPath: installationPath }))
    const snapshotId = `snapshot:${contentHash}`
    const provenanceId = opaqueId("codex-provenance", installationPath)
    const observedAt = this.#now().toISOString()
    const findings = domainFindings(installationPath, observation.validation.findings)
    const snapshot: SkillSnapshot = {
      id: snapshotId,
      installationId,
      contentHash,
      observedAt,
      name: observation.parsed.name === undefined ? unknown({ source: observation.entryFile }) : evidenced(observation.parsed.name, observed({ source: observation.entryFile })),
      description: observation.parsed.description === undefined ? unknown({ source: observation.entryFile }) : evidenced(observation.parsed.description, observed({ source: observation.entryFile })),
      declaredVersion: unknown({ source: "Codex skill contract has no semantic version field" }),
      files: (hashed.manifest?.files ?? []).map((file) => ({ canonicalPath: canonicalPath(path.join(installationPath, file.path)), contentHash: file.sha256, size: file.byteLength })),
      requirements: [],
      findings,
      rawSource: observation.parsed.rawSource,
    }
    const installation: SkillInstallation = {
      id: installationId,
      adapterId: this.id,
      rootId: root.id,
      canonicalPath: installationPath,
      entryFile: observation.entryFile,
      scope: scopeForRoot(root),
      snapshotId,
      provenanceId,
      access: root.access === "read-write" && (root.kind === "global" || root.kind === "project") ? "read-write" : "read-only",
    }
    return {
      installation,
      snapshot,
      provenanceId,
      provenance: { kind: "unknown", managedBy: "unknown" },
      observedScope: installation.scope,
      evidence: derived({ source: `Codex documented root ${root.canonicalPath}` }),
    }
  }
}
