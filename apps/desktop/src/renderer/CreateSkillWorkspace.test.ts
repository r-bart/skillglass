import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

beforeEach(() => {
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
})
