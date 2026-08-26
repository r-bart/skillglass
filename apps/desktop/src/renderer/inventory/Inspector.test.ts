import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorView } from "@codemirror/view"

import type {
  ForgeBridge,
  InstallationDetailDto,
} from "@forge/contracts"

import { Inspector } from "./Inspector.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const NOW = "2026-08-26T10:00:00.000Z"
const HASH = "a".repeat(64)

function detail(
  access: "read-write" | "read-only" = "read-write",
): InstallationDetailDto {
  const readOnly = access === "read-only"
  const name = readOnly ? "managed-audit" : "global-review"
  const root = readOnly ? "/safe/managed-audit" : "/safe/global-review"
  return {
    installation: {
      installationId: `installation_${name.replaceAll("-", "_")}`,
      adapterId: "codex",
      rootId: readOnly ? "root_system" : "root_global",
      scope: { kind: readOnly ? "system" : "global" },
      key: name,
      name: {
        state: "known",
        value: name,
        evidence: { kind: "observed", source: `${root}/SKILL.md` },
      },
      description: {
        state: "known",
        value: readOnly ? "Auditoría gestionada" : "Review global",
        evidence: { kind: "observed", source: `${root}/SKILL.md` },
      },
      declaredVersion: {
        state: "unknown",
        evidence: { kind: "unknown", source: "not-declared" },
      },
      status: {
        validity: readOnly ? "invalid" : "valid",
        runtimeState: "unknown",
        source: readOnly ? "read-only" : "local",
        update: "unknown",
        usage: "unavailable",
      },
      observedAt: NOW,
    },
    snapshotId: `snapshot_${name.replaceAll("-", "_")}`,
    locationLabel: root,
    entryFile: "SKILL.md",
    rawEntryContent: `---\nname: ${name}\n---\n\n# ${name}\n\n<script>globalThis.pwned = true</script>\n`,
    contentHash: HASH,
    files: [{
      relativePath: "SKILL.md",
      byteLength: 42,
      sha256: HASH,
      kind: "entry",
    }],
    findings: readOnly ? [{
      code: "FRONTMATTER_NAME_INVALID",
      severity: "error",
      message: "Frontmatter name must be a non-empty string",
      relativeFile: "SKILL.md",
      source: { kind: "adapter", adapterId: "codex" },
    }] : [],
    requirements: [],
    scopeBinding: {
      installationId: `installation_${name.replaceAll("-", "_")}`,
      targetScope: "global",
      relationship: "owned",
      runtimeState: "unknown",
      evidence: { kind: "unknown", source: "codex-runtime-state" },
    },
    precedence: {
      adapterId: "codex",
      targetScope: "global",
      key: name,
      winnerInstallationId: `installation_${name.replaceAll("-", "_")}`,
      candidateInstallationIds: [`installation_${name.replaceAll("-", "_")}`],
      reason: {
        state: "known",
        value: "Only candidate in the effective scope",
        evidence: { kind: "derived", source: "candidate-set" },
      },
      status: "resolved",
    },
    provenance: {
      id: `provenance_${name.replaceAll("-", "_")}`,
      kind: readOnly ? "system" : "unknown",
      sourceLabel: { state: "unknown", evidence: { kind: "unknown" } },
      release: { state: "unknown", evidence: { kind: "unknown" } },
      commit: { state: "unknown", evidence: { kind: "unknown" } },
      license: { state: "unknown", evidence: { kind: "unknown" } },
      managedBy: readOnly ? "runtime" : "unknown",
    },
    capabilities: {
      canInstallSibling: !readOnly,
      canUpdateFromSource: false,
      canEditEntry: !readOnly,
      unavailableReasons: readOnly ? ["Solo lectura"] : [],
    },
  }
}

function bridge(value: InstallationDetailDto): ForgeBridge["inventory"] {
  return {
    list: () => Promise.resolve({
      items: [],
      projects: [],
      nextCursor: null,
      total: 0,
      observedAt: NOW,
    }),
    inspect: () => Promise.resolve(value),
    openEntry: () => Promise.resolve({ ok: true }),
  }
}

function operations(): ForgeBridge["operations"] {
  return {
    selectLocalSource: () => Promise.resolve(null),
    plan: () => Promise.resolve({
      planId: "plan_update",
      kind: "update-entry-content",
      status: "planned",
      createdAt: NOW,
      expiresAt: "2026-08-26T10:15:00.000Z",
      adapterId: "codex",
      installationIds: ["installation_global_review"],
      targetRootId: "root_global",
      affectedScopes: [{ kind: "global" }],
      affectedEntries: [{ action: "modify", rootId: "root_global", installationId: "installation_global_review", relativePath: "global-review/SKILL.md" }],
      preconditions: [], conflicts: [], warnings: [], undo: "persistent",
      summary: "Actualizar global-review/SKILL.md",
    }),
    confirm: () => Promise.resolve({
      operationId: "operation_update",
      planId: "plan_update",
      journalId: "plan_update",
      status: "committed",
      finishedAt: NOW,
      installationIds: ["installation_global_review"],
      message: "Skill actualizada",
      issues: [],
      undoAvailable: true,
    }),
    undo: () => Promise.reject(new Error("Not part of inspector test")),
    history: () => Promise.resolve({ items: [] }),
    refreshUpdates: () => Promise.resolve({ ok: true }),
  }
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === name)
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("Inspector", () => {
  it("has an accessible empty complementary landmark", async () => {
    await act(async () => root.render(createElement(Inspector, {
      inventoryBridge: bridge(detail()),
    })))

    const aside = container.querySelector("aside")
    expect(aside?.getAttribute("aria-labelledby")).toBe("inspector-title")
    expect(container.querySelector("#inspector-title")?.textContent).toBe("Inspector")
    expect(container.textContent).toContain("Ninguna skill seleccionada")
  })

  it("shows exact observed facts, independent statuses, and safe actions", async () => {
    const value = detail()
    const inspect = vi.fn(() => Promise.resolve(value))
    const openEntry = vi.fn(() => Promise.resolve({ ok: true as const }))
    const inventoryBridge = { ...bridge(value), inspect, openEntry }
    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge,
    })))

    expect(inspect).toHaveBeenCalledWith({
      installationId: value.installation.installationId,
    })
    expect(container.textContent).toContain("/safe/global-review/SKILL.md")
    expect([...container.querySelectorAll("*")]
      .filter(({ textContent, children }) => textContent === "Codex" && children.length === 0))
      .toHaveLength(1)
    expect(container.textContent).toContain("Only candidate in the effective scope")
    expect(container.textContent).toContain("candidate-set")
    expect(container.textContent).toContain("Dependencias no observadas")
    expect(container.textContent).not.toContain("Evidencia de precedencia desconocida")
    expect(container.textContent).not.toContain("Ningún requisito declarado")
    expect([...container.querySelectorAll("*")]
      .filter(({ textContent, children }) => textContent === "Observado" && children.length === 0))
      .toHaveLength(1)
    expect([...container.querySelectorAll("*")]
      .filter(({ textContent, children }) => textContent === "Sin datos" && children.length === 0))
      .toHaveLength(1)
    expect(buttonNamed("Editar")).toBeInstanceOf(HTMLButtonElement)
    expect(container.querySelector(".inspector-detail__header .skill-tile")).not.toBeNull()
    expect(container.querySelector(".inspector-detail__description")?.textContent).toBe("Review global")
    expect(container.querySelector(".inspector-detail__scroll")).not.toBeNull()
    expect(container.querySelector(".inspector-footer")?.contains(buttonNamed("Abrir archivo") ?? null)).toBe(true)
    expect(container.querySelector(".inspector-footer")?.contains(buttonNamed("Editar") ?? null)).toBe(true)

    await act(async () => buttonNamed("Abrir archivo")?.click())
    expect(openEntry).toHaveBeenCalledWith({
      installationId: value.installation.installationId,
    })
  })

  it("keeps malformed managed skills inspectable and removes edit capability", async () => {
    const value = detail("read-only")
    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: bridge(value),
    })))

    expect(container.textContent).toContain("No se pudo leer el frontmatter")
    expect(container.textContent).toContain("/safe/managed-audit/SKILL.md")
    expect([...container.querySelectorAll("*")]
      .filter(({ textContent, children }) => textContent === "Solo lectura" && children.length === 0))
      .toHaveLength(1)
    expect(buttonNamed("Abrir archivo")).toBeInstanceOf(HTMLButtonElement)
    expect(buttonNamed("Editar")).toBeUndefined()
    expect(container.querySelector(".inspector-read-only-note")?.textContent).toBe("Solo inspección")
  })

  it("keeps long Windows paths, file names, snapshot ids, and hashes inside the inspector data regions", async () => {
    const base = detail()
    const locationLabel = "C:\\Users\\roberto\\Documents\\a-very-long-project-name-that-must-not-widen-the-inspector\\.agents\\skills\\global-review"
    const entryFile = "nested/another-very-long-directory-name/SKILL.md"
    const fileHash = "b".repeat(64)
    const value: InstallationDetailDto = {
      ...base,
      locationLabel,
      entryFile,
      snapshotId: "snapshot_with_a_long_exact_observed_identifier_0123456789",
      contentHash: fileHash,
      files: [{
        relativePath: "nested/another-very-long-directory-name/SKILL.md",
        byteLength: 4096,
        sha256: fileHash,
        kind: "entry",
      }],
    }

    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: bridge(value),
    })))

    const exactEntryPath = `${locationLabel}\\nested\\another-very-long-directory-name\\SKILL.md`
    expect(container.querySelector(".inspector-path")?.textContent).toBe(exactEntryPath)
    expect(container.textContent).toContain(locationLabel)
    expect(container.textContent).toContain(value.snapshotId)
    expect(container.textContent).toContain(fileHash)
    expect(container.querySelector(".file-hash")?.textContent).toBe(fileHash)
  })

  it("renders Markdown as inert React text and exposes a read-only source view", async () => {
    const value = detail()
    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: bridge(value),
    })))

    expect(container.querySelector(".safe-markdown script")).toBeNull()
    expect(container.querySelector(".safe-markdown img")).toBeNull()
    expect(container.querySelector(".safe-markdown a")).toBeNull()
    expect(container.querySelector(".safe-markdown")?.textContent)
      .toContain("<script>globalThis.pwned = true</script>")

    await act(async () => buttonNamed("Fuente")?.click())
    const source = container.querySelector('[aria-label="Fuente de SKILL.md"]')
    expect(source?.textContent).toBe(value.rawEntryContent)
    expect(buttonNamed("Fuente")?.getAttribute("aria-pressed")).toBe("true")
  })

  it("previews exact edited content before confirming the operation", async () => {
    const value = detail()
    const operationBridge = operations()
    const plan = vi.spyOn(operationBridge, "plan")
    const confirm = vi.spyOn(operationBridge, "confirm")
    const onStatus = vi.fn()
    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: bridge(value),
      operationBridge,
      onStatus,
    })))

    act(() => buttonNamed("Editar")?.click())
    const editorDialog = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(editorDialog?.classList.contains("editor-sheet")).toBe(true)
    expect(editorDialog?.getAttribute("aria-labelledby")).toBe("editor-dialog-title")
    expect(editorDialog?.getAttribute("aria-describedby")).toBe("editor-dialog-description")
    const editorElement = container.querySelector<HTMLElement>(".cm-editor")
    const editor = editorElement === null ? null : EditorView.findFromDOM(editorElement)
    if (editor === null) throw new Error("Editor was not rendered")
    expect(container.querySelector(".editor-sheet__footer")?.contains(buttonNamed("Revisar cambios") ?? null)).toBe(true)
    expect(container.querySelector(".editor-sheet__footer")?.contains(buttonNamed("Cancelar") ?? null)).toBe(true)
    const changed = `${value.rawEntryContent}\nNueva regla verificable.`
    await act(async () => {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: changed } })
    })
    await act(async () => buttonNamed("Revisar cambios")?.click())

    expect(plan).toHaveBeenCalledWith({
      kind: "update-entry-content",
      installationId: value.installation.installationId,
      expectedSnapshotId: value.snapshotId,
      content: changed,
    })
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("/safe/global-review/SKILL.md")
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Nueva regla verificable.")

    await act(async () => buttonNamed("Actualizar skill")?.click())
    expect(confirm).toHaveBeenCalledWith({ planId: "plan_update" })
    expect(onStatus).toHaveBeenCalledWith("Skill actualizada")
  })

  it("closes the editor sheet with Escape and restores focus to its trigger", async () => {
    const value = detail()
    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: bridge(value),
      operationBridge: operations(),
    })))
    const trigger = buttonNamed("Editar")
    trigger?.focus()
    act(() => trigger?.click())
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.contains(document.activeElement)).toBe(true)

    await act(async () => dialog?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })))

    expect(container.querySelector(".editor-sheet")).toBeNull()
    expect(document.activeElement).toBe(buttonNamed("Editar"))
  })

  it("keeps transient editor state mounted during watcher-driven detail refresh", async () => {
    const value = detail()
    let finishRefresh: ((next: InstallationDetailDto) => void) | undefined
    const inventoryBridge = bridge(value)
    const inspect = vi.fn()
      .mockResolvedValueOnce(value)
      .mockImplementationOnce(() => new Promise<InstallationDetailDto>((resolve) => { finishRefresh = resolve }))
    const refreshingBridge = { ...inventoryBridge, inspect }
    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: refreshingBridge,
      operationBridge: operations(),
      revision: 0,
    })))
    act(() => buttonNamed("Editar")?.click())
    expect(container.querySelector(".cm-editor")).not.toBeNull()

    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: refreshingBridge,
      operationBridge: operations(),
      revision: 1,
    })))
    expect(container.querySelector(".cm-editor")).not.toBeNull()
    expect(container.textContent).not.toContain("Cargando inspector…")

    await act(async () => finishRefresh?.(value))
    expect(container.querySelector(".cm-editor")).not.toBeNull()
  })

  it("refuses a source update when main reports local divergence", async () => {
    const base = detail()
    const value: InstallationDetailDto = {
      ...base,
      installation: {
        ...base.installation,
        status: { ...base.installation.status, update: "available" },
      },
      provenance: { ...base.provenance, kind: "forge-import", managedBy: "forge" },
      capabilities: { ...base.capabilities, canUpdateFromSource: true },
    }
    const operationBridge = operations()
    const plan = vi.spyOn(operationBridge, "plan").mockRejectedValue(
      new Error("Installed tree differs from its recorded base"),
    )
    await act(async () => root.render(createElement(Inspector, {
      installationId: value.installation.installationId,
      inventoryBridge: bridge(value),
      operationBridge,
    })))

    await act(async () => buttonNamed("Actualizar")?.click())
    expect(plan).toHaveBeenCalledWith({
      kind: "update-from-local",
      installationId: value.installation.installationId,
      expectedSnapshotId: value.snapshotId,
    })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("Conflicto de actualización")
    expect(dialog?.textContent).toContain("cambios locales")
  })
})
