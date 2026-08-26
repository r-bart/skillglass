import type { IpcMain, IpcMainInvokeEvent } from "electron"

import {
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  type AckDto,
  type ConfirmOperationInput,
  type OperationHistoryDto,
  type OperationPlanDto,
  type OperationRequestDto,
  type OperationResultDto,
  type LocalSourceSelectionDto,
  type SelectLocalSourceInput,
  type UndoOperationInput,
} from "@forge/contracts"

import type { DesktopOperationService } from "./service.js"

export interface RegisterOperationIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">
  readonly service: DesktopOperationService
  readonly isTrustedSender: (url: string) => boolean
}

function senderUrl(event: IpcMainInvokeEvent): string {
  return event.senderFrame?.url ?? event.sender.getURL()
}

export function registerOperationIpc(options: RegisterOperationIpcOptions): () => void {
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

  register<OperationRequestDto, OperationPlanDto>(
    IPC_INVOKE_CHANNELS.operationsPlan,
    (input) => options.service.plan(input),
  )
  register<SelectLocalSourceInput, LocalSourceSelectionDto | null>(
    IPC_INVOKE_CHANNELS.operationsSelectLocalSource,
    (input) => options.service.selectLocalSource(input),
  )
  register<ConfirmOperationInput, OperationResultDto>(
    IPC_INVOKE_CHANNELS.operationsConfirm,
    (input) => options.service.confirm(input),
  )
  register<UndoOperationInput, OperationResultDto>(
    IPC_INVOKE_CHANNELS.operationsUndo,
    (input) => options.service.undo(input),
  )
  register<Record<string, never>, OperationHistoryDto>(
    IPC_INVOKE_CHANNELS.operationsHistory,
    () => options.service.history(),
  )
  register<Record<string, never>, AckDto>(
    IPC_INVOKE_CHANNELS.operationsRefreshUpdates,
    () => options.service.refreshUpdates(),
  )

  return () => {
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.operationsPlan)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.operationsSelectLocalSource)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.operationsConfirm)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.operationsUndo)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.operationsHistory)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.operationsRefreshUpdates)
  }
}
