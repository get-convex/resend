/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import batchWorker from "@convex-dev/batch-worker/test";
import workpool from "@convex-dev/workpool/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import { createTestRuntimeConfig, modules } from "./setup.test.js";

// Register every child component so we can drive the whole pipeline:
// batch worker loop -> worker mutation -> workpool action -> Resend API.
const setupPipelineTest = () => {
  const t = convexTest(schema, modules);
  batchWorker.register(t, "batchWorker");
  workpool.register(t, "emailWorkpool");
  workpool.register(t, "callbackWorkpool");
  rateLimiter.register(t, "rateLimiter");
  return t;
};

describe("email batching pipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drains a waiting email through the batch worker and workpool", async () => {
    vi.useFakeTimers();
    const t = setupPipelineTest();

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "re_batch_123" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const emailId = await t.mutation(api.lib.sendEmail, {
      options: createTestRuntimeConfig(),
      from: "onboarding@resend.dev",
      to: ["delivered@resend.dev"],
      subject: "Hello",
      html: "<p>Hi there</p>",
    });

    let email = await t.run(async (ctx) => ctx.db.get("emails", emailId));
    expect(email?.status).toBe("waiting");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    email = await t.run(async (ctx) => ctx.db.get("emails", emailId));
    expect(email?.status).toBe("sent");
    expect(email?.resendId).toBe("re_batch_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("picks up emails sent after the cursor has advanced", async () => {
    vi.useFakeTimers();
    const t = setupPipelineTest();

    let batch = 0;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(init!.body as string) as unknown[];
      const ids = payload.map(() => ({ id: `re_batch_${batch++}` }));
      return new Response(JSON.stringify({ data: ids }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sendOne = (subject: string) =>
      t.mutation(api.lib.sendEmail, {
        options: createTestRuntimeConfig(),
        from: "onboarding@resend.dev",
        to: ["delivered@resend.dev"],
        subject,
        html: "<p>Hi there</p>",
      });

    // First email drains fully, advancing the worker's cursor.
    const firstId = await sendOne("First");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // A later email commits after the cursor; the next scan must find it.
    const secondId = await sendOne("Second");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [first, second] = await t.run(async (ctx) => [
      await ctx.db.get("emails", firstId),
      await ctx.db.get("emails", secondId),
    ]);
    expect(first?.status).toBe("sent");
    expect(second?.status).toBe("sent");
    expect(second?.resendId).not.toBe(first?.resendId);
  });

  it("does not send emails cancelled while waiting", async () => {
    vi.useFakeTimers();
    const t = setupPipelineTest();

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "re_batch_456" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const emailId = await t.mutation(api.lib.sendEmail, {
      options: createTestRuntimeConfig(),
      from: "onboarding@resend.dev",
      to: ["delivered@resend.dev"],
      subject: "Hello",
      html: "<p>Hi there</p>",
    });
    await t.mutation(api.lib.cancelEmail, { emailId });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const email = await t.run(async (ctx) => ctx.db.get("emails", emailId));
    expect(email?.status).toBe("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
