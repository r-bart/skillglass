import { access } from "node:fs/promises"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { createForgeBusinessFixture, launchForge } from "./support/forge-test-app.js"

test("native quit keeps an edited draft when cancelled and discards it without touching disk", async () => {
  const fixture = await createForgeBusinessFixture()
  const original = await fixture.readGlobalSkill()
  const app = await launchForge(fixture, { onboarded: true })
  try {
    await app.page.getByRole("row", { name: /global-review/u }).click()
    await app.page.getByRole("button", { name: "Editar", exact: true }).click()
    const editor = app.page.getByRole("textbox", { name: "Contenido de SKILL.md", exact: true })
    await editor.press("ControlOrMeta+End")
    await editor.pressSequentially("\n\nBorrador protegido durante el cierre nativo.")

    await app.requestNativeClose("stay", "quit")
    await expect(app.page.getByRole("heading", { name: "global-review", level: 1 })).toBeVisible()
    await expect(editor).toContainText("Borrador protegido durante el cierre nativo.")
    expect(await fixture.readGlobalSkill()).toBe(original)

    await app.requestNativeClose("discard", "quit")
    expect(await fixture.readGlobalSkill()).toBe(original)
  } finally {
    await app.close()
  }
})

test("native window close protects fields entered before the create editor opens", async () => {
  const fixture = await createForgeBusinessFixture()
  const app = await launchForge(fixture, { onboarded: true })
  const destination = path.join(fixture.globalRoot, "native-close-draft", "SKILL.md")
  try {
    await app.page.getByRole("banner").getByRole("button", { name: "Crear skill", exact: true }).click()
    await app.page.getByLabel("Identificador").fill("native-close-draft")
    await app.page.getByLabel("Descripción").fill("Protect fields before authoring")

    await app.requestNativeClose("stay")
    await expect(app.page.getByLabel("Identificador")).toHaveValue("native-close-draft")
    await expect(app.page.getByLabel("Descripción")).toHaveValue("Protect fields before authoring")
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" })

    await app.requestNativeClose("discard")
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await app.close()
  }
})
