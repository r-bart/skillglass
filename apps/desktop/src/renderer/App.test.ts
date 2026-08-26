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
    selectProject: () => Promise.resolve(state),
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
  refreshUpdates: () => Promise.resolve({ ok: true }),
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

  it("adds a Codex project through the typed onboarding bridge", async () => {
    const required: OnboardingStateDto = {
      status: "required",
      proposedRoots: [candidate],
      selectedCandidateIds: [],
      approvedRoots: [],
    }
    const projectCandidate = {
      ...candidate,
      candidateId: "candidate_project",
      displayName: "Codex · Proyecto",
      displayPath: "/projects/acme/.agents/skills",
      kind: "project" as const,
    }
    const selectedState: OnboardingStateDto = {
      ...required,
      proposedRoots: [candidate, projectCandidate],
      selectedCandidateIds: [projectCandidate.candidateId],
    }
    const selectProject = vi.fn(() => Promise.resolve(selectedState))
    const bridge = { ...onboardingBridge(required), selectProject }
    await act(async () => root.render(createElement(App, {
      onboardingBridge: bridge, inventoryBridge, eventBridge, operationBridge,
    })))

    await act(async () => buttonNamed("Añadir proyecto Codex…").click())

    expect(selectProject).toHaveBeenCalledOnce()
    expect(container.textContent).toContain("/projects/acme/.agents/skills")
    expect(container.querySelector('input[type="checkbox"]:checked')).not.toBeNull()
  })

  it("selects a local directory by token and previews exact install files before confirmation", async () => {
    const selectLocalSource = vi.fn(() => Promise.resolve({
      kind: "directory" as const,
      selectionToken: "a".repeat(32),
      displayName: "local-installable",
      treeHash: "b".repeat(64),
      expiresAt: "2026-08-26T10:15:00.000Z",
    }))
    const plan = vi.fn(() => Promise.resolve({
      planId: "plan_install",
      kind: "install-local" as const,
      status: "planned" as const,
      createdAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T10:15:00.000Z",
      adapterId: "folder",
      installationIds: [],
      targetRootId: approved.rootId,
      affectedScopes: [{ kind: "global" as const }],
      affectedEntries: [{ action: "create" as const, rootId: approved.rootId, relativePath: "local-installable/SKILL.md", afterByteLength: 42, afterSha256: "c".repeat(64) }],
      preconditions: [], conflicts: [], warnings: [], undo: "persistent" as const,
      summary: "Instalar local-installable",
      destinationLabel: "/safe/skills/local-installable",
    }))
    const confirm = vi.fn(() => Promise.resolve({
      operationId: "operation_install",
      planId: "plan_install",
      journalId: "plan_install",
      status: "committed" as const,
      finishedAt: "2026-08-26T10:01:00.000Z",
      installationIds: ["installation_local"],
      message: "Skill instalada",
      issues: [], undoAvailable: true,
    }))
    const bridge: ForgeBridge["operations"] = {
      ...operationBridge,
      selectLocalSource,
      plan,
      confirm,
    }
    await act(async () => root.render(createElement(App, {
      onboardingBridge: onboardingBridge(completeState), inventoryBridge, eventBridge, operationBridge: bridge,
    })))

    await act(async () => buttonNamed("Instalar desde carpeta").click())
    expect(selectLocalSource).toHaveBeenCalledWith({ kind: "directory" })
    expect(plan).toHaveBeenCalledWith({
      kind: "install-local",
      source: {
        kind: "directory",
        selectionToken: "a".repeat(32),
        suggestedName: "local-installable",
        treeHash: "b".repeat(64),
      },
      targetRootId: approved.rootId,
    })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute("aria-labelledby")).toBe("install-dialog-title")
    expect(dialog?.textContent).toContain("/safe/skills/local-installable")
    expect(dialog?.textContent).toContain("local-installable/SKILL.md")

    await act(async () => buttonNamed("Instalar skill").click())
    expect(confirm).toHaveBeenCalledWith({ planId: "plan_install" })
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Skill instalada")
  })

  it("requires an explicit destination choice when several approved roots are writable", async () => {
    const projectCandidate = {
      ...candidate,
      candidateId: "candidate_project",
      displayName: "Codex · Proyecto",
      displayPath: "/projects/acme/.agents/skills",
      kind: "project" as const,
    }
    const second = { ...projectCandidate, rootId: "root_project" }
    const state: OnboardingStateDto = {
      status: "complete",
      proposedRoots: [candidate, projectCandidate],
      selectedCandidateIds: [candidate.candidateId, second.candidateId],
      approvedRoots: [approved, second],
    }
    const selectLocalSource = vi.fn(() => Promise.resolve({
      kind: "directory" as const,
      selectionToken: "a".repeat(32),
      displayName: "local-installable",
      treeHash: "b".repeat(64),
      expiresAt: "2026-08-26T10:15:00.000Z",
    }))
    const plan = vi.fn(() => Promise.reject(new Error("stop after observing the selected target")))
    await act(async () => root.render(createElement(App, {
      onboardingBridge: onboardingBridge(state),
      inventoryBridge,
      eventBridge,
      operationBridge: { ...operationBridge, selectLocalSource, plan },
    })))

    await act(async () => buttonNamed("Instalar desde carpeta").click())
    expect(plan).not.toHaveBeenCalled()
    const target = container.querySelector<HTMLSelectElement>("#install-target")
    if (target === null) throw new Error("install target selector missing")
    await act(async () => {
      target.value = second.rootId
      target.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => buttonNamed("Continuar").click())
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ targetRootId: second.rootId }))
  })

  it("announces authoritative operation progress and completion", async () => {
    let progress: Parameters<ForgeBridge["events"]["onOperationProgress"]>[0] = () => undefined
    let completed: Parameters<ForgeBridge["events"]["onOperationCompleted"]>[0] = () => undefined
    const bridge: ForgeBridge["events"] = {
      ...eventBridge,
      onOperationProgress: (listener) => {
        progress = listener
        return () => undefined
      },
      onOperationCompleted: (listener) => {
        completed = listener
        return () => undefined
      },
    }
    await act(async () => root.render(createElement(App, {
      onboardingBridge: onboardingBridge(completeState), inventoryBridge, eventBridge: bridge, operationBridge,
    })))

    act(() => progress({
      operationId: "operation_install",
      planId: "plan_install",
      journalId: "plan_install",
      stage: "applying",
      message: "Aplicando instalación",
    }))
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Aplicando instalación")

    act(() => completed({
      operationId: "operation_install",
      planId: "plan_install",
      journalId: "plan_install",
      status: "committed",
      finishedAt: "2026-08-26T10:01:00.000Z",
      installationIds: ["installation_local"],
      message: "Skill instalada",
      issues: [],
      undoAvailable: true,
    }))
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Skill instalada")
  })

  it("announces scan and watcher findings instead of silently dropping them", async () => {
    let inventoryChanged: Parameters<ForgeBridge["events"]["onInventoryChanged"]>[0] = () => undefined
    const bridge: ForgeBridge["events"] = {
      ...eventBridge,
      onInventoryChanged: (listener) => {
        inventoryChanged = listener
        return () => undefined
      },
    }
    await act(async () => root.render(createElement(App, {
      onboardingBridge: onboardingBridge(completeState), inventoryBridge, eventBridge: bridge, operationBridge,
    })))

    act(() => inventoryChanged({
      installationIds: [],
      reason: "watcher",
      observedAt: "2026-08-26T10:02:00.000Z",
      findings: [{ code: "WATCHER_ERROR", severity: "warning", message: "No se pudo observar una carpeta" }],
    }))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo observar una carpeta")
  })
})
