import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";

export const getExtractionRunsByWorkspace = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const runs = await ctx.db
      .query("aiExtractionRuns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(args.limit ?? 50);
    return runs;
  },
});

export const getExtractionRunById = query({
  args: { runId: v.id("aiExtractionRuns") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== workspaceId) return null;
    return run;
  },
});

export const getExtractionRunsByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("aiExtractionRuns")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .order("desc")
      .collect();
  },
});

export const getLatestExtractionRunByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return null;
    return await ctx.db
      .query("aiExtractionRuns")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .order("desc")
      .first();
  },
});

export const createExtractionRun = internalMutation({
  args: {
    callId: v.optional(v.id("calls")),
    transcriptId: v.optional(v.id("transcripts")),
    source: v.union(
      v.literal("imported_transcript"),
      v.literal("simulated_future"),
      v.literal("provider_transcript_future")
    ),
    promptVersion: v.string(),
    model: v.string(),
    inputCharCount: v.number(),
    transcriptCharCount: v.number(),
    retryOfRunId: v.optional(v.id("aiExtractionRuns")),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const runId = await ctx.db.insert("aiExtractionRuns", {
      callId: args.callId,
      transcriptId: args.transcriptId,
      source: args.source,
      promptVersion: args.promptVersion,
      model: args.model,
      inputCharCount: args.inputCharCount,
      transcriptCharCount: args.transcriptCharCount,
      retryOfRunId: args.retryOfRunId,
      workspaceId,
      status: "pending",
      startedAt: Date.now(),
    });
    return runId as Id<"aiExtractionRuns">;
  },
});

export const markExtractionRunRunning = internalMutation({
  args: { runId: v.id("aiExtractionRuns"), workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, { status: "running" });
  },
});

export const markExtractionRunSucceeded = internalMutation({
  args: {
    runId: v.id("aiExtractionRuns"),
    reviewSuggestionId: v.optional(v.id("reviewSuggestions")),
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
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, {
      status: "succeeded",
      reviewSuggestionId: args.reviewSuggestionId,
      outputCharCount: args.outputCharCount,
      tokenUsage: args.tokenUsage,
      estimatedCostUsd: args.estimatedCostUsd,
      latencyMs: args.latencyMs,
      completedAt: Date.now(),
    });
  },
});

export const markExtractionRunFailed = internalMutation({
  args: {
    runId: v.id("aiExtractionRuns"),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    latencyMs: v.number(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, {
      status: "failed",
      errorCode: args.errorCode,
      errorMessage: sanitizeErrorMessage(args.errorMessage),
      latencyMs: args.latencyMs,
      completedAt: Date.now(),
    });
  },
});

export const markExtractionRunValidationFailed = internalMutation({
  args: {
    runId: v.id("aiExtractionRuns"),
    validationErrors: v.array(v.string()),
    outputCharCount: v.optional(v.number()),
    latencyMs: v.number(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== workspaceId) throw new Error("Run not found");
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
