import {
  createFunctionHandle,
  Expand,
  FunctionReference,
  FunctionVisibility,
} from "convex/server";
import { GenericId, v, VString } from "convex/values";
import { api } from "../component/_generated/api";
import { RuntimeConfig, Status } from "../component/shared";
import { Webhook } from "svix";
import { EmailEvent, RunMutationCtx, RunQueryCtx } from "../component/shared";

export type EmailId = string & { __isEmailId: true };
export const vEmailId = v.string() as VString<EmailId>;
export { vEmailEvent, vStatus, vOptions } from "../component/shared";
export type { Status, EmailEvent } from "../component/shared";

type Config = RuntimeConfig & {
  webhookSecret: string;
};

function getDefaultConfig(): Config {
  return {
    apiKey: process.env.RESEND_API_KEY ?? "",
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? "",
    initialBackoffMs: 30000,
    retryAttempts: 5,
    testMode: true,
  };
}

export type ResendOptions = {
  /**
   * The API key to use for the Resend API.
   * If not provided, the API key will be read from the environment variable RESEND_API_KEY.
   */
  apiKey?: string;

  /**
   * The secret to use for the Resend webhook.
   * If not provided, the webhook secret will be read from the environment variable RESEND_WEBHOOK_SECRET.
   */
  webhookSecret?: string;

  /**
   * The initial backoff to use for the Resend API.
   * If not provided, the initial backoff will be 30 seconds.
   */
  initialBackoffMs?: number;

  /**
   * The number of retry attempts to use for the Resend API.
   * If not provided, the number of retry attempts will be 5.
   */
  retryAttempts?: number;

  /**
   * Whether to run in test mode. In test mode, only emails to
   * resend-approved test email addresses will be sent.
   * If not provided, the test mode will be true. You need to opt
   * into production mode by setting testMode to false.
   */
  testMode?: boolean;

  /**
   * A mutation to run after an email event occurs.
   * The mutation will be passed the email id and the event.
   */
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null;
};

async function configToRuntimeConfig(
  config: Config,
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null
): Promise<RuntimeConfig> {
  return {
    apiKey: config.apiKey,
    initialBackoffMs: config.initialBackoffMs,
    retryAttempts: config.retryAttempts,
    testMode: config.testMode,
    onEmailEvent: onEmailEvent
      ? { fnHandle: await createFunctionHandle(onEmailEvent) }
      : undefined,
  };
}

export type EmailStatus = {
  /**
   * The status of the email. It will be one of the following:
   * - `waiting`: The email has not yet been batched.
   * - `queued`: The email has been batched and is waiting to be sent.
   * - `sent`: The email has been sent to Resend, but we do not yet know its fate.
   * - `bounced`: The email bounced.
   * - `delivered`: The email was delivered successfully.
   * - `delivery_delayed`: Resend is having trouble delivering the email, but is still trying.
   */
  status: Status;

  /**
   * The error message of the email. Typically only set on bounces.
   */
  errorMessage: string | null;

  /**
   * Whether the email was marked as spam. This is only set on emails which are delivered.
   */
  complained: boolean;

  /**
   * If you're using open tracking, did Resend detect that the email was opened?
   */
  opened: boolean;
};

export class Resend {
  public config: Config;
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null;

  /**
   * Creates a Resend component.
   *
   * @param component The component to use, like `components.resend` from
   * `./_generated/api.ts`.
   * @param options The {@link ResendOptions} to use for this component.
   */
  constructor(
    public component: UseApi<typeof api>,
    options?: ResendOptions
  ) {
    const defaultConfig = getDefaultConfig();
    this.config = {
      apiKey: options?.apiKey ?? defaultConfig.apiKey,
      webhookSecret: options?.webhookSecret ?? defaultConfig.webhookSecret,
      initialBackoffMs:
        options?.initialBackoffMs ?? defaultConfig.initialBackoffMs,
      retryAttempts: options?.retryAttempts ?? defaultConfig.retryAttempts,
      testMode: options?.testMode ?? defaultConfig.testMode,
    };
    if (options?.onEmailEvent) {
      this.onEmailEvent = options.onEmailEvent;
    }
  }

  /**
   * Sends an email.
   *
   * Specifically, enqueues your email to be sent as part of efficient, durable email batches
   * managed by the component. The email will be sent as soon as possible, but the component
   * will manage rate limiting and batching for efficiency.
   *
   * This component utilizes idempotency keys to ensure the email is sent exactly once.
   *
   * @param ctx Any context that can run a mutation. You can enqueue an email from
   * either a mutation or an action.
   * @param from The email address to send from.
   * @param to The email address to send to.
   * @param subject The subject of the email.
   * @param html The HTML body of the email.
   * @param text The text body of the email.
   * @param replyTo Optionally, any extra reply to addresses to include in the email.
   * @param headers Extra email headers your want included.
   * @returns The id of the email within the component.
   */
  async sendEmail(
    ctx: RunMutationCtx,
    from: string,
    to: string,
    subject: string,
    html?: string,
    text?: string,
    replyTo?: string[],
    headers?: { name: string; value: string }[]
  ) {
    if (this.config.apiKey === "") {
      throw new Error("API key is not set");
    }
    const id = await ctx.runMutation(this.component.lib.sendEmail, {
      options: await configToRuntimeConfig(this.config, this.onEmailEvent),
      from,
      to,
      subject,
      html,
      text,
      replyTo,
      headers,
    });
    return id as EmailId;
  }

  /**
   * Cancels an email.
   *
   * This will mark the email as cancelled if it has no already been send to Resend.
   *
   * @param ctx Any context that can run a mutation. You can cancel an email from
   * either a mutation or an action.
   * @param emailId The id of the email to cancel. This was returned from {@link sendEmail}.
   */
  async cancelEmail(ctx: RunMutationCtx, emailId: EmailId) {
    await ctx.runMutation(this.component.lib.cancelEmail, {
      emailId,
    });
  }

  /**
   * Gets the status of an email.
   *
   * @param ctx Any context that can run a query. You can get the status of an email from
   * an action, mutation, or query.
   * @param emailId The id of the email to get the status of. This was returned from {@link sendEmail}.
   * @returns {@link EmailStatus} The status of the email.
   */
  async status(ctx: RunQueryCtx, emailId: EmailId): Promise<EmailStatus> {
    return await ctx.runQuery(this.component.lib.getStatus, {
      emailId,
    });
  }

  /**
   * Handles a Resend event webhook.
   *
   * This will update emails in the component with the status of the email as detected by Resend,
   * and call your `onEmailEvent` mutation if it is set.
   *
   * @param ctx Any context that can run a mutation.
   * @param req The request to handle from Resend.
   * @returns A response to send back to Resend.
   */
  async handleResendEventWebhook(
    ctx: RunMutationCtx,
    req: Request
  ): Promise<Response> {
    if (this.config.webhookSecret === "") {
      throw new Error("Webhook secret is not set");
    }
    const webhook = new Webhook(this.config.webhookSecret);
    const raw = await req.text();
    const svix_id = req.headers.get("svix-id") ?? "";
    const svix_timestamp = req.headers.get("svix-timestamp") ?? "";
    const svix_signature = req.headers.get("svix-signature") ?? "";
    const payload = webhook.verify(raw, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });
    const event: EmailEvent = payload as EmailEvent;

    await ctx.runMutation(this.component.lib.handleEmailEvent, {
      event,
    });

    return new Response(null, {
      status: 201,
    });
  }
}

export type OpaqueIds<T> =
  T extends GenericId<infer _T>
    ? string
    : T extends (infer U)[]
      ? OpaqueIds<U>[]
      : T extends ArrayBuffer
        ? ArrayBuffer
        : T extends object
          ? { [K in keyof T]: OpaqueIds<T[K]> }
          : T;

export type UseApi<API> = Expand<{
  [mod in keyof API]: API[mod] extends FunctionReference<
    infer FType,
    "public",
    infer FArgs,
    infer FReturnType,
    infer FComponentPath
  >
    ? FunctionReference<
        FType,
        "internal",
        OpaqueIds<FArgs>,
        OpaqueIds<FReturnType>,
        FComponentPath
      >
    : UseApi<API[mod]>;
}>;
