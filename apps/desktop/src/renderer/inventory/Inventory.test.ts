import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ForgeBridge,
  InventoryItemDto,
  InventoryPageDto,
} from "@forge/contracts"

import { setActiveLocale } from "../i18n.js"
import { Inventory } from "./Inventory.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const OBSERVED_AT = "2026-08-26T10:00:00.000Z"

function item(
  id: string,
  name: string,
  scope: InventoryItemDto["scope"],
  author?: string,
): InventoryItemDto {
  return {
    installationId: `installation_${id}`,
    adapterId: id === "folder_skill" ? "folder" : "codex",
    rootId: scope.kind === "project" ? "root_project" : "root_global",
    scope,
    key: name,
    name: {
      state: "known",
      value: name,
      evidence: { kind: "observed", source: "SKILL.md" },
    },
    description: {
      state: "known",
      value: `Descripción de ${name}`,
      evidence: { kind: "observed", source: "SKILL.md" },
    },
    declaredVersion: {
      ...(id === "global_review"
        ? { state: "known" as const, value: "1.4.2", evidence: { kind: "observed" as const, source: "frontmatter.version" } }
        : { state: "unknown" as const, evidence: { kind: "unknown" as const, source: "frontmatter.version" } }),
    },
    ...(author === undefined
      ? {}
      : {
          author: {
            state: "known" as const,
            value: author,
            evidence: { kind: "observed" as const, source: "SKILL.md" },
          },
        }),
    status: {
      validity: id === "folder_skill" ? "invalid" : "valid",
      runtimeState: "unknown",
      source: id === "folder_skill" ? "read-only" : "local",
      update: id === "global_review" ? "current" : id === "project_release" ? "available" : "unknown",
      usage: "unavailable",
    },
    observedAt: OBSERVED_AT,
  }
}

const inventoryItems: readonly InventoryItemDto[] = [
  item("global_review", "global-review", { kind: "global" }, "Ada"),
  item(
    "project_release",
    "project-release",
    { kind: "project", projectId: "project_acme" },
    "Grace",
  ),
  item(
    "folder_skill",
    "broken-frontmatter",
    { kind: "project", projectId: "project_acme" },
  ),
]

const basePage: InventoryPageDto = {
  items: [...inventoryItems],
  projects: [{ projectId: "project_acme", displayName: "Acme Web" }],
  nextCursor: null,
  total: inventoryItems.length,
  observedAt: OBSERVED_AT,
}

function bridge(
  list: ForgeBridge["inventory"]["list"],
): ForgeBridge["inventory"] {
  return {
    list,
    inspect: () => Promise.reject(new Error("Inspector belongs to Task 4.4")),
    openEntry: () => Promise.resolve({ ok: true }),
  }
}

function selectLabeled(label: string): HTMLSelectElement {
  const control = [...container.querySelectorAll("label")]
    .find((candidate) => candidate.querySelector("span")?.textContent === label)
    ?.querySelector("select")
  if (!(control instanceof HTMLSelectElement)) {
    throw new Error(`Select not found: ${label}`)
  }
  return control
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === name)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`)
  }
  return button
}

function inputText(control: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  if (setter === undefined) throw new Error("Native input value setter missing")
  setter.call(control, value)
  control.dispatchEvent(new Event("input", { bubbles: true }))
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
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
  container.remove()
})

describe("Inventory", () => {
  it("navigates Todas las skills, true Global, and a project as distinct queries", async () => {
    const list = vi.fn(() => Promise.resolve(basePage))
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(list),
    })))

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: "all" },
    }))
    expect(buttonNamed("Todas las skills").getAttribute("aria-pressed")).toBe("true")

    await act(async () => buttonNamed("Global").click())
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: "global" },
    }))

    await act(async () => buttonNamed("Acme Web").click())
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: "project", projectId: "project_acme" },
    }))
  })

  it("submits accessible search, evidence-aware filters, grouping, and sorting", async () => {
    const list = vi.fn(() => Promise.resolve(basePage))
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(list),
    })))

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    expect(search?.labels?.[0]?.textContent).toContain("Buscar skills")
    expect(selectLabeled("Validez").labels?.[0]?.textContent).toContain("Validez")

    await act(async () => {
      if (search === null) throw new Error("Search field is missing")
      inputText(search, "release")
    })
    const validity = selectLabeled("Validez")
    await act(async () => {
      validity.value = "invalid"
      validity.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const provenance = selectLabeled("Procedencia")
    await act(async () => {
      provenance.value = "local"
      provenance.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const order = selectLabeled("Orden")
    await act(async () => {
      order.value = "observedAt:desc"
      order.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const grouping = selectLabeled("Agrupar")
    await act(async () => {
      grouping.value = "author"
      grouping.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const author = selectLabeled("Autor")
    await act(async () => {
      author.value = "Ada"
      author.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({
      search: "release",
      validity: ["invalid"],
      provenanceKinds: ["local"],
      authors: ["Ada"],
      groupBy: "author",
      sort: { by: "observedAt", direction: "desc" },
    }))
    expect(container.textContent).toContain("Sin autor observado")
  })

  it("keeps the full filter set behind disclosure and exposes removable active chips", async () => {
    const list = vi.fn(() => Promise.resolve(basePage))
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(list),
    })))

    const disclosure = container.querySelector<HTMLDetailsElement>(".inventory-filter-disclosure")
    const trigger = disclosure?.querySelector<HTMLElement>("summary")
    expect(disclosure?.open).toBe(false)
    expect(trigger?.getAttribute("aria-label")).toBe("Mostrar filtros del inventario")
    expect(disclosure?.querySelectorAll("select").length).toBeGreaterThanOrEqual(6)

    await act(async () => trigger?.click())
    expect(disclosure?.open).toBe(true)

    const validity = selectLabeled("Validez")
    await act(async () => {
      validity.value = "invalid"
      validity.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ validity: ["invalid"] }))
    expect(container.querySelector(".inventory-active-filters")?.textContent).toContain("Validez: Inválidas")
    expect(disclosure?.querySelector("summary")?.getAttribute("aria-label")).toContain("1 activos")

    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Quitar filtro Validez: Inválidas"]',
    )
    await act(async () => remove?.click())
    expect(list).toHaveBeenLastCalledWith(expect.not.objectContaining({ validity: expect.anything() }))
    expect(container.querySelector(".inventory-active-filters")).toBeNull()
  })

  it("focuses and selects the real search field with the platform find shortcut", async () => {
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(() => Promise.resolve(basePage)),
    })))
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error("Search field is missing")
    await act(async () => inputText(search, "release"))
    search.blur()

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "f",
        [/Mac|iPhone|iPad/u.test(navigator.platform) ? "metaKey" : "ctrlKey"]: true,
      }))
    })

    expect(document.activeElement).toBe(search)
    expect(search.selectionStart).toBe(0)
    expect(search.selectionEnd).toBe(search.value.length)
  })

  it("does not capture the platform find shortcut while the inventory is inactive", async () => {
    await act(async () => root.render(createElement(Inventory, {
      active: false,
      inventoryBridge: bridge(() => Promise.resolve(basePage)),
    })))
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error("Search field is missing")
    search.blur()

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "f",
        [/Mac|iPhone|iPad/u.test(navigator.platform) ? "metaKey" : "ctrlKey"]: true,
      }))
    })

    expect(document.activeElement).not.toBe(search)
  })

  it("supports mouse and arrow-key selection with a single roving tab stop", async () => {
    const onSelectionChange = vi.fn()
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(() => Promise.resolve(basePage)),
      onSelectionChange,
    })))

    const rows = [...container.querySelectorAll<HTMLTableRowElement>(".inventory-row")]
    expect(rows.map(({ tabIndex }) => tabIndex)).toEqual([0, -1, -1])

    await act(async () => rows[0]?.click())
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true")
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      "installation_global_review",
    )

    await act(async () => {
      rows[0]?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowDown",
      }))
    })
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(rows[1])
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      "installation_project_release",
    )
  })

  it("renders semantic dense rows with stable tiles and independent observed evidence", async () => {
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(() => Promise.resolve(basePage)),
    })))

    const table = container.querySelector<HTMLTableElement>('.inventory-table[role="grid"]')
    const rows = [...container.querySelectorAll<HTMLTableRowElement>('.inventory-row[role="row"]')]
    expect(table?.getAttribute("aria-label")).toBe("Skills instaladas")
    expect(rows).toHaveLength(3)

    const globalRow = rows[0]
    expect(globalRow?.textContent).toContain("global-review")
    expect(globalRow?.textContent).toContain("Global")
    expect(globalRow?.textContent).toContain("Descripción de global-review")
    expect(globalRow?.textContent).toContain("1.4.2")
    expect(globalRow?.querySelectorAll(".inventory-evidence-pill")).toHaveLength(0)
    expect(globalRow?.querySelector(".inventory-evidence-marker--current")?.getAttribute("aria-label"))
      .toBe("Actualización: Actualizada")
    expect(globalRow?.querySelector(".skill-tile")?.getAttribute("data-tile")).toMatch(/blue|green|amber|plum|steel/u)

    const projectRow = rows[1]
    expect(projectRow?.textContent).toContain("Acme Web")
    expect(projectRow?.querySelector('[aria-label="Actualización: Actualización disponible"]')).not.toBeNull()
    expect(projectRow?.querySelector(".inventory-evidence-marker--available")?.getAttribute("aria-label"))
      .toBe("Actualización: Actualización disponible")
    expect(projectRow?.querySelector(".inventory-row__version")).toBeNull()

    const unknownUpdateMarker = rows[2]?.querySelector(".inventory-evidence-marker--unknown")
    expect(unknownUpdateMarker?.getAttribute("aria-label")).toBe("Actualización: Sin datos")
    expect(rows[2]?.querySelector(".inventory-evidence-marker--available")).toBeNull()
    expect(rows[2]?.querySelector('[aria-label="Origen: Solo lectura"]')).not.toBeNull()
    expect(rows[2]?.querySelector('[aria-label="Validez: Inválida"]')).not.toBeNull()
  })

  it("labels managed and system read-only rows as managed while preserving read-only for other roots", async () => {
    const managed: InventoryItemDto = {
      ...item("managed_audit", "managed-audit", { kind: "managed" }),
      status: {
        ...item("managed_audit", "managed-audit", { kind: "managed" }).status,
        source: "read-only",
      },
    }
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(() => Promise.resolve({ ...basePage, items: [managed], total: 1 })),
    })))

    expect(container.querySelector(".inventory-evidence-pill--source")?.textContent).toBe("Gestionada")
    expect(container.querySelector(".inventory-row")?.textContent).not.toContain("Solo lectura")

    const system = { ...managed, scope: { kind: "system" as const } }
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(() => Promise.resolve({ ...basePage, items: [system], total: 1 })),
    })))
    expect(container.querySelector(".inventory-evidence-pill--source")?.textContent).toBe("Gestionada")
  })

  it("keeps unmonitored installations visible and badges only monitored rows", async () => {
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(() => Promise.resolve(basePage)),
      monitoredInstallationIds: new Set(["installation_project_release"]),
    })))

    const rows = [...container.querySelectorAll<HTMLTableRowElement>(".inventory-row")]
    expect(rows).toHaveLength(inventoryItems.length)
    expect(rows.find((row) => row.textContent?.includes("global-review"))?.textContent)
      .not.toContain("En seguimiento")
    expect(rows.find((row) => row.textContent?.includes("project-release"))?.textContent)
      .toContain("En seguimiento")
    expect(container.querySelectorAll(".inventory-monitoring-pill")).toHaveLength(1)
  })

  it("loads the next deterministic cursor page without replacing visible rows", async () => {
    const list = vi.fn((query) => Promise.resolve(query.cursor === undefined
      ? {
          ...basePage,
          items: [inventoryItems[0] as InventoryItemDto],
          nextCursor: "installation_global_review",
          total: 2,
        }
      : {
          ...basePage,
          items: [inventoryItems[1] as InventoryItemDto],
          nextCursor: null,
          total: 2,
        }))
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(list),
    })))

    expect(container.querySelectorAll(".inventory-row")).toHaveLength(1)
    expect(container.textContent).toContain("1 de 2 instalaciones")
    await act(async () => buttonNamed("Cargar más instalaciones").click())

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: "installation_global_review",
    }))
    expect(container.querySelectorAll(".inventory-row")).toHaveLength(2)
    expect(container.textContent).toContain("2 instalaciones")
  })

  it("ignores a late pagination response after the query changes", async () => {
    let resolveMore: ((page: InventoryPageDto) => void) | undefined
    const list = vi.fn((query) => {
      if (query.cursor !== undefined) {
        return new Promise<InventoryPageDto>((resolve) => { resolveMore = resolve })
      }
      if (query.search !== undefined) {
        return Promise.resolve({ ...basePage, items: [inventoryItems[2] as InventoryItemDto], nextCursor: null, total: 1 })
      }
      return Promise.resolve({
        ...basePage,
        items: [inventoryItems[0] as InventoryItemDto],
        nextCursor: "installation_global_review",
        total: 2,
      })
    })
    await act(async () => root.render(createElement(Inventory, { inventoryBridge: bridge(list) })))

    act(() => buttonNamed("Cargar más instalaciones").click())
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    await act(async () => {
      if (search === null) throw new Error("Search field is missing")
      inputText(search, "broken")
    })
    await settle()
    expect(container.textContent).toContain("broken-frontmatter")

    await act(async () => resolveMore?.({
      ...basePage,
      items: [inventoryItems[1] as InventoryItemDto],
      nextCursor: null,
      total: 2,
    }))
    expect(container.textContent).not.toContain("project-release")
  })

  it("keeps observed author and package labels verbatim in English filters and chips", async () => {
    setActiveLocale("en")
    const observed: InventoryItemDto = {
      ...item("observed_labels", "observed-labels", { kind: "global" }, "Detalles"),
      packageId: { state: "known", value: "Carpetas", evidence: { kind: "observed", source: "SKILL.md" } },
    }
    const page = { ...basePage, items: [observed], total: 1 }
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(() => Promise.resolve(page)),
    })))

    act(() => container.querySelector<HTMLDetailsElement>(".inventory-filter-disclosure summary")?.click())
    const author = selectLabeled("Author")
    const packageFilter = selectLabeled("Package")
    expect(author.textContent).toContain("Detalles")
    expect(author.textContent).not.toContain("Details")
    expect(packageFilter.textContent).toContain("Carpetas")
    expect(packageFilter.textContent).not.toContain("Folders")

    await act(async () => {
      author.value = "Detalles"
      author.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => {
      selectLabeled("Package").value = "Carpetas"
      selectLabeled("Package").dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.querySelector(".inventory-active-filters")?.textContent).toContain("Author: Detalles")
    expect(container.querySelector(".inventory-active-filters")?.textContent).toContain("Package: Carpetas")
  })

  it("renders distinct unfiltered and filtered empty states and clears filters", async () => {
    const list = vi.fn(() => Promise.resolve({
      ...basePage,
      items: [],
      total: 0,
    }))
    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(list),
    })))
    expect(container.textContent).toContain("No se han observado skills")

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    await act(async () => {
      if (search === null) throw new Error("Search field is missing")
      inputText(search, "missing")
    })
    await settle()
    expect(container.textContent).toContain("No hay skills que coincidan")

    await act(async () => buttonNamed("Limpiar filtros").click())
    expect(list).toHaveBeenLastCalledWith(expect.not.objectContaining({
      search: expect.anything(),
    }))
  })

  it("refreshes the projection when the main process reports an inventory change", async () => {
    const list = vi.fn(() => Promise.resolve(basePage))
    let listener: (() => void) | undefined
    const unsubscribe = vi.fn()
    const eventBridge: ForgeBridge["events"] = {
      onRootsChanged: () => () => undefined,
      onInventoryChanged: vi.fn((next) => {
        listener = next
        return unsubscribe
      }),
      onOperationProgress: () => () => undefined,
      onOperationCompleted: () => () => undefined,
    }

    await act(async () => root.render(createElement(Inventory, {
      inventoryBridge: bridge(list),
      eventBridge,
    })))
    expect(list).toHaveBeenCalledTimes(1)

    await act(async () => listener?.())
    expect(list).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
    expect(unsubscribe).toHaveBeenCalledOnce()
    root = createRoot(container)
  })
})
