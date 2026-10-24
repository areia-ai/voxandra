import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { isTerminalVoxandraCallStatus } from "../src/lib/twilio/bridge-lifecycle";
import { requireWorkspace, requireWorkspaceMembership } from "./authHelpers";
import { shouldApplyBridgeDisclosureState } from "../src/lib/live-bridge-state";

const realtimeRuntimeModeValidator = v.union(
  v.literal("human_copilot"),
  v.literal("translated_captions"),
  v.literal("translated_audio_private"),
  v.literal("translated_audio_bridge"),
  v.literal("agent_shadow"),
  v.literal("agent_assisted"),
  v.literal("agent_autonomous")
);

const agentMissionModeValidator = v.union(
  v.literal("agent_shadow"),
  v.literal("agent_assisted"),
  v.literal("agent_autonomous")
);

const realtimeSessionStatusValidator = v.union(
  v.literal("requested"),
  v.literal("starting"),
  v.literal("active"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled")
);

const speakerRoleValidator = v.union(
  v.literal("caller"),
  v.literal("representative"),
  v.literal("voxandra_user"),
  v.literal("agent"),
  v.literal("unknown")
);

const audioTrackValidator = v.union(
  v.literal("inbound"),
  v.literal("outbound"),
  v.literal("both"),
  v.literal("browser"),
  v.literal("agent"),
  v.literal("unknown")
);

const utteranceSourceValidator = v.union(
  v.literal("realtime_transcription"),
  v.literal("post_call_transcription"),
  v.literal("translation_input"),
  v.literal("agent_generated"),
  v.literal("worker")
);

const translationDirectionValidator = v.union(
  v.literal("caller_to_user"),
  v.literal("user_to_caller"),
  v.literal("listen_along"),
  v.literal("unknown")
);

const translationAudioModeValidator = v.union(
  v.literal("caption_only"),
  v.literal("private_audio"),
  v.literal("bridged_audio")
);

const agentRunEventTypeValidator = v.union(
  v.literal("observation"),
  v.literal("prediction"),
  v.literal("tool_call_requested"),
  v.literal("tool_call_result"),
  v.literal("guardrail"),
  v.literal("handoff"),
  v.literal("approval_requested"),
  v.literal("approval_decision"),
  v.literal("summary"),
  v.literal("error")
);

const agentRunEventStatusValidator = v.union(
  v.literal("recorded"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("failed")
);

const approvalActionTypeValidator = v.union(
  v.literal("place_call"),
  v.literal("send_message"),
  v.literal("spend_money"),
  v.literal("update_record"),
  v.literal("share_sensitive_data"),
  v.literal("external_contact"),
  v.literal("tool_call"),
  v.literal("other")
);

const riskLevelValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high")
);

// Privacy-safe per-segment stage timings from the media worker. Mirrors the
// translationSegments.stageTimings validator in schema.ts.
const translationStageTimingsValidator = v.object({
  speechToFirstSourceDeltaMs: v.optional(v.number()),
  commitToFirstSourceDeltaMs: v.optional(v.number()),
  speechToTranslationMs: v.optional(v.number()),
  utteranceEndToTranslationMs: v.optional(v.number()),
  translationRequestMs: v.optional(v.number()),
  providerElapsedMs: v.optional(v.number()),
});

function assertRealtimeWorkerSecret(secret: string) {
  const expectedSecret = process.env.REALTIME_CONVEX_WORKER_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    throw new Error("Realtime worker access denied");
  }
}

function sanitizeOperationalError(value: string | undefined) {
  if (!value) return undefined;
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .slice(0, 1000);
}

async function assertWorkspaceExists(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  return workspace;
}

async function assertCallAccess(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  callId: Id<"calls">
) {
  const call = await ctx.db.get(callId);
  if (!call || call.workspaceId !== workspaceId) {
    throw new Error("Call not found");
  }
  return call;
}

async function assertRealtimeSessionAccess(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  realtimeSessionId: Id<"realtimeSessions">
) {
  const session = await ctx.db.get(realtimeSessionId);
  if (!session || session.workspaceId !== workspaceId) {
    throw new Error("Realtime session not found");
  }
  return session;
}

export async function createRequestedRealtimeSession(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    callId: Id<"calls">;
    mode:
      | "human_copilot"
      | "translated_captions"
      | "translated_audio_private"
      | "translated_audio_bridge"
      | "agent_shadow"
      | "agent_assisted"
      | "agent_autonomous";
    provider: string;
    requestedByUserId?: string;
    requestedByProfileId?: Id<"profiles">;
    model?: string;
    inputLanguage?: string;
    targetLanguage?: string;
    now: number;
  }
) {
  return await ctx.db.insert("realtimeSessions", {
    workspaceId: args.workspaceId,
    callId: args.callId,
    mode: args.mode,
    provider: args.provider,
    status: "requested",
    requestedByUserId: args.requestedByUserId,
    requestedByProfileId: args.requestedByProfileId,
    model: args.model,
    inputLanguage: args.inputLanguage,
    targetLanguage: args.targetLanguage,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export const listRealtimeSessionsForCall = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];

    const sessions = await ctx.db
      .query("realtimeSessions")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();

    return sessions.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const listCallUtterances = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];

    const utterances = await ctx.db
      .query("callUtterances")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();

    return utterances.sort((a, b) => {
      const aSequence = a.sequence ?? Number.MAX_SAFE_INTEGER;
      const bSequence = b.sequence ?? Number.MAX_SAFE_INTEGER;
      if (aSequence !== bSequence) return aSequence - bSequence;
      return a.createdAt - b.createdAt;
    });
  },
});

const LIVE_TRANSLATION_SEGMENT_LIMIT = 32;

export const listTranslationSegments = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];

    // Newest segments only, so live-caption updates stay constant-size instead
    // of re-sending every segment of a long call on each worker write.
    const segments = await ctx.db
      .query("translationSegments")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .order("desc")
      .take(LIVE_TRANSLATION_SEGMENT_LIMIT);

    return segments.sort((a, b) => a.createdAt - b.createdAt);
  },
});

// Second half of the worker's stream authentication (the first half is the
// HMAC signature over the Media Stream parameters, verified inside the worker
// against REALTIME_STREAM_SIGNING_SECRET). A valid signature proves the
// parameters were minted by our TwiML routes within the last few minutes; this
// proves the socket presenting them is the Twilio call those parameters were
// minted for, by checking the Twilio CallSid Twilio itself reports in the
// `start` event against the SID Convex recorded when the call was placed.
// Together they close forgery AND replay of a captured parameter set.
//
// Returns a plain result instead of throwing so the worker can log a precise
// reason: thrown errors are redacted to "Server Error" in worker logs.
export const validateWorkerStreamStart = query({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    workspaceId: v.id("workspaces"),
    providerCallSid: v.string(),
    legRole: v.union(v.literal("browser"), v.literal("callee")),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call) return { ok: false as const, reason: "call_not_found" as const };
    if (call.workspaceId !== args.workspaceId) {
      return { ok: false as const, reason: "workspace_mismatch" as const };
    }
    const expectedSids =
      args.legRole === "callee"
        ? [call.bridgeCalleeCallSid]
        : [call.parentCallSid, call.providerCallSid];
    if (!expectedSids.filter(Boolean).includes(args.providerCallSid)) {
      return { ok: false as const, reason: "call_sid_mismatch" as const };
    }
    return { ok: true as const };
  },
});

// The callee leg's disclosure lifecycle lives entirely inside the worker (it
// is a queue of PCM draining into a Twilio socket), so this is the only way
// the dialer can learn when the caller should wait and when to start talking.
export const updateBridgeDisclosureStateFromWorker = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    state: v.union(
      v.literal("pending"),
      v.literal("playing"),
      v.literal("readying"),
      v.literal("failed"),
      v.literal("done"),
      v.literal("skipped")
    ),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call) throw new Error("Call not found");
    if (!call.bridgeModeRequested || !shouldApplyBridgeDisclosureState(call.bridgeDisclosureState, args.state) ||
      (args.state !== "failed" && (call.endedAt || isTerminalVoxandraCallStatus(call.status)))) return { ok: true };
    await ctx.db.patch(args.callId, { bridgeDisclosureState: args.state });
    return { ok: true };
  },
});

// Either Palabra direction failing mid-call degrades the whole bridge to a
// plain full-volume phone call (see degradeBridgeToPlainCall in the worker).
// Recorded once so the dialer can say translation stopped rather than keep
// showing "Translating live" over an untranslated conversation.
export const markBridgeTranslationDegradedFromWorker = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    legRole: v.union(v.literal("browser"), v.literal("callee")),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call) throw new Error("Call not found");
    if (call.bridgeTranslationDegradedAt === undefined) {
      await ctx.db.patch(args.callId, { bridgeTranslationDegradedAt: Date.now() });
    }
    return { ok: true };
  },
});

export const syncBridgeInactivityFromWorker = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    providerCallSid: v.string(),
    lastActivityAt: v.number(),
    endIfIdle: v.boolean(),
    durationLimitReached: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call?.bridgeModeRequested || call.parentCallSid !== args.providerCallSid) {
      throw new Error("Bridge call access denied");
    }
    const now = Date.now();
    const lastActivityAt = Math.min(now, Math.max(
      Number.isFinite(args.lastActivityAt) ? args.lastActivityAt : now,
      call.bridgeLastActivityAt ?? 0,
      call.bridgeKeepConnectedAt ?? 0
    ));
    if (call.endedAt || call.bridgeEndReason || isTerminalVoxandraCallStatus(call.status)) {
      return { ended: true, lastActivityAt };
    }
    const deadline = lastActivityAt + 180_000;
    const endReason = args.durationLimitReached ? "duration_limit" as const
      : args.endIfIdle && now >= deadline ? "inactivity" as const : undefined;
    await ctx.db.patch(call._id, {
      bridgeLastActivityAt: lastActivityAt,
      bridgeInactivityDeadlineAt: !endReason && now >= lastActivityAt + 120_000 ? deadline : undefined,
      ...(endReason ? { bridgeEndReason: endReason } : {}),
    });
    if (endReason) {
      for (const callSid of [call.parentCallSid, call.bridgeCalleeCallSid]) {
        if (callSid) await ctx.scheduler.runAfter(0, internal.twilioLifecycle.terminateProviderCall, {
          callSid,
          reason: `bridge_${endReason}`,
        });
      }
    }
    return { ended: Boolean(endReason), lastActivityAt };
  },
});

export const markRealtimeSessionActiveFromWorker = mutation({
  args: {
    secret: v.string(),
    realtimeSessionId: v.id("realtimeSessions"),
    providerSessionId: v.optional(v.string()),
    providerStreamSid: v.optional(v.string()),
    providerCallSid: v.optional(v.string()),
    model: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    pipeline: v.optional(v.string()),
    workerBuild: v.optional(v.string()),
    configFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    const session = await ctx.db.get(args.realtimeSessionId);
    if (!session) {
      throw new Error("Realtime session not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.realtimeSessionId, {
      status: "active",
      providerSessionId: args.providerSessionId ?? session.providerSessionId,
      providerStreamSid: args.providerStreamSid ?? session.providerStreamSid,
      providerCallSid: args.providerCallSid ?? session.providerCallSid,
      model: args.model ?? session.model,
      startedAt: args.startedAt ?? session.startedAt ?? now,
      pipeline: args.pipeline ?? session.pipeline,
      workerBuild: args.workerBuild ?? session.workerBuild,
      configFingerprint: args.configFingerprint ?? session.configFingerprint,
      updatedAt: now,
    });

    return { realtimeSessionId: args.realtimeSessionId };
  },
});

export const createRealtimeSessionFromWorker = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    mode: realtimeRuntimeModeValidator,
    provider: v.string(),
    status: realtimeSessionStatusValidator,
    providerSessionId: v.optional(v.string()),
    providerStreamSid: v.optional(v.string()),
    providerCallSid: v.optional(v.string()),
    model: v.optional(v.string()),
    inputLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    await assertWorkspaceExists(ctx, args.workspaceId);
    if (args.callId) {
      await assertCallAccess(ctx, args.workspaceId, args.callId);
    }

    const now = Date.now();
    const realtimeSessionId = await ctx.db.insert("realtimeSessions", {
      workspaceId: args.workspaceId,
      callId: args.callId,
      mode: args.mode,
      provider: args.provider,
      status: args.status,
      providerSessionId: args.providerSessionId,
      providerStreamSid: args.providerStreamSid,
      providerCallSid: args.providerCallSid,
      model: args.model,
      inputLanguage: args.inputLanguage,
      targetLanguage: args.targetLanguage,
      startedAt:
        args.startedAt ??
        (args.status === "active" ? now : undefined),
      createdAt: now,
      updatedAt: now,
    });

    return { realtimeSessionId };
  },
});

export const finishRealtimeSessionFromWorker = mutation({
  args: {
    secret: v.string(),
    realtimeSessionId: v.id("realtimeSessions"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    durationSeconds: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    guidanceMetrics: v.optional(
      v.object({
        decisions: v.number(),
        emitted: v.number(),
        noops: v.number(),
        deduplicated: v.number(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        cachedTokens: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    const session = await ctx.db.get(args.realtimeSessionId);
    if (!session) {
      throw new Error("Realtime session not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.realtimeSessionId, {
      status: args.status,
      durationSeconds: args.durationSeconds,
      endedAt: args.endedAt ?? now,
      errorCode: args.errorCode,
      errorMessage: sanitizeOperationalError(args.errorMessage),
      guidanceMetrics: args.guidanceMetrics,
      updatedAt: now,
    });

    return { realtimeSessionId: args.realtimeSessionId };
  },
});

export const recordCallUtteranceFromWorker = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    speakerLabel: v.string(),
    speakerRole: v.optional(speakerRoleValidator),
    track: v.optional(audioTrackValidator),
    language: v.optional(v.string()),
    text: v.string(),
    confidence: v.optional(v.number()),
    source: utteranceSourceValidator,
    startSeconds: v.optional(v.number()),
    endSeconds: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    sequence: v.optional(v.number()),
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    const call = await ctx.db.get(args.callId);
    if (!call) {
      throw new Error("Call not found");
    }
    if (args.realtimeSessionId) {
      await assertRealtimeSessionAccess(ctx, call.workspaceId, args.realtimeSessionId);
    }

    const utteranceId = await ctx.db.insert("callUtterances", {
      workspaceId: call.workspaceId,
      callId: args.callId,
      realtimeSessionId: args.realtimeSessionId,
      speakerLabel: args.speakerLabel,
      speakerRole: args.speakerRole,
      track: args.track,
      language: args.language,
      text: args.text,
      confidence: args.confidence,
      source: args.source,
      startSeconds: args.startSeconds,
      endSeconds: args.endSeconds,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      sequence: args.sequence,
      isFinal: args.isFinal,
      createdAt: Date.now(),
    });

    return { utteranceId };
  },
});

export const recordTranslationSegmentFromWorker = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    sourceUtteranceId: v.optional(v.id("callUtterances")),
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.string(),
    sourceText: v.string(),
    translatedText: v.string(),
    direction: translationDirectionValidator,
    audioMode: translationAudioModeValidator,
    audioStored: v.optional(v.boolean()),
    latencyMs: v.optional(v.number()),
    firstAudioLatencyMs: v.optional(v.number()),
    model: v.optional(v.string()),
    confidence: v.optional(v.number()),
    pipeline: v.optional(v.string()),
    stageTimings: v.optional(translationStageTimingsValidator),
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    const call = await ctx.db.get(args.callId);
    if (!call) {
      throw new Error("Call not found");
    }
    if (args.realtimeSessionId) {
      await assertRealtimeSessionAccess(ctx, call.workspaceId, args.realtimeSessionId);
    }
    if (args.sourceUtteranceId) {
      const utterance = await ctx.db.get(args.sourceUtteranceId);
      if (
        !utterance ||
        utterance.workspaceId !== call.workspaceId ||
        utterance.callId !== args.callId
      ) {
        throw new Error("Source utterance not found");
      }
    }

    const segmentId = await ctx.db.insert("translationSegments", {
      workspaceId: call.workspaceId,
      callId: args.callId,
      realtimeSessionId: args.realtimeSessionId,
      sourceUtteranceId: args.sourceUtteranceId,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      sourceText: args.sourceText,
      translatedText: args.translatedText,
      direction: args.direction,
      audioMode: args.audioMode,
      audioStored: args.audioStored ?? false,
      latencyMs: args.latencyMs,
      firstAudioLatencyMs: args.firstAudioLatencyMs,
      model: args.model,
      confidence: args.confidence,
      pipeline: args.pipeline,
      stageTimings: args.stageTimings,
      isFinal: args.isFinal,
      createdAt: Date.now(),
    });

    return { segmentId };
  },
});

export const updateTranslationSegmentFromWorker = mutation({
  args: {
    secret: v.string(),
    segmentId: v.id("translationSegments"),
    sourceText: v.string(),
    translatedText: v.string(),
    latencyMs: v.optional(v.number()),
    firstAudioLatencyMs: v.optional(v.number()),
    confidence: v.optional(v.number()),
    stageTimings: v.optional(translationStageTimingsValidator),
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    const segment = await ctx.db.get(args.segmentId);
    if (!segment) {
      throw new Error("Translation segment not found");
    }
    const call = await ctx.db.get(segment.callId);
    if (!call) {
      throw new Error("Call not found");
    }
    if (segment.realtimeSessionId) {
      await assertRealtimeSessionAccess(ctx, call.workspaceId, segment.realtimeSessionId);
    }

    await ctx.db.patch(args.segmentId, {
      sourceText: args.sourceText,
      translatedText: args.translatedText,
      latencyMs: args.latencyMs,
      firstAudioLatencyMs: args.firstAudioLatencyMs,
      confidence: args.confidence,
      ...(args.stageTimings ? { stageTimings: args.stageTimings } : {}),
      isFinal: args.isFinal,
    });

    return { segmentId: args.segmentId };
  },
});

export const recordAgentRunEventFromWorker = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    agentMissionId: v.optional(v.id("agentMissions")),
    mode: v.optional(agentMissionModeValidator),
    eventType: agentRunEventTypeValidator,
    status: agentRunEventStatusValidator,
    title: v.optional(v.string()),
    detail: v.optional(v.string()),
    toolName: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    riskLevel: v.optional(riskLevelValidator),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    await assertWorkspaceExists(ctx, args.workspaceId);
    if (args.callId) {
      await assertCallAccess(ctx, args.workspaceId, args.callId);
    }
    if (args.realtimeSessionId) {
      await assertRealtimeSessionAccess(ctx, args.workspaceId, args.realtimeSessionId);
    }
    if (args.agentMissionId) {
      const mission = await ctx.db.get(args.agentMissionId);
      if (!mission || mission.workspaceId !== args.workspaceId) {
        throw new Error("Agent mission not found");
      }
    }

    const eventId = await ctx.db.insert("agentRunEvents", {
      workspaceId: args.workspaceId,
      callId: args.callId,
      realtimeSessionId: args.realtimeSessionId,
      agentMissionId: args.agentMissionId,
      mode: args.mode,
      eventType: args.eventType,
      status: args.status,
      title: args.title,
      detail: args.detail,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      riskLevel: args.riskLevel,
      createdAt: Date.now(),
    });

    return { eventId };
  },
});

// Internal sibling of recordAgentRunEventFromWorker for server-side runtimes
// (e.g. the shadow agent) that run inside Convex scheduled functions and so
// never hold the realtime worker secret. internal.* functions are unreachable
// from clients, so no secret check is needed here.
export const recordAgentRunEventInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    agentMissionId: v.optional(v.id("agentMissions")),
    mode: v.optional(agentMissionModeValidator),
    eventType: agentRunEventTypeValidator,
    status: agentRunEventStatusValidator,
    title: v.optional(v.string()),
    detail: v.optional(v.string()),
    toolName: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    riskLevel: v.optional(riskLevelValidator),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceExists(ctx, args.workspaceId);
    if (args.callId) {
      await assertCallAccess(ctx, args.workspaceId, args.callId);
    }
    if (args.realtimeSessionId) {
      await assertRealtimeSessionAccess(ctx, args.workspaceId, args.realtimeSessionId);
    }
    if (args.agentMissionId) {
      const mission = await ctx.db.get(args.agentMissionId);
      if (!mission || mission.workspaceId !== args.workspaceId) {
        throw new Error("Agent mission not found");
      }
    }

    const eventId = await ctx.db.insert("agentRunEvents", {
      workspaceId: args.workspaceId,
      callId: args.callId,
      realtimeSessionId: args.realtimeSessionId,
      agentMissionId: args.agentMissionId,
      mode: args.mode,
      eventType: args.eventType,
      status: args.status,
      title: args.title,
      detail: args.detail,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      riskLevel: args.riskLevel,
      createdAt: Date.now(),
    });

    return { eventId };
  },
});

export const createApprovalRequestFromWorker = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    agentMissionId: v.optional(v.id("agentMissions")),
    agentRunEventId: v.optional(v.id("agentRunEvents")),
    actionType: approvalActionTypeValidator,
    title: v.string(),
    summary: v.string(),
    evidence: v.optional(v.string()),
    proposedToolName: v.optional(v.string()),
    proposedArgumentsSummary: v.optional(v.string()),
    riskLevel: riskLevelValidator,
    estimatedCostCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    await assertWorkspaceExists(ctx, args.workspaceId);
    if (args.callId) {
      await assertCallAccess(ctx, args.workspaceId, args.callId);
    }
    if (args.agentMissionId) {
      const mission = await ctx.db.get(args.agentMissionId);
      if (!mission || mission.workspaceId !== args.workspaceId) {
        throw new Error("Agent mission not found");
      }
    }
    if (args.agentRunEventId) {
      const event = await ctx.db.get(args.agentRunEventId);
      if (!event || event.workspaceId !== args.workspaceId) {
        throw new Error("Agent run event not found");
      }
    }

    const now = Date.now();
    const approvalRequestId = await ctx.db.insert("approvalRequests", {
      workspaceId: args.workspaceId,
      callId: args.callId,
      agentMissionId: args.agentMissionId,
      agentRunEventId: args.agentRunEventId,
      actionType: args.actionType,
      title: args.title,
      summary: args.summary,
      evidence: args.evidence,
      proposedToolName: args.proposedToolName,
      proposedArgumentsSummary: args.proposedArgumentsSummary,
      riskLevel: args.riskLevel,
      estimatedCostCents: args.estimatedCostCents,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return { approvalRequestId };
  },
});

export const createAgentMissionDraft = mutation({
  args: {
    objective: v.string(),
    mode: agentMissionModeValidator,
    targetPhoneNumber: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    language: v.optional(v.string()),
    allowedTools: v.array(v.string()),
    maxSpendCents: v.optional(v.number()),
    maxDurationSeconds: v.optional(v.number()),
    escalationPolicy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId, profile } = await requireWorkspaceMembership(ctx);

    if (args.contactId) {
      const contact = await ctx.db.get(args.contactId);
      if (!contact || contact.workspaceId !== workspaceId) {
        throw new Error("Contact not found");
      }
    }
    if (args.caseId) {
      const caseItem = await ctx.db.get(args.caseId);
      if (!caseItem || caseItem.workspaceId !== workspaceId) {
        throw new Error("Work thread not found");
      }
    }

    const now = Date.now();
    const missionId = await ctx.db.insert("agentMissions", {
      workspaceId,
      createdByUserId: userId,
      createdByProfileId: profile._id,
      mode: args.mode,
      status: "draft",
      objective: args.objective,
      targetPhoneNumber: args.targetPhoneNumber,
      contactId: args.contactId,
      caseId: args.caseId,
      language: args.language,
      allowedTools: args.allowedTools,
      maxSpendCents: args.maxSpendCents,
      maxDurationSeconds: args.maxDurationSeconds,
      escalationPolicy: args.escalationPolicy,
      approvalPolicy: "always_require_external_actions",
      createdAt: now,
      updatedAt: now,
    });

    return { missionId };
  },
});

export const listAgentMissions = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const missions = await ctx.db
      .query("agentMissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    return missions.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listPendingApprovalRequests = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const requests = await ctx.db
      .query("approvalRequests")
      .withIndex("by_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "pending")
      )
      .collect();

    return requests.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const decideApprovalRequest = mutation({
  args: {
    approvalRequestId: v.id("approvalRequests"),
    status: v.union(v.literal("approved"), v.literal("denied")),
    decisionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId } = await requireWorkspaceMembership(ctx);
    const request = await ctx.db.get(args.approvalRequestId);
    if (!request || request.workspaceId !== workspaceId) {
      throw new Error("Approval request not found");
    }
    if (request.status !== "pending") {
      throw new Error("Approval request is no longer pending");
    }

    const now = Date.now();
    await ctx.db.patch(args.approvalRequestId, {
      status: args.status,
      decidedByUserId: userId,
      decisionReason: args.decisionReason,
      decidedAt: now,
      updatedAt: now,
    });

    return { approvalRequestId: args.approvalRequestId, status: args.status };
  },
});
