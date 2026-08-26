import { expect, test, type Locator, type Page } from "@playwright/test"

import {
  launchForgeVisualScenario,
  settleForgeVisualState,
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
const TOPBAR_HEIGHT = 46

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

async function expectHeaderOnOneLine(page: Page): Promise<void> {
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

  expect(controls.length, "the topbar must expose at least the brand and one action").toBeGreaterThanOrEqual(2)
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
      await page.getByRole("button", { name: "Pendientes", exact: true }).click()
      const pendingTitle = page.getByRole("heading", { name: "Pendientes", level: 1 })
      await expect(pendingTitle).toBeVisible()
      expect(await nearestOwnedPanelScrollTop(pendingTitle), "destination surface begins at its top").toBe(0)

      await page.getByRole("button", { name: "Abrir navegación" }).click()
      await page.getByRole("button", { name: "Inventario", exact: true }).click()
      await expect(inventoryRow).toBeVisible()
      expect(await nearestOwnedPanelScrollTop(inventoryRow), "inventory owned panel resets after returning").toBe(0)
      await expectViewportLocked(page, NARROW)
    } finally {
      await scenario.close()
    }
  })
})
