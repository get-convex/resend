import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vEventType, vOptions, vStatus, vTemplate } from "./shared.js";

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
  deliveryEvents: defineTable({
    emailId: v.id("emails"),
    resendId: v.string(),
    eventType: vEventType,
    createdAt: v.string(),
    message: v.optional(v.string()),
  }).index("by_emailId_eventType", ["emailId", "eventType"]),
  emails: defineTable({
    from: v.string(),
    to: v.union(v.array(v.string()), v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    replyTo: v.array(v.string()),
    html: v.optional(v.id("content")),
    text: v.optional(v.id("content")),
    template: v.optional(vTemplate),
    headers: v.optional(
      v.array(
        v.object({
          name: v.string(),
          value: v.string(),
        }),
      ),
    ),
    status: vStatus,
    complained: v.boolean(),
    errorMessage: v.optional(v.string()),
    opened: v.boolean(),
    bounced: v.optional(v.boolean()),
    failed: v.optional(v.boolean()),
    deliveryDelayed: v.optional(v.boolean()),
    clicked: v.optional(v.boolean()),
    resendId: v.optional(v.string()),
    segment: v.number(),
    finalizedAt: v.number(),
  })
    .index("by_status_segment", ["status", "segment"])
    .index("by_resendId", ["resendId"])
    .index("by_finalizedAt", ["finalizedAt"]),
});
