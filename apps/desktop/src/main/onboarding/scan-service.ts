import { FolderAdapter, type FolderRootConfiguration } from "@forge/adapter-folder"
import type { InstallationObservation, SkillRuntimeAdapter } from "@forge/adapter-api"
import type { InventoryChangedEvent } from "@forge/contracts"
import type { ProjectScope, SourceRoot } from "@forge/domain"
import { ScanCoordinator } from "@forge/scanner"
import type { ForgeStore } from "@forge/storage"

import { auditE2eScan } from "../e2e-test-seam.js"

export interface ApprovedRootScanServiceOptions {
  readonly codexAdapter: SkillRuntimeAdapter
  readonly projects: readonly ProjectScope[]
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

export class ApprovedRootScanService {
  readonly #codexAdapter: SkillRuntimeAdapter
  readonly #projects: readonly ProjectScope[]
  readonly #store: ForgeStore
  readonly #onInventoryChanged: (event: InventoryChangedEvent) => void
  readonly #now: () => Date

  constructor(options: ApprovedRootScanServiceOptions) {
    this.#codexAdapter = options.codexAdapter
    this.#projects = options.projects
    this.#store = options.store
    this.#onInventoryChanged = options.onInventoryChanged ?? (() => undefined)
    this.#now = options.now ?? (() => new Date())
  }

  async scan(approvedRoots: readonly SourceRoot[]): Promise<void> {
    if (approvedRoots.length === 0) throw new TypeError("A persisted approval is required before scanning")
    auditE2eScan(approvedRoots)
    const folderRoots = approvedRoots.filter(({ adapterId }) => adapterId === "folder")
    const adapters: SkillRuntimeAdapter[] = [this.#codexAdapter]
    if (folderRoots.length > 0) {
      adapters.push(new FolderAdapter({ roots: folderRoots.map((root) => folderConfiguration(root, this.#projects)) }))
    }
    const coordinator = new ScanCoordinator<InstallationObservation>({ adapters, approvedRoots })
    const observations: InstallationObservation[] = []
    for await (const event of coordinator.scan()) {
      if (event.kind === "observation") observations.push(event.observation)
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
    this.#store.projections.replaceInventory({
      projects: this.#projects,
      roots: approvedRoots,
      installations: observations.map(({ installation }) => installation),
    })
    this.#onInventoryChanged({
      installationIds: observations.map(({ installation }) => installation.id),
      reason: "root-approval",
      observedAt: this.#now().toISOString(),
    })
  }
}
