import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";

export const getShadowRunsByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("shadowAgentRuns")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .order("desc")
      .collect();
  },
});

export const createShadowRun = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    transcriptId: v.optional(v.id("transcripts")),
    promptVersion: v.string(),
    model: v.string(),
    inputCharCount: v.number(),
  },
  handler: async (ctx, args) => {
    const runId = await ctx.db.insert("shadowAgentRuns", {
      ...args,
      status: "pending",
      startedAt: Date.now(),
    });
    return runId as Id<"shadowAgentRuns">;
  },
});

export const markShadowRunRunning = internalMutation({
  args: { runId: v.id("shadowAgentRuns"), workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== args.workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, { status: "running" });
  },
});

export const markShadowRunSucceeded = internalMutation({
  args: {
    runId: v.id("shadowAgentRuns"),
    workspaceId: v.id("workspaces"),
    agentRunEventId: v.optional(v.id("agentRunEvents")),
    outputCharCount: v.optional(v.number()),
    tokenUsage: v.optional(
      v.object({
        prompt_tokens: v.optional(v.number()),
        completion_tokens: v.optional(v.number()),
        total_tokens: v.optional(v.number()),
      })
    ),
    estimatedCostUsd: v.optional(v.number()),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== args.workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, {
      status: "succeeded",
      agentRunEventId: args.agentRunEventId,
      outputCharCount: args.outputCharCount,
      tokenUsage: args.tokenUsage,
      estimatedCostUsd: args.estimatedCostUsd,
      latencyMs: args.latencyMs,
      completedAt: Date.now(),
    });
  },
});

export const markShadowRunFailed = internalMutation({
  args: {
    runId: v.id("shadowAgentRuns"),
    workspaceId: v.id("workspaces"),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== args.workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, {
      status: "failed",
      errorCode: args.errorCode,
      errorMessage: sanitizeErrorMessage(args.errorMessage),
      latencyMs: args.latencyMs,
      completedAt: Date.now(),
    });
  },
});

export const markShadowRunValidationFailed = internalMutation({
  args: {
    runId: v.id("shadowAgentRuns"),
    workspaceId: v.id("workspaces"),
    validationErrors: v.array(v.string()),
    outputCharCount: v.optional(v.number()),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== args.workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, {
      status: "validation_failed",
      validationErrors: args.validationErrors,
      outputCharCount: args.outputCharCount,
      latencyMs: args.latencyMs,
      completedAt: Date.now(),
    });
  },
});

function sanitizeErrorMessage(message: string | null | undefined): string | undefined {
  if (!message) return undefined;
  // Strip potential API keys or secrets from error messages
  let cleaned = message;
  cleaned = cleaned.replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]");
  cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]");
  if (cleaned.length > 1000) cleaned = cleaned.slice(0, 1000) + "...";
  return cleaned;
}
