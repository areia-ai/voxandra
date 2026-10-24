import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";

export const getExtractedEntitiesByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("extractedEntities")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
  },
});

export const getExtractedEntitiesByCaseId = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const caseItem = await ctx.db.get(args.caseId);
    if (!caseItem || caseItem.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("extractedEntities")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
  },
});

export const deleteEntitiesByCallId = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    const entities = await ctx.db
      .query("extractedEntities")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const entity of entities) {
      await ctx.db.delete(entity._id);
    }
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);
  },
});

export const createExtractedEntity = mutation({
  args: {
    callId: v.id("calls"),
    caseId: v.optional(v.id("cases")),
    type: v.string(),
    label: v.string(),
    value: v.string(),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const entityId = await ctx.db.insert("extractedEntities", {
      workspaceId,
      ...args,
    });
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);
    return entityId;
  },
});
