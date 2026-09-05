import { gfmFromMarkdown } from "mdast-util-gfm"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfm } from "micromark-extension-gfm"
import { createElement, Fragment, type ReactNode } from "react"
import { getActiveLocale } from "./i18n.js"

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

interface MarkdownNode {
  readonly type: string
  readonly value?: string
  readonly depth?: number
  readonly url?: string
  readonly alt?: string | null
  readonly title?: string | null
  readonly lang?: string | null
  readonly checked?: boolean | null
  readonly align?: readonly ("left" | "right" | "center" | null)[]
  readonly identifier?: string
  readonly children?: readonly MarkdownNode[]
}

function githubHref(candidate: string | undefined): string | undefined {
  if (candidate === undefined || candidate.length > 2_048) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" &&
      url.origin === "https://github.com" &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

function nodeText(node: MarkdownNode): string {
  if (node.value !== undefined) return node.value
  return node.children?.map(nodeText).join("") ?? ""
}

function renderChildren(node: MarkdownNode, key: string, headingOffset: number): ReactNode[] {
  return node.children?.map((child, index) => renderNode(child, `${key}:${index}`, headingOffset)) ?? []
}

function renderNode(node: MarkdownNode, key: string, headingOffset: number): ReactNode {
  const children = renderChildren(node, key, headingOffset)
  switch (node.type) {
    case "root": return createElement(Fragment, { key }, ...children)
    case "text": return node.value ?? ""
    case "paragraph": return createElement("p", { key }, ...children)
    case "heading": {
      const level = Math.min(6, Math.max(1, (node.depth ?? 1) + headingOffset))
      return createElement(`h${level}`, { key }, ...children)
    }
    case "emphasis": return createElement("em", { key }, ...children)
    case "strong": return createElement("strong", { key }, ...children)
    case "delete": return createElement("del", { key }, ...children)
    case "inlineCode": return createElement("code", { key }, node.value ?? "")
    case "code": return createElement(
      "pre",
      { key },
      createElement(
        "code",
        null,
        node.lang === null || node.lang === undefined || node.lang === ""
          ? null
          : createElement("span", { className: "safe-markdown__code-language" }, node.lang),
        node.value ?? "",
      ),
    )
    case "list": {
      const ordered = "ordered" in node && (node as MarkdownNode & { ordered?: boolean }).ordered === true
      const start = "start" in node ? (node as MarkdownNode & { start?: number | null }).start : undefined
      return createElement(ordered ? "ol" : "ul", { key, ...(ordered && start != null ? { start } : {}) }, ...children)
    }
    case "listItem": return createElement(
      "li",
      { key },
      node.checked === null || node.checked === undefined
        ? null
        : createElement("input", {
            "aria-label": getActiveLocale() === "es"
              ? node.checked ? "Tarea completada" : "Tarea pendiente"
              : node.checked ? "Completed task" : "Pending task",
            checked: node.checked,
            disabled: true,
            readOnly: true,
            tabIndex: -1,
            type: "checkbox",
          }),
      ...children,
    )
    case "blockquote": return createElement("blockquote", { key }, ...children)
    case "thematicBreak": return createElement("hr", { key })
    case "break": return createElement("br", { key })
    case "table": return createElement(
      "div",
      { className: "safe-markdown__table-wrap", key },
      createElement("table", null, createElement("tbody", null, ...children)),
    )
    case "tableRow": return createElement("tr", { key }, ...children)
    case "tableCell": return createElement("td", { key }, ...children)
    case "link": {
      const href = githubHref(node.url)
      return href === undefined
        ? createElement("span", { className: "safe-markdown__inert-link", key }, ...children, node.url === undefined ? null : ` (${node.url})`)
        : createElement("a", { href, key, rel: "noreferrer", target: "_blank", title: node.title ?? undefined }, ...children)
    }
    case "image": return createElement(
      "span",
      { className: "safe-markdown__inert-image", key },
      getActiveLocale() === "es"
        ? `[Imagen: ${node.alt?.trim() || "sin texto alternativo"}]`
        : `[Image: ${node.alt?.trim() || "no alternative text"}]`,
      node.url === undefined ? null : ` (${node.url})`,
    )
    case "html": return createElement("code", { className: "safe-markdown__raw-html", key }, node.value ?? "")
    case "footnoteReference": return createElement("sup", { key }, `[${node.identifier ?? ""}]`)
    case "footnoteDefinition": return createElement("aside", { className: "safe-markdown__footnote", key }, ...children)
    case "definition": return null
    default: {
      const text = nodeText(node)
      return children.length > 0
        ? createElement(Fragment, { key }, ...children)
        : text
    }
  }
}

/**
 * Parses CommonMark and GFM into an mdast tree, then maps only known nodes to
 * React elements. Raw HTML and images remain inert text and no HTML string is
 * ever inserted into the document.
 */
export function SafeMarkdown({ source, headingOffset = 0 }: SafeMarkdownProps) {
  const safeHeadingOffset = Number.isFinite(headingOffset)
    ? Math.max(0, Math.min(5, Math.floor(headingOffset)))
    : 0
  const tree = fromMarkdown(markdownBody(source), {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as MarkdownNode
  return createElement(
    "div",
    { className: "safe-markdown" },
    ...renderChildren(tree, "root", safeHeadingOffset),
  )
}
