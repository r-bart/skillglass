import { z } from "zod"

import { evidencedSchema, EvidenceSchema } from "./evidence.js"
import {
  AdapterIdSchema,
  DisplayLabelSchema,
  InstallationIdSchema,
  IsoDateTimeSchema,
  OpaqueIdSchema,
  ProjectIdSchema,
  RelativeDisplayPathSchema,
  RootIdSchema,
  Sha256Schema,
  SnapshotIdSchema,
} from "./primitives.js"

export const InventoryScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("project"), projectId: ProjectIdSchema }).strict(),
  z.object({ kind: z.literal("root"), rootId: RootIdSchema }).strict(),
])

export const ValidityStatusSchema = z.enum([
  "valid",
  "warning",
  "invalid",
  "unknown",
])
export const RuntimeStatusSchema = z.enum([
  "enabled",
  "disabled",
  "inherited",
  "shadowed",
  "unsupported",
  "unknown",
])
export const SourceStatusSchema = z.enum([
  "local",
  "managed",
  "read-only",
  "modified",
  "unknown",
])
export const UpdateStatusSchema = z.enum([
  "current",
  "available",
  "diverged",
  "unavailable",
  "unknown",
])

export const SkillStatusDtoSchema = z
  .object({
    validity: ValidityStatusSchema,
    runtimeState: RuntimeStatusSchema,
    source: SourceStatusSchema,
    update: UpdateStatusSchema,
    usage: z.enum(["observed", "unavailable"]),
  })
  .strict()

export const InventoryQuerySchema = z
  .object({
    scope: InventoryScopeSchema,
    search: z.string().trim().max(200).optional(),
    adapterIds: z.array(AdapterIdSchema).max(32).optional(),
    validity: z.array(ValidityStatusSchema).max(4).optional(),
    updates: z.array(UpdateStatusSchema).max(5).optional(),
    sort: z
      .object({
        by: z.enum(["name", "observedAt", "validity", "update"]),
        direction: z.enum(["asc", "desc"]),
      })
      .strict()
      .default({ by: "name", direction: "asc" }),
    cursor: OpaqueIdSchema.optional(),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .strict()

const EvidencedShortTextSchema = evidencedSchema(z.string().max(2_000))

export const InventoryItemDtoSchema = z
  .object({
    installationId: InstallationIdSchema,
    adapterId: AdapterIdSchema,
    rootId: RootIdSchema,
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("global") }).strict(),
      z
        .object({ kind: z.literal("project"), projectId: ProjectIdSchema })
        .strict(),
      z.object({ kind: z.literal("managed") }).strict(),
      z.object({ kind: z.literal("system") }).strict(),
    ]),
    key: z.string().min(1).max(256),
    name: EvidencedShortTextSchema,
    description: EvidencedShortTextSchema,
    declaredVersion: evidencedSchema(z.string().max(256)),
    status: SkillStatusDtoSchema,
    observedAt: IsoDateTimeSchema,
  })
  .strict()

export const InventoryPageDtoSchema = z
  .object({
    items: z.array(InventoryItemDtoSchema),
    nextCursor: OpaqueIdSchema.nullable(),
    total: z.number().int().nonnegative(),
    observedAt: IsoDateTimeSchema,
  })
  .strict()

export const InspectInstallationInputSchema = z
  .object({ installationId: InstallationIdSchema })
  .strict()

export const ValidationFindingDtoSchema = z
  .object({
    code: OpaqueIdSchema,
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1).max(4_000),
    relativeFile: RelativeDisplayPathSchema.optional(),
    range: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict()
      .refine((range) => range.end >= range.start, "Invalid source range")
      .optional(),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("core") }).strict(),
      z.object({ kind: z.literal("adapter"), adapterId: AdapterIdSchema }).strict(),
    ]),
  })
  .strict()

export const RequirementDtoSchema = z
  .object({
    kind: z.enum([
      "skill",
      "tool",
      "runtime",
      "file",
      "environment",
      "external",
      "unknown",
    ]),
    name: z.string().min(1).max(512),
    evidence: EvidenceSchema,
    resolution: z.enum(["satisfied", "missing", "unknown"]),
  })
  .strict()

export const InstallationFileDtoSchema = z
  .object({
    relativePath: RelativeDisplayPathSchema,
    byteLength: z.number().int().nonnegative(),
    sha256: Sha256Schema,
    kind: z.enum(["entry", "resource"]),
  })
  .strict()

export const ProvenanceDtoSchema = z
  .object({
    id: OpaqueIdSchema,
    kind: z.enum([
      "local",
      "forge-import",
      "registry",
      "package",
      "plugin",
      "system",
      "unknown",
    ]),
    sourceLabel: evidencedSchema(z.string().max(512)),
    release: evidencedSchema(z.string().max(256)),
    commit: evidencedSchema(z.string().max(256)),
    license: evidencedSchema(z.string().max(256)),
    managedBy: z.enum(["forge", "external", "runtime", "user", "unknown"]),
  })
  .strict()

export const InstallationCapabilitiesDtoSchema = z
  .object({
    canInstallSibling: z.boolean(),
    canUpdateFromSource: z.boolean(),
    canEditEntry: z.boolean(),
    unavailableReasons: z.array(z.string().min(1).max(1_000)).max(16),
  })
  .strict()

export const InstallationDetailDtoSchema = z
  .object({
    installation: InventoryItemDtoSchema,
    snapshotId: SnapshotIdSchema,
    locationLabel: DisplayLabelSchema,
    entryFile: RelativeDisplayPathSchema,
    rawEntryContent: z.string().max(10 * 1_024 * 1_024),
    contentHash: Sha256Schema,
    files: z.array(InstallationFileDtoSchema).max(2_000),
    findings: z.array(ValidationFindingDtoSchema).max(2_000),
    requirements: z.array(RequirementDtoSchema).max(2_000),
    provenance: ProvenanceDtoSchema,
    capabilities: InstallationCapabilitiesDtoSchema,
  })
  .strict()

export type InventoryQuery = z.input<typeof InventoryQuerySchema>
export type InventoryPageDto = z.infer<typeof InventoryPageDtoSchema>
export type InventoryItemDto = z.infer<typeof InventoryItemDtoSchema>
export type InspectInstallationInput = z.infer<
  typeof InspectInstallationInputSchema
>
export type InstallationDetailDto = z.infer<
  typeof InstallationDetailDtoSchema
>
