import { parse } from "convex-helpers/validators";
import type { Validator, Infer } from "convex/values";

export const assertExhaustive = (value: never): never => {
  throw new Error(`Unhandled event type: ${value as string}`);
};

export const iife = <T>(fn: () => T): T => fn();

/**
 * Generic function to attempt parsing with proper TypeScript type narrowing
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attemptToParse<T extends Validator<any, any, any>>(
  validator: T,
  value: unknown
): { kind: "success"; data: Infer<T> } | { kind: "error"; error: unknown } {
  try {
    return {
      kind: "success",
      data: parse(validator, value),
    };
  } catch (error) {
    return {
      kind: "error",
      error,
    };
  }
}
