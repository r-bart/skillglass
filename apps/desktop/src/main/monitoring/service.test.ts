import { describe, expect, it } from "vitest"

import type { SkillInstallation } from "@forge/domain"
import type { ProjectionRepository } from "@forge/storage"

import { MonitoringService } from "./service.js"
import { MemoryMonitoringSettingsRepository } from "./settings-repository.js"

const firstTimestamp = "2026-08-27T10:00:00.000Z"
const secondTimestamp = "2026-08-27T11:00:00.000Z"

function projections(initialIds: readonly string[]) {
  let ids = [...initialIds]
  const repository: ProjectionRepository = {
    replaceInventory: (projection) => { ids = projection.installations.map(({ id }) => id) },
    listProjects: () => [],
    listRoots: () => [],
    listInstallations: () => ids.map((id) => ({ id }) as SkillInstallation),
    getInstallation: (id) => ids.includes(id) ? ({ id }) as SkillInstallation : undefined,
    listBindings: () => [],
    listEffectiveSkills: () => [],
  }
  return {
    repository,
    setIds(nextIds: readonly string[]) { ids = [...nextIds] },
  }
}

describe("monitoring service", () => {
  it("requires setup while no selection document exists", () => {
    const projection = projections(["installation_alpha"])
    const service = new MonitoringService({
      settings: new MemoryMonitoringSettingsRepository(),
      projections: projection.repository,
    })

    expect(service.state()).toEqual({
      status: "required",
      selectedInstallationIds: [],
    })
  })

  it("validates and persists a current selection with stable completion time", () => {
    const projection = projections(["installation_alpha", "installation_beta"])
    const settings = new MemoryMonitoringSettingsRepository()
    let now = firstTimestamp
    const service = new MonitoringService({
      settings,
      projections: projection.repository,
      now: () => new Date(now),
    })

    service.beginOnboarding()
    expect(service.isOnboardingPending()).toBe(true)
    expect(service.save({ installationIds: ["installation_alpha"] })).toEqual({
      status: "complete",
      selectedInstallationIds: ["installation_alpha"],
      completedAt: firstTimestamp,
    })
    expect(service.isOnboardingPending()).toBe(false)
    now = secondTimestamp
    service.save({ installationIds: ["installation_beta"] })
    expect(settings.load()).toEqual({
      version: 1,
      updatedAt: secondTimestamp,
      completedAt: firstTimestamp,
      installationIds: ["installation_beta"],
    })
  })

  it("resumes a completed selection from persisted settings without re-running setup", () => {
    const projection = projections(["installation_alpha", "installation_beta"])
    const settings = new MemoryMonitoringSettingsRepository()
    new MonitoringService({
      settings,
      projections: projection.repository,
      now: () => new Date(firstTimestamp),
    }).save({ installationIds: ["installation_beta"] })

    const resumed = new MonitoringService({
      settings,
      projections: projection.repository,
      now: () => new Date(secondTimestamp),
    })

    expect(resumed.state()).toEqual({
      status: "complete",
      selectedInstallationIds: ["installation_beta"],
      completedAt: firstTimestamp,
    })
  })

  it("rejects duplicate and unknown installation IDs", () => {
    const projection = projections(["installation_alpha"])
    const service = new MonitoringService({
      settings: new MemoryMonitoringSettingsRepository(),
      projections: projection.repository,
    })

    expect(() => service.save({
      installationIds: ["installation_alpha", "installation_alpha"],
    })).toThrow("Installation IDs must be unique")
    expect(() => service.save({ installationIds: ["installation_unknown"] }))
      .toThrow("Unknown installation ID")
  })

  it("preserves stored IDs while absent and exposes them again after projection recovery", () => {
    const projection = projections(["installation_alpha", "installation_beta"])
    const settings = new MemoryMonitoringSettingsRepository()
    const service = new MonitoringService({
      settings,
      projections: projection.repository,
      now: () => new Date(firstTimestamp),
    })
    service.save({ installationIds: ["installation_alpha", "installation_beta"] })

    projection.setIds(["installation_alpha"])
    expect(service.state().selectedInstallationIds).toEqual(["installation_alpha"])
    service.save({ installationIds: [] })
    expect(settings.load()?.installationIds).toEqual(["installation_beta"])
    expect(service.state().selectedInstallationIds).toEqual([])

    projection.setIds(["installation_alpha", "installation_beta"])
    expect(service.state().selectedInstallationIds).toEqual(["installation_beta"])
  })

  it("rejects an unavailable stored ID when the renderer sends it back", () => {
    const projection = projections(["installation_alpha", "installation_beta"])
    const settings = new MemoryMonitoringSettingsRepository()
    const service = new MonitoringService({ settings, projections: projection.repository })
    service.save({ installationIds: ["installation_alpha", "installation_beta"] })

    projection.setIds(["installation_alpha"])

    expect(() => service.save({ installationIds: ["installation_beta"] }))
      .toThrow("Unknown installation ID")
    expect(settings.load()?.installationIds)
      .toEqual(["installation_alpha", "installation_beta"])
  })

  it("rejects a save that would exceed the persisted limit after retaining unavailable IDs", () => {
    const previousIds = Array.from(
      { length: 2_000 },
      (_, index) => `installation_previous_${String(index)}`,
    )
    const currentIds = Array.from(
      { length: 2_000 },
      (_, index) => `installation_current_${String(index)}`,
    )
    const projection = projections(previousIds)
    const settings = new MemoryMonitoringSettingsRepository()
    const service = new MonitoringService({ settings, projections: projection.repository })
    service.save({ installationIds: previousIds })

    projection.setIds(currentIds)

    expect(() => service.save({ installationIds: currentIds }))
      .toThrow("Monitoring selection cannot exceed 2000 installations")
    expect(settings.load()?.installationIds).toEqual(previousIds)
  })

  it("includes newly created installations only after monitoring is complete", () => {
    const projection = projections(["installation_alpha", "installation_beta"])
    const settings = new MemoryMonitoringSettingsRepository()
    const service = new MonitoringService({ settings, projections: projection.repository })

    expect(service.includeCurrentInstallations(["installation_beta"]).status).toBe("required")
    expect(settings.load()).toBeUndefined()

    service.save({ installationIds: ["installation_alpha"] })
    expect(service.includeCurrentInstallations(["installation_beta"])).toMatchObject({
      status: "complete",
      selectedInstallationIds: ["installation_alpha", "installation_beta"],
    })
    expect(() => service.includeCurrentInstallations(["installation_unknown"]))
      .toThrow("Unknown installation ID")
  })

  it("bootstraps legacy installations only when explicitly invoked after projection", () => {
    const projection = projections(["installation_alpha", "installation_beta"])
    const settings = new MemoryMonitoringSettingsRepository()
    const service = new MonitoringService({
      settings,
      projections: projection.repository,
      now: () => new Date(firstTimestamp),
    })

    expect(service.state().status).toBe("required")
    expect(service.bootstrapLegacySelection()).toEqual({
      status: "complete",
      selectedInstallationIds: ["installation_alpha", "installation_beta"],
      completedAt: firstTimestamp,
    })

    projection.setIds(["installation_alpha"])
    expect(service.bootstrapLegacySelection().selectedInstallationIds).toEqual(["installation_alpha"])
    expect(settings.load()?.installationIds).toEqual(["installation_alpha", "installation_beta"])
  })

  it("keeps a clean onboarding pending across service recreation until save", () => {
    const projection = projections(["installation_alpha"])
    const settings = new MemoryMonitoringSettingsRepository()
    const first = new MonitoringService({
      settings,
      projections: projection.repository,
      now: () => new Date(firstTimestamp),
    })
    first.beginOnboarding()

    const restarted = new MonitoringService({
      settings,
      projections: projection.repository,
      now: () => new Date(secondTimestamp),
    })
    expect(restarted.isOnboardingPending()).toBe(true)
    expect(restarted.state().status).toBe("required")

    restarted.save({ installationIds: ["installation_alpha"] })
    expect(restarted.isOnboardingPending()).toBe(false)
  })
})
