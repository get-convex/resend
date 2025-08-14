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
  v.literal("bounced"),
  v.literal("failed")
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

const commonFields = {
  broadcast_id: v.optional(v.string()),
  created_at: v.string(),
  email_id: v.string(),
  from: v.union(v.string(), v.array(v.string())),
  to: v.union(v.string(), v.array(v.string())),
  cc: v.optional(v.union(v.string(), v.array(v.string()))),
  bcc: v.optional(v.union(v.string(), v.array(v.string()))),
  reply_to: v.optional(v.union(v.string(), v.array(v.string()))),
  headers: v.optional(
    v.array(
      v.object({
        name: v.string(),
        value: v.string(),
      })
    )
  ),
  subject: v.string(),
  tags: v.optional(
    v.union(
      v.record(v.string(), v.string()),
      v.array(
        v.object({
          name: v.string(),
          value: v.string(),
        })
      )
    )
  ),
};

// Normalized webhook events coming from Resend.
export const vEmailEvent = v.union(
  v.object({
    type: v.literal("email.sent"),
    created_at: v.string(),
    data: v.object(commonFields),
  }),
  v.object({
    type: v.literal("email.delivered"),
    created_at: v.string(),
    data: v.object(commonFields),
  }),
  v.object({
    type: v.literal("email.delivery_delayed"),
    created_at: v.string(),
    data: v.object(commonFields),
  }),
  v.object({
    type: v.literal("email.complained"),
    created_at: v.string(),
    data: v.object(commonFields),
  }),
  v.object({
    type: v.literal("email.bounced"),
    created_at: v.string(),
    data: v.object({
      ...commonFields,
      bounce: v.object({
        message: v.string(),
        subType: v.string(),
        type: v.string(),
      }),
    }),
  }),
  v.object({
    type: v.literal("email.opened"),
    created_at: v.string(),
    data: v.object({
      ...commonFields,
      open: v.object({
        ipAddress: v.string(),
        timestamp: v.string(),
        userAgent: v.string(),
      }),
    }),
  }),
  v.object({
    type: v.literal("email.clicked"),
    created_at: v.string(),
    data: v.object({
      ...commonFields,
      click: v.object({
        ipAddress: v.string(),
        link: v.string(),
        timestamp: v.string(),
        userAgent: v.string(),
      }),
    }),
  }),
  v.object({
    type: v.literal("email.failed"),
    created_at: v.string(),
    data: v.object({
      ...commonFields,
      failed: v.object({
        reason: v.string(),
      }),
    }),
  })
);

export type EmailEvent = Infer<typeof vEmailEvent>;
export type EventEventTypes = EmailEvent["type"];
export type EventEventOfType<T extends EventEventTypes> = Extract<
  EmailEvent,
  { type: T }
>;

/* Type utils follow */

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
