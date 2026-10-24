// End-to-end proof for Spoken Translation Phase 1 (internal-only, see
// AGENTIC_FUTURE.md): drives a real call — real OpenAI translations
// endpoint, real Convex mutations, the worker's own HTTP/WS server — through
// a synthetic Twilio leg and a real /browser/audio-stream client, and
// verifies translated speech audio actually arrives.
//
// Unlike smoke-realtime-translation.mjs / smoke-cascade-translation.mjs
// (which talk to OpenAI directly and never touch the worker's own server or
// Convex), this script needs to prove the new call registry, token
// validation, and WebSocket relay end-to-end, so it starts a real worker
// server locally and calls real Convex mutations against whatever
// deployment CONVEX_URL points at.
//
// Run this only against a dev/canary Convex deployment — it inserts a real
// (clearly synthetic, isFreeCall-style) call row via
// api.browserAudioStream.seedSmokeCallForAudioStream, which itself refuses
// to run unless that deployment has ALLOW_BROWSER_AUDIO_STREAM_SMOKE_SEED=true
// and the target workspace on REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS.
//
// Usage:
//   OPENAI_API_KEY=... CONVEX_URL=... REALTIME_CONVEX_WORKER_SECRET=... \
//     node scripts/smoke-browser-audio-stream.mjs <24khz-mono-pcm16-file> <canary-workspace-id> [target-language]
//
// Never part of `npm test` or CI — needs live OpenAI + Convex credentials.

import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import {
  buildWorkerConfig,
  createRealtimeMediaWorkerServer,
} from "./realtime-media-worker-core.mjs";

const audioPath = process.argv[2];
const workspaceId = process.argv[3];
const targetLanguage = process.argv[4] || "en";

const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const workerSecret = process.env.REALTIME_CONVEX_WORKER_SECRET;

function usageError() {
  return new Error(
    "Usage: OPENAI_API_KEY=... CONVEX_URL=... REALTIME_CONVEX_WORKER_SECRET=... " +
      "node scripts/smoke-browser-audio-stream.mjs <24khz-mono-pcm16-file> <canary-workspace-id> [target-language]"
  );
}

if (!audioPath || !workspaceId) throw usageError();
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");
if (!convexUrl) throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required.");
if (!workerSecret) throw new Error("REALTIME_CONVEX_WORKER_SECRET is required.");

const pcm24 = await readFile(audioPath);
if (pcm24.length === 0 || pcm24.length % 2 !== 0) {
  throw new Error("Smoke-test audio must be non-empty signed 16-bit PCM at 24kHz mono.");
}

// Reference G.711 mu-law compressor (Sun linear2ulaw), independent of the
// worker's own decoder — used only to synthesize the fake Twilio leg's
// telephone audio for this smoke test, same approach as
// scripts/test-realtime-media-worker.mjs's fixture encoder.
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

// Simple 3:1 decimation from 24kHz to 8kHz — adequate for feeding the fake
// Twilio leg here, not production-quality resampling (the worker's own
// decoder direction uses linear interpolation; this script only needs to
// produce speech-like energy for OpenAI's VAD, not clean audio).
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

const convex = new ConvexHttpClient(convexUrl);
console.error("Seeding a synthetic call on the target Convex deployment...");
const seed = await convex.mutation(api.browserAudioStream.seedSmokeCallForAudioStream, {
  secret: workerSecret,
  workspaceId,
  now: Date.now(),
});

const config = {
  // The seeded smoke call has no TwiML route signing its stream parameters
  // and no real Twilio CallSid to bind to, so this smoke uses the explicit
  // local-only escape hatch. Never set this on a deployed worker.
  ...buildWorkerConfig({ ...process.env, REALTIME_ALLOW_UNSIGNED_STREAMS: "true" }),
  port: 0,
  translationAudioForwardWorkspaceIds: [workspaceId],
};
const { httpServer } = createRealtimeMediaWorkerServer({ config, logger: () => {} });
const port = await new Promise((resolve) => {
  httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port));
});

const deltaFrames = [];
let readyFrame;
let endFrame;

const twilioSocket = new WebSocket(`ws://127.0.0.1:${port}/twilio/media-stream`);
const browserSocket = new WebSocket(
  `ws://127.0.0.1:${port}/browser/audio-stream?token=${encodeURIComponent(
    seed.token
  )}&callId=${encodeURIComponent(seed.callId)}`,
  { headers: { Origin: "http://localhost:3000" } }
);

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
      streamSid: "MZSMOKE",
      callSid: "CASMOKE",
      customParameters: {
        voxandraCallId: seed.callId,
        workspaceId,
        liveCopilot: "false",
        translatedCaptions: "true",
        translatedCaptionsRealtimeSessionId: seed.realtimeSessionId,
        translationSourceLanguage: "auto",
        translationTargetLanguage: targetLanguage,
      },
    },
  })
);

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

await new Promise((resolveDrain) => setTimeout(resolveDrain, 2_000));
twilioSocket.send(JSON.stringify({ event: "stop", stop: {} }));

await browserStreamEnded;
twilioSocket.close();
browserSocket.close();
httpServer.close();

if (!readyFrame) {
  throw new Error("Never received a translation_audio_ready frame from /browser/audio-stream.");
}
if (deltaFrames.length === 0) {
  throw new Error(
    "No translation_audio_delta frames arrived — check OPENAI_API_KEY, that the workspace is on " +
      "REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS on the target Convex deployment, and that the " +
      "fixture audio actually contains speech."
  );
}
const sequences = deltaFrames.map((frame) => frame.sequence);
const monotonic = sequences.every((value, index) => index === 0 || value > sequences[index - 1]);
if (!monotonic) {
  throw new Error("translation_audio_delta sequence numbers were not monotonically increasing.");
}
let totalDecodedBytes = 0;
for (const frame of deltaFrames) {
  if (typeof frame.payload !== "string" || frame.payload.length === 0) {
    throw new Error("A translation_audio_delta frame had an empty or missing payload.");
  }
  totalDecodedBytes += Buffer.from(frame.payload, "base64").length;
}
if (!endFrame) {
  throw new Error("Never received a translation_audio_end frame after the call ended.");
}

console.log(
  JSON.stringify(
    { ok: true, callId: seed.callId, deltaFrameCount: deltaFrames.length, totalDecodedBytes },
    null,
    2
  )
);
