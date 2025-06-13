import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { resend } from "./example";

const http = httpRouter();

http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await resend.handleResendEventWebhook(ctx, req);
  }),
});

export default http;
