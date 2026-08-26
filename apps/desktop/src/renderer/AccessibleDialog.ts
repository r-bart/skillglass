import {
  createElement,
  useEffect,
  useRef,
  type ReactNode,
} from "react"

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function focusableChildren(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => (
    !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true"
  ))
}

export function AccessibleDialog({
  labelledBy,
  onDismiss,
  returnFocus,
  children,
}: {
  readonly labelledBy: string
  readonly onDismiss?: () => void
  readonly returnFocus?: HTMLElement | null
  readonly children?: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const dismissRef = useRef(onDismiss)
  const previousFocusRef = useRef<HTMLElement | undefined>(
    document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
  )
  dismissRef.current = onDismiss

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    const initial = focusableChildren(dialog)[0] ?? dialog
    initial.focus()

    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && dismissRef.current !== undefined) {
        event.preventDefault()
        dismissRef.current()
        return
      }
      if (event.key !== "Tab") return
      const focusable = focusableChildren(dialog)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener("keydown", keydown)
    return () => {
      dialog.removeEventListener("keydown", keydown)
      const restoreTarget = returnFocus ?? previousFocusRef.current
      if (restoreTarget?.isConnected === true) restoreTarget.focus()
    }
  }, [returnFocus])

  return createElement(
    "div",
    { className: "modal-backdrop" },
    createElement(
      "div",
      {
        ref: dialogRef,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": labelledBy,
        className: "operation-dialog",
        tabIndex: -1,
      },
      children,
    ),
  )
}
