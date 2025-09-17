import { v } from "convex/values";
import {
  internalAction,
  mutation,
  type MutationCtx,
  query,
  internalQuery,
  type ActionCtx,
} from "./_generated/server.js";
import { Workpool } from "@convex-dev/workpool";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { api, components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import { type Id, type Doc } from "./_generated/dataModel.js";
import {
  type RuntimeConfig,
  vEmailEvent,
  vOptions,
  vStatus,
} from "./shared.js";
import type { FunctionHandle } from "convex/server";
import type { EmailEvent, RunMutationCtx } from "./shared.js";
import { isDeepEqual } from "remeda";
import schema from "./schema.js";
import { omit } from "convex-helpers";
import { parse } from "convex-helpers/validators";
import {
  assertExhaustive,
  attemptToParse,
  iife,
  isValidResendTestEmail,
} from "./utils.js";

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

const PERMANENT_ERROR_CODES = new Set([
  400, 401 /* 402 not included - unclear spec */, 403, 404, 405, 406, 407, 408,
  /* 409 not included - conflict may work on retry */
  410, 411 /* 412 not included - precondition may have changed? */, 413, 414,
  415, 416 /* 417, not included - expectation may be met later? */, 418, 421,
  422 /*423, 424, 425, may change over time */, 426, 427,
  428 /* 429, explicitly asked to retry */, 431 /* 451, laws change? */,
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
    if (args.options.testMode && !isValidResendTestEmail(args.to)) {
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

export const createManualEmail = mutation({
  args: {
    from: v.string(),
    to: v.string(),
    subject: v.string(),
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
    const emailId = await ctx.db.insert("emails", {
      from: args.from,
      to: args.to,
      subject: args.subject,
      headers: args.headers,
      segment: Infinity,
      status: "queued",
      complained: false,
      opened: false,
      replyTo: args.replyTo ?? [],
      finalizedAt: FINALIZED_EPOCH,
    });
    return emailId;
  },
});

export const updateManualEmail = mutation({
  args: {
    emailId: v.id("emails"),
    status: vStatus,
    resendId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const finalizedAt =
      args.status === "failed" || args.status === "cancelled"
        ? Date.now()
        : undefined;
    await ctx.db.patch(args.emailId, {
      status: args.status,
      resendId: args.resendId,
      errorMessage: args.errorMessage,
      ...(finalizedAt ? { finalizedAt } : {}),
    });
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
  returns: v.union(
    v.object({
      status: vStatus,
      errorMessage: v.union(v.string(), v.null()),
      complained: v.boolean(),
      opened: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      return null;
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
  returns: v.union(
    v.object({
      ...omit(schema.tables.emails.validator.fields, ["html", "text"]),
      createdAt: v.number(),
      html: v.optional(v.string()),
      text: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      return null;
    }
    const html = email.html
      ? new TextDecoder().decode((await ctx.db.get(email.html))?.content)
      : undefined;
    const text = email.text
      ? new TextDecoder().decode((await ctx.db.get(email.text))?.content)
      : undefined;
    return {
      ...omit(email, ["html", "text", "_id", "_creationTime"]),
      createdAt: email._creationTime,
      html,
      text,
    };
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
  } else if (!isDeepEqual(lastOptions.options, options)) {
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
    { reloop: false, segment: getSegment(Date.now() + BASE_BATCH_DELAY) }
  );

  // Insert the new worker to reserve exactly one running.
  await ctx.db.insert("nextBatchRun", {
    runId,
  });
}

// A background job that grabs batches of emails and enqueues them to be sent by the workpool.
export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
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
        // We scan earlier than two segments ago to avoid contention between new email insertions and batch creation.
        q.eq("status", "waiting").lte("segment", args.segment - 2)
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

    // Okay, let's calculate rate limiting as best we can globally in this distributed system.
    const delay = await getDelay(ctx);

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
        runAfter: delay,
        context: { emailIds: emails.map((e) => e._id) },
        onComplete: internal.lib.onEmailComplete,
      }
    );

    // Let's go around again until there are no more batches to make in this particular segment range.
    await ctx.scheduler.runAfter(0, internal.lib.makeBatch, {
      reloop: true,
      segment: args.segment,
    });
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
    const segment = getSegment(Date.now() + BASE_BATCH_DELAY);
    await ctx.scheduler.runAfter(BASE_BATCH_DELAY, internal.lib.makeBatch, {
      reloop: false,
      segment,
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

const vBatchReturns = v.union(
  v.null(),
  v.object({
    emailIds: v.array(v.id("emails")),
    resendIds: v.array(v.string()),
  })
);

// Okay, finally! Let's call the Resend API with the batch of emails.
export const callResendAPIWithBatch = internalAction({
  args: {
    apiKey: v.string(),
    emails: v.array(v.id("emails")),
  },
  returns: vBatchReturns,
  handler: async (ctx, args) => {
    // Construct the JSON payload for the Resend API from all the database values.
    const batchPayload = await createResendBatchPayload(ctx, args.emails);

    if (batchPayload === null) {
      // No emails to send.
      console.log("No emails to send in batch. All were cancelled or failed.");
      return;
    }

    const [emailIds, body] = batchPayload;

    // Make API call
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": args.emails[0].toString(),
      },
      body,
    });
    if (!response.ok) {
      if (PERMANENT_ERROR_CODES.has(response.status)) {
        // report the error to the user
        await ctx.runMutation(internal.lib.markEmailsFailed, {
          emailIds: args.emails,
          errorMessage: `Resend API error: ${response.status} ${response.statusText} ${await response.text()}`,
        });
        return;
      }
      // For now, try again.
      const errorText = await response.text();
      throw new Error(`Resend API error: ${errorText}`);
    } else {
      const data = await response.json();
      if (!data.data) {
        throw new Error("Resend API error: No data returned");
      }
      return {
        emailIds,
        resendIds: data.data.map((d: { id: string }) => d.id),
      };
    }
  },
});

export const markEmailsFailed = internalMutation({
  args: {
    emailIds: v.array(v.id("emails")),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: markEmailsFailedHandler,
});

async function markEmailsFailedHandler(
  ctx: MutationCtx,
  args: {
    emailIds: Id<"emails">[];
    errorMessage: string;
  }
) {
  await Promise.all(
    args.emailIds.map(async (emailId) => {
      const email = await ctx.db.get(emailId);
      if (!email || email.status !== "queued") {
        return;
      }
      await ctx.db.patch(emailId, {
        status: "failed",
        errorMessage: args.errorMessage,
        finalizedAt: Date.now(),
      });
    })
  );
}

export const onEmailComplete = emailPool.defineOnComplete({
  context: v.object({
    emailIds: v.array(v.id("emails")),
  }),
  handler: async (ctx, args) => {
    if (args.result.kind === "success") {
      const result = parse(vBatchReturns, args.result.returnValue);
      if (result === null) {
        return;
      }
      const { emailIds, resendIds } = result;
      await Promise.all(
        emailIds.map((emailId, i) =>
          ctx.db.patch(emailId, {
            status: "sent",
            resendId: resendIds[i],
          })
        )
      );
    } else if (args.result.kind === "failed") {
      await markEmailsFailedHandler(ctx, {
        emailIds: args.context.emailIds,
        errorMessage: args.result.error,
      });
    } else if (args.result.kind === "canceled") {
      await Promise.all(
        args.context.emailIds.map(async (emailId) => {
          const email = await ctx.db.get(emailId);
          if (!email || email.status !== "queued") {
            return;
          }
          await ctx.db.patch(emailId, {
            status: "cancelled",
            errorMessage: "Resend API batch job was cancelled",
            finalizedAt: Date.now(),
          });
        })
      );
    }
  },
});

// Helper to create the JSON payload for the Resend API.
async function createResendBatchPayload(
  ctx: ActionCtx,
  emailIds: Id<"emails">[]
): Promise<[Id<"emails">[], string] | null> {
  // Fetch emails from database.
  const allEmails = await ctx.runQuery(internal.lib.getEmailsByIds, {
    emailIds,
  });
  // Filter out cancelled emails.
  const emails = allEmails.filter((e) => e.status === "queued");
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

  return [emails.map((e) => e._id), JSON.stringify(batchPayload)];
}

const FIXED_WINDOW_DELAY = 100;
async function getDelay(ctx: RunMutationCtx): Promise<number> {
  const limit = await resendApiRateLimiter.limit(ctx, "resendApi", {
    reserve: true,
  });
  //console.log(`RL: ${limit.ok} ${limit.retryAfter}`);
  const jitter = Math.random() * FIXED_WINDOW_DELAY;
  return limit.retryAfter ? limit.retryAfter + jitter : 0;
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
    // Event can be anything, so we need to parse it.
    // this will also strip out anything that shouldnt be there.
    const result = attemptToParse(vEmailEvent, args.event);
    if (result.kind === "error") {
      console.warn(
        `Invalid email event received. You might want to to exclude this event from your Resend webhook settings in the Resend dashboard. ${result.error}.`
      );
      return;
    }

    const event = result.data;

    const email = await ctx.db
      .query("emails")
      .withIndex("by_resendId", (q) => q.eq("resendId", event.data.email_id))
      .unique();

    if (!email) {
      console.info(
        `Email not found for resendId: ${event.data.email_id}, ignoring...`
      );
      return;
    }

    // Returns the changed email or null if not changed
    const changed = iife((): Doc<"emails"> | null => {
      // NOOP -- we do this automatically when we send the email.
      if (event.type == "email.sent") return null;

      // These we dont do anything with
      if (event.type == "email.clicked") return null;
      if (event.type == "email.failed") return null;

      if (event.type == "email.delivered")
        return {
          ...email,
          status: "delivered",
          finalizedAt: Date.now(),
        };

      if (event.type == "email.bounced")
        return {
          ...email,
          status: "bounced",
          finalizedAt: Date.now(),
          errorMessage: event.data.bounce?.message,
        };

      if (event.type == "email.delivery_delayed")
        return {
          ...email,
          status: "delivery_delayed",
        };

      if (event.type == "email.complained")
        return {
          ...email,
          complained: true,
        };

      if (event.type == "email.opened")
        return {
          ...email,
          opened: true,
        };

      assertExhaustive(event);

      return null;
    });

    if (changed) await ctx.db.replace(email._id, changed);

    await enqueueCallbackIfExists(ctx, changed ?? email, event);
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
export const cleanupOldEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? FINALIZED_EMAIL_RETENTION_MS;
    const oldAndDone = await ctx.db
      .query("emails")
      .withIndex("by_finalizedAt", (q) =>
        q.lt("finalizedAt", Date.now() - olderThan)
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
      await ctx.scheduler.runAfter(0, api.lib.cleanupOldEmails, {
        olderThan,
      });
    }
  },
});

// Periodic background job to clean up old emails that have been abandoned.
// Meaning, even if they're not finalized, we should just get rid of them.
export const cleanupAbandonedEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? ABANDONED_EMAIL_RETENTION_MS;
    const oldAndAbandoned = await ctx.db
      .query("emails")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - olderThan)
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
      await ctx.scheduler.runAfter(0, api.lib.cleanupAbandonedEmails, {
        olderThan,
      });
    }
  },
});
