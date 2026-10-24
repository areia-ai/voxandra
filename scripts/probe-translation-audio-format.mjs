// One-time manual diagnostic for Spoken Translation Phase 1 (internal-only,
// see AGENTIC_FUTURE.md and LIVE_TRANSLATION_LATENCY_PLAN.md).
//
// The worker has always discarded session.output_audio.delta from the
// direct-pipeline translations endpoint, so nothing in this codebase has
// ever inspected its sample rate, channel count, or encoding. Phase 1's
// worker-side relay is a pure byte passthrough and does not need this
// answer to run correctly, but the browser playback harness
// (scripts/browser-audio-stream-harness.html) needs the real sample rate to
// configure AudioContext, and per AGENTS.md's guardrail — every protocol
// change must be proven against the real API before the worker/browser code
// trusts an assumption about it (see the two 2026-07-10 outages referenced
// in LIVE_TRANSLATION_LATENCY_PLAN.md) — this must be run once against the
// real endpoint before that harness's assumed sample rate is trusted.
//
// This intentionally sends the exact same session.update the worker already
// sends (buildTranslationSessionUpdate in realtime-media-worker-core.mjs) —
// do not add new session fields here to "ask" for a specific audio format;
// that is exactly the kind of unverified experiment that caused those
// outages. This script only observes what the endpoint already sends today.
//
// Usage: OPENAI_API_KEY=... node scripts/probe-translation-audio-format.mjs <24khz-mono-pcm16-file> [target-language]
//
// Never part of `npm test` or CI — run manually, once, with real API
// credentials, and record the findings in the runbook.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import WebSocket from "ws";

const audioPath = process.argv[2];
const targetLanguage = process.argv[3] || "en";
const apiKey = process.env.OPENAI_API_KEY;
const translationModel =
  process.env.OPENAI_REALTIME_TRANSLATION_MODEL || "gpt-realtime-translate";
const transcriptionModel =
  process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || "gpt-live-transcribe";

if (!audioPath) {
  throw new Error(
    "Usage: node scripts/probe-translation-audio-format.mjs <24khz-mono-pcm16-file> [target-language]"
  );
}
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required for this probe.");
}

const audio = await readFile(audioPath);
if (audio.length === 0 || audio.length % 2 !== 0) {
  throw new Error("Probe audio must be non-empty signed 16-bit PCM.");
}

const socketUrl = `wss://api.openai.com/v1/realtime/translations?model=${encodeURIComponent(
  translationModel
)}`;
const safetyIdentifier = createHash("sha256")
  .update("voxandra-translation-audio-format-probe")
  .digest("hex");
const chunkBytes = 24_000 * 2 * 0.02;
const trailingSilence = Buffer.alloc(24_000 * 2);
const audioWithSilence = Buffer.concat([audio, trailingSilence]);

let sessionUpdated = false;
let sessionCreatedFields;
let sessionUpdatedFields;
let firstDeltaEvent;
let deltaCount = 0;
let totalDecodedBytes = 0;
let firstDeltaAt;
let lastDeltaAt;
let closing = false;

// Never persist or print the actual audio payload — only its shape.
function summarizeDeltaEvent(event) {
  const { delta, ...rest } = event;
  return {
    ...rest,
    deltaBase64Length: typeof delta === "string" ? delta.length : undefined,
    deltaDecodedByteLength:
      typeof delta === "string" ? Buffer.byteLength(delta, "base64") : undefined,
  };
}

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
  });
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error("Translation audio format probe timed out."));
  }, 45_000);

  function finish(error) {
    clearTimeout(timeout);
    if (error) {
      socket.close();
      reject(error);
      return;
    }
    socket.close();
    const spanMs = lastDeltaAt && firstDeltaAt ? lastDeltaAt - firstDeltaAt : undefined;
    resolve({
      sessionUpdated,
      sessionCreatedFields,
      sessionUpdatedFields,
      firstDeltaEvent,
      deltaCount,
      totalDecodedBytes,
      // If this is PCM16 mono, bytesPerSecond / 2 (bytes/sample) gives the
      // implied sample rate — sanity-check it against 24000 (the input rate
      // this worker already assumes for every other Realtime audio path).
      impliedBytesPerSecond:
        spanMs && spanMs > 0 ? Math.round((totalDecodedBytes / spanMs) * 1000) : undefined,
    });
  }

  socket.on("open", async () => {
    socket.send(
      JSON.stringify({
        type: "session.update",
        session: {
          audio: {
            input: { transcription: { model: transcriptionModel } },
            output: { language: targetLanguage },
          },
        },
      })
    );

    for (let offset = 0; offset < audioWithSilence.length; offset += chunkBytes) {
      socket.send(
        JSON.stringify({
          type: "session.input_audio_buffer.append",
          audio: audioWithSilence.subarray(offset, offset + chunkBytes).toString("base64"),
        })
      );
      await new Promise((resolveChunk) => setTimeout(resolveChunk, 20));
    }

    await new Promise((resolveDrain) => setTimeout(resolveDrain, 2_000));
    closing = true;
    socket.send(JSON.stringify({ type: "session.close" }));
  });

  socket.on("message", (data) => {
    const event = JSON.parse(data.toString());
    if (event.type === "error") {
      finish(new Error(event.error?.message || "OpenAI translation probe failed."));
      return;
    }
    if (event.type === "session.created") {
      const { session, ...rest } = event;
      sessionCreatedFields = { ...rest, sessionKeys: Object.keys(session || {}) };
      return;
    }
    if (event.type === "session.updated") {
      sessionUpdated = true;
      const { session, ...rest } = event;
      sessionUpdatedFields = {
        ...rest,
        sessionKeys: Object.keys(session || {}),
        audioKeys: Object.keys(session?.audio || {}),
        audioOutputKeys: Object.keys(session?.audio?.output || {}),
      };
      return;
    }
    if (event.type === "session.output_audio.delta") {
      const now = Date.now();
      if (!firstDeltaEvent) {
        firstDeltaEvent = summarizeDeltaEvent(event);
        firstDeltaAt = now;
      }
      lastDeltaAt = now;
      deltaCount += 1;
      if (typeof event.delta === "string") {
        totalDecodedBytes += Buffer.byteLength(event.delta, "base64");
      }
      return;
    }
    if (event.type === "session.closed") {
      finish();
    }
  });

  socket.on("error", (error) => finish(error));
  socket.on("close", () => {
    if (!closing && deltaCount === 0) {
      finish(new Error("Socket closed before any output_audio.delta arrived."));
    }
  });
});

console.log(JSON.stringify({ ok: true, ...result }, null, 2));
