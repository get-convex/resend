/// <reference types="vite/client" />
import { test } from "vitest";
import type {
  EmailEvent,
  EventEventOfType,
  EventEventTypes,
  RuntimeConfig,
} from "./shared.js";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";

export const modules = import.meta.glob("./**/*.*s");

export const setupTest = () => {
  const t = convexTest(schema, modules);
  return t;
};

export type Tester = ReturnType<typeof setupTest>;

test("setup", () => {});

export const createTestEventOfType = <
  T extends EventEventTypes,
>(): EventEventOfType<T> => {};

export const createTestDeliveredEvent =
  (): EventEventOfType<"email.delivered"> => ({
    type: "email.delivered",
    created_at: "2024-01-01T00:00:00Z",
    data: {
      email_id: "test-resend-id-123",
      created_at: "2024-01-01T00:00:00Z", // Required in commonFields
      from: "test@example.com",
      to: "recipient@example.com",
      subject: "Test Email",
    },
  });

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
