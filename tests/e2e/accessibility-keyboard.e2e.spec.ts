import { expect, test } from "@playwright/test"

import {
  createForgeBusinessFixture,
  launchForge,
} from "./support/forge-test-app.js"
import { launchForgeVisualScenario } from "./support/forge-visual-fixture.js"

test.describe("Forge keyboard and accessibility acceptance", () => {
  test("keyboard-only onboarding works with contrast, reduced motion, and a resized window", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture)
    await app.page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" })
    await app.page.setViewportSize({ width: 800, height: 600 })

    await expect(app.page.locator("main#main-content")).toBeVisible()
    await expect(app.page.locator("html")).toHaveAttribute("lang", "es")
    const skipLink = app.page.getByRole("link", { name: "Saltar al contenido" })
    await skipLink.focus()
    await app.page.keyboard.press("Tab")
    await app.page.keyboard.press("Shift+Tab")
    await expect(skipLink).toBeFocused()
    const focusStyle = await skipLink.evaluate((element) => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) }
    })
    expect(focusStyle.outlineStyle).toBe("solid")
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2)
    const navigationToggle = app.page.getByRole("button", { name: "Abrir navegación" })
    await navigationToggle.focus()
    await navigationToggle.press("Enter")
    await expect(app.page.getByRole("navigation", { name: "Secciones principales" })).toBeVisible()
    await expect(app.page.getByRole("group", { name: "Ubicaciones que Forge puede observar" })).toBeVisible()
    expect(await app.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true)
    expect(await app.page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true)

    const root = app.page.getByRole("checkbox", { name: fixture.globalRoot })
    await root.focus()
    await expect(root).toBeFocused()
    await root.press("Space")
    await expect(root).toBeChecked()
    const approve = app.page.getByRole("button", { name: "Escanear carpetas aprobadas" })
    await approve.focus()
    await approve.press("Enter")
    await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeVisible()
    await app.close()
  })

  test("pending remains operable by keyboard and statuses retain textual equivalents", async () => {
    const scenario = await launchForgeVisualScenario("pending")
    try {
      const { page } = scenario.app
      const update = page.getByRole("checkbox", { name: /Seleccionar local-installable/u })
      await update.focus()
      await update.press("Space")
      await expect(update).toBeChecked()
      await expect(page.getByText("Actualización", { exact: true }).first()).toBeVisible()
      await expect(page.getByText("Origen divergente", { exact: true }).first()).toBeVisible()
      await expect(page.getByText("No válida", { exact: true }).first()).toBeVisible()
      const batch = page.getByRole("button", { name: "Actualizar 1" })
      await batch.focus()
      await batch.press("Enter")
      await expect(page.getByRole("dialog", { name: "Confirmar actualización" })).toBeVisible()
    } finally {
      await scenario.close()
    }
  })

  test("200% zoom and narrow mode retain reachable, touch-sized controls", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })
    try {
      await app.page.setViewportSize({ width: 760, height: 520 })
      await app.setZoomFactor(2)
      await expect(app.page.locator("main#main-content")).toBeVisible()
      const toggle = app.page.getByRole("button", { name: "Abrir navegación" })
      await expect(toggle).toBeVisible()
      const controls = await app.page.locator("button:visible, select:visible, summary:visible").evaluateAll((elements) => (
        elements.map((element) => ({
          height: element.getBoundingClientRect().height,
          name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
        }))
      ))
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control.height, `${control.name} must expose a 44px narrow target`).toBeGreaterThanOrEqual(44)
      }
    } finally {
      await app.close()
    }
  })

  test("scope navigation, inventory rows, inspector, and search shortcut work without a pointer", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    const globalScope = app.page.getByRole("button", { name: "Global", exact: true })
    await globalScope.focus()
    await globalScope.press("Enter")
    await expect(app.page.getByRole("row", { name: /project-release/ })).not.toBeVisible()

    const projectScope = app.page.getByRole("button", { name: "Acme Web" })
    await projectScope.focus()
    await projectScope.press("Enter")
    await expect(app.page.getByRole("row", { name: /project-release/ })).toBeVisible()

    const globalRow = app.page.getByRole("row", { name: /global-review/ })
    await globalRow.focus()
    await globalRow.press("Enter")
    const inspector = app.page.getByRole("complementary", { name: "Inspector" })
    await expect(inspector.getByText(fixture.globalSkillEntry)).toBeVisible()

    await app.page.keyboard.press("ControlOrMeta+f")
    const search = app.page.getByRole("searchbox", { name: "Buscar skills" })
    await expect(search).toBeFocused()
    await search.pressSequentially("project-release")
    await expect(app.page.getByRole("row", { name: /project-release/ })).toBeVisible()
    await app.close()
  })

  test("editor confirmation traps focus, closes with Escape, and undo works after restart by keyboard", async () => {
    const fixture = await createForgeBusinessFixture()
    const original = await fixture.readGlobalSkill()
    const app = await launchForge(fixture, { onboarded: true })

    const row = app.page.getByRole("row", { name: /global-review/ })
    await row.focus()
    await row.press("Enter")
    const edit = app.page.getByRole("button", { name: "Editar" })
    await edit.focus()
    await edit.press("Enter")
    const content = app.page.getByRole("textbox", { name: "Contenido" })
    await content.focus()
    await content.press("ControlOrMeta+End")
    await content.pressSequentially("\n\nRegla confirmada por teclado.")

    const review = app.page.getByRole("button", { name: "Revisar cambios" })
    await review.focus()
    await review.press("Enter")
    const dialog = app.page.getByRole("dialog", { name: "Confirmar actualización" })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole("button", { name: "Actualizar skill" })
    await expect(confirm).toBeFocused()
    await confirm.press("Shift+Tab")
    await expect(dialog.getByRole("button", { name: "Volver" })).toBeFocused()
    await app.page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible()
    await expect(review).toBeFocused()

    await review.press("Enter")
    await expect(confirm).toBeFocused()
    await confirm.press("Enter")
    await expect(app.page.getByRole("status")).toContainText("Skill actualizada")
    expect(await fixture.readGlobalSkill()).toContain("Regla confirmada por teclado.")

    await app.restart()
    const history = app.page.getByRole("button", { name: "Historial" })
    await history.focus()
    await history.press("Enter")
    const historyDialog = app.page.getByRole("dialog", { name: "Historial" })
    const undo = historyDialog.getByRole("button", { name: "Deshacer actualización" })
    await expect(undo).toBeVisible()
    await historyDialog.getByRole("button", { name: "Cerrar" }).press("Tab")
    await expect(undo).toBeFocused()
    await undo.press("Enter")
    await expect(app.page.getByRole("status")).toContainText("Actualización deshecha")
    expect(await fixture.readGlobalSkill()).toBe(original)
    await app.close()
  })
})
