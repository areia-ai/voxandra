"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import {
  inferTranscriptLanguage,
  resolveTranscriptLanguage,
  transcribeDualChannel,
  transcribeWithFallbacks,
  type TranscriptionResult,
} from "../src/lib/server/openai-transcription";
import {
  DEFAULT_CALL_RECORD_LANGUAGE,
  normalizeCallRecordLanguage,
} from "../src/lib/call-record-languages";
import { extractWavChannel } from "../src/lib/server/wav-channel";
import { deleteRecordingFromTwilio } from "./twilioRecordings";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const MAX_RECORDING_SIZE_MB = 25;
const RECORDING_DELETE_MAX_ATTEMPTS = 3;
const RECORDING_DELETE_RETRY_DELAY_MS = 10_000;

async function downloadRecording(url: string, requestedChannels?: number): Promise<Buffer> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  const headers: Record<string, string> = {};
  if (accountSid && authToken) {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }

  const recordingUrl = new URL(url);
  if (requestedChannels) recordingUrl.searchParams.set("RequestedChannels", String(requestedChannels));
  const response = await fetch(recordingUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

type CallRecordLanguageSource =
  | "explicit"
  | "operator_audio"
  | "operator_realtime"
  | "fallback"
  | "legacy_transcript";

async function resolveCallRecordLanguage(args: {
  openai: OpenAI;
  audioBuffer: Buffer;
  recordingChannels?: number;
  transcriptLanguage?: string;
  transcriptText: string;
  context: {
    callDirection?: string;
    inboundVoicemail?: boolean;
    callRecordLanguagePreference?: string;
    operatorLanguages: string[];
    operatorText: string;
  };
}): Promise<{ language: string; source: CallRecordLanguageSource }> {
  if (!args.context.callRecordLanguagePreference) {
    return {
      language: resolveTranscriptLanguage(args.transcriptLanguage, args.transcriptText),
      source: "legacy_transcript",
    };
  }
  const preference = args.context.callRecordLanguagePreference;
  const explicitLanguage = normalizeCallRecordLanguage(preference);
  if (explicitLanguage) return { language: explicitLanguage, source: "explicit" };

  const realtimeLanguages = args.context.operatorLanguages
    .map(normalizeCallRecordLanguage)
    .filter((language): language is NonNullable<typeof language> => Boolean(language));
  const uniqueRealtimeLanguages = [...new Set(realtimeLanguages)];
  const realtimeLanguage =
    uniqueRealtimeLanguages.length === 1
      ? uniqueRealtimeLanguages[0]
      : inferTranscriptLanguage(args.context.operatorText);
  if (realtimeLanguage) {
    return { language: realtimeLanguage, source: "operator_realtime" };
  }

  if (args.recordingChannels === 2 && !args.context.inboundVoicemail) {
    try {
      const operatorChannel = args.context.callDirection === "inbound" ? 1 : 0;
      const operatorAudio = extractWavChannel(args.audioBuffer, operatorChannel);
      // gpt-transcribe, not whisper-1: this single call decides the whole call
      // record's language, and whisper-1 was the least accurate model available
      // for it (40.37% vs 19.27% Common Voice error across 22 languages).
      // gpt-transcribe is also cheaper, so there is no trade here.
      const operatorTranscription = await transcribeWithFallbacks({
        openai: args.openai,
        file: new File([new Uint8Array(operatorAudio)], "operator.wav", { type: "audio/wav" }),
        models: ["gpt-transcribe"],
      });
      const detected =
        normalizeCallRecordLanguage(operatorTranscription.language) ??
        inferTranscriptLanguage(operatorTranscription.text);
      if (detected) return { language: detected, source: "operator_audio" };
    } catch (error) {
      console.warn("[Transcription] Operator language detection failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { language: DEFAULT_CALL_RECORD_LANGUAGE, source: "fallback" };
}

async function scheduleRecordingDeletion(
  ctx: ActionCtx,
  args: {
    callId: Id<"calls">;
    recordingSid?: string;
  }
) {
  if (!args.recordingSid) {
    await ctx.runMutation(internal.transcriptionMutations.markRecordingDeleteFailed, {
      callId: args.callId,
      errorMessage: "Twilio recording SID missing.",
    });
    return;
  }

  await ctx.scheduler.runAfter(0, internal.transcription.deleteTwilioRecording, {
    callId: args.callId,
    recordingSid: args.recordingSid,
    attempt: 1,
  });
}

export const transcribeRecording = internalAction({
  args: {
    callId: v.id("calls"),
    recordingUrl: v.string(),
    recordingDuration: v.optional(v.number()),
    recordingSid: v.optional(v.string()),
    recordingChannels: v.optional(v.number()),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY;
    const retryCount = args.retryCount ?? 0;

    if (!apiKey) {
      await ctx.runMutation(internal.transcriptionMutations.markTranscriptionFailed, {
        callId: args.callId,
        errorMessage: "OpenAI API key is not configured.",
      });
      await scheduleRecordingDeletion(ctx, {
        callId: args.callId,
        recordingSid: args.recordingSid,
      });
      throw new Error("OpenAI API key is not configured.");
    }

    console.log("[Transcription] Starting", {
      callId: args.callId,
      recordingDuration: args.recordingDuration,
      retryCount,
    });

    try {
      const operatorLanguageContext = await ctx.runQuery(
        internal.transcriptionMutations.getOperatorLanguageContext,
        { callId: args.callId }
      );
      if (!operatorLanguageContext) throw new Error("Call not found");

      // Dual-channel recordings preserve direction only while this action runs.
      const requestedChannels = args.recordingChannels === 2 ? 2 : undefined;
      const audioBuffer = await downloadRecording(args.recordingUrl, requestedChannels);

      if (audioBuffer.length > MAX_RECORDING_SIZE_MB * 1024 * 1024) {
        throw new Error(`Recording too large: ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB (max ${MAX_RECORDING_SIZE_MB}MB)`);
      }

      // Send to OpenAI transcription models with model-aware fallbacks.
      const openai = new OpenAI({ apiKey });

      // Prefer per-channel transcription when Twilio gave us both legs: the
      // channel says which side spoke, so speaker attribution is ground truth
      // instead of model diarization, which can merge or split speakers. Skipped
      // for voicemail, which has only one real speaker and nothing to attribute.
      // Any failure falls through to the single-pass diarized path below.
      let transcription: TranscriptionResult | null = null;
      if (args.recordingChannels === 2 && !operatorLanguageContext.inboundVoicemail) {
        try {
          const operatorChannel =
            operatorLanguageContext.callDirection === "inbound" ? 1 : 0;
          transcription = await transcribeDualChannel({
            openai,
            operatorAudio: extractWavChannel(audioBuffer, operatorChannel),
            otherPartyAudio: extractWavChannel(audioBuffer, operatorChannel === 0 ? 1 : 0),
          });
          if (!transcription) {
            // The most likely failure mode, not the rarest: transcribeDualChannel
            // returns null whenever either channel fails, timestamps are absent,
            // or the merge is empty. Without this line a permanently broken
            // per-channel path would look identical to a working one, since the
            // single-pass fallback still produces a good transcript.
            console.warn(
              "[Transcription] Dual-channel produced no usable merge; using single pass",
              { callId: args.callId, operatorChannel }
            );
          }
        } catch (error) {
          console.warn("[Transcription] Dual-channel transcription failed; using single pass", {
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Recorded so "what fraction of calls got ground-truth attribution?" is a
      // query rather than a guess. Raw audio is not retained, so per-channel
      // behaviour can only ever be observed live, on real calls.
      const speakerAttribution = transcription ? "channel" : "diarization";

      if (!transcription) {
        transcription = await transcribeWithFallbacks({
          openai,
          file: new File([new Uint8Array(audioBuffer)], "recording.wav", { type: "audio/wav" }),
        });
      }

      const text = transcription.text;
      const language = resolveTranscriptLanguage(transcription.language, transcription.text);
      const duration = transcription.duration;
      const callRecordLanguage = await resolveCallRecordLanguage({
        openai,
        audioBuffer,
        recordingChannels: args.recordingChannels,
        transcriptLanguage: transcription.language,
        transcriptText: transcription.text,
        context: operatorLanguageContext,
      });

      if (!text || text.trim().length < 2) {
        throw new Error("Transcript is empty or too short.");
      }

      console.log("[Transcription] Completed", {
        callId: args.callId,
        textLength: text.length,
        language,
        duration,
        model: transcription.model,
        fallbackFrom: transcription.fallbackFrom,
        attemptCount: transcription.attemptCount,
      });

      // Store transcript and trigger AI extraction
      await ctx.runMutation(internal.transcriptionMutations.storeTranscriptAndExtract, {
        callId: args.callId,
        text,
        language,
        duration: duration ?? args.recordingDuration ?? 0,
        segments: transcription.segments,
        transcriptionModel: transcription.model,
        transcriptionFallbackFrom: transcription.fallbackFrom,
        transcriptionAttemptCount: transcription.attemptCount,
        speakerAttribution,
        callRecordLanguage: callRecordLanguage.language,
        callRecordLanguageSource: callRecordLanguage.source,
      });

      await scheduleRecordingDeletion(ctx, {
        callId: args.callId,
        recordingSid: args.recordingSid,
      });

      return { success: true, textLength: text.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed";
      console.error("[Transcription] Failed", { callId: args.callId, message, retryCount });

      if (retryCount < 1) {
        await ctx.scheduler.runAfter(5000, internal.transcription.transcribeRecording, {
          callId: args.callId,
          recordingUrl: args.recordingUrl,
          recordingDuration: args.recordingDuration,
          recordingSid: args.recordingSid,
          recordingChannels: args.recordingChannels,
          retryCount: retryCount + 1,
        });
        throw new Error(`Transcription failed, will retry: ${message}`);
      } else {
        await ctx.runMutation(internal.transcriptionMutations.markTranscriptionFailed, {
          callId: args.callId,
          errorMessage: message,
        });
        await scheduleRecordingDeletion(ctx, {
          callId: args.callId,
          recordingSid: args.recordingSid,
        });
        throw new Error(`Transcription failed after retry: ${message}`);
      }
    }
  },
});

export const deleteTwilioRecording = internalAction({
  args: {
    callId: v.id("calls"),
    recordingSid: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      await deleteRecordingFromTwilio(args.recordingSid);
      await ctx.runMutation(internal.transcriptionMutations.markRecordingDeleted, {
        callId: args.callId,
      });
      return { deleted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Twilio recording deletion failed.";
      if (args.attempt < RECORDING_DELETE_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          RECORDING_DELETE_RETRY_DELAY_MS,
          internal.transcription.deleteTwilioRecording,
          {
            callId: args.callId,
            recordingSid: args.recordingSid,
            attempt: args.attempt + 1,
          }
        );
        return { deleted: false, retrying: true };
      }

      await ctx.runMutation(internal.transcriptionMutations.markRecordingDeleteFailed, {
        callId: args.callId,
        errorMessage: message,
      });
      return { deleted: false, retrying: false };
    }
  },
});
