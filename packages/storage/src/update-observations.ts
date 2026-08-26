import type {
  SettingsRepository,
  StoredUpdateObservation,
  UpdateObservationRepository,
} from "./types.js"

const PREFIX = "inventory.local-source-update.v1."
const HASH_PATTERN = /^[a-f0-9]{64}$/u

function parse(value: unknown): StoredUpdateObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Stored update observation is invalid")
  const candidate = value as Record<string, unknown>
  if (typeof candidate.installationId !== "string" || candidate.installationId.length === 0 ||
    (candidate.state !== "current" && candidate.state !== "available" && candidate.state !== "diverged" && candidate.state !== "unknown") ||
    typeof candidate.observedAt !== "string" || !Number.isFinite(Date.parse(candidate.observedAt)) ||
    typeof candidate.baseTreeHash !== "string" || !HASH_PATTERN.test(candidate.baseTreeHash) ||
    (candidate.installedTreeHash !== undefined && (typeof candidate.installedTreeHash !== "string" || !HASH_PATTERN.test(candidate.installedTreeHash))) ||
    (candidate.sourceTreeHash !== undefined && (typeof candidate.sourceTreeHash !== "string" || !HASH_PATTERN.test(candidate.sourceTreeHash)))) {
    throw new TypeError("Stored update observation is invalid")
  }
  return {
    installationId: candidate.installationId,
    state: candidate.state,
    observedAt: candidate.observedAt,
    baseTreeHash: candidate.baseTreeHash,
    ...(candidate.installedTreeHash === undefined ? {} : { installedTreeHash: candidate.installedTreeHash }),
    ...(candidate.sourceTreeHash === undefined ? {} : { sourceTreeHash: candidate.sourceTreeHash }),
  }
}

export class SettingsUpdateObservationRepository implements UpdateObservationRepository {
  readonly #settings: SettingsRepository

  constructor(settings: SettingsRepository) {
    this.#settings = settings
  }

  put(observation: StoredUpdateObservation): void {
    const parsed = parse(observation)
    this.#settings.set(`${PREFIX}${parsed.installationId}`, parsed, parsed.observedAt)
  }

  get(installationId: string): StoredUpdateObservation | undefined {
    const value = this.#settings.get<unknown>(`${PREFIX}${installationId}`)
    return value === undefined ? undefined : parse(value)
  }

  list(): readonly StoredUpdateObservation[] {
    return this.#settings.entries()
      .filter(({ key }) => key.startsWith(PREFIX))
      .map(({ value }) => parse(value))
  }

  delete(installationId: string): boolean {
    return this.#settings.delete(`${PREFIX}${installationId}`)
  }
}
