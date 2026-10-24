import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";
import {
  buildRealtimeUsageSummary,
  recordRealtimeUsageEvent,
} from "./realtimeBilling";

const realtimeFeatureValidator = v.union(
  v.literal("live_copilot"),
  v.literal("translated_captions"),
  v.literal("translated_audio")
);

export const getRealtimeUsageSummary = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    return await buildRealtimeUsageSummary(ctx, workspaceId);
  },
});

export const recordRealtimeUsage = mutation({
  args: {
    callId: v.optional(v.id("calls")),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    feature: realtimeFeatureValidator,
    durationSeconds: v.number(),
    model: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const eventId = await recordRealtimeUsageEvent(ctx, {
      workspaceId,
      callId: args.callId,
      realtimeSessionId: args.realtimeSessionId,
      feature: args.feature,
      durationSeconds: args.durationSeconds,
      model: args.model,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
    });
    return {
      eventId,
      summary: await buildRealtimeUsageSummary(ctx, workspaceId),
    };
  },
});

export const recordRealtimeUsageFromWorker = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    feature: realtimeFeatureValidator,
    durationSeconds: v.number(),
    model: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const expectedSecret = process.env.REALTIME_CONVEX_WORKER_SECRET;
    if (!expectedSecret || args.secret !== expectedSecret) {
      throw new Error("Realtime worker access denied");
    }

    return await recordRealtimeUsageEvent(ctx, {
      workspaceId: args.workspaceId,
      callId: args.callId,
      realtimeSessionId: args.realtimeSessionId,
      feature: args.feature,
      durationSeconds: args.durationSeconds,
      model: args.model,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
    });
  },
});
