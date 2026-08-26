import { z } from "zod"

import { InventoryPageDtoSchema, InspectInstallationInputSchema, InstallationDetailDtoSchema, InventoryQuerySchema } from "./inventory.js"
import {
  ConfirmOperationInputSchema,
  LocalSourceSelectionDtoSchema,
  OperationPlanDtoSchema,
  OperationHistoryDtoSchema,
  OperationRequestDtoSchema,
  OperationResultDtoSchema,
  SelectLocalSourceInputSchema,
  UndoOperationInputSchema,
} from "./operations.js"
import { AckDtoSchema, EmptyInputSchema } from "./primitives.js"
import {
  ApproveRootsInputSchema,
  ApprovedRootDtoSchema,
  OnboardingStateDtoSchema,
  RootCandidateDtoSchema,
  SelectAdditionalRootInputSchema,
} from "./roots.js"
import {
  InventoryChangedEventSchema,
  OperationCompletedEventSchema,
  OperationProgressEventSchema,
  RootsChangedEventSchema,
} from "./events.js"
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from "./channels.js"

const NullableLocalSelectionSchema = LocalSourceSelectionDtoSchema.nullable()
const NullableRootCandidateSchema = RootCandidateDtoSchema.nullable()

/** Runtime schemas keyed by the closed invoke-channel allowlist. */
export const IPC_INVOKE_CONTRACTS = {
  [IPC_INVOKE_CHANNELS.onboardingState]: {
    input: EmptyInputSchema,
    output: OnboardingStateDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.onboardingProposedRoots]: {
    input: EmptyInputSchema,
    output: z.array(RootCandidateDtoSchema),
  },
  [IPC_INVOKE_CHANNELS.onboardingSelectAdditionalRoot]: {
    input: SelectAdditionalRootInputSchema,
    output: NullableRootCandidateSchema,
  },
  [IPC_INVOKE_CHANNELS.onboardingApproveRoots]: {
    input: ApproveRootsInputSchema,
    output: z.array(ApprovedRootDtoSchema),
  },
  [IPC_INVOKE_CHANNELS.inventoryList]: {
    input: InventoryQuerySchema,
    output: InventoryPageDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.inventoryInspect]: {
    input: InspectInstallationInputSchema,
    output: InstallationDetailDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.inventoryOpenEntry]: {
    input: InspectInstallationInputSchema,
    output: AckDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.operationsSelectLocalSource]: {
    input: SelectLocalSourceInputSchema,
    output: NullableLocalSelectionSchema,
  },
  [IPC_INVOKE_CHANNELS.operationsPlan]: {
    input: OperationRequestDtoSchema,
    output: OperationPlanDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.operationsConfirm]: {
    input: ConfirmOperationInputSchema,
    output: OperationResultDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.operationsUndo]: {
    input: UndoOperationInputSchema,
    output: OperationResultDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.operationsHistory]: {
    input: EmptyInputSchema,
    output: OperationHistoryDtoSchema,
  },
  [IPC_INVOKE_CHANNELS.operationsRefreshUpdates]: {
    input: EmptyInputSchema,
    output: AckDtoSchema,
  },
} as const

/** Runtime schemas keyed by the closed event-channel allowlist. */
export const IPC_EVENT_CONTRACTS = {
  [IPC_EVENT_CHANNELS.rootsChanged]: RootsChangedEventSchema,
  [IPC_EVENT_CHANNELS.inventoryChanged]: InventoryChangedEventSchema,
  [IPC_EVENT_CHANNELS.operationProgress]: OperationProgressEventSchema,
  [IPC_EVENT_CHANNELS.operationCompleted]: OperationCompletedEventSchema,
} as const
