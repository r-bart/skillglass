import { markdown } from "@codemirror/lang-markdown"
import { Compartment, EditorState } from "@codemirror/state"
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view"
import { useCallback, useEffect, useRef } from "react"
import { createElement } from "./i18n.js"

export interface CodeEditorProps {
  readonly ariaLabel: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly dirty?: boolean
  readonly busy?: boolean
  readonly onReview?: () => void
  readonly onFocusReady?: (focus: (() => void) | null) => void
}

function lineSeparator(source: string): string {
  return /\r\n|\r|\n/u.exec(source)?.[0] ?? "\n"
}

/** Markdown editor kept entirely in the sandboxed renderer. */
export function CodeEditor({
  ariaLabel,
  value,
  onChange,
  dirty = false,
  busy = false,
  onReview,
  onFocusReady,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const dirtyRef = useRef(dirty)
  const busyRef = useRef(busy)
  const onReviewRef = useRef(onReview)
  const lineSeparatorCompartment = useRef(new Compartment())
  onChangeRef.current = onChange
  dirtyRef.current = dirty
  busyRef.current = busy
  onReviewRef.current = onReview

  const focus = useCallback(() => {
    view.current?.focus()
  }, [])

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineSeparatorCompartment.current.of(EditorState.lineSeparator.of(lineSeparator(value))),
          EditorView.cspNonce.of(window.forgeStyleNonce ?? ""),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          markdown(),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                if (!dirtyRef.current || busyRef.current || onReviewRef.current === undefined) return false
                onReviewRef.current()
                return true
              },
            },
          ]),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.sliceDoc())
          }),
          EditorView.theme({
            "&": { height: "100%", minHeight: "0" },
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
    if (editor === null) return
    const nextSeparator = lineSeparator(value)
    if (editor.state.lineBreak !== nextSeparator) {
      editor.dispatch({
        effects: lineSeparatorCompartment.current.reconfigure(EditorState.lineSeparator.of(nextSeparator)),
      })
    }
    if (editor.state.sliceDoc() === value) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    onFocusReady?.(focus)
    return () => onFocusReady?.(null)
  }, [focus, onFocusReady])

  return createElement("div", { className: "code-editor", ref: host })
}
