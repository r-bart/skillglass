import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorView } from "@codemirror/view"

import type { ForgeBridge, OnboardingStateDto, OperationPlanDto, OperationResultDto } from "@forge/contracts"

import { CreateSkillWorkspace } from "./CreateSkillWorkspace.js"
import { setActiveLocale } from "./i18n.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let reactRoot: Root

const approvedRoot: OnboardingStateDto["approvedRoots"][number] = {
  rootId: "root_create",
  adapterId: "folder",
  displayName: "Agent Skills folder",
  displayPath: "/safe/skills",
  kind: "user-added",
  access: "read-write",
  writableWithoutElevation: true,
  discovery: { kind: "observed", source: "test" },
}

function createPlan(): OperationPlanDto {
  return {
    planId: "plan_create_fixture",
    kind: "create-skill",
    status: "planned",
    createdAt: "2026-08-27T10:00:00.000Z",
    expiresAt: "2099-08-27T10:15:00.000Z",
    adapterId: "folder",
    installationIds: [],
    targetRootId: approvedRoot.rootId,
    affectedScopes: [{ kind: "global" }],
    affectedEntries: [{ action: "create", rootId: approvedRoot.rootId, relativePath: "contract-review/SKILL.md" }],
    preconditions: [],
    conflicts: [],
    warnings: [],
    undo: "persistent",
    summary: "Crear contract-review/SKILL.md",
  }
}

function committed(): OperationResultDto {
  return {
    operationId: "operation_create_fixture",
    planId: "plan_create_fixture",
    journalId: "plan_create_fixture",
    status: "committed",
    finishedAt: "2026-08-27T10:01:00.000Z",
    installationIds: ["installation_created"],
    message: "Skill creada",
    issues: [],
    undoAvailable: true,
  }
}

function bridge(overrides: Partial<ForgeBridge["operations"]> = {}): ForgeBridge["operations"] {
  return {
    selectLocalSource: () => Promise.resolve(null),
    plan: () => Promise.resolve(createPlan()),
    confirm: () => Promise.resolve(committed()),
    undo: () => Promise.reject(new Error("not used")),
    history: () => Promise.resolve({ items: [] }),
    refreshUpdates: () => Promise.resolve({ ok: true }),
    ...overrides,
  }
}

function setField(selector: string, value: string): void {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (field === null) throw new Error(`Field not found: ${selector}`)
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value)
  field.dispatchEvent(new Event("input", { bubbles: true }))
}

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return match
}

function replaceDraft(content: string): void {
  const contentElement = container.querySelector<HTMLElement>(".cm-content")
  const editor = contentElement === null ? null : EditorView.findFromDOM(contentElement)
  if (editor === null) throw new Error("CodeMirror was not rendered")
  act(() => editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: content },
  }))
}

beforeEach(() => {
  setActiveLocale("es")
  container = document.createElement("div")
  document.body.append(container)
  reactRoot = createRoot(container)
})

afterEach(async () => {
  await act(async () => reactRoot.unmount())
  setActiveLocale("es")
  container.remove()
})

describe("CreateSkillWorkspace", () => {
  it("protects fields entered before authoring and clears the guard when they return to their initial values", async () => {
    const onBack = vi.fn()
    const onCloseStateChange = vi.fn()
    await act(async () => reactRoot.render(createElement(CreateSkillWorkspace, {
      operationBridge: bridge(), roots: [approvedRoot], onBack, onCreated: vi.fn(), onCloseStateChange,
    })))
    expect(onCloseStateChange).toHaveBeenLastCalledWith("clean")

    act(() => setField("#create-skill-key", "contract-review"))
    expect(onCloseStateChange).toHaveBeenLastCalledWith("dirty")
    act(() => button("Cancelar").click())
    const dialog = container.querySelector('[aria-labelledby="discard-create-title"]')
    expect(dialog).not.toBeNull()
    expect((container.querySelector("#create-skill-key") as HTMLInputElement).value).toBe("contract-review")
    expect(onBack).not.toHaveBeenCalled()

    await act(async () => button("Seguir editando").click())
    expect((container.querySelector("#create-skill-key") as HTMLInputElement).value).toBe("contract-review")
    act(() => setField("#create-skill-key", ""))
    expect(onCloseStateChange).toHaveBeenLastCalledWith("clean")
    act(() => button("Cancelar").click())
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("builds a first-class draft and uses Changes to plan before creating", async () => {
    const plan = vi.fn(() => Promise.resolve(createPlan()))
    const confirm = vi.fn(() => Promise.resolve(committed()))
    const onCreated = vi.fn()
    await act(async () => reactRoot.render(createElement(CreateSkillWorkspace, {
      operationBridge: bridge({ plan, confirm }), roots: [approvedRoot], onBack: vi.fn(), onCreated,
    })))

    act(() => {
      setField("#create-skill-key", "contract-review")
      setField("#create-skill-description", "Review contracts safely")
    })
    act(() => button("Abrir borrador").click())

    expect(container.querySelector(".cm-editor")).not.toBeNull()
    expect(container.textContent).toContain("contract-review/SKILL.md")
    const changes = container.querySelector<HTMLButtonElement>("#create-skill-changes-tab")
    expect(changes?.disabled).toBe(false)

    await act(async () => changes?.click())
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      kind: "create-skill",
      targetRootId: approvedRoot.rootId,
      skillKey: "contract-review",
      content: expect.stringContaining("name: contract-review"),
    }))
    expect(container.querySelector(".text-diff")?.getAttribute("data-removed")).toBe("0")
    expect(container.textContent).toContain("Crear contract-review/SKILL.md")

    await act(async () => button("Crear skill").click())
    expect(confirm).toHaveBeenCalledWith({ planId: "plan_create_fixture" })
    expect(onCreated).toHaveBeenCalledWith("installation_created")
  })

  it("stays dirty in authoring when the draft is empty but its identifying fields changed", async () => {
    const onBack = vi.fn()
    const onCloseStateChange = vi.fn()
    await act(async () => reactRoot.render(createElement(CreateSkillWorkspace, {
      operationBridge: bridge(), roots: [approvedRoot], onBack, onCreated: vi.fn(), onCloseStateChange,
    })))

    act(() => {
      setField("#create-skill-key", "contract-review")
      setField("#create-skill-description", "Review contracts safely")
      button("Abrir borrador").click()
    })
    replaceDraft("")

    expect(onCloseStateChange).toHaveBeenLastCalledWith("dirty")
    act(() => button("Volver al inventario").click())
    expect(container.querySelector('[aria-labelledby="discard-create-title"]')).not.toBeNull()
    expect(onBack).not.toHaveBeenCalled()
  })

  it("does not open a draft with an unsafe key", async () => {
    await act(async () => reactRoot.render(createElement(CreateSkillWorkspace, {
      operationBridge: bridge(), roots: [approvedRoot], onBack: vi.fn(), onCreated: vi.fn(),
    })))
    act(() => {
      setField("#create-skill-key", "Bad/Path")
      setField("#create-skill-description", "Unsafe")
      button("Abrir borrador").click()
    })
    expect(container.querySelector("[role='alert']")?.textContent).toContain("minúsculas")
    expect(container.querySelector(".cm-editor")).toBeNull()
  })

  it("creates an English starter template when the interface is in English", async () => {
    setActiveLocale("en")
    const plan = vi.fn(() => Promise.resolve(createPlan()))
    await act(async () => reactRoot.render(createElement(CreateSkillWorkspace, {
      operationBridge: bridge({ plan }), roots: [approvedRoot], onBack: vi.fn(), onCreated: vi.fn(),
    })))

    act(() => {
      setField("#create-skill-key", "contract-review")
      setField("#create-skill-description", "Review contracts safely")
      button("Open draft").click()
    })
    await act(async () => container.querySelector<HTMLButtonElement>("#create-skill-changes-tab")?.click())

    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("## When to use this skill"),
    }))
  })

  it("keeps the new skill title and description verbatim in an English preview", async () => {
    setActiveLocale("en")
    await act(async () => reactRoot.render(createElement(CreateSkillWorkspace, {
      operationBridge: bridge(), roots: [approvedRoot], onBack: vi.fn(), onCreated: vi.fn(),
    })))

    act(() => {
      setField("#create-skill-key", "detalles")
      setField("#create-skill-description", "Carpetas")
      button("Open draft").click()
    })

    expect(container.querySelector(".skill-preview__header h2")?.textContent).toBe("Detalles")
    expect(container.querySelector(".skill-preview__header p:last-child")?.textContent).toBe("Carpetas")
    expect(container.querySelector(".skill-preview__header")?.textContent).not.toContain("Folders")
  })
})
