import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CompactSurfaceHeader,
  FilterChip,
  MetalAction,
  SkillTile,
  StatusPill,
  VisualAction,
  glassSelectedRowProps,
  skillAppearanceFor,
} from "./VisualPrimitives.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

describe("visual primitives", () => {
  it("keeps action semantics and disabled state", () => {
    act(() => root.render(createElement(
      "div",
      null,
      createElement(MetalAction, { disabled: true }, "Guardar"),
      createElement(VisualAction, { as: "a", disabled: true, href: "/history" }, "Historial"),
    )))

    const button = container.querySelector("button")
    const link = container.querySelector("a")

    expect(button?.type).toBe("button")
    expect(button?.disabled).toBe(true)
    expect(button?.classList.contains("visual-action--metal")).toBe(true)
    expect(link?.getAttribute("aria-disabled")).toBe("true")
    expect(link?.hasAttribute("href")).toBe(false)
    expect(link?.tabIndex).toBe(-1)
  })

  it("renders a labelled native control for removing a filter", () => {
    const onRemove = vi.fn()
    act(() => root.render(createElement(FilterChip, { label: "Con avisos", onRemove })))

    const remove = container.querySelector<HTMLButtonElement>("button")
    expect(remove?.getAttribute("aria-label")).toBe("Quitar filtro Con avisos")
    act(() => remove?.click())
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it("keeps skill appearance stable and exposes its visual recipe", () => {
    const identity = { adapterId: "codex", key: "sql-review" }
    expect(skillAppearanceFor(identity)).toEqual(skillAppearanceFor(identity))
    expect(skillAppearanceFor(identity)).toEqual(skillAppearanceFor({ adapterId: " CODEX ", key: "SQL-REVIEW" }))

    act(() => root.render(createElement(SkillTile, {
      accessibleLabel: "Icono de sql-review",
      adapterId: identity.adapterId,
      skillKey: identity.key,
    })))

    const tile = container.querySelector(".skill-tile")
    const appearance = skillAppearanceFor(identity)
    expect(tile?.getAttribute("role")).toBe("img")
    expect(tile?.getAttribute("data-tile")).toBe(appearance.tile)
    expect(tile?.getAttribute("data-glyph")).toBe(appearance.glyph)
  })

  it("provides semantic pills, surface headings and glass row state", () => {
    act(() => root.render(createElement(
      CompactSurfaceHeader,
      {
        actions: createElement(VisualAction, null, "Filtrar"),
        description: "12 skills observadas",
        eyebrow: "Esta máquina",
        title: "Inventario",
      },
    )))

    expect(container.querySelector("header h1")?.textContent).toBe("Inventario")
    expect(container.querySelector(".section-label")?.textContent).toBe("Esta máquina")

    const onPillClick = vi.fn()
    act(() => root.render(createElement(StatusPill, {
      onClick: onPillClick,
      pressed: true,
      tone: "attention",
    }, "Con avisos")))
    const pill = container.querySelector<HTMLButtonElement>(".status-pill--attention")
    expect(pill?.textContent).toBe("Con avisos")
    expect(pill?.type).toBe("button")
    expect(pill?.getAttribute("aria-pressed")).toBe("true")
    act(() => pill?.click())
    expect(onPillClick).toHaveBeenCalledOnce()
    expect(glassSelectedRowProps(true, "inventory-row")).toEqual({
      "aria-selected": true,
      className: "glass-selectable-row is-glass-selected inventory-row",
    })
  })
})
