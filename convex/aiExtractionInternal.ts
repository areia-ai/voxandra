import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getCallWorkspace = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    return call
      ? {
          workspaceId: call.workspaceId,
          workflowTemplateKey: call.workflowTemplateKey,
          objective: call.objective,
          contactId: call.contactId,
          caseId: call.caseId,
          callRecordLanguage: call.callRecordLanguage,
          callRecordLanguageSource: call.callRecordLanguageSource,
        }
      : null;
  },
});

export const getTranscriptByCallIdInternal = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const transcript = await ctx.db
      .query("transcripts")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    return transcript ? { _id: transcript._id } : null;
  },
});

export const getCasesByWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cases")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const getContactsByWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});
