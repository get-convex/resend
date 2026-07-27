import { defineApp } from "convex/server";
import { v } from "convex/values";
import resend from "@convex-dev/resend/convex.config";

const app = defineApp({
  env: {
    RESEND_API_KEY: v.string(),
    RESEND_WEBHOOK_SECRET: v.optional(v.string()),
  },
});
app.use(resend);

export default app;
