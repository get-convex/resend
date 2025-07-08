import { convexTest } from "convex-test";
import { test } from "vitest";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

test("test", async () => {
  convexTest(schema, modules);
});
