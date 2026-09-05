import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ForgeBridge,
  InventoryItemDto,
  MonitoringStateDto,
  OnboardingStateDto,
} from "@forge/contracts"

import { setActiveLocale } from "../i18n.js"
import { OnboardingFlow } from "./OnboardingFlow.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const candidate = {
  candidateId: "candidate_fixture",
  adapterId: "folder",
  displayName: "Agent Skills",
  displayPath: "/safe/skills",
  kind: "user-added" as const,
  access: "read-write" as const,
  writableWithoutElevation: true,
  discovery: { kind: "observed" as const, source: "fixture" },
}
const approved = { ...candidate, rootId: "root_fixture" }
const requiredRoots: OnboardingStateDto = {
  status: "required",
  proposedRoots: [candidate],
  selectedCandidateIds: [candidate.candidateId],
  approvedRoots: [],
}
const completeRoots: OnboardingStateDto = {
  ...requiredRoots,
  status: "complete",
  approvedRoots: [approved],
}
const requiredMonitoring: MonitoringStateDto = {
  status: "required",
  selectedInstallationIds: [],
}

function inventoryItem(id: string): InventoryItemDto {
  return {
    installationId: `installation_${id}`,
    adapterId: "folder",
    rootId: approved.rootId,
    scope: { kind: "global" },
    key: id,
    name: { state: "known", value: id, evidence: { kind: "observed", source: "SKILL.md" } },
    description: { state: "known", value: `Descripción ${id}`, evidence: { kind: "observed", source: "SKILL.md" } },
    declaredVersion: { state: "unknown", evidence: { kind: "unknown" } },
    status: {
      validity: "valid",
      runtimeState: "unknown",
      source: "local",
      update: "current",
      usage: "unavailable",
    },
    observedAt: "2026-08-27T10:00:00.000Z",
  }
}

function inventoryBridge(items: readonly InventoryItemDto[]): ForgeBridge["inventory"] {
  return {
    list: (query) => Promise.resolve({
      items: query.pageSize === 1 ? [] : [...items],
      projects: [],
      nextCursor: null,
      total: query.pageSize === 1 ? 0 : items.length,
      observedAt: "2026-08-27T10:00:00.000Z",
    }),
    inspect: () => Promise.reject(new Error("not used")),
    openEntry: () => Promise.resolve({ ok: true }),
  }
}

let container: HTMLDivElement
let root: Root

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === name)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return button
}

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

describe("OnboardingFlow", () => {
  it("starts a clean install at the intro and does not advance when source approval fails", async () => {
    function Harness() {
      const [sourceError, setSourceError] = useState<string | null>(null)
      return createElement(OnboardingFlow, {
        roots: requiredRoots,
        monitoring: requiredMonitoring,
        inventoryBridge: inventoryBridge([]),
        selectedCandidateIds: new Set([candidate.candidateId]),
        sourceBusy: false,
        sourceError,
        onToggleRoot: vi.fn(),
        onAddFolder: vi.fn(),
        onAddProject: vi.fn(),
        onApproveRoots: async () => {
          setSourceError("La carpeta ya no está disponible")
          throw new Error("approval failed")
        },
        onSaveMonitoring: () => Promise.reject(new Error("not reached")),
        onComplete: vi.fn(),
      })
    }

    await act(async () => root.render(createElement(Harness)))
    expect(container.querySelector("h1")?.textContent)
      .toBe("Entiende todas las skills que ya tienes.")

    await act(async () => buttonNamed("Elegir carpetas").click())
    expect(container.querySelector("h1")?.textContent).toBe("Elige dónde buscar tus skills")
    expect(container.querySelector("h1")).toBe(document.activeElement)

    await act(async () => buttonNamed("Buscar mis skills").click())
    expect(container.querySelector("h1")?.textContent).toBe("Elige dónde buscar tus skills")
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("La carpeta ya no está disponible")
  })

  it("resets owned scroll and focuses the title when source approval opens selection", async () => {
    const skill = inventoryItem("release-checklist")

    await act(async () => root.render(createElement(OnboardingFlow, {
      roots: requiredRoots,
      monitoring: requiredMonitoring,
      inventoryBridge: inventoryBridge([skill]),
      selectedCandidateIds: new Set([candidate.candidateId]),
      sourceBusy: false,
      sourceError: null,
      onToggleRoot: vi.fn(),
      onAddFolder: vi.fn(),
      onAddProject: vi.fn(),
      onApproveRoots: () => Promise.resolve(completeRoots),
      onSaveMonitoring: () => Promise.reject(new Error("not reached")),
      onComplete: vi.fn(),
    })))

    await act(async () => buttonNamed("Elegir carpetas").click())
    const sourceMain = container.querySelector<HTMLElement>("main")
    if (sourceMain === null) throw new Error("Source main is missing")
    sourceMain.scrollTop = 240

    await act(async () => buttonNamed("Buscar mis skills").click())

    const selectionMain = container.querySelector<HTMLElement>("main")
    let title = container.querySelector("h1")
    expect(selectionMain?.scrollTop).toBe(0)
    expect(title?.textContent).toBe("Hemos encontrado 1 skill.")
    expect(title).toBe(document.activeElement)

    await act(async () => buttonNamed("Elegir cuáles seguir").click())
    title = container.querySelector("h1")
    expect(title?.textContent).toBe("Elige las skills que quieres seguir de cerca.")
    expect(title).toBe(document.activeElement)
  })

  it("resumes after approved roots, preserves the skill step on save failure, and succeeds on retry", async () => {
    const skill = inventoryItem("release-checklist")
    const onComplete = vi.fn()
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("No se pudo guardar el seguimiento."))
      .mockResolvedValueOnce({
        status: "complete" as const,
        selectedInstallationIds: [skill.installationId],
        completedAt: "2026-08-27T10:00:00.000Z",
      })

    await act(async () => root.render(createElement(OnboardingFlow, {
      roots: completeRoots,
      monitoring: requiredMonitoring,
      inventoryBridge: inventoryBridge([skill]),
      selectedCandidateIds: new Set([candidate.candidateId]),
      sourceBusy: false,
      sourceError: null,
      onToggleRoot: vi.fn(),
      onAddFolder: vi.fn(),
      onAddProject: vi.fn(),
      onApproveRoots: () => Promise.resolve(completeRoots),
      onSaveMonitoring: save,
      onComplete,
    })))

    expect(container.textContent).not.toContain("Bienvenido a Skillglass")
    expect(container.querySelector("h1")?.textContent).toBe("Hemos encontrado 1 skill.")

    await act(async () => buttonNamed("Elegir cuáles seguir").click())
    expect(container.querySelector("h1")?.textContent).toBe("Elige las skills que quieres seguir de cerca.")
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)

    await act(async () => buttonNamed("Abrir mi inventario").click())
    expect(save).toHaveBeenNthCalledWith(1, [skill.installationId])
    expect(container.querySelector("h1")?.textContent)
      .toBe("Elige las skills que quieres seguir de cerca.")
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("No se pudo guardar el seguimiento.")
    expect(onComplete).not.toHaveBeenCalled()

    await act(async () => buttonNamed("Abrir mi inventario").click())
    expect(save).toHaveBeenCalledTimes(2)
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      status: "complete",
      selectedInstallationIds: [skill.installationId],
    }))
  })

  it("completes a resumed setup with an empty inventory and an empty selection", async () => {
    const onComplete = vi.fn()
    const save = vi.fn(() => Promise.resolve({
      status: "complete" as const,
      selectedInstallationIds: [],
      completedAt: "2026-08-27T10:00:00.000Z",
    }))

    await act(async () => root.render(createElement(OnboardingFlow, {
      roots: completeRoots,
      monitoring: requiredMonitoring,
      inventoryBridge: inventoryBridge([]),
      selectedCandidateIds: new Set([candidate.candidateId]),
      sourceBusy: false,
      sourceError: null,
      onToggleRoot: vi.fn(),
      onAddFolder: vi.fn(),
      onAddProject: vi.fn(),
      onApproveRoots: () => Promise.resolve(completeRoots),
      onSaveMonitoring: save,
      onComplete,
    })))

    expect(container.textContent).toContain("No hemos encontrado skills todavía.")
    await act(async () => buttonNamed("Abrir inventario").click())
    expect(save).toHaveBeenCalledWith([])
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it("offers the tour without putting it in the short path", async () => {
    await act(async () => root.render(createElement(OnboardingFlow, {
      roots: requiredRoots,
      monitoring: requiredMonitoring,
      inventoryBridge: inventoryBridge([]),
      selectedCandidateIds: new Set([candidate.candidateId]),
      sourceBusy: false,
      sourceError: null,
      onToggleRoot: vi.fn(),
      onAddFolder: vi.fn(),
      onAddProject: vi.fn(),
      onApproveRoots: () => Promise.resolve(completeRoots),
      onSaveMonitoring: () => Promise.reject(new Error("not reached")),
      onComplete: vi.fn(),
    })))

    expect(container.textContent).not.toContain("Explicación 1 de 3")
    await act(async () => buttonNamed("Ver tour de 3 pasos").click())
    expect(container.textContent).toContain("Explicación 1 de 3")
    await act(async () => buttonNamed("Continuar").click())
    expect(container.querySelector("h1")?.textContent).toBe("Abre una skill y entiende cómo funciona.")
    await act(async () => buttonNamed("Saltar explicación").click())
    expect(container.querySelector("h1")?.textContent).toBe("Elige dónde buscar tus skills")
  })

  it("persists every observed skill from the quick path", async () => {
    const first = inventoryItem("release-checklist")
    const second = inventoryItem("accessibility-audit")
    const save = vi.fn(() => Promise.resolve({
      status: "complete" as const,
      selectedInstallationIds: [first.installationId, second.installationId],
      completedAt: "2026-08-27T10:00:00.000Z",
    }))

    await act(async () => root.render(createElement(OnboardingFlow, {
      roots: completeRoots,
      monitoring: requiredMonitoring,
      inventoryBridge: inventoryBridge([first, second]),
      selectedCandidateIds: new Set([candidate.candidateId]),
      sourceBusy: false,
      sourceError: null,
      onToggleRoot: vi.fn(),
      onAddFolder: vi.fn(),
      onAddProject: vi.fn(),
      onApproveRoots: () => Promise.resolve(completeRoots),
      onSaveMonitoring: save,
      onComplete: vi.fn(),
    })))

    await act(async () => buttonNamed("Seguir todas y abrir inventario").click())
    expect(save).toHaveBeenCalledWith([first.installationId, second.installationId])
  })
})
