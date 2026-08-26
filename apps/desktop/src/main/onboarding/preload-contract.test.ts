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
  it("exposes onboarding through allowlisted channels and validates both directions", async () => {
    const ipc = port(new Map([[IPC_INVOKE_CHANNELS.onboardingState, {
      status: "required", proposedRoots: [candidate], selectedCandidateIds: [], approvedRoots: [],
    }]]))
    const bridge = createForgeBridge(ipc.value)
    await expect(bridge.onboarding.state()).resolves.toMatchObject({ status: "required" })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_INVOKE_CHANNELS.onboardingState, {})
    expect(() => bridge.onboarding.approveRoots({ candidateIds: ["/arbitrary/path"] })).toThrow()
    expect(ipc.invoke).toHaveBeenCalledTimes(1)
  })

  it("validates event payloads before delivering them", () => {
    const ipc = port(new Map())
    const listener = vi.fn()
    createForgeBridge(ipc.value).events.onRootsChanged(listener)
    expect(() => ipc.emit(IPC_EVENT_CHANNELS.rootsChanged, { rootIds: ["/path"], observedAt: "bad" })).toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})
