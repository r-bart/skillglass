import { randomBytes } from "node:crypto"

import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron"

import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  type CloseRequestEvent,
  type CloseStateResponse,
} from "@forge/contracts"

import { isTrustedIpcSender } from "./security.js"

type CloseReason = CloseRequestEvent["reason"]
type GuardState = "open" | "querying" | "confirming" | "authorized"

export interface PreventableCloseEvent {
  preventDefault(): void
}

export interface CloseDialogOptions {
  readonly kind: "busy" | "query-failed" | "unsaved"
  readonly locale: "es" | "en"
}

export interface WindowCloseGuardOptions {
  readonly currentWindow: () => BrowserWindow | undefined
  readonly hasActiveOperation: () => boolean
  readonly sendRequest: (window: BrowserWindow, request: CloseRequestEvent) => void
  readonly showDialog: (window: BrowserWindow, options: CloseDialogOptions) => Promise<"stay" | "discard">
  readonly quit: () => void
  readonly defaultLocale?: () => "es" | "en"
  readonly queryTimeoutMs?: number
}

interface PendingRequest {
  readonly requestId: string
  readonly reason: CloseReason
  readonly timer: ReturnType<typeof setTimeout>
}

export class WindowCloseGuard {
  readonly #options: WindowCloseGuardOptions
  #state: GuardState = "open"
  #pending: PendingRequest | undefined
  #authorizedWindow: BrowserWindow | undefined
  #quitAuthorized = false

  constructor(options: WindowCloseGuardOptions) {
    this.#options = options
  }

  get state(): GuardState {
    return this.#state
  }

  handleWindowClose(window: BrowserWindow, event: PreventableCloseEvent): void {
    if (this.#quitAuthorized) return
    if (this.#authorizedWindow === window) {
      this.#authorizedWindow = undefined
      this.#state = "open"
      return
    }
    event.preventDefault()
    void this.requestClose("window")
  }

  handleBeforeQuit(event: PreventableCloseEvent): boolean {
    if (this.#quitAuthorized) return true
    const window = this.#options.currentWindow()
    if (window === undefined || window.isDestroyed()) return true
    event.preventDefault()
    void this.requestClose("quit")
    return false
  }

  async requestClose(reason: CloseReason): Promise<void> {
    if (this.#state !== "open") return
    const window = this.#options.currentWindow()
    if (window === undefined || window.isDestroyed()) {
      if (reason === "quit") {
        this.#quitAuthorized = true
        this.#state = "authorized"
        this.#options.quit()
      }
      return
    }
    if (this.#options.hasActiveOperation()) {
      this.#state = "confirming"
      await this.#showAndReset(window, { kind: "busy", locale: this.#options.defaultLocale?.() ?? "en" })
      return
    }

    this.#state = "querying"
    const request: CloseRequestEvent = {
      requestId: `close_${randomBytes(16).toString("hex")}`,
      reason,
    }
    const timer = setTimeout(() => {
      if (this.#pending?.requestId !== request.requestId) return
      this.#pending = undefined
      this.#state = "confirming"
      void this.#showAndReset(window, { kind: "query-failed", locale: this.#options.defaultLocale?.() ?? "en" })
    }, this.#options.queryTimeoutMs ?? 5_000)
    this.#pending = { requestId: request.requestId, reason, timer }
    try {
      this.#options.sendRequest(window, request)
    } catch {
      clearTimeout(timer)
      this.#pending = undefined
      this.#state = "confirming"
      await this.#showAndReset(window, { kind: "query-failed", locale: this.#options.defaultLocale?.() ?? "en" })
    }
  }

  async receiveResponse(response: CloseStateResponse): Promise<void> {
    const pending = this.#pending
    if (pending === undefined || pending.requestId !== response.requestId || this.#state !== "querying") return
    clearTimeout(pending.timer)
    this.#pending = undefined
    const window = this.#options.currentWindow()
    if (window === undefined || window.isDestroyed()) {
      this.#state = "open"
      return
    }
    if (this.#options.hasActiveOperation() || response.state === "busy") {
      this.#state = "confirming"
      await this.#showAndReset(window, { kind: "busy", locale: response.locale })
      return
    }
    if (response.state === "clean") {
      this.#authorize(window, pending.reason)
      return
    }

    this.#state = "confirming"
    let choice: "stay" | "discard"
    try {
      choice = await this.#options.showDialog(window, { kind: "unsaved", locale: response.locale })
    } catch {
      return
    } finally {
      if (this.#state === "confirming") this.#state = "open"
    }
    if (choice === "discard" && !this.#options.hasActiveOperation()) {
      this.#authorize(window, pending.reason)
      return
    }
  }

  dispose(): void {
    if (this.#pending !== undefined) clearTimeout(this.#pending.timer)
    this.#pending = undefined
    this.#state = "open"
    this.#authorizedWindow = undefined
  }

  async #showAndReset(window: BrowserWindow, options: CloseDialogOptions): Promise<void> {
    try {
      await this.#options.showDialog(window, options)
    } catch {
      // A failed native dialog must keep the window open and allow another request.
    } finally {
      if (this.#state === "confirming") this.#state = "open"
    }
  }

  #authorize(window: BrowserWindow, reason: CloseReason): void {
    this.#state = "authorized"
    if (reason === "quit") {
      this.#quitAuthorized = true
      this.#options.quit()
      return
    }
    this.#authorizedWindow = window
    window.close()
  }
}

export function registerWindowCloseGuardIpc(options: {
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">
  readonly guard: WindowCloseGuard
  readonly currentWindow: () => BrowserWindow | undefined
  readonly isTrustedSender: (url: string) => boolean
}): () => void {
  const channel = IPC_INVOKE_CHANNELS.lifecycleRespondToClose
  const contract = IPC_INVOKE_CONTRACTS[channel]
  options.ipcMain.handle(channel, async (event: IpcMainInvokeEvent, rawInput: unknown) => {
    const window = options.currentWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents ||
      !isTrustedIpcSender(event, options.isTrustedSender)) {
      throw new Error("Untrusted renderer IPC sender")
    }
    const input = contract.input.parse(rawInput)
    await options.guard.receiveResponse(input)
    return contract.output.parse({ ok: true })
  })
  return () => options.ipcMain.removeHandler(channel)
}

export function sendCloseRequest(window: BrowserWindow, request: CloseRequestEvent): void {
  window.webContents.send(IPC_EVENT_CHANNELS.lifecycleCloseRequested, request)
}
