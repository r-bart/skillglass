import type { IpcMainInvokeEvent } from "electron"

import { IPC_INVOKE_CHANNELS, type MonitoringStateDto } from "@forge/contracts"
import { describe, expect, it, vi } from "vitest"

import { registerMonitoringIpc } from "./ipc.js"

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>

function event(url: string): IpcMainInvokeEvent {
  const frame = { url }
  return {
    senderFrame: frame,
    sender: { mainFrame: frame, getURL: () => url },
  } as unknown as IpcMainInvokeEvent
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const requiredState: MonitoringStateDto = {
  status: "required",
  selectedInstallationIds: [],
}

describe("monitoring main IPC", () => {
  it("waits for startup before reading or saving monitoring state", async () => {
    const handlers = new Map<string, Handler>()
    const startup = deferred()
    const state = vi.fn(() => requiredState)
    const save = vi.fn(() => ({
      status: "complete" as const,
      selectedInstallationIds: ["installation_alpha"],
      completedAt: "2026-08-27T10:00:00.000Z",
    }))
    const dispose = registerMonitoringIpc({
      ipcMain: {
        handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
        removeHandler(channel: string) { handlers.delete(channel) },
      },
      monitoringService: { state, save },
      startupReady: startup.promise,
      isTrustedSender: (url) => url === "forge://app/index.html",
    })
    const stateHandler = handlers.get(IPC_INVOKE_CHANNELS.monitoringState)
    const saveHandler = handlers.get(IPC_INVOKE_CHANNELS.monitoringSave)
    if (stateHandler === undefined || saveHandler === undefined) {
      throw new Error("Handlers were not registered")
    }

    const stateResult = stateHandler(event("forge://app/index.html"), {})
    const saveResult = saveHandler(event("forge://app/index.html"), {
      installationIds: ["installation_alpha"],
    })
    await Promise.resolve()
    expect(state).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()

    startup.resolve()
    await expect(stateResult).resolves.toEqual(requiredState)
    await expect(saveResult).resolves.toMatchObject({ status: "complete" })
    expect(save).toHaveBeenCalledWith({ installationIds: ["installation_alpha"] })

    dispose()
    expect(handlers.size).toBe(0)
  })

  it("rejects untrusted senders and malformed inputs before startup", async () => {
    const handlers = new Map<string, Handler>()
    const startup = deferred()
    const save = vi.fn(() => requiredState)
    registerMonitoringIpc({
      ipcMain: {
        handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
        removeHandler(channel: string) { handlers.delete(channel) },
      },
      monitoringService: { state: () => requiredState, save },
      startupReady: startup.promise,
      isTrustedSender: (url) => url === "forge://app/index.html",
    })
    const saveHandler = handlers.get(IPC_INVOKE_CHANNELS.monitoringSave)
    if (saveHandler === undefined) throw new Error("Save handler was not registered")

    await expect(saveHandler(event("forge://evil/index.html"), {
      installationIds: [],
    })).rejects.toThrow("Untrusted")
    await expect(saveHandler(event("forge://app/index.html"), {
      installationIds: ["../../private"],
    })).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()
    startup.resolve()
  })

  it("propagates startup failure without calling the service", async () => {
    const handlers = new Map<string, Handler>()
    const startup = deferred()
    const state = vi.fn(() => requiredState)
    registerMonitoringIpc({
      ipcMain: {
        handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
        removeHandler(channel: string) { handlers.delete(channel) },
      },
      monitoringService: { state, save: () => requiredState },
      startupReady: startup.promise,
      isTrustedSender: () => true,
    })
    const stateHandler = handlers.get(IPC_INVOKE_CHANNELS.monitoringState)
    if (stateHandler === undefined) throw new Error("State handler was not registered")

    const result = stateHandler(event("forge://app/index.html"), {})
    startup.reject(new Error("startup scan failed"))
    await expect(result).rejects.toThrow("startup scan failed")
    expect(state).not.toHaveBeenCalled()
  })

  it("validates service output at the main-process boundary", async () => {
    const handlers = new Map<string, Handler>()
    registerMonitoringIpc({
      ipcMain: {
        handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
        removeHandler(channel: string) { handlers.delete(channel) },
      },
      monitoringService: {
        state: () => ({ status: "complete", selectedInstallationIds: ["../../private"] }) as MonitoringStateDto,
        save: () => requiredState,
      },
      startupReady: Promise.resolve(),
      isTrustedSender: () => true,
    })
    const stateHandler = handlers.get(IPC_INVOKE_CHANNELS.monitoringState)
    if (stateHandler === undefined) throw new Error("State handler was not registered")

    await expect(stateHandler(event("forge://app/index.html"), {})).rejects.toThrow()
  })
})
