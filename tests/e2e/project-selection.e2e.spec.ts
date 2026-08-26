import path from "node:path"

import { expect, test } from "@playwright/test"

import { createForgeBusinessFixture, launchForge } from "./support/forge-test-app.js"

test("a project selected from a neutral cwd is persisted and scanned only after root approval", async () => {
  const fixture = await createForgeBusinessFixture()
  const app = await launchForge(fixture, { workingDirectory: fixture.neutralCwd })
  const projectSkillsRoot = path.join(fixture.projectRoot, ".agents", "skills")

  await expect(app.page.getByText(projectSkillsRoot, { exact: true })).toHaveCount(0)
  expect(await fixture.readScanAudit()).toEqual([])

  await app.selectProject(fixture.projectRoot)
  const projectOption = app.page.locator("label.root-option").filter({ hasText: projectSkillsRoot })
  await expect(projectOption).toBeVisible()
  const projectCheckbox = projectOption.getByRole("checkbox")
  await expect(projectCheckbox).toBeChecked()

  const checkboxes = app.page.getByRole("checkbox")
  for (let index = 0; index < await checkboxes.count(); index += 1) {
    const checkbox = checkboxes.nth(index)
    if (!await checkbox.evaluate((element, projectPath) => element.closest("label")?.textContent?.includes(projectPath) === true, projectSkillsRoot)) {
      if (await checkbox.isChecked()) await checkbox.uncheck()
    }
  }
  expect(await fixture.readScanAudit()).toEqual([])
  await app.page.getByRole("button", { name: "Escanear carpetas aprobadas" }).click()

  await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeVisible()
  await expect(app.page.getByRole("button", { name: "Acme Web" })).toBeVisible()
  await expect(app.page.getByRole("row", { name: /project-release/ })).toBeVisible()
  expect(await fixture.readScanAudit()).toEqual([projectSkillsRoot])

  await app.restart()
  await expect(app.page.getByRole("button", { name: "Acme Web" })).toBeVisible()
  await expect(app.page.getByRole("row", { name: /project-release/ })).toBeVisible()
  await app.close()
})
