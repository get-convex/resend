export const assertExhaustive = (value: never): never => {
  throw new Error(`Unhandled event type: ${value as string}`);
};

export const iife = <T>(fn: () => T): T => fn();
