import { z } from "zod"

import { EvidenceSchema } from "./evidence.js"
import {
  AdapterIdSchema,
  CandidateIdSchema,
  DisplayLabelSchema,
  RootIdSchema,
} from "./primitives.js"

export const RootKindSchema = z.enum([
  "global",
  "project",
  "managed",
  "system",
  "user-added",
])

export const RootAccessSchema = z.enum([
  "read-write",
  "read-only",
  "missing",
  "denied",
])

const RootDescriptorSchema = z
  .object({
    adapterId: AdapterIdSchema,
    displayName: DisplayLabelSchema,
    displayPath: DisplayLabelSchema,
    kind: RootKindSchema,
    access: RootAccessSchema,
    writableWithoutElevation: z.boolean(),
    discovery: EvidenceSchema,
  })
  .strict()

function validateWritableAccess(
  root: { access: z.infer<typeof RootAccessSchema>; writableWithoutElevation: boolean },
  context: z.RefinementCtx,
) {
  if (root.writableWithoutElevation && root.access !== "read-write") {
    context.addIssue({
      code: "custom",
      message: "Only read-write roots can be writable without elevation",
      path: ["writableWithoutElevation"],
    })
  }
}

export const RootCandidateDtoSchema = RootDescriptorSchema.extend({
  candidateId: CandidateIdSchema,
})
  .superRefine((candidate, context) => {
    validateWritableAccess(candidate, context)
  })

export const ApprovedRootDtoSchema = RootDescriptorSchema.extend({
  rootId: RootIdSchema,
}).superRefine((root, context) => {
  validateWritableAccess(root, context)
})

export const ApproveRootsInputSchema = z
  .object({
    candidateIds: z.array(CandidateIdSchema).min(1).max(128),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.candidateIds).size !== input.candidateIds.length) {
      context.addIssue({
        code: "custom",
        message: "Root candidate IDs must be unique",
        path: ["candidateIds"],
      })
    }
  })

export const SelectAdditionalRootInputSchema = z
  .object({ adapterId: AdapterIdSchema })
  .strict()

export type RootCandidateDto = z.infer<typeof RootCandidateDtoSchema>
export type ApprovedRootDto = z.infer<typeof ApprovedRootDtoSchema>
export type ApproveRootsInput = z.infer<typeof ApproveRootsInputSchema>
export type SelectAdditionalRootInput = z.infer<
  typeof SelectAdditionalRootInputSchema
>
