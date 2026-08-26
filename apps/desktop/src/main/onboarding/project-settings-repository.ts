import { z } from "zod"

import { canonicalPath, type ProjectScope } from "@forge/domain"
import type { SettingsRepository } from "@forge/storage"

const SETTINGS_KEY = "onboarding.projects.v1"

const StoredProjectSchema = z.object({
  id: z.string().min(1).max(128),
  displayName: z.string().min(1).max(512),
  canonicalPath: z.string().min(1),
  adapterIds: z.array(z.string().min(1).max(128)).min(1).max(16),
}).strict()

const ProjectSelectionDocumentSchema = z.object({
  version: z.literal(1),
  updatedAt: z.iso.datetime({ offset: true }),
  projects: z.array(StoredProjectSchema).max(64),
}).strict()

function projectScope(stored: z.infer<typeof StoredProjectSchema>): ProjectScope {
  return {
    ...stored,
    canonicalPath: canonicalPath(stored.canonicalPath),
  }
}

export interface ProjectSettingsRepository {
  load(): readonly ProjectScope[]
  save(projects: readonly ProjectScope[], updatedAt: string): void
}

export class ForgeProjectSettingsRepository implements ProjectSettingsRepository {
  readonly #settings: SettingsRepository

  constructor(settings: SettingsRepository) {
    this.#settings = settings
  }

  load(): readonly ProjectScope[] {
    const stored = this.#settings.get<unknown>(SETTINGS_KEY)
    if (stored === undefined) return []
    return ProjectSelectionDocumentSchema.parse(stored).projects.map(projectScope)
  }

  save(projects: readonly ProjectScope[], updatedAt: string): void {
    const document = ProjectSelectionDocumentSchema.parse({
      version: 1,
      updatedAt,
      projects,
    })
    this.#settings.set(SETTINGS_KEY, document, document.updatedAt)
  }
}

export class MemoryProjectSettingsRepository implements ProjectSettingsRepository {
  #projects: readonly ProjectScope[] = []

  load(): readonly ProjectScope[] {
    return structuredClone(this.#projects)
  }

  save(projects: readonly ProjectScope[]): void {
    this.#projects = structuredClone(projects)
  }
}
