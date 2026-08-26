import type { FileSystemPort } from "@forge/operations"
import type { SettingsRepository } from "@forge/storage"

const PREFIX = "operations.private-source-lease.v1."
const PRIVATE_SOURCE_PATTERN = /^\.forge-(?:update-)?source-[a-f0-9]{24}$/u
const HASH_PATTERN = /^[a-f0-9]{64}$/u

export interface PrivateSourceLease {
  readonly version: 1
  readonly planId: string
  readonly rootId: string
  readonly relativePath: string
  readonly expectedHash: string
  readonly createdAt: string
}

function parseLease(value: unknown): PrivateSourceLease {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Private source lease is invalid")
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || typeof candidate.planId !== "string" || candidate.planId.length === 0 ||
    typeof candidate.rootId !== "string" || candidate.rootId.length === 0 ||
    typeof candidate.relativePath !== "string" || !PRIVATE_SOURCE_PATTERN.test(candidate.relativePath) ||
    typeof candidate.expectedHash !== "string" || !HASH_PATTERN.test(candidate.expectedHash) ||
    typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt))) {
    throw new TypeError("Private source lease is invalid")
  }
  return {
    version: 1,
    planId: candidate.planId,
    rootId: candidate.rootId,
    relativePath: candidate.relativePath,
    expectedHash: candidate.expectedHash,
    createdAt: candidate.createdAt,
  }
}

export class PrivateSourceLeaseRepository {
  readonly #settings: SettingsRepository

  constructor(settings: SettingsRepository) {
    this.#settings = settings
  }

  put(lease: PrivateSourceLease): void {
    const parsed = parseLease(lease)
    this.#settings.set(`${PREFIX}${parsed.planId}`, parsed, parsed.createdAt)
  }

  delete(planId: string): void {
    this.#settings.delete(`${PREFIX}${planId}`)
  }

  list(): readonly PrivateSourceLease[] {
    return this.#settings.entries()
      .filter(({ key }) => key.startsWith(PREFIX))
      .map(({ value }) => parseLease(value))
  }
}

/** Cleans only journal-associated exact trees; it never treats a filename glob as ownership. */
export async function recoverPrivateSourceLeases(
  leases: PrivateSourceLeaseRepository,
  fileSystem: Pick<FileSystemPort, "observe" | "removeExact">,
): Promise<void> {
  for (const lease of leases.list()) {
    const artifact = {
      rootId: lease.rootId,
      relativePath: lease.relativePath,
      kind: "tree" as const,
    }
    const observed = await fileSystem.observe(artifact)
    if (!observed.exists) {
      leases.delete(lease.planId)
      continue
    }
    if (observed.hash !== lease.expectedHash) {
      throw new Error(`Private source for plan ${lease.planId} changed and requires recovery`)
    }
    const removed = await fileSystem.removeExact(artifact, lease.expectedHash)
    if (!removed) throw new Error(`Private source for plan ${lease.planId} changed and requires recovery`)
    leases.delete(lease.planId)
  }
}
