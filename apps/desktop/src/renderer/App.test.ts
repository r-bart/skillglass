import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ForgeBridge,
  InstallationDetailDto,
  MonitoringStateDto,
  OnboardingStateDto,
} from "@forge/contracts"

import { App } from "./App.js"
import { setActiveLocale } from "./i18n.js"

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

const completeMonitoringState: MonitoringStateDto = {
  status: "complete",
  selectedInstallationIds: [],
  completedAt: "2026-08-27T10:00:00.000Z",
}

function monitoringBridge(
  state: MonitoringStateDto = completeMonitoringState,
): ForgeBridge["monitoring"] {
  return {
    state: () => Promise.resolve(state),
    save: ({ installationIds }) => Promise.resolve({
      status: "complete",
      selectedInstallationIds: [...installationIds],
      completedAt: "2026-08-27T10:00:00.000Z",
    }),
  }
}

const workspaceDetail: InstallationDetailDto = {
  installation: {
    installationId: "installation_app_workspace",
    adapterId: "codex",
    rootId: "root_fixture",
    scope: { kind: "global" },
    key: "app-workspace",
    name: {
      state: "known",
      value: "app-workspace",
      evidence: { kind: "observed", source: "/safe/skills/app-workspace/SKILL.md" },
    },
    description: {
      state: "known",
      value: "Workspace integration fixture",
      evidence: { kind: "observed", source: "/safe/skills/app-workspace/SKILL.md" },
    },
    declaredVersion: {
      state: "unknown",
      evidence: { kind: "unknown", source: "not-declared" },
    },
    status: {
      validity: "valid",
      runtimeState: "unknown",
      source: "local",
      update: "current",
      usage: "unavailable",
    },
    observedAt: "2026-08-27T08:00:00.000Z",
  },
  snapshotId: "snapshot_app_workspace",
  locationLabel: "/safe/skills/app-workspace",
  entryFile: "SKILL.md",
  rawEntryContent: "---\nname: app-workspace\ndescription: Fixture\n---\n\n# App workspace\n",
  contentHash: "a".repeat(64),
  files: [{
    relativePath: "SKILL.md",
    byteLength: 72,
    sha256: "a".repeat(64),
    kind: "entry",
  }],
  findings: [],
  requirements: [],
  provenance: {
    id: "provenance_app_workspace",
    kind: "local",
    sourceLabel: { state: "unknown", evidence: { kind: "unknown" } },
    release: { state: "unknown", evidence: { kind: "unknown" } },
    commit: { state: "unknown", evidence: { kind: "unknown" } },
    license: { state: "unknown", evidence: { kind: "unknown" } },
    managedBy: "user",
  },
  capabilities: {
    canInstallSibling: true,
    canUpdateFromSource: false,
    canEditEntry: true,
    unavailableReasons: [],
  },
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

function installMemoryStorage(): void {
  const values = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size },
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => { values.set(key, value) },
    } satisfies Storage,
  })
}

beforeEach(async () => {
  setActiveLocale("es")
  installMemoryStorage()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(App, {
    onboardingBridge: onboardingBridge(completeState), inventoryBridge,
    monitoringBridge: monitoringBridge(), eventBridge, operationBridge,
  })))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("Forge application shell", () => {
  it("switches the complete interface between Spanish and English and remembers the choice", async () => {
    expect(container.querySelector("h1")?.textContent).toBe("Inventario")

    await act(async () => buttonNamed("EN").click())

    expect(document.documentElement.lang).toBe("en")
    expect(container.querySelector("h1")?.textContent).toBe("Inventory")
    expect(container.querySelector('nav[aria-label="Main sections"]')).not.toBeNull()
    expect(container.textContent).toContain("All skills")
    expect(window.localStorage.getItem("skill-forge.locale")).toBe("en")

    await act(async () => buttonNamed("ES").click())
    expect(container.querySelector("h1")?.textContent).toBe("Inventario")
  })

  it("renders named landmarks and hides the inspector until a skill is selected", () => {
    const skipLink = container.querySelector<HTMLAnchorElement>('a[href="#main-content"]')
    const main = container.querySelector<HTMLElement>("main#main-content")
    const navigation = container.querySelector<HTMLElement>('nav[aria-label="Secciones principales"]')
    const inspector = container.querySelector<HTMLElement>('aside[aria-labelledby="inspector-title"]')
    const appBody = container.querySelector<HTMLElement>(".app-body")
    const githubLink = container.querySelector<HTMLAnchorElement>('.app-sidebar__repository-link')

    expect(skipLink?.textContent).toBe("Saltar al contenido")
    expect(main?.tabIndex).toBe(-1)
    expect(navigation).not.toBeNull()
    expect(inspector).toBeNull()
    expect(appBody?.classList.contains("app-body--without-inspector")).toBe(true)
    expect(container.textContent).toContain("Skill Forge v0.0.0")
    expect(container.textContent).not.toContain("Sin cuenta ni nube")
    expect(githubLink?.href).toBe("https://github.com/r-bart")
    expect(githubLink?.target).toBe("_blank")
  })

  it("mounts inventory search and location navigation once in the app chrome", () => {
    const search = container.querySelector<HTMLInputElement>('#inventory-search-slot input[type="search"]')
    const navigation = container.querySelector<HTMLElement>('nav[aria-label="Secciones principales"]')

    expect(search?.labels?.[0]?.textContent).toContain("Buscar skills")
    expect(navigation?.textContent).toContain("Todas las skills")
    expect(navigation?.textContent).toContain("Global")
    expect(container.querySelectorAll('input[type="search"]')).toHaveLength(1)
    expect(container.querySelectorAll('nav[aria-label="Secciones principales"]')).toHaveLength(1)
  })

  it("resets the owning content panel when navigating", async () => {
    const main = container.querySelector<HTMLElement>("#main-content")
    if (main === null) throw new Error("main content missing")
    main.scrollTop = 128

    await act(async () => buttonNamed("Todas las skills").click())

    expect(main.scrollTop).toBe(0)
  })

  it("navigates between the MVP placeholder surfaces with semantic buttons", async () => {
    expect(container.querySelector("h1")?.textContent).toBe("Inventario")
    expect(buttonNamed("Todas las skills").getAttribute("aria-current")).toBe("page")

    act(() => buttonNamed("Carpetas").click())

    expect(container.querySelector("h1")?.textContent).toBe("Carpetas de skills")
    expect(buttonNamed("Carpetas").getAttribute("aria-current")).toBe("page")

    await act(async () => buttonNamed("Por revisar").click())
    expect(container.querySelector("h1")?.textContent).toBe("Por revisar")
    expect(buttonNamed("Por revisar").getAttribute("aria-current")).toBe("page")
  })

  it("keeps review in sidebar navigation and opens creation as a first-class workspace", async () => {
    const topbar = container.querySelector<HTMLElement>(".app-topbar")
    const sidebar = container.querySelector<HTMLElement>(".app-sidebar")
    expect(topbar?.textContent).not.toContain("Por revisar")
    expect(sidebar?.textContent).toContain("Por revisar")

    const trigger = buttonNamed("Crear skill")
    trigger.focus()
    act(() => trigger.click())

    expect(container.querySelector(".app-shell")?.classList.contains("app-shell--workspace")).toBe(true)
    expect(container.querySelector(".create-skill-workspace--details")).not.toBeNull()
    expect(container.querySelector(".app-brand__context")?.textContent).toBe("Crear skill")

    act(() => buttonNamed("Volver al inventario").click())
    expect(container.querySelector(".create-skill-workspace")).toBeNull()
    expect(document.activeElement).toBe(buttonNamed("Crear skill"))
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
    const save = vi.fn(({ installationIds }: { installationIds: readonly string[] }) => Promise.resolve({
      status: "complete" as const,
      selectedInstallationIds: [...installationIds],
      completedAt: "2026-08-27T10:00:00.000Z",
    }))
    await act(async () => root.render(createElement(App, {
      onboardingBridge: bridge,
      inventoryBridge,
      monitoringBridge: {
        state: () => Promise.resolve({ status: "required" as const, selectedInstallationIds: [] }),
        save,
      },
      eventBridge,
      operationBridge,
    })))

    expect(container.querySelector("h1")?.textContent).toBe("Entiende todas las skills que ya tienes.")
    await act(async () => buttonNamed("Saltar explicación").click())
    expect(container.querySelector("h1")?.textContent).toBe("Elige dónde buscar tus skills")
    expect(container.textContent).toContain("Lectura y escritura")
    expect(container.textContent).toContain("Evidencia: observada")

    await act(async () => buttonNamed("Buscar mis skills").click())
    expect(approveRoots).toHaveBeenCalledWith({ candidateIds: [candidate.candidateId] })
    expect(container.querySelector("h1")?.textContent).toBe("Elige las skills que quieres seguir de cerca.")
    await act(async () => buttonNamed("Abrir mi inventario").click())
    expect(save).toHaveBeenCalledWith({ installationIds: [] })
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
      onboardingBridge: bridge, inventoryBridge,
      monitoringBridge: monitoringBridge({ status: "required", selectedInstallationIds: [] }),
      eventBridge, operationBridge,
    })))

    await act(async () => buttonNamed("Saltar explicación").click())
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
      onboardingBridge: onboardingBridge(completeState), inventoryBridge,
      monitoringBridge: monitoringBridge(), eventBridge, operationBridge: bridge,
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
      monitoringBridge: monitoringBridge(),
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
      onboardingBridge: onboardingBridge(completeState), inventoryBridge,
      monitoringBridge: monitoringBridge(), eventBridge: bridge, operationBridge,
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
      onboardingBridge: onboardingBridge(completeState), inventoryBridge,
      monitoringBridge: monitoringBridge(), eventBridge: bridge, operationBridge,
    })))

    await act(async () => inventoryChanged({
      installationIds: [],
      reason: "watcher",
      observedAt: "2026-08-26T10:02:00.000Z",
      findings: [{ code: "WATCHER_ERROR", severity: "warning", message: "No se pudo observar una carpeta" }],
    }))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo observar una carpeta")
  })

  it("restores monitoring for a persisted skill when it reappears during the session", async () => {
    let inventoryChanged: Parameters<ForgeBridge["events"]["onInventoryChanged"]>[0] = () => undefined
    const events: ForgeBridge["events"] = {
      ...eventBridge,
      onInventoryChanged: (listener) => {
        inventoryChanged = listener
        return () => undefined
      },
    }
    let nextMonitoring: MonitoringStateDto = {
      status: "complete",
      selectedInstallationIds: [],
      completedAt: "2026-08-27T10:00:00.000Z",
    }
    const state = vi.fn(() => Promise.resolve(nextMonitoring))
    const inventory: ForgeBridge["inventory"] = {
      ...inventoryBridge,
      list: () => Promise.resolve({
        items: [workspaceDetail.installation],
        projects: [],
        nextCursor: null,
        total: 1,
        observedAt: "2026-08-27T10:00:00.000Z",
      }),
    }
    await act(async () => root.render(createElement(App, {
      onboardingBridge: onboardingBridge(completeState),
      inventoryBridge: inventory,
      monitoringBridge: { ...monitoringBridge(), state },
      eventBridge: events,
      operationBridge,
    })))

    expect(container.textContent).not.toContain("En seguimiento")
    nextMonitoring = {
      ...nextMonitoring,
      selectedInstallationIds: [workspaceDetail.installation.installationId],
    }

    await act(async () => inventoryChanged({
      installationIds: [workspaceDetail.installation.installationId],
      reason: "watcher",
      observedAt: "2026-08-27T10:01:00.000Z",
      findings: [],
    }))

    expect(state).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("En seguimiento")
  })

  it("opens the workspace from Inspector and restores the mounted library context and focus", async () => {
    const list = vi.fn(() => Promise.resolve({
      items: [workspaceDetail.installation],
      projects: [{ projectId: "project_fixture", displayName: "Fixture project" }],
      nextCursor: null,
      total: 1,
      observedAt: "2026-08-27T08:00:00.000Z",
    }))
    const inspect = vi.fn(() => Promise.resolve(workspaceDetail))
    const bridge: ForgeBridge["inventory"] = {
      list,
      inspect,
      openEntry: () => Promise.resolve({ ok: true }),
    }
    await act(async () => root.render(createElement(App, {
      onboardingBridge: onboardingBridge(completeState),
      inventoryBridge: bridge,
      monitoringBridge: monitoringBridge({
        status: "complete",
        selectedInstallationIds: [workspaceDetail.installation.installationId],
        completedAt: "2026-08-27T10:00:00.000Z",
      }),
      eventBridge,
      operationBridge,
    })))

    await act(async () => buttonNamed("Global").click())
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: { kind: "global" } }))
    const row = container.querySelector<HTMLElement>(".inventory-row")
    if (row === null) throw new Error("Inventory row missing")
    await act(async () => row.click())

    expect(container.querySelector(".inspector")).not.toBeNull()
    expect(container.querySelector(".app-body")?.classList.contains("app-body--without-inspector")).toBe(false)

    const edit = buttonNamed("Editar")
    edit.focus()
    await act(async () => edit.click())

    const library = container.querySelector<HTMLElement>(".app-library")
    expect(container.querySelector(".app-shell")?.classList.contains("app-shell--workspace")).toBe(true)
    expect(library?.hidden).toBe(true)
    expect(library?.hasAttribute("inert")).toBe(true)
    expect(library?.querySelector(".inventory-row")).toBe(row)
    expect(library?.querySelector(".inspector")).not.toBeNull()
    expect(container.querySelector(".main-content--workspace .skill-workspace")).not.toBeNull()
    expect(container.querySelector(".app-brand__context")?.textContent).toBe("Editar skill")
    expect(buttonNamed("Historial")).toBeInstanceOf(HTMLButtonElement)
    const topbar = container.querySelector(".app-topbar")
    expect([...(topbar?.querySelectorAll("button") ?? [])].some(({ textContent }) => textContent?.trim() === "Por revisar")).toBe(false)
    expect([...(topbar?.querySelectorAll("summary") ?? [])].some(({ textContent }) => textContent?.includes("Instalar"))).toBe(false)
    expect(container.querySelector(".refresh-button")).toBeNull()
    expect(buttonNamed("Global").getAttribute("aria-current")).toBe("page")
    expect(row.getAttribute("aria-selected")).toBe("true")

    await act(async () => buttonNamed("Volver al inventario").click())

    expect(library?.hidden).toBe(false)
    expect(library?.hasAttribute("inert")).toBe(false)
    expect(container.querySelector(".skill-workspace")).toBeNull()
    expect(buttonNamed("Global").getAttribute("aria-current")).toBe("page")
    expect(row.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(edit)
  })

  it("presents persistent history as a labelled sheet with internal actions", async () => {
    const history = vi.fn(() => Promise.resolve({
      items: [{
        journalId: "journal_history_update",
        kind: "update-entry-content" as const,
        installationIds: ["installation_history"],
        createdAt: "2026-08-26T10:00:00.000Z",
        undoAvailable: true,
      }],
    }))
    await act(async () => root.render(createElement(App, {
      onboardingBridge: onboardingBridge(completeState),
      inventoryBridge,
      monitoringBridge: monitoringBridge(),
      eventBridge,
      operationBridge: { ...operationBridge, history },
    })))
    const trigger = buttonNamed("Historial")

    trigger.focus()
    await act(async () => trigger.click())

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.classList.contains("history-sheet")).toBe(true)
    expect(dialog?.getAttribute("aria-labelledby")).toBe("history-dialog-title")
    expect(dialog?.getAttribute("aria-describedby")).toBe("history-dialog-description")
    expect(dialog?.querySelector(".history-sheet__body")?.textContent).toContain("Actualización de contenido")
    expect(dialog?.querySelector(".history-sheet__footer")?.textContent).toContain("1 operación registrada")
    expect(buttonNamed("Deshacer actualización")).toBeInstanceOf(HTMLButtonElement)
    expect(dialog?.contains(document.activeElement)).toBe(true)

    await act(async () => dialog?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })))
    expect(container.querySelector(".history-sheet")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
