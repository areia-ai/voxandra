// End-to-end proof for the Palabra speech-to-speech pipeline (Spoken
// Translation Phase 3, internal-only — see AGENTIC_FUTURE.md).
//
// Unlike scripts/smoke-browser-audio-stream.mjs, this needs no real Convex
// deployment: the worker's Convex calls are intercepted by a fake client
// (records every mutation, answers validateBrowserAudioStreamToken
// affirmatively), so this only needs a real Palabra API key. Drives the
// worker's own real HTTP/WS server, a synthetic Twilio leg streaming real
// speech audio, and a real /browser/audio-stream client — proving the
// palabra pipeline selection, the 320ms audio accumulator, caption pairing,
// and the browser-audio relay all together against the live Palabra API.
//
// Usage:
//   PALABRA_API_KEY=... node scripts/smoke-palabra-translation.mjs <24khz-mono-pcm16-file> [source-lang] [target-lang]
//
// Local key convenience (palabra.rtf is gitignored):
//   PALABRA_API_KEY=$(textutil -convert txt -stdout palabra.rtf | tail -1) node scripts/smoke-palabra-translation.mjs ...
//
// Optional: set PALABRA_SMOKE_AUDIO_DUMP to a file path to save the
// translated speech as raw PCM (24kHz s16le mono) for a manual listen.
//
// Never part of `npm test` or CI — needs a live Palabra API key.

import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { getFunctionName } from "convex/server";
import { api } from "../convex/_generated/api.js";
import {
  buildWorkerConfig,
  createRealtimeMediaWorkerServer,
} from "./realtime-media-worker-core.mjs";

const audioPath = process.argv[2];
const sourceLanguage = process.argv[3] || "es";
const targetLanguage = process.argv[4] || "en";
const audioDumpPath = process.env.PALABRA_SMOKE_AUDIO_DUMP;

if (!audioPath) {
  throw new Error(
    "Usage: PALABRA_API_KEY=... node scripts/smoke-palabra-translation.mjs <24khz-mono-pcm16-file> [source-lang] [target-lang]"
  );
}
if (!process.env.PALABRA_API_KEY) {
  throw new Error("PALABRA_API_KEY is required.");
}

const pcm24 = await readFile(audioPath);
if (pcm24.length === 0 || pcm24.length % 2 !== 0) {
  throw new Error("Smoke-test audio must be non-empty signed 16-bit PCM at 24kHz mono.");
}

// Reference G.711 mu-law compressor, independent of the worker's own
// production encoder — synthesizes the fake Twilio leg's telephone audio,
// same approach as every other smoke script in this repo.
function encodeMuLawSample(sample) {
  const MULAW_BIAS = 0x84;
  const MULAW_CLIP = 32635;
  const sign = (sample >> 8) & 0x80;
  let magnitude = sign ? -sample : sample;
  if (magnitude > MULAW_CLIP) magnitude = MULAW_CLIP;
  magnitude += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; exponent -= 1) {
    mask >>= 1;
  }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function pcm24ToMuLaw8(pcm24Buffer) {
  const sampleCount = Math.floor(pcm24Buffer.length / 2 / 3);
  const out = Buffer.alloc(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = encodeMuLawSample(pcm24Buffer.readInt16LE(i * 3 * 2));
  }
  return out;
}

const muLaw8 = pcm24ToMuLaw8(pcm24);
const FRAME_BYTES = 160; // 20ms at 8kHz, 1 byte/sample mu-law
const WORKSPACE_ID = "smoke_palabra_workspace";
const CALL_ID = "call_smoke_palabra";
const REALTIME_SESSION_ID = "session_smoke_palabra";

// Fake Convex: records every mutation the worker makes (for the assertions
// below) and answers just enough to keep the real flow moving — no live
// Convex deployment involved.
const mutations = [];
const convex = {
  async mutation(reference, args) {
    const name = getFunctionName(reference);
    mutations.push({ name, args });
    if (name === getFunctionName(api.browserAudioStream.validateBrowserAudioStreamToken)) {
      return { workspaceId: WORKSPACE_ID, realtimeSessionId: REALTIME_SESSION_ID };
    }
    if (name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)) {
      return { segmentId: `segment_${mutations.length}` };
    }
    return { ok: true };
  },
};

const config = {
  ...buildWorkerConfig({
    // Only PALABRA_API_KEY is real — Convex is faked above and OpenAI is
    // never dialed (liveCopilot/cascade/direct never run for this call), so
    // validateWorkerConfig's presence check just needs non-empty strings.
    OPENAI_API_KEY: "smoke-test-unused",
    CONVEX_URL: "https://smoke-test-unused.convex.cloud",
    REALTIME_CONVEX_WORKER_SECRET: "smoke-test-unused",
    PALABRA_API_KEY: process.env.PALABRA_API_KEY,
    // This smoke has no TwiML route in the loop to sign the stream parameters
    // and no Convex call row to bind the CallSid to, so it uses the explicit
    // local-only escape hatch. Never set this on a deployed worker.
    REALTIME_ALLOW_UNSIGNED_STREAMS: "true",
  }),
  port: 0,
  translationPalabraWorkspaceIds: [WORKSPACE_ID],
  translationAudioForwardWorkspaceIds: [WORKSPACE_ID],
  browserAudioStreamOrigins: ["http://localhost:3000"],
};
// PALABRA_SMOKE_VERBOSE=true surfaces worker log lines for debugging.
const smokeLogger =
  process.env.PALABRA_SMOKE_VERBOSE === "true"
    ? (level, message, details) => console.error(`[worker:${level}] ${message}`, details ?? "")
    : () => {};
const { httpServer } = createRealtimeMediaWorkerServer({ config, convex, logger: smokeLogger });
const port = await new Promise((resolve) => {
  httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port));
});

const twilioSocket = new WebSocket(`ws://127.0.0.1:${port}/twilio/media-stream`);
const browserSocket = new WebSocket(
  `ws://127.0.0.1:${port}/browser/audio-stream?token=${encodeURIComponent(
    randomUUID()
  )}&callId=${encodeURIComponent(CALL_ID)}`,
  { headers: { Origin: "http://localhost:3000" } }
);

const deltaFrames = [];
let readyFrame;
let endFrame;
const audioBuffers = [];

const browserStreamEnded = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Timed out waiting for the browser audio stream to finish.")),
    60_000
  );
  browserSocket.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type === "translation_audio_ready") {
      readyFrame = frame;
    } else if (frame.type === "translation_audio_delta") {
      deltaFrames.push(frame);
      if (audioDumpPath) audioBuffers.push(Buffer.from(frame.payload, "base64"));
    } else if (frame.type === "translation_audio_end") {
      endFrame = frame;
      clearTimeout(timeout);
      resolve();
    }
  });
  browserSocket.on("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
});

await Promise.all([
  new Promise((resolve, reject) => {
    browserSocket.on("open", resolve);
    browserSocket.on("error", reject);
  }),
  new Promise((resolve, reject) => {
    twilioSocket.on("open", resolve);
    twilioSocket.on("error", reject);
  }),
]);

twilioSocket.send(
  JSON.stringify({
    event: "start",
    start: {
      streamSid: "MZSMOKEPALABRA",
      callSid: "CASMOKEPALABRA",
      customParameters: {
        voxandraCallId: CALL_ID,
        workspaceId: WORKSPACE_ID,
        liveCopilot: "false",
        translatedCaptions: "true",
        // Required since the per-call spoken-translation gate: without it the
        // pipeline selector falls through to "direct" (OpenAI) and the smoke
        // never touches Palabra at all.
        spokenTranslationEnabled: "true",
        translatedCaptionsRealtimeSessionId: REALTIME_SESSION_ID,
        translationSourceLanguage: sourceLanguage,
        translationTargetLanguage: targetLanguage,
      },
    },
  })
);

// A short lead-in before streaming real audio gives the Palabra socket time
// to open, set_task, and confirm readiness (measured ~250ms-1s live) so
// early frames aren't lost to pre-ready buffering (which is itself exercised
// by the frames sent before this point never being sent to Palabra).
await new Promise((resolveReady) => setTimeout(resolveReady, 2_000));

for (let offset = 0; offset < muLaw8.length; offset += FRAME_BYTES) {
  twilioSocket.send(
    JSON.stringify({
      event: "media",
      media: {
        track: "outbound",
        payload: muLaw8.subarray(offset, offset + FRAME_BYTES).toString("base64"),
      },
    })
  );
  await new Promise((resolveFrame) => setTimeout(resolveFrame, 20));
}

// Keep streaming silence so Palabra doesn't warn-and-close on quiet input
// (see scripts/probe-palabra-translation.mjs) while the tail finishes.
const silenceFrame = Buffer.alloc(FRAME_BYTES).toString("base64");
const drainDeadline = Date.now() + 8_000;
while (Date.now() < drainDeadline) {
  twilioSocket.send(
    JSON.stringify({ event: "media", media: { track: "outbound", payload: silenceFrame } })
  );
  await new Promise((resolveFrame) => setTimeout(resolveFrame, 20));
}

twilioSocket.send(JSON.stringify({ event: "stop", stop: {} }));

await browserStreamEnded;
twilioSocket.close();
browserSocket.close();
httpServer.close();

if (audioDumpPath && audioBuffers.length > 0) {
  await writeFile(audioDumpPath, Buffer.concat(audioBuffers));
  console.error(`[smoke] translated PCM written to ${audioDumpPath} (24kHz s16le mono)`);
}

if (!readyFrame) {
  throw new Error("Never received a translation_audio_ready frame from /browser/audio-stream.");
}
if (deltaFrames.length === 0) {
  throw new Error(
    "No translation_audio_delta frames arrived — check PALABRA_API_KEY and that the fixture audio " +
      "actually contains speech."
  );
}
const sequences = deltaFrames.map((frame) => frame.sequence);
const monotonic = sequences.every((value, index) => index === 0 || value > sequences[index - 1]);
if (!monotonic) {
  throw new Error("translation_audio_delta sequence numbers were not monotonically increasing.");
}

const activated = mutations.find(
  (item) =>
    item.name === getFunctionName(api.realtimeRuntime.markRealtimeSessionActiveFromWorker) &&
    item.args.pipeline === "palabra"
);
if (!activated) throw new Error("The palabra session was never marked active.");

const finalSegments = mutations.filter(
  (item) =>
    (item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker) ||
      item.name === getFunctionName(api.realtimeRuntime.updateTranslationSegmentFromWorker)) &&
    item.args.isFinal === true &&
    item.args.sourceText &&
    item.args.translatedText
);
if (finalSegments.length === 0) {
  throw new Error("No final translation segment was recorded with both source and translated text.");
}

const usageRecorded = mutations.some(
  (item) =>
    item.name === getFunctionName(api.realtimeUsage.recordRealtimeUsageFromWorker) &&
    item.args.feature === "translated_captions"
);

if (!endFrame) {
  throw new Error("Never received a translation_audio_end frame after the call ended.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      finalSegmentCount: finalSegments.length,
      lastFinalSegment: {
        sourceLength: finalSegments.at(-1).args.sourceText.length,
        translatedLength: finalSegments.at(-1).args.translatedText.length,
      },
      audioFrameCount: deltaFrames.length,
      audioBytes: deltaFrames.reduce(
        (sum, frame) => sum + Buffer.byteLength(frame.payload, "base64"),
        0
      ),
      usageRecorded,
    },
    null,
    2
  )
);
