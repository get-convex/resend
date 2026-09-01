# Changelog

## 0.2.8

- Added an optional `idempotencyKey` to `sendEmail` for enqueue-time dedupe: a
  duplicate enqueue with the same key returns the existing `EmailId` instead of
  sending twice (#107).

## 0.2.7

- Bumps Workpool dependency and convex peer dependency

## 0.2.6

- forward message_id from Resend webhook payloads to onEmailEvent (#101)

## 0.2.5

- Support ActionCtx in public API methods (#98)

## 0.2.4

- Fixed an issue in `resend.sendEmailManually` where the `cc` and `bcc` fields
  would not be persisted to the database (thanks @zxt-tzx!)

## 0.2.3

- Fixed example code for destructuring resendSDK's response
- Fixed receiving webhooks responses for emails if you only use the manual
  method

## 0.2.2

- Improved confusing docs which didn't have correct usage for the resendSdk.

## 0.2.1

- Support for templates and template variables.
- Allows passing multiple recipients in to/cc/bcc.

## 0.2.0

- Adds /test and /\_generated/component.js entrypoints
- Drops commonjs support
- Improves source mapping for generated files
- Changes to a statically generated component API
