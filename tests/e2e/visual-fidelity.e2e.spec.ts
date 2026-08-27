import { expect, test, type Locator, type Page } from "@playwright/test"

import {
  launchForgeVisualScenario,
  settleForgeVisualState,
  type ForgeVisualScenarioName,
  type RunningForgeVisualScenario,
} from "./support/forge-visual-fixture.js"

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const REFERENCE = { width: 1_420, height: 892 } as const
const COMPACT = { width: 1_180, height: 760 } as const
const NARROW = { width: 760, height: 520 } as const
const ZOOM_200_CSS = { width: 710, height: 446 } as const
const TOPBAR_HEIGHT = 46
const LONG_UNBROKEN_CONTENT = "workspaceinlinevisualacceptance".repeat(10)

const workspaceViewports = [
  { label: "reference-1420x892", viewport: REFERENCE },
  { label: "compact-1180x760", viewport: COMPACT },
  { label: "narrow-760x520", viewport: NARROW },
  { label: "zoom-200-css-710x446", viewport: ZOOM_200_CSS },
] as const

type WorkspaceVisualMode = "preview" | "code" | "changes"

const visualScenarios = [
  "onboarding",
  "onboarding-selection",
  "inventory",
  "create",
  "inspector",
  "pending",
  "operation-confirmation",
  "editor",
  "history",
] as const satisfies readonly ForgeVisualScenarioName[]

const platformSnapshotSuffix = process.platform === "darwin"
  ? "macos"
  : process.platform === "win32"
    ? "windows"
    : "linux"

function snapshotName(scenario: ForgeVisualScenarioName): string {
  return `${scenario}-${platformSnapshotSuffix}.png`
}

function workspaceSnapshotName(
  viewportLabel: typeof workspaceViewports[number]["label"],
  mode: WorkspaceVisualMode,
): string {
  return `workspace-${viewportLabel}-${mode}-${platformSnapshotSuffix}.png`
}

function volatileSnapshotValues(scenario: RunningForgeVisualScenario): Locator[] {
  const { page } = scenario.app
  const temporaryRoot = scenario.fixture.business.root
  const values = [
    page.locator(".root-path, .inspector-path, dd").filter({ hasText: temporaryRoot }),
    page.locator("dl > div", {
      has: page.getByText(/^(?:Snapshot|Hash observado)$/u),
    }).locator("dd"),
  ]

  if (scenario.name === "history") {
    values.push(page.locator(".history-entry__content > small"))
  }
  if (scenario.name === "create") values.push(page.locator("#create-skill-root"))

  return values
}

async function prepareVisualSnapshot(scenario: RunningForgeVisualScenario): Promise<void> {
  if (scenario.name === "inventory") {
    await scenario.app.page.getByRole("button", { name: "Global", exact: true }).click()
    await scenario.app.page.getByRole("row", { name: /global-review/u }).waitFor()
  }
  if (scenario.name === "inspector") {
    const observedHash = scenario.app.page.locator("dl > div", {
      has: scenario.app.page.getByText("Hash observado", { exact: true }),
    }).locator("dd")
    await expect(observedHash).not.toHaveText("")
    const volatileMetadata = scenario.app.page.locator("dl > div", {
      has: scenario.app.page.getByText(/^(?:Snapshot|Hash observado)$/u),
    }).locator("dd")
    await expect(volatileMetadata).toHaveCount(2)
    await volatileMetadata.evaluateAll((elements) => {
      for (const element of elements) element.textContent = "fixture-value"
    })
  }
  if (scenario.name === "onboarding-selection") {
    await scenario.app.page.locator(".skill-selection__path").evaluateAll((elements, temporaryRoot) => {
      for (const element of elements) {
        const stablePath = (element.textContent ?? "").replace(temporaryRoot, "/fixture")
        element.textContent = stablePath
        element.setAttribute("title", stablePath)
      }
    }, scenario.fixture.business.root)
  }
  await settleForgeVisualState(scenario.app.page)
}

async function boxOf(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`${label} has no layout box`)
  return box
}

function expectNear(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: expected ${String(expected)} ±${String(tolerance)}, observed ${String(actual)}`)
    .toBeLessThanOrEqual(tolerance)
}

function right(box: Box): number {
  return box.x + box.width
}

function bottom(box: Box): number {
  return box.y + box.height
}

async function expectViewportLocked(page: Page, viewport: Readonly<{ width: number; height: number }>): Promise<void> {
  const dimensions = await page.evaluate(() => {
    const scrollingElement = document.scrollingElement
    if (scrollingElement === null) throw new Error("Document has no scrolling element")
    return {
      clientWidth: scrollingElement.clientWidth,
      clientHeight: scrollingElement.clientHeight,
      scrollWidth: scrollingElement.scrollWidth,
      scrollHeight: scrollingElement.scrollHeight,
      scrollLeft: scrollingElement.scrollLeft,
      scrollTop: scrollingElement.scrollTop,
    }
  })

  expect(dimensions).toEqual({
    clientWidth: viewport.width,
    clientHeight: viewport.height,
    scrollWidth: viewport.width,
    scrollHeight: viewport.height,
    scrollLeft: 0,
    scrollTop: 0,
  })
}

async function expectHeaderOnOneLine(page: Page, minimumVisibleControls = 2): Promise<void> {
  const header = page.getByRole("banner")
  const headerBox = await boxOf(header, "topbar")
  const controls = await header.locator("a[href], button, input, select").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
    })
    .map((element) => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }))

  expect(controls.length, "the topbar exposes its expected visible controls")
    .toBeGreaterThanOrEqual(minimumVisibleControls)
  const latestTop = Math.max(...controls.map(({ y }) => y))
  const earliestBottom = Math.min(...controls.map(({ y, height }) => y + height))
  expect(latestTop, "all visible topbar controls must share one vertical band").toBeLessThan(earliestBottom)

  for (const [index, control] of controls.entries()) {
    expect(control.y, `topbar control ${String(index)} starts within the topbar`).toBeGreaterThanOrEqual(headerBox.y)
    expect(control.y + control.height, `topbar control ${String(index)} ends within the topbar`)
      .toBeLessThanOrEqual(bottom(headerBox) + 0.5)
  }

  const controlsByX = [...controls].sort((left, rightBox) => left.x - rightBox.x)
  for (let index = 1; index < controlsByX.length; index += 1) {
    const previous = controlsByX[index - 1]
    const current = controlsByX[index]
    if (previous === undefined || current === undefined) continue
    expect(previous.x + previous.width, `topbar controls ${String(index - 1)} and ${String(index)} must not overlap`)
      .toBeLessThanOrEqual(current.x + 0.5)
  }
}

async function resize(page: Page, viewport: Readonly<{ width: number; height: number }>): Promise<void> {
  await page.setViewportSize(viewport)
  await settleForgeVisualState(page)
}

async function scrollNearestOwnedPanel(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    let candidate: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement
    while (candidate !== null && candidate !== document.scrollingElement) {
      const overflowY = getComputedStyle(candidate).overflowY
      if ((overflowY === "auto" || overflowY === "scroll") && candidate.scrollHeight > candidate.clientHeight + 1) {
        candidate.scrollTop = candidate.scrollHeight
        return candidate.scrollTop
      }
      candidate = candidate.parentElement
    }
    return 0
  })
}

async function nearestOwnedPanelScrollTop(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    let candidate: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement
    while (candidate !== null && candidate !== document.scrollingElement) {
      const overflowY = getComputedStyle(candidate).overflowY
      if (overflowY === "auto" || overflowY === "scroll") return candidate.scrollTop
      candidate = candidate.parentElement
    }
    return 0
  })
}

async function expectInsideViewport(
  locator: Locator,
  viewport: Readonly<{ width: number; height: number }>,
  label: string,
): Promise<Box> {
  const box = await boxOf(locator, label)
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(-0.5)
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(-0.5)
  expect(right(box), `${label} right edge`).toBeLessThanOrEqual(viewport.width + 0.5)
  expect(bottom(box), `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5)
  return box
}

async function expectWorkspaceHeaderClear(page: Page): Promise<void> {
  const header = page.locator(".workspace-bar")
  const headerBox = await boxOf(header, "workspace header")
  const titleBox = await boxOf(page.getByRole("heading", { level: 1 }), "workspace title")
  const controls = await header.locator("button").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
    })
    .map((element) => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }))

  for (const [index, control] of controls.entries()) {
    expect(control.x, `workspace header control ${String(index)} left edge`).toBeGreaterThanOrEqual(headerBox.x - 0.5)
    expect(control.y, `workspace header control ${String(index)} top edge`).toBeGreaterThanOrEqual(headerBox.y - 0.5)
    expect(control.x + control.width, `workspace header control ${String(index)} right edge`)
      .toBeLessThanOrEqual(right(headerBox) + 0.5)
    expect(control.y + control.height, `workspace header control ${String(index)} bottom edge`)
      .toBeLessThanOrEqual(bottom(headerBox) + 0.5)

    const overlapWidth = Math.max(0, Math.min(control.x + control.width, right(titleBox)) - Math.max(control.x, titleBox.x))
    const overlapHeight = Math.max(0, Math.min(control.y + control.height, bottom(titleBox)) - Math.max(control.y, titleBox.y))
    expect(overlapWidth * overlapHeight, `workspace header control ${String(index)} must not cover the title`).toBe(0)
  }
}

async function expectWorkspaceContract(
  page: Page,
  viewport: Readonly<{ width: number; height: number }>,
  mode: WorkspaceVisualMode,
): Promise<void> {
  const topbar = await boxOf(page.getByRole("banner"), "workspace topbar")
  expectNear(topbar.x, 0, 0.5, "workspace topbar x")
  expectNear(topbar.y, 0, 0.5, "workspace topbar y")
  expectNear(topbar.width, viewport.width, 0.5, "workspace topbar width")
  expectNear(topbar.height, TOPBAR_HEIGHT, 0.5, "workspace topbar height")

  const main = await boxOf(page.locator("main#main-content"), "workspace main content")
  expectNear(main.x, 0, 0.5, "workspace main x")
  expectNear(main.y, TOPBAR_HEIGHT, 0.5, "workspace main y")
  expectNear(main.width, viewport.width, 0.5, "workspace main width")
  expectNear(main.height, viewport.height - TOPBAR_HEIGHT, 0.5, "workspace main height")

  await expect(page.locator(".app-library"), "the inventory library is hidden while editing").toBeHidden()
  await expect(page.locator(".app-library aside.sidebar"), "the inventory sidebar is absent from the visible tree").toBeHidden()
  await expect(page.locator(".app-library .inspector"), "the inventory inspector is absent from the visible tree").toBeHidden()

  const panelId = mode === "preview"
    ? "#skill-workspace-preview-panel"
    : mode === "code"
      ? "#skill-workspace-code-panel"
      : "#skill-workspace-changes-panel"
  const panel = page.locator(panelId)
  await expect(panel, `${mode} panel is visible`).toBeVisible()
  await expectInsideViewport(panel, viewport, `${mode} panel`)
  await expectInsideViewport(page.locator(".workspace-body"), viewport, "workspace body")

  const activeSurface = page.locator(mode === "preview"
    ? ".skill-preview__content"
    : mode === "code"
      ? ".workspace-editor__field"
      : ".inline-diff")
  const activeSurfaceBox = await boxOf(activeSurface, `${mode} active surface`)
  const minimumUsefulHeight = Math.min(180, Math.max(64, viewport.height * 0.18))
  expect(activeSurfaceBox.height, `${mode} retains a usable content surface at ${String(viewport.width)}×${String(viewport.height)}`)
    .toBeGreaterThanOrEqual(minimumUsefulHeight)

  await expectHeaderOnOneLine(page, 1)
  await expectWorkspaceHeaderClear(page)

  const contextSummary = page.locator(".workspace-context .workspace-disclosure-summary")
  const contextFacts = page.locator(".workspace-context__facts")
  if (viewport.width >= 1_280) {
    await expect(contextSummary, "wide workspace does not expose the compact context trigger").toBeHidden()
    await expect(contextFacts, "wide workspace renders observed context as a first-class column").toBeVisible()
  } else if (mode === "changes" && viewport.width < 960) {
    await expect(page.locator(".workspace-context"), "narrow Changes gives the diff the full workspace").toBeHidden()
  } else {
    await expect(contextSummary, "compact workspace exposes the context disclosure").toBeVisible()
    await expect(contextFacts, "compact context starts collapsed").toBeHidden()
  }

  if (mode === "changes") {
    const planSummary = page.locator(".workspace-plan .workspace-disclosure-summary")
    const planDetails = page.locator(".workspace-plan .operation-plan-details")
    if (viewport.width >= 1_280) {
      await expect(planSummary, "wide Changes does not expose the compact plan trigger").toBeHidden()
      await expect(planDetails, "wide Changes renders operation evidence beside the diff").toBeVisible()
    } else {
      await expect(planSummary, "compact Changes exposes the plan disclosure").toBeVisible()
      await expect(planDetails, "compact plan starts collapsed").toBeHidden()
      await planSummary.click()
      await expect(planDetails, "compact plan becomes readable through its disclosure").toBeVisible()
      await planSummary.click()
      await expect(planDetails, "compact plan returns to its deterministic collapsed state").toBeHidden()
    }
  }

  await expectViewportLocked(page, viewport)
}

async function selectWorkspaceMode(page: Page, mode: Exclude<WorkspaceVisualMode, "changes">): Promise<void> {
  const name = mode === "preview" ? "Vista previa" : "Código"
  await page.getByRole("tab", { name, exact: true }).click()
  await page.locator(`#skill-workspace-${mode}-panel`).waitFor()
  await settleForgeVisualState(page)
}

async function prepareWorkspaceChanges(page: Page): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Contenido" })
  await editor.press("ControlOrMeta+End")
  await editor.pressSequentially(`\n\n## Verificación visual\n\n${LONG_UNBROKEN_CONTENT}`)
  await page.getByRole("button", { name: "Revisar cambios", exact: true }).click()
  await page.getByRole("dialog", { name: "Confirmar actualización" }).waitFor()
  await settleForgeVisualState(page)
}

async function expectCompactDiffGeometry(page: Page, compact: boolean): Promise<void> {
  const markerXs = await page.locator(".inline-diff .diff-line:not(.diff-omitted) .diff-marker")
    .evaluateAll((markers) => markers.slice(0, 12).map((marker) => marker.getBoundingClientRect().x))
  expect(markerXs.length, "the diff exposes aligned change markers").toBeGreaterThan(0)
  for (const markerX of markerXs) expectNear(markerX, markerXs[0] ?? markerX, 0.5, "diff marker x")

  const compactNumber = page.locator(".inline-diff .diff-number-compact").first()
  const beforeNumber = page.locator(".inline-diff .diff-number-before").first()
  const afterNumber = page.locator(".inline-diff .diff-number-after").first()
  if (compact) {
    await expect(compactNumber, "compact diff exposes one line-number column").toBeVisible()
    await expect(beforeNumber, "compact diff hides the before line-number column").toBeHidden()
    await expect(afterNumber, "compact diff hides the after line-number column").toBeHidden()
  } else {
    await expect(compactNumber, "wide diff keeps compact numbering hidden").toBeHidden()
    await expect(beforeNumber, "wide diff exposes the before line-number column").toBeVisible()
    await expect(afterNumber, "wide diff exposes the after line-number column").toBeVisible()
  }

  const longLine = page.locator(".diff-added .diff-content").filter({ hasText: LONG_UNBROKEN_CONTENT }).first()
  await expect(longLine, "the deterministic long diff line is rendered").toBeVisible()
  const wrapping = await longLine.evaluate((element) => {
    const style = getComputedStyle(element)
    const lineHeight = Number.parseFloat(style.lineHeight)
    return {
      clientWidth: element.clientWidth,
      height: element.getBoundingClientRect().height,
      lineHeight,
      scrollWidth: element.scrollWidth,
    }
  })
  expect(wrapping.scrollWidth, "long diff content wraps within its own column")
    .toBeLessThanOrEqual(wrapping.clientWidth + 1)
  expect(wrapping.height, "the long unbroken diff line occupies multiple visual lines")
    .toBeGreaterThan(wrapping.lineHeight * 1.5)

  const ownedWidths = await page.locator(".text-diff, .workspace-context, .workspace-plan")
    .evaluateAll((elements) => elements
      .filter((element) => {
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        return style.display !== "none" && box.width > 0
      })
      .map((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })))
  for (const [index, width] of ownedWidths.entries()) {
    expect(width.scrollWidth, `workspace owned panel ${String(index)} contains horizontal overflow`)
      .toBeLessThanOrEqual(width.clientWidth + 1)
  }
}

test.describe("Forge geometric fidelity", () => {
  test("matches the canonical 1420×892 shell contract", async () => {
    const scenario = await launchForgeVisualScenario("inspector")
    try {
      const { page } = scenario.app
      const topbar = await boxOf(page.getByRole("banner"), "topbar")
      const sidebar = await boxOf(page.locator("aside.sidebar"), "sidebar")
      const main = await boxOf(page.locator("main#main-content"), "main content")
      const inspector = await boxOf(page.getByRole("complementary", { name: "Inspector" }), "inspector")

      expectNear(topbar.x, 0, 0.5, "topbar x")
      expectNear(topbar.y, 0, 0.5, "topbar y")
      expectNear(topbar.width, REFERENCE.width, 0.5, "topbar width")
      expectNear(topbar.height, TOPBAR_HEIGHT, 0.5, "topbar height")

      expectNear(sidebar.x, 0, 0.5, "sidebar x")
      expectNear(sidebar.y, TOPBAR_HEIGHT, 0.5, "sidebar y")
      expectNear(sidebar.width, 226, 1, "sidebar width")
      expectNear(sidebar.height, REFERENCE.height - TOPBAR_HEIGHT, 1, "sidebar height")

      expectNear(main.x, 226, 1, "main x")
      expectNear(main.y, TOPBAR_HEIGHT, 0.5, "main y")
      expectNear(main.width, 868, 2, "main width")
      expectNear(main.height, REFERENCE.height - TOPBAR_HEIGHT, 1, "main height")

      expectNear(inspector.x, 1_094, 2, "inspector x")
      expectNear(inspector.y, TOPBAR_HEIGHT, 0.5, "inspector y")
      expectNear(inspector.width, 326, 1, "inspector width")
      expectNear(inspector.height, REFERENCE.height - TOPBAR_HEIGHT, 1, "inspector height")

      const surfaceTitleSize = await page.getByRole("heading", { name: "Inventario", level: 1 })
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      expectNear(surfaceTitleSize, 22, 0.1, "surface title font size")
      const row = await boxOf(page.getByRole("row", { name: /global-review/u }), "inventory row")
      expectNear(row.height, 52, 0.5, "inventory row height")

      await expectHeaderOnOneLine(page)
      await expectViewportLocked(page, REFERENCE)
    } finally {
      await scenario.close()
    }
  })

  test("uses a viewport-bound inspector side sheet at 1180×760", async () => {
    const scenario = await launchForgeVisualScenario("inspector")
    try {
      const { page } = scenario.app
      await resize(page, COMPACT)

      const topbar = await boxOf(page.getByRole("banner"), "topbar")
      const sidebar = await boxOf(page.locator("aside.sidebar"), "compact sidebar")
      const main = await boxOf(page.locator("main#main-content"), "compact main content")
      const inspector = await boxOf(page.getByRole("complementary", { name: "Inspector" }), "compact inspector")

      expectNear(topbar.height, TOPBAR_HEIGHT, 0.5, "compact topbar height")
      expectNear(topbar.width, COMPACT.width, 0.5, "compact topbar width")
      expectNear(sidebar.x, 0, 0.5, "compact sidebar x")
      expectNear(sidebar.y, bottom(topbar), 0.5, "compact sidebar y")
      expect(sidebar.width, "compact sidebar remains visible without growing past the reference width").toBeGreaterThan(0)
      expect(sidebar.width).toBeLessThanOrEqual(227)

      expectNear(main.x, right(sidebar), 1, "compact main begins after sidebar")
      expectNear(main.y, bottom(topbar), 0.5, "compact main y")
      expectNear(right(main), COMPACT.width, 1, "compact main reaches viewport edge below the side sheet")
      expectNear(bottom(main), COMPACT.height, 1, "compact main bottom")

      expect(inspector.width, "compact inspector has a usable sheet width").toBeGreaterThanOrEqual(280)
      expect(inspector.width).toBeLessThanOrEqual(327)
      expectNear(right(inspector), COMPACT.width, 1, "compact inspector right anchor")
      expectNear(inspector.y, bottom(topbar), 0.5, "compact inspector top anchor")
      expectNear(bottom(inspector), COMPACT.height, 1, "compact inspector bottom anchor")
      expect(inspector.x, "compact inspector overlays the main instead of stacking below it").toBeLessThan(right(main))

      await expectHeaderOnOneLine(page)
      await expectViewportLocked(page, COMPACT)
    } finally {
      await scenario.close()
    }
  })

  test("keeps navigation, main content, and inspector reachable at 760×520", async () => {
    const scenario = await launchForgeVisualScenario("inspector")
    try {
      const { page } = scenario.app
      await resize(page, NARROW)

      const topbar = await boxOf(page.getByRole("banner"), "topbar")
      const sidebar = page.locator("aside.sidebar")
      const main = await boxOf(page.locator("main#main-content"), "narrow main content")
      const inspector = await boxOf(page.getByRole("complementary", { name: "Inspector" }), "narrow inspector")

      expectNear(topbar.height, TOPBAR_HEIGHT, 0.5, "narrow topbar height")
      expectNear(topbar.width, NARROW.width, 0.5, "narrow topbar width")
      await expect(sidebar, "the persistent sidebar must leave the narrow layout flow").toBeHidden()
      await expect(page.getByRole("button", { name: "Abrir navegación" }), "narrow navigation disclosure").toBeVisible()

      expectNear(main.x, 0, 0.5, "narrow main x")
      expectNear(main.y, bottom(topbar), 0.5, "narrow main y")
      expectNear(main.width, NARROW.width, 1, "narrow main width")
      expectNear(bottom(main), NARROW.height, 1, "narrow main bottom")

      expect(inspector.width, "narrow inspector sheet remains usable").toBeGreaterThanOrEqual(326)
      expect(inspector.width).toBeLessThanOrEqual(NARROW.width)
      expectNear(right(inspector), NARROW.width, 1, "narrow inspector right anchor")
      expectNear(inspector.y, bottom(topbar), 0.5, "narrow inspector top anchor")
      expectNear(bottom(inspector), NARROW.height, 1, "narrow inspector bottom anchor")

      await expectHeaderOnOneLine(page)
      await expectViewportLocked(page, NARROW)
    } finally {
      await scenario.close()
    }
  })

  test("resets owned panel scroll when navigating between surfaces", async () => {
    const scenario = await launchForgeVisualScenario("inventory")
    try {
      const { page } = scenario.app
      await resize(page, NARROW)

      const inventoryRow = page.getByRole("row", { name: /visual-regression/u })
      expect(await scrollNearestOwnedPanel(inventoryRow), "fixture inventory must exercise an owned scroll panel")
        .toBeGreaterThan(0)

      await page.getByRole("button", { name: "Abrir navegación" }).click()
      await page.getByRole("navigation", { name: "Secciones principales" }).getByRole("button", { name: "Por revisar", exact: true }).click()
      const pendingTitle = page.getByRole("heading", { name: "Por revisar", level: 1 })
      await expect(pendingTitle).toBeVisible()
      expect(await nearestOwnedPanelScrollTop(pendingTitle), "destination surface begins at its top").toBe(0)

      await page.getByRole("button", { name: "Abrir navegación" }).click()
      await page.getByRole("button", { name: /Todas las skills/ }).click()
      await expect(inventoryRow).toBeVisible()
      expect(await nearestOwnedPanelScrollTop(inventoryRow), "inventory owned panel resets after returning").toBe(0)
      await expectViewportLocked(page, NARROW)
    } finally {
      await scenario.close()
    }
  })
})

test.describe("Skill workspace visual acceptance", () => {
  for (const { label, viewport } of workspaceViewports) {
    test(`keeps Preview, Code, and Changes deterministic at ${label}`, async () => {
      const scenario = await launchForgeVisualScenario("editor")
      try {
        const { page } = scenario.app
        await resize(page, viewport)

        await selectWorkspaceMode(page, "preview")
        await expectWorkspaceContract(page, viewport, "preview")
        await expect(page).toHaveScreenshot(workspaceSnapshotName(label, "preview"), {
          animations: "disabled",
          caret: "hide",
          mask: volatileSnapshotValues(scenario),
          maskColor: "#17171c",
          scale: "css",
        })

        await selectWorkspaceMode(page, "code")
        await expectWorkspaceContract(page, viewport, "code")
        await expect(page).toHaveScreenshot(workspaceSnapshotName(label, "code"), {
          animations: "disabled",
          caret: "hide",
          mask: volatileSnapshotValues(scenario),
          maskColor: "#17171c",
          scale: "css",
        })

        await prepareWorkspaceChanges(page)
        await expectWorkspaceContract(page, viewport, "changes")
        await expectCompactDiffGeometry(page, viewport.width < 1_280)
        await expect(page).toHaveScreenshot(workspaceSnapshotName(label, "changes"), {
          animations: "disabled",
          caret: "hide",
          mask: volatileSnapshotValues(scenario),
          maskColor: "#17171c",
          scale: "css",
        })
      } finally {
        await scenario.close()
      }
    })
  }
})

test.describe("Forge visual regression", () => {
  for (const scenarioName of visualScenarios) {
    test(`${scenarioName} matches its approved ${platformSnapshotSuffix} baseline`, async () => {
      const scenario = await launchForgeVisualScenario(scenarioName)
      try {
        const { page } = scenario.app
        await prepareVisualSnapshot(scenario)
        await expect(page).toHaveScreenshot(snapshotName(scenarioName), {
          animations: "disabled",
          caret: "hide",
          mask: volatileSnapshotValues(scenario),
          maskColor: "#17171c",
          scale: "css",
        })
      } finally {
        await scenario.close()
      }
    })
  }
})
