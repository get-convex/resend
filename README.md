# Resend Convex Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fresend.svg)](https://badge.fury.io/js/@convex-dev%2Fresend)

This component is the official way to integrate the Resend email service
with your Convex project.

Features:

- Queueing: Send as many emails as you want, as fast as you want—they'll all be delivered (eventually).
- Batching: Automatically batches large groups of emails and sends them to Resend efficiently.
- Durable execution: Uses Convex workpools to ensure emails are eventually delivered, even in the face of temporary failures or network outages.
- Idempotency: Manages Resend idempotency keys to guarantee emails are delivered exactly once, preventing accidental spamming from retries.
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
import resend from "@convex-dev/resend/convex.config";

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
      to: "Resend <delivered@resend.dev>",
      subject: "Hi there",
      html: "This is a test email",
    });
  },
});
```

Then, calling `sendTestEmail` from anywhere in your app will send this test email.

If you want to send emails to real addresses, you need to disable `testMode`.
You can do this in `ResendOptions`, [as detailed below](#resend-component-options-and-going-into-production).

## Advanced Usage

### Setting up a Resend webhook

While the setup we have so far will reliably send emails, you don't have any feedback
on anything delivering, bouncing, or triggering spam complaints. For that, we need
to set up a webhook!

On the Convex side, we need to mount an http endpoint to our project to route it to
the Resend component in `convex/http.ts`:

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

If our Convex project is happy-leopard-123, we now have a Resend webhook for
our project running at `https://happy-leopard-123.convex.site/resend-webhook`.

So navigate to the Resend dashboard and create a new webhook at that URL. Make sure
to enable all the `email.*` events; the other event types will be ignored.

Finally, copy the webhook secret out of the Resend dashboard and set it to the
`RESEND_WEBHOOK_SECRET` environment variable in your Convex deployment.

You should now be seeing email status updates as Resend makes progress on your
batches!

Speaking of...

### Registering an email status event handler.

If you have your webhook established, you can also register an event handler in your
apps you get notifications when email statuses change.

Update your `sendEmails.ts` to look something like this:

```ts
import { components, internal } from "./_generated/api";
import { Resend } from "@convex-dev/resend";
import { internalMutation } from "./_generated/server";
import { vEmailId, vEmailEvent, Resend } from "@convex-dev/resend";

export const resend: Resend = new Resend(components.resend, {
  onEmailEvent: internal.example.handleEmailEvent,
});

export const handleEmailEvent = internalMutation({
  args: {
    id: vEmailId,
    event: vEmailEvent,
  },
  handler: async (ctx, args) => {
    console.log("Got called back!", args.id, args.event);
    // Probably do something with the event if you care about deliverability!
  },
});

/* ... existing email sending code ... */
```

Check out the `example/` project in this repo for a full demo.

### Resend component options, and going into production

There is a `ResendOptions` argument to the component constructor to help customize
it's behavior.

Check out the [docstrings](./src/client/index.ts), but notable options include:

- `apiKey`: Provide the Resend API key instead of having it read from the environment
  variable.
- `webhookSecret`: Same thing, but for the webhook secret.
- `testMode`: Only allow delivery to test addresses. To keep you safe as you develop
  your project, `testMode` is default **true**. You need to explicitly set this to
  `false` for the component to allow you to enqueue emails to artibrary addresses.
- `onEmailEvent`: Your email event callback, as outlined above!
  Check out the [docstrings](./src/client/index.ts) for details on the events that
  are emitted.

### Optional email sending parameters

In addition to basic from/to/subject and html/plain text bodies, the `sendEmail` method
allows you to provide a list of `replyTo` addresses, and other email headers.

### Tracking, getting status, and cancelling emails

The `sendEmail` method returns a branded type, `EmailId`. You can use this
for a few things:

- To reassociate the original email during status changes in your email event handler.
- To check on the status any time using `resend.status(ctx, emailId)`.
- To cancel the email using `resend.cancelEmail(ctx, emailId)`.

If the email has already been sent to the Resend API, it cannot be cancelled. Cancellations
do not trigger an email event.

### Data retention

This component retains "finalized" (delivered, cancelled, bounced) emails for seven days
so you can check on the status of them. Then, a background job clears out those emails
and their bodies to reclaim database space.
