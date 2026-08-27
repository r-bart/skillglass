import { z } from "zod"

import { InstallationIdSchema, IsoDateTimeSchema } from "./primitives.js"

export const MAX_MONITORED_INSTALLATIONS = 2_000

function rejectDuplicateInstallationIds(
  value: { installationIds: readonly string[] },
  context: z.RefinementCtx,
) {
  if (new Set(value.installationIds).size !== value.installationIds.length) {
    context.addIssue({
      code: "custom",
      message: "Installation IDs must be unique",
      path: ["installationIds"],
    })
  }
}

export const MonitoringStateDtoSchema = z
  .object({
    status: z.enum(["required", "complete"]),
    selectedInstallationIds: z
      .array(InstallationIdSchema)
      .max(MAX_MONITORED_INSTALLATIONS),
    completedAt: IsoDateTimeSchema.optional(),
  })
  .strict()

export const SaveMonitoringSelectionInputSchema = z
  .object({
    installationIds: z
      .array(InstallationIdSchema)
      .max(MAX_MONITORED_INSTALLATIONS),
  })
  .strict()
  .superRefine(rejectDuplicateInstallationIds)

export type MonitoringStateDto = z.infer<typeof MonitoringStateDtoSchema>
export type SaveMonitoringSelectionInput = z.infer<
  typeof SaveMonitoringSelectionInputSchema
>
