import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";
import { upsertLearningExampleForCall } from "./agentLearning";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";

export const getAIMemoryByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return null;
    return await ctx.db
      .query("aiMemories")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
  },
});

export const getAIMemoriesByCaseId = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const caseItem = await ctx.db.get(args.caseId);
    if (!caseItem || caseItem.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("aiMemories")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
  },
});

export const updateAIMemory = mutation({
  args: {
    memoryId: v.id("aiMemories"),
    summary: v.optional(v.string()),
    reviewStatus: v.optional(v.string()),
    caseId: v.optional(v.id("cases")),
    requiredDocuments: v.optional(v.array(v.string())),
    highlights: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory || memory.workspaceId !== workspaceId) throw new Error("Memory not found");
    const updates: Record<string, unknown> = {};
    if (args.summary !== undefined) updates.summary = args.summary;
    if (args.reviewStatus !== undefined) updates.reviewStatus = args.reviewStatus;
    if (args.caseId !== undefined) updates.caseId = args.caseId;
    if (args.requiredDocuments !== undefined) updates.requiredDocuments = args.requiredDocuments;
    if (args.highlights !== undefined) updates.highlights = args.highlights;
    await ctx.db.patch(args.memoryId, updates);
    const nextReviewStatus = args.reviewStatus ?? memory.reviewStatus;
    if (nextReviewStatus === "accepted") {
      await upsertLearningExampleForCall(ctx, memory.callId, "memory_updated");
    }
    await refreshCallMemorySearchDocsForCall(ctx, memory.callId);
  },
});

export const updateAIMemoryParticipants = mutation({
  args: {
    memoryId: v.id("aiMemories"),
    participants: v.object({
      caller: v.object({
        name: v.union(v.string(), v.null()),
        roleLabel: v.string(),
        confidence: v.number(),
        evidence: v.union(v.string(), v.null()),
      }),
      representative: v.object({
        name: v.union(v.string(), v.null()),
        roleLabel: v.string(),
        confidence: v.number(),
        institutionName: v.union(v.string(), v.null()),
        evidence: v.union(v.string(), v.null()),
      }),
      institution: v.object({
        name: v.union(v.string(), v.null()),
        type: v.string(),
        confidence: v.number(),
        evidence: v.union(v.string(), v.null()),
      }),
      subject: v.object({
        name: v.union(v.string(), v.null()),
        subjectType: v.string(),
        confidence: v.number(),
        evidence: v.union(v.string(), v.null()),
      }),
    }),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory || memory.workspaceId !== workspaceId) throw new Error("Memory not found");
    await ctx.db.patch(args.memoryId, { participants: args.participants });
    if (memory.reviewStatus === "accepted") {
      await upsertLearningExampleForCall(ctx, memory.callId, "memory_updated");
    }
    await refreshCallMemorySearchDocsForCall(ctx, memory.callId);
  },
});
