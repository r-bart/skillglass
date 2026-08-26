import { FolderAdapter, type FolderRootConfiguration } from "@forge/adapter-folder"
import type { InstallationObservation, SkillRuntimeAdapter } from "@forge/adapter-api"
import type { InventoryChangedEvent } from "@forge/contracts"
import {
  isEvidenced,
  type EffectiveSkill,
  type ProjectScope,
  type ScopeBinding,
  type SourceRoot,
  type TargetScope,
} from "@forge/domain"
import { ScanCoordinator, type ScanFinding } from "@forge/scanner"
import type { ForgeStore } from "@forge/storage"

import { auditE2eScan } from "../e2e-test-seam.js"

export interface ApprovedRootScanServiceOptions {
  readonly codexAdapter: SkillRuntimeAdapter
  readonly projects: readonly ProjectScope[] | (() => readonly ProjectScope[])
  readonly store: ForgeStore
  readonly onInventoryChanged?: (event: InventoryChangedEvent) => void
  readonly now?: () => Date
}

function folderConfiguration(root: SourceRoot, projects: readonly ProjectScope[]): FolderRootConfiguration {
  if (root.kind === "project") {
    const project = projects.find(({ id }) => id === root.projectId)
    if (project === undefined) throw new TypeError("An approved project root requires a known project")
    return {
      candidateId: root.id,
      canonicalPath: root.canonicalPath,
      scope: { kind: "project", projectId: project.id, projectPath: project.canonicalPath },
      access: root.access,
      writableWithoutElevation: root.access === "read-write",
    }
  }
  return {
    candidateId: root.id,
    canonicalPath: root.canonicalPath,
    scope: { kind: "global" },
    access: root.access,
    writableWithoutElevation: root.access === "read-write" && root.kind !== "managed" && root.kind !== "system",
  }
}

function observationKey(observation: InstallationObservation): string {
  if (isEvidenced(observation.snapshot.name)) return observation.snapshot.name.value
  return observation.installation.canonicalPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? observation.installation.id
}

export class ApprovedRootScanService {
  readonly #codexAdapter: SkillRuntimeAdapter
  readonly #projects: () => readonly ProjectScope[]
  readonly #store: ForgeStore
  readonly #onInventoryChanged: (event: InventoryChangedEvent) => void
  readonly #now: () => Date

  constructor(options: ApprovedRootScanServiceOptions) {
    this.#codexAdapter = options.codexAdapter
    this.#projects = typeof options.projects === "function"
      ? options.projects
      : () => options.projects as readonly ProjectScope[]
    this.#store = options.store
    this.#onInventoryChanged = options.onInventoryChanged ?? (() => undefined)
    this.#now = options.now ?? (() => new Date())
  }

  async scan(
    approvedRoots: readonly SourceRoot[],
    reason: InventoryChangedEvent["reason"] = "root-approval",
  ): Promise<void> {
    if (approvedRoots.length === 0) throw new TypeError("A persisted approval is required before scanning")
    auditE2eScan(approvedRoots)
    const projects = this.#projects()
    const folderRoots = approvedRoots.filter(({ adapterId }) => adapterId === "folder")
    const adapters: SkillRuntimeAdapter[] = [this.#codexAdapter]
    if (folderRoots.length > 0) {
      adapters.push(new FolderAdapter({ roots: folderRoots.map((root) => folderConfiguration(root, projects)) }))
    }
    const coordinator = new ScanCoordinator<InstallationObservation>({ adapters, approvedRoots })
    const observations: InstallationObservation[] = []
    const findings: ScanFinding[] = []
    for await (const event of coordinator.scan()) {
      if (event.kind === "observation") observations.push(event.observation)
      else if (event.kind === "finding") findings.push(event.finding)
    }
    for (const observation of observations) {
      if (this.#store.snapshots.get(observation.snapshot.id) === undefined) this.#store.snapshots.put(observation.snapshot)
      if (this.#store.snapshots.getProvenance(observation.provenanceId) === undefined) {
        this.#store.snapshots.putProvenance({
          id: observation.provenanceId,
          installationId: observation.installation.id,
          observedAt: observation.snapshot.observedAt,
          value: observation.provenance,
        })
      }
    }
    const targetScopes: readonly TargetScope[] = [
      "global",
      ...projects.map(({ id }) => ({ projectId: id } as const)),
    ]
    const bindings: ScopeBinding[] = []
    const effectiveSkills: EffectiveSkill[] = []
    for (const adapter of adapters) {
      const adapterObservations = observations.filter(({ installation }) => installation.adapterId === adapter.id)
      const grouped = new Map<string, InstallationObservation[]>()
      for (const observation of adapterObservations) {
        const key = observationKey(observation)
        grouped.set(key, [...(grouped.get(key) ?? []), observation])
        for (const targetScope of targetScopes) {
          bindings.push(await adapter.describeBinding({ installation: observation.installation, targetScope }))
        }
      }
      for (const [key, candidates] of grouped) {
        for (const targetScope of targetScopes) {
          effectiveSkills.push(...await adapter.resolveScope({
            targetScope,
            key,
            candidates: candidates.map(({ installation }) => installation),
          }))
        }
      }
    }
    this.#store.projections.replaceInventory({
      projects,
      roots: approvedRoots,
      installations: observations.map(({ installation }) => installation),
      bindings,
      effectiveSkills,
    })
    this.#onInventoryChanged({
      installationIds: observations.map(({ installation }) => installation.id),
      reason,
      observedAt: this.#now().toISOString(),
      ...(findings.length === 0 ? {} : { findings: findings.slice(0, 128) }),
    })
  }
}
