import { expect, test, type Page } from "@playwright/test"

import { createForgeBusinessFixture, launchForge } from "./support/forge-test-app.js"

const FIRST_SLIDE = "Entiende todas las skills que ya tienes."
const SOURCE_STEP = "Elige dónde buscar tus skills"
const SELECTION_STEP = "Elige las skills que quieres seguir de cerca."

async function expectDocumentContained(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => {
    const root = document.scrollingElement
    if (root === null) throw new Error("Document has no scrolling element")
    return {
      clientHeight: root.clientHeight,
      clientWidth: root.clientWidth,
      scrollHeight: root.scrollHeight,
      scrollWidth: root.scrollWidth,
    }
  })
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1)
}

test.describe("onboarding and monitoring acceptance", () => {
  test("a clean launch supports both the explanatory tour and its skip path", async () => {
    const tourFixture = await createForgeBusinessFixture()
    const tour = await launchForge(tourFixture, { onboardingPhase: "intro" })
    try {
      await expect(tour.page.getByRole("heading", { name: FIRST_SLIDE })).toBeVisible()
      await expect(tour.page.getByText("Explicación 1 de 3", { exact: true })).toBeVisible()

      await tour.page.getByRole("button", { name: "Continuar" }).click()
      await expect(tour.page.getByRole("heading", { name: "Abre una skill y entiende cómo funciona." })).toBeFocused()
      await tour.page.getByRole("button", { name: "Continuar" }).click()
      await expect(tour.page.getByRole("heading", { name: "Crea nuevas skills para el trabajo que repites." })).toBeFocused()
      await tour.page.getByRole("button", { name: "Elegir mis skills" }).click()
      await expect(tour.page.getByRole("heading", { name: SOURCE_STEP })).toBeVisible()
    } finally {
      await tour.close()
    }

    const skipFixture = await createForgeBusinessFixture()
    const skip = await launchForge(skipFixture, { onboardingPhase: "intro" })
    try {
      await skip.page.getByRole("button", { name: "Saltar explicación" }).click()
      await expect(skip.page.getByRole("heading", { name: SOURCE_STEP })).toBeVisible()
      expect(await skipFixture.readScanAudit()).toEqual([])
    } finally {
      await skip.close()
    }
  })

  test("selection filters real skills and can be managed later from inventory", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboardingPhase: "skills" })
    try {
      await app.page.setViewportSize({ width: 1_420, height: 892 })
      const selection = app.page.getByRole("region", { name: "Seleccionar skills bajo seguimiento" })
      const selectionHeading = app.page.getByRole("heading", { name: SELECTION_STEP })
      await expect(selectionHeading).toBeVisible()
      const selectionGeometry = await selection.locator(".skill-selection__results").evaluate((results) => {
        const heading = document.querySelector(".onboarding-flow__selection-heading")?.getBoundingClientRect()
        return {
          headingTop: heading?.top ?? -1,
          overflowY: getComputedStyle(results).overflowY,
          resultsClientHeight: results.clientHeight,
          resultsScrollHeight: results.scrollHeight,
        }
      })
      expect(selectionGeometry.headingTop).toBeGreaterThanOrEqual(0)
      expect(selectionGeometry.overflowY).toBe("auto")
      expect(selectionGeometry.resultsScrollHeight).toBeGreaterThanOrEqual(selectionGeometry.resultsClientHeight)
      const initialSelectionCount = await selection.getByRole("checkbox").evaluateAll(
        (checkboxes) => checkboxes.filter((checkbox) => (checkbox as HTMLInputElement).checked).length,
      )
      expect(initialSelectionCount).toBeGreaterThan(1)

      await selection.getByRole("button", { name: /Global/u }).click()
      const globalRows = selection.getByRole("listitem")
      expect(await globalRows.count()).toBeGreaterThan(0)
      await selection.getByRole("button", { name: "Quitar las visibles" }).click()
      await expect(globalRows.getByRole("checkbox").first()).not.toBeChecked()

      const projectFilter = selection.getByRole("combobox", { name: "Filtrar por proyecto" })
      const projectValue = await projectFilter.locator("option").filter({ hasText: "Acme Web" }).getAttribute("value")
      if (projectValue === null) throw new Error("Acme Web project option is missing")
      await projectFilter.selectOption(projectValue)
      const search = selection.getByRole("searchbox", { name: "Buscar skills" })
      await expect(search).toHaveAttribute("placeholder", "Buscar en Acme Web")
      await search.fill("project-release")
      await expect(selection.getByText("project-release", { exact: true })).toBeVisible()
      await selection.getByRole("button", { name: "Quitar las visibles" }).click()
      await expect(selection.getByLabel("Seleccionar project-release")).not.toBeChecked()
      await selection.getByRole("button", { name: "Seleccionar las visibles" }).click()
      await expect(selection.getByLabel("Seleccionar project-release")).toBeChecked()

      await app.page.getByRole("button", { name: "Abrir mi inventario" }).click()
      await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeFocused()
      await expect(app.page.getByRole("row", { name: /project-release.*En seguimiento/u })).toBeVisible()

      await app.page.getByRole("button", { name: "Gestionar seguimiento" }).click()
      const dialog = app.page.getByRole("dialog", { name: "Gestionar seguimiento" })
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: /Global/u }).click()
      await dialog.getByRole("button", { name: "Seleccionar las visibles" }).click()
      await dialog.getByLabel("Seleccionar global-review").uncheck()
      await dialog.getByRole("button", { name: "Guardar cambios" }).click()
      await expect(app.page.getByRole("status")).toContainText("Seguimiento actualizado")
      const globalReview = app.page.getByRole("row").filter({ hasText: "global-review" })
      await expect(globalReview).not.toContainText("En seguimiento")
      await expect(app.page.getByRole("row", { name: /project-release.*En seguimiento/u })).toBeVisible()

      await app.restart()
      await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeVisible()
      await expect(app.page.getByRole("row").filter({ hasText: "global-review" }))
        .not.toContainText("En seguimiento")
      await expect(app.page.getByRole("row", { name: /project-release.*En seguimiento/u })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test("760×520 remains keyboard reachable with reduced motion", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboardingPhase: "intro" })
    try {
      await app.page.setViewportSize({ width: 760, height: 520 })
      await app.page.emulateMedia({ reducedMotion: "reduce" })
      expect(await app.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true)

      const next = app.page.getByRole("button", { name: "Continuar" })
      await next.focus()
      await next.press("Enter")
      await expect(app.page.getByRole("heading", { name: "Abre una skill y entiende cómo funciona." })).toBeFocused()
      const focusStyle = await app.page.getByRole("heading", { name: "Abre una skill y entiende cómo funciona." })
        .evaluate((element) => getComputedStyle(element).outlineStyle)
      expect(focusStyle).not.toBe("none")

      await app.page.getByRole("button", { name: "Saltar explicación" }).focus()
      await app.page.keyboard.press("Enter")
      await expect(app.page.getByRole("heading", { name: SOURCE_STEP })).toBeVisible()
      await expectDocumentContained(app.page)

      const submit = app.page.getByRole("button", { name: "Buscar mis skills" })
      await submit.focus()
      await submit.press("Enter")
      await expect(app.page.getByRole("heading", { name: SELECTION_STEP })).toBeVisible()
      await expectDocumentContained(app.page)

      const finish = app.page.getByRole("button", { name: "Abrir mi inventario" })
      await finish.focus()
      await finish.press("Enter")
      await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeFocused()
      await expectDocumentContained(app.page)
    } finally {
      await app.close()
    }
  })

  test("a persisted pre-monitoring installation is migrated directly to inventory", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboardingPhase: "skills" })
    try {
      await expect(app.page.getByRole("heading", { name: SELECTION_STEP })).toBeVisible()
      await app.restartAsLegacyInstallation()
      await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeVisible()
      await expect(app.page.getByRole("row", { name: /global-review.*En seguimiento/u })).toBeVisible()
      await expect(app.page.getByRole("row", { name: /project-release.*En seguimiento/u })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
