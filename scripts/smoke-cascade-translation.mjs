import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import {
  buildWorkerConfig,
  defaultTranslationRequester,
} from "./realtime-media-worker-core.mjs";

const audioPath = process.argv[2];
const sourceLanguage = process.argv[3] || "es";
const targetLanguage = process.argv[4] || "en";
const config = buildWorkerConfig(process.env);

if (!audioPath) {
  throw new Error(
    "Usage: node scripts/smoke-cascade-translation.mjs <24khz-mono-pcm16-file> [source-language] [target-language]"
  );
}
if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required.");

const audio = await readFile(audioPath);
if (!audio.length || audio.length % 2 !== 0) {
  throw new Error("Smoke-test audio must be non-empty signed 16-bit PCM.");
}

const startedAt = Date.now();
const socketUrl = "wss://api.openai.com/v1/realtime?intent=transcription";
const safetyIdentifier = createHash("sha256")
  .update("voxandra-cascade-translation-smoke")
  .digest("hex");
const chunkBytes = 24_000 * 2 * 0.02;
let sessionUpdatedAt;
let firstSourceDeltaAt;
let transcriptCompletedAt;

const transcript = await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl, {
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
  });
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error("Cascade transcription smoke timed out."));
  }, 45_000);
  const finish = (error, value) => {
    clearTimeout(timeout);
    socket.close();
    if (error) reject(error);
    else resolve(value);
  };

  socket.on("open", async () => {
    socket.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: {
                model: config.liveGuidanceTranscriptionModel,
                language: sourceLanguage,
                delay: config.transcriptionDelay,
              },
              turn_detection: null,
            },
          },
        },
      })
    );
    for (let offset = 0; offset < audio.length; offset += chunkBytes) {
      socket.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: audio.subarray(offset, offset + chunkBytes).toString("base64"),
        })
      );
      await new Promise((resolveChunk) => setTimeout(resolveChunk, 20));
    }
    socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  });
  socket.on("message", (data) => {
    const event = JSON.parse(data.toString());
    if (event.type === "error") {
      finish(new Error(event.error?.message || "Cascade transcription failed."));
    } else if (event.type === "session.updated") {
      sessionUpdatedAt = Date.now();
    } else if (event.type === "conversation.item.input_audio_transcription.delta") {
      firstSourceDeltaAt ??= Date.now();
    } else if (event.type === "conversation.item.input_audio_transcription.completed") {
      transcriptCompletedAt = Date.now();
      finish(undefined, String(event.transcript || "").trim());
    }
  });
  socket.on("error", (error) => finish(error));
});

if (!transcript) throw new Error("Cascade transcription returned empty text.");
const translationStartedAt = Date.now();
const translation = await defaultTranslationRequester({
  config,
  sourceText: transcript,
  sourceLanguage,
  targetLanguage,
  recentSourceUtterances: [transcript],
});
const completedAt = Date.now();
if (!translation) throw new Error("Cascade translation returned empty text.");

console.log(
  JSON.stringify({
    ok: true,
    sourceCharacters: transcript.length,
    translatedCharacters: translation.length,
    sessionUpdateMs: sessionUpdatedAt ? sessionUpdatedAt - startedAt : undefined,
    firstSourceDeltaMs: firstSourceDeltaAt ? firstSourceDeltaAt - startedAt : undefined,
    sourceCompletedMs: transcriptCompletedAt ? transcriptCompletedAt - startedAt : undefined,
    textTranslationMs: completedAt - translationStartedAt,
    totalMs: completedAt - startedAt,
  })
);
