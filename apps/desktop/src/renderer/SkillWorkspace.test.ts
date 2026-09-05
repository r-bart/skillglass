import { EditorView } from "@codemirror/view"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ForgeBridge,
  InstallationDetailDto,
  OperationPlanDto,
  OperationResultDto,
} from "@forge/contracts"

import { SkillWorkspace } from "./SkillWorkspace.js"
import { setActiveLocale } from "./i18n.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const NOW = "2026-08-27T08:00:00.000Z"
const INSTALLATION_ID = "installation_workspace_skill"
const BASE_CONTENT = "---\nname: workspace-skill\ndescription: Base\n---\n\n# Workspace\n\nBase rule.\n"
const DRAFT_CONTENT = "---\nname: workspace-skill\ndescription: Base\n---\n\n# Workspace\n\nChanged rule.\n"

function detail(options: {
  readonly content?: string
  readonly readOnly?: boolean
  readonly snapshotId?: string
} = {}): InstallationDetailDto {
  const readOnly = options.readOnly === true
  const content = options.content ?? BASE_CONTENT
  return {
    installation: {
      installationId: INSTALLATION_ID,
      adapterId: "codex",
      rootId: readOnly ? "root_managed" : "root_global",
      scope: { kind: readOnly ? "system" : "global" },
      key: "workspace-skill",
      name: {
        state: "known",
        value: "workspace-skill",
        evidence: { kind: "observed", source: "/safe/workspace-skill/SKILL.md" },
      },
      description: {
        state: "known",
        value: "Workspace fixture",
        evidence: { kind: "observed", source: "/safe/workspace-skill/SKILL.md" },
      },
      declaredVersion: {
        state: "unknown",
        evidence: { kind: "unknown", source: "not-declared" },
      },
      status: {
        validity: "valid",
        runtimeState: "unknown",
        source: readOnly ? "read-only" : "local",
        update: "current",
        usage: "unavailable",
      },
      observedAt: NOW,
    },
    snapshotId: options.snapshotId ?? "snapshot_workspace_base",
    locationLabel: "/safe/workspace-skill",
    entryFile: "SKILL.md",
    rawEntryContent: content,
    contentHash: "a".repeat(64),
    files: [{
      relativePath: "SKILL.md",
      byteLength: content.length,
      sha256: "a".repeat(64),
      kind: "entry",
    }],
    findings: [],
    requirements: [],
    scopeBinding: {
      installationId: INSTALLATION_ID,
      targetScope: "global",
      relationship: "owned",
      runtimeState: "unknown",
      evidence: { kind: "unknown", source: "codex-runtime-state" },
    },
    provenance: {
      id: "provenance_workspace",
      kind: "local",
      sourceLabel: { state: "unknown", evidence: { kind: "unknown" } },
      release: { state: "unknown", evidence: { kind: "unknown" } },
      commit: { state: "unknown", evidence: { kind: "unknown" } },
      license: { state: "unknown", evidence: { kind: "unknown" } },
      managedBy: readOnly ? "runtime" : "user",
    },
    capabilities: {
      canInstallSibling: !readOnly,
      canUpdateFromSource: false,
      canEditEntry: !readOnly,
      unavailableReasons: readOnly ? ["Contenido gestionado"] : [],
    },
  }
}

function updatePlan(overrides: Partial<OperationPlanDto> = {}): OperationPlanDto {
  return {
    planId: "plan_workspace_update",
    kind: "update-entry-content",
    status: "planned",
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    adapterId: "codex",
    installationIds: [INSTALLATION_ID],
    targetRootId: "root_global",
    affectedScopes: [{ kind: "global" }],
    affectedEntries: [{
      action: "modify",
      rootId: "root_global",
      installationId: INSTALLATION_ID,
      relativePath: "workspace-skill/SKILL.md",
      beforeByteLength: BASE_CONTENT.length,
      beforeSha256: "a".repeat(64),
      afterByteLength: DRAFT_CONTENT.length,
      afterSha256: "b".repeat(64),
    }],
    preconditions: [],
    conflicts: [],
    warnings: [],
    undo: "persistent",
    summary: "Actualizar workspace-skill/SKILL.md",
    ...overrides,
  }
}

function operationResult(
  status: OperationResultDto["status"] = "committed",
): OperationResultDto {
  return {
    operationId: "operation_workspace_update",
    planId: "plan_workspace_update",
    journalId: "journal_workspace_update",
    status,
    finishedAt: NOW,
    installationIds: [INSTALLATION_ID],
    message: status === "committed" ? "Skill actualizada" : `Actualización ${status}`,
    issues: status === "committed" ? [] : [{ code: `UPDATE_${status.toUpperCase()}`, message: `Detalle ${status}` }],
    undoAvailable: status === "committed",
  }
}

function inventoryBridge(inspect: ForgeBridge["inventory"]["inspect"]): ForgeBridge["inventory"] {
  return {
    list: () => Promise.resolve({ items: [], projects: [], nextCursor: null, total: 0, observedAt: NOW }),
    inspect,
    openEntry: () => Promise.resolve({ ok: true }),
  }
}

function operationBridge(
  overrides: Partial<ForgeBridge["operations"]> = {},
): ForgeBridge["operations"] {
  return {
    selectLocalSource: () => Promise.resolve(null),
    plan: () => Promise.resolve(updatePlan()),
    confirm: () => Promise.resolve(operationResult()),
    undo: () => Promise.reject(new Error("Not part of workspace test")),
    history: () => Promise.resolve({ items: [] }),
    refreshUpdates: () => Promise.resolve({ ok: true }),
    ...overrides,
  }
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return button
}

function editorView(): EditorView {
  const element = container.querySelector<HTMLElement>(".cm-editor")
  const editor = element === null ? null : EditorView.findFromDOM(element)
  if (editor === null) throw new Error("CodeMirror editor was not rendered")
  return editor
}

function replaceDraft(content: string): void {
  const editor = editorView()
  act(() => editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: content },
  }))
}

async function renderWorkspace(options: {
  readonly inspect?: ForgeBridge["inventory"]["inspect"]
  readonly onBack?: () => void
  readonly onCommitted?: (next: InstallationDetailDto) => void
  readonly onStatus?: (message: string) => void
  readonly operations?: ForgeBridge["operations"]
  readonly onCloseStateChange?: (state: "clean" | "dirty" | "busy") => void
} = {}): Promise<void> {
  const inspect = options.inspect ?? (() => Promise.resolve(detail()))
  await act(async () => root.render(createElement(SkillWorkspace, {
    installationId: INSTALLATION_ID,
    inventoryBridge: inventoryBridge(inspect),
    operationBridge: options.operations ?? operationBridge(),
    ...(options.onBack === undefined ? {} : { onBack: options.onBack }),
    ...(options.onCommitted === undefined ? {} : { onCommitted: options.onCommitted }),
    ...(options.onStatus === undefined ? {} : { onStatus: options.onStatus }),
    ...(options.onCloseStateChange === undefined ? {} : { onCloseStateChange: options.onCloseStateChange }),
  })))
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
  setActiveLocale("es")
  container.remove()
})

describe("SkillWorkspace", () => {
  it("keeps an observed skill name verbatim in the English workspace header", async () => {
    setActiveLocale("en")
    const base = detail()
    await renderWorkspace({
      inspect: () => Promise.resolve({
        ...base,
        installation: {
          ...base.installation,
          key: "Detalles",
          name: { state: "known", value: "Detalles", evidence: { kind: "observed", source: "Detalles" } },
        },
        locationLabel: "Detalles",
      }),
    })

    expect(container.querySelector("#skill-workspace-title")?.textContent).toBe("Detalles")
    expect(container.textContent).not.toContain("Details/SKILL.md")
  })

  it("reports exact draft changes and becomes clean when the editor returns to the loaded content", async () => {
    const onCloseStateChange = vi.fn()
    await renderWorkspace({ onCloseStateChange })
    expect(onCloseStateChange).toHaveBeenLastCalledWith("clean")

    replaceDraft(DRAFT_CONTENT)
    expect(onCloseStateChange).toHaveBeenLastCalledWith("dirty")
    replaceDraft(BASE_CONTENT)
    expect(onCloseStateChange).toHaveBeenLastCalledWith("clean")
  })

  it("shows loading, then keeps Preview, Code, and Changes mounted in one workspace", async () => {
    let finishInspect: ((value: InstallationDetailDto) => void) | undefined
    const inspect = vi.fn(() => new Promise<InstallationDetailDto>((resolve) => { finishInspect = resolve }))

    await renderWorkspace({ inspect })
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Cargando skill")

    await act(async () => finishInspect?.(detail()))
    expect(container.querySelector(".skill-workspace--ready")).not.toBeNull()
    expect(container.querySelector("#skill-workspace-preview-panel")).not.toBeNull()
    expect(container.querySelector("#skill-workspace-code-panel")).not.toBeNull()
    expect(container.querySelector("#skill-workspace-changes-panel")).not.toBeNull()
    expect(buttonNamed("Código").getAttribute("aria-selected")).toBe("true")

    replaceDraft(DRAFT_CONTENT)
    act(() => buttonNamed("Vista previa").click())
    expect(container.querySelector(".skill-preview .safe-markdown")?.textContent).toContain("Changed rule.")
    expect(container.querySelector(".cm-editor")).not.toBeNull()
    expect(container.querySelector("#skill-workspace-code-panel")?.hasAttribute("hidden")).toBe(true)
  })

  it.each([
    {
      label: "not found",
      inspect: () => Promise.reject(Object.assign(new Error("Installation not found"), { code: "INSTALLATION_NOT_FOUND" })),
      expectedClass: "skill-workspace--not-found",
      expectedText: "Skill no encontrada",
    },
    {
      label: "inspection failure",
      inspect: () => Promise.reject(new Error("Database unavailable")),
      expectedClass: "skill-workspace--error",
      expectedText: "Database unavailable",
    },
  ])("renders the $label state without mounting an editor", async ({ inspect, expectedClass, expectedText }) => {
    await renderWorkspace({ inspect })

    expect(container.querySelector(`.${expectedClass}`)?.textContent).toContain(expectedText)
    expect(container.querySelector(".cm-editor")).toBeNull()
  })

  it("refuses a read-only observation before creating an edit session", async () => {
    await renderWorkspace({ inspect: () => Promise.resolve(detail({ readOnly: true })) })

    expect(container.querySelector(".skill-workspace--read-only")?.textContent)
      .toContain("Contenido gestionado")
    expect(container.querySelector(".cm-editor")).toBeNull()
  })

  it("plans the immutable snapshot and exact draft before exposing an inline confirmation", async () => {
    const plan = vi.fn(() => Promise.resolve(updatePlan()))
    const confirm = vi.fn(() => Promise.resolve(operationResult()))
    await renderWorkspace({ operations: operationBridge({ plan, confirm }) })
    replaceDraft(DRAFT_CONTENT)

    await act(async () => buttonNamed("Revisar cambios").click())

    expect(plan).toHaveBeenCalledWith({
      kind: "update-entry-content",
      installationId: INSTALLATION_ID,
      expectedSnapshotId: "snapshot_workspace_base",
      content: DRAFT_CONTENT,
    })
    const confirmation = container.querySelector<HTMLElement>(".workspace-confirmation[role='dialog']")
    expect(confirmation?.getAttribute("aria-labelledby")).toBe("skill-workspace-confirm-title")
    expect(confirmation?.textContent).toContain("Actualizar workspace-skill/SKILL.md")
    expect(confirmation?.textContent).toContain("Changed rule.")
    expect(confirmation?.querySelector(".text-diff")?.getAttribute("data-added")).toBe("1")
    expect(confirmation?.querySelector(".text-diff")?.getAttribute("data-removed")).toBe("1")
    expect(confirm).not.toHaveBeenCalled()
  })

  it("invalidates a reviewed plan as soon as the draft changes", async () => {
    const plan = vi.fn(() => Promise.resolve(updatePlan()))
    const confirm = vi.fn(() => Promise.resolve(operationResult()))
    await renderWorkspace({ operations: operationBridge({ plan, confirm }) })
    replaceDraft(DRAFT_CONTENT)
    await act(async () => buttonNamed("Revisar cambios").click())

    act(() => buttonNamed("Código").click())
    const revisedDraft = `${DRAFT_CONTENT}\nSecond revision.\n`
    replaceDraft(revisedDraft)

    expect(container.querySelector<HTMLButtonElement>("#skill-workspace-changes-tab")?.disabled).toBe(false)
    expect(buttonNamed("Actualizar skill").disabled).toBe(true)
    expect(confirm).not.toHaveBeenCalled()

    await act(async () => container.querySelector<HTMLButtonElement>("#skill-workspace-changes-tab")?.click())
    expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ content: revisedDraft }))
    expect(buttonNamed("Actualizar skill").disabled).toBe(false)
  })

  it("commits one reviewed plan, re-inspects, and establishes a clean Preview baseline", async () => {
    const committed = detail({ content: DRAFT_CONTENT, snapshotId: "snapshot_workspace_committed" })
    const inspect = vi.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(committed)
    const confirm = vi.fn(() => Promise.resolve(operationResult()))
    const onCommitted = vi.fn()
    const onStatus = vi.fn()
    await renderWorkspace({
      inspect,
      onCommitted,
      onStatus,
      operations: operationBridge({ confirm }),
    })
    replaceDraft(DRAFT_CONTENT)
    await act(async () => buttonNamed("Revisar cambios").click())

    await act(async () => buttonNamed("Actualizar skill").click())

    expect(confirm).toHaveBeenCalledWith({ planId: "plan_workspace_update" })
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(inspect).toHaveBeenLastCalledWith({ installationId: INSTALLATION_ID })
    expect(buttonNamed("Vista previa").getAttribute("aria-selected")).toBe("true")
    expect(container.querySelector(".workspace-change-state")?.textContent).toBe("Sin cambios")
    expect(container.querySelector(".skill-preview .safe-markdown")?.textContent).toContain("Changed rule.")
    expect(onStatus).toHaveBeenCalledWith("Skill actualizada")
    expect(onCommitted).toHaveBeenCalledWith(committed)
  })

  it("guards dirty Back, restores focus when cancelled, and exits only after destructive confirmation", async () => {
    const onBack = vi.fn()
    const plan = vi.fn(() => Promise.resolve(updatePlan()))
    const confirm = vi.fn(() => Promise.resolve(operationResult()))
    await renderWorkspace({ onBack, operations: operationBridge({ plan, confirm }) })
    replaceDraft(DRAFT_CONTENT)
    const back = buttonNamed("Volver al inventario")
    back.focus()

    act(() => back.click())
    expect(onBack).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-labelledby="discard-workspace-title"]')).not.toBeNull()

    await act(async () => buttonNamed("Seguir editando").click())
    expect(document.activeElement).toBe(back)
    expect(editorView().state.doc.toString()).toBe(DRAFT_CONTENT)

    act(() => back.click())
    act(() => buttonNamed("Descartar y salir").click())
    expect(onBack).toHaveBeenCalledOnce()
    expect(plan).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it("discards the local draft in place and announces the clean state", async () => {
    const onBack = vi.fn()
    await renderWorkspace({ onBack })
    replaceDraft(DRAFT_CONTENT)

    expect(container.querySelector('.workspace-footer [role="status"]')?.textContent)
      .toContain("Cambios locales")
    act(() => buttonNamed("Descartar").click())

    expect(editorView().state.sliceDoc()).toBe(BASE_CONTENT)
    expect(buttonNamed("Código").getAttribute("aria-selected")).toBe("true")
    expect(container.querySelector('[aria-labelledby="discard-workspace-title"]')).toBeNull()
    expect(container.querySelector('.workspace-footer p[aria-live="polite"]')?.textContent)
      .toContain("Edición local")
    expect(onBack).not.toHaveBeenCalled()
  })

  it("rejects expired and conflicting plans without confirmation or draft loss", async () => {
    const expiredConfirm = vi.fn(() => Promise.resolve(operationResult()))
    await renderWorkspace({
      operations: operationBridge({
        plan: () => Promise.resolve(updatePlan({
          status: "expired",
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        })),
        confirm: expiredConfirm,
      }),
    })
    replaceDraft(DRAFT_CONTENT)
    await act(async () => buttonNamed("Revisar cambios").click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("caducado")
    expect(buttonNamed("Código").getAttribute("aria-selected")).toBe("true")
    expect(editorView().state.doc.toString()).toBe(DRAFT_CONTENT)
    expect(expiredConfirm).not.toHaveBeenCalled()

    const conflictConfirm = vi.fn(() => Promise.resolve(operationResult()))
    await act(async () => root.render(createElement(SkillWorkspace, {
      installationId: INSTALLATION_ID,
      inventoryBridge: inventoryBridge(() => Promise.resolve(detail())),
      key: "conflict-plan",
      operationBridge: operationBridge({
        plan: () => Promise.resolve(updatePlan({
          status: "blocked",
          conflicts: [{ code: "LOCAL_DIVERGENCE", message: "El snapshot ya no coincide" }],
        })),
        confirm: conflictConfirm,
      }),
    })))
    replaceDraft(DRAFT_CONTENT)
    await act(async () => buttonNamed("Revisar cambios").click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("snapshot ya no coincide")
    expect(editorView().state.doc.toString()).toBe(DRAFT_CONTENT)
    expect(conflictConfirm).not.toHaveBeenCalled()
  })

  it("keeps the exact draft and performs no confirmation when planning fails", async () => {
    const confirm = vi.fn(() => Promise.resolve(operationResult()))
    await renderWorkspace({
      operations: operationBridge({
        plan: () => Promise.reject(new Error("No se pudo preparar el plan")),
        confirm,
      }),
    })
    replaceDraft(DRAFT_CONTENT)

    await act(async () => buttonNamed("Revisar cambios").click())

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("No se pudo preparar el plan")
    expect(buttonNamed("Código").getAttribute("aria-selected")).toBe("true")
    expect(editorView().state.doc.toString()).toBe(DRAFT_CONTENT)
    expect(buttonNamed("Recargar desde disco")).toBeInstanceOf(HTMLButtonElement)
    expect(confirm).not.toHaveBeenCalled()
  })

  it.each(["stale", "conflict", "failed"] as const)(
    "preserves the reviewed draft when confirmation returns %s",
    async (status) => {
      const inspect = vi.fn(() => Promise.resolve(detail()))
      const onCommitted = vi.fn()
      const onCloseStateChange = vi.fn()
      const confirm = vi.fn(() => Promise.resolve(operationResult(status)))
      await renderWorkspace({ inspect, onCommitted, onCloseStateChange, operations: operationBridge({ confirm }) })
      replaceDraft(DRAFT_CONTENT)
      await act(async () => buttonNamed("Revisar cambios").click())

      await act(async () => buttonNamed("Actualizar skill").click())

      expect(confirm).toHaveBeenCalledWith({ planId: "plan_workspace_update" })
      expect(container.querySelector(".workspace-confirmation [role='alert']")?.textContent)
        .toContain(`Actualización ${status}`)
      expect(container.querySelector(".inline-diff")?.textContent).toContain("Changed rule.")
      expect(editorView().state.doc.toString()).toBe(DRAFT_CONTENT)
      expect(buttonNamed("Actualizar skill").disabled).toBe(true)
      expect(buttonNamed("Recargar desde disco")).toBeInstanceOf(HTMLButtonElement)
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(onCommitted).not.toHaveBeenCalled()
      expect(onCloseStateChange).toHaveBeenLastCalledWith("dirty")
    },
  )

  it("requires destructive confirmation before replacing a failed draft from disk", async () => {
    const disk = detail({
      content: `${BASE_CONTENT}\nDisk-only rule.`,
      snapshotId: "snapshot_workspace_disk",
    })
    const inspect = vi.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(disk)
    const confirm = vi.fn(() => Promise.resolve(operationResult("stale")))
    await renderWorkspace({ inspect, operations: operationBridge({ confirm }) })
    replaceDraft(DRAFT_CONTENT)
    await act(async () => buttonNamed("Revisar cambios").click())
    await act(async () => buttonNamed("Actualizar skill").click())

    const reload = buttonNamed("Recargar desde disco")
    reload.focus()
    act(() => reload.click())
    expect(container.querySelector('[aria-labelledby="reload-workspace-title"]')?.textContent)
      .toContain("Se descartará el draft local")
    expect(inspect).toHaveBeenCalledTimes(1)

    await act(async () => buttonNamed("Cancelar").click())
    expect(document.activeElement).toBe(reload)
    expect(editorView().state.doc.toString()).toBe(DRAFT_CONTENT)

    act(() => reload.click())
    await act(async () => buttonNamed("Descartar y recargar").click())
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(editorView().state.doc.toString()).toBe(disk.rawEntryContent)
    expect(container.querySelector(".workspace-change-state")?.textContent).toBe("Sin cambios")
    expect(buttonNamed("Código").getAttribute("aria-selected")).toBe("true")
  })
})
