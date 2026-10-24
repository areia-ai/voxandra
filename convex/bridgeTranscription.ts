"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";
import { transcribeWithFallbacks, type TranscriptSegment } from "../src/lib/server/openai-transcription";
import { deleteRecordingFromTwilio } from "./twilioRecordings";

async function downloadRecording(url: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const headers: Record<string, string> = {};
  if (accountSid && authToken) headers.Authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Bridge recording download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function words(value: string) {
  return new Set(value.toLocaleLowerCase().match(/\p{L}+/gu) ?? []);
}

function overlapScore(a: string, b: string) {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export const deleteBridgeRecording = internalAction({
  args: { recordingId: v.id("bridgeCallRecordings"), recordingSid: v.string(), attempt: v.number() },
  handler: async (ctx, args) => {
    try {
      await deleteRecordingFromTwilio(args.recordingSid);
      await ctx.runMutation(internal.bridgeTranscriptionMutations.markBridgeRecordingDeleted, { recordingId: args.recordingId });
    } catch (error) {
      if (args.attempt < 3) {
        await ctx.scheduler.runAfter(10_000, internal.bridgeTranscription.deleteBridgeRecording, { ...args, attempt: args.attempt + 1 });
      } else {
        await ctx.runMutation(internal.bridgeTranscriptionMutations.markBridgeRecordingDeleteFailed, { recordingId: args.recordingId, error: error instanceof Error ? error.message : "Recording deletion failed" });
      }
    }
  },
});

export const transcribeBridgeCall = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.bridgeTranscriptionMutations.getBridgeTranscriptionContext, { callId: args.callId });
    if (!context) throw new Error("Bridge call not found");
    const parent = context.recordings.find((row) => row.leg === "parent");
    const callee = context.recordings.find((row) => row.leg === "callee");
    const rows = [parent, callee].filter((row): row is NonNullable<typeof row> => Boolean(row));

    try {
      if (!parent?.recordingUrl && !callee?.recordingUrl) throw new Error("No bridge recording is available");
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API key is not configured");
      const openai = new OpenAI({ apiKey });
      const available = [
        parent?.recordingUrl ? { row: parent, speaker: "A", language: context.call.translatedCaptionsTargetLanguage, name: "operator.wav" } : null,
        callee?.recordingUrl ? { row: callee, speaker: "B", language: context.call.translatedCaptionsSourceLanguage, name: "other-party.wav" } : null,
      ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const transcribed = await Promise.all(available.map(async (entry) => {
        const audio = await downloadRecording(entry.row.recordingUrl!);
        const result = await transcribeWithFallbacks({ openai, file: new File([new Uint8Array(audio)], entry.name, { type: "audio/wav" }), models: ["gpt-4o-transcribe-diarize"] });
        return { ...entry, result };
      }));
      const origin = Math.min(...available.map((entry) => entry.row.startedAt));
      const usedTranslationIds = new Set<string>();
      const labelled = transcribed.flatMap(({ result, row, speaker, language }) => {
        const offset = Math.max(0, (row.startedAt - origin) / 1000);
        const direction = speaker === "A" ? "user_to_caller" : "caller_to_user";
        const candidates = context.translationSegments.filter((segment) => segment.isFinal && segment.direction === direction && segment.translatedText.trim());
        return result.segments.map((segment): TranscriptSegment & { originalText: string; translatedText?: string; language?: string } => {
          const match = candidates
            .filter((candidate) => !usedTranslationIds.has(String(candidate._id)))
            .map((candidate) => ({ candidate, score: overlapScore(segment.text, candidate.sourceText) }))
            .sort((a, b) => b.score - a.score)[0];
          if (match && match.score >= 0.25) usedTranslationIds.add(String(match.candidate._id));
          return {
            speaker,
            text: match && match.score >= 0.25 ? match.candidate.translatedText : segment.text,
            originalText: segment.text,
            translatedText: match && match.score >= 0.25 ? match.candidate.translatedText : undefined,
            language,
            start: segment.start === undefined ? undefined : segment.start + offset,
            end: segment.end === undefined ? undefined : segment.end + offset,
          };
        });
      }).filter((segment) => segment.text.trim()).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
      const text = labelled.map((segment) => `${segment.speaker}: ${segment.text.trim()}`).join("\n");
      if (!text.trim()) throw new Error("Bridge transcript is empty");
      const callRecordLanguage = context.call.callRecordLanguage ?? context.call.translatedCaptionsTargetLanguage ?? "en";
      await ctx.runMutation(internal.transcriptionMutations.storeTranscriptAndExtract, {
        callId: args.callId,
        text,
        language: "multilingual",
        duration: Math.max(...available.map((entry) => entry.row.durationSeconds ?? 0)),
        segments: labelled,
        transcriptionModel: "gpt-4o-transcribe-diarize",
        transcriptionAttemptCount: transcribed.reduce((sum, entry) => sum + entry.result.attemptCount, 0),
        speakerAttribution: "channel",
        callRecordLanguage,
        callRecordLanguageSource: context.call.callRecordLanguage ? "explicit" : "operator_audio",
      });
      if (available.length < 2) {
        await ctx.runMutation(internal.bridgeTranscriptionMutations.markBridgeRecordPartial, { callId: args.callId });
      }
      await ctx.runMutation(internal.bridgeTranscriptionMutations.markBridgeRecordingsProcessed, { callId: args.callId });
    } catch (error) {
      await ctx.runMutation(internal.bridgeTranscriptionMutations.markBridgeTranscriptionFailed, { callId: args.callId });
      throw error;
    } finally {
      for (const row of rows) {
        if (row.recordingSid) await ctx.scheduler.runAfter(0, internal.bridgeTranscription.deleteBridgeRecording, { recordingId: row._id, recordingSid: row.recordingSid, attempt: 1 });
      }
    }
  },
});
