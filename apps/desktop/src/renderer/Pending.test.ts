import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ForgeBridge, InstallationDetailDto, InventoryItemDto } from "@forge/contracts"

import { setActiveLocale } from "./i18n.js"
import { Pending } from "./Pending.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const NOW = "2026-08-26T10:00:00.000Z"
const HASH = "a".repeat(64)

function item(id: string, update: InventoryItemDto["status"]["update"], validity: InventoryItemDto["status"]["validity"] = "valid"): InventoryItemDto {
  return {
    installationId: `installation_${id}`,
    adapterId: "folder",
    rootId: "root_fixture",
    scope: { kind: "global" },
    key: id,
    name: { state: "known", value: id, evidence: { kind: "observed", source: "SKILL.md" } },
    description: { state: "unknown", evidence: { kind: "unknown" } },
    declaredVersion: { state: "unknown", evidence: { kind: "unknown" } },
    status: { validity, runtimeState: "unsupported", source: "local", update, usage: "unavailable" },
    observedAt: NOW,
  }
}

const available = item("upgrade-me", "available")
const diverged = item("changed-locally", "diverged")
const invalid = item("invalid-skill", "unknown", "invalid")

function detail(value: InventoryItemDto): InstallationDetailDto {
  return {
    installation: value,
    snapshotId: `snapshot_${value.installationId}`,
    locationLabel: `/safe/${value.key}`,
    entryFile: "SKILL.md",
    rawEntryContent: "---\nname: fixture\n---\n",
    contentHash: HASH,
    files: [{ relativePath: "SKILL.md", byteLength: 28, sha256: HASH, kind: "entry" }],
    findings: [],
    requirements: [],
    provenance: {
      id: `provenance_${value.installationId}`,
      kind: "forge-import",
      sourceLabel: { state: "known", value: "local", evidence: { kind: "observed", source: "Forge" } },
      release: { state: "unknown", evidence: { kind: "unknown" } },
      commit: { state: "unknown", evidence: { kind: "unknown" } },
      license: { state: "unknown", evidence: { kind: "unknown" } },
      managedBy: "forge",
    },
    capabilities: { canInstallSibling: true, canUpdateFromSource: true, canEditEntry: true, unavailableReasons: [] },
  }
}

const eventBridge: ForgeBridge["events"] = {
  onRootsChanged: () => () => undefined,
  onInventoryChanged: () => () => undefined,
  onOperationProgress: () => () => undefined,
  onOperationCompleted: () => () => undefined,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setActiveLocale("es")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name)
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return found
}

describe("Pending surface", () => {
  it("groups evidenced work and previews a homogeneous update batch before applying", async () => {
    const inventoryBridge: ForgeBridge["inventory"] = {
      list: () => Promise.resolve({ items: [available, diverged, invalid], projects: [], nextCursor: null, total: 3, observedAt: NOW }),
      inspect: ({ installationId }) => Promise.resolve(detail([available, diverged, invalid].find((candidate) => candidate.installationId === installationId) ?? available)),
      openEntry: () => Promise.resolve({ ok: true }),
    }
    const plan = vi.fn(() => Promise.resolve({
      planId: "plan_pending_update", kind: "update-from-local" as const, status: "planned" as const,
      createdAt: NOW, expiresAt: "2026-08-26T10:15:00.000Z", adapterId: "folder",
      installationIds: [available.installationId], targetRootId: available.rootId,
      affectedScopes: [{ kind: "global" as const }],
      affectedEntries: [{ action: "modify" as const, rootId: available.rootId, installationId: available.installationId, relativePath: "upgrade-me/SKILL.md" }],
      preconditions: [{ code: "source-match", message: "El origen debe conservar su hash" }],
      conflicts: [], warnings: [], undo: "persistent" as const, summary: "Actualizar upgrade-me", destinationLabel: "/safe/upgrade-me",
    }))
    const confirm = vi.fn(() => Promise.resolve({
      operationId: "operation_pending", planId: "plan_pending_update", journalId: "plan_pending_update",
      status: "committed" as const, finishedAt: NOW, installationIds: [available.installationId],
      message: "Skill actualizada", issues: [], undoAvailable: true,
    }))
    const operationBridge = {
      selectLocalSource: () => Promise.resolve(null), plan, confirm,
      undo: () => Promise.reject(new Error("not used")), history: () => Promise.resolve({ items: [] }),
      refreshUpdates: () => Promise.resolve({ ok: true as const }),
    }

    await act(async () => root.render(createElement(Pending, {
      inventoryBridge, operationBridge, eventBridge,
      monitoredInstallationIds: new Set([available, diverged, invalid].map(({ installationId }) => installationId)),
      onSelectInstallation: vi.fn(), onStatus: vi.fn(),
    })))

    expect(container.textContent).toContain("Actualizaciones disponibles · 1")
    expect(container.textContent).toContain("Conflictos de origen · 1")
    expect(container.textContent).toContain("Validación pendiente · 1")
    expect(container.querySelector(".pending-header .surface-header__title")?.textContent).toBe("Por revisar")
    expect(container.querySelectorAll(".pending-group .section-label")).toHaveLength(3)
    expect(container.querySelectorAll(".pending-group__status .status-pill__dot")).toHaveLength(3)
    expect(container.querySelectorAll(".pending-group__note")).toHaveLength(3)
    expect(container.querySelectorAll(".pending-row .skill-tile")).toHaveLength(3)
    expect(container.querySelectorAll(".pending-row__badge.status-pill")).toHaveLength(3)
    expect(container.querySelectorAll(".pending-row__action.visual-action--quiet")).toHaveLength(3)
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    await act(async () => checkboxes[0]?.click())
    expect(checkboxes[0]?.closest(".pending-row")?.classList.contains("is-glass-selected")).toBe(true)
    expect(container.querySelector(".pending-batch.is-glass-selected")).not.toBeNull()
    expect(button("Actualizar 1")).not.toBeNull()

    await act(async () => button("Actualizar 1").click())
    expect(plan).toHaveBeenCalledWith({
      kind: "update-from-local", installationId: available.installationId,
      expectedSnapshotId: `snapshot_${available.installationId}`,
    })
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Disponible antes de confirmar")
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("upgrade-me/SKILL.md")

    await act(async () => button("Confirmar 1").click())
    expect(confirm).toHaveBeenCalledWith({ planId: "plan_pending_update" })
  })

  it("uses resolver language for mixed selections and opens the inspector without inventing a batch operation", async () => {
    const inventoryBridge: ForgeBridge["inventory"] = {
      list: () => Promise.resolve({ items: [available, diverged], projects: [], nextCursor: null, total: 2, observedAt: NOW }),
      inspect: () => Promise.resolve(detail(available)),
      openEntry: () => Promise.resolve({ ok: true }),
    }
    const plan = vi.fn(() => Promise.reject(new Error("must not plan a mixed batch")))
    const operationBridge: ForgeBridge["operations"] = {
      selectLocalSource: () => Promise.resolve(null), plan,
      confirm: () => Promise.reject(new Error("not used")), undo: () => Promise.reject(new Error("not used")),
      history: () => Promise.resolve({ items: [] }), refreshUpdates: () => Promise.resolve({ ok: true }),
    }
    const onSelectInstallation = vi.fn()
    await act(async () => root.render(createElement(Pending, {
      inventoryBridge, operationBridge, eventBridge,
      monitoredInstallationIds: new Set([available.installationId, diverged.installationId]),
      onSelectInstallation, onStatus: vi.fn(),
    })))
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    await act(async () => { checkboxes[0]?.click(); checkboxes[1]?.click() })

    await act(async () => button("Resolver 2 pendientes").click())
    expect(plan).not.toHaveBeenCalled()
    expect(onSelectInstallation).toHaveBeenCalledWith(available.installationId)
  })

  it("filters unmonitored work and prunes a selection and prepared plan when monitoring changes", async () => {
    const inventoryBridge: ForgeBridge["inventory"] = {
      list: () => Promise.resolve({
        items: [available, diverged, invalid],
        projects: [],
        nextCursor: null,
        total: 3,
        observedAt: NOW,
      }),
      inspect: () => Promise.resolve(detail(available)),
      openEntry: () => Promise.resolve({ ok: true }),
    }
    const plan = vi.fn(() => Promise.resolve({
      planId: "plan_pruned",
      kind: "update-from-local" as const,
      status: "planned" as const,
      createdAt: NOW,
      expiresAt: "2026-08-26T10:15:00.000Z",
      adapterId: "folder",
      installationIds: [available.installationId],
      targetRootId: available.rootId,
      affectedScopes: [{ kind: "global" as const }],
      affectedEntries: [{
        action: "modify" as const,
        rootId: available.rootId,
        installationId: available.installationId,
        relativePath: "upgrade-me/SKILL.md",
      }],
      preconditions: [],
      conflicts: [],
      warnings: [],
      undo: "persistent" as const,
      summary: "Actualizar upgrade-me",
      destinationLabel: "/safe/upgrade-me",
    }))
    const operationBridge: ForgeBridge["operations"] = {
      selectLocalSource: () => Promise.resolve(null),
      plan,
      confirm: () => Promise.reject(new Error("not used")),
      undo: () => Promise.reject(new Error("not used")),
      history: () => Promise.resolve({ items: [] }),
      refreshUpdates: () => Promise.resolve({ ok: true }),
    }
    const props = {
      inventoryBridge,
      operationBridge,
      eventBridge,
      onSelectInstallation: vi.fn(),
      onStatus: vi.fn(),
    }

    await act(async () => root.render(createElement(Pending, {
      ...props,
      monitoredInstallationIds: new Set([available.installationId]),
    })))
    expect(container.textContent).toContain("upgrade-me")
    expect(container.textContent).not.toContain("changed-locally")
    expect(container.textContent).not.toContain("invalid-skill")

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    await act(async () => checkbox?.click())
    await act(async () => button("Actualizar 1").click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => root.render(createElement(Pending, {
      ...props,
      monitoredInstallationIds: new Set<string>(),
    })))

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector(".pending-batch")).toBeNull()
    expect(container.textContent).toContain("No hay acciones pendientes")
  })
})
