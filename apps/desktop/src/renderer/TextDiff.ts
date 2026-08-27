import { type ReactNode } from "react"
import { createElement } from "./i18n.js"

export interface DiffRow {
  readonly kind: "context" | "added" | "removed"
  readonly text: string
  readonly beforeLine?: number
  readonly afterLine?: number
}

export interface TextDiffModel {
  readonly rows: readonly DiffRow[]
  readonly added: number
  readonly removed: number
  readonly changed: boolean
  readonly simplified: boolean
}

export interface TextDiffOptions {
  readonly contextLines?: number
  readonly maxChangedLines?: number
  readonly maxMatrixCells?: number
}

export interface TextDiffProps {
  readonly before: string
  readonly after: string
}

export const TEXT_DIFF_DEFAULTS = {
  contextLines: 3,
  maxChangedLines: 2_000,
  maxMatrixCells: 250_000,
} as const

function lines(source: string): readonly string[] {
  return source.length === 0 ? [] : source.split("\n")
}

function boundedInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function omittedContext(count: number): DiffRow {
  return {
    kind: "context",
    text: `… ${count} ${count === 1 ? "línea sin cambios omitida" : "líneas sin cambios omitidas"}`,
  }
}

function collapseContextRun(
  run: readonly DiffRow[],
  hasChangeBefore: boolean,
  hasChangeAfter: boolean,
  contextLines: number,
): readonly DiffRow[] {
  const threshold = contextLines * 2 + 1
  if (run.length <= threshold) return run
  if (contextLines === 0) return [omittedContext(run.length)]

  if (!hasChangeBefore && hasChangeAfter) {
    return [omittedContext(run.length - contextLines), ...run.slice(-contextLines)]
  }
  if (hasChangeBefore && !hasChangeAfter) {
    return [...run.slice(0, contextLines), omittedContext(run.length - contextLines)]
  }

  const omitted = run.length - contextLines * 2
  return [
    ...run.slice(0, contextLines),
    omittedContext(omitted),
    ...run.slice(run.length - contextLines),
  ]
}

function collapseContext(rows: readonly DiffRow[], contextLines: number): readonly DiffRow[] {
  const collapsed: DiffRow[] = []
  let index = 0
  while (index < rows.length) {
    if (rows[index]?.kind !== "context") {
      const row = rows[index]
      if (row !== undefined) collapsed.push(row)
      index += 1
      continue
    }

    const start = index
    while (index < rows.length && rows[index]?.kind === "context") index += 1
    collapsed.push(...collapseContextRun(
      rows.slice(start, index),
      start > 0,
      index < rows.length,
      contextLines,
    ))
  }
  return collapsed
}

function contextRow(text: string, beforeLine: number, afterLine: number): DiffRow {
  return { kind: "context", text, beforeLine, afterLine }
}

function boundaryContextRows(
  source: readonly string[],
  beforeStart: number,
  afterStart: number,
  count: number,
  placement: "before-change" | "after-change",
  contextLines: number,
): readonly DiffRow[] {
  const rowAt = (offset: number): DiffRow => contextRow(
    source[beforeStart + offset] ?? "",
    beforeStart + offset + 1,
    afterStart + offset + 1,
  )
  const threshold = contextLines * 2 + 1
  if (count <= threshold) return Array.from({ length: count }, (_, offset) => rowAt(offset))
  if (contextLines === 0) return [omittedContext(count)]

  if (placement === "before-change") {
    return [
      omittedContext(count - contextLines),
      ...Array.from({ length: contextLines }, (_, offset) => rowAt(count - contextLines + offset)),
    ]
  }
  return [
    ...Array.from({ length: contextLines }, (_, offset) => rowAt(offset)),
    omittedContext(count - contextLines),
  ]
}

function fallbackRows(
  previous: readonly string[],
  next: readonly string[],
  previousOffset: number,
  nextOffset: number,
): readonly DiffRow[] {
  const rows: DiffRow[] = []
  if (previous.length > 0) {
    rows.push({
      kind: "removed",
      text: previous.join("\n"),
      beforeLine: previousOffset + 1,
    })
  }
  if (next.length > 0) {
    rows.push({
      kind: "added",
      text: next.join("\n"),
      afterLine: nextOffset + 1,
    })
  }
  return rows
}

function minimalRows(
  previous: readonly string[],
  next: readonly string[],
  previousOffset: number,
  nextOffset: number,
): readonly DiffRow[] {
  const table = Array.from(
    { length: previous.length + 1 },
    () => new Uint32Array(next.length + 1),
  )

  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex -= 1) {
    const row = table[previousIndex]
    const followingRow = table[previousIndex + 1]
    if (row === undefined || followingRow === undefined) continue
    for (let nextIndex = next.length - 1; nextIndex >= 0; nextIndex -= 1) {
      row[nextIndex] = previous[previousIndex] === next[nextIndex]
        ? (followingRow[nextIndex + 1] ?? 0) + 1
        : Math.max(followingRow[nextIndex] ?? 0, row[nextIndex + 1] ?? 0)
    }
  }

  const rows: DiffRow[] = []
  let previousIndex = 0
  let nextIndex = 0
  while (previousIndex < previous.length || nextIndex < next.length) {
    if (
      previousIndex < previous.length &&
      nextIndex < next.length &&
      previous[previousIndex] === next[nextIndex]
    ) {
      rows.push(contextRow(
        previous[previousIndex] ?? "",
        previousOffset + previousIndex + 1,
        nextOffset + nextIndex + 1,
      ))
      previousIndex += 1
      nextIndex += 1
      continue
    }

    const removeScore = table[previousIndex + 1]?.[nextIndex] ?? 0
    const addScore = table[previousIndex]?.[nextIndex + 1] ?? 0
    if (previousIndex < previous.length && (nextIndex >= next.length || removeScore >= addScore)) {
      rows.push({
        kind: "removed",
        text: previous[previousIndex] ?? "",
        beforeLine: previousOffset + previousIndex + 1,
      })
      previousIndex += 1
    } else {
      rows.push({
        kind: "added",
        text: next[nextIndex] ?? "",
        afterLine: nextOffset + nextIndex + 1,
      })
      nextIndex += 1
    }
  }
  return rows
}

export function createTextDiffModel(
  before: string,
  after: string,
  options: TextDiffOptions = {},
): TextDiffModel {
  if (before === after) {
    return { rows: [], added: 0, removed: 0, changed: false, simplified: false }
  }

  const previous = lines(before)
  const next = lines(after)
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1
  }

  const previousMiddle = previous.slice(prefix, previous.length - suffix)
  const nextMiddle = next.slice(prefix, next.length - suffix)
  const maxChangedLines = boundedInteger(options.maxChangedLines, TEXT_DIFF_DEFAULTS.maxChangedLines)
  const maxMatrixCells = boundedInteger(options.maxMatrixCells, TEXT_DIFF_DEFAULTS.maxMatrixCells)
  const contextLines = boundedInteger(options.contextLines, TEXT_DIFF_DEFAULTS.contextLines)
  const lineLimitExceeded = previousMiddle.length + nextMiddle.length > maxChangedLines
  const productLimitExceeded = nextMiddle.length > 0 && previousMiddle.length > Math.floor(maxMatrixCells / nextMiddle.length)
  const simplified = lineLimitExceeded || productLimitExceeded

  const middleRows = simplified
    ? fallbackRows(previousMiddle, nextMiddle, prefix, prefix)
    : minimalRows(previousMiddle, nextMiddle, prefix, prefix)

  const added = simplified
    ? nextMiddle.length
    : middleRows.filter(({ kind }) => kind === "added").length
  const removed = simplified
    ? previousMiddle.length
    : middleRows.filter(({ kind }) => kind === "removed").length
  return {
    rows: [
      ...boundaryContextRows(previous, 0, 0, prefix, "before-change", contextLines),
      ...collapseContext(middleRows, contextLines),
      ...boundaryContextRows(
        previous,
        previous.length - suffix,
        next.length - suffix,
        suffix,
        "after-change",
        contextLines,
      ),
    ],
    added,
    removed,
    changed: true,
    simplified,
  }
}

function rowLabel(row: DiffRow): string {
  const rowLineCount = row.text.split("\n").length
  if (row.kind === "added") {
    const first = row.afterLine
    const last = first === undefined ? undefined : first + rowLineCount - 1
    return rowLineCount === 1
      ? `Línea añadida ${first ?? ""}`.trimEnd()
      : `Líneas añadidas ${first ?? ""}–${last ?? ""}`.trimEnd()
  }
  if (row.kind === "removed") {
    const first = row.beforeLine
    const last = first === undefined ? undefined : first + rowLineCount - 1
    return rowLineCount === 1
      ? `Línea eliminada ${first ?? ""}`.trimEnd()
      : `Líneas eliminadas ${first ?? ""}–${last ?? ""}`.trimEnd()
  }
  if (row.beforeLine === undefined && row.afterLine === undefined) return row.text
  return `Línea sin cambios ${row.afterLine ?? row.beforeLine ?? ""}`.trimEnd()
}

function renderRow(row: DiffRow, index: number): ReactNode {
  const omitted = row.kind === "context" && row.beforeLine === undefined && row.afterLine === undefined
  const marker = row.kind === "added" ? "+" : row.kind === "removed" ? "−" : omitted ? "…" : ""
  const effectiveLine = row.afterLine ?? row.beforeLine
  return createElement(
    "span",
    {
      className: `diff-line diff-${row.kind}${omitted ? " diff-omitted" : ""}`,
      "data-after-line": row.afterLine,
      "data-before-line": row.beforeLine,
      "data-kind": row.kind,
      key: `${index}:${row.kind}:${row.beforeLine ?? ""}:${row.afterLine ?? ""}`,
      role: "listitem",
    },
    createElement("span", { className: "sr-only" }, rowLabel(row)),
    createElement("span", { "aria-hidden": true, className: "diff-marker" }, marker),
    createElement("span", { "aria-hidden": true, className: "diff-number diff-number-before" }, row.beforeLine ?? ""),
    createElement("span", { "aria-hidden": true, className: "diff-number diff-number-after" }, row.afterLine ?? ""),
    createElement("span", { "aria-hidden": true, className: "diff-number diff-number-compact" }, effectiveLine ?? ""),
    createElement("code", { className: "diff-content" }, row.text),
  )
}

export function TextDiff({ before, after }: TextDiffProps): ReactNode {
  const model = createTextDiffModel(before, after)
  return createElement(
    "pre",
    {
      "aria-label": "Diferencia exacta del contenido",
      className: "text-diff",
      "data-added": model.added,
      "data-removed": model.removed,
      "data-simplified": model.simplified,
      role: "list",
    },
    ...model.rows.map(renderRow),
  )
}
