import { z } from "zod"

export const CloseRequestIdSchema = z.string().regex(/^close_[a-f0-9]{32}$/u)

export const CloseRequestEventSchema = z.object({
  requestId: CloseRequestIdSchema,
  reason: z.enum(["window", "quit"]),
}).strict()

export const CloseStateResponseSchema = z.object({
  requestId: CloseRequestIdSchema,
  revision: z.number().int().nonnegative(),
  state: z.enum(["clean", "dirty", "busy"]),
  locale: z.enum(["es", "en"]),
}).strict()

export type CloseRequestEvent = z.infer<typeof CloseRequestEventSchema>
export type CloseStateResponse = z.infer<typeof CloseStateResponseSchema>
export type WorkspaceCloseState = CloseStateResponse["state"]
