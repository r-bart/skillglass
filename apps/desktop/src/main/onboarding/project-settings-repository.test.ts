import { describe, expect, it } from "vitest"

import { canonicalPath } from "@forge/domain"
import { openForgeStore } from "@forge/storage"

import { ForgeProjectSettingsRepository } from "./project-settings-repository.js"

describe("explicit project settings", () => {
  it("persists selected projects independently from root approval", () => {
    const store = openForgeStore({ path: ":memory:" })
    const repository = new ForgeProjectSettingsRepository(store.settings)
    repository.save([{
      id: "project_acme",
      displayName: "Acme",
      canonicalPath: canonicalPath("/projects/acme"),
      adapterIds: ["codex", "folder"],
    }], "2026-08-26T12:00:00.000Z")

    expect(new ForgeProjectSettingsRepository(store.settings).load()).toEqual([{
      id: "project_acme",
      displayName: "Acme",
      canonicalPath: "/projects/acme",
      adapterIds: ["codex", "folder"],
    }])
    store.close()
  })
})
