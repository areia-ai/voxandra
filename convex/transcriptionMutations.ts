import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

function sanitizeRecordingDeleteError(message: string) {
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/AC[0-9a-fA-F]{32}/g, "[account]")
    .replace(/RE[0-9a-fA-F]{32}/g, "[recording]")
    .slice(0, 300);
}

export const getOperatorLanguageContext = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return null;
    const operatorUtterances = await ctx.db
      .query("callUtterances")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    return {
      callDirection: call.callDirection,
      inboundVoicemail: call.inboundVoicemail,
      callRecordLanguagePreference: call.callRecordLanguagePreference,
      operatorLanguages: operatorUtterances
        .filter((utterance) => utterance.speakerRole === "voxandra_user" && utterance.isFinal)
        .map((utterance) => utterance.language)
        .filter((language): language is string => Boolean(language)),
      operatorText: operatorUtterances
        .filter((utterance) => utterance.speakerRole === "voxandra_user" && utterance.isFinal)
        .sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt))
        .map((utterance) => utterance.text.trim())
        .filter(Boolean)
        .join("\n"),
    };
  },
});

export const storeTranscriptAndExtract = internalMutation({
  args: {
    callId: v.id("calls"),
    text: v.string(),
    language: v.string(),
    duration: v.number(),
    segments: v.optional(v.array(v.object({
      speaker: v.string(),
      text: v.string(),
      originalText: v.optional(v.string()),
      translatedText: v.optional(v.string()),
      language: v.optional(v.string()),
      start: v.optional(v.number()),
      end: v.optional(v.number()),
    }))),
    transcriptionModel: v.optional(v.string()),
    transcriptionFallbackFrom: v.optional(v.string()),
    transcriptionAttemptCount: v.optional(v.number()),
    speakerAttribution: v.optional(
      v.union(v.literal("channel"), v.literal("diarization"))
    ),
    callRecordLanguage: v.string(),
    callRecordLanguageSource: v.union(
      v.literal("explicit"),
      v.literal("operator_audio"),
      v.literal("operator_realtime"),
      v.literal("fallback"),
      v.literal("legacy_transcript")
    ),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new Error("Call not found");

    // Store transcript
    const transcriptId = await ctx.db.insert("transcripts", {
      workspaceId: call.workspaceId,
      callId: args.callId,
      source: "provider_transcript_future",
      text: args.text,
      language: args.language,
      confidence: 1.0,
      segments: args.segments && args.segments.length > 0
        ? args.segments
        : [{ speaker: "combined", text: args.text }],
      transcriptionModel: args.transcriptionModel,
      transcriptionFallbackFrom: args.transcriptionFallbackFrom,
      transcriptionAttemptCount: args.transcriptionAttemptCount,
      speakerAttribution: args.speakerAttribution,
      transcriptionProvider: "openai",
    });

    // Update call
    await ctx.db.patch(args.callId, {
      transcriptId,
      processingStatus: "extracting",
      callRecordLanguage: args.callRecordLanguage,
      callRecordLanguageSource: args.callRecordLanguageSource,
      language: args.callRecordLanguage,
    });

    // Check if AI features are enabled for this workspace
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", call.workspaceId))
      .first();

    if (wallet?.aiFeaturesEnabled !== false) {
      // Trigger AI extraction using the existing pipeline
      await ctx.scheduler.runAfter(0, internal.aiExtraction.extractFromRecording, {
        transcriptText: args.text,
        existingCallId: args.callId,
        phoneNumber: call.dialedNumber,
        existingContactId: call.contactId,
        existingCaseId: call.caseId,
        context: call.userNotes,
        language: args.language,
        callRecordLanguage: args.callRecordLanguage,
      });
      // Shadow Agent v1: observation-only prediction, scored at review time.
      await ctx.scheduler.runAfter(0, internal.shadowAgent.runShadowPrediction, {
        callId: args.callId,
        transcriptText: args.text,
        language: args.callRecordLanguage,
      });
    } else {
      // AI not enabled — mark as completed without extraction
      await ctx.db.patch(args.callId, {
        processingStatus: "completed",
        aiMemoryReady: false,
        reviewPending: false,
      });
    }

    return { transcriptId };
  },
});

export const markTranscriptionFailed = internalMutation({
  args: {
    callId: v.id("calls"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new Error("Call not found");
    await ctx.db.patch(args.callId, {
      processingStatus: "transcription_failed",
      highlights: ["Transcription failed"],
    });
  },
});

export const markRecordingDeleted = internalMutation({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new Error("Call not found");

    await ctx.db.patch(args.callId, {
      recordingUrl: undefined,
      recordingDeleteStatus: "deleted",
      recordingDeletedAt: Date.now(),
      recordingDeleteError: undefined,
    });
  },
});

export const markRecordingDeleteFailed = internalMutation({
  args: {
    callId: v.id("calls"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new Error("Call not found");

    await ctx.db.patch(args.callId, {
      recordingUrl: undefined,
      recordingDeleteStatus: "failed",
      recordingDeleteError: sanitizeRecordingDeleteError(args.errorMessage),
    });
  },
});
