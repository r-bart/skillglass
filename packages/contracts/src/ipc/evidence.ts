import { z } from "zod"

import { IsoDateTimeSchema } from "./primitives.js"

export const EvidenceKindSchema = z.enum([
  "observed",
  "derived",
  "inferred",
  "unknown",
])

export const EvidenceSchema = z
  .object({
    kind: EvidenceKindSchema,
    source: z.string().min(1).max(512).optional(),
    confidence: z.number().min(0).max(1).optional(),
    observedAt: IsoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.kind !== "inferred" && evidence.confidence !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Confidence is only valid for inferred evidence",
        path: ["confidence"],
      })
    }
  })

const UnknownEvidenceSchema = z
  .object({
    kind: z.literal("unknown"),
    source: z.string().min(1).max(512).optional(),
    observedAt: IsoDateTimeSchema.optional(),
  })
  .strict()

export function evidencedSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion("state", [
    z
      .object({
        state: z.literal("known"),
        value: valueSchema,
        evidence: EvidenceSchema,
      })
      .strict()
      .superRefine((claim, context) => {
        if (claim.evidence.kind === "unknown") {
          context.addIssue({
            code: "custom",
            message: "A known value cannot use unknown evidence",
            path: ["evidence", "kind"],
          })
        }
      }),
    z
      .object({
        state: z.literal("unknown"),
        evidence: UnknownEvidenceSchema,
      })
      .strict(),
  ])
}

export type Evidence = z.infer<typeof EvidenceSchema>
export type Evidenced<T> =
  | { state: "known"; value: T; evidence: Evidence }
  | { state: "unknown"; evidence: Evidence & { kind: "unknown" } }
