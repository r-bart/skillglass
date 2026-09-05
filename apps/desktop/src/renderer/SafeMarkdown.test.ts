import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { markdownBody, SafeMarkdown } from "./SafeMarkdown.js"
import { setActiveLocale } from "./i18n.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setActiveLocale("es")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(source: string): void {
  act(() => root.render(createElement(SafeMarkdown, { source })))
}

describe("SafeMarkdown", () => {
  it("omits complete frontmatter from the preview without changing malformed source", () => {
    expect(markdownBody("---\r\nname: demo\r\n...\r\n# Body")).toBe("# Body")
    expect(markdownBody("\uFEFF---\nname: demo\n---\nBody")).toBe("Body")
    expect(markdownBody("---\nname: demo\nBody")).toBe("---\nname: demo\nBody")
  })

  it("renders headings and groups adjacent items into one semantic list", () => {
    render("# Heading\n\n- First\n- Second\n- Third\n\nAfter")

    expect(container.querySelector("h1")?.textContent).toBe("Heading")
    expect(container.querySelectorAll("ul")).toHaveLength(1)
    expect([...container.querySelectorAll("li")].map(({ textContent }) => textContent))
      .toEqual(["First", "Second", "Third"])
    expect(container.querySelector(".safe-markdown > p")?.textContent).toBe("After")
  })

  it("can nest draft headings below a page heading without changing the default", () => {
    act(() => root.render(createElement(SafeMarkdown, {
      headingOffset: 1,
      source: "# Draft title\n## Section\n###### Deep section",
    })))

    expect(container.querySelector("h1")).toBeNull()
    expect(container.querySelector("h2")?.textContent).toBe("Draft title")
    expect(container.querySelector("h3")?.textContent).toBe("Section")
    expect(container.querySelector("h6")?.textContent).toBe("Deep section")

    render("# Standalone title")
    expect(container.querySelector("h1")?.textContent).toBe("Standalone title")
  })

  it("renders CommonMark and GFM structure through a React element allowlist", () => {
    render([
      "**Bold** and *emphasis* with `inline` and ~~removed~~.",
      "",
      "1. First",
      "2. Second",
      "",
      "> A quoted note",
      "",
      "---",
      "",
      "| Name | State |",
      "| --- | --- |",
      "| alpha | ready |",
    ].join("\n"))

    expect(container.querySelector("strong")?.textContent).toBe("Bold")
    expect(container.querySelector("em")?.textContent).toBe("emphasis")
    expect(container.querySelector("p code")?.textContent).toBe("inline")
    expect(container.querySelector("del")?.textContent).toBe("removed")
    expect([...container.querySelectorAll("ol li")].map(({ textContent }) => textContent))
      .toEqual(["First", "Second"])
    expect(container.querySelector("blockquote")?.textContent).toContain("A quoted note")
    expect(container.querySelector("hr")).not.toBeNull()
    expect([...container.querySelectorAll("table tr")]).toHaveLength(2)
    expect(container.querySelector("table")?.textContent).toContain("alphaready")
  })

  it("keeps HTML, unsafe links, and images inert while allowing existing GitHub navigation", () => {
    const source = [
      "<script>globalThis.pwned = true</script>",
      "[Open](javascript:alert(1))",
      "[Repository](https://github.com/r-bart/skillglass)",
      "[Outside](https://example.com/docs)",
      "![Pixel](https://example.com/pixel.png)",
      "::directive{value=\"unsafe\"}",
    ].join("\n")
    render(source)

    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelectorAll("a")).toHaveLength(1)
    expect(container.querySelector("a")?.href).toBe("https://github.com/r-bart/skillglass")
    expect(container.textContent).toContain("<script>globalThis.pwned = true</script>")
    expect(container.textContent).toContain("Open (javascript:alert(1))")
    expect(container.textContent).toContain("Outside (https://example.com/docs)")
    expect(container.textContent).toContain("[Imagen: Pixel] (https://example.com/pixel.png)")
    expect(container.textContent).toContain("::directive{value=\"unsafe\"}")
  })

  it("renders fenced content as literal code without interpreting Markdown or HTML", () => {
    render("```html\n<h2>Literal</h2>\n[Link](https://example.com)\n```")

    expect(container.querySelector("pre code")?.textContent)
      .toBe("html<h2>Literal</h2>\n[Link](https://example.com)")
    expect(container.querySelector("h2")).toBeNull()
    expect(container.querySelector("a")).toBeNull()
  })

  it("shows fenced language names as text and never as executable markup", () => {
    render("```<img src=x onerror=alert(1)>\nconst safe = true\n```")

    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".safe-markdown__code-language")?.textContent)
      .toBe("<img")
    expect(container.querySelector("pre code")?.textContent).toContain("const safe = true")
  })
})
