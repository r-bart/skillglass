import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CloseRequestEvent, ForgeBridge, WorkspaceCloseState } from "@forge/contracts"

import { useWorkspaceCloseGuard } from "./useWorkspaceCloseGuard.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

function Probe(props: {
  bridge: ForgeBridge["lifecycle"]
  state: WorkspaceCloseState
  revision: number
}) {
  useWorkspaceCloseGuard(props.bridge, { state: props.state, revision: props.revision }, "es")
  return null
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("useWorkspaceCloseGuard", () => {
  it("answers each main request with the latest state and revision and unsubscribes", async () => {
    let listener: ((event: CloseRequestEvent) => void) | undefined
    const unsubscribe = vi.fn()
    const respondToClose = vi.fn(() => Promise.resolve({ ok: true as const }))
    const bridge: ForgeBridge["lifecycle"] = {
      respondToClose,
      onCloseRequested(next) {
        listener = next
        return unsubscribe
      },
    }
    await act(async () => root.render(createElement(Probe, { bridge, state: "clean", revision: 1 })))
    await act(async () => root.render(createElement(Probe, { bridge, state: "dirty", revision: 8 })))
    const request = { requestId: `close_${"b".repeat(32)}`, reason: "quit" as const }
    await act(async () => listener?.(request))
    expect(respondToClose).toHaveBeenCalledWith({
      requestId: request.requestId,
      revision: 8,
      state: "dirty",
      locale: "es",
    })

    act(() => root.unmount())
    expect(unsubscribe).toHaveBeenCalledOnce()
    root = createRoot(container)
  })
})
