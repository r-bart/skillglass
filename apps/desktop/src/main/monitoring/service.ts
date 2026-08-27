import {
  MAX_MONITORED_INSTALLATIONS,
  MonitoringStateDtoSchema,
  SaveMonitoringSelectionInputSchema,
  type MonitoringStateDto,
  type SaveMonitoringSelectionInput,
} from "@forge/contracts"
import type { ProjectionRepository } from "@forge/storage"

import type {
  MonitoringSelectionDocument,
  MonitoringSettingsRepository,
} from "./settings-repository.js"

export interface MonitoringServiceOptions {
  readonly settings: MonitoringSettingsRepository
  readonly projections: ProjectionRepository
  readonly now?: () => Date
}

export class MonitoringService {
  readonly #settings: MonitoringSettingsRepository
  readonly #projections: ProjectionRepository
  readonly #now: () => Date

  constructor(options: MonitoringServiceOptions) {
    this.#settings = options.settings
    this.#projections = options.projections
    this.#now = options.now ?? (() => new Date())
  }

  state(): MonitoringStateDto {
    const document = this.#settings.load()
    if (document === undefined) {
      return MonitoringStateDtoSchema.parse({
        status: "required",
        selectedInstallationIds: [],
      })
    }
    return this.#stateFromDocument(document)
  }

  beginOnboarding(): void {
    if (!this.#settings.isOnboardingPending()) {
      this.#settings.markOnboardingPending(this.#now().toISOString())
    }
  }

  isOnboardingPending(): boolean {
    return this.#settings.isOnboardingPending()
  }

  /**
   * Adds skills created or installed by Forge to an already-complete
   * preference without turning a required onboarding into a completed one.
   */
  includeCurrentInstallations(installationIds: readonly string[]): MonitoringStateDto {
    const existing = this.#settings.load()
    if (existing === undefined) return this.state()

    const currentIds = this.#currentInstallationIds()
    for (const installationId of installationIds) {
      if (!currentIds.has(installationId)) throw new TypeError("Unknown installation ID")
    }
    const selected = new Set(this.#stateFromDocument(existing).selectedInstallationIds)
    for (const installationId of installationIds) selected.add(installationId)
    return this.save({ installationIds: [...selected] })
  }

  save(input: SaveMonitoringSelectionInput): MonitoringStateDto {
    const parsed = SaveMonitoringSelectionInputSchema.parse(input)
    const existing = this.#settings.load()
    const currentIds = this.#currentInstallationIds()
    for (const installationId of parsed.installationIds) {
      if (!currentIds.has(installationId)) {
        throw new TypeError("Unknown installation ID")
      }
    }

    const unavailableStoredIds = (existing?.installationIds ?? []).filter(
      (installationId) => !currentIds.has(installationId),
    )
    const installationIds = [
      ...parsed.installationIds,
      ...unavailableStoredIds.filter(
        (installationId) => !parsed.installationIds.includes(installationId),
      ),
    ]
    if (installationIds.length > MAX_MONITORED_INSTALLATIONS) {
      throw new RangeError(
        `Monitoring selection cannot exceed ${String(MAX_MONITORED_INSTALLATIONS)} installations`,
      )
    }
    const timestamp = this.#now().toISOString()
    const document: MonitoringSelectionDocument = {
      version: 1,
      updatedAt: timestamp,
      completedAt: existing?.completedAt ?? timestamp,
      installationIds,
    }
    this.#settings.save(document)
    this.#settings.clearOnboardingPending()
    return this.#stateFromDocument(document)
  }

  /**
   * Completes monitoring setup for a pre-existing installation. Composition must
   * invoke this only after the persisted inventory projection has been rebuilt.
   */
  bootstrapLegacySelection(): MonitoringStateDto {
    const existing = this.#settings.load()
    if (existing !== undefined) return this.#stateFromDocument(existing)

    const timestamp = this.#now().toISOString()
    const document: MonitoringSelectionDocument = {
      version: 1,
      updatedAt: timestamp,
      completedAt: timestamp,
      installationIds: [...this.#currentInstallationIds()],
    }
    this.#settings.save(document)
    return this.#stateFromDocument(document)
  }

  #currentInstallationIds(): ReadonlySet<string> {
    return new Set(this.#projections.listInstallations().map(({ id }) => id))
  }

  #stateFromDocument(document: MonitoringSelectionDocument): MonitoringStateDto {
    const currentIds = this.#currentInstallationIds()
    return MonitoringStateDtoSchema.parse({
      status: "complete",
      selectedInstallationIds: document.installationIds.filter((id) => currentIds.has(id)),
      completedAt: document.completedAt,
    })
  }
}
