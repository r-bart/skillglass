/**
 * @generated-from thoughts/PRODUCT.md, thoughts/DOMAIN.md,
 * thoughts/ADAPTERS.md, and thoughts/OPERATIONS.md
 * @immutable Do NOT modify these tests — implementation must make them pass as-is.
 *
 * These tests encode Forge's business-value acceptance criteria. If a test seems
 * wrong, update the contracts and regenerate the suite; never patch this file to
 * accommodate an implementation.
 */
import { expect, test } from "@playwright/test"

import {
  createForgeBusinessFixture,
  launchForge,
  readTreeHash,
} from "../e2e/support/forge-test-app"

test.describe("Forge MVP business value", () => {
  test("BV-1: first launch discloses roots and scans only after explicit approval", async () => {
    // Spec: FR-ROOT-APPROVAL / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture)

    await expect(app.page.getByRole("heading", { name: "Carpetas de skills" })).toBeVisible()
    await expect(app.page.getByText(fixture.globalRoot)).toBeVisible()
    await expect(app.page.getByText("Lectura y escritura", { exact: true })).toBeVisible()
    await expect(app.page.getByRole("heading", { name: "Inventario" })).not.toBeVisible()
    expect(await fixture.readScanAudit()).toEqual([])

    await app.page.getByRole("checkbox", { name: fixture.globalRoot }).check()
    await app.page.getByRole("button", { name: "Escanear carpetas aprobadas" }).click()

    await expect(app.page.getByRole("heading", { name: "Inventario" })).toBeVisible()
    expect(await fixture.readScanAudit()).toEqual([fixture.globalRoot])
    await app.close()
  })

  test("BV-2: inventory distinguishes Esta máquina, Global, and project scope", async () => {
    // Spec: FR-SCOPE / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    await app.page.getByRole("button", { name: "Esta máquina" }).click()
    await expect(app.page.getByRole("row", { name: /global-review/ })).toBeVisible()
    await expect(app.page.getByRole("row", { name: /project-release/ })).toBeVisible()

    await app.page.getByRole("button", { name: "Global" }).click()
    await expect(app.page.getByRole("row", { name: /global-review/ })).toBeVisible()
    await expect(app.page.getByRole("row", { name: /project-release/ })).not.toBeVisible()

    await app.page.getByRole("button", { name: "Acme Web" }).click()
    await expect(app.page.getByRole("row", { name: /global-review/ })).toBeVisible()
    await expect(app.page.getByRole("row", { name: /project-release/ })).toBeVisible()
    await app.close()
  })

  test("BV-3: inspector proves what was observed and leaves unavailable facts unknown", async () => {
    // Spec: FR-EVIDENCE / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    await app.page.getByRole("row", { name: /global-review/ }).click()
    const inspector = app.page.getByRole("complementary", { name: "Inspector" })
    await expect(inspector.getByText(fixture.globalSkillEntry)).toBeVisible()
    await expect(inspector.getByText("Codex", { exact: true })).toBeVisible()
    await expect(inspector.getByText("Observado", { exact: true })).toBeVisible()
    await expect(inspector.getByText("Sin datos", { exact: true })).toBeVisible()
    await expect(inspector.getByText(/v1\.0|usada hace|sin usar/i)).not.toBeVisible()
    await app.close()
  })

  test("BV-4: malformed skills remain visible with actionable validation findings", async () => {
    // Spec: FR-VALIDATION / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    await app.page.getByRole("row", { name: /broken-frontmatter/ }).click()
    const inspector = app.page.getByRole("complementary", { name: "Inspector" })
    await expect(inspector.getByText("No se pudo leer el frontmatter")).toBeVisible()
    await expect(inspector.getByText(fixture.invalidSkillEntry)).toBeVisible()
    await expect(inspector.getByRole("button", { name: "Abrir archivo" })).toBeVisible()
    await app.close()
  })

  test("BV-5: read-only managed skills can be inspected but not edited", async () => {
    // Spec: FR-WRITE-BOUNDARY / AC-1
    const fixture = await createForgeBusinessFixture()
    const beforeHash = await readTreeHash(fixture.managedSkillRoot)
    const app = await launchForge(fixture, { onboarded: true })

    await app.page.getByRole("row", { name: /managed-audit/ }).click()
    await expect(app.page.getByText("Solo lectura", { exact: true })).toBeVisible()
    await expect(app.page.getByRole("button", { name: "Editar" })).not.toBeVisible()
    await expect(app.page.getByRole("button", { name: /pedir permisos|administrador|sudo/i })).not.toBeVisible()
    expect(await readTreeHash(fixture.managedSkillRoot)).toBe(beforeHash)
    await app.close()
  })

  test("BV-6: direct edit previews exact files and undo survives application restart", async () => {
    // Spec: FR-CONTENT-UPDATE / AC-1, FR-UNDO / AC-1
    const fixture = await createForgeBusinessFixture()
    const original = await fixture.readGlobalSkill()
    const app = await launchForge(fixture, { onboarded: true })

    await app.page.getByRole("row", { name: /global-review/ }).click()
    await app.page.getByRole("button", { name: "Editar" }).click()
    await app.page.getByRole("textbox", { name: "Contenido" }).fill(`${original}\n\nNueva regla verificable.`)
    await app.page.getByRole("button", { name: "Revisar cambios" }).click()

    const dialog = app.page.getByRole("dialog", { name: "Confirmar actualización" })
    await expect(dialog.getByText(fixture.globalSkillEntry)).toBeVisible()
    await expect(dialog.getByText("Nueva regla verificable.")).toBeVisible()
    expect(await fixture.readGlobalSkill()).toBe(original)
    await dialog.getByRole("button", { name: "Actualizar skill" }).click()
    await expect(app.page.getByRole("status")).toContainText("Skill actualizada")
    expect(await fixture.readGlobalSkill()).toContain("Nueva regla verificable.")

    await app.restart()
    await app.page.getByRole("button", { name: "Historial" }).click()
    await app.page.getByRole("button", { name: "Deshacer actualización" }).click()
    await expect(app.page.getByRole("status")).toContainText("Actualización deshecha")
    expect(await fixture.readGlobalSkill()).toBe(original)
    await app.close()
  })

  test("BV-7: local directory installation is staged, previewed, verified, and undoable", async () => {
    // Spec: FR-INSTALL / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    await app.installFromDirectory(fixture.installDirectorySource)
    const dialog = app.page.getByRole("dialog", { name: "Confirmar instalación" })
    await expect(dialog.getByText(fixture.installDestination)).toBeVisible()
    await expect(dialog.getByText("local-installable/SKILL.md")).toBeVisible()
    expect(await fixture.installDestinationExists()).toBe(false)
    await dialog.getByRole("button", { name: "Instalar skill" }).click()

    await expect(app.page.getByRole("row", { name: /local-installable/ })).toBeVisible()
    expect(await readTreeHash(fixture.installDestination)).toBe(
      await readTreeHash(fixture.installDirectorySource),
    )

    await app.restart()
    await app.page.getByRole("button", { name: "Historial" }).click()
    await app.page.getByRole("button", { name: "Deshacer instalación" }).click()
    expect(await fixture.installDestinationExists()).toBe(false)
    await app.close()
  })

  test("BV-8: unsafe ZIP is rejected before any destination path is created", async () => {
    // Spec: EC-ZIP-TRAVERSAL / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    await app.installFromZip(fixture.traversalZipSource)
    await expect(app.page.getByRole("alert")).toContainText("ruta no segura")
    expect(await fixture.installDestinationExists()).toBe(false)
    expect(await fixture.traversalEscapeExists()).toBe(false)
    await app.close()
  })

  test("BV-9: verified local source update never overwrites local divergence silently", async () => {
    // Spec: FR-SOURCE-UPDATE / AC-1, EC-DIVERGENCE / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    await app.installFromDirectory(fixture.installDirectorySource)
    await app.page.getByRole("dialog", { name: "Confirmar instalación" })
      .getByRole("button", { name: "Instalar skill" }).click()
    await fixture.changeInstallSource("Versión de origen 2")
    await app.page.getByRole("button", { name: "Buscar actualizaciones" }).click()
    await expect(app.page.getByRole("row", { name: /local-installable.*Actualización disponible/ })).toBeVisible()

    await fixture.changeInstalledSkill("Cambio local del usuario")
    await app.page.getByRole("row", { name: /local-installable/ }).click()
    await app.page.getByRole("button", { name: "Actualizar" }).click()
    await expect(app.page.getByRole("dialog", { name: "Conflicto de actualización" })).toContainText(
      "cambios locales",
    )
    expect(await fixture.readInstalledSkill()).toContain("Cambio local del usuario")
    await app.close()
  })

  test("BV-10: Forge exposes no harness activation, uninstall, or privilege-elevation controls", async () => {
    // Spec: FR-SCOPE-BOUNDARY / AC-1
    const fixture = await createForgeBusinessFixture()
    const app = await launchForge(fixture, { onboarded: true })

    await app.page.getByRole("row", { name: /global-review/ }).click()
    for (const forbidden of [
      "Activar",
      "Desactivar",
      "Eliminar",
      "Desinstalar",
      "Mover",
      "Ejecutar como administrador",
    ]) {
      await expect(app.page.getByRole("button", { name: forbidden, exact: true })).not.toBeVisible()
    }
    expect(await fixture.readHarnessConfig()).toBe(fixture.originalHarnessConfig)
    expect(await fixture.readElevationAudit()).toEqual([])
    await app.close()
  })
})
