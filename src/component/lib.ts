import { v } from "convex/values";
import {
  internalAction,
  mutation,
  MutationCtx,
  query,
  internalQuery,
  ActionCtx,
} from "./_generated/server";
import { Workpool } from "@convex-dev/workpool";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { Id, Doc } from "./_generated/dataModel";
import { RuntimeConfig, vOptions, vStatus } from "./shared";
import _ from "lodash";
import { FunctionHandle } from "convex/server";
import { EmailEvent, RunMutationCtx } from "./shared";

// Move some of these to options? TODO
const SEGMENT_MS = 125;
const BASE_BATCH_DELAY = 1000;
const BATCH_SIZE = 100;
const EMAIL_POOL_SIZE = 4;
const CALLBACK_POOL_SIZE = 4;
const RESEND_ONE_CALL_EVERY_MS = 600; // Half the stated limit, but it keeps us sane.
const FINALIZED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER;
const ABANDONED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const RESEND_TEST_EMAILS = new Set([
  "delivered@resend.dev",
  "bounced@resend.dev",
  "complained@resend.dev",
]);

// We break the emails into segments to avoid contention on new emails being inserted.
function getSegment(now: number) {
  return Math.floor(now / SEGMENT_MS);
}

// Four threads is more than enough, especially given the low rate limiting.
const emailPool = new Workpool(components.emailWorkpool, {
  maxParallelism: EMAIL_POOL_SIZE,
});

// We need to run callbacks in a separate pool so we don't tie up too many threads.
const callbackPool = new Workpool(components.callbackWorkpool, {
  maxParallelism: CALLBACK_POOL_SIZE,
});

// We rate limit our calls to the Resend API.
// FUTURE -- make this rate configurable if an account ups its sending rate with Resend.
const resendApiRateLimiter = new RateLimiter(components.rateLimiter, {
  resendApi: {
    kind: "fixed window",
    period: RESEND_ONE_CALL_EVERY_MS,
    rate: 1,
  },
});

// Enqueue an email to be send.  A background job will grab batches
// of emails and enqueue them to be sent by the workpool.
export const sendEmail = mutation({
  args: {
    options: vOptions,
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    replyTo: v.optional(v.array(v.string())),
    headers: v.optional(
      v.array(
        v.object({
          name: v.string(),
          value: v.string(),
        })
      )
    ),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    // We only allow test emails in test mode.
    if (args.options.testMode && !RESEND_TEST_EMAILS.has(args.to)) {
      throw new Error(
        `Test mode is enabled, but email address is not a valid resend test address. Did you want to set testMode: false in your ResendOptions?`
      );
    }

    // We require either html or text to be provided. No body = no bueno.
    if (args.html === undefined && args.text === undefined) {
      throw new Error("Either html or text must be provided");
    }

    // Store the text/html into separate records to keep things fast and memory low when we work with email batches.
    let htmlContentId: Id<"content"> | undefined;
    if (args.html !== undefined) {
      const contentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.html).buffer,
        mimeType: "text/html",
      });
      htmlContentId = contentId;
    }

    let textContentId: Id<"content"> | undefined;
    if (args.text !== undefined) {
      const contentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.text).buffer,
        mimeType: "text/plain",
      });
      textContentId = contentId;
    }

    // This is the "send requested" segment.
    const segment = getSegment(Date.now());

    // Okay, we're ready to insert the email into the database, waiting for a background job to enqueue it.
    const emailId = await ctx.db.insert("emails", {
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: htmlContentId,
      text: textContentId,
      headers: args.headers,
      segment,
      status: "waiting",
      complained: false,
      opened: false,
      replyTo: args.replyTo ?? [],
      finalizedAt: FINALIZED_EPOCH,
    });

    // Ensure there is a worker running to grab batches of emails.
    await scheduleBatchRun(ctx, args.options);
    return emailId;
  },
});

// Cancel an email that has not been sent yet. The worker will ignore it
// within whatever batch it is in.
export const cancelEmail = mutation({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      throw new Error("Email not found");
    }
    if (email.status !== "waiting" && email.status !== "queued") {
      throw new Error("Email has already been sent");
    }
    await ctx.db.patch(args.emailId, {
      status: "cancelled",
      finalizedAt: Date.now(),
    });
  },
});

// Get the status of an email.
export const getStatus = query({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.object({
    status: vStatus,
    errorMessage: v.union(v.string(), v.null()),
    complained: v.boolean(),
    opened: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      throw new Error("Email not found");
    }
    return {
      status: email.status,
      errorMessage: email.errorMessage ?? null,
      complained: email.complained,
      opened: email.opened,
    };
  },
});

// Get the entire email.
export const get = query({
  args: {
    emailId: v.id("emails"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    email: Doc<"emails">;
    html: string | undefined;
    text: string | undefined;
  }> => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      throw new Error("Email not found");
    }
    const html = email.html
      ? new TextDecoder().decode((await ctx.db.get(email.html))?.content)
      : undefined;
    const text = email.text
      ? new TextDecoder().decode((await ctx.db.get(email.text))?.content)
      : undefined;
    return { email, html, text };
  },
});

// Ensure there is a worker running to grab batches of emails.
async function scheduleBatchRun(ctx: MutationCtx, options: RuntimeConfig) {
  // Update the last options if they've changed.
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    await ctx.db.insert("lastOptions", {
      options,
    });
  } else if (!_.isEqual(lastOptions.options, options)) {
    await ctx.db.replace(lastOptions._id, {
      options,
    });
  }

  // Check if there is already a worker running.
  const existing = await ctx.db.query("nextBatchRun").unique();

  // Is there already a worker running?
  if (existing) {
    return;
  }

  // No worker running? Schedule one.
  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY,
    internal.lib.makeBatch,
    { reloop: false }
  );

  // Insert the new worker to reserve exactly one running.
  await ctx.db.insert("nextBatchRun", {
    runId,
  });
}

// A background job that grabs batches of emails and enqueues them to be sent by the workpool.
export const makeBatch = internalMutation({
  args: { reloop: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // We scan earlier than two segments ago to avoid contention between new email insertions and batch creation.
    const nowSegment = getSegment(Date.now());
    const scanSegment = nowSegment - 2;

    // Get the API key for the worker.
    const lastOptions = await ctx.db.query("lastOptions").unique();
    if (!lastOptions) {
      throw new Error("No last options found -- invariant");
    }
    const options = lastOptions.options;

    // Grab the batch of emails to send.
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) =>
        q.eq("status", "waiting").lte("segment", scanSegment)
      )
      .take(BATCH_SIZE);

    // If we have no emails, or we have a short batch on a reloop,
    // let's delay working for now.
    if (emails.length === 0 || (args.reloop && emails.length < BATCH_SIZE)) {
      return reschedule(ctx, emails.length > 0);
    }

    console.log(`Making a batch of ${emails.length} emails`);

    // Mark the emails as queued.
    for (const email of emails) {
      await ctx.db.patch(email._id, {
        status: "queued",
      });
    }

    // Give the batch to the workpool! It will call the Resend batch API
    // in a durable background action.
    await emailPool.enqueueAction(
      ctx,
      internal.lib.callResendAPIWithBatch,
      {
        apiKey: options.apiKey,
        emails: emails.map((e) => e._id),
      },
      {
        retry: {
          maxAttempts: options.retryAttempts,
          initialBackoffMs: options.initialBackoffMs,
          base: 2,
        },
      }
    );

    // Let's go around again until there are no more batches to make in this particular segment range.
    await ctx.scheduler.runAfter(0, internal.lib.makeBatch, { reloop: true });
  },
});

// If there are no more emails to send in this segment range, we need to check to see if there are any
// emails in newer segments and so we should sleep for a bit before trying to make batches again.
// If the table is empty, we need to stop the worker and idle the system until a new email is inserted.
async function reschedule(ctx: MutationCtx, emailsLeft: boolean) {
  emailsLeft =
    emailsLeft ||
    (await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) => q.eq("status", "waiting"))
      .first()) !== null;

  if (!emailsLeft) {
    // No next email yet?
    const batchRun = await ctx.db.query("nextBatchRun").unique();
    if (!batchRun) {
      throw new Error("No batch run found -- invariant");
    }
    await ctx.db.delete(batchRun._id);
  } else {
    await ctx.scheduler.runAfter(BASE_BATCH_DELAY, internal.lib.makeBatch, {
      reloop: false,
    });
  }
}

// Helper to fetch content. We'll use batch apis here to avoid lots of action->query calls.
async function getAllContent(
  ctx: ActionCtx,
  contentIds: Id<"content">[]
): Promise<Map<Id<"content">, string>> {
  const docs = await ctx.runQuery(internal.lib.getAllContentByIds, {
    contentIds,
  });
  return new Map(docs.map((doc) => [doc.id, doc.content]));
}

// Okay, finally! Let's call the Resend API with the batch of emails.
export const callResendAPIWithBatch = internalAction({
  args: {
    apiKey: v.string(),
    emails: v.array(v.id("emails")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Construct the JSON payload for the Resend API from all the database values.
    const batchPayload = await createResendBatchPayload(ctx, args.emails);

    if (batchPayload === null) {
      // No emails to send.
      console.log("No emails to send in batch. All are cancelled.");
      return;
    }

    // Okay, let's calculate rate limiting as best we can globally in this distributed system.
    const goTime = await getGoTime(ctx);
    const delay = goTime - Date.now();
    //console.log(`RL Delay: ${delay}ms, goTime: ${goTime}`);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Make API call
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": args.emails[0].toString(),
      },
      body: batchPayload,
    });
    if (!response.ok) {
      // For now, try again.
      const errorText = await response.text();
      throw new Error(`Resend API error: ${errorText}`);
    } else {
      const data = await response.json();
      if (!data.data) {
        throw new Error("Resend API error: No data returned");
      }
      await ctx.runMutation(internal.lib.markEmailsSent, {
        emailIds: args.emails,
        resendIds: args.emails.map((_, i) => data.data[i]?.id),
      });
    }
  },
});

// Helper to create the JSON payload for the Resend API.
async function createResendBatchPayload(
  ctx: ActionCtx,
  emailIds: Id<"emails">[]
): Promise<string | null> {
  // Fetch emails from database.
  const allEmails = await ctx.runQuery(internal.lib.getEmailsByIds, {
    emailIds,
  });
  // Filter out cancelled emails.
  const emails = allEmails.filter((e) => e.status !== "cancelled");
  if (emails.length === 0) {
    return null;
  }
  // Fetch body content from database.
  const contentMap = await getAllContent(
    ctx,
    emails
      .flatMap((e) => [e.html, e.text])
      .filter((id): id is Id<"content"> => id !== undefined)
  );

  // Build payload for resend API.
  const batchPayload = emails.map((email: Doc<"emails">) => ({
    from: email.from,
    to: [email.to],
    subject: email.subject,
    html: email.html ? contentMap.get(email.html) : undefined,
    text: email.text ? contentMap.get(email.text) : undefined,
    reply_to: email.replyTo && email.replyTo.length ? email.replyTo : undefined,
    headers: email.headers
      ? Object.fromEntries(
          email.headers.map((h: { name: string; value: string }) => [
            h.name,
            h.value,
          ])
        )
      : undefined,
  }));

  return JSON.stringify(batchPayload);
}

const FIXED_WINDOW_DELAY = 100;
async function getGoTime(ctx: RunMutationCtx): Promise<number> {
  const limit = await resendApiRateLimiter.limit(ctx, "resendApi", {
    reserve: true,
    throws: true,
  });
  //console.log(`RL: ${limit.ok} ${limit.retryAfter}`);
  return Date.now() + FIXED_WINDOW_DELAY + (limit.retryAfter ?? 0);
}

// Helper to fetch content by id. We'll use batch apis here to avoid lots of action->query calls.
export const getAllContentByIds = internalQuery({
  args: { contentIds: v.array(v.id("content")) },
  returns: v.array(v.object({ id: v.id("content"), content: v.string() })),
  handler: async (ctx, args) => {
    const contentMap = [];
    const promises = [];
    for (const contentId of args.contentIds) {
      promises.push(ctx.db.get(contentId));
    }
    const docs = await Promise.all(promises);
    for (const doc of docs) {
      if (!doc) throw new Error("Content not found -- invariant");
      contentMap.push({
        id: doc._id,
        content: new TextDecoder().decode(doc.content),
      });
    }
    return contentMap;
  },
});

// Helper to fetch emails by id. We'll use batch apis here to avoid lots of action->query calls.
export const getEmailsByIds = internalQuery({
  args: { emailIds: v.array(v.id("emails")) },
  handler: async (ctx, args) => {
    const emails = await Promise.all(args.emailIds.map((id) => ctx.db.get(id)));

    // Some emails might be missing b/c they were cancelled long ago and already
    // cleaned up because the retention period has passed.
    return emails.filter((e): e is Doc<"emails"> => e !== null);
  },
});

// Helper to mark emails as sent. We'll use batch apis here to avoid lots of action->mutation calls.
export const markEmailsSent = internalMutation({
  args: {
    emailIds: v.array(v.id("emails")),
    resendIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Promise.all(
      args.emailIds.map((emailId, i) =>
        ctx.db.patch(emailId, {
          status: "sent",
          resendId: args.resendIds[i],
        })
      )
    );
  },
});

// Helper to fetch an email by resendId. This is used by the webhook handler.
// Resend gives us *their* id back, no ours. We'll use the index to find it.
export const getEmailByResendId = internalQuery({
  args: { resendId: v.string() },
  handler: async (ctx, args) => {
    const email = await ctx.db
      .query("emails")
      .withIndex("by_resendId", (q) => q.eq("resendId", args.resendId))
      .unique();
    if (!email) throw new Error("Email not found for resendId");
    return email;
  },
});

// Handle a webhook event. Mostly we just update the email status.
export const handleEmailEvent = mutation({
  args: {
    event: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EmailEvent;
    const resendId = event.data.email_id;
    const email = await ctx.db
      .query("emails")
      .withIndex("by_resendId", (q) => q.eq("resendId", resendId))
      .unique();
    if (!email) throw new Error("Email not found for resendId: " + resendId);
    const cleanedEvent: EmailEvent = {
      type: event.type,
      data: {
        email_id: resendId,
      },
    };
    switch (event.type) {
      case "email.sent":
        // NOOP -- we do this automatically when we send the email.
        break;
      case "email.delivered":
        email.status = "delivered";
        email.finalizedAt = Date.now();
        break;
      case "email.bounced":
        email.status = "bounced";
        email.finalizedAt = Date.now();
        email.errorMessage = event.data.bounce?.message;
        cleanedEvent.data.bounce = {
          message: event.data.bounce?.message,
        };
        break;
      case "email.delivery_delayed":
        email.status = "delivery_delayed";
        break;
      case "email.complained":
        email.complained = true;
        break;
      case "email.opened":
        email.opened = true;
        break;
      case "email.clicked":
        // One email can have multiple clicks, so we don't track them for now.
        break;
      default:
        // Ignore other events
        return;
    }

    await ctx.db.replace(email._id, email);
    await enqueueCallbackIfExists(ctx, email, cleanedEvent);
  },
});

async function enqueueCallbackIfExists(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: EmailEvent
) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    throw new Error("No last options found -- invariant");
  }
  if (lastOptions.options.onEmailEvent) {
    const handle = lastOptions.options.onEmailEvent.fnHandle as FunctionHandle<
      "mutation",
      {
        id: Id<"emails">;
        event: EmailEvent;
      },
      void
    >;
    await callbackPool.enqueueMutation(ctx, handle, {
      id: email._id,
      event: event,
    });
  }
}

// Periodic background job to clean up old emails that have already
// been delivered, bounced, what have you.
export const cleanupOldEmails = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const oldAndDone = await ctx.db
      .query("emails")
      .withIndex("by_finalizedAt", (q) =>
        q.lt("finalizedAt", Date.now() - FINALIZED_EMAIL_RETENTION_MS)
      )
      .take(500);
    for (const email of oldAndDone) {
      await ctx.db.delete(email._id);
      if (email.text) {
        await ctx.db.delete(email.text);
      }
      if (email.html) {
        await ctx.db.delete(email.html);
      }
    }
    if (oldAndDone.length > 0) {
      console.log(`Cleaned up ${oldAndDone.length} emails`);
    }
    if (oldAndDone.length === 500) {
      await ctx.scheduler.runAfter(0, internal.lib.cleanupOldEmails, {});
    }
  },
});

// Periodic background job to clean up old emails that have been abandoned.
// Meaning, even if they're not finalized, we should just get rid of them.
export const cleanupAbandonedEmails = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const oldAndAbandoned = await ctx.db
      .query("emails")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - ABANDONED_EMAIL_RETENTION_MS)
      )
      .take(500);

    for (const email of oldAndAbandoned) {
      // No webhook to finalize these. We'll just delete them.
      await ctx.db.delete(email._id);
      if (email.text) {
        await ctx.db.delete(email.text);
      }
      if (email.html) {
        await ctx.db.delete(email.html);
      }
    }
    if (oldAndAbandoned.length > 0) {
      console.log(`Cleaned up ${oldAndAbandoned.length} emails`);
    }
    if (oldAndAbandoned.length === 500) {
      await ctx.scheduler.runAfter(0, internal.lib.cleanupAbandonedEmails, {});
    }
  },
});
