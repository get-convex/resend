# Resend Convex Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fresend.svg)](https://badge.fury.io/js/@convex-dev%2Fresend)

This component is the official way to integrate the Resend email service with
your Convex project.

Features:

- Queueing: Send as many emails as you want, as fast as you want—they'll all be
  delivered (eventually).
- Batching: Automatically batches large groups of emails and sends them to
  Resend's `/emails/batch` endpoint efficiently.
- Durable execution: Uses Convex workpools to ensure emails are eventually
  delivered, even in the face of temporary failures or network outages.
- Idempotency: Manages Resend idempotency keys to guarantee emails are delivered
  exactly once, preventing accidental spamming from retries.
- Rate limiting: Honors API rate limits established by Resend.

See [example](./example) for a demo of how to incorporate this hook into your
application.

[![Navigate the Email MINEFIELD with the Resend Component!](https://thumbs.video-to-markdown.com/bf0f179c.jpg)](https://youtu.be/iIq67N8vuMU)

## Installation

```bash
npm install @convex-dev/resend
```

## Get Started

Create a [Resend](https://resend.com) account and grab an API key. Set it to
`RESEND_API_KEY` in your deployment environment.

Next, add the component to your Convex app via `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import resend from "@convex-dev/resend/convex.config.js";

const app = defineApp();
app.use(resend);

export default app;
```

Then you can use it, as we see in `convex/sendEmails.ts`:

```ts
import { components } from "./_generated/api";
import { Resend } from "@convex-dev/resend";
import { internalMutation } from "./_generated/server";

export const resend: Resend = new Resend(components.resend, {});

export const sendTestEmail = internalMutation({
  handler: async (ctx) => {
    await resend.sendEmail(ctx, {
      from: "Me <test@mydomain.com>",
      to: "delivered@resend.dev",
      subject: "Hi there",
      html: "This is a test email",
    });
  },
});
```

Then, calling `sendTestEmail` from anywhere in your app will send this test
email.

If you want to send emails to real addresses, you need to disable `testMode`.
You can do this in `ResendOptions`,
[as detailed below](#resend-component-options-and-going-into-production).

A note on test email addresses:
[Resend allows the use of labels](https://resend.com/docs/dashboard/emails/send-test-emails#using-labels-effectively)
for test emails. For simplicity, this component only allows labels matching
`[a-zA-Z0-9_-]*`, e.g. `delivered+user-1@resend.dev`.

## Advanced Usage

### Setting up a Resend webhook

While the setup we have so far will reliably send emails, you don't have any
feedback on anything delivering, bouncing, or triggering spam complaints. For
that, we need to set up a webhook!

On the Convex side, we need to mount an http endpoint to our project to route it
to the Resend component in `convex/http.ts`:

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { resend } from "./sendEmails";

const http = httpRouter();

http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await resend.handleResendEventWebhook(ctx, req);
  }),
});

export default http;
```

If our Convex project is happy-leopard-123, we now have a Resend webhook for our
project running at `https://happy-leopard-123.convex.site/resend-webhook`.

So navigate to the Resend dashboard and create a new webhook at that URL. Make
sure to enable all the `email.*` events; the other event types will be ignored.

Finally, copy the webhook secret out of the Resend dashboard and set it to the
`RESEND_WEBHOOK_SECRET` environment variable in your Convex deployment.

You should now be seeing email status updates as Resend makes progress on your
batches!

Speaking of...

### Registering an email status event handler.

If you have your webhook established, you can also register an event handler in
your apps you get notifications when email statuses change.

Update your `sendEmails.ts` to look something like this:

```ts
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { vEmailId, vEmailEvent, Resend } from "@convex-dev/resend";

export const resend: Resend = new Resend(components.resend, {
  onEmailEvent: internal.example.handleEmailEvent,
});

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    // Handle however you want
    // args provides { id: EmailId; event: EmailEvent; }
    // see /example/example.ts
  },
});
```

Check out the `example/` project in this repo for a full demo.

### Resend component options, and going into production

There is a `ResendOptions` argument to the component constructor to help
customize it's behavior.

Check out the [docstrings](./src/client/index.ts), but notable options include:

- `apiKey`: Provide the Resend API key instead of having it read from the
  environment variable.
- `webhookSecret`: Same thing, but for the webhook secret.
- `testMode`: Only allow delivery to test addresses. To keep you safe as you
  develop your project, `testMode` is default **true**. You need to explicitly
  set this to `false` for the component to allow you to enqueue emails to
  artibrary addresses.
- `onEmailEvent`: Your email event callback, as outlined above! Check out the
  [docstrings](./src/client/index.ts) for details on the events that are
  emitted.

### Optional email sending parameters

In addition to basic from/to/subject and html/plain text bodies, the `sendEmail`
method allows you to provide a list of `replyTo` addresses, and other email
headers.

### Using Resend Templates

You can use
[Resend templates](https://resend.com/docs/dashboard/templates/introduction) to
send emails with pre-designed templates from your Resend dashboard. To use a
template, provide the template ID and any required template variables:

```ts
await resend.sendEmail(ctx, {
  from: "Me <test@mydomain.com>",
  to: "delivered@resend.dev",
  subject: "Welcome to our app",
  template: {
    id: "my-template-id",
    variables: {
      name: "John Doe",
      verificationLink: "https://example.com/verify?token=abc123",
    },
  },
});
```

> [!IMPORTANT] You cannot use both `template` and `html`/`text` in the same
> email. If you need to send dynamic HTML content, either use templates with
> template variables, or use the `html`/`text` fields directly (optionally with
> [React Email](#using-react-email)).

### Tracking, getting status, and cancelling emails

The `sendEmail` method returns a branded type, `EmailId`. You can use this for a
few things:

- To reassociate the original email during status changes in your email event
  handler.
- To check on the status any time using `resend.status(ctx, emailId)`.
- To cancel the email using `resend.cancelEmail(ctx, emailId)`.

If the email has already been sent to the Resend API, it cannot be cancelled.
Cancellations do not trigger an email event.

#### Checking email status programmatically

Use the `status` method to check an email's current state:

```ts
const emailStatus = await resend.status(ctx, emailId);
if (emailStatus) {
  console.log(emailStatus.status); // e.g., "delivered", "bounced", "sent"
  console.log(emailStatus.bounced); // boolean
  console.log(emailStatus.failed); // boolean
  console.log(emailStatus.complained); // spam complaint (boolean)
  console.log(emailStatus.deliveryDelayed); // boolean
  console.log(emailStatus.opened); // if open tracking enabled (boolean)
  console.log(emailStatus.clicked); // if click tracking enabled (boolean)
  console.log(emailStatus.errorMessage); // error details (string | null)
}
```

#### Viewing emails and webhook events in the dashboard

You can view all email data directly in your Convex dashboard in the component's
data view. Click the drop down with a puzzle piece that says app:

![Component tables screenshot](./component_tables.png)

1. **Emails table**: Navigate to your Convex dashboard → Data. Choose `resend`
   from the component drop down then choose the `emails` table. This shows all
   emails with their current status, recipients, subjects, and tracking
   information.

2. **Delivery Events table**: Navigate to Components → `resend` →
   `deliveryEvents` table. This table stores all webhook events received from
   Resend, including:
   - `emailId`: Links back to the email in the emails table
   - `resendId`: Resend's ID for the email
   - `eventType`: The type of event (e.g., `email.delivered`, `email.bounced`,
     `email.opened`, `email.clicked`, `email.complained`)
   - `createdAt`: When the event occurred
   - `message`: Additional details (e.g., bounce reasons)

This is useful for debugging delivery issues, viewing email history, and
understanding what happened with each email you sent.

### Data retention

This component retains "finalized" (delivered, cancelled, bounced) emails. It's
your responsibility to clear out those emails on your own schedule. You can run
`cleanupOldEmails` and `cleanupAbandonedEmails` from the dashboard, under the
"resend" component tab in the function runner, or set up a cron job.

If you pass no argument, it defaults to deleting emails older than 7 days.

If you don't care about historical email status, the recommended approach is to
use a cron job, as shown below:

```ts
// in convex/crons.ts
import { cronJobs } from "convex/server";
import { components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const crons = cronJobs();
crons.interval(
  "Remove old emails from the resend component",
  { hours: 1 },
  internal.crons.cleanupResend,
);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const cleanupResend = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    });
    await ctx.scheduler.runAfter(
      0,
      components.resend.lib.cleanupAbandonedEmails,
      // These generally indicate a bug, so keep them around for longer.
      { olderThan: 4 * ONE_WEEK_MS },
    );
  },
});

export default crons;
```

### Using React Email

You can use [React Email](https://react.email/) to generate your HTML for you
from JSX.

First install the
[dependencies](https://react.email/docs/getting-started/manual-setup#2-install-dependencies):

```bash
npm install @react-email/components react react-dom react-email @react-email/render
```

Then create a new .tsx file in your Convex directory e.g. `/convex/emails.tsx`:

```tsx
// IMPORTANT: this is a Convex Node Action
"use node";
import { action } from "./_generated/server";
import { render, pretty } from "@react-email/render";
import { Button, Html } from "@react-email/components";
import { components } from "./_generated/api";
import { Resend } from "@convex-dev/resend";

export const resend: Resend = new Resend(components.resend, {
  testMode: false,
});

export const sendEmail = action({
  args: {},
  handler: async (ctx, args) => {
    // 1. Generate the HTML from your JSX
    // This can come from a custom component in your /emails/ directory
    // if you would like to view your templates locally. For more info see:
    // https://react.email/docs/getting-started/manual-setup#5-run-locally
    const html = await pretty(
      await render(
        <Html>
          <Button
            href="https://example.com"
            style={{ background: "#000", color: "#fff", padding: "12px 20px" }}
          >
            Click me
          </Button>
        </Html>,
      ),
    );

    // 2. Send your email as usual using the component
    await resend.sendEmail(ctx, {
      from: "Me <test@mydomain.com>",
      to: "delivered@resend.dev",
      subject: "Hi there",
      html,
    });
  },
});
```

> [!WARNING] React Email requires some Node dependencies thus it must run in a
> Convex
> [Node action](https://docs.convex.dev/functions/actions#choosing-the-runtime-use-node)
> and not a regular Action.

### Sending emails manually, e.g. for attachments

If you need something that the component doesn't provide (it is currently
limited by what is supported by the batch API in Resend), you can send emails
manually using `sendEmailManually`. Unlike `sendEmail` which enqueues emails
and sends them in batches via the `/emails/batch` endpoint, `sendEmailManually`
calls Resend's `/emails` endpoint directly without enqueueing. This gives you
fine-grained control over the email sending process while still tracking its
progress using the component's status and webhook APIs.

```ts
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { Resend as ResendComponent } from "@convex-dev/resend";
import { Resend } from "resend";

const resendSdk = new Resend("re_xxxxxxxxx");

export const resend = new ResendComponent(components.resend, {});

export const sendManualEmail = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const from = "Acme <onboarding@resend.dev>";
    const to = ["delivered@resend.dev"];
    const subject = "hello world";
    const html = "<p>it works!</p>";

    const emailId = await resend.sendEmailManually(
      ctx,
      { from, to, subject },
      async (emailId) => {
        const {data, error} = await resendSdk.emails.send({
          from,
          to,
          subject,
          html,
          headers: {
            "Idempotency-Key": emailId,
          },
        });
        if (error) {
          throw new Error(`[Email] Failed to send: ${error.message}`);
        }
        return data.id!;
      },
    );
  },
});
```

Use `sendEmailManually` when you need features not supported by the batch API,
such as attachments, or when you want to send an email immediately without
waiting for the batching system.
