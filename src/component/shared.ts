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

const vEmailEventData = v.object({
  email_id: v.string(),
  broadcast_id: v.optional(v.string()),
  from: v.optional(v.string()),
  to: v.optional(v.array(v.string())),
  subject: v.optional(v.string()),
  tags: v.optional(
    v.array(
      v.object({
        name: v.string(),
        value: v.string(),
      })
    )
  ),
});

export const vEmailEvent = v.union(
  v.object({
    type: v.literal("email.sent"),
    data: vEmailEventData,
  }),
  v.object({
    type: v.literal("email.delivered"),
    data: vEmailEventData,
  }),
  v.object({
    type: v.literal("email.delivery_delayed"),
    data: vEmailEventData,
  }),
  v.object({
    type: v.literal("email.complained"),
    data: vEmailEventData,
  }),
  v.object({
    type: v.literal("email.opened"),
    data: vEmailEventData,
  }),
  v.object({
    type: v.literal("email.bounced"),
    data: v.object({
      ...vEmailEventData.fields,
      bounce: v.optional(
        v.object({
          message: v.optional(v.string()),
          subType: v.optional(v.string()),
          type: v.optional(v.string()),
        })
      ),
    }),
  }),
  v.object({
    type: v.literal("email.clicked"),
    data: v.object({
      ...vEmailEventData.fields,
      click: v.optional(
        v.object({
          link: v.optional(v.string()),
          ipAddress: v.optional(v.string()),
          timestamp: v.optional(v.string()),
          userAgent: v.optional(v.string()),
        })
      ),
    }),
  }),
  v.object({
    type: v.literal("email.failed"),
    created_at: v.string(),
    data: v.object({
      ...vEmailEventData.fields,
      failed: v.optional(
        v.object({
          reason: v.optional(v.string()),
        })
      ),
    }),
  })
);

export type EmailEvent = Infer<typeof vEmailEvent>;

/* Type utils follow */

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
