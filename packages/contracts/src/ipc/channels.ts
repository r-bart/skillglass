import { z } from "zod"

export const IPC_INVOKE_CHANNELS = {
  onboardingProposedRoots: "forge:onboarding:proposed-roots",
  onboardingSelectAdditionalRoot: "forge:onboarding:select-additional-root",
  onboardingApproveRoots: "forge:onboarding:approve-roots",
  inventoryList: "forge:inventory:list",
  inventoryInspect: "forge:inventory:inspect",
  operationsSelectLocalSource: "forge:operations:select-local-source",
  operationsPlan: "forge:operations:plan",
  operationsConfirm: "forge:operations:confirm",
  operationsUndo: "forge:operations:undo",
} as const

export const IPC_EVENT_CHANNELS = {
  rootsChanged: "forge:event:roots-changed",
  inventoryChanged: "forge:event:inventory-changed",
  operationProgress: "forge:event:operation-progress",
  operationCompleted: "forge:event:operation-completed",
} as const

export const IPC_INVOKE_CHANNEL_ALLOWLIST = Object.freeze(
  Object.values(IPC_INVOKE_CHANNELS),
)
export const IPC_EVENT_CHANNEL_ALLOWLIST = Object.freeze(
  Object.values(IPC_EVENT_CHANNELS),
)

export const IpcInvokeChannelSchema = z.enum(IPC_INVOKE_CHANNEL_ALLOWLIST)
export const IpcEventChannelSchema = z.enum(IPC_EVENT_CHANNEL_ALLOWLIST)

export type IpcInvokeChannel = z.infer<typeof IpcInvokeChannelSchema>
export type IpcEventChannel = z.infer<typeof IpcEventChannelSchema>
