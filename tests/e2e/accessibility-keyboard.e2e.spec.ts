import { expect, test, type Locator, type Page } from "@playwright/test"

import {
  createForgeBusinessFixture,
  launchForge,
} from "./support/forge-test-app.js"
import { launchForgeVisualScenario } from "./support/forge-visual-fixture.js"

async function expectDocumentLocked(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => {
    const scrollingElement = document.scrollingElement
    if (scrollingElement === null) throw new Error("Document has no scrolling element")
    return {
      clientHeight: scrollingElement.clientHeight,
      clientWidth: scrollingElement.clientWidth,
      scrollHeight: scrollingElement.scrollHeight,
      scrollLeft: scrollingElement.scrollLeft,
      scrollTop: scrollingElement.scrollTop,
      scrollWidth: scrollingElement.scrollWidth,
    }
  })

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1)
  expect(dimensions.scrollLeft).toBe(0)
  expect(dimensions.scrollTop).toBe(0)
}

async function expectReadableAtZoom(target: Locator, label: string): Promise<void> {
  await expect(target, `${label} must be visible at 200% zoom`).toBeVisible()
  const geometry = await target.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      bottom: box.bottom,
      fontSize: Number.parseFloat(style.fontSize),
      height: box.height,
      left: box.left,
      right: box.right,
      top: box.top,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
      width: box.width,
    }
  })

  expect(geometry.width, `${label} must retain visible width`).toBeGreaterThan(0)
  expect(geometry.height, `${label} must retain visible height`).toBeGreaterThan(0)
  expect(geometry.fontSize, `${label} must retain a readable type size`).toBeGreaterThanOrEqual(10)
  expect(geometry.left, `${label} must not clip past the left viewport edge`).toBeGreaterThanOrEqual(-1)
  expect(geometry.right, `${label} must not clip past the right viewport edge`)
    .toBeLessThanOrEqual(geometry.viewportWidth + 1)
  expect(geometry.top, `${label} must not clip above the viewport`).toBeGreaterThanOrEqual(-1)
  expect(geometry.bottom, `${label} must not clip below the viewport`)
    .toBeLessThanOrEqual(geometry.viewportHeight + 1)
}

test.describe("Forge keyboard and accessibility acceptance", () => {
  test("keyboard-only onboarding works with contrast, reduced motion, and a resized window", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboardingPhase: "intro" })
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
    const continueButton = app.page.getByRole("button", { name: "Continuar" })
    await continueButton.focus()
    await continueButton.press("Enter")
    await expect(app.page.getByRole("heading", { name: "Abre una skill y entiende cómo funciona." })).toBeFocused()
    const skipExplanation = app.page.getByRole("button", { name: "Saltar explicación" })
    await skipExplanation.focus()
    await skipExplanation.press("Enter")
    await expect(app.page.getByRole("group", { name: "Ubicaciones que Skillglass puede observar" })).toBeVisible()
    expect(await app.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true)
    expect(await app.page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true)

    const root = app.page.getByRole("checkbox", { name: fixture.globalRoot })
    await root.focus()
    await expect(root).toBeFocused()
    await expect(root).toBeChecked()
    await root.press("Space")
    await expect(root).not.toBeChecked()
    await root.press("Space")
    await expect(root).toBeChecked()
    const approve = app.page.getByRole("button", { name: "Buscar mis skills" })
    await approve.focus()
    await approve.press("Enter")
    await expect(app.page.getByRole("heading", { name: "Elige las skills que quieres seguir de cerca." })).toBeVisible()
    const finish = app.page.getByRole("button", { name: "Abrir mi inventario" })
    await finish.focus()
    await finish.press("Enter")
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

  test("200% zoom keeps Preview, Code, and Changes readable without document overflow", async () => {
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })
    try {
      await app.setZoomFactor(2)
      await app.page.getByRole("row", { name: /global-review/ }).click()
      await app.page.getByRole("button", { name: "Editar", exact: true }).click()
      await expect(app.page.getByRole("heading", { name: "global-review", level: 1 })).toBeVisible()

      const codeTab = app.page.getByRole("tab", { name: "Código", exact: true })
      const previewTab = app.page.getByRole("tab", { name: "Vista previa", exact: true })
      const changesTab = app.page.getByRole("tab", { name: /^Cambios/u })
      const content = app.page.getByRole("textbox", { name: "Contenido de SKILL.md", exact: true })
      await expect(codeTab).toHaveAttribute("aria-selected", "true")
      const layout = await content.evaluate((element) => {
        const editor = element.closest(".cm-editor")
        const firstLine = element.querySelector<HTMLElement>(".cm-line")
        const firstNumber = editor?.querySelector<HTMLElement>(".cm-gutterElement[style*='height']")
        const generatedStyles = [...document.querySelectorAll<HTMLStyleElement>("head > style")]
        if (firstLine === null || firstNumber === undefined || firstNumber === null) {
          throw new Error("CodeMirror line layout is missing")
        }
        const lineBox = firstLine.getBoundingClientRect()
        const numberBox = firstNumber.getBoundingClientRect()
        return {
          firstLine: firstLine.textContent,
          hasAuthorizedStyles: generatedStyles.some(
            (style) => style.nonce === (window as Window & { forgeStyleNonce?: string }).forgeStyleNonce,
          ),
          lineTop: lineBox.top,
          numberTop: numberBox.top,
        }
      })

      expect(layout.firstLine).toBe("---")
      expect(layout.hasAuthorizedStyles).toBe(true)
      expect(Math.abs(layout.lineTop - layout.numberTop)).toBeLessThanOrEqual(6)
      await expectReadableAtZoom(
        app.page.locator("#skill-workspace-code-panel .cm-line").first(),
        "Code editor line",
      )
      await expectDocumentLocked(app.page)

      await previewTab.click()
      await expect(previewTab).toHaveAttribute("aria-selected", "true")
      await expectReadableAtZoom(
        app.page.locator("#skill-workspace-preview-panel .safe-markdown"),
        "Preview content",
      )
      await expectDocumentLocked(app.page)

      await codeTab.click()
      await content.focus()
      await content.press("ControlOrMeta+End")
      await content.pressSequentially("\n\nRegla legible al doscientos por cien.")
      await content.press("ControlOrMeta+Enter")

      await expect(changesTab).toHaveAttribute("aria-selected", "true")
      const addedDiff = app.page.locator("#skill-workspace-changes-panel .diff-added .diff-content").last()
      await addedDiff.scrollIntoViewIfNeeded()
      await expectReadableAtZoom(addedDiff, "Added diff content")
      await expectDocumentLocked(app.page)
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

  test("workspace review, commit, restart-safe History, and Undo work by keyboard", async () => {
    const fixture = await createForgeBusinessFixture()
    const original = await fixture.readGlobalSkill()
    const app = await launchForge(fixture, { onboarded: true })
    try {
      const row = app.page.getByRole("row", { name: /global-review/ })
      await row.focus()
      await row.press("Enter")
      await expect(row).toHaveAttribute("aria-selected", "true")

      const edit = app.page.getByRole("button", { name: "Editar", exact: true })
      await edit.focus()
      await edit.press("Enter")

      const workspaceHeading = app.page.getByRole("heading", { name: "global-review", level: 1 })
      const back = app.page.getByRole("button", { name: "Volver al inventario", exact: true })
      const codeTab = app.page.getByRole("tab", { name: "Código", exact: true })
      const codePanel = app.page.getByRole("tabpanel", { name: "Código", exact: true })
      const content = app.page.getByRole("textbox", { name: "Contenido de SKILL.md", exact: true })
      await expect(workspaceHeading).toBeVisible()
      await expect(workspaceHeading).toBeFocused()
      await expect(content).toBeVisible()

      await back.focus()
      await app.page.keyboard.press("Tab")
      await expect(codeTab).toBeFocused()
      await app.page.keyboard.press("Tab")
      await expect(codePanel).toBeFocused()
      await app.page.keyboard.press("Tab")
      await expect(content).toBeFocused()

      await content.press("ControlOrMeta+End")
      await content.pressSequentially("\n\nRegla confirmada por teclado.")
      await content.press("ControlOrMeta+Enter")

      const changesTab = app.page.getByRole("tab", { name: /^Cambios/u })
      const dialog = app.page.getByRole("dialog", { name: "Confirmar actualización" })
      await expect(changesTab).toHaveAttribute("aria-selected", "true")
      await expect(dialog).toBeVisible()
      await expect(dialog).not.toHaveAttribute("aria-modal")
      const confirm = dialog.getByRole("button", { name: "Actualizar skill", exact: true })
      await expect(confirm).toBeFocused()
      await confirm.press("Shift+Tab")
      await expect(dialog.getByRole("button", { name: "Volver a editar", exact: true })).toBeFocused()

      await app.page.keyboard.press("Escape")
      await expect(dialog).not.toBeVisible()
      const review = app.page.getByRole("button", { name: "Revisar cambios", exact: true })
      await expect(codeTab).toHaveAttribute("aria-selected", "true")
      await expect(review).toBeFocused()

      await review.press("Enter")
      await expect(confirm).toBeFocused()
      await confirm.press("Enter")
      await expect(app.page.getByRole("status")).toContainText("Skill actualizada")
      await expect(app.page.getByRole("tab", { name: "Vista previa", exact: true }))
        .toHaveAttribute("aria-selected", "true")
      expect(await fixture.readGlobalSkill()).toContain("Regla confirmada por teclado.")

      await app.restart()
      const history = app.page.getByRole("button", { name: "Historial", exact: true })
      await history.focus()
      await history.press("Enter")
      const historyDialog = app.page.getByRole("dialog", { name: "Historial", exact: true })
      const undo = historyDialog.getByRole("button", { name: "Deshacer actualización", exact: true })
      await expect(undo).toBeVisible()
      await historyDialog.getByRole("button", { name: "Cerrar", exact: true }).press("Tab")
      await expect(undo).toBeFocused()
      await undo.press("Enter")
      await expect(app.page.getByRole("status")).toContainText("Actualización deshecha")
      expect(await fixture.readGlobalSkill()).toBe(original)
    } finally {
      await app.close()
    }
  })

  test("dirty Back requires destructive confirmation and restores focus when cancelled", async () => {
    const fixture = await createForgeBusinessFixture()
    const original = await fixture.readGlobalSkill()
    const app = await launchForge(fixture, { onboarded: true })
    try {
      const row = app.page.getByRole("row", { name: /global-review/ })
      await row.focus()
      await row.press("Enter")
      const edit = app.page.getByRole("button", { name: "Editar", exact: true })
      await edit.focus()
      await edit.press("Enter")

      const content = app.page.getByRole("textbox", { name: "Contenido de SKILL.md", exact: true })
      await content.focus()
      await content.press("ControlOrMeta+End")
      await content.pressSequentially("\n\nDraft que debe confirmarse antes de salir.")

      const back = app.page.getByRole("button", { name: "Volver al inventario", exact: true })
      await back.focus()
      await back.press("Enter")
      const discard = app.page.getByRole("dialog", { name: "Descartar cambios sin guardar", exact: true })
      await expect(discard).toBeVisible()
      await expect(discard.getByRole("button", { name: "Seguir editando", exact: true })).toBeFocused()
      expect(await fixture.readGlobalSkill()).toBe(original)

      await app.page.keyboard.press("Escape")
      await expect(discard).not.toBeVisible()
      await expect(back).toBeFocused()
      await expect(content).toContainText("Draft que debe confirmarse antes de salir.")

      await back.press("Enter")
      await discard.getByRole("button", { name: "Descartar y salir", exact: true }).press("Enter")
      await expect(app.page.getByRole("heading", { name: "Inventario", level: 1 })).toBeVisible()
      await expect(row).toHaveAttribute("aria-selected", "true")
      await expect(edit).toBeFocused()
      expect(await fixture.readGlobalSkill()).toBe(original)
    } finally {
      await app.close()
    }
  })
})
