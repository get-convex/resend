import { describe, test } from "vitest";
import { componentSchema, componentModules, modules } from "./setup.test.js";
import { defineSchema } from "convex/server";
import { convexTest } from "convex-test";

const schema = defineSchema({});

function setupTest() {
  const t = convexTest(schema, modules);
  t.registerComponent("resend", componentSchema, componentModules);
  return { t };
}

type ConvexTest = ReturnType<typeof setupTest>["t"];

describe("Resend", () => {
  test("handleResendEventWebhook", async () => {});
});
