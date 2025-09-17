import { describe, it, expect } from "vitest";
import { isValidResendTestEmail } from "./utils.js";

describe("isValidResendTestEmail", () => {
  it("allows valid test emails without labels", () => {
    expect(isValidResendTestEmail("delivered@resend.dev")).toBe(true);
    expect(isValidResendTestEmail("bounced@resend.dev")).toBe(true);
    expect(isValidResendTestEmail("complained@resend.dev")).toBe(true);
  });

  it("allows valid test emails with labels", () => {
    expect(isValidResendTestEmail("delivered+user-1@resend.dev")).toBe(true);
    expect(isValidResendTestEmail("delivered+foo-bar@resend.dev")).toBe(true);
    expect(
      isValidResendTestEmail("bounced+user-pw-reset-test@resend.dev")
    ).toBe(true);
    expect(
      isValidResendTestEmail("complained+account-reset_test1@resend.dev")
    ).toBe(true);
    expect(isValidResendTestEmail("complained+@resend.dev")).toBe(true);
    expect(isValidResendTestEmail("complained+COMPLAINED@resend.dev")).toBe(
      true
    );
  });

  it("rejects invalid test emails with or without labels", () => {
    expect(isValidResendTestEmail("foobar@resend.dev")).toBe(false);
    expect(isValidResendTestEmail("bazfoo+user@resend.dev")).toBe(false);
    expect(isValidResendTestEmail("delivered@resended.dev")).toBe(false);
  });

  it("rejects test emails with disallowed special characters in the label", () => {
    expect(isValidResendTestEmail("delivered+foo.bar@resend.dev")).toBe(false);
    expect(isValidResendTestEmail("bounced+user/1@resend.dev")).toBe(false);
    expect(isValidResendTestEmail("bounced+user$1@resend.dev")).toBe(false);
  });
});
