import { createElement, type ReactNode } from "react"

export interface TextDiffProps {
  readonly before: string
  readonly after: string
}

function lines(source: string): string[] {
  return source.split("\n")
}

/** Exact, bounded line diff: unchanged prefix/suffix plus one changed hunk. */
export function TextDiff({ before, after }: TextDiffProps): ReactNode {
  const previous = lines(before)
  const next = lines(after)
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1

  const contextBefore = previous.slice(Math.max(0, prefix - 2), prefix)
  const removed = previous.slice(prefix, previous.length - suffix)
  const added = next.slice(prefix, next.length - suffix)
  const contextAfter = suffix === 0 ? [] : previous.slice(previous.length - suffix, previous.length - suffix + 2)
  const rows: ReactNode[] = []
  if (prefix > 2) rows.push(createElement("span", { className: "diff-line diff-context", key: "prefix-gap" }, `… ${prefix - 2} líneas sin cambios`))
  contextBefore.forEach((line, index) => rows.push(createElement("span", { className: "diff-line diff-context", key: `before:${index}` }, `  ${line}`)))
  removed.forEach((line, index) => rows.push(createElement("span", { className: "diff-line diff-removed", key: `removed:${index}` }, `− ${line}`)))
  added.forEach((line, index) => rows.push(createElement("span", { className: "diff-line diff-added", key: `added:${index}` }, `+ ${line}`)))
  contextAfter.forEach((line, index) => rows.push(createElement("span", { className: "diff-line diff-context", key: `after:${index}` }, `  ${line}`)))
  if (suffix > 2) rows.push(createElement("span", { className: "diff-line diff-context", key: "suffix-gap" }, `… ${suffix - 2} líneas sin cambios`))

  return createElement("pre", { className: "text-diff", "aria-label": "Diferencia exacta del contenido" }, ...rows)
}
