import type { IpcMain, IpcMainInvokeEvent } from "electron"

import {
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  type AckDto,
  type InspectInstallationInput,
  type InstallationDetailDto,
  type InventoryPageDto,
  type InventoryQuery,
} from "@forge/contracts"

import type { InventoryService } from "./service.js"

export interface RegisterInventoryIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">
  readonly inventoryService: InventoryService
  readonly isTrustedSender: (url: string) => boolean
}

function senderUrl(event: IpcMainInvokeEvent): string {
  return event.senderFrame?.url ?? event.sender.getURL()
}

export function registerInventoryIpc(options: RegisterInventoryIpcOptions): () => void {
  const register = <TInput, TOutput>(
    channel: keyof typeof IPC_INVOKE_CONTRACTS,
    handler: (input: TInput) => Promise<TOutput>,
  ): void => {
    const contract = IPC_INVOKE_CONTRACTS[channel]
    options.ipcMain.handle(channel, async (event, rawInput: unknown) => {
      if (!options.isTrustedSender(senderUrl(event))) throw new Error("Untrusted renderer IPC sender")
      const input = contract.input.parse(rawInput) as TInput
      return contract.output.parse(await handler(input))
    })
  }
  register<InventoryQuery, InventoryPageDto>(
    IPC_INVOKE_CHANNELS.inventoryList,
    (input) => options.inventoryService.list(input),
  )
  register<InspectInstallationInput, InstallationDetailDto>(
    IPC_INVOKE_CHANNELS.inventoryInspect,
    (input) => options.inventoryService.inspect(input),
  )
  register<InspectInstallationInput, AckDto>(
    IPC_INVOKE_CHANNELS.inventoryOpenEntry,
    (input) => options.inventoryService.openEntry(input),
  )
  return () => {
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.inventoryList)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.inventoryInspect)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.inventoryOpenEntry)
  }
}
