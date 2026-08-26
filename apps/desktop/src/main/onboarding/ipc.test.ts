import type { IpcMainInvokeEvent } from "electron"

import { FolderAdapter } from "@forge/adapter-folder"
import { IPC_INVOKE_CHANNELS } from "@forge/contracts"
import { canonicalPath } from "@forge/domain"
import { describe, expect, it } from "vitest"

import { registerOnboardingIpc } from "./ipc.js"
import { RootService } from "./root-service.js"
import { MemoryRootApprovalSettingsRepository } from "./settings-repository.js"

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>

function event(url: string): IpcMainInvokeEvent {
  const frame = { url }
  return { senderFrame: frame, sender: { mainFrame: frame, getURL: () => url } } as unknown as IpcMainInvokeEvent
}

describe("onboarding main IPC", () => {
  it("validates sender, input, and output around the root service", async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
      removeHandler(channel: string) { handlers.delete(channel) },
    }
    const service = new RootService({
      adapters: [new FolderAdapter({ roots: [] })],
      discoveryContext: {
        homeDirectory: canonicalPath("/virtual/home"),
        workingDirectory: canonicalPath("/virtual/workspace"),
        projects: [],
      },
      settings: new MemoryRootApprovalSettingsRepository(),
      picker: { selectDirectory: () => Promise.resolve(null) },
    })
    const dispose = registerOnboardingIpc({ ipcMain, rootService: service, isTrustedSender: (url) => url === "forge://app/index.html" })
    const stateHandler = handlers.get(IPC_INVOKE_CHANNELS.onboardingState)
    const selectProjectHandler = handlers.get(IPC_INVOKE_CHANNELS.onboardingSelectProject)
    const approveHandler = handlers.get(IPC_INVOKE_CHANNELS.onboardingApproveRoots)
    if (stateHandler === undefined || selectProjectHandler === undefined || approveHandler === undefined) throw new Error("Handlers were not registered")

    await expect(stateHandler(event("forge://evil/index.html"), {})).rejects.toThrow("Untrusted")
    await expect(stateHandler(event("forge://app/index.html"), {})).resolves.toMatchObject({ status: "required" })
    await expect(selectProjectHandler(event("forge://app/index.html"), { unexpected: true })).rejects.toThrow()
    await expect(approveHandler(event("forge://app/index.html"), { candidateIds: ["/tmp/path"] })).rejects.toThrow()
    dispose()
    expect(handlers.size).toBe(0)
  })
})
