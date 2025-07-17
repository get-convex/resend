import {
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";
import { type Infer, v } from "convex/values";

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
  handleClick: v.optional(v.boolean()),
});

export type RuntimeConfig = Infer<typeof vOptions>;

export const vClickEvent = v.object({
  ipAddress: v.string(),
  link: v.string(),
  timestamp: v.string(),
  userAgent: v.string(),
});

export type ClickEvent = Infer<typeof vClickEvent>;

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
    click: v.optional(vClickEvent),
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
