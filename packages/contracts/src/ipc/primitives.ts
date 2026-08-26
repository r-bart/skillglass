import { z } from "zod"

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u
const SELECTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,512}$/u
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u

/** Identifiers are opaque capabilities, never filesystem paths. */
export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(OPAQUE_ID_PATTERN, "Expected an opaque identifier")

export const AdapterIdSchema = OpaqueIdSchema
export const CandidateIdSchema = OpaqueIdSchema
export const RootIdSchema = OpaqueIdSchema
export const ProjectIdSchema = OpaqueIdSchema
export const InstallationIdSchema = OpaqueIdSchema
export const SnapshotIdSchema = OpaqueIdSchema
export const PlanIdSchema = OpaqueIdSchema
export const JournalIdSchema = OpaqueIdSchema
export const OperationIdSchema = OpaqueIdSchema

/** Minted by the main process after an explicit native file selection. */
export const SelectionTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(SELECTION_TOKEN_PATTERN, "Expected an opaque selection token")

export const Sha256Schema = z
  .string()
  .length(64)
  .regex(SHA_256_PATTERN, "Expected a lowercase SHA-256 digest")

export const IsoDateTimeSchema = z.iso.datetime({ offset: true })

/** A relative display path returned by main. It is never accepted as authority. */
export const RelativeDisplayPathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.includes("\0"), "NUL is not allowed")
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      value.split(/[\\/]/u).every((segment) => segment !== ".."),
    "Expected a contained relative display path",
  )

export const DisplayLabelSchema = z.string().min(1).max(512)

export const EmptyInputSchema = z.object({}).strict()
export const AckDtoSchema = z.object({ ok: z.literal(true) }).strict()

export type AckDto = z.infer<typeof AckDtoSchema>
