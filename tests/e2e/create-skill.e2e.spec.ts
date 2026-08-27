import { access, readFile } from "node:fs/promises"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { createForgeBusinessFixture, launchForge } from "./support/forge-test-app.js"

test("creates a skill through the first-class workspace, exact diff, and reversible journal", async () => {
  const fixture = await createForgeBusinessFixture()
  const app = await launchForge(fixture, { onboarded: true })
  const destination = path.join(fixture.globalRoot, "contract-review", "SKILL.md")

  await app.page.getByRole("banner").getByRole("button", { name: "Crear skill", exact: true }).click()
  await expect(app.page.getByRole("heading", { name: "Crear skill", level: 1 })).toBeVisible()
  await app.page.getByLabel("Identificador").fill("contract-review")
  await app.page.getByLabel("Descripción").fill("Review contracts safely")
  const globalOption = app.page.locator("#create-skill-root option").filter({ hasText: fixture.globalRoot })
  const globalRootId = await globalOption.getAttribute("value")
  if (globalRootId === null) throw new Error("Approved global authoring root was not offered")
  await app.page.getByLabel("Ubicación").selectOption(globalRootId)
  await app.page.getByRole("button", { name: "Abrir borrador" }).click()

  const changes = app.page.getByRole("tab", { name: /Cambios/u })
  await expect(changes).toBeEnabled()
  await changes.click()
  const confirmation = app.page.getByRole("dialog", { name: "Confirmar creación" })
  await expect(confirmation).toContainText("contract-review/SKILL.md")
  await expect(confirmation.locator(".text-diff")).toHaveAttribute("data-removed", "0")
  await expect(confirmation.locator(".diff-added")).not.toHaveCount(0)
  await confirmation.getByRole("button", { name: "Crear skill", exact: true }).click()

  await expect(app.page.getByRole("heading", { name: "Contract Review", level: 1 })).toBeVisible()
  await expect.poll(async () => {
    try {
      return await readFile(destination, "utf8")
    } catch {
      return ""
    }
  }).toContain("name: contract-review")

  await app.page.getByRole("button", { name: "Historial", exact: true }).click()
  const history = app.page.getByRole("dialog", { name: "Historial", exact: true })
  await expect(history).toContainText("Creación")
  await history.getByRole("button", { name: "Deshacer creación" }).click()
  await expect.poll(async () => {
    try {
      await access(destination)
      return false
    } catch {
      return true
    }
  }).toBe(true)

  await app.close()
})
