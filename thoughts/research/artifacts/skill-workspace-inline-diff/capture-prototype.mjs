/* global document, process */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"

const artifactDirectory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(artifactDirectory, "../../../..")
const prototypeUrl = process.env.FORGE_PROTOTYPE_URL
  ?? "http://127.0.0.1:4173/prototypes/editor-surface/?v=2"
const browserExecutable = process.env.FORGE_BROWSER_EXECUTABLE
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sourceFiles = [
  "prototypes/editor-surface/index.html",
  "prototypes/editor-surface/prototype.css",
  "prototypes/editor-surface/prototype.js",
  "prototypes/editor-surface/variant-workspace.js",
  "prototypes/editor-surface/data.js",
]
const viewports = [
  { name: "desktop-1420x892", width: 1420, height: 892 },
  { name: "narrow-760x520", width: 760, height: 520 },
]

const sha256 = (content) => createHash("sha256").update(content).digest("hex")

await mkdir(artifactDirectory, { recursive: true })
const browser = await chromium.launch({ executablePath: browserExecutable, headless: true })
const browserVersion = browser.version()
const captures = []

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "es-ES",
    })
    const page = await context.newPage()
    await page.goto(prototypeUrl, { waitUntil: "networkidle" })
    await page.locator(".proto-picker[data-ready]").waitFor()
    await page.locator(".variant--workspace").waitFor()
    await page.evaluate(() => document.fonts.ready)

    const capture = async (state) => {
      const filename = `${viewport.name}-${state}.png`
      const target = path.join(artifactDirectory, filename)
      await page.screenshot({ path: target, animations: "disabled", fullPage: false })
      const bytes = await readFile(target)
      captures.push({
        file: filename,
        state,
        viewport: { width: viewport.width, height: viewport.height },
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      })
    }

    await capture("code")
    await page.getByRole("tab", { name: "Vista previa" }).click()
    await capture("preview")

    await page.getByRole("tab", { name: "Código" }).click()
    const editor = page.getByLabel("Contenido de SKILL.md")
    const original = await editor.inputValue()
    const changed = original.replace(
      "Create paid-social advertising concepts that are specific enough to produce,",
      "Create memorable paid-social concepts that are specific enough to ship,",
    ) + "\n\n## Review note\n\n- Keep the claim concrete"
    await editor.fill(changed)
    await page.getByRole("button", { name: "Revisar cambios" }).click()
    await page.getByRole("tab", { name: /Cambios/ }).getAttribute("aria-selected")
    await capture("changes")
    await context.close()
  }
} finally {
  await browser.close()
}

const sources = []
for (const file of sourceFiles) {
  const bytes = await readFile(path.join(repository, file))
  sources.push({ file, sha256: sha256(bytes) })
}

const immutableSpec = "tests/spec/forge-mvp.e2e.spec.ts"
const immutableSpecBytes = await readFile(path.join(repository, immutableSpec))
const manifest = {
  prototypeUrl,
  variant: 2,
  browser: "chromium",
  browserExecutable,
  browserVersion,
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "reduce",
  locale: "es-ES",
  mutation: {
    replace: {
      before: "Create paid-social advertising concepts that are specific enough to produce,",
      after: "Create memorable paid-social concepts that are specific enough to ship,",
    },
    append: "\\n\\n## Review note\\n\\n- Keep the claim concrete",
    expectedSummary: "5 añadidas · 1 eliminadas",
  },
  immutableSpec: { file: immutableSpec, sha256: sha256(immutableSpecBytes) },
  sources,
  captures,
}

await writeFile(
  path.join(artifactDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
)

for (const capture of captures) {
  process.stdout.write(`${capture.sha256}  ${capture.file}\n`)
}
