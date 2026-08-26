import { createHash } from "node:crypto"
import { lstat, opendir } from "node:fs/promises"
import path from "node:path"

import {
  capabilityForOperationKind,
  type AdapterCapabilities,
  type AdapterOperationPlan,
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
  type InstallationScope,
  type ScopeBinding,
  type SkillInstallation,
  type SkillSnapshot,
  type SourceRoot,
  type TargetScope,
  type ValidationFinding,
} from "@forge/domain"
import {
  hashDirectorySource,
  hashFile,
  validatePortableRelativePath,
  validateSkillDirectory,
  type LocalSourceManifestV1,
  type ScannerFinding,
} from "@forge/scanner"

import {
  FOLDER_ADAPTER_CAPABILITIES,
  FOLDER_ADAPTER_CAPABILITY_EVIDENCE,
} from "./capabilities.js"
import {
  FolderAdapterError,
  type FolderAdapterOptions,
  type FolderRootConfiguration,
} from "./types.js"

const ADAPTER_ID = "folder"
const PLAN_TTL_MS = 15 * 60 * 1_000

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function opaqueId(prefix: string, value: string): string {
  return `${prefix}_${digest(value).slice(0, 32)}`
}

function isAbsolute(candidate: string): boolean {
  return path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate)
}

function assertConfiguration(configuration: FolderRootConfiguration): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(configuration.candidateId)) {
    throw new TypeError("Folder root candidateId must be an opaque identifier")
  }
  if (!isAbsolute(configuration.canonicalPath) || configuration.canonicalPath.includes("\0")) {
    throw new TypeError("Folder root path must be an absolute canonical path")
  }
  if (configuration.writableWithoutElevation && configuration.access !== "read-write") {
    throw new TypeError("A writable folder root must have read-write access")
  }
  if (configuration.scope.kind === "project") {
    if (configuration.scope.projectId.length === 0 || !isAbsolute(configuration.scope.projectPath)) {
      throw new TypeError("A project folder root requires an opaque project ID and absolute project path")
    }
  }
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right)
}

function scopeFromRoot(root: SourceRoot): InstallationScope {
  switch (root.kind) {
    case "project":
      if (root.projectId === undefined) {
        throw new FolderAdapterError("ROOT_SCOPE_INVALID", "A project root must include its approved project ID")
      }
      return { projectId: root.projectId }
    case "managed":
      return "managed"
    case "system":
      return "system"
    case "global":
    case "user-added":
      return "global"
  }
}

function scopeRef(root: SourceRoot): OperationPlanDto["affectedScopes"][number] {
  const scope = scopeFromRoot(root)
  return typeof scope === "string"
    ? { kind: "global" }
    : { kind: "project", projectId: scope.projectId }
}

function findingFile(root: string, candidate?: string): CanonicalPath | undefined {
  if (candidate === undefined) return undefined
  return canonicalPath(path.isAbsolute(candidate) ? candidate : path.join(root, candidate))
}

function domainFindings(root: string, findings: readonly ScannerFinding[]): readonly ValidationFinding[] {
  return findings.map((finding) => {
    const file = findingFile(root, finding.path)
    return {
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      ...(file === undefined ? {} : { file }),
      source: { adapterId: ADAPTER_ID },
    }
  })
}

function targetMatchesInstallation(scope: InstallationScope, target: TargetScope): boolean {
  if (scope === "global") return target === "global"
  if (typeof scope === "object" && typeof target === "object") {
    return scope.projectId === target.projectId
  }
  return false
}

function relativeWithin(root: SourceRoot, candidate: string): string {
  const relative = path.relative(root.canonicalPath, candidate).split(path.sep).join("/")
  const portable = validatePortableRelativePath(relative)
  if (relative.length === 0 || portable.normalized === undefined) {
    throw new FolderAdapterError(
      "INSTALLATION_OUTSIDE_ROOT",
      "The installation path must be a child of its approved root",
    )
  }
  return portable.normalized
}

function sourceManifest(
  manifest: LocalSourceManifestV1 | undefined,
  expectedTreeHash: string,
): LocalSourceManifestV1 {
  if (manifest === undefined) {
    throw new FolderAdapterError("SOURCE_MANIFEST_REQUIRED", "A verified local source manifest is required")
  }
  if (manifest.treeHash !== expectedTreeHash) {
    throw new FolderAdapterError("SOURCE_HASH_MISMATCH", "The selected source no longer matches its verified hash")
  }
  if (!manifest.files.some((file) => file.path === "SKILL.md")) {
    throw new FolderAdapterError("SOURCE_ENTRY_MISSING", "The selected source has no root SKILL.md")
  }
  return manifest
}

function installationFor(request: AdapterOperationRequest): SkillInstallation {
  const installation = request.installation
  if (installation === undefined) {
    throw new FolderAdapterError("INSTALLATION_REQUIRED", "This operation requires an installation")
  }
  if (installation.rootId !== request.targetRoot.id) {
    throw new FolderAdapterError("INSTALLATION_ROOT_MISMATCH", "The installation is not owned by the target root")
  }
  if (installation.access !== "read-write") {
    throw new FolderAdapterError("INSTALLATION_NOT_WRITABLE", "The installation is read-only")
  }
  if (
    request.request.kind !== "install-local" &&
    installation.snapshotId !== request.request.expectedSnapshotId
  ) {
    throw new FolderAdapterError("SNAPSHOT_STALE", "The installation changed after the edit or update was requested")
  }
  return installation
}

export class FolderAdapter implements SkillRuntimeAdapter {
  readonly id = ADAPTER_ID
  readonly displayName = "Agent Skills folder"
  readonly #roots: readonly FolderRootConfiguration[]
  readonly #now: () => Date

  constructor(options: FolderAdapterOptions) {
    const ids = new Set<string>()
    const paths = new Set<string>()
    for (const root of options.roots) {
      assertConfiguration(root)
      if (ids.has(root.candidateId)) throw new TypeError(`Duplicate folder root ID: ${root.candidateId}`)
      const resolved = path.resolve(root.canonicalPath)
      if (paths.has(resolved)) throw new TypeError(`Duplicate folder root path: ${root.canonicalPath}`)
      ids.add(root.candidateId)
      paths.add(resolved)
    }
    this.#roots = Object.freeze([...options.roots])
    this.#now = options.now ?? (() => new Date())
  }

  capabilities(): Promise<AdapterCapabilities> {
    return Promise.resolve(FOLDER_ADAPTER_CAPABILITIES)
  }

  capabilityEvidence(): Promise<readonly CapabilityEvidence[]> {
    return Promise.resolve(FOLDER_ADAPTER_CAPABILITY_EVIDENCE)
  }

  discoverRoots(_context: DiscoveryContext): Promise<readonly RootCandidate[]> {
    void _context
    return Promise.resolve(this.#roots.map((configuration) => ({
      candidateId: configuration.candidateId,
      adapterId: this.id,
      canonicalPath: configuration.canonicalPath,
      kind: configuration.scope.kind,
      ...(configuration.scope.kind === "project"
        ? { projectPath: configuration.scope.projectPath }
        : {}),
      access: configuration.access,
      writableWithoutElevation: configuration.writableWithoutElevation,
      evidence: observed({ source: "explicit-folder-configuration" }),
      defaultIncluded: configuration.defaultIncluded ?? false,
    })))
  }

  async *scanRoot(root: SourceRoot): AsyncIterable<InstallationObservation> {
    this.#configuredRoot(root)
    let handle
    try {
      handle = await opendir(root.canonicalPath)
      for await (const entry of handle) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const installationPath = canonicalPath(path.join(root.canonicalPath, entry.name))
        yield await this.#observeInstallation(root, installationPath)
      }
    } catch (error) {
      throw new FolderAdapterError("ROOT_NOT_CONFIGURED", "The configured folder root could not be scanned", { cause: error })
    }
  }

  async parseInstallation(installationPath: CanonicalPath): Promise<SkillObservation> {
    const validation = await validateSkillDirectory(installationPath)
    return {
      canonicalPath: canonicalPath(validation.root),
      entryFile: canonicalPath(path.join(validation.root, "SKILL.md")),
      parsed: validation.parsed ?? {
        rawSource: "",
        rawBody: "",
        fields: [],
        findings: [{
          code: "SKILL_ENTRY_MISSING",
          severity: "error",
          message: "Selected folder has no root SKILL.md",
        }],
      },
      validation,
    }
  }

  validate(snapshot: SkillSnapshot): Promise<readonly ValidationFinding[]> {
    return Promise.resolve(snapshot.findings)
  }

  resolveScope(input: ResolutionInput) {
    return Promise.resolve([
      resolveEffectiveSkill({
        adapterId: this.id,
        targetScope: input.targetScope,
        key: input.key,
        candidateInstallationIds: input.candidates.map(({ id }) => id),
        semantics: "unsupported",
      }),
    ])
  }

  describeBinding(input: BindingInput): Promise<ScopeBinding> {
    const owned = targetMatchesInstallation(input.installation.scope, input.targetScope)
    return Promise.resolve({
      installationId: input.installation.id,
      targetScope: input.targetScope,
      relationship: owned ? "owned" : "unavailable",
      runtimeState: "unsupported",
      evidence: owned
        ? derived({ source: "approved-folder-root-scope" })
        : unknownEvidence({ source: "folder-convention-runtime-visibility" }),
    })
  }

  async planOperation(request: AdapterOperationRequest): Promise<AdapterOperationPlanningResult> {
    const capability = capabilityForOperationKind(request.request.kind)
    this.#writableRoot(request.targetRoot)

    switch (request.request.kind) {
      case "install-local":
        return { status: "planned", plan: await this.#planInstall(request) }
      case "update-from-local":
        return { status: "planned", plan: await this.#planSourceUpdate(request) }
      case "update-entry-content":
        return { status: "planned", plan: await this.#planContentUpdate(request) }
      default:
        return {
          status: "unavailable",
          capability,
          capabilityState: "unknown",
          reason: "Unknown operation kind",
          evidence: unknownEvidence({ source: "folder-operation" }),
        }
    }
  }

  #configuredRoot(root: SourceRoot): FolderRootConfiguration {
    if (root.adapterId !== this.id) {
      throw new FolderAdapterError("ROOT_ADAPTER_MISMATCH", "The approved root belongs to a different adapter")
    }
    const configured = this.#roots.find((candidate) => samePath(candidate.canonicalPath, root.canonicalPath))
    if (configured === undefined) {
      throw new FolderAdapterError("ROOT_NOT_CONFIGURED", "Folder roots must be explicitly configured before use")
    }
    if (
      (configured.scope.kind === "project") !== (root.kind === "project") ||
      (configured.scope.kind === "project" && configured.scope.projectId !== root.projectId)
    ) {
      throw new FolderAdapterError("ROOT_SCOPE_INVALID", "The approved root scope differs from its explicit configuration")
    }
    return configured
  }

  #writableRoot(root: SourceRoot): FolderRootConfiguration {
    const configured = this.#configuredRoot(root)
    if (
      root.access !== "read-write" ||
      !configured.writableWithoutElevation ||
      configured.access !== "read-write" ||
      root.kind === "managed" ||
      root.kind === "system"
    ) {
      throw new FolderAdapterError("ROOT_NOT_WRITABLE", "Folder operations require a user-writable root without elevation")
    }
    return configured
  }

  async #observeInstallation(root: SourceRoot, installationPath: CanonicalPath): Promise<InstallationObservation> {
    const observation = await this.parseInstallation(installationPath)
    const hashResult = await hashDirectorySource(installationPath)
    const contentHash = hashResult.manifest?.treeHash ?? digest(JSON.stringify({
      path: installationPath,
      findings: observation.validation.findings,
    }))
    const installationId = opaqueId("installation", canonicalInstallationIdentity({
      adapterId: this.id,
      canonicalPath: observation.canonicalPath,
    }))
    const snapshotId = opaqueId("snapshot", `${installationId}:${contentHash}`)
    const provenanceId = opaqueId("provenance", `${installationId}:local-user`)
    const observedAt = this.#now().toISOString()
    const findings = domainFindings(observation.canonicalPath, observation.validation.findings)
    const snapshot: SkillSnapshot = {
      id: snapshotId,
      installationId,
      contentHash,
      observedAt,
      name: observation.parsed.name === undefined
        ? unknown({ source: "SKILL.md:frontmatter" })
        : evidenced(observation.parsed.name, observed({ source: "SKILL.md:frontmatter", observedAt })),
      description: observation.parsed.description === undefined
        ? unknown({ source: "SKILL.md:frontmatter" })
        : evidenced(observation.parsed.description, observed({ source: "SKILL.md:frontmatter", observedAt })),
      declaredVersion: unknown({ source: "agent-skills-folder-convention" }),
      files: (hashResult.manifest?.files ?? []).map((file) => ({
        canonicalPath: canonicalPath(path.join(observation.canonicalPath, file.path)),
        contentHash: file.sha256,
        size: file.byteLength,
      })),
      requirements: [],
      findings,
      rawSource: observation.parsed.rawSource,
    }
    const installation: SkillInstallation = {
      id: installationId,
      adapterId: this.id,
      rootId: root.id,
      canonicalPath: observation.canonicalPath,
      entryFile: observation.entryFile,
      scope: scopeFromRoot(root),
      snapshotId,
      provenanceId,
      access: root.access === "read-write" && root.kind !== "managed" && root.kind !== "system"
        ? "read-write"
        : "read-only",
    }
    return {
      installation,
      snapshot,
      provenanceId,
      provenance: { kind: "local", managedBy: "user", installedHash: contentHash },
      observedScope: installation.scope,
      evidence: observed({ source: "approved-folder-root", observedAt }),
    }
  }

  #operationBase(request: AdapterOperationRequest, relativePath: string, action: "create" | "modify"): OperationPlanDto {
    const createdAt = this.#now()
    const installationId = request.request.kind === "install-local" ? undefined : request.request.installationId
    return {
      planId: opaqueId("plan", `${request.request.kind}:${request.targetRoot.id}:${relativePath}:${createdAt.toISOString()}`),
      kind: request.request.kind,
      status: "planned",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
      adapterId: this.id,
      installationIds: installationId === undefined ? [] : [installationId],
      targetRootId: request.targetRoot.id,
      affectedScopes: [scopeRef(request.targetRoot)],
      affectedEntries: [{
        action,
        rootId: request.targetRoot.id,
        ...(installationId === undefined ? {} : { installationId }),
        relativePath,
      }],
      preconditions: [],
      conflicts: [],
      warnings: [],
      undo: "persistent",
      summary: action === "create" ? `Install skill at ${relativePath}` : `Update skill at ${relativePath}`,
    }
  }

  async #planInstall(request: AdapterOperationRequest): Promise<AdapterOperationPlan> {
    if (request.request.kind !== "install-local") throw new TypeError("Expected install request")
    const manifest = sourceManifest(request.sourceManifest, request.request.source.treeHash)
    const relativePath = request.request.source.suggestedName ?? `skill-${manifest.treeHash.slice(0, 12)}`
    const destination = await request.rootPolicy.authorizeWrite(request.targetRoot.id, relativePath)
    try {
      await lstat(destination)
      throw new FolderAdapterError("DESTINATION_COLLISION", "The installation destination already exists")
    } catch (error) {
      if (error instanceof FolderAdapterError) throw error
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error
    }
    return {
      operation: this.#operationBase(request, relativePath, "create"),
      capability: "installToUserRoot",
      steps: [{
        kind: "create-installation",
        rootId: request.targetRoot.id,
        relativePath,
        sourceTreeHash: manifest.treeHash,
      }],
      postconditions: [{
        kind: "tree-hash-equals",
        rootId: request.targetRoot.id,
        relativePath,
        expectedHash: manifest.treeHash,
      }],
    }
  }

  async #planSourceUpdate(request: AdapterOperationRequest): Promise<AdapterOperationPlan> {
    if (request.request.kind !== "update-from-local") throw new TypeError("Expected source update request")
    const manifest = sourceManifest(request.sourceManifest, request.sourceManifest?.treeHash ?? "")
    const installation = installationFor(request)
    const relativePath = relativeWithin(request.targetRoot, installation.canonicalPath)
    const authorized = await request.rootPolicy.authorizeWrite(request.targetRoot.id, relativePath)
    const current = await hashDirectorySource(authorized)
    if (current.manifest === undefined) {
      throw new FolderAdapterError("INSTALLATION_NOT_WRITABLE", "The current installation could not be verified")
    }
    return {
      operation: this.#operationBase(request, relativePath, "modify"),
      capability: "updateWritableInstallation",
      steps: [{
        kind: "replace-installation",
        rootId: request.targetRoot.id,
        relativePath,
        expectedBeforeHash: current.manifest.treeHash,
        sourceTreeHash: manifest.treeHash,
      }],
      postconditions: [{
        kind: "tree-hash-equals",
        rootId: request.targetRoot.id,
        relativePath,
        expectedHash: manifest.treeHash,
      }],
    }
  }

  async #planContentUpdate(request: AdapterOperationRequest): Promise<AdapterOperationPlan> {
    if (request.request.kind !== "update-entry-content") throw new TypeError("Expected content update request")
    const installation = installationFor(request)
    const relativePath = relativeWithin(request.targetRoot, installation.entryFile)
    const authorized = await request.rootPolicy.authorizeWrite(request.targetRoot.id, relativePath)
    const current = await hashFile(authorized)
    const contentHash = digest(request.request.content)
    return {
      operation: this.#operationBase(request, relativePath, "modify"),
      capability: "editLocal",
      steps: [{
        kind: "replace-entry",
        rootId: request.targetRoot.id,
        relativePath,
        expectedBeforeHash: current.sha256,
        contentHash,
      }],
      postconditions: [{
        kind: "entry-hash-equals",
        rootId: request.targetRoot.id,
        relativePath,
        expectedHash: contentHash,
      }],
    }
  }
}
