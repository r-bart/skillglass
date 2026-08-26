import { access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { Page } from "@playwright/test"

import {
  createForgeBusinessFixture,
  launchForge,
  type ForgeTestApplication,
} from "./forge-test-app.js"

export const FORGE_VISUAL_VIEWPORT = { width: 1_420, height: 892 } as const

export type ForgeVisualScenarioName =
  | "onboarding"
  | "inventory"
  | "inspector"
  | "pending"
  | "operation-confirmation"
  | "editor"
  | "history"

type BusinessFixture = Awaited<ReturnType<typeof createForgeBusinessFixture>>

export interface ForgeVisualFixture {
  readonly business: BusinessFixture
  readonly conflictSource: string
  readonly conflictDestination: string
}

export interface RunningForgeVisualScenario {
  readonly name: ForgeVisualScenarioName
  readonly fixture: ForgeVisualFixture
  readonly app: ForgeTestApplication
  close(): Promise<void>
}

interface VisualSkill {
  readonly scope: "global" | "project"
  readonly key: string
  readonly description: string
  readonly body: string
}

const visualSkills: readonly VisualSkill[] = [
  {
    scope: "global",
    key: "accessibility-audit",
    description: "Revisa navegación por teclado, foco y contraste.",
    body: "Comprueba cada flujo con teclado y conserva evidencia reproducible.",
  },
  {
    scope: "global",
    key: "api-contract-review",
    description: "Valida contratos y cambios compatibles de la API.",
    body: "Compara los DTO observados antes de aprobar cambios públicos.",
  },
  {
    scope: "global",
    key: "content-check",
    description: "Comprueba claridad, estructura y enlaces internos.",
    body: "Revisa el contenido local sin consultar registros remotos.",
  },
  {
    scope: "global",
    key: "release-notes",
    description: "Prepara notas de release a partir del cambio local.",
    body: "Resume cambios confirmados y riesgos conocidos.",
  },
  {
    scope: "global",
    key: "security-review",
    description: "Identifica límites de confianza y permisos sensibles.",
    body: "Revisa entradas, rutas y efectos antes de ejecutar.",
  },
  {
    scope: "project",
    key: "component-audit",
    description: "Audita componentes del proyecto Acme Web.",
    body: "Comprueba consistencia y estados accesibles de los componentes.",
  },
  {
    scope: "project",
    key: "launch-checklist",
    description: "Verifica el checklist previo al lanzamiento.",
    body: "Confirma pruebas, documentación y recuperación.",
  },
  {
    scope: "project",
    key: "performance-budget",
    description: "Contrasta el proyecto con su presupuesto de rendimiento.",
    body: "Registra los límites observados sin inventar telemetría de uso.",
  },
  {
    scope: "project",
    key: "release-notes",
    description: "Adapta las notas de release para Acme Web.",
    body: "Prioriza los cambios que afectan a este proyecto.",
  },
  {
    scope: "project",
    key: "visual-regression",
    description: "Revisa diferencias visuales del proyecto.",
    body: "Compara capturas aprobadas en el mismo sistema y viewport.",
  },
]

function skillSource(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`
}

async function createSkill(directory: string, source: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "SKILL.md"), source, "utf8")
}

async function waitForPath(candidate: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(candidate)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error(`Timed out waiting for visual fixture path: ${candidate}`)
}

/**
 * Creates only filesystem facts that the real adapters can observe. The fixture
 * deliberately contains no activation, usage, registry, or remote-source data.
 */
export async function createForgeVisualFixture(): Promise<ForgeVisualFixture> {
  const business = await createForgeBusinessFixture()
  const projectRoot = path.dirname(business.projectSkillRoot)
  const conflictSource = path.join(business.root, "sources", "local-conflict")
  const conflictDestination = path.join(business.globalRoot, "local-conflict")

  await Promise.all([
    ...visualSkills.map((skill) => createSkill(
      path.join(skill.scope === "global" ? business.globalRoot : projectRoot, skill.key),
      skillSource(skill.key, skill.description, skill.body),
    )),
    createSkill(
      conflictSource,
      skillSource(
        "local-conflict",
        "Fixture local que demuestra cambios divergentes.",
        "La instalación parte de este contenido observado.",
      ),
    ),
    mkdir(path.join(business.globalSkillRoot, "references"), { recursive: true })
      .then(() => writeFile(
        path.join(business.globalSkillRoot, "references", "review-checklist.md"),
        "# Review checklist\n\n- Riesgos\n- Pruebas\n- Recuperación\n",
        "utf8",
      )),
  ])

  return { business, conflictSource, conflictDestination }
}

/** Waits for fonts/layout without a time-based screenshot delay. */
export async function settleForgeVisualState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function configureVisualPage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize(FORGE_VISUAL_VIEWPORT)
}

async function selectGlobalReview(page: Page): Promise<void> {
  const row = page.getByRole("row", { name: /global-review/u })
  await row.waitFor()
  await row.click()
  await page.getByRole("complementary", { name: "Inspector" })
    .getByText("Review global de cambios", { exact: true })
    .waitFor()
}

async function openEditor(page: Page): Promise<void> {
  await selectGlobalReview(page)
  await page.getByRole("button", { name: "Editar", exact: true }).click()
  await page.getByRole("textbox", { name: "Contenido" }).waitFor()
}

async function changeEditorContent(page: Page): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Contenido" })
  await editor.press("ControlOrMeta+End")
  await editor.pressSequentially("\n\n## Verificación visual\n\nConserva una diferencia exacta y reproducible.")
}

async function openContentConfirmation(page: Page): Promise<void> {
  await openEditor(page)
  await changeEditorContent(page)
  await page.getByRole("button", { name: "Revisar cambios" }).click()
  await page.getByRole("dialog", { name: "Confirmar actualización" }).waitFor()
}

async function confirmInstall(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Confirmar instalación" })
  await dialog.waitFor()
  await dialog.getByRole("button", { name: "Instalar skill" }).click()
}

async function preparePendingGroups(
  fixture: ForgeVisualFixture,
  app: ForgeTestApplication,
): Promise<void> {
  await app.installFromDirectory(fixture.business.installDirectorySource)
  await confirmInstall(app.page)
  await app.installFromDirectory(fixture.conflictSource)
  await confirmInstall(app.page)
  await waitForPath(path.join(fixture.conflictDestination, "SKILL.md"))

  await fixture.business.changeInstallSource("Versión de origen 2 para revisión visual")
  await writeFile(
    path.join(fixture.conflictDestination, "SKILL.md"),
    skillSource(
      "local-conflict",
      "Fixture local modificada en destino.",
      "Este cambio local diverge de la base importada por Forge.",
    ),
    "utf8",
  )
  await app.page.getByRole("button", { name: "Buscar actualizaciones" }).click()
  await app.page.getByRole("button", { name: "Pendientes", exact: true }).click()
  await app.page.getByRole("heading", { name: /Actualizaciones disponibles · 1/u }).waitFor()
  await app.page.getByRole("heading", { name: /Conflictos de origen · 1/u }).waitFor()
  await app.page.getByRole("heading", { name: /Validación pendiente/u }).waitFor()
}

/**
 * Launches Forge and drives its public UI into one named visual state. Every
 * inventory item and operation is produced by the real scanner, adapters, DTO
 * validation, IPC, and operation service.
 */
export async function launchForgeVisualScenario(
  name: ForgeVisualScenarioName,
): Promise<RunningForgeVisualScenario> {
  const fixture = await createForgeVisualFixture()
  let app: ForgeTestApplication | undefined
  try {
    app = await launchForge(fixture.business, { onboarded: name !== "onboarding" })
    await configureVisualPage(app.page)

    switch (name) {
      case "onboarding": {
        const candidates = app.page.getByRole("group", { name: "Ubicaciones que Forge puede observar" })
          .getByRole("checkbox")
        const count = await candidates.count()
        if (count !== 1) throw new Error(`Expected one proposed writable root; observed ${String(count)}`)
        break
      }
      case "inventory":
        await app.page.getByRole("row", { name: /visual-regression/u }).waitFor()
        break
      case "inspector":
        await selectGlobalReview(app.page)
        break
      case "pending":
        await preparePendingGroups(fixture, app)
        break
      case "operation-confirmation":
        await openContentConfirmation(app.page)
        break
      case "editor":
        await openEditor(app.page)
        break
      case "history": {
        await openContentConfirmation(app.page)
        const dialog = app.page.getByRole("dialog", { name: "Confirmar actualización" })
        await dialog.getByRole("button", { name: "Actualizar skill" }).click()
        await app.page.getByRole("status").filter({ hasText: "Skill actualizada" }).waitFor()
        await app.page.getByRole("button", { name: "Historial" }).click()
        const history = app.page.getByRole("dialog", { name: "Historial" })
        await history.getByText("Actualización de contenido", { exact: true }).waitFor()
        break
      }
    }

    await settleForgeVisualState(app.page)
    const running = app
    return {
      name,
      fixture,
      app: running,
      close: () => running.close(),
    }
  } catch (error) {
    if (app === undefined) await fixture.business.dispose()
    else await app.close()
    throw error
  }
}
