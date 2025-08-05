/// <reference types="vite/client" />

import { test } from "vitest";

export const modules = import.meta.glob("./**/*.*s");
export { componentSchema };
export const componentModules = import.meta.glob("../component/**/*.ts");

import { type UsedAPI } from "./index.js";
import { componentsGeneric } from "convex/server";
import componentSchema from "../component/schema.js";

export const components = componentsGeneric() as unknown as {
  resend: UsedAPI;
};

test("setup", () => {});
