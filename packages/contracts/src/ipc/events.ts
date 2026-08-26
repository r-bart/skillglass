import { z } from "zod"

import {
  InstallationIdSchema,
  IsoDateTimeSchema,
  JournalIdSchema,
  OperationIdSchema,
  PlanIdSchema,
  RootIdSchema,
} from "./primitives.js"
import { OperationResultDtoSchema } from "./operations.js"

export const RootsChangedEventSchema = z
  .object({
    rootIds: z.array(RootIdSchema).max(128),
    observedAt: IsoDateTimeSchema,
  })
  .strict()

export const InventoryChangedEventSchema = z
  .object({
    installationIds: z.array(InstallationIdSchema).max(2_000),
    reason: z.enum(["scan", "watcher", "operation", "root-approval"]),
    observedAt: IsoDateTimeSchema,
  })
  .strict()

export const OperationProgressEventSchema = z
  .object({
    operationId: OperationIdSchema,
    planId: PlanIdSchema,
    journalId: JournalIdSchema,
    stage: z.enum([
      "preconditions-checked",
      "staged",
      "snapshot-created",
      "applying",
      "verifying",
      "rolling-back",
    ]),
    message: z.string().min(1).max(2_000),
  })
  .strict()

export const OperationCompletedEventSchema = OperationResultDtoSchema

export type RootsChangedEvent = z.infer<typeof RootsChangedEventSchema>
export type InventoryChangedEvent = z.infer<
  typeof InventoryChangedEventSchema
>
export type OperationProgressEvent = z.infer<
  typeof OperationProgressEventSchema
>
export type OperationCompletedEvent = z.infer<
  typeof OperationCompletedEventSchema
>
