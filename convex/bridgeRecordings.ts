import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { isTerminalVoxandraCallStatus } from "../src/lib/twilio/bridge-lifecycle";

function assertServerSecret(secret: string) {
  const expected = process.env.TWILIO_CONVEX_WEBHOOK_SECRET;
  if (!expected || secret !== expected) throw new Error("Twilio bridge access denied");
}

const bridgeLeg = v.union(v.literal("parent"), v.literal("callee"));

export const claimBridgeRecording = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    leg: bridgeLeg,
    providerCallSid: v.string(),
    startedAt: v.number(),
    callbackUrl: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call || call.callMode !== "human_twilio_bridge") throw new Error("Bridge call not found");
    const expectedSid = args.leg === "parent" ? call.parentCallSid : call.bridgeCalleeCallSid;
    if (!expectedSid || expectedSid !== args.providerCallSid) throw new Error("Bridge leg mismatch");

    const existing = await ctx.db
      .query("bridgeCallRecordings")
      .withIndex("by_call_leg", (q) => q.eq("callId", args.callId).eq("leg", args.leg))
      .first();
    if (existing) return { recordingId: existing._id, shouldStart: false };
    if (call.endedAt || isTerminalVoxandraCallStatus(call.status) || call.aiCaptureEnabled === false) {
      return { shouldStart: false };
    }

    const now = Date.now();
    const recordingId = await ctx.db.insert("bridgeCallRecordings", {
      workspaceId: call.workspaceId,
      callId: call._id,
      leg: args.leg,
      providerCallSid: args.providerCallSid,
      startedAt: args.startedAt,
      status: "requested",
      deleteStatus: "not_ready",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.twilioLifecycle.startBridgeRecording, {
      recordingId,
      callbackUrl: args.callbackUrl,
    });
    return { recordingId, shouldStart: true };
  },
});

export const getBridgeRecordingStartContext = internalQuery({
  args: { recordingId: v.id("bridgeCallRecordings") },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording || recording.status !== "requested") return null;
    const call = await ctx.db.get(recording.callId);
    const expectedSid = recording.leg === "parent" ? call?.parentCallSid : call?.bridgeCalleeCallSid;
    return {
      providerCallSid: recording.providerCallSid,
      canStart: Boolean(call && !call.endedAt && !isTerminalVoxandraCallStatus(call.status) &&
        call.aiCaptureEnabled !== false && expectedSid === recording.providerCallSid),
    };
  },
});

export const markBridgeRecordingStarted = internalMutation({
  args: {
    recordingId: v.id("bridgeCallRecordings"),
    recordingSid: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording || recording.status !== "requested") return;
    await ctx.db.patch(recording._id, {
      recordingSid: args.recordingSid,
      startedAt: args.startedAt,
      status: "recording",
      deleteStatus: "pending",
      updatedAt: Date.now(),
    });
  },
});

export const failBridgeRecordingStart = internalMutation({
  args: { recordingId: v.id("bridgeCallRecordings") },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording || recording.status !== "requested") return { updated: false };
    await ctx.db.patch(recording._id, { status: "failed", updatedAt: Date.now() });
    const call = await ctx.db.get(recording.callId);
    if (call && !call.transcriptId) {
      await ctx.db.patch(call._id, {
        bridgeRecordCompleteness: "partial",
        highlights: ["Partial translated Call Record: one participant recording was unavailable"],
      });
    }
    return { updated: true };
  },
});

export const recordBridgeRecordingCallback = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    leg: bridgeLeg,
    recordingSid: v.string(),
    recordingUrl: v.string(),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call || call.callMode !== "human_twilio_bridge") throw new Error("Bridge call not found");
    const recording = await ctx.db
      .query("bridgeCallRecordings")
      .withIndex("by_call_leg", (q) => q.eq("callId", args.callId).eq("leg", args.leg))
      .first();
    if (!recording) throw new Error("Bridge recording was not claimed");

    await ctx.db.patch(recording._id, {
      recordingSid: args.recordingSid,
      recordingUrl: args.recordingUrl,
      durationSeconds: args.durationSeconds,
      status: "ready",
      deleteStatus: "pending",
      updatedAt: Date.now(),
    });

    const sibling = await ctx.db
      .query("bridgeCallRecordings")
      .withIndex("by_call_leg", (q) =>
        q.eq("callId", args.callId).eq("leg", args.leg === "parent" ? "callee" : "parent")
      )
      .first();
    if (sibling?.status === "ready") {
      await ctx.db.patch(recording._id, { status: "processing", updatedAt: Date.now() });
      await ctx.db.patch(sibling._id, { status: "processing", updatedAt: Date.now() });
      await ctx.db.patch(call._id, { processingStatus: "transcribing", bridgeRecordCompleteness: "complete" });
      await ctx.scheduler.runAfter(0, internal.bridgeTranscription.transcribeBridgeCall, {
        callId: call._id,
      });
      return { scheduled: true };
    }

    await ctx.scheduler.runAfter(90_000, internal.bridgeRecordings.finalizeBridgeRecordingSet, {
      callId: call._id,
    });

    return { scheduled: false };
  },
});

export const finalizeBridgeRecordingSet = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || call.transcriptId) return { scheduled: false };
    const rows = await ctx.db.query("bridgeCallRecordings").withIndex("by_call", (q) => q.eq("callId", args.callId)).collect();
    const ready = rows.filter((row) => row.status === "ready");
    if (rows.some((row) => row.status === "processing")) return { scheduled: false };
    if (ready.length === 0) {
      if (call.endedAt || isTerminalVoxandraCallStatus(call.status)) {
        await ctx.db.patch(call._id, {
          processingStatus: "transcription_failed",
          bridgeRecordCompleteness: "partial",
          highlights: ["Translated Call Record unavailable: participant recordings were not received"],
        });
      }
      return { scheduled: false };
    }
    for (const row of ready) await ctx.db.patch(row._id, { status: "processing", updatedAt: Date.now() });
    await ctx.db.patch(call._id, { processingStatus: "transcribing", bridgeRecordCompleteness: ready.length === 2 ? "complete" : "partial" });
    await ctx.scheduler.runAfter(0, internal.bridgeTranscription.transcribeBridgeCall, { callId: call._id });
    return { scheduled: true, partial: ready.length < 2 };
  },
});
