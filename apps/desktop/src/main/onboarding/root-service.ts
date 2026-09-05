import { createHash } from "node:crypto"
import { access, lstat } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"

import type { DiscoveryContext, RootCandidate, SkillRuntimeAdapter } from "@forge/adapter-api"
import type {
  ApprovedRootDto,
  OnboardingStateDto,
  RootCandidateDto,
} from "@forge/contracts"
import {
  canonicalPath,
  observed,
  type CanonicalPath,
  type RootAccess,
  type SourceRoot,
} from "@forge/domain"
import { isPathContained, resolveCanonicalPath } from "@forge/scanner"

import type {
  RootApprovalDocument,
  RootApprovalSettingsRepository,
  StoredRootCandidate,
} from "./settings-repository.js"

const FOLDER_ADAPTER_ID = "folder"

export interface NativeRootPicker {
  selectDirectory(): Promise<string | null>
}

export interface NativeProjectPicker {
  /** Returns true only when the persisted project registry changed. */
  selectProject(): Promise<boolean>
}

export interface RootServiceOptions {
  readonly adapters: readonly SkillRuntimeAdapter[]
  readonly discoveryContext: DiscoveryContext | (() => DiscoveryContext)
  readonly settings: RootApprovalSettingsRepository
  readonly picker: NativeRootPicker
  readonly projectPicker?: NativeProjectPicker
  readonly onApprovalPersisted?: (roots: readonly SourceRoot[]) => Promise<void>
  readonly now?: () => Date
}

function opaqueId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`
}

function kindLabel(kind: StoredRootCandidate["kind"]): string {
  switch (kind) {
    case "global": return "Global"
    case "project": return "Proyecto"
    case "managed": return "Gestionada"
    case "system": return "Sistema"
    case "user-added": return "Añadida por ti"
  }
}

function dto(record: StoredRootCandidate): RootCandidateDto {
  return {
    candidateId: record.candidateId,
    adapterId: record.adapterId,
    displayName: candidateDisplayName(record),
    displayPath: record.displayPath,
    kind: record.kind,
    access: record.access,
    writableWithoutElevation: record.writableWithoutElevation,
    discovery: record.discovery,
  }
}

function candidateDisplayName(record: StoredRootCandidate): string {
  if (record.discovery.source === "compatible-codex-skills-folder") {
    return "Carpeta compatible con SKILL.md · Añadida por ti"
  }
  return `${record.adapterDisplayName} · ${kindLabel(record.kind)}`
}

function sourceRoot(record: StoredRootCandidate): SourceRoot {
  return {
    id: opaqueId("root", `${record.adapterId}:${record.canonicalPath}`),
    adapterId: record.adapterId,
    canonicalPath: canonicalPath(record.canonicalPath),
    kind: record.kind,
    ...(record.projectId === undefined ? {} : { projectId: record.projectId }),
    access: record.access,
    discovery: record.discovery,
  }
}

function approvedDto(record: StoredRootCandidate): ApprovedRootDto {
  const root = sourceRoot(record)
  return {
    rootId: root.id,
    adapterId: root.adapterId,
    displayName: candidateDisplayName(record),
    displayPath: record.displayPath,
    kind: root.kind,
    access: root.access,
    writableWithoutElevation: record.writableWithoutElevation,
    discovery: root.discovery,
  }
}

async function observedAccess(candidate: string, immutable: boolean): Promise<Readonly<{
  canonicalPath: CanonicalPath
  access: RootAccess
  writableWithoutElevation: boolean
}>> {
  const resolved = await resolveCanonicalPath(candidate)
  const stats = await lstat(resolved.canonicalPath)
  if (!stats.isDirectory()) throw new TypeError("The selected root must be a directory")
  try {
    await access(resolved.canonicalPath, fsConstants.R_OK)
  } catch {
    return { canonicalPath: resolved.canonicalPath, access: "denied", writableWithoutElevation: false }
  }
  if (immutable) return { canonicalPath: resolved.canonicalPath, access: "read-only", writableWithoutElevation: false }
  try {
    await access(resolved.canonicalPath, fsConstants.W_OK)
    return { canonicalPath: resolved.canonicalPath, access: "read-write", writableWithoutElevation: true }
  } catch {
    return { canonicalPath: resolved.canonicalPath, access: "read-only", writableWithoutElevation: false }
  }
}

function filesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function isManagedProviderFolder(homeDirectory: string, candidate: string): boolean {
  return isPathContained(path.join(homeDirectory, ".codex", "plugins"), candidate)
}

async function revalidateStoredCandidate(record: StoredRootCandidate): Promise<StoredRootCandidate> {
  try {
    const stats = await lstat(record.canonicalPath)
    if (!stats.isDirectory()) {
      return { ...record, access: "missing", writableWithoutElevation: false }
    }
  } catch (error) {
    const code = filesystemErrorCode(error)
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ...record, access: "missing", writableWithoutElevation: false }
    }
    if (code === "EACCES" || code === "EPERM") {
      return { ...record, access: "denied", writableWithoutElevation: false }
    }
    throw error
  }
  try {
    await access(record.canonicalPath, fsConstants.R_OK)
  } catch {
    return { ...record, access: "denied", writableWithoutElevation: false }
  }
  if (record.kind === "managed" || record.kind === "system") {
    return { ...record, access: "read-only", writableWithoutElevation: false }
  }
  try {
    await access(record.canonicalPath, fsConstants.W_OK)
    return { ...record, access: "read-write", writableWithoutElevation: true }
  } catch {
    return { ...record, access: "read-only", writableWithoutElevation: false }
  }
}

export class RootService {
  readonly #adapters: readonly SkillRuntimeAdapter[]
  readonly #adapterNames: ReadonlyMap<string, string>
  readonly #context: () => DiscoveryContext
  readonly #settings: RootApprovalSettingsRepository
  readonly #picker: NativeRootPicker
  readonly #projectPicker: NativeProjectPicker
  readonly #onApprovalPersisted: (roots: readonly SourceRoot[]) => Promise<void>
  readonly #now: () => Date
  #candidates = new Map<string, StoredRootCandidate>()
  #loaded = false
  #selected = new Set<string>()
  #persisted = false

  constructor(options: RootServiceOptions) {
    this.#adapters = options.adapters
    this.#adapterNames = new Map(options.adapters.map((adapter) => [adapter.id, adapter.displayName]))
    this.#context = typeof options.discoveryContext === "function"
      ? options.discoveryContext
      : () => options.discoveryContext as DiscoveryContext
    this.#settings = options.settings
    this.#picker = options.picker
    this.#projectPicker = options.projectPicker ?? { selectProject: () => Promise.resolve(false) }
    this.#onApprovalPersisted = options.onApprovalPersisted ?? (() => Promise.resolve())
    this.#now = options.now ?? (() => new Date())
  }

  async state(): Promise<OnboardingStateDto> {
    await this.#refresh()
    return this.#state()
  }

  async proposedRoots(): Promise<readonly RootCandidateDto[]> {
    return (await this.state()).proposedRoots
  }

  async selectAdditionalRoot(adapterId: string): Promise<RootCandidateDto | null> {
    await this.#refresh()
    if (adapterId !== FOLDER_ADAPTER_ID) throw new TypeError("Only the explicit folder adapter accepts native directory selection")
    const selected = await this.#picker.selectDirectory()
    if (selected === null) return null
    const canonicalHome = (await resolveCanonicalPath(this.#context().homeDirectory, { allowMissing: true })).canonicalPath
    const selectedCanonical = (await resolveCanonicalPath(selected)).canonicalPath
    const managed = isManagedProviderFolder(canonicalHome, selectedCanonical)
    const access = await observedAccess(selectedCanonical, managed)
    const existing = [...this.#candidates.values()].find(({ canonicalPath: candidate }) => candidate === access.canonicalPath)
    if (existing !== undefined) return dto(existing)
    const record: StoredRootCandidate = {
      candidateId: opaqueId("candidate", `${FOLDER_ADAPTER_ID}:${access.canonicalPath}`),
      adapterId: FOLDER_ADAPTER_ID,
      adapterDisplayName: this.#adapterNames.get(FOLDER_ADAPTER_ID) ?? "Agent Skills folder",
      canonicalPath: access.canonicalPath,
      displayPath: access.canonicalPath,
      kind: managed ? "managed" : "user-added",
      access: access.access,
      writableWithoutElevation: access.writableWithoutElevation,
      discovery: observed({ source: "native-directory-selection", observedAt: this.#now().toISOString() }),
      defaultIncluded: true,
    }
    this.#candidates.set(record.candidateId, record)
    this.#selected.add(record.candidateId)
    return dto(record)
  }

  async selectProject(): Promise<OnboardingStateDto> {
    await this.#refresh()
    await this.#projectPicker.selectProject()
    await this.#refresh()
    return this.#state()
  }

  async approveRoots(candidateIds: readonly string[]): Promise<readonly ApprovedRootDto[]> {
    await this.#refresh()
    if (candidateIds.length === 0 || new Set(candidateIds).size !== candidateIds.length) {
      throw new TypeError("At least one unique proposed root must be approved")
    }
    const records = candidateIds.map((candidateId) => {
      const record = this.#candidates.get(candidateId)
      if (record === undefined) throw new TypeError("Unknown or expired root candidate ID")
      return record
    })
    const updatedAt = this.#now().toISOString()
    const document: RootApprovalDocument = {
      version: 1,
      updatedAt,
      candidates: [...this.#candidates.values()],
      selectedCandidateIds: [...candidateIds],
    }
    this.#settings.save(document)
    this.#persisted = true
    this.#selected = new Set(candidateIds)
    const roots = records.map(sourceRoot)
    await this.#onApprovalPersisted(roots)
    return records.map(approvedDto)
  }

  async scanPersistedApproval(): Promise<boolean> {
    await this.#refresh()
    if (!this.#persisted || this.#selected.size === 0) return false
    await this.#onApprovalPersisted(this.#selectedRecords().map(sourceRoot))
    return true
  }

  approvedSourceRoots(): readonly SourceRoot[] {
    if (!this.#persisted) return []
    return this.#selectedRecords().map(sourceRoot)
  }

  async #refresh(): Promise<void> {
    if (!this.#loaded) {
      const document = this.#settings.load()
      if (document !== undefined) {
        this.#candidates = new Map(document.candidates.map((candidate) => [candidate.candidateId, candidate]))
        this.#selected = new Set(document.selectedCandidateIds)
        this.#persisted = document.selectedCandidateIds.length > 0
      }
      this.#loaded = true
    }

    const context = this.#context()
    const canonicalHome = (await resolveCanonicalPath(context.homeDirectory, { allowMissing: true })).canonicalPath
    for (const [candidateId, candidate] of this.#candidates) {
      const revalidated = await revalidateStoredCandidate(candidate)
      this.#candidates.set(candidateId,
        revalidated.adapterId === FOLDER_ADAPTER_ID && isManagedProviderFolder(canonicalHome, revalidated.canonicalPath)
          ? { ...revalidated, kind: "managed", access: "read-only", writableWithoutElevation: false }
          : revalidated,
      )
    }

    for (const adapter of this.#adapters) {
      const proposed = await adapter.discoverRoots(context)
      for (const candidate of proposed) {
        const duplicate = [...this.#candidates.values()].find((current) =>
          current.candidateId !== candidate.candidateId && current.canonicalPath === candidate.canonicalPath,
        )
        if (duplicate === undefined) this.#candidates.set(candidate.candidateId, this.#record(adapter, candidate, context))
      }
    }
    for (const candidate of this.#candidates.values()) {
      if (!this.#persisted && candidate.defaultIncluded) this.#selected.add(candidate.candidateId)
    }
  }

  #record(adapter: SkillRuntimeAdapter, candidate: RootCandidate, context: DiscoveryContext): StoredRootCandidate {
    const project = candidate.projectPath === undefined
      ? undefined
      : context.projects.find(({ canonicalPath: projectPath }) => projectPath === candidate.projectPath)
    return {
      candidateId: candidate.candidateId,
      adapterId: candidate.adapterId,
      adapterDisplayName: adapter.displayName,
      canonicalPath: candidate.canonicalPath,
      displayPath: candidate.canonicalPath,
      kind: candidate.kind,
      access: candidate.access,
      writableWithoutElevation: candidate.writableWithoutElevation,
      discovery: candidate.evidence,
      defaultIncluded: candidate.defaultIncluded,
      ...(candidate.projectPath === undefined ? {} : { projectPath: candidate.projectPath }),
      ...(project === undefined ? {} : { projectId: project.id }),
    }
  }

  #selectedRecords(): StoredRootCandidate[] {
    return [...this.#selected].flatMap((candidateId) => {
      const candidate = this.#candidates.get(candidateId)
      return candidate === undefined ? [] : [candidate]
    })
  }

  #state(): OnboardingStateDto {
    const proposedRoots = [...this.#candidates.values()].map(dto)
    return {
      status: this.#persisted && this.#selected.size > 0 ? "complete" : "required",
      proposedRoots,
      selectedCandidateIds: [...this.#selected].filter((candidateId) => this.#candidates.has(candidateId)),
      approvedRoots: this.#persisted ? this.#selectedRecords().map(approvedDto) : [],
    }
  }
}
