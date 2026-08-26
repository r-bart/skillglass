import { z } from "zod"

import { InventoryPageDtoSchema, InspectInstallationInputSchema, InstallationDetailDtoSchema, InventoryQuerySchema } from "./inventory.js"
import {
  ConfirmOperationInputSchema,
  LocalSourceSelectionDtoSchema,
  OperationPlanDtoSchema,
  OperationRequestDtoSchema,
  OperationResultDtoSchema,
  SelectLocalSourceInputSchema,
  UndoOperationInputSchema,
} from "./operations.js"
import { EmptyInputSchema } from "./primitives.js"
import {
  ApproveRootsInputSchema,
  ApprovedRootDtoSchema,
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
} as const

/** Runtime schemas keyed by the closed event-channel allowlist. */
export const IPC_EVENT_CONTRACTS = {
  [IPC_EVENT_CHANNELS.rootsChanged]: RootsChangedEventSchema,
  [IPC_EVENT_CHANNELS.inventoryChanged]: InventoryChangedEventSchema,
  [IPC_EVENT_CHANNELS.operationProgress]: OperationProgressEventSchema,
  [IPC_EVENT_CHANNELS.operationCompleted]: OperationCompletedEventSchema,
} as const
