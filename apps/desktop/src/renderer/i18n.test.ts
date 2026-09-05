import { afterEach, describe, expect, it } from "vitest"

import {
  DEFAULT_LOCALE,
  createElement,
  formatCount,
  loadSavedLocale,
  localeFromLanguages,
  localize,
  setActiveLocale,
  verbatim,
  verbatimProps,
} from "./i18n.js"

describe("renderer copy localization", () => {
  afterEach(() => {
    setActiveLocale(DEFAULT_LOCALE)
    window.localStorage.clear()
  })

  it("uses English as the stable fallback and translates product copy in both directions", () => {
    expect(DEFAULT_LOCALE).toBe("en")
    expect(localize("Inventario", "es")).toBe("Inventario")
    expect(localize("Inventario", "en")).toBe("Inventory")
    expect(localize("Inventory", "es")).toBe("Inventario")
  })

  it("prefers a saved locale, then the first supported browser language", () => {
    window.localStorage.clear()
    expect(localeFromLanguages(["fr-FR", "es-MX", "en-US"])).toBe("es")
    expect(localeFromLanguages(["ca", "de"])).toBe("en")

    window.localStorage.setItem("skillglass.locale", "es")
    expect(loadSavedLocale()).toBe("es")
  })

  it("formats singular and plural product counts without parsing user text", () => {
    expect(formatCount(1, "installation", "es")).toBe("1 instalación")
    expect(formatCount(2, "installation", "es")).toBe("2 instalaciones")
    expect(formatCount(1, "skill", "en")).toBe("1 skill")
    expect(formatCount(3, "selected-skill", "es")).toBe("3 skills seleccionadas")
  })

  it("localizes dynamic counts and preserves observed identifiers", () => {
    expect(localize("3 de 12 instalaciones", "en")).toBe("3 of 12 installations")
    expect(localize("Proyecto · forge-app", "en")).toBe("Project · forge-app")
    expect(localize("Seleccionar my-skill", "en")).toBe("Select my-skill")
  })

  it("localizes visible children and accessibility attributes only", () => {
    setActiveLocale("en")
    const element = createElement("button", {
      "aria-label": "Buscar actualizaciones",
      className: "actualización",
    }, "Actualizar skill")

    expect(element.props).toMatchObject({
      "aria-label": "Check for updates",
      className: "actualización",
      children: "Update skill",
    })
  })

  it("keeps explicitly verbatim children and attributes opaque", () => {
    setActiveLocale("en")
    const element = createElement("span", verbatimProps({ title: "Detalles" }), verbatim("Detalles"))

    expect(element.props.title).toBe("Detalles")
    const props = element.props as { children: { props: { children: string } }; title: string }
    expect(props.children.props.children).toBe("Detalles")
  })
})
