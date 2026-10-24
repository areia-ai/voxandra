// End-to-end proof for the bridge media-path skeleton (internal-only, see
// AGENTIC_FUTURE.md): the worker has never sent audio back into a Twilio
// call before this. Unlike every other smoke script in this repo, this one
// needs NO external credentials at all — no OpenAI, no live Twilio, no real
// Convex deployment — because it verifies pure protocol mechanics (does the
// worker construct and send correctly-shaped, correctly-encoded outbound
// `media` frames), not a model call. It starts the worker's own real HTTP/WS
// server and plays the role of Twilio itself with a synthetic client.
//
// This proves the WORKER's half of the protocol contract. It does not prove
// Twilio's real Media Streams infrastructure accepts these frames — that
// needs a real <Connect><Stream> call through the new internal echo-test
// TwiML route (src/app/api/twilio/internal/echo-test/route.ts), which is a
// manual live-call step for the operator, documented in
// REALTIME_WORKER_RUNBOOK.md's "Bridge Media Path Skeleton" section.
//
// Usage: node scripts/smoke-echo-test.mjs

import WebSocket from "ws";
import {
  buildWorkerConfig,
  createRealtimeMediaWorkerServer,
  signMediaStreamParams,
} from "./realtime-media-worker-core.mjs";

// Reference G.711 μ-law compressor (Sun linear2ulaw), independent of the
// worker's own production encoder — used only to synthesize the fake
// Twilio-side input tone, same pattern as
// scripts/smoke-browser-audio-stream.mjs and
// scripts/probe-translation-audio-format.mjs.
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

// A 440Hz tone at 8kHz, framed into 20ms (160-sample) mu-law chunks — the
// same cadence a real Twilio Media Stream sends.
const SAMPLE_RATE = 8000;
const FRAME_SAMPLES = 160; // 20ms
const FRAME_COUNT = 25; // 500ms total
const amplitude = 8000;
const frames = [];
for (let f = 0; f < FRAME_COUNT; f += 1) {
  const bytes = Buffer.alloc(FRAME_SAMPLES);
  for (let i = 0; i < FRAME_SAMPLES; i += 1) {
    const t = f * FRAME_SAMPLES + i;
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * t) / SAMPLE_RATE));
    bytes[i] = encodeMuLawSample(sample);
  }
  frames.push(bytes.toString("base64"));
}

const WORKSPACE_ID = "smoke_echo_workspace";
// This smoke plays the TwiML route's part too: it signs the stream parameters
// with the same secret the worker verifies against, so the real stream-auth
// gate is exercised end to end (the echo test skips only the Convex call-SID
// binding, exactly as in production, because it has no Convex call row).
const STREAM_SIGNING_SECRET = "smoke-echo-stream-signing-secret";
const config = {
  ...buildWorkerConfig({
    // No real credentials needed — liveCopilot/translatedCaptions are both
    // off for this call, so nothing in the worker ever dials out to OpenAI
    // or writes to Convex. validateWorkerConfig only checks these are
    // non-empty strings, never that they're reachable.
    OPENAI_API_KEY: "smoke-test-unused",
    CONVEX_URL: "https://smoke-test-unused.convex.cloud",
    REALTIME_CONVEX_WORKER_SECRET: "smoke-test-unused",
    REALTIME_STREAM_SIGNING_SECRET: STREAM_SIGNING_SECRET,
  }),
  port: 0,
  echoTestWorkspaceIds: [WORKSPACE_ID],
};

const { httpServer } = createRealtimeMediaWorkerServer({ config, logger: () => {} });
const port = await new Promise((resolve) => {
  httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port));
});

const twilioSocket = new WebSocket(`ws://127.0.0.1:${port}/twilio/media-stream`);
const outboundFrames = [];

const echoed = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Timed out waiting for echoed media frames.")),
    15_000
  );
  twilioSocket.on("message", (data) => {
    const event = JSON.parse(data.toString());
    if (event.event === "media") {
      outboundFrames.push(event);
      if (outboundFrames.length >= FRAME_COUNT) {
        clearTimeout(timeout);
        resolve();
      }
    }
  });
  twilioSocket.on("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
});

await new Promise((resolve, reject) => {
  twilioSocket.on("open", resolve);
  twilioSocket.on("error", reject);
});

twilioSocket.send(
  JSON.stringify({
    event: "start",
    start: {
      streamSid: "MZSMOKEECHO",
      callSid: "CASMOKEECHO",
      customParameters: signMediaStreamParams(
        {
          voxandraCallId: "call_smoke_echo",
          workspaceId: WORKSPACE_ID,
          liveCopilot: "false",
          translatedCaptions: "false",
          echoTestEnabled: "true",
        },
        STREAM_SIGNING_SECRET
      ),
    },
  })
);

for (const payload of frames) {
  twilioSocket.send(
    JSON.stringify({ event: "media", media: { track: "inbound", payload } })
  );
  await new Promise((resolveFrame) => setTimeout(resolveFrame, 20));
}

await echoed;
twilioSocket.send(JSON.stringify({ event: "stop", stop: {} }));
await new Promise((resolveDrain) => setTimeout(resolveDrain, 200));
twilioSocket.close();
httpServer.close();

if (outboundFrames.length !== FRAME_COUNT) {
  throw new Error(
    `Expected exactly ${FRAME_COUNT} echoed frames (one per inbound frame), got ${outboundFrames.length}.`
  );
}
for (const frame of outboundFrames) {
  if (frame.streamSid !== "MZSMOKEECHO") {
    throw new Error(`Echoed frame carried the wrong streamSid: ${frame.streamSid}`);
  }
  if (typeof frame.media?.payload !== "string" || frame.media.payload.length === 0) {
    throw new Error("An echoed frame had an empty or missing payload.");
  }
  Buffer.from(frame.media.payload, "base64"); // throws on malformed base64
}

console.log(
  JSON.stringify(
    { ok: true, framesSent: frames.length, framesEchoed: outboundFrames.length },
    null,
    2
  )
);
