import { z } from "zod"

import {
  AdapterIdSchema,
  InstallationIdSchema,
  IsoDateTimeSchema,
  JournalIdSchema,
  OperationIdSchema,
  PlanIdSchema,
  ProjectIdSchema,
  RelativeDisplayPathSchema,
  RootIdSchema,
  SelectionTokenSchema,
  Sha256Schema,
  SnapshotIdSchema,
} from "./primitives.js"

export const LocalSourceKindSchema = z.enum(["directory", "zip"])

export const SelectLocalSourceInputSchema = z
  .object({ kind: LocalSourceKindSchema })
  .strict()

export const LocalSourceSelectionDtoSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("directory"),
      selectionToken: SelectionTokenSchema,
      displayName: z.string().min(1).max(512),
      treeHash: Sha256Schema,
      expiresAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("zip"),
      selectionToken: SelectionTokenSchema,
      displayName: z.string().min(1).max(512),
      archiveSha256: Sha256Schema,
      treeHash: Sha256Schema,
      expiresAt: IsoDateTimeSchema,
    })
    .strict(),
])

export const LocalInstallSourceDtoSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("directory"),
      selectionToken: SelectionTokenSchema,
      treeHash: Sha256Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("zip"),
      selectionToken: SelectionTokenSchema,
      archiveSha256: Sha256Schema,
      treeHash: Sha256Schema,
    })
    .strict(),
])

export const OperationRequestDtoSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("install-local"),
      source: LocalInstallSourceDtoSchema,
      targetRootId: RootIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("update-from-local"),
      installationId: InstallationIdSchema,
      expectedSnapshotId: SnapshotIdSchema,
      source: LocalInstallSourceDtoSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("update-entry-content"),
      installationId: InstallationIdSchema,
      expectedSnapshotId: SnapshotIdSchema,
      content: z.string().max(10 * 1_024 * 1_024),
    })
    .strict(),
])

export const OperationPlanStatusSchema = z.enum([
  "planned",
  "blocked",
  "expired",
])

export const OperationIssueDtoSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4_000),
    relativePath: RelativeDisplayPathSchema.optional(),
  })
  .strict()

export const ScopeRefDtoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("project"), projectId: ProjectIdSchema }).strict(),
])

export const AffectedEntryDtoSchema = z
  .object({
    action: z.enum(["create", "modify"]),
    rootId: RootIdSchema,
    installationId: InstallationIdSchema.optional(),
    relativePath: RelativeDisplayPathSchema,
  })
  .strict()

export const OperationPlanDtoSchema = z
  .object({
    planId: PlanIdSchema,
    kind: z.enum([
      "install-local",
      "update-from-local",
      "update-entry-content",
    ]),
    status: OperationPlanStatusSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    adapterId: AdapterIdSchema,
    installationIds: z.array(InstallationIdSchema).max(128),
    targetRootId: RootIdSchema,
    affectedScopes: z.array(ScopeRefDtoSchema).max(128),
    affectedEntries: z.array(AffectedEntryDtoSchema).max(2_000),
    preconditions: z.array(OperationIssueDtoSchema).max(128),
    conflicts: z.array(OperationIssueDtoSchema).max(128),
    warnings: z.array(OperationIssueDtoSchema).max(128),
    undo: z.enum(["persistent", "not-supported"]),
    summary: z.string().min(1).max(4_000),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.status === "blocked" && plan.conflicts.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A blocked plan must explain at least one conflict",
        path: ["conflicts"],
      })
    }
  })

export const ConfirmOperationInputSchema = z
  .object({ planId: PlanIdSchema })
  .strict()

export const UndoOperationInputSchema = z
  .object({ journalId: JournalIdSchema })
  .strict()

export const OperationResultStatusSchema = z.enum([
  "committed",
  "rolled-back",
  "recovery-required",
  "conflict",
  "stale",
  "failed",
])

export const OperationResultDtoSchema = z
  .object({
    operationId: OperationIdSchema,
    planId: PlanIdSchema.optional(),
    journalId: JournalIdSchema,
    status: OperationResultStatusSchema,
    finishedAt: IsoDateTimeSchema,
    installationIds: z.array(InstallationIdSchema).max(128),
    message: z.string().min(1).max(4_000),
    issues: z.array(OperationIssueDtoSchema).max(128),
    undoAvailable: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status !== "committed" && result.undoAvailable) {
      context.addIssue({
        code: "custom",
        message: "Undo is only available for committed operations",
        path: ["undoAvailable"],
      })
    }
  })

export type SelectLocalSourceInput = z.infer<
  typeof SelectLocalSourceInputSchema
>
export type LocalSourceSelectionDto = z.infer<
  typeof LocalSourceSelectionDtoSchema
>
export type OperationRequestDto = z.infer<typeof OperationRequestDtoSchema>
export type OperationPlanDto = z.infer<typeof OperationPlanDtoSchema>
export type ConfirmOperationInput = z.infer<typeof ConfirmOperationInputSchema>
export type UndoOperationInput = z.infer<typeof UndoOperationInputSchema>
export type OperationResultDto = z.infer<typeof OperationResultDtoSchema>
