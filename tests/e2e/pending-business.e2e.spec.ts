import { expect, test } from "@playwright/test"

import { createForgeBusinessFixture, launchForge } from "./support/forge-test-app.js"

test("pending surface groups and applies a verified source update through an exact preview", async () => {
  const fixture = await createForgeBusinessFixture()
  const app = await launchForge(fixture, { onboarded: true })

  await app.installFromDirectory(fixture.installDirectorySource)
  await app.page.getByRole("dialog", { name: "Confirmar instalación" })
    .getByRole("button", { name: "Instalar skill" }).click()
  await fixture.changeInstallSource("Versión de origen 2")
  await app.page.getByRole("button", { name: "Buscar actualizaciones" }).click()
  await app.page.getByRole("navigation", { name: "Secciones principales" }).getByRole("button", { name: "Por revisar", exact: true }).click()

  await expect(app.page.getByRole("heading", { name: "Actualizaciones disponibles · 1" })).toBeVisible()
  const item = app.page.getByRole("listitem").filter({ hasText: "local-installable" })
  await item.getByRole("checkbox").check()
  await app.page.getByRole("button", { name: "Actualizar 1" }).click()

  const preview = app.page.getByRole("dialog", { name: "Confirmar actualización" })
  await expect(preview).toContainText("local-installable/SKILL.md")
  await expect(preview).toContainText("Disponible antes de confirmar")
  await expect(preview).toContainText("Disponible tras reiniciar")
  await preview.getByRole("button", { name: "Confirmar 1" }).click()

  await expect(app.page.locator(".operation-status")).toContainText(/Skill actualizada|1 skill actualizada/u)
  expect(await fixture.readInstalledSkill()).toContain("Versión de origen 2")
  await app.close()
})
