import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Page } from "@playwright/test"

import {
  createForgeBusinessFixture,
  launchForge,
} from "../../../tests/e2e/support/forge-test-app.js"

type Language = "es" | "en"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputDirectory = path.resolve(scriptDirectory, "../public/demo")
const viewport = { width: 1_600, height: 1_000 } as const

const labels = {
  es: {
    edit: "Editar",
    editor: "Contenido de SKILL.md",
    history: "Historial",
    review: "Revisar cambios",
    confirmation: "Confirmar actualización",
    save: "Actualizar skill",
    undo: "Deshacer actualización",
    saved: "Skill actualizada",
    undone: "Actualización deshecha",
  },
  en: {
    edit: "Edit",
    editor: "SKILL.md content",
    history: "History",
    review: "Review changes",
    confirmation: "Confirm update",
    save: "Update skill",
    undo: "Undo update",
    saved: "Skill updated",
    undone: "Update undone",
  },
} as const

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function sanitizeVisibleFixturePaths(page: Page, fixtureRoot: string): Promise<void> {
  await page.evaluate((root) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      if (node.textContent?.includes(root)) node.textContent = node.textContent.split(root).join("/demo")
      node = walker.nextNode()
    }
    for (const element of document.querySelectorAll<HTMLElement>("[title]")) {
      const title = element.getAttribute("title")
      if (title?.includes(root)) element.setAttribute("title", title.split(root).join("/demo"))
    }
    for (const definition of document.querySelectorAll("dl > div")) {
      const term = definition.querySelector("dt")?.textContent?.trim()
      if (/^(?:Snapshot|Observed hash|Hash observado)$/u.test(term ?? "")) {
        const value = definition.querySelector("dd")
        if (value !== null) value.textContent = "fixture-value"
      }
    }
  }, fixtureRoot)
  await settle(page)
}

async function capture(page: Page, fixtureRoot: string, fileName: string): Promise<void> {
  await sanitizeVisibleFixturePaths(page, fixtureRoot)
  await page.screenshot({
    animations: "disabled",
    path: path.join(outputDirectory, fileName),
    quality: 82,
    type: "webp",
  })
}

async function captureLanguage(language: Language): Promise<void> {
  const fixture = await createForgeBusinessFixture()
  const app = await launchForge(fixture, { onboarded: true })
  const { page } = app
  const text = labels[language]

  try {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.locator(".language-switch__option", { hasText: language.toUpperCase() }).click()
    await page.waitForFunction((expected) => document.documentElement.lang === expected, language)
    await page.getByRole("heading", { name: language === "es" ? "Inventario" : "Inventory" }).waitFor()

    await capture(page, fixture.root, `product-${language}.webp`)

    const search = page.getByRole("searchbox")
    await search.fill("global-review")
    await page.getByRole("row", { name: /global-review/u }).waitFor()
    await capture(page, fixture.root, `${language}-01.webp`)

    await page.getByRole("row", { name: /global-review/u }).click()
    await page.getByRole("complementary").getByText("global-review", { exact: true }).first().waitFor()
    await capture(page, fixture.root, `${language}-02.webp`)

    await page.getByRole("button", { name: text.edit, exact: true }).click()
    const editor = page.locator('.workspace-editor__field [role="textbox"]')
    await editor.waitFor()
    await capture(page, fixture.root, `${language}-03.webp`)

    await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End")
    await editor.pressSequentially(language === "es"
      ? "\n\n## Regla de revisión\n\nComprueba el resultado antes de guardar."
      : "\n\n## Review rule\n\nCheck the result before saving.")
    await page.getByRole("button", { name: text.review, exact: true }).click()
    const confirmation = page.getByRole("dialog", { name: text.confirmation, exact: true })
    await confirmation.waitFor()
    await capture(page, fixture.root, `${language}-04.webp`)

    await confirmation.getByRole("button", { name: text.save, exact: true }).click()
    await page.getByRole("status").filter({ hasText: text.saved }).waitFor()
    await capture(page, fixture.root, `${language}-05.webp`)

    await page.getByRole("button", { name: text.history, exact: true }).click()
    const history = page.getByRole("dialog", { name: text.history, exact: true })
    await history.getByRole("button", { name: text.undo, exact: true }).click()
    await page.getByRole("status").filter({ hasText: text.undone }).waitFor()
    await capture(page, fixture.root, `${language}-06.webp`)
  } finally {
    // The product close guard can outlive Playwright's final acknowledgement on
    // macOS even after the child process has received its teardown signal. Asset
    // capture is complete at this point, so continue to the other locale while
    // the test harness finishes its own forced cleanup.
    await app.close().catch((error: unknown) => {
      process.stderr.write(`Asset capture teardown warning: ${String(error)}\n`)
    })
  }
}

await mkdir(outputDirectory, { recursive: true })
await captureLanguage("es")
await captureLanguage("en")
