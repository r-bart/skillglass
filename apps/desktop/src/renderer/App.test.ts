import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ForgeBridge, OnboardingStateDto } from "@forge/contracts"

import { App } from "./App.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

const candidate = {
  candidateId: "candidate_fixture",
  adapterId: "folder",
  displayName: "Agent Skills folder · Añadida por ti",
  displayPath: "/safe/skills",
  kind: "user-added" as const,
  access: "read-write" as const,
  writableWithoutElevation: true,
  discovery: { kind: "observed" as const, source: "native-directory-selection" },
}

const approved = { ...candidate, rootId: "root_fixture" }

function onboardingBridge(state: OnboardingStateDto): ForgeBridge["onboarding"] {
  return {
    state: () => Promise.resolve(state),
    proposedRoots: () => Promise.resolve(state.proposedRoots),
    selectAdditionalRoot: () => Promise.resolve(null),
    approveRoots: () => Promise.resolve([approved]),
  }
}

const completeState: OnboardingStateDto = {
  status: "complete",
  proposedRoots: [candidate],
  selectedCandidateIds: [candidate.candidateId],
  approvedRoots: [approved],
}

const inventoryBridge: ForgeBridge["inventory"] = {
  list: () => Promise.resolve({
    items: [], projects: [], nextCursor: null, total: 0, observedAt: "2026-08-26T10:00:00.000Z",
  }),
  inspect: () => Promise.reject(new Error("Not part of this renderer test")),
  openEntry: () => Promise.resolve({ ok: true }),
}

const eventBridge: ForgeBridge["events"] = {
  onRootsChanged: () => () => undefined,
  onInventoryChanged: () => () => undefined,
  onOperationProgress: () => () => undefined,
  onOperationCompleted: () => () => undefined,
}

const operationBridge: ForgeBridge["operations"] = {
  selectLocalSource: () => Promise.resolve(null),
  plan: () => Promise.reject(new Error("Not part of this renderer test")),
  confirm: () => Promise.reject(new Error("Not part of this renderer test")),
  undo: () => Promise.reject(new Error("Not part of this renderer test")),
  history: () => Promise.resolve({ items: [] }),
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
  )

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`)
  }

  return button
}

beforeEach(async () => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(App, {
    onboardingBridge: onboardingBridge(completeState), inventoryBridge, eventBridge, operationBridge,
  })))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("Forge application shell", () => {
  it("renders named landmarks and a keyboard skip link", () => {
    const skipLink = container.querySelector<HTMLAnchorElement>('a[href="#main-content"]')
    const main = container.querySelector<HTMLElement>("main#main-content")
    const navigation = container.querySelector<HTMLElement>('nav[aria-label="Secciones principales"]')
    const inspector = container.querySelector<HTMLElement>('aside[aria-labelledby="inspector-title"]')

    expect(skipLink?.textContent).toBe("Saltar al contenido")
    expect(main?.tabIndex).toBe(-1)
    expect(navigation).not.toBeNull()
    expect(inspector).not.toBeNull()
  })

  it("navigates between the MVP placeholder surfaces with semantic buttons", () => {
    expect(container.querySelector("h1")?.textContent).toBe("Inventario")
    expect(buttonNamed("Inventario").getAttribute("aria-current")).toBe("page")

    act(() => buttonNamed("Configuración inicial").click())

    expect(container.querySelector("h1")?.textContent).toBe("Carpetas de skills")
    expect(buttonNamed("Configuración inicial").getAttribute("aria-current")).toBe("page")
  })

  it("exposes the mobile navigation as an accessible disclosure", () => {
    const toggle = buttonNamed("Abrir navegación")

    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(container.querySelector("#mobile-navigation")).toBeNull()

    act(() => toggle.click())

    expect(buttonNamed("Cerrar navegación").getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("#mobile-navigation nav")).not.toBeNull()
  })

  it("does not expose harness activation or destructive controls", () => {
    const controlText = Array.from(container.querySelectorAll("button"))
      .map((button) => button.textContent?.trim() ?? button.getAttribute("aria-label") ?? "")
      .join(" ")

    expect(controlText).not.toMatch(/activar|desactivar|eliminar|borrar|desinstalar/i)
  })

  it("blocks inventory until approval and then saves only selected candidate IDs", async () => {
    const required: OnboardingStateDto = {
      status: "required",
      proposedRoots: [candidate],
      selectedCandidateIds: [candidate.candidateId],
      approvedRoots: [],
    }
    const approveRoots = vi.fn(() => Promise.resolve([approved]))
    const bridge = { ...onboardingBridge(required), approveRoots }
    await act(async () => root.render(createElement(App, { onboardingBridge: bridge, inventoryBridge, eventBridge, operationBridge })))

    expect(container.querySelector("h1")?.textContent).toBe("Carpetas de skills")
    expect(buttonNamed("Inventario").disabled).toBe(true)
    expect(container.textContent).toContain("Lectura y escritura")
    expect(container.textContent).toContain("Evidencia observed")

    await act(async () => buttonNamed("Escanear carpetas aprobadas").click())
    expect(approveRoots).toHaveBeenCalledWith({ candidateIds: [candidate.candidateId] })
    expect(container.querySelector("h1")?.textContent).toBe("Inventario")
  })
})
