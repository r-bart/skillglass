import type {
  AckDto,
  InspectInstallationInput,
  InstallationDetailDto,
  InventoryPageDto,
  InventoryQuery,
} from "@forge/contracts"
import type {
  InventoryQueryRepository,
  ProjectionRepository,
} from "@forge/storage"

export interface EntryRevealPort {
  showItemInFolder(path: string): void
}

export class InventoryService {
  readonly #inventory: InventoryQueryRepository
  readonly #projections: ProjectionRepository
  readonly #entryReveal: EntryRevealPort

  constructor(
    inventory: InventoryQueryRepository,
    projections: ProjectionRepository,
    entryReveal: EntryRevealPort,
  ) {
    this.#inventory = inventory
    this.#projections = projections
    this.#entryReveal = entryReveal
  }

  list(query: InventoryQuery): Promise<InventoryPageDto> {
    return Promise.resolve(this.#inventory.list(query))
  }

  inspect(input: InspectInstallationInput): Promise<InstallationDetailDto> {
    const detail = this.#inventory.inspect(input.installationId)
    if (detail === undefined) throw new Error("Installation not found")
    return Promise.resolve(detail)
  }

  openEntry(input: InspectInstallationInput): Promise<AckDto> {
    const installation = this.#projections.getInstallation(input.installationId)
    if (installation === undefined) throw new Error("Installation not found")
    this.#entryReveal.showItemInFolder(installation.entryFile)
    return Promise.resolve({ ok: true })
  }
}
