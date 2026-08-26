import type { IpcMain, IpcMainInvokeEvent } from "electron"

import {
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  type ApprovedRootDto,
  type OnboardingStateDto,
  type RootCandidateDto,
} from "@forge/contracts"

import type { RootService } from "./root-service.js"

export interface RegisterOnboardingIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">
  readonly rootService: RootService
  readonly isTrustedSender: (url: string) => boolean
}

function senderUrl(event: IpcMainInvokeEvent): string {
  return event.senderFrame?.url ?? event.sender.getURL()
}

export function registerOnboardingIpc(options: RegisterOnboardingIpcOptions): () => void {
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

  register<Readonly<Record<string, never>>, OnboardingStateDto>(
    IPC_INVOKE_CHANNELS.onboardingState,
    () => options.rootService.state(),
  )
  register<Readonly<Record<string, never>>, RootCandidateDto[]>(
    IPC_INVOKE_CHANNELS.onboardingProposedRoots,
    async () => [...await options.rootService.proposedRoots()],
  )
  register<{ adapterId: string }, RootCandidateDto | null>(
    IPC_INVOKE_CHANNELS.onboardingSelectAdditionalRoot,
    ({ adapterId }) => options.rootService.selectAdditionalRoot(adapterId),
  )
  register<{ candidateIds: string[] }, ApprovedRootDto[]>(
    IPC_INVOKE_CHANNELS.onboardingApproveRoots,
    async ({ candidateIds }) => [...await options.rootService.approveRoots(candidateIds)],
  )

  return () => {
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.onboardingState)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.onboardingProposedRoots)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.onboardingSelectAdditionalRoot)
    options.ipcMain.removeHandler(IPC_INVOKE_CHANNELS.onboardingApproveRoots)
  }
}
