import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vOptions, vStatus } from "./shared";

export default defineSchema({
  content: defineTable({
    content: v.bytes(),
    mimeType: v.string(),
    filename: v.optional(v.string()),
    path: v.optional(v.string()),
  }),
  nextBatchRun: defineTable({
    runId: v.id("_scheduled_functions"),
  }),
  lastOptions: defineTable({
    options: vOptions,
  }),
  emails: defineTable({
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    replyTo: v.array(v.string()),
    html: v.optional(v.id("content")),
    text: v.optional(v.id("content")),
    headers: v.optional(
      v.array(
        v.object({
          name: v.string(),
          value: v.string(),
        })
      )
    ),
    status: vStatus,
    errorMessage: v.optional(v.string()),
    complained: v.boolean(),
    opened: v.boolean(),
    resendId: v.optional(v.string()),
    segment: v.number(),
    finalizedAt: v.number(),
  })
    .index("by_status_segment", ["status", "segment"])
    .index("by_resendId", ["resendId"])
    .index("by_finalizedAt", ["finalizedAt"]),
});
