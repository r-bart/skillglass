import { markdown } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view"
import { createElement, useEffect, useRef } from "react"

export interface CodeEditorProps {
  readonly ariaLabel: string
  readonly value: string
  readonly onChange: (value: string) => void
}

/** Markdown editor kept entirely in the sandboxed renderer. */
export function CodeEditor({ ariaLabel, value, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          markdown(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.theme({
            "&": { height: "24rem" },
            ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" },
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      view.current = null
      editor.destroy()
    }
    // The instance owns its document after mounting; prop updates are handled below.
  }, [ariaLabel])

  useEffect(() => {
    const editor = view.current
    if (editor === null || editor.state.doc.toString() === value) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  }, [value])

  return createElement("div", { className: "code-editor", ref: host })
}
