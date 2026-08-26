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

export const ScanFindingDtoSchema = z.object({
  code: z.string().min(1).max(128),
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1).max(2_000),
  rootId: RootIdSchema.optional(),
  adapterId: z.string().min(1).max(128).optional(),
  path: z.string().min(1).max(4_096).optional(),
  causeCode: z.string().min(1).max(128).optional(),
}).strict()

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
    findings: z.array(ScanFindingDtoSchema).max(128).optional(),
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
export type ScanFindingDto = z.infer<typeof ScanFindingDtoSchema>
export type OperationProgressEvent = z.infer<
  typeof OperationProgressEventSchema
>
export type OperationCompletedEvent = z.infer<
  typeof OperationCompletedEventSchema
>
