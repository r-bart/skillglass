import type { IpcMain } from "electron"

import {
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  type MonitoringStateDto,
  type SaveMonitoringSelectionInput,
} from "@forge/contracts"

import { isTrustedIpcSender } from "../security.js"
import type { MonitoringService } from "./service.js"

export interface RegisterMonitoringIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">
  readonly monitoringService: Pick<MonitoringService, "state" | "save">
  readonly startupReady: Promise<void>
  readonly isTrustedSender: (url: string) => boolean
}

export function registerMonitoringIpc(options: RegisterMonitoringIpcOptions): () => void {
  const register = <TInput, TOutput>(
    channel: keyof typeof IPC_INVOKE_CONTRACTS,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): void => {
    const contract = IPC_INVOKE_CONTRACTS[channel]
    options.ipcMain.handle(channel, async (event, rawInput: unknown) => {
      if (!isTrustedIpcSender(event, options.isTrustedSender)) {
        throw new Error("Untrusted renderer IPC sender")
      }
      const input = contract.input.parse(rawInput) as TInput
      await options.startupReady
      return contract.output.parse(await handler(input))
    })
  }

  register<Readonly<Record<string, never>>, MonitoringStateDto>(
    IPC_INVOKE_CHANNELS.monitoringState,
    () => options.monitoringService.state(),
  )
  register<SaveMonitoringSelectionInput, MonitoringStateDto>(
    IPC_INVOKE_CHANNELS.monitoringSave,
    (input) => options.monitoringService.save(input),
  )

  return () => {
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.monitoringState)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.monitoringSave)
  }
}
