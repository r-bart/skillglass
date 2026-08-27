import { describe, expect, it } from "vitest"

import type { SettingsRepository } from "@forge/storage"

import { ForgeMonitoringSettingsRepository } from "./settings-repository.js"

const timestamp = "2026-08-27T10:00:00.000Z"

class MemorySettings implements SettingsRepository {
  readonly values = new Map<string, Readonly<{ value: unknown; updatedAt: string }>>()

  get<T>(key: string): T | undefined {
    return this.values.get(key)?.value as T | undefined
  }

  set(key: string, value: unknown, updatedAt = new Date().toISOString()): void {
    this.values.set(key, { value: structuredClone(value), updatedAt })
  }

  delete(key: string): boolean {
    return this.values.delete(key)
  }

  entries(): ReadonlyArray<Readonly<{ key: string; value: unknown; updatedAt: string }>> {
    return [...this.values].map(([key, entry]) => ({ key, ...entry }))
  }
}

describe("monitoring settings repository", () => {
  it("persists a versioned selection document in application settings", () => {
    const settings = new MemorySettings()
    const repository = new ForgeMonitoringSettingsRepository(settings)

    repository.save({
      version: 1,
      updatedAt: timestamp,
      completedAt: timestamp,
      installationIds: ["installation_alpha", "installation_beta"],
    })

    expect(new ForgeMonitoringSettingsRepository(settings).load()).toEqual({
      version: 1,
      updatedAt: timestamp,
      completedAt: timestamp,
      installationIds: ["installation_alpha", "installation_beta"],
    })
    expect(settings.get("monitoring.selection.v1")).toBeDefined()
    expect(settings.values.get("monitoring.selection.v1")?.updatedAt).toBe(timestamp)
  })

  it("rejects duplicate IDs and malformed or non-strict documents", () => {
    const settings = new MemorySettings()
    const repository = new ForgeMonitoringSettingsRepository(settings)

    expect(() => repository.save({
      version: 1,
      updatedAt: timestamp,
      completedAt: timestamp,
      installationIds: ["installation_alpha", "installation_alpha"],
    })).toThrow("Installation IDs must be unique")

    settings.set("monitoring.selection.v1", {
      version: 1,
      updatedAt: "not-a-date",
      completedAt: timestamp,
      installationIds: [],
      unexpected: true,
    })
    expect(() => repository.load()).toThrow()
  })

  it("persists and clears a separate versioned onboarding marker", () => {
    const settings = new MemorySettings()
    const repository = new ForgeMonitoringSettingsRepository(settings)

    expect(repository.isOnboardingPending()).toBe(false)
    repository.markOnboardingPending(timestamp)

    expect(new ForgeMonitoringSettingsRepository(settings).isOnboardingPending()).toBe(true)
    expect(settings.get("monitoring.onboarding-pending.v1")).toEqual({
      version: 1,
      startedAt: timestamp,
    })

    repository.clearOnboardingPending()
    expect(repository.isOnboardingPending()).toBe(false)
  })
})
