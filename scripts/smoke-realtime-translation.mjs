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
    "Usage: node scripts/smoke-realtime-translation.mjs <24khz-mono-pcm16-file> [target-language]"
  );
}
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required for the realtime translation smoke test.");
}

const audio = await readFile(audioPath);
if (audio.length === 0 || audio.length % 2 !== 0) {
  throw new Error("Smoke-test audio must be non-empty signed 16-bit PCM.");
}

const socketUrl = `wss://api.openai.com/v1/realtime/translations?model=${encodeURIComponent(
  translationModel
)}`;
const safetyIdentifier = createHash("sha256")
  .update("voxandra-realtime-translation-smoke")
  .digest("hex");
const chunkBytes = 24_000 * 2 * 0.02;
const trailingSilence = Buffer.alloc(24_000 * 2);
const audioWithSilence = Buffer.concat([audio, trailingSilence]);

let sessionUpdated = false;
let outputCharacters = 0;
let sourceCharacters = 0;
let firstOutputLatencyMs;
let closing = false;
const startedAt = Date.now();

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
  });
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error("Realtime translation smoke test timed out."));
  }, 45_000);

  function finish(error) {
    clearTimeout(timeout);
    if (error) {
      socket.close();
      reject(error);
      return;
    }
    socket.close();
    resolve({
      sessionUpdated,
      outputCharacters,
      sourceCharacters,
      firstOutputLatencyMs,
      totalMs: Date.now() - startedAt,
    });
  }

  socket.on("open", async () => {
    socket.send(
      JSON.stringify({
        type: "session.update",
        session: {
          audio: {
            input: {
              transcription: { model: transcriptionModel },
            },
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
      finish(new Error(event.error?.message || "OpenAI translation smoke test failed."));
      return;
    }
    if (event.type === "session.updated") {
      sessionUpdated = true;
      return;
    }
    if (event.type === "session.input_transcript.delta") {
      sourceCharacters += String(event.delta || "").length;
      return;
    }
    if (event.type === "session.output_transcript.delta") {
      if (firstOutputLatencyMs === undefined) {
        firstOutputLatencyMs = Date.now() - startedAt;
      }
      outputCharacters += String(event.delta || "").length;
      return;
    }
    if (event.type === "session.closed") {
      if (!sessionUpdated) {
        finish(new Error("Translation session never acknowledged its configuration."));
      } else if (outputCharacters === 0) {
        finish(new Error("Translation session produced no translated transcript deltas."));
      } else {
        finish();
      }
    }
  });

  socket.on("error", (error) => finish(error));
  socket.on("close", () => {
    if (!closing && outputCharacters === 0) {
      finish(new Error("Translation socket closed before producing output."));
    }
  });
});

console.log(JSON.stringify({ ok: true, ...result }));
