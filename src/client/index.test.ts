import { beforeEach, describe, expect, test } from "vitest";
import {
  components,
  componentSchema,
  componentModules,
  modules,
} from "./setup.test.js";
import { defineSchema } from "convex/server";
import { convexTest } from "convex-test";
import { type EmailId, Resend } from "./index.js";

const schema = defineSchema({});

function setupTest() {
  const t = convexTest(schema, modules);
  t.registerComponent("resend", componentSchema, componentModules);
  const resend = new Resend(components.resend, {});
  return { t, resend };
}

type ConvexTest = ReturnType<typeof setupTest>["t"];

describe("TableAggregate", () => {
  describe("status", () => {
    let t: ConvexTest;
    let resend: Resend;

    beforeEach(() => {
      ({ resend, t } = setupTest());
    });

    const exec = async () => {
      return await t.run(async (ctx) => {
        return await resend.status(ctx, "123" as EmailId);
      });
    };

    test("should count zero items in empty table", async () => {
      const result = await exec();
      expect(result).toBe(0);
    });
  });
});
