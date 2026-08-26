import { describe, expect, it, vi } from "vitest"

import type { SettingsRepository } from "@forge/storage"

import { PrivateSourceLeaseRepository, recoverPrivateSourceLeases } from "./artifact-leases.js"

class MemorySettings implements SettingsRepository {
  readonly values = new Map<string, { value: unknown; updatedAt: string }>()
  get<T>(key: string): T | undefined { return this.values.get(key)?.value as T | undefined }
  set(key: string, value: unknown, updatedAt = new Date().toISOString()): void { this.values.set(key, { value, updatedAt }) }
  delete(key: string): boolean { return this.values.delete(key) }
  entries() { return [...this.values.entries()].map(([key, entry]) => ({ key, ...entry })) }
}

const lease = {
  version: 1 as const,
  planId: "plan_crash_cleanup",
  rootId: "forge-recovery-v1",
  relativePath: ".forge-source-0123456789abcdef01234567",
  expectedHash: "a".repeat(64),
  createdAt: "2026-08-26T12:00:00.000Z",
}

describe("private source lease recovery", () => {
  it("clears a durable lease when cleanup completed just before the crash", async () => {
    const repository = new PrivateSourceLeaseRepository(new MemorySettings())
    repository.put(lease)
    const removeExact = vi.fn(() => Promise.resolve(false))
    await recoverPrivateSourceLeases(repository, {
      observe: () => Promise.resolve({ exists: false }),
      removeExact,
    })
    expect(repository.list()).toEqual([])
    expect(removeExact).not.toHaveBeenCalled()
  })

  it("removes only an exact journal-associated private tree", async () => {
    const repository = new PrivateSourceLeaseRepository(new MemorySettings())
    repository.put(lease)
    const removeExact = vi.fn(() => Promise.resolve(true))
    await recoverPrivateSourceLeases(repository, {
      observe: () => Promise.resolve({ exists: true, hash: lease.expectedHash }),
      removeExact,
    })
    expect(removeExact).toHaveBeenCalledWith(expect.objectContaining({ relativePath: lease.relativePath }), lease.expectedHash)
    expect(repository.list()).toEqual([])
  })

  it("blocks recovery without deleting a changed private tree", async () => {
    const repository = new PrivateSourceLeaseRepository(new MemorySettings())
    repository.put(lease)
    const removeExact = vi.fn(() => Promise.resolve(true))
    await expect(recoverPrivateSourceLeases(repository, {
      observe: () => Promise.resolve({ exists: true, hash: "b".repeat(64) }),
      removeExact,
    })).rejects.toThrow("requires recovery")
    expect(removeExact).not.toHaveBeenCalled()
    expect(repository.list()).toEqual([lease])
  })
})
