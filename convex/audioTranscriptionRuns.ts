import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";

export const getTranscriptionRunsByWorkspace = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const runs = await ctx.db
      .query("audioTranscriptionRuns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(args.limit ?? 50);
    return runs;
  },
});

export const getTranscriptionRunByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return null;
    return await ctx.db
      .query("audioTranscriptionRuns")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .order("desc")
      .first();
  },
});

export const createTranscriptionRun = internalMutation({
  args: {
    model: v.string(),
    inputFileName: v.optional(v.string()),
    inputMimeType: v.optional(v.string()),
    inputFileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const runId = await ctx.db.insert("audioTranscriptionRuns", {
      ...args,
      workspaceId,
      status: "pending",
      startedAt: Date.now(),
    });
    return runId as Id<"audioTranscriptionRuns">;
  },
});

export const markTranscriptionRunRunning = internalMutation({
  args: { runId: v.id("audioTranscriptionRuns") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, { status: "running" });
  },
});

export const markTranscriptionRunSucceeded = internalMutation({
  args: {
    runId: v.id("audioTranscriptionRuns"),
    callId: v.id("calls"),
    transcriptId: v.id("transcripts"),
    transcriptCharCount: v.number(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== workspaceId) throw new Error("Run not found");
    await ctx.db.patch(args.runId, {
      status: "succeeded",
      callId: args.callId,
      transcriptId: args.transcriptId,
      transcriptCharCount: args.transcriptCharCount,
      latencyMs: args.latencyMs,
      completedAt: Date.now(),
    });
  },
});

export const markTranscriptionRunFailed = internalMutation({
  args: {
    runId: v.id("audioTranscriptionRuns"),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
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

function sanitizeErrorMessage(message: string | null | undefined): string | undefined {
  if (!message) return undefined;
  let cleaned = message;
  cleaned = cleaned.replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]");
  cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]");
  if (cleaned.length > 1000) cleaned = cleaned.slice(0, 1000) + "...";
  return cleaned;
}
