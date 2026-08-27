import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { TextDiff, createTextDiffModel } from "./TextDiff.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("createTextDiffModel", () => {
  it("returns an empty unchanged model", () => {
    expect(createTextDiffModel("same\n", "same\n")).toEqual({
      rows: [],
      added: 0,
      removed: 0,
      changed: false,
      simplified: false,
    })
  })

  it("produces minimal disjoint hunks with exact old and new line numbers", () => {
    const before = Array.from({ length: 18 }, (_, index) => `line ${index + 1}`).join("\n")
    const after = before
      .replace("line 3", "changed 3")
      .replace("line 16", "changed 16")
    const model = createTextDiffModel(before, after, { contextLines: 2 })

    expect(model).toMatchObject({ added: 2, removed: 2, changed: true, simplified: false })
    expect(model.rows.filter(({ kind }) => kind !== "context")).toEqual([
      { kind: "removed", text: "line 3", beforeLine: 3 },
      { kind: "added", text: "changed 3", afterLine: 3 },
      { kind: "removed", text: "line 16", beforeLine: 16 },
      { kind: "added", text: "changed 16", afterLine: 16 },
    ])
    expect(model.rows).toContainEqual({ kind: "context", text: "… 8 líneas sin cambios omitidas" })
  })

  it("applies complexity guards only after trimming a large common prefix and suffix", () => {
    const prefix = Array.from({ length: 50 }, (_, index) => `prefix ${index + 1}`)
    const suffix = Array.from({ length: 50 }, (_, index) => `suffix ${index + 1}`)
    const model = createTextDiffModel(
      [...prefix, "before", ...suffix].join("\n"),
      [...prefix, "after", ...suffix].join("\n"),
      { maxChangedLines: 2, maxMatrixCells: 1 },
    )

    expect(model.simplified).toBe(false)
    expect(model.rows.filter(({ kind }) => kind === "removed")).toEqual([
      { kind: "removed", text: "before", beforeLine: 51 },
    ])
    expect(model.rows.filter(({ kind }) => kind === "added")).toEqual([
      { kind: "added", text: "after", afterLine: 51 },
    ])
  })

  it("falls back to an exact non-minimal removed/added block at the line guard", () => {
    const model = createTextDiffModel("a\nb\nc", "x\ny\nz", {
      maxChangedLines: 5,
      maxMatrixCells: 100,
    })

    expect(model).toMatchObject({ added: 3, removed: 3, changed: true, simplified: true })
    expect(model.rows.map(({ kind, text }) => [kind, text])).toEqual([
      ["removed", "a\nb\nc"],
      ["added", "x\ny\nz"],
    ])
  })

  it("keeps simplified output DOM-bounded for very large exact blocks", () => {
    const before = Array.from({ length: 200_000 }, (_, index) => `before ${index}`).join("\n")
    const after = Array.from({ length: 200_000 }, (_, index) => `after ${index}`).join("\n")
    const model = createTextDiffModel(before, after)

    expect(model).toMatchObject({ added: 200_000, removed: 200_000, simplified: true })
    expect(model.rows).toHaveLength(2)
    expect(model.rows[0]).toMatchObject({ kind: "removed", beforeLine: 1, text: before })
    expect(model.rows[1]).toMatchObject({ kind: "added", afterLine: 1, text: after })
  })

  it("falls back when only the matrix product guard is exceeded", () => {
    const model = createTextDiffModel("a\nb\nc", "x\ny\nz", {
      maxChangedLines: 10,
      maxMatrixCells: 8,
    })

    expect(model.simplified).toBe(true)
    expect(model).toMatchObject({ added: 3, removed: 3 })
  })

  it("preserves empty lines and a final-newline-only change", () => {
    const addedNewline = createTextDiffModel("alpha", "alpha\n")
    expect(addedNewline).toMatchObject({ added: 1, removed: 0, changed: true })
    expect(addedNewline.rows.at(-1)).toEqual({ kind: "added", text: "", afterLine: 2 })

    const removedNewline = createTextDiffModel("alpha\n", "alpha")
    expect(removedNewline).toMatchObject({ added: 0, removed: 1, changed: true })
    expect(removedNewline.rows.at(-1)).toEqual({ kind: "removed", text: "", beforeLine: 2 })

    const replacedEmpty = createTextDiffModel("alpha\n\nomega", "alpha\nvalue\nomega")
    expect(replacedEmpty.rows.filter(({ kind }) => kind !== "context")).toEqual([
      { kind: "removed", text: "", beforeLine: 2 },
      { kind: "added", text: "value", afterLine: 2 },
    ])
  })

  it("does not normalize CRLF source lines", () => {
    const model = createTextDiffModel("alpha\r\nbeta\r\n", "alpha\nbeta\n")

    expect(model.rows.filter(({ kind }) => kind === "removed").map(({ text }) => text)).toEqual([
      "alpha\r",
      "beta\r",
    ])
    expect(model.rows.filter(({ kind }) => kind === "added").map(({ text }) => text)).toEqual([
      "alpha",
      "beta",
    ])
  })

  it("collapses only long unchanged spans and states the omitted line count", () => {
    const short = createTextDiffModel("a\nb\nc\nd", "a\nb\nchanged\nd", { contextLines: 2 })
    expect(short.rows.some(({ beforeLine, afterLine }) => beforeLine === undefined && afterLine === undefined)).toBe(false)

    const long = createTextDiffModel(
      "a\nb\nc\nd\ne\nf\ng\nh\ni",
      "a\nb\nchanged\nd\ne\nf\ng\nh\ni",
      { contextLines: 1 },
    )
    expect(long.rows).toContainEqual({ kind: "context", text: "… 5 líneas sin cambios omitidas" })
  })
})

describe("TextDiff", () => {
  it("renders semantic rows, markers, desktop numbers, compact numbers, and accessible labels", () => {
    act(() => root.render(createElement(TextDiff, {
      before: "one\ntwo\nthree",
      after: "one\nTWO\nthree\nfour",
    })))

    const diff = container.querySelector<HTMLElement>(".text-diff")
    expect(diff?.getAttribute("role")).toBe("list")
    expect(diff?.getAttribute("aria-label")).toBe("Diferencia exacta del contenido")
    expect(diff?.dataset.added).toBe("2")
    expect(diff?.dataset.removed).toBe("1")
    expect(diff?.dataset.simplified).toBe("false")

    const removed = container.querySelector<HTMLElement>(".diff-removed")
    expect(removed?.dataset.beforeLine).toBe("2")
    expect(removed?.querySelector(".diff-marker")?.textContent).toBe("−")
    expect(removed?.querySelector(".diff-number-before")?.textContent).toBe("2")
    expect(removed?.querySelector(".diff-number-after")?.textContent).toBe("")
    expect(removed?.querySelector(".diff-number-compact")?.textContent).toBe("2")
    expect(removed?.querySelector(".sr-only")?.textContent).toBe("Línea eliminada 2")

    const added = [...container.querySelectorAll<HTMLElement>(".diff-added")]
    expect(added.map((row) => row.querySelector(".diff-marker")?.textContent)).toEqual(["+", "+"])
    expect(added.map((row) => row.querySelector(".sr-only")?.textContent)).toEqual([
      "Línea añadida 2",
      "Línea añadida 4",
    ])
    expect(added.at(-1)?.querySelector(".diff-number-after")?.textContent).toBe("4")
    expect(added.at(-1)?.querySelector(".diff-number-compact")?.textContent).toBe("4")
  })

  it("renders an explicit textual omitted row without fabricated line numbers", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n")
    const after = before.replace("line 10", "changed")
    act(() => root.render(createElement(TextDiff, { before, after })))

    const omitted = container.querySelector<HTMLElement>(".diff-omitted")
    expect(omitted).not.toBeNull()
    expect(omitted?.querySelector(".diff-marker")?.textContent).toBe("…")
    expect(omitted?.querySelector(".diff-number-before")?.textContent).toBe("")
    expect(omitted?.querySelector(".diff-number-after")?.textContent).toBe("")
    expect(omitted?.querySelector(".diff-content")?.textContent).toMatch(/líneas sin cambios omitidas/)
  })
})
