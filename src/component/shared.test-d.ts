import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { RunMutationCtx, RunQueryCtx } from "./shared.js";

// Regression test for the ctx helper types: runQuery/runMutation on
// query/mutation ctxs gained an extra optional options argument in convex
// 1.41.0 that action ctxs don't have, which broke passing an action ctx to
// e.g. resend.sendEmail. Hand-rolling the minimal signature per method keeps
// every ctx variant assignable. Plain assignments (rather than expectTypeOf)
// because they exercise the exact relation used at real call sites.
declare const queryCtx: GenericQueryCtx<GenericDataModel>;
declare const mutationCtx: GenericMutationCtx<GenericDataModel>;
declare const actionCtx: GenericActionCtx<GenericDataModel>;

export const queryCtxRunsQueries: RunQueryCtx = queryCtx;
export const mutationCtxRunsQueries: RunQueryCtx = mutationCtx;
export const actionCtxRunsQueries: RunQueryCtx = actionCtx;

export const mutationCtxRunsMutations: RunMutationCtx = mutationCtx;
export const actionCtxRunsMutations: RunMutationCtx = actionCtx;
