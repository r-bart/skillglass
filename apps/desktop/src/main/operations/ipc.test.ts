import type { IpcMainInvokeEvent } from "electron"
import { describe, expect, it, vi } from "vitest"

import {
  IPC_INVOKE_CHANNELS,
  type OperationPlanDto,
  type OperationResultDto,
} from "@forge/contracts"
import type { ContentUpdateCoordinator } from "@forge/operations"

import { registerOperationIpc } from "./ipc.js"
import { DesktopOperationService } from "./service.js"

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>

function event(url: string): IpcMainInvokeEvent {
  return {
    senderFrame: { url },
    sender: { getURL: () => url },
  } as unknown as IpcMainInvokeEvent
}

const plan: OperationPlanDto = {
  planId: "plan_update",
  kind: "update-entry-content",
  status: "planned",
  createdAt: "2026-08-26T10:00:00.000Z",
  expiresAt: "2026-08-26T10:15:00.000Z",
  adapterId: "codex",
  installationIds: ["installation_review"],
  targetRootId: "root_global",
  affectedScopes: [{ kind: "global" }],
  affectedEntries: [{ action: "modify", rootId: "root_global", installationId: "installation_review", relativePath: "review/SKILL.md" }],
  preconditions: [], conflicts: [], warnings: [], undo: "persistent",
  summary: "Actualizar review/SKILL.md",
}

const result: OperationResultDto = {
  operationId: "operation_update",
  planId: plan.planId,
  journalId: plan.planId,
  status: "committed",
  finishedAt: "2026-08-26T10:01:00.000Z",
  installationIds: ["installation_review"],
  message: "Skill actualizada",
  issues: [],
  undoAvailable: true,
}

describe("operation main IPC", () => {
  it("accepts only opaque installation/snapshot/plan IDs from a trusted renderer", async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
      removeHandler(channel: string) { handlers.delete(channel) },
    }
    const coordinator = {
      plan: vi.fn(() => Promise.resolve(plan)),
      confirm: vi.fn(() => Promise.resolve(result)),
      undo: vi.fn(() => Promise.resolve({ ...result, message: "Actualización deshecha", undoAvailable: false })),
      history: vi.fn(() => ({ items: [{ journalId: plan.planId, kind: plan.kind, installationIds: plan.installationIds, createdAt: plan.createdAt, undoAvailable: true }] })),
    } as unknown as ContentUpdateCoordinator
    const dispose = registerOperationIpc({
      ipcMain,
      service: new DesktopOperationService(coordinator),
      isTrustedSender: (url) => url === "forge://app/index.html",
    })
    const planHandler = handlers.get(IPC_INVOKE_CHANNELS.operationsPlan)
    const confirmHandler = handlers.get(IPC_INVOKE_CHANNELS.operationsConfirm)
    const historyHandler = handlers.get(IPC_INVOKE_CHANNELS.operationsHistory)
    if (planHandler === undefined || confirmHandler === undefined || historyHandler === undefined) {
      throw new Error("Operation handlers were not registered")
    }

    await expect(planHandler(event("forge://evil/index.html"), {
      kind: "update-entry-content",
      installationId: "installation_review",
      expectedSnapshotId: "snapshot_original",
      content: "changed",
    })).rejects.toThrow("Untrusted")
    await expect(planHandler(event("forge://app/index.html"), {
      kind: "update-entry-content",
      installationId: "/safe/review/SKILL.md",
      expectedSnapshotId: "snapshot_original",
      content: "changed",
    })).rejects.toThrow()
    await expect(planHandler(event("forge://app/index.html"), {
      kind: "update-entry-content",
      installationId: "installation_review",
      expectedSnapshotId: "snapshot_original",
      content: "changed",
    })).resolves.toEqual(plan)
    await expect(confirmHandler(event("forge://app/index.html"), {
      planId: "../../plan",
    })).rejects.toThrow()
    await expect(historyHandler(event("forge://app/index.html"), {})).resolves.toMatchObject({ items: [{ journalId: "plan_update" }] })

    dispose()
    expect(handlers.size).toBe(0)
  })
})
