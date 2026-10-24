import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";
import { refreshLearningExamplesForCall } from "./agentLearning";

export const getActionItems = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    return await ctx.db
      .query("actionItems")
      .withIndex("by_status", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const getActionItemsByCaseId = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const caseItem = await ctx.db.get(args.caseId);
    if (!caseItem || caseItem.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("actionItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
  },
});

export const getActionItemsByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("actionItems")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
  },
});

export const markActionItemComplete = mutation({
  args: { actionItemId: v.id("actionItems") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const item = await ctx.db.get(args.actionItemId);
    if (!item || item.workspaceId !== workspaceId) throw new Error("Action item not found");
    await ctx.db.patch(args.actionItemId, { status: "completed" });
    if (item.callId) {
      await refreshCallMemorySearchDocsForCall(ctx, item.callId);
      await refreshLearningExamplesForCall(ctx, item.callId);
    }

    if (item?.caseId) {
      const caseItem = await ctx.db.get(item.caseId);
      if (caseItem) {
        await ctx.db.patch(item.caseId, {
          unresolvedActionItemIds: caseItem.unresolvedActionItemIds.filter(
            (id) => id !== args.actionItemId
          ),
        });
      }
    }
  },
});

export const createActionItem = mutation({
  args: {
    callId: v.optional(v.id("calls")),
    caseId: v.optional(v.id("cases")),
    title: v.string(),
    description: v.string(),
    dueAt: v.optional(v.string()),
    status: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const actionItemId = await ctx.db.insert("actionItems", {
      workspaceId,
      ...args,
    });
    if (args.callId) {
      await refreshCallMemorySearchDocsForCall(ctx, args.callId);
    }
    return actionItemId;
  },
});

export const updateActionItem = mutation({
  args: {
    actionItemId: v.id("actionItems"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    dueAt: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const item = await ctx.db.get(args.actionItemId);
    if (!item || item.workspaceId !== workspaceId) throw new Error("Action item not found");
    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.dueAt !== undefined) updates.dueAt = args.dueAt;
    if (args.status !== undefined) updates.status = args.status;
    await ctx.db.patch(args.actionItemId, updates);
    if (item.callId) {
      await refreshCallMemorySearchDocsForCall(ctx, item.callId);
      if (args.status !== undefined && args.status !== item.status) {
        await refreshLearningExamplesForCall(ctx, item.callId);
      }
    }
  },
});

export const deleteActionItemsByCallId = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    const items = await ctx.db
      .query("actionItems")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);
  },
});
