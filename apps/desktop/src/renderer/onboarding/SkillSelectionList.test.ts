import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { InventoryItemDto } from "@forge/contracts"

import { setActiveLocale } from "../i18n.js"
import { SkillSelectionList } from "./SkillSelectionList.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const OBSERVED_AT = "2026-08-27T10:00:00.000Z"

function item(
  id: string,
  name: string,
  scope: InventoryItemDto["scope"],
): InventoryItemDto {
  return {
    installationId: `installation_${id}`,
    adapterId: "codex",
    rootId: scope.kind === "project" ? `root_${scope.projectId}` : "root_global",
    scope,
    key: name,
    name: { state: "known", value: name, evidence: { kind: "observed", source: "SKILL.md" } },
    description: { state: "known", value: `Descripción ${name}`, evidence: { kind: "observed", source: "SKILL.md" } },
    declaredVersion: { state: "unknown", evidence: { kind: "unknown" } },
    status: {
      validity: "valid",
      runtimeState: "unknown",
      source: "local",
      update: "current",
      usage: "unavailable",
    },
    observedAt: OBSERVED_AT,
  }
}

const globalSkill = item("global", "accessibility-audit", { kind: "global" })
const releaseSkill = item("release", "release-checklist", { kind: "project", projectId: "project_acme" })
const apiSkill = item("api", "api-contract-review", { kind: "project", projectId: "project_acme" })
const otherSkill = item("other", "content-check", { kind: "project", projectId: "project_other" })
const items = [globalSkill, releaseSkill, apiSkill, otherSkill]
const projects = [
  { projectId: "project_acme", displayName: "Acme Web" },
  { projectId: "project_other", displayName: "Other" },
]

let container: HTMLDivElement
let root: Root

function inputText(control: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (setter === undefined) throw new Error("Native input value setter missing")
  setter.call(control, value)
  control.dispatchEvent(new Event("input", { bubbles: true }))
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === name)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return button
}

function Harness({ onSelection }: {
  readonly onSelection: (selection: ReadonlySet<string>) => void
}) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    new Set([globalSkill.installationId]),
  )
  return createElement(SkillSelectionList, {
    items,
    projects,
    rootDisplayPaths: new Map([
      ["root_global", "/global/skills"],
      ["root_project_acme", "/projects/acme/.agents/skills"],
      ["root_project_other", "/projects/other/.agents/skills"],
    ]),
    selectedInstallationIds: selection,
    onSelectionChange: (next) => {
      onSelection(next)
      setSelection(next)
    },
  })
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

describe("SkillSelectionList", () => {
  it("filters by project and search while toggle-visible preserves hidden selections", async () => {
    const onSelection = vi.fn()
    await act(async () => root.render(createElement(Harness, { onSelection })))

    const project = container.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por proyecto"]')
    if (project === null) throw new Error("Project filter missing")
    await act(async () => {
      project.value = "project_acme"
      project.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.textContent).toContain("release-checklist")
    expect(container.textContent).toContain("api-contract-review")
    expect(container.textContent).not.toContain("content-check")

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error("Search input missing")
    await act(async () => inputText(search, "release"))
    expect(container.querySelectorAll('.skill-selection__list input[type="checkbox"]')).toHaveLength(1)

    await act(async () => buttonNamed("Seleccionar las visibles").click())
    const selectedAfterSearch = onSelection.mock.lastCall?.[0] as ReadonlySet<string>
    expect([...selectedAfterSearch]).toEqual([
      globalSkill.installationId,
      releaseSkill.installationId,
    ])

    await act(async () => inputText(search, ""))
    await act(async () => buttonNamed("Seleccionar las visibles").click())
    const selectedAfterProject = onSelection.mock.lastCall?.[0] as ReadonlySet<string>
    expect(selectedAfterProject.has(globalSkill.installationId)).toBe(true)
    expect(selectedAfterProject.has(releaseSkill.installationId)).toBe(true)
    expect(selectedAfterProject.has(apiSkill.installationId)).toBe(true)
    expect(selectedAfterProject.has(otherSkill.installationId)).toBe(false)
  })

  it("shows distinct zero-results copy and allows an empty inventory to complete", async () => {
    const onComplete = vi.fn()
    await act(async () => root.render(createElement(SkillSelectionList, {
      items: [],
      projects: [],
      rootDisplayPaths: new Map(),
      selectedInstallationIds: new Set<string>(),
      onSelectionChange: vi.fn(),
      onComplete,
    })))

    expect(container.textContent).toContain("No se han observado skills")
    const complete = buttonNamed("Abrir mi inventario")
    expect(complete.disabled).toBe(false)
    await act(async () => complete.click())
    expect(onComplete).toHaveBeenCalledOnce()
  })
})
