/// <reference types="vite/client" />
import { test } from "vitest";
import type {
  EventEventOfType,
  EventEventTypes,
  RuntimeConfig,
} from "./shared.js";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { assertExhaustive } from "./utils.js";

export const modules = import.meta.glob("./**/*.*s");

export const setupTest = () => {
  const t = convexTest(schema, modules);
  return t;
};

export type Tester = ReturnType<typeof setupTest>;

test("setup", () => {});

export const createTestEventOfType = <T extends EventEventTypes>(
  type: T,
  overrides?: Partial<EventEventOfType<T>>
): EventEventOfType<T> => {
  const baseData = {
    email_id: "test-resend-id-123",
    created_at: "2024-01-01T00:00:00Z",
    from: "test@example.com",
    to: "recipient@example.com",
    subject: "Test Email",
    broadcast_id: "test-broadcast-123",
    cc: ["cc@example.com"],
    bcc: ["bcc@example.com"],
    reply_to: ["reply@example.com"],
    headers: [{ name: "X-Test-Header", value: "test-value" }],
    tags: [
      { name: "environment", value: "test" },
      { name: "campaign", value: "test-campaign" },
    ],
  };

  const baseEvent = {
    type,
    created_at: "2024-01-01T00:00:00Z",
  };

  // Helper to merge overrides with base event
  const applyOverrides = (event: {
    type: string;
    created_at: string;
    data: Record<string, unknown>;
  }): EventEventOfType<T> => {
    if (!overrides) return event as EventEventOfType<T>;

    return {
      ...event,
      ...overrides,
      data: overrides.data ? { ...event.data, ...overrides.data } : event.data,
    } as EventEventOfType<T>;
  };

  if (type === "email.sent")
    return applyOverrides({
      ...baseEvent,
      type: "email.sent",
      data: baseData,
    });

  if (type === "email.delivered")
    return applyOverrides({
      ...baseEvent,
      type: "email.delivered",
      data: baseData,
    });

  if (type === "email.delivery_delayed")
    return applyOverrides({
      ...baseEvent,
      type: "email.delivery_delayed",
      data: baseData,
    });

  if (type === "email.complained")
    return applyOverrides({
      ...baseEvent,
      type: "email.complained",
      data: baseData,
    });

  if (type === "email.bounced")
    return applyOverrides({
      ...baseEvent,
      type: "email.bounced",
      data: {
        ...baseData,
        bounce: {
          message: "The email bounced due to invalid recipient",
          subType: "general",
          type: "hard",
        },
      },
    });

  if (type === "email.opened")
    return applyOverrides({
      ...baseEvent,
      type: "email.opened",
      data: {
        ...baseData,
        open: {
          ipAddress: "192.168.1.100",
          timestamp: "2024-01-01T00:05:00Z",
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    });

  if (type === "email.clicked")
    return applyOverrides({
      ...baseEvent,
      type: "email.clicked",
      data: {
        ...baseData,
        click: {
          ipAddress: "192.168.1.100",
          link: "https://example.com/test-link",
          timestamp: "2024-01-01T00:10:00Z",
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    });

  if (type === "email.failed")
    return applyOverrides({
      ...baseEvent,
      type: "email.failed",
      data: {
        ...baseData,
        failed: {
          reason: "SMTP server rejected the email",
        },
      },
    });

  return assertExhaustive(type);
};

export const createTestRuntimeConfig = (): RuntimeConfig => ({
  apiKey: "test-api-key",
  testMode: true,
  initialBackoffMs: 1000,
  retryAttempts: 3,
});

export const setupTestLastOptions = (
  t: Tester,
  overrides?: Partial<Doc<"lastOptions">>
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("lastOptions", {
      options: {
        ...createTestRuntimeConfig(),
      },
      ...overrides,
    });
  });

export const insertTestEmail = (
  t: Tester,
  overrides: Omit<Doc<"emails">, "_id" | "_creationTime">
) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("emails", overrides);
    const email = await ctx.db.get(id);
    if (!email) throw new Error("Email not found");
    return email;
  });

export const insertTestSentEmail = (
  t: Tester,
  overrides?: Partial<Doc<"emails">>
) =>
  insertTestEmail(t, {
    from: "test@example.com",
    to: "recipient@example.com",
    subject: "Test Email",
    replyTo: [],
    status: "sent",
    complained: false,
    opened: false,
    resendId: "test-resend-id-123",
    segment: 1,
    finalizedAt: Number.MAX_SAFE_INTEGER, // FINALIZED_EPOCH
    ...overrides,
  });
