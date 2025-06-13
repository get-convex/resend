import { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { Infer, v } from "convex/values";

// Validator for the onEmailEvent option.
export const onEmailEvent = v.object({
  fnHandle: v.string(),
});

// Validator for the status of an email.
export const vStatus = v.union(
  v.literal("waiting"),
  v.literal("queued"),
  v.literal("cancelled"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("delivery_delayed"),
  v.literal("bounced")
);
export type Status = Infer<typeof vStatus>;

// Validator for the runtime options used by the component.
export const vOptions = v.object({
  initialBackoffMs: v.number(),
  retryAttempts: v.number(),
  apiKey: v.string(),
  testMode: v.boolean(),
  onEmailEvent: v.optional(onEmailEvent),
});

export type RuntimeConfig = Infer<typeof vOptions>;

// Normalized webhook events coming from Resend.
export const vEmailEvent = v.object({
  type: v.string(),
  data: v.object({
    email_id: v.string(),
    bounce: v.optional(
      v.object({
        message: v.optional(v.string()),
      })
    ),
  }),
});
export type EmailEvent = Infer<typeof vEmailEvent>;

/* Type utils follow */

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
