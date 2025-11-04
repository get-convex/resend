import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  testEmails: defineTable({
    email: v.string(),
    expectation: v.union(
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("complained"),
    ),
  }).index("by_email", ["email"]),
});
