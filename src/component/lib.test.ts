import { expect, describe, it, beforeEach } from "vitest";
import { api } from "./_generated/api.js";
import type { EmailEvent } from "./shared.js";
import {
  createTestDeliveredEvent,
  insertTestSentEmail,
  setupTest,
  setupTestLastOptions,
  type Tester,
} from "./setup.test.js";
import { type Id } from "./_generated/dataModel.js";

describe("handleEmailEvent", () => {
  let t: Tester;
  let event: EmailEvent;
  let sentEmailId: Id<"emails">;

  beforeEach(async () => {
    t = setupTest();
    event = createTestDeliveredEvent();
    await setupTestLastOptions(t);
    sentEmailId = await insertTestSentEmail(t);
  });

  const exec = (_event = event) =>
    t.mutation(api.lib.handleEmailEvent, { event: _event });

  it("works", async () => {
    await exec();

    const updatedEmail = await t.run(async (ctx) => ctx.db.get(sentEmailId));
    expect(updatedEmail).toBeTruthy();
    expect(updatedEmail?.status).toBe("delivered");
    expect(updatedEmail?.finalizedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(updatedEmail?.finalizedAt).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
  });
});
