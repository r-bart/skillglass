import type { ForgeBridge, IpcEventChannel, IpcInvokeChannel } from "@forge/contracts"
import {
  IPC_EVENT_CHANNELS,
  IPC_EVENT_CONTRACTS,
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
} from "@forge/contracts"

export interface IpcRendererPort {
  invoke(channel: IpcInvokeChannel, input: unknown): Promise<unknown>
  on(channel: IpcEventChannel, listener: (_event: unknown, payload: unknown) => void): void
  removeListener(channel: IpcEventChannel, listener: (_event: unknown, payload: unknown) => void): void
}

function invoke(port: IpcRendererPort, channel: IpcInvokeChannel, input: unknown): Promise<unknown> {
  const contract = IPC_INVOKE_CONTRACTS[channel]
  const validatedInput = contract.input.parse(input)
  return port.invoke(channel, validatedInput).then((output) => contract.output.parse(output))
}

function subscribe<T>(
  port: IpcRendererPort,
  channel: IpcEventChannel,
  listener: (event: T) => void,
): () => void {
  const ipcListener = (_event: unknown, payload: unknown) => {
    listener(IPC_EVENT_CONTRACTS[channel].parse(payload) as T)
  }
  port.on(channel, ipcListener)
  return () => port.removeListener(channel, ipcListener)
}

export function createForgeBridge(port: IpcRendererPort): ForgeBridge {
  return {
    onboarding: {
      state: () => invoke(port, IPC_INVOKE_CHANNELS.onboardingState, {}) as ReturnType<ForgeBridge["onboarding"]["state"]>,
      proposedRoots: () => invoke(port, IPC_INVOKE_CHANNELS.onboardingProposedRoots, {}) as ReturnType<ForgeBridge["onboarding"]["proposedRoots"]>,
      selectAdditionalRoot: (input) => invoke(port, IPC_INVOKE_CHANNELS.onboardingSelectAdditionalRoot, input) as ReturnType<ForgeBridge["onboarding"]["selectAdditionalRoot"]>,
      approveRoots: (input) => invoke(port, IPC_INVOKE_CHANNELS.onboardingApproveRoots, input) as ReturnType<ForgeBridge["onboarding"]["approveRoots"]>,
    },
    inventory: {
      list: (input) => invoke(port, IPC_INVOKE_CHANNELS.inventoryList, input) as ReturnType<ForgeBridge["inventory"]["list"]>,
      inspect: (input) => invoke(port, IPC_INVOKE_CHANNELS.inventoryInspect, input) as ReturnType<ForgeBridge["inventory"]["inspect"]>,
      openEntry: (input) => invoke(port, IPC_INVOKE_CHANNELS.inventoryOpenEntry, input) as ReturnType<ForgeBridge["inventory"]["openEntry"]>,
    },
    operations: {
      selectLocalSource: (input) => invoke(port, IPC_INVOKE_CHANNELS.operationsSelectLocalSource, input) as ReturnType<ForgeBridge["operations"]["selectLocalSource"]>,
      plan: (input) => invoke(port, IPC_INVOKE_CHANNELS.operationsPlan, input) as ReturnType<ForgeBridge["operations"]["plan"]>,
      confirm: (input) => invoke(port, IPC_INVOKE_CHANNELS.operationsConfirm, input) as ReturnType<ForgeBridge["operations"]["confirm"]>,
      undo: (input) => invoke(port, IPC_INVOKE_CHANNELS.operationsUndo, input) as ReturnType<ForgeBridge["operations"]["undo"]>,
    },
    events: {
      onRootsChanged: (listener) => subscribe(port, IPC_EVENT_CHANNELS.rootsChanged, listener),
      onInventoryChanged: (listener) => subscribe(port, IPC_EVENT_CHANNELS.inventoryChanged, listener),
      onOperationProgress: (listener) => subscribe(port, IPC_EVENT_CHANNELS.operationProgress, listener),
      onOperationCompleted: (listener) => subscribe(port, IPC_EVENT_CHANNELS.operationCompleted, listener),
    },
  }
}
