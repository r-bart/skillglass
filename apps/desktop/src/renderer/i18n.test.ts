import { afterEach, describe, expect, it } from "vitest"

import {
  DEFAULT_LOCALE,
  createElement,
  localize,
  setActiveLocale,
} from "./i18n.js"

describe("renderer copy localization", () => {
  afterEach(() => setActiveLocale(DEFAULT_LOCALE))

  it("keeps Spanish as the stable default and translates product copy to English", () => {
    expect(localize("Inventario", "es")).toBe("Inventario")
    expect(localize("Inventario", "en")).toBe("Inventory")
    expect(localize("Inventory", "es")).toBe("Inventario")
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
})

