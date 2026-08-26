import { z } from "zod"

import { EvidenceSchema, RootAccessSchema, RootKindSchema } from "@forge/contracts"
import type { Evidence } from "@forge/domain"
import type { SettingsRepository } from "@forge/storage"

const SETTINGS_KEY = "onboarding.approved-roots.v1"

const StoredRootCandidateSchema = z.object({
  candidateId: z.string().min(1).max(128),
  adapterId: z.string().min(1).max(128),
  adapterDisplayName: z.string().min(1).max(512),
  canonicalPath: z.string().min(1),
  displayPath: z.string().min(1).max(512),
  kind: RootKindSchema,
  access: RootAccessSchema,
  writableWithoutElevation: z.boolean(),
  discovery: EvidenceSchema,
  defaultIncluded: z.boolean(),
  projectPath: z.string().min(1).optional(),
  projectId: z.string().min(1).max(128).optional(),
}).strict()

const RootApprovalDocumentSchema = z.object({
  version: z.literal(1),
  updatedAt: z.iso.datetime({ offset: true }),
  candidates: z.array(StoredRootCandidateSchema).max(128),
  selectedCandidateIds: z.array(z.string().min(1).max(128)).max(128),
}).strict()

export type StoredRootCandidate = Omit<z.infer<typeof StoredRootCandidateSchema>, "discovery"> & {
  readonly discovery: Evidence
}
export type RootApprovalDocument = Omit<z.infer<typeof RootApprovalDocumentSchema>, "candidates"> & {
  readonly candidates: readonly StoredRootCandidate[]
}

export interface RootApprovalSettingsRepository {
  load(): RootApprovalDocument | undefined
  save(document: RootApprovalDocument): void
}

export class ForgeRootApprovalSettingsRepository implements RootApprovalSettingsRepository {
  readonly #settings: SettingsRepository

  constructor(settings: SettingsRepository) {
    this.#settings = settings
  }

  load(): RootApprovalDocument | undefined {
    const stored = this.#settings.get<unknown>(SETTINGS_KEY)
    if (stored === undefined) return undefined
    return RootApprovalDocumentSchema.parse(stored) as RootApprovalDocument
  }

  save(document: RootApprovalDocument): void {
    const parsed = RootApprovalDocumentSchema.parse(document) as RootApprovalDocument
    this.#settings.set(SETTINGS_KEY, parsed, parsed.updatedAt)
  }
}

export class MemoryRootApprovalSettingsRepository implements RootApprovalSettingsRepository {
  #document: RootApprovalDocument | undefined

  load(): RootApprovalDocument | undefined {
    return this.#document === undefined ? undefined : structuredClone(this.#document)
  }

  save(document: RootApprovalDocument): void {
    this.#document = structuredClone(RootApprovalDocumentSchema.parse(document) as RootApprovalDocument)
  }
}
