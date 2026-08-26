import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
    expect([...container.querySelectorAll("*")]
      .filter(({ textContent, children }) => textContent === "Observado" && children.length === 0))
      .toHaveLength(1)
    expect([...container.querySelectorAll("*")]
      .filter(({ textContent, children }) => textContent === "Sin datos" && children.length === 0))
      .toHaveLength(1)
    expect(buttonNamed("Editar")).toBeInstanceOf(HTMLButtonElement)

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
})
