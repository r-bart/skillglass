import type { IpcMainInvokeEvent } from "electron"

import {
  IPC_INVOKE_CHANNELS,
  type InstallationDetailDto,
} from "@forge/contracts"
import { canonicalPath, type SkillInstallation } from "@forge/domain"
import type {
  InventoryQueryRepository,
  ProjectionRepository,
} from "@forge/storage"
import { describe, expect, it, vi } from "vitest"

import { registerInventoryIpc } from "./ipc.js"
import { InventoryService } from "./service.js"

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>

function event(url: string): IpcMainInvokeEvent {
  return {
    senderFrame: { url },
    sender: { getURL: () => url },
  } as unknown as IpcMainInvokeEvent
}

const installation: SkillInstallation = {
  id: "installation_alpha",
  adapterId: "codex",
  rootId: "root_global",
  canonicalPath: canonicalPath("/safe/skills/alpha"),
  entryFile: canonicalPath("/safe/skills/alpha/SKILL.md"),
  scope: "global",
  snapshotId: "snapshot_alpha",
  provenanceId: "provenance_alpha",
  access: "read-write",
}

const detail: InstallationDetailDto = {
  installation: {
    installationId: installation.id,
    adapterId: installation.adapterId,
    rootId: installation.rootId,
    scope: { kind: "global" },
    key: "alpha",
    name: {
      state: "known",
      value: "alpha",
      evidence: { kind: "observed" },
    },
    description: {
      state: "unknown",
      evidence: { kind: "unknown" },
    },
    declaredVersion: {
      state: "unknown",
      evidence: { kind: "unknown" },
    },
    status: {
      validity: "valid",
      runtimeState: "unknown",
      source: "local",
      update: "unknown",
      usage: "unavailable",
    },
    observedAt: "2026-08-26T10:00:00.000Z",
  },
  snapshotId: installation.snapshotId,
  locationLabel: installation.canonicalPath,
  entryFile: "SKILL.md",
  rawEntryContent: "---\nname: alpha\n---\n",
  contentHash: "a".repeat(64),
  files: [],
  findings: [],
  requirements: [],
  provenance: {
    id: installation.provenanceId,
    kind: "local",
    sourceLabel: { state: "unknown", evidence: { kind: "unknown" } },
    release: { state: "unknown", evidence: { kind: "unknown" } },
    commit: { state: "unknown", evidence: { kind: "unknown" } },
    license: { state: "unknown", evidence: { kind: "unknown" } },
    managedBy: "user",
  },
  capabilities: {
    canInstallSibling: true,
    canUpdateFromSource: false,
    canEditEntry: true,
    unavailableReasons: [],
  },
}

function projectionRepository(): ProjectionRepository {
  return {
    replaceInventory: () => undefined,
    listProjects: () => [],
    listRoots: () => [],
    listInstallations: () => [installation],
    getInstallation: (id) => id === installation.id ? installation : undefined,
  }
}

describe("inventory main IPC", () => {
  it("validates the sender and bounded query before returning a validated page", async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
      removeHandler(channel: string) {
        handlers.delete(channel)
      },
    }
    const list = vi.fn<InventoryQueryRepository["list"]>(() => ({
      items: [],
      projects: [],
      nextCursor: null,
      total: 0,
      observedAt: "2026-08-26T10:00:00.000Z",
    }))
    const inspect = vi.fn<InventoryQueryRepository["inspect"]>((id) =>
      id === installation.id ? detail : undefined,
    )
    const inventory: InventoryQueryRepository = { list, inspect }
    const showItemInFolder = vi.fn()
    const dispose = registerInventoryIpc({
      ipcMain,
      inventoryService: new InventoryService(
        inventory,
        projectionRepository(),
        { showItemInFolder },
      ),
      isTrustedSender: (url) => url === "forge://app/index.html",
    })
    const handler = handlers.get(IPC_INVOKE_CHANNELS.inventoryList)
    if (handler === undefined) throw new Error("Inventory handler was not registered")

    await expect(handler(event("forge://evil/index.html"), {
      scope: { kind: "all" },
    })).rejects.toThrow("Untrusted")
    await expect(handler(event("forge://app/index.html"), {
      scope: { kind: "root", rootId: "../../private" },
    })).rejects.toThrow()
    await expect(handler(event("forge://app/index.html"), {
      scope: { kind: "all" },
    })).resolves.toMatchObject({ total: 0 })
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: "all" },
      pageSize: 50,
      groupBy: "none",
      sort: { by: "name", direction: "asc" },
    }))

    const inspectHandler = handlers.get(IPC_INVOKE_CHANNELS.inventoryInspect)
    const openHandler = handlers.get(IPC_INVOKE_CHANNELS.inventoryOpenEntry)
    if (inspectHandler === undefined || openHandler === undefined) {
      throw new Error("Inspection handlers were not registered")
    }
    await expect(inspectHandler(event("forge://app/index.html"), {
      installationId: "../../private",
    })).rejects.toThrow()
    await expect(inspectHandler(event("forge://app/index.html"), {
      installationId: installation.id,
    })).resolves.toMatchObject({ snapshotId: installation.snapshotId })
    await expect(openHandler(event("forge://app/index.html"), {
      installationId: installation.id,
    })).resolves.toEqual({ ok: true })
    expect(showItemInFolder).toHaveBeenCalledWith(installation.entryFile)

    dispose()
    expect(handlers.size).toBe(0)
  })
})
