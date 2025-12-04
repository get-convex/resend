import { expect, describe, it, beforeEach } from "vitest";
import { api } from "./_generated/api.js";
import type { EmailEvent } from "./shared.js";
import {
  createTestEventOfType,
  insertTestSentEmail,
  setupTest,
  setupTestLastOptions,
  type Tester,
} from "./setup.test.js";
import { type Doc, type Id } from "./_generated/dataModel.js";

describe("handleEmailEvent", () => {
  let t: Tester;
  let event: EmailEvent;
  let email: Doc<"emails">;

  beforeEach(async () => {
    t = setupTest();
    event = createTestEventOfType("email.delivered");
    await setupTestLastOptions(t);
    email = await insertTestSentEmail(t);
  });

  const exec = async (_event: EmailEvent | unknown = event) => {
    await t.mutation(api.lib.handleEmailEvent, { event: _event });
  };

  const getEmail = () =>
    t.run(async (ctx) => {
      const _email = await ctx.db.get(email._id);
      if (!_email) throw new Error("Email not found");
      return _email;
    });

  it("updates email for delivered event", async () => {
    expect(email.status).toBe("sent");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("delivered");
    expect(updatedEmail.finalizedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail.finalizedAt).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
    // deliveryEvents entry created
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("deliveryEvents")
        .withIndex("by_emailId_eventType", (q) =>
          q.eq("emailId", email._id).eq("eventType", "email.delivered"),
        )
        .collect(),
    );
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("email.delivered");
    expect(events[0].resendId).toBe("test-resend-id-123");
  });

  it("updates email for complained event", async () => {
    expect(email.status).toBe("sent");
    event = createTestEventOfType("email.complained");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.complained).toBe(true);
    // deliveryEvents entry created
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("deliveryEvents")
        .withIndex("by_emailId_eventType", (q) => q.eq("emailId", email._id))
        .collect(),
    );
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("email.complained");
  });

  it("updates email for bounced event", async () => {
    expect(email.status).toBe("sent");
    event = createTestEventOfType("email.bounced");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("bounced");
    expect(updatedEmail.finalizedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail.finalizedAt).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
    expect(updatedEmail.errorMessage).toBe(
      "The email bounced due to invalid recipient",
    );
    // deliveryEvents entry created
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("deliveryEvents")
        .withIndex("by_emailId_eventType", (q) =>
          q.eq("emailId", email._id).eq("eventType", "email.bounced"),
        )
        .collect(),
    );
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("email.bounced");
    expect(events[0].message).toBe(
      "The email bounced due to invalid recipient",
    );
  });

  it("updates email for delivery_delayed event", async () => {
    expect(email.status).toBe("sent");
    event = createTestEventOfType("email.delivery_delayed");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("delivery_delayed");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER); // Should remain unchanged
  });

  it("updates email for opened event", async () => {
    expect(email.status).toBe("sent");
    expect(email.opened).toBe(false);
    event = createTestEventOfType("email.opened");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.opened).toBe(true);
  });

  it("does not update email for sent event", async () => {
    expect(email.status).toBe("sent");
    event = createTestEventOfType("email.sent");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER); // Should remain unchanged
    expect(updatedEmail.complained).toBe(false); // Should remain unchanged
    expect(updatedEmail.opened).toBe(false); // Should remain unchanged
  });

  it("updates email for clicked event", async () => {
    expect(email.status).toBe("sent");
    event = createTestEventOfType("email.clicked");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER); // Should remain unchanged
    expect(updatedEmail.clicked).toBe(true); // Now tracks clicks
    expect(updatedEmail.complained).toBe(false); // Should remain unchanged
    expect(updatedEmail.opened).toBe(false); // Should remain unchanged
  });

  it("updates email for failed event and changes status", async () => {
    expect(email.status).toBe("sent");
    event = createTestEventOfType("email.failed");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("failed"); // Status changes (failed has higher priority than sent)
    expect(updatedEmail.failed).toBe(true); // Flag is set
    expect(updatedEmail.finalizedAt).toBeLessThan(Number.MAX_SAFE_INTEGER); // Should be finalized
    expect(updatedEmail.complained).toBe(false); // Should remain unchanged
    expect(updatedEmail.opened).toBe(false); // Should remain unchanged
  });

  it("gracefully handles invalid event structure - missing type", async () => {
    const invalidEvent = {
      created_at: "2024-01-01T00:00:00Z",
      data: {
        email_id: "test-resend-id-123",
        from: "test@example.com",
        to: "recipient@example.com",
        subject: "Test Email",
      },
    };

    // Should not throw an error
    await exec(invalidEvent);

    // Email should remain unchanged
    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail.complained).toBe(false);
    expect(updatedEmail.opened).toBe(false);
  });

  it("gracefully handles invalid event structure - missing data", async () => {
    const invalidEvent = {
      type: "email.delivered",
      created_at: "2024-01-01T00:00:00Z",
    };

    // Should not throw an error
    await exec(invalidEvent);

    // Email should remain unchanged
    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail.complained).toBe(false);
    expect(updatedEmail.opened).toBe(false);
  });

  it("gracefully handles completely invalid event", async () => {
    const invalidEvent = "not an object";

    // Should not throw an error
    await exec(invalidEvent);

    // Email should remain unchanged
    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail.complained).toBe(false);
    expect(updatedEmail.opened).toBe(false);
  });

  it("gracefully handles null event", async () => {
    // Should not throw an error
    await exec(null);

    // Email should remain unchanged
    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail.complained).toBe(false);
    expect(updatedEmail.opened).toBe(false);
  });

  it("gracefully handles empty object event", async () => {
    const invalidEvent = {};

    // Should not throw an error
    await exec(invalidEvent);

    // Email should remain unchanged
    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail.complained).toBe(false);
    expect(updatedEmail.opened).toBe(false);
  });
});

describe("sendEmail with templates", () => {
  let t: Tester;

  beforeEach(async () => {
    t = setupTest();
    await setupTestLastOptions(t);
  });

  it("should accept template-based email", async () => {
    const emailId: Id<"emails"> = await t.mutation(api.lib.sendEmail, {
      options: {
        apiKey: "test-key",
        initialBackoffMs: 1000,
        retryAttempts: 3,
        testMode: true,
      },
      from: "test@resend.dev",
      to: ["delivered@resend.dev"],
      template: {
        id: "order-confirmation",
        variables: {
          PRODUCT: "Vintage Macintosh",
          PRICE: 499,
        },
      },
    });

    const email = await t.run(async (ctx) => {
      const _email = await ctx.db.get(emailId);
      if (!_email) throw new Error("Email not found");
      return _email;
    });

    expect(email.template?.id).toBe("order-confirmation");
    expect(email.template?.variables).toEqual({
      PRODUCT: "Vintage Macintosh",
      PRICE: 499,
    });
    expect(email.subject).toBeUndefined();
    expect(email.html).toBeUndefined();
    expect(email.text).toBeUndefined();
    expect(email.status).toBe("waiting");
  });

  it("should reject email with both template and html/text", async () => {
    await expect(
      t.mutation(api.lib.sendEmail, {
        options: {
          apiKey: "test-key",
          initialBackoffMs: 1000,
          retryAttempts: 3,
          testMode: true,
        },
        from: "test@resend.dev",
        to: ["delivered@resend.dev"],
        subject: "Test",
        html: "<p>Test</p>",
        template: {
          id: "order-confirmation",
          variables: {
            PRODUCT: "Test",
          },
        },
      }),
    ).rejects.toThrow("Cannot provide both html/text and template");
  });

  it("should accept template email with optional subject", async () => {
    const emailId: Id<"emails"> = await t.mutation(api.lib.sendEmail, {
      options: {
        apiKey: "test-key",
        initialBackoffMs: 1000,
        retryAttempts: 3,
        testMode: true,
      },
      from: "test@resend.dev",
      to: ["delivered@resend.dev"],
      subject: "Custom Subject Override",
      template: {
        id: "order-confirmation",
        variables: {
          PRODUCT: "Test",
        },
      },
    });

    const email = await t.run(async (ctx) => {
      const _email = await ctx.db.get(emailId);
      if (!_email) throw new Error("Email not found");
      return _email;
    });

    expect(email.template?.id).toBe("order-confirmation");
    expect(email.template?.variables).toEqual({
      PRODUCT: "Test",
    });
    expect(email.subject).toBe("Custom Subject Override");
    expect(email.status).toBe("waiting");
  });

  it("should reject email without content or template", async () => {
    await expect(
      t.mutation(api.lib.sendEmail, {
        options: {
          apiKey: "test-key",
          initialBackoffMs: 1000,
          retryAttempts: 3,
          testMode: true,
        },
        from: "test@resend.dev",
        to: ["delivered@resend.dev"],
      }),
    ).rejects.toThrow("Either html/text or template must be provided");
  });

  it("should reject traditional email without subject", async () => {
    await expect(
      t.mutation(api.lib.sendEmail, {
        options: {
          apiKey: "test-key",
          initialBackoffMs: 1000,
          retryAttempts: 3,
          testMode: true,
        },
        from: "test@resend.dev",
        to: ["delivered@resend.dev"],
        html: "<p>Test</p>",
      }),
    ).rejects.toThrow("Subject is required when not using a template");
  });
});
