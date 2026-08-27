import { createElement, type ReactNode } from "react"

export function markdownBody(source: string): string {
  const opening = /^(?:\uFEFF)?---(?:\r\n|\n|\r)/u.exec(source)
  if (opening === null) return source
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/gmu
  closing.lastIndex = opening[0].length
  const match = closing.exec(source)
  return match === null ? source : source.slice(match.index + match[0].length)
}

export interface SafeMarkdownProps {
  readonly source: string
  /** Raises draft heading levels when the renderer is nested below a page heading. */
  readonly headingOffset?: number
}

/**
 * Intentionally small read-only renderer. Every token is emitted as React text;
 * raw HTML, links, images, directives and scripts are never interpreted.
 */
export function SafeMarkdown({ source, headingOffset = 0 }: SafeMarkdownProps) {
  const nodes: ReactNode[] = []
  const lines = markdownBody(source).split(/\r\n|\n|\r/u)
  const safeHeadingOffset = Number.isFinite(headingOffset)
    ? Math.max(0, Math.min(5, Math.floor(headingOffset)))
    : 0
  let code: string[] | undefined
  let listItems: string[] = []

  const flushList = () => {
    if (listItems.length === 0) return
    nodes.push(createElement(
      "ul",
      { key: nodes.length },
      ...listItems.map((item, index) => createElement("li", { key: index }, item)),
    ))
    listItems = []
  }

  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      if (code === undefined) {
        flushList()
        code = []
      } else {
        nodes.push(createElement("pre", { key: nodes.length }, createElement("code", null, code.join("\n"))))
        code = undefined
      }
      continue
    }
    if (code !== undefined) {
      code.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (heading !== null) {
      flushList()
      const level = Math.min(6, (heading[1]?.length ?? 3) + safeHeadingOffset)
      nodes.push(createElement(`h${level}`, { key: nodes.length }, heading[2]))
      continue
    }
    const listItem = /^\s*[-*+]\s+(.+)$/u.exec(line)
    if (listItem !== null) {
      listItems.push(listItem[1] ?? "")
      continue
    }
    flushList()
    if (line.trim().length > 0) {
      nodes.push(createElement("p", { key: nodes.length }, line))
    }
  }
  flushList()
  if (code !== undefined) {
    nodes.push(createElement("pre", { key: nodes.length }, createElement("code", null, code.join("\n"))))
  }
  return createElement("div", { className: "safe-markdown" }, ...nodes)
}
