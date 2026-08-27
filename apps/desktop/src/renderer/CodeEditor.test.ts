import { EditorView } from "@codemirror/view"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CodeEditor } from "./CodeEditor.js"

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

describe("CodeEditor", () => {
  it("round-trips CRLF while editing and can reconfigure for a new baseline", () => {
    const onChange = vi.fn()
    act(() => root.render(createElement(CodeEditor, {
      ariaLabel: "Contenido",
      onChange,
      value: "alpha\r\nbeta\r\n",
    })))

    const element = container.querySelector<HTMLElement>(".cm-editor")
    const editor = element === null ? null : EditorView.findFromDOM(element)
    if (editor === null) throw new Error("CodeMirror was not rendered")
    expect(editor.state.sliceDoc()).toBe("alpha\r\nbeta\r\n")

    act(() => editor.dispatch({ changes: { from: 5, insert: "!" } }))
    expect(onChange).toHaveBeenLastCalledWith("alpha!\r\nbeta\r\n")

    act(() => root.render(createElement(CodeEditor, {
      ariaLabel: "Contenido",
      onChange,
      value: "one\ntwo\n",
    })))
    expect(editor.state.sliceDoc()).toBe("one\ntwo\n")
  })
})
