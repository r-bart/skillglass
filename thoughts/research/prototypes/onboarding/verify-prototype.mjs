/* global CSS, URL, console, document, process */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const screenshots = path.join(directory, "screenshots");
await mkdir(screenshots, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1420, height: 892 }, deviceScaleFactor: 1 });
const failures = [];
page.on("console", (message) => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
page.on("requestfailed", (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText ?? "failed"}`));

async function openVariant(index) {
  await page.goto(`http://127.0.0.1:4179/?v=${index}`, { waitUntil: "networkidle" });
  await page.locator("#stage > *").waitFor();
}

async function assertLabeledInputs() {
  const unlabeled = await page.locator("input").evaluateAll((inputs) => inputs.filter((input) => {
    const id = input.getAttribute("id");
    return !input.closest("label") && !input.getAttribute("aria-label") && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
  }).map((input) => input.outerHTML));
  if (unlabeled.length > 0) failures.push(`unlabeled inputs: ${unlabeled.join(" | ")}`);
}

await openVariant(1);
await page.screenshot({ path: path.join(screenshots, "actual-1420x892.png") });
await assertLabeledInputs();
await page.getByRole("button", { name: "Añadir proyecto Codex…" }).click();
if (await page.getByRole("checkbox").count() !== 2) failures.push("Actual: adding a project did not add a root");
await page.getByRole("button", { name: "Escanear carpetas aprobadas" }).click();
await page.getByRole("heading", { name: "Inventario" }).waitFor();

await openVariant(2);
await page.screenshot({ path: path.join(screenshots, "enfoque-1420x892.png") });
await assertLabeledInputs();
await page.getByRole("button", { name: "Continuar" }).click();
await page.getByRole("button", { name: "Continuar" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(screenshots, "enfoque-creacion-1420x892.png") });
await page.getByRole("button", { name: "Elegir mis skills" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(screenshots, "enfoque-seleccion-1420x892.png") });
const firstSkillCheckbox = page.locator("[data-skill-option] input").first();
await firstSkillCheckbox.focus();
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Tab");
const focusedRowOutline = await firstSkillCheckbox.evaluate((input) => globalThis.getComputedStyle(input.closest("[data-skill-option]")).outlineStyle);
if (focusedRowOutline === "none") failures.push("Enfoque: keyboard focus is not visible on skill rows");
await page.getByRole("searchbox", { name: "Buscar skills" }).fill("customer-research");
if (await page.locator("[data-skill-option]:visible").count() !== 1) failures.push("Enfoque: search did not narrow results");
await page.getByRole("searchbox", { name: "Buscar skills" }).fill("no-existe-esta-skill");
if (!await page.getByText("No hay skills aquí.").isVisible()) failures.push("Enfoque: empty search state is missing");
await page.getByRole("searchbox", { name: "Buscar skills" }).fill("");
await page.getByRole("button", { name: "Global" }).click();
if (await page.locator("[data-skill-option]:visible").count() !== 5) failures.push("Enfoque: Global did not show five team-level skills");
await page.getByRole("combobox", { name: "Filtrar por proyecto" }).selectOption("Acme Web");
if (await page.locator("[data-skill-option]:visible").count() !== 2) failures.push("Enfoque: project selector did not show two Acme Web skills");
await page.screenshot({ path: path.join(screenshots, "enfoque-proyecto-1420x892.png") });
await page.getByRole("button", { name: "Seleccionar las visibles" }).click();
if (await page.locator("[data-selection-count]").textContent() !== "6") failures.push("Enfoque: selecting visible project skills changed the wrong selection set");
await page.getByRole("button", { name: "Todas 8" }).click();
await page.getByRole("button", { name: "Abrir mi inventario" }).click();
await page.getByRole("heading", { name: "Inventario" }).waitFor();

await openVariant(3);
await page.screenshot({ path: path.join(screenshots, "contexto-1420x892.png") });
await assertLabeledInputs();
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Siguiente" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(screenshots, "contexto-creacion-1420x892.png") });
await page.getByRole("button", { name: "Elegir skills" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(screenshots, "contexto-seleccion-1420x892.png") });
await page.getByRole("checkbox", { name: /customer-research-synthesis-with-long-name/ }).check();
await page.getByRole("button", { name: "Abrir mi dashboard" }).click();
await page.getByRole("heading", { name: "Inventario" }).waitFor();

for (const [index, name] of [[1, "actual"], [2, "enfoque"], [3, "contexto"]]) {
  await page.setViewportSize({ width: 760, height: 520 });
  await openVariant(index);
  await page.screenshot({ path: path.join(screenshots, `${name}-760x520.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) failures.push(`${name}: horizontal overflow at 760×520`);
}

await openVariant(2);
await page.getByRole("button", { name: "Saltar explicación" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(screenshots, "enfoque-seleccion-760x520.png") });
const selectionOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
if (selectionOverflow) failures.push("Enfoque selection: horizontal overflow at 760×520");

await page.setViewportSize({ width: 1420, height: 892 });
await openVariant(1);
await page.keyboard.press("2");
if (new URL(page.url()).searchParams.get("v") !== "2") failures.push("Picker: number key did not switch variants");
await page.keyboard.press("ArrowRight");
if (new URL(page.url()).searchParams.get("v") !== "3") failures.push("Picker: arrow key did not switch variants");

await browser.close();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Prototype verification passed: 3 variants, full flows, keyboard picker, labels, and 760px layout.");
}
