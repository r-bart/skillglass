import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  type IpcEventChannel,
  type IpcInvokeChannel,
} from "@forge/contracts"
import { describe, expect, it, vi } from "vitest"

import { createForgeBridge, type IpcRendererPort } from "../../preload/bridge.js"

const candidate = {
  candidateId: "candidate_fixture",
  adapterId: "folder",
  displayName: "Folder · Añadida por ti",
  displayPath: "/safe/skills",
  kind: "user-added" as const,
  access: "read-write" as const,
  writableWithoutElevation: true,
  discovery: { kind: "observed" as const, source: "native-directory-selection" },
}

function port(responses: ReadonlyMap<string, unknown>) {
  const listeners = new Map<string, (_event: unknown, payload: unknown) => void>()
  const invoke = vi.fn((channel: IpcInvokeChannel) => Promise.resolve(responses.get(channel)))
  const value: IpcRendererPort = {
    invoke,
    on(channel, listener) { listeners.set(channel, listener) },
    removeListener(channel) { listeners.delete(channel) },
  }
  return { value, invoke, emit: (channel: IpcEventChannel, payload: unknown) => listeners.get(channel)?.({}, payload) }
}

describe("validated preload bridge", () => {
  it("validates lifecycle requests and close-state responses", async () => {
    const ipc = port(new Map([[IPC_INVOKE_CHANNELS.lifecycleRespondToClose, { ok: true }]]))
    const bridge = createForgeBridge(ipc.value)
    const listener = vi.fn()
    bridge.lifecycle.onCloseRequested(listener)
    const request = { requestId: `close_${"a".repeat(32)}`, reason: "window" as const }
    ipc.emit(IPC_EVENT_CHANNELS.lifecycleCloseRequested, request)
    expect(listener).toHaveBeenCalledWith(request)
    await expect(bridge.lifecycle.respondToClose({
      requestId: request.requestId,
      revision: 3,
      state: "dirty",
      locale: "es",
    })).resolves.toEqual({ ok: true })
    expect(() => bridge.lifecycle.respondToClose({
      requestId: "../../close",
      revision: 3,
      state: "clean",
      locale: "es",
    })).toThrow()
  })

  it("exposes onboarding through allowlisted channels and validates both directions", async () => {
    const state = {
      status: "required", proposedRoots: [candidate], selectedCandidateIds: [], approvedRoots: [],
    }
    const ipc = port(new Map([
      [IPC_INVOKE_CHANNELS.onboardingState, state],
      [IPC_INVOKE_CHANNELS.onboardingSelectProject, state],
    ]))
    const bridge = createForgeBridge(ipc.value)
    await expect(bridge.onboarding.state()).resolves.toMatchObject({ status: "required" })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_INVOKE_CHANNELS.onboardingState, {})
    await expect(bridge.onboarding.selectProject()).resolves.toMatchObject({ status: "required" })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_INVOKE_CHANNELS.onboardingSelectProject, {})
    expect(() => bridge.onboarding.approveRoots({ candidateIds: ["/arbitrary/path"] })).toThrow()
    expect(ipc.invoke).toHaveBeenCalledTimes(2)
  })

  it("validates event payloads before delivering them", () => {
    const ipc = port(new Map())
    const listener = vi.fn()
    createForgeBridge(ipc.value).events.onRootsChanged(listener)
    expect(() => ipc.emit(IPC_EVENT_CHANNELS.rootsChanged, { rootIds: ["/path"], observedAt: "bad" })).toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it("reveals an observed entry by opaque installation ID without accepting a path", async () => {
    const ipc = port(new Map([[IPC_INVOKE_CHANNELS.inventoryOpenEntry, {
      ok: true,
    }]]))
    const bridge = createForgeBridge(ipc.value)

    await expect(bridge.inventory.openEntry({
      installationId: "installation_alpha",
    })).resolves.toEqual({ ok: true })
    expect(ipc.invoke).toHaveBeenCalledWith(
      IPC_INVOKE_CHANNELS.inventoryOpenEntry,
      { installationId: "installation_alpha" },
    )
    expect(() => bridge.inventory.openEntry({
      installationId: "../../private",
    })).toThrow()
    expect(ipc.invoke).toHaveBeenCalledTimes(1)
  })

  it("exposes monitoring state and save through validated allowlisted channels", async () => {
    const state = {
      status: "complete" as const,
      selectedInstallationIds: ["installation_alpha"],
      completedAt: "2026-08-27T10:00:00.000Z",
    }
    const ipc = port(new Map([
      [IPC_INVOKE_CHANNELS.monitoringState, state],
      [IPC_INVOKE_CHANNELS.monitoringSave, state],
    ]))
    const bridge = createForgeBridge(ipc.value)

    await expect(bridge.monitoring.state()).resolves.toEqual(state)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_INVOKE_CHANNELS.monitoringState, {})
    await expect(bridge.monitoring.save({
      installationIds: ["installation_alpha"],
    })).resolves.toEqual(state)
    expect(ipc.invoke).toHaveBeenCalledWith(
      IPC_INVOKE_CHANNELS.monitoringSave,
      { installationIds: ["installation_alpha"] },
    )
    expect(() => bridge.monitoring.save({
      installationIds: ["installation_alpha", "installation_alpha"],
    })).toThrow("Installation IDs must be unique")
    expect(ipc.invoke).toHaveBeenCalledTimes(2)
  })
})
