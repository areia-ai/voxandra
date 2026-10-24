// One-time manual diagnostic for the Palabra speech-to-speech pipeline
// (Spoken Translation Phase 3, internal-only — see AGENTIC_FUTURE.md).
//
// Proves the Palabra WebSocket protocol against the real API before any
// worker code trusts it, per the standing guardrail (the two 2026-07-10
// outages came from unprobed protocol assumptions). Protocol shape here was
// derived from Palabra's official Python client source
// (github.com/PalabraAI/palabra-ai-python) and this probe verifies it live:
//
//   - endpoint: wss://streaming.palabra.ai/streaming-api/{hash}/v1/speech-to-speech/stream?token=KEY
//   - handshake: set_task, then poll get_task until current_task arrives
//   - audio in: {"message_type":"input_audio_data","data":{"data":"<base64>"}}
//     as ~320ms PCM s16le 24kHz mono chunks at real-time pacing
//   - events out: partial_transcription / validated_transcription /
//     translated_transcription (+ current_task, error, output_audio_data)
//
// Usage:
//   PALABRA_API_KEY=... node scripts/probe-palabra-translation.mjs <24khz-mono-pcm16-file> [source-lang] [target-lang]
//
// Local key convenience (palabra.rtf is gitignored):
//   PALABRA_API_KEY=$(textutil -convert txt -stdout palabra.rtf | tail -1) node scripts/probe-palabra-translation.mjs ...
//
// Never part of `npm test` or CI. Costs a fraction of a cent per run.
// Prints only lengths/counts/timings — never transcript text or audio bytes.

import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const audioPath = process.argv[2];
const sourceLanguage = process.argv[3] || "es";
const targetLanguage = process.argv[4] || "en";
const apiKey = process.env.PALABRA_API_KEY;
const endpointTemplate =
  process.env.PALABRA_TRANSLATION_URL ||
  "wss://streaming.palabra.ai/streaming-api/{random_hash}/v1/speech-to-speech/stream";
// Optional: dump received translated audio as raw PCM for a manual listen.
const audioDumpPath = process.env.PALABRA_PROBE_AUDIO_DUMP;

if (!audioPath) {
  throw new Error(
    "Usage: PALABRA_API_KEY=... node scripts/probe-palabra-translation.mjs <24khz-mono-pcm16-file> [source-lang] [target-lang]"
  );
}
if (!apiKey) {
  throw new Error("PALABRA_API_KEY is required for this probe.");
}

const audio = await readFile(audioPath);
if (audio.length === 0 || audio.length % 2 !== 0) {
  throw new Error("Probe audio must be non-empty signed 16-bit PCM at 24kHz mono.");
}

const SAMPLE_RATE = 24000;
const CHUNK_MS = 320;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000; // 15360
const trailingSilence = Buffer.alloc(SAMPLE_RATE * 2); // 1s tail so the last phrase confirms
const audioWithSilence = Buffer.concat([audio, trailingSilence]);

const task = {
  input_stream: {
    content_type: "audio",
    source: { type: "ws", format: "pcm_s16le", sample_rate: SAMPLE_RATE, channels: 1 },
  },
  output_stream: {
    content_type: "audio",
    target: { type: "ws", format: "pcm_s16le" },
  },
  pipeline: {
    transcription: { source_language: sourceLanguage },
    translations: [
      {
        target_language: targetLanguage,
        // Voice cloning stays hard-off: no cloning consent surface exists
        // (AGENTIC_FUTURE.md gate). Default platform voice only.
        speech_generation: {},
      },
    ],
    allowed_message_types: [
      "partial_transcription",
      "validated_transcription",
      "translated_transcription",
    ],
  },
};

// Session-based connection (the documented protocol): create a session via
// REST, connect to its dedicated ws_url with the per-session publisher
// token, and delete the session afterwards. Connecting to the streaming
// endpoint directly with the raw API key aliases every connection onto one
// implicit account-level session — verified live on 2026-07-31: the second
// concurrent connection kills the first one's task with a code-1000 close,
// which is exactly how the translation bridge's browser leg went silent.
// Set PALABRA_LEGACY_DIRECT_WS=true to reproduce that legacy behavior.
const useLegacyDirectWs = process.env.PALABRA_LEGACY_DIRECT_WS === "true";
const sessionApiUrl =
  process.env.PALABRA_SESSION_API_URL || "https://api.palabra.ai/session-storage/session";

async function createPalabraSession() {
  const response = await fetch(sessionApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { subscriber_count: 0 } }),
  });
  const body = await response.json();
  if (!response.ok || !body?.ok || !body?.data?.ws_url || !body?.data?.publisher) {
    throw new Error(`Palabra session creation failed: HTTP ${response.status}`);
  }
  return body.data;
}

async function deletePalabraSession(sessionId) {
  try {
    await fetch(`${sessionApiUrl}/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Best-effort: unused sessions expire on their own.
  }
}

let session;
let url;
if (useLegacyDirectWs) {
  url = `${endpointTemplate.replace("{random_hash}", randomUUID().replaceAll("-", ""))}?token=${encodeURIComponent(apiKey)}`;
} else {
  session = await createPalabraSession();
  url = `${session.ws_url}?token=${encodeURIComponent(session.publisher)}`;
  console.error(`[probe] session created (ws hash ${session.ws_url.split("/")[3]})`);
}

const startedAt = Date.now();
let readyAt;
let firstEventAtByType = {};
const eventCensus = {};
let transcriptChars = { source: 0, translated: 0 };
let audioChunks = 0;
let audioBytes = 0;
let firstAudioAt;
let lastAudioAt;
const audioBuffers = [];
let sendDoneAt;
let closing = false;

function redactSummary(msg) {
  // Structure only — never text or audio content.
  const type = msg?.message_type || "unknown";
  const data = msg?.data || {};
  return {
    type,
    dataKeys: Object.keys(data),
    transcriptionKeys: data.transcription ? Object.keys(data.transcription) : undefined,
  };
}

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  const pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.ping();
  }, 10_000);
  const timeout = setTimeout(() => {
    finish(new Error("Palabra probe timed out after 90s."));
  }, 90_000);

  function finish(error) {
    clearTimeout(timeout);
    clearInterval(pingTimer);
    closing = true;
    try {
      socket.close();
    } catch {
      // Already closing.
    }
    if (error) reject(error);
    else {
      resolve({
        ok: true,
        timeToReadyMs: readyAt ? readyAt - startedAt : undefined,
        firstEventLatenciesMs: Object.fromEntries(
          Object.entries(firstEventAtByType).map(([type, at]) => [type, at - startedAt])
        ),
        eventCensus,
        transcriptChars,
        audioChunks,
        audioBytes,
        audioSpanMs: firstAudioAt && lastAudioAt ? lastAudioAt - firstAudioAt : undefined,
        // 24kHz PCM16 mono content = 48,000 bytes per second of speech.
        impliedAudioSeconds: audioBytes / 48000,
        inputSeconds: audioWithSilence.length / 48000,
        sendToLastAudioMs: sendDoneAt && lastAudioAt ? lastAudioAt - sendDoneAt : undefined,
        totalMs: Date.now() - startedAt,
      });
    }
  }

  function send(messageType, data) {
    socket.send(JSON.stringify({ message_type: messageType, data }));
  }

  socket.on("open", async () => {
    send("set_task", task);
    // No set_task ack: poll get_task until current_task arrives.
    const readyDeadline = Date.now() + 15_000;
    while (!readyAt && !closing) {
      send("get_task", {});
      await new Promise((r) => setTimeout(r, 1000));
      if (Date.now() > readyDeadline) {
        finish(new Error("Pipeline did not confirm the task within 15s."));
        return;
      }
    }
    if (closing) return;

    for (let offset = 0; offset < audioWithSilence.length; offset += CHUNK_BYTES) {
      if (closing) return;
      send("input_audio_data", {
        data: audioWithSilence.subarray(offset, offset + CHUNK_BYTES).toString("base64"),
      });
      await new Promise((r) => setTimeout(r, CHUNK_MS));
    }
    sendDoneAt = Date.now();
    // Drain phase: keep streaming silence at real-time pacing. Empirically
    // (first probe run) Palabra emits a `warning` after ~10s without input
    // audio and then closes the socket with code 1000 — so a "quiet drain"
    // kills the session before the tail finishes synthesizing. On a real
    // call this never happens: Twilio streams frames continuously even
    // during silence.
    const silenceChunk = Buffer.alloc(CHUNK_BYTES).toString("base64");
    const drainDeadline = Date.now() + 12_000;
    while (Date.now() < drainDeadline && !closing) {
      send("input_audio_data", { data: silenceChunk });
      await new Promise((r) => setTimeout(r, CHUNK_MS));
    }
    if (closing) return;
    send("end_task", {});
    await new Promise((r) => setTimeout(r, 2_000));
    finish();
  });

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
      // The server may double-encode data as a JSON string.
      if (typeof msg.data === "string") {
        try {
          msg.data = JSON.parse(msg.data);
        } catch {
          // Leave as-is; census still records the type.
        }
      }
    } catch {
      eventCensus.unparseable = (eventCensus.unparseable || 0) + 1;
      return;
    }
    const type = msg.message_type || "unknown";
    eventCensus[type] = (eventCensus[type] || 0) + 1;
    if (!firstEventAtByType[type]) {
      firstEventAtByType[type] = Date.now();
      console.error(
        `[probe] first ${type} at +${Date.now() - startedAt}ms:`,
        JSON.stringify(redactSummary(msg))
      );
    }
    if (type === "current_task" && !readyAt) {
      readyAt = Date.now();
    }
    if (type === "error") {
      const code = msg.data?.code || msg.data?.error_code;
      // NOT_FOUND is expected while polling readiness.
      if (code !== "NOT_FOUND") {
        console.error(`[probe] error event: code=${code}`);
        if (!readyAt) finish(new Error(`Task rejected: ${code}`));
      }
    }
    const text = msg.data?.transcription?.text;
    if (typeof text === "string") {
      if (type === "translated_transcription" || type === "partial_translated_transcription") {
        transcriptChars.translated += text.length;
      } else {
        transcriptChars.source = Math.max(transcriptChars.source, text.length);
      }
    }
    if (type === "output_audio_data") {
      const b64 = msg.data?.data;
      if (typeof b64 === "string" && b64.length > 0) {
        const bytes = Buffer.from(b64, "base64");
        audioChunks += 1;
        audioBytes += bytes.length;
        if (!firstAudioAt) firstAudioAt = Date.now();
        lastAudioAt = Date.now();
        if (audioDumpPath) audioBuffers.push(bytes);
      }
    }
  });

  socket.on("error", (error) => finish(error));
  socket.on("close", (code, reason) => {
    if (closing) return;
    // A server-side close after we already received translated audio still
    // counts as a successful probe (e.g. the session ends server-side after
    // end_task or an input-silence warning).
    if (audioChunks > 0) {
      console.error(`[probe] server closed the session: code=${code} (already have audio; treating as done)`);
      finish();
      return;
    }
    finish(
      new Error(`Socket closed unexpectedly: code=${code} reason=${reason?.toString().slice(0, 200)}`)
    );
  });
});

if (session?.id) await deletePalabraSession(session.id);

if (audioDumpPath && audioBuffers.length > 0) {
  await writeFile(audioDumpPath, Buffer.concat(audioBuffers));
  console.error(`[probe] raw translated PCM written to ${audioDumpPath} (24kHz s16le mono)`);
}

console.log(JSON.stringify(result, null, 2));
