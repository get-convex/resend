import {
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { vEmailId, vEmailEvent, Resend } from "@convex-dev/resend";
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
      from: "<your-verified-sender-address>",
      to: args.to ?? "delivered@resend.dev",
      subject: "Test Email",
      html: "This is a test email",
    });
    console.log("Email sent", email);
    let status = await resend.status(ctx, email);
    while (status.status === "queued" || status.status === "waiting") {
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
      v.literal("complained")
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
  args: {
    id: vEmailId,
    event: vEmailEvent,
  },
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
          "Complained email was delivered, expecting complaint coming..."
        );
        return;
      }
      // All good. Delivered email was delivered.
      await ctx.db.delete(testEmail._id);
    }
    if (args.event.type === "email.bounced") {
      if (testEmail.expectation !== "bounced") {
        throw new Error(
          `Email was bounced but expected to be ${testEmail.expectation}`
        );
      }
      // All good. Bounced email was bounced.
      await ctx.db.delete(testEmail._id);
    }
    if (args.event.type === "email.complained") {
      if (testEmail.expectation !== "complained") {
        throw new Error(
          `Email was complained but expected to be ${testEmail.expectation}`
        );
      }
      // All good. Complained email was complained.
      await ctx.db.delete(testEmail._id);
    }
  },
});
