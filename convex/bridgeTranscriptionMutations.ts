import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getBridgeTranscriptionContext = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || call.callMode !== "human_twilio_bridge") return null;
    const recordings = await ctx.db
      .query("bridgeCallRecordings")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    const translationSegments = await ctx.db
      .query("translationSegments")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    return { call, recordings, translationSegments };
  },
});

export const markBridgeRecordingsProcessed = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("bridgeCallRecordings").withIndex("by_call", (q) => q.eq("callId", args.callId)).collect();
    for (const row of rows) await ctx.db.patch(row._id, { status: "processed", updatedAt: Date.now() });
  },
});

export const markBridgeRecordPartial = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return;
    await ctx.db.patch(call._id, {
      bridgeRecordCompleteness: "partial",
      highlights: ["Partial translated Call Record: one participant recording was unavailable"],
    });
  },
});

export const markBridgeTranscriptionFailed = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (call) await ctx.db.patch(call._id, { processingStatus: "transcription_failed", highlights: ["Translated Call Record processing failed"] });
    const rows = await ctx.db.query("bridgeCallRecordings").withIndex("by_call", (q) => q.eq("callId", args.callId)).collect();
    for (const row of rows) await ctx.db.patch(row._id, { status: "failed", updatedAt: Date.now() });
  },
});

export const markBridgeRecordingDeleted = internalMutation({
  args: { recordingId: v.id("bridgeCallRecordings") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recordingId);
    if (!row) return;
    await ctx.db.patch(row._id, { recordingUrl: undefined, deleteStatus: "deleted", deleteError: undefined, updatedAt: Date.now() });
  },
});

export const markBridgeRecordingDeleteFailed = internalMutation({
  args: { recordingId: v.id("bridgeCallRecordings"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recordingId);
    if (!row) return;
    await ctx.db.patch(row._id, { recordingUrl: undefined, deleteStatus: "failed", deleteError: args.error.slice(0, 300), updatedAt: Date.now() });
  },
});
