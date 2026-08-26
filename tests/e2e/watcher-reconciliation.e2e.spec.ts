import { expect, test } from "@playwright/test"

import { createForgeBusinessFixture, launchForge } from "./support/forge-test-app.js"

test("an external skill edit is reconciled without restart or root reapproval", async () => {
  const fixture = await createForgeBusinessFixture()
  const app = await launchForge(fixture, { onboarded: true })

  await app.page.getByRole("row", { name: /global-review/ }).click()
  const inspector = app.page.getByRole("complementary", { name: "Inspector" })
  await expect(inspector).toContainText("Review global de cambios")

  await fixture.changeGlobalSkill(
    "Descripción reconciliada desde disco",
    "Este cambio ocurrió fuera de Forge.",
  )

  await expect(inspector).toContainText("Descripción reconciliada desde disco")
  await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeVisible()
  await app.close()
})
