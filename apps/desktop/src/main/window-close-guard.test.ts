import type { BrowserWindow, IpcMainInvokeEvent } from "electron"
import { afterEach, describe, expect, it, vi } from "vitest"

import { IPC_INVOKE_CHANNELS, type CloseRequestEvent } from "@forge/contracts"

import { registerWindowCloseGuardIpc, WindowCloseGuard } from "./window-close-guard.js"

function closeEvent() {
  return { preventDefault: vi.fn() }
}

function harness(options: { busy?: boolean; dialog?: "stay" | "discard" } = {}) {
  const requests: CloseRequestEvent[] = []
  const dialogs: string[] = []
  let busy = options.busy === true
  const window = {
    isDestroyed: () => false,
    close: vi.fn(),
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow
  const quit = vi.fn()
  const guard = new WindowCloseGuard({
    currentWindow: () => window,
    hasActiveOperation: () => busy,
    sendRequest: (_window, request) => { requests.push(request) },
    showDialog: (_window, dialog) => {
      dialogs.push(dialog.kind)
      return Promise.resolve(options.dialog ?? "stay")
    },
    quit,
  })
  return { dialogs, guard, quit, requests, setBusy: (value: boolean) => { busy = value }, window }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("WindowCloseGuard", () => {
  it("keeps a dirty draft open, ignores duplicate responses, then consumes one discard authorization", async () => {
    const test = harness({ dialog: "stay" })
    const firstEvent = closeEvent()
    test.guard.handleWindowClose(test.window, firstEvent)
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    const repeatedEvent = closeEvent()
    test.guard.handleWindowClose(test.window, repeatedEvent)
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(test.requests).toHaveLength(1)
    const request = test.requests[0]
    if (request === undefined) throw new Error("Close request missing")

    await test.guard.receiveResponse({ requestId: request.requestId, revision: 4, state: "dirty", locale: "es" })
    expect(test.dialogs).toEqual(["unsaved"])
    expect(test.window.close).not.toHaveBeenCalled()
    await test.guard.receiveResponse({ requestId: request.requestId, revision: 4, state: "clean", locale: "es" })
    expect(test.window.close).not.toHaveBeenCalled()

    const discard = harness({ dialog: "discard" })
    discard.guard.handleWindowClose(discard.window, closeEvent())
    const next = discard.requests[0]
    if (next === undefined) throw new Error("Close request missing")
    await discard.guard.receiveResponse({ requestId: next.requestId, revision: 5, state: "dirty", locale: "en" })
    expect(discard.window.close).toHaveBeenCalledOnce()
    const authorizedEvent = closeEvent()
    discard.guard.handleWindowClose(discard.window, authorizedEvent)
    expect(authorizedEvent.preventDefault).not.toHaveBeenCalled()
    expect(discard.guard.state).toBe("open")
  })

  it("does not query or close while a confirmed operation is active", async () => {
    const test = harness({ busy: true })
    await test.guard.requestClose("window")
    expect(test.requests).toEqual([])
    expect(test.dialogs).toEqual(["busy"])
    expect(test.window.close).not.toHaveBeenCalled()

    test.setBusy(false)
    await test.guard.requestClose("window")
    expect(test.requests).toHaveLength(1)
  })

  it("keeps the window open when the renderer does not answer", async () => {
    vi.useFakeTimers()
    const test = harness()
    const guard = new WindowCloseGuard({
      currentWindow: () => test.window,
      hasActiveOperation: () => false,
      sendRequest: (_window, request) => { test.requests.push(request) },
      showDialog: (_window, dialog) => {
        test.dialogs.push(dialog.kind)
        return Promise.resolve("stay")
      },
      quit: test.quit,
      queryTimeoutMs: 25,
    })
    await guard.requestClose("window")
    await vi.advanceTimersByTimeAsync(25)
    expect(test.dialogs).toEqual(["query-failed"])
    expect(test.window.close).not.toHaveBeenCalled()
    expect(guard.state).toBe("open")
  })

  it("fails closed and accepts another request when the native dialog rejects", async () => {
    const test = harness()
    const guard = new WindowCloseGuard({
      currentWindow: () => test.window,
      hasActiveOperation: () => false,
      sendRequest: (_window, request) => { test.requests.push(request) },
      showDialog: () => Promise.reject(new Error("dialog unavailable")),
      quit: test.quit,
    })

    await guard.requestClose("window")
    const request = test.requests[0]
    if (request === undefined) throw new Error("Close request missing")
    await guard.receiveResponse({ requestId: request.requestId, revision: 1, state: "dirty", locale: "en" })

    expect(test.window.close).not.toHaveBeenCalled()
    expect(guard.state).toBe("open")
    await guard.requestClose("window")
    expect(test.requests).toHaveLength(2)
  })

  it("authorizes quit once and lets the second before-quit event dispose normally", async () => {
    const test = harness()
    const firstEvent = closeEvent()
    expect(test.guard.handleBeforeQuit(firstEvent)).toBe(false)
    const request = test.requests[0]
    if (request === undefined) throw new Error("Quit request missing")
    await test.guard.receiveResponse({ requestId: request.requestId, revision: 0, state: "clean", locale: "en" })
    expect(test.quit).toHaveBeenCalledOnce()

    const authorizedEvent = closeEvent()
    expect(test.guard.handleBeforeQuit(authorizedEvent)).toBe(true)
    expect(authorizedEvent.preventDefault).not.toHaveBeenCalled()
  })

  it("accepts lifecycle responses only from the current trusted webContents", async () => {
    const test = harness()
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>>()
    const ipcMain = {
      handle(channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>) { handlers.set(channel, handler) },
      removeHandler(channel: string) { handlers.delete(channel) },
    }
    const dispose = registerWindowCloseGuardIpc({
      ipcMain,
      guard: test.guard,
      currentWindow: () => test.window,
      isTrustedSender: (url) => url === "forge://app/index.html",
    })
    const handler = handlers.get(IPC_INVOKE_CHANNELS.lifecycleRespondToClose)
    if (handler === undefined) throw new Error("Lifecycle handler missing")
    const trustedFrame = { url: "forge://app/index.html" }
    const trusted = {
      senderFrame: trustedFrame,
      sender: Object.assign(test.window.webContents, { mainFrame: trustedFrame, getURL: () => trustedFrame.url }),
    } as unknown as IpcMainInvokeEvent
    const other = {
      senderFrame: trustedFrame,
      sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
    } as unknown as IpcMainInvokeEvent

    await expect(handler(other, { requestId: `close_${"a".repeat(32)}`, revision: 0, state: "clean", locale: "es" }))
      .rejects.toThrow("Untrusted")
    await expect(handler(trusted, { requestId: "bad", revision: 0, state: "clean", locale: "es" }))
      .rejects.toThrow()
    await expect(handler(trusted, { requestId: `close_${"a".repeat(32)}`, revision: 0, state: "clean", locale: "es" }))
      .resolves.toEqual({ ok: true })

    dispose()
    expect(handlers.size).toBe(0)
  })
})
