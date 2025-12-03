import {
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { Resend, vOnEmailEventArgs } from "@convex-dev/resend";
import { v } from "convex/values";

export const resend: Resend = new Resend(components.resend, {
  onEmailEvent: internal.example.handleEmailEvent,
});

export const testBatch = internalAction({
  args: {
    from: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const addresses = [
      "delivered@resend.dev",
      "bounced@resend.dev",
      "complained@resend.dev",
    ];

    for (let i = 0; i < 25; i++) {
      const address = addresses[i % addresses.length];
      const expectation = address.split("@")[0];
      const email = await resend.sendEmail(ctx, {
        from: args.from,
        to: address,
        subject: "Test Email",
        html: "This is a test email",
      });
      await ctx.runMutation(internal.example.insertExpectation, {
        email: email,
        expectation: expectation as "delivered" | "bounced" | "complained",
      });
    }
    while (!(await ctx.runQuery(internal.example.isEmpty))) {
      console.log("Waiting for emails to be processed...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log("All emails finalized as expected");
  },
});

export const sendOne = internalAction({
  args: { to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const email = await resend.sendEmail(ctx, {
      from: "onboarding@resend.dev",
      to: args.to ?? [
        "delivered@resend.dev",
        "delivered+1@resend.dev",
        "bounced@resend.dev",
        "complained@resend.dev",
        "complained+1@resend.dev",
        "complained+2@resend.dev",
        "complained+3@resend.dev",
        "complained+4@resend.dev",
        "complained+5@resend.dev",
        "complained+6@resend.dev",
        "complained+7@resend.dev",
        "complained+8@resend.dev",
        "complained+9@resend.dev",
        "complained+10@resend.dev",
      ],
      subject: "Test Email",
      html: "This is a test email",
    });
    console.log("Email sent", email);
    let status = await resend.status(ctx, email);
    while (
      status &&
      (status.status === "queued" || status.status === "waiting")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await resend.status(ctx, email);
    }
    console.log("Email status", status);
    return email;
  },
});

export const insertExpectation = internalMutation({
  args: {
    email: v.string(),
    expectation: v.union(
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("complained"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("testEmails", {
      email: args.email,
      expectation: args.expectation,
    });
  },
});

export const isEmpty = internalQuery({
  returns: v.boolean(),
  handler: async (ctx) => {
    return (await ctx.db.query("testEmails").first()) === null;
  },
});

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    console.log("Got called back!", args.id, args.event);
    const testEmail = await ctx.db
      .query("testEmails")
      .withIndex("by_email", (q) => q.eq("email", args.id))
      .unique();
    if (!testEmail) {
      console.log("No test email found for id", args.id);
      return;
    }
    if (args.event.type === "email.delivered") {
      if (testEmail.expectation === "bounced") {
        throw new Error("Email was delivered but expected to be bounced");
      }
      if (testEmail.expectation === "complained") {
        console.log(
          "Complained email was delivered, expecting complaint coming...",
        );
        return;
      }
      // All good. Delivered email was delivered.
      await ctx.db.delete(testEmail._id);
    }
    if (args.event.type === "email.bounced") {
      if (testEmail.expectation !== "bounced") {
        throw new Error(
          `Email was bounced but expected to be ${testEmail.expectation}`,
        );
      }
      // All good. Bounced email was bounced.
      await ctx.db.delete(testEmail._id);
    }
    if (args.event.type === "email.complained") {
      if (testEmail.expectation !== "complained") {
        throw new Error(
          `Email was complained but expected to be ${testEmail.expectation}`,
        );
      }
      // All good. Complained email was complained.
      await ctx.db.delete(testEmail._id);
    }
  },
});

export const sendManualEmail = internalAction({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    subject: v.optional(v.string()),
    text: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const from = args.from ?? "onboarding@resend.dev";
    const to = args.to ?? "delivered@resend.dev";
    const subject = args.subject ?? "Test Email";
    const text = args.text ?? "This is a test email with a tag";
    const emailId = await resend.sendEmailManually(
      ctx,
      { from, to, subject },
      async (emailId) => {
        const data = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to,
            subject,
            text,
            headers: [
              {
                name: "Idempotency-Key",
                value: emailId,
              },
            ],
            tags: [
              {
                name: "category",
                value: "confirm_email",
              },
            ],
          }),
        });
        const json = await data.json();
        return json.id;
      },
    );
    return emailId;
  },
});
