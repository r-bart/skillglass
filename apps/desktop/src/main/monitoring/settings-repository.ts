import { z } from "zod"

import {
  InstallationIdSchema,
  IsoDateTimeSchema,
  MAX_MONITORED_INSTALLATIONS,
} from "@forge/contracts"
import type { SettingsRepository } from "@forge/storage"

const SETTINGS_KEY = "monitoring.selection.v1"
const ONBOARDING_PENDING_KEY = "monitoring.onboarding-pending.v1"
const MonitoringSelectionDocumentSchema = z.object({
  version: z.literal(1),
  updatedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  installationIds: z.array(InstallationIdSchema).max(MAX_MONITORED_INSTALLATIONS),
}).strict().superRefine((document, context) => {
  if (new Set(document.installationIds).size !== document.installationIds.length) {
    context.addIssue({
      code: "custom",
      message: "Installation IDs must be unique",
      path: ["installationIds"],
    })
  }
})

const MonitoringOnboardingPendingDocumentSchema = z.object({
  version: z.literal(1),
  startedAt: IsoDateTimeSchema,
}).strict()

type ParsedMonitoringSelectionDocument = z.infer<typeof MonitoringSelectionDocumentSchema>

export type MonitoringSelectionDocument = Omit<
  ParsedMonitoringSelectionDocument,
  "installationIds"
> & Readonly<{
  installationIds: readonly string[]
}>

export interface MonitoringSettingsRepository {
  clearOnboardingPending(): void
  isOnboardingPending(): boolean
  load(): MonitoringSelectionDocument | undefined
  markOnboardingPending(startedAt: string): void
  save(document: MonitoringSelectionDocument): void
}

export class ForgeMonitoringSettingsRepository implements MonitoringSettingsRepository {
  readonly #settings: SettingsRepository

  constructor(settings: SettingsRepository) {
    this.#settings = settings
  }

  clearOnboardingPending(): void {
    this.#settings.delete(ONBOARDING_PENDING_KEY)
  }

  isOnboardingPending(): boolean {
    const stored = this.#settings.get<unknown>(ONBOARDING_PENDING_KEY)
    if (stored === undefined) return false
    MonitoringOnboardingPendingDocumentSchema.parse(stored)
    return true
  }

  load(): MonitoringSelectionDocument | undefined {
    const stored = this.#settings.get<unknown>(SETTINGS_KEY)
    if (stored === undefined) return undefined
    return MonitoringSelectionDocumentSchema.parse(stored) as MonitoringSelectionDocument
  }

  markOnboardingPending(startedAt: string): void {
    const document = MonitoringOnboardingPendingDocumentSchema.parse({
      version: 1,
      startedAt,
    })
    this.#settings.set(ONBOARDING_PENDING_KEY, document, document.startedAt)
  }

  save(document: MonitoringSelectionDocument): void {
    const parsed = MonitoringSelectionDocumentSchema.parse(document) as MonitoringSelectionDocument
    this.#settings.set(SETTINGS_KEY, parsed, parsed.updatedAt)
  }
}

export class MemoryMonitoringSettingsRepository implements MonitoringSettingsRepository {
  #document: MonitoringSelectionDocument | undefined
  #onboardingPending = false

  clearOnboardingPending(): void {
    this.#onboardingPending = false
  }

  isOnboardingPending(): boolean {
    return this.#onboardingPending
  }

  load(): MonitoringSelectionDocument | undefined {
    return this.#document === undefined ? undefined : structuredClone(this.#document)
  }

  markOnboardingPending(startedAt: string): void {
    IsoDateTimeSchema.parse(startedAt)
    this.#onboardingPending = true
  }

  save(document: MonitoringSelectionDocument): void {
    this.#document = structuredClone(
      MonitoringSelectionDocumentSchema.parse(document) as MonitoringSelectionDocument,
    )
  }
}
