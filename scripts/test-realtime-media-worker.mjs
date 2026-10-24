import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFunctionName } from "convex/server";
import WebSocket from "ws";
import { api } from "../convex/_generated/api.js";
import {
  TwilioRealtimeConnection,
  buildCascadeGlossary,
  buildWorkerConfig,
  computeConfigFingerprint,
  createBridgeLegRegistry,
  createRealtimeMediaWorkerServer,
  isStreamAuthEnabled,
  resolveClientAddress,
  signMediaStreamParams,
  validateWorkerConfig,
  verifyMediaStreamSignature,
  buildPalabraSessionRequest,
  buildPalabraTask,
  consumeSourceDeltasForWindow,
  decodeMuLawBase64ToPcm24Base64,
  defaultTranslationRequester,
  encodePcm24Base64ToMuLawBase64,
  generateGoAheadChimePcm,
  generateRingbackFrame,
  isAllowedBrowserAudioStreamOrigin,
  isLikelyInjectedEcho,
  mixBridgeAudioFrame,
  modelUsesMinimalReasoning,
  pcm16Rms,
  shouldEchoTestAudio,
  shouldForwardTranslationAudio,
  shouldUsePalabraTranslation,
  silencePcm24Base64,
  transcriptionConfidenceFromLogprobs,
} from "./realtime-media-worker-core.mjs";
import { STREAM_SIGNATURE_TTL_MS } from "./realtime-media-worker-stream-auth.mjs";
import {
  BRIDGE_DISCLOSURE_ENGLISH_TEXT,
  BRIDGE_GO_AHEAD_ENGLISH_TEXT,
  BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT,
  BRIDGE_INTRODUCTION_TIMEOUT_MS,
  clearDisclosureAudioCacheForTests,
  defaultGetOrGenerateDisclosureAudio,
  disclosureCachePaths,
  minExpectedPcmBytesForText,
  readCachedDisclosureText,
  synthesizeDisclosureAudio,
  translateDisclosureText,
} from "./realtime-media-worker-disclosures.mjs";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
// FFmpeg-decoded reference values for every G.711 μ-law code, committed as
// data so any future decoder edit is checked against the standard rather than
// against itself.
const G711_ULAW_DECODE_TABLE = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "g711-ulaw-decode-table.json"), "utf8")
);
const SPANISH_FIXTURES = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "live-translation-es-en.json"), "utf8")
);

// Reference G.711 μ-law compressor (Sun linear2ulaw), independent of the
// worker's decoder; used to synthesize 8 kHz telephone audio for tests.
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

function encodePcm8kToMuLawBase64(samples) {
  return Buffer.from(samples.map((sample) => encodeMuLawSample(sample))).toString("base64");
}

// A loud constant frame: μ-law code 0x9f decodes to 8316 (well above the
// production speech threshold of 550).
const LOUD_MULAW_PAYLOAD = Buffer.from([0x9f, 0x9f, 0x9f, 0x9f]).toString("base64");
const SILENT_MULAW_PAYLOAD = Buffer.from([0xff, 0xff, 0xff, 0xff]).toString("base64");

// Mirrors the Convex arg validators for every function the worker calls.
// Convex rejects calls carrying extra fields (ArgumentValidationError), so the
// fake client enforces the same key sets to catch shape drift before deploy.
const WORKER_FUNCTION_ALLOWED_KEYS = {
  [getFunctionName(api.realtimeRuntime.markRealtimeSessionActiveFromWorker)]: [
    "secret",
    "realtimeSessionId",
    "providerSessionId",
    "providerStreamSid",
    "providerCallSid",
    "model",
    "startedAt",
    "pipeline",
    "workerBuild",
    "configFingerprint",
  ],
  [getFunctionName(api.callGuidance.getLiveGuidanceContextForWorker)]: [
    "secret",
    "realtimeSessionId",
  ],
  [getFunctionName(api.realtimeRuntime.recordCallUtteranceFromWorker)]: [
    "secret",
    "callId",
    "realtimeSessionId",
    "speakerLabel",
    "speakerRole",
    "track",
    "language",
    "text",
    "confidence",
    "source",
    "startSeconds",
    "endSeconds",
    "startedAt",
    "endedAt",
    "sequence",
    "isFinal",
  ],
  [getFunctionName(api.callGuidance.addRealtimeGuidanceItemFromWorker)]: [
    "secret",
    "callId",
    "realtimeSessionId",
    "type",
    "label",
    "detail",
    "source",
    "evidence",
  ],
  [getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)]: [
    "secret",
    "callId",
    "realtimeSessionId",
    "sourceUtteranceId",
    "sourceLanguage",
    "targetLanguage",
    "sourceText",
    "translatedText",
    "direction",
    "audioMode",
    "audioStored",
    "latencyMs",
    "firstAudioLatencyMs",
    "model",
    "confidence",
    "pipeline",
    "stageTimings",
    "isFinal",
  ],
  [getFunctionName(api.realtimeRuntime.updateTranslationSegmentFromWorker)]: [
    "secret",
    "segmentId",
    "sourceText",
    "translatedText",
    "latencyMs",
    "firstAudioLatencyMs",
    "confidence",
    "stageTimings",
    "isFinal",
  ],
  [getFunctionName(api.realtimeRuntime.finishRealtimeSessionFromWorker)]: [
    "secret",
    "realtimeSessionId",
    "status",
    "durationSeconds",
    "endedAt",
    "errorCode",
    "errorMessage",
    "guidanceMetrics",
  ],
  [getFunctionName(api.realtimeUsage.recordRealtimeUsageFromWorker)]: [
    "secret",
    "workspaceId",
    "callId",
    "realtimeSessionId",
    "feature",
    "durationSeconds",
    "model",
    "startedAt",
    "endedAt",
  ],
  [getFunctionName(api.browserAudioStream.validateBrowserAudioStreamToken)]: [
    "secret",
    "callId",
    "token",
  ],
  [getFunctionName(api.realtimeRuntime.createRealtimeSessionFromWorker)]: [
    "secret",
    "workspaceId",
    "callId",
    "mode",
    "provider",
    "status",
    "providerSessionId",
    "providerStreamSid",
    "providerCallSid",
    "model",
    "inputLanguage",
    "targetLanguage",
    "startedAt",
  ],
  [getFunctionName(api.realtimeRuntime.markBridgeTranslationDegradedFromWorker)]: [
    "secret",
    "callId",
    "legRole",
  ],
  [getFunctionName(api.realtimeRuntime.syncBridgeInactivityFromWorker)]: [
    "secret", "callId", "providerCallSid", "lastActivityAt", "endIfIdle", "durationLimitReached",
  ],
  [getFunctionName(api.realtimeRuntime.updateBridgeDisclosureStateFromWorker)]: [
    "secret",
    "callId",
    "state",
  ],
  [getFunctionName(api.realtimeRuntime.validateWorkerStreamStart)]: [
    "secret",
    "callId",
    "workspaceId",
    "providerCallSid",
    "legRole",
  ],
};

function assertWorkerFunctionArgs(reference, args) {
  const name = getFunctionName(reference);
  const allowed = WORKER_FUNCTION_ALLOWED_KEYS[name];
  assert.ok(allowed, `worker called an unexpected Convex function: ${name}`);
  const extras = Object.keys(args).filter(
    (key) => args[key] !== undefined && !allowed.includes(key)
  );
  assert.deepEqual(
    extras,
    [],
    `${name} was called with fields its Convex validator rejects`
  );
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}

class FakeBrowserSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = WebSocket.OPEN;
    this.sent = [];
    this.closed = false;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

function waitForMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Every bridge-mode callee leg now primes a spoken disclosure before
// anything else (sub-phase 5c). Tests that aren't specifically exercising
// disclosure behavior use this no-network stub so they stay fast and
// deterministic instead of falling through to the real OpenAI-backed
// default.
const STUB_DISCLOSURE_AUDIO_BASE64 = Buffer.from([0, 0]).toString("base64");
async function stubDisclosureAudioProvider() {
  return STUB_DISCLOSURE_AUDIO_BASE64;
}

async function finishBridgeIntroduction(callee, clearFrames = true) {
  const legs = [callee, callee.siblingLeg];
  for (const leg of legs) {
    leg.handlePalabraEvent({ message_type: "current_task", data: { task_status: "running" } });
  }
  for (let i = 0; i < 3000 && !callee.bridgeConversationOpen; i += 1) {
    if (!callee.bridgeIntroduction?.disclosure && callee.bridgeIntroduction?.phase === "pending") await waitForMicrotasks();
    callee.bridgeIntroduction?.tick();
    for (const leg of legs) {
      const mark = leg.socket.sent.filter((event) => event.event === "mark").at(-1);
      if (mark) await leg.handleTwilioMessage(Buffer.from(JSON.stringify(mark)));
    }
  }
  assert.equal(callee.bridgeConversationOpen, true, "both playback acknowledgements open conversation");
  if (clearFrames) {
    for (const leg of legs) leg.socket.sent = leg.socket.sent.filter((event) => !["media", "mark"].includes(event.event));
  }
}

function makeConfig() {
  return {
    openaiApiKey: "test-openai-key",
    convexUrl: "https://example.convex.cloud",
    workerSecret: "test-worker-secret",
    liveGuidanceTranscriptionModel: "gpt-live-transcribe",
    liveGuidanceTextModel: "gpt-5.4-mini",
    liveTranslationModel: "gpt-realtime-translate",
    liveTranslationTextModel: "gpt-5.4-mini",
    translationPipeline: "direct",
    translationCascadeWorkspaceIds: [],
    transcriptionDelay: "low",
    guidanceCommitIntervalMs: 0,
    guidanceMinIntervalMs: 0,
    translationCaptionIntervalMs: 0,
    translationSegmentIdleMs: 50,
    translationSegmentMaxMs: 12000,
    translationSegmentMaxChars: 260,
    translationDrainMs: 0,
    translationSourceLeadToleranceMs: 1000,
    translationRequestTimeoutMs: 5000,
    translationMinConfidence: 0,
    preReadyAudioMaxFrames: 150,
    transcriptionSilenceMs: 40,
    transcriptionMaxUtteranceMs: 200,
    transcriptionSpeechThreshold: 1,
  };
}

function makeOpenAiSocketFactory(openAiSockets) {
  return ({ url, onEvent, onError, onClose }) => {
    const fake = {
      url,
      sent: [],
      onEvent,
      onError,
      onClose,
      closed: false,
      sendJson(event) {
        this.sent.push(event);
      },
      close() {
        this.closed = true;
      },
    };
    openAiSockets.push(fake);
    return fake;
  };
}

async function runLifecycleTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ reference, args });
      if (args.realtimeSessionId === "human_session" && args.secret) {
        return {
          version: "test",
          call: { objective: "Confirm delivery status" },
          checklist: [{ label: "Ask for ETA" }],
        };
      }
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: "translation_segment_1" };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);

  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => ({
      label: "Confirm the revised delivery ETA",
      detail: "The other person mentioned a change.",
    }),
    logger: () => {},
  });

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZ123",
          callSid: "CA123",
          customParameters: {
            voxandraCallId: "call_123",
            workspaceId: "workspace_123",
            liveCopilot: "true",
            translatedCaptions: "true",
            humanCopilotRealtimeSessionId: "human_session",
            translatedCaptionsRealtimeSessionId: "translation_session",
            translationSourceLanguage: "de",
            translationTargetLanguage: "en",
          },
        },
      })
    )
  );
  await waitForMicrotasks();

  assert.equal(openAiSockets.length, 2, "starts guidance and translation sockets");
  assert.match(openAiSockets[0].url, /intent=transcription/);
  assert.match(openAiSockets[1].url, /gpt-realtime-translate/);

  const guidanceActivation = mutations.find(
    (item) => item.args.realtimeSessionId === "human_session" && item.args.workerBuild
  );
  assert.ok(
    guidanceActivation?.args.workerBuild && guidanceActivation?.args.configFingerprint,
    "session activation persists worker build and config fingerprints"
  );

  const translationSessionUpdate = openAiSockets[1].sent.find(
    (event) => event.type === "session.update"
  );
  assert.ok(translationSessionUpdate, "translation socket receives session.update");
  assert.equal(
    translationSessionUpdate.session?.audio?.output?.language,
    "en",
    "translation session targets English"
  );
  assert.equal(
    translationSessionUpdate.session?.audio?.input?.transcription?.model,
    "gpt-live-transcribe",
    "translation session enables optional source-language transcription"
  );
  assert.equal(
    "noise_reduction" in (translationSessionUpdate.session?.audio?.input ?? {}),
    false,
    "translation session leaves provider noise reduction disabled for PSTN audio"
  );
  assert.equal(
    "language" in (translationSessionUpdate.session?.audio?.input?.transcription ?? {}),
    false,
    "translation session never sends the unsupported transcription language parameter"
  );
  assert.equal(
    "instructions" in translationSessionUpdate.session,
    false,
    "translation session never sends unsupported custom instructions"
  );

  openAiSockets[1].onEvent({
    type: "session.created",
    session: { id: "translation_provider_session" },
  });
  openAiSockets[1].onEvent({
    type: "session.updated",
    session: { id: "translation_provider_session" },
  });
  await waitForMicrotasks();

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();

  assert.equal(
    openAiSockets[0].sent.some((event) => event.type === "input_audio_buffer.append"),
    false,
    "guidance transcription never receives the user's own microphone track"
  );
  assert.equal(
    openAiSockets[1].sent.some((event) => event.type === "session.input_audio_buffer.append"),
    false,
    "translation never receives the user's own microphone track"
  );

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();

  assert.equal(
    openAiSockets[0].sent.some((event) => event.type === "input_audio_buffer.append"),
    true,
    "guidance transcription receives other-party audio"
  );
  assert.equal(
    openAiSockets[1].sent.some((event) => event.type === "session.input_audio_buffer.append"),
    true,
    "translation receives other-party audio"
  );
  assert.equal(
    openAiSockets[1].sent.some((event) => event.type === "session.input_audio_buffer.commit"),
    false,
    "translation never sends unsupported turn-based commit events"
  );

  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "The shipment will arrive Friday morning.",
  });
  openAiSockets[1].onEvent({
    type: "session.input_transcript.delta",
    delta: "Die Lieferung kommt Freitag.",
  });
  openAiSockets[1].onEvent({
    type: "session.output_transcript.delta",
    delta: "The delivery arrives Friday.",
  });
  await waitForMicrotasks();
  openAiSockets[1].onEvent({
    type: "session.output_transcript.delta",
    delta: " It ships tonight.",
  });
  // The source transcript runs ahead of the translation on the audio timeline:
  // the next utterance's source words arrive before this utterance finalizes.
  // The finalized segment must not absorb them.
  openAiSockets[1].onEvent({
    type: "session.input_transcript.delta",
    delta: " Danke schön",
  });
  await connection.requestTranslationFlush(true, "test_boundary");

  socket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();

  assert.equal(
    mutations.some((item) => item.args.type === "copilot" && item.args.source === "live_copilot"),
    true,
    "writes Live Guidance item"
  );
  assert.equal(
    mutations.filter(
      (item) =>
        item.args.type === "translation_caption" &&
        item.args.source === "translated_captions"
    ).length,
    1,
    "writes one Live Translation caption item per completed utterance"
  );
  const segmentMutations = mutations.filter(
    (item) => typeof item.args.translatedText === "string"
  );
  const insertSegmentMutations = segmentMutations.filter(
    (item) => item.args.direction === "caller_to_user"
  );
  const updateSegmentMutations = segmentMutations.filter(
    (item) => item.args.segmentId === "translation_segment_1"
  );
  assert.equal(
    insertSegmentMutations.length,
    1,
    "creates one translation segment row per utterance"
  );
  assert.equal(
    updateSegmentMutations.length >= 1,
    true,
    "updates the same segment row for partials and final"
  );
  const finalSegment = updateSegmentMutations.find((item) => item.args.isFinal === true);
  assert.equal(
    finalSegment?.args.translatedText,
    "The delivery arrives Friday. It ships tonight.",
    "final translation segment carries the complete translated utterance"
  );
  assert.equal(
    typeof finalSegment?.args.latencyMs,
    "number",
    "final translation segment records caption latency"
  );
  assert.equal(
    finalSegment?.args.sourceText,
    "Die Lieferung kommt Freitag.",
    "final translation segment cuts the source at its sentence boundary instead of absorbing the next utterance's ahead-running words"
  );
  assert.equal(
    insertSegmentMutations[0]?.args.sourceText,
    "Die Lieferung kommt Freitag.",
    "pending captions render source-first: the recognized source is written before any translation"
  );
  assert.equal(
    mutations.filter((item) => item.args.feature === "live_copilot").length,
    1,
    "records Live Guidance usage once"
  );
  assert.equal(
    mutations.filter((item) => item.args.feature === "translated_captions").length,
    1,
    "records Live Translation usage once"
  );
  assert.equal(
    openAiSockets[1].sent.some((event) => event.type === "session.close"),
    true,
    "translation session closes with the documented drain event"
  );
}

async function runTranslationFailureIsolationTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ reference, args });
      if (args.realtimeSessionId === "human_session" && args.secret) {
        return { version: "test", call: {}, checklist: [] };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);

  new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZ456",
          callSid: "CA456",
          customParameters: {
            voxandraCallId: "call_456",
            workspaceId: "workspace_456",
            liveCopilot: "true",
            translatedCaptions: "true",
            humanCopilotRealtimeSessionId: "human_session",
            translatedCaptionsRealtimeSessionId: "translation_session",
            translationTargetLanguage: "en",
          },
        },
      })
    )
  );
  await waitForMicrotasks();

  openAiSockets[1].onEvent({
    type: "error",
    error: {
      type: "invalid_request_error",
      code: "invalid_parameter",
      message: "Unsupported translation setting",
    },
  });
  await waitForMicrotasks();

  assert.equal(openAiSockets[1].closed, true, "terminal translation error closes translation socket");
  assert.equal(openAiSockets[0].closed, false, "translation failure does not stop Live Guidance");
  assert.equal(
    mutations.some(
      (item) =>
        item.args.realtimeSessionId === "translation_session" &&
        item.args.status === "failed" &&
        item.args.errorCode === "translation_provider_error"
    ),
    true,
    "translation failure is persisted immediately for the in-call UI"
  );

  socket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
  assert.equal(
    mutations.some((item) => item.args.feature === "translated_captions"),
    false,
    "failed translation session without output is not customer-billed"
  );
  assert.equal(
    mutations.some((item) => item.args.feature === "live_copilot"),
    true,
    "Live Guidance usage still closes normally after isolated translation failure"
  );
}

function makeTranslationOnlyStart(streamSid, callSid, callId, workspaceId) {
  return Buffer.from(
    JSON.stringify({
      event: "start",
      start: {
        streamSid,
        callSid,
        customParameters: {
          voxandraCallId: callId,
          workspaceId,
          liveCopilot: "false",
          translatedCaptions: "true",
          translatedCaptionsRealtimeSessionId: "translation_session",
          translationSourceLanguage: "es",
          translationTargetLanguage: "en",
        },
      },
    })
  );
}

async function runTranslationFlushFailureToleranceTest() {
  const socket = new FakeSocket();
  const mutations = [];
  let updateFailuresRemaining = 1;
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      const name = getFunctionName(reference);
      mutations.push({ name, args });
      if (
        name === getFunctionName(api.realtimeRuntime.updateTranslationSegmentFromWorker) &&
        updateFailuresRemaining > 0
      ) {
        updateFailuresRemaining -= 1;
        throw new Error("Transient Convex write failure");
      }
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: "translation_segment_retry" };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);

  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZ789", "CA789", "call_789", "workspace_789")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.created", session: { id: "s" } });
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  openAiSockets[0].onEvent({
    type: "session.input_transcript.delta",
    delta: "La factura fue pagada.",
  });
  await waitForMicrotasks();
  openAiSockets[0].onEvent({
    type: "session.output_transcript.delta",
    delta: "The invoice",
  });
  await waitForMicrotasks();
  openAiSockets[0].onEvent({
    type: "session.output_transcript.delta",
    delta: " was paid.",
  });
  await waitForMicrotasks();
  await connection.requestTranslationFlush(true, "test_boundary");

  assert.equal(
    mutations.some(
      (item) => item.args.status === "failed" && item.args.errorCode === "translation_provider_error"
    ),
    false,
    "a single failed caption write does not fail the translation session"
  );
  const finalCaption = mutations.find((item) => item.args.type === "translation_caption");
  assert.equal(
    finalCaption?.args.label,
    "The invoice was paid.",
    "the utterance still finalizes after a dropped partial flush"
  );

  socket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
  assert.equal(
    mutations.some((item) => item.args.feature === "translated_captions"),
    true,
    "a recovered translation session is still billed"
  );
}

async function runTranslationFlushPersistentFailureTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      const name = getFunctionName(reference);
      mutations.push({ name, args });
      if (name === getFunctionName(api.realtimeRuntime.updateTranslationSegmentFromWorker)) {
        throw new Error("Persistent Convex write failure");
      }
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: "translation_segment_persistent" };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);

  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZ790", "CA790", "call_790", "workspace_790")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.created", session: { id: "s" } });
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  openAiSockets[0].onEvent({
    type: "session.output_transcript.delta",
    delta: "Persistent failure case.",
  });
  await waitForMicrotasks();
  await connection.requestTranslationFlush(true, "test_boundary");
  await waitForMicrotasks();

  assert.equal(
    mutations.some(
      (item) =>
        item.args.realtimeSessionId === "translation_session" &&
        item.args.status === "failed" &&
        item.args.errorCode === "translation_provider_error"
    ),
    true,
    "repeated caption write failures fail the translation session"
  );
  assert.equal(openAiSockets[0].closed, true, "persistent failure closes the translation socket");
}

async function runCascadeTranslationTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const logs = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const config = {
    ...makeConfig(),
    translationPipeline: "cascade",
    translationDrainMs: 20,
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    openAiSocketFactory,
    translationRequester: async ({ sourceText, sourceLanguage, targetLanguage, recentSourceUtterances }) => {
      assert.equal(sourceLanguage, "es");
      assert.equal(targetLanguage, "en");
      assert.equal(sourceText, "Mañana voy a Pingo Doce a las doce.");
      assert.deepEqual(
        recentSourceUtterances,
        [],
        "cascade history holds previous utterances only, never the current one"
      );
      return "Tomorrow I am going to Pingo Doce at twelve.";
    },
    logger: (level, message, details) => logs.push({ level, message, details }),
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZCASCADE", "CACASCADE", "call_cascade", "workspace_cascade")
  );
  // The transcription socket must exist before the Convex context await
  // resolves, so media that arrives immediately is streamed, not dropped.
  assert.equal(openAiSockets.length, 1, "cascade opens its transcription socket synchronously");
  const payload = Buffer.from([0x00, 0x00, 0x00, 0x00]).toString("base64");
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ event: "media", media: { track: "outbound", payload } }))
  );
  assert.equal(
    openAiSockets[0].sent.some((event) => event.type === "input_audio_buffer.append"),
    true,
    "immediate media arrival is appended before Convex context finishes loading"
  );
  assert.equal(
    connection.preReadyDroppedFrames.transcription,
    0,
    "no pre-ready frames are dropped"
  );
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 1, "cascade uses one realtime transcription socket");
  assert.match(openAiSockets[0].url, /intent=transcription/);
  assert.equal(
    openAiSockets[0].sent[0].session.audio.input.transcription.language,
    "es",
    "cascade transcription sends the known source-language hint"
  );
  assert.equal(
    openAiSockets[0].sent[0].session.audio.input.transcription.delay,
    "low",
    "cascade transcription uses the configured latency/accuracy tradeoff"
  );

  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "transcription_s" } });
  await waitForMicrotasks();
  const activation = mutations.find((item) => item.args.pipeline === "cascade");
  assert.ok(
    activation?.args.workerBuild && activation?.args.configFingerprint,
    "cascade session activation records pipeline, worker build, and config fingerprints"
  );
  connection.commitTranscriptionAudio("test");
  openAiSockets[0].onEvent({
    type: "input_audio_buffer.committed",
    item_id: "item_cascade",
  });
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "item_cascade",
    delta: "Mañana",
  });
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_cascade",
    transcript: "Mañana voy a Pingo Doce a las doce.",
    logprobs: [{ logprob: -0.05 }, { logprob: -0.15 }],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const segment = mutations.find(
    (item) => item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)
  );
  assert.equal(segment?.args.sourceText, "Mañana voy a Pingo Doce a las doce.");
  assert.equal(
    segment?.args.translatedText,
    "Tomorrow I am going to Pingo Doce at twelve.",
    "cascade stores faithful source and translated text"
  );
  assert.equal(segment?.args.pipeline, "cascade", "cascade segments record their pipeline");
  assert.equal(
    typeof segment?.args.stageTimings?.translationRequestMs,
    "number",
    "cascade segments persist stage timings"
  );
  assert.ok(
    Math.abs(segment?.args.confidence - Math.exp(-0.1)) < 1e-9,
    "cascade segments carry logprob-derived confidence"
  );
  assert.equal(
    mutations.some((item) => item.args.type === "translation_caption"),
    true,
    "cascade publishes the translated caption"
  );
  assert.equal(
    logs.some((item) => item.message === "translation_source_first_delta"),
    true,
    "cascade records source-transcription latency"
  );
  assert.equal(
    logs.some((item) => item.message === "cascade_translation_flushed"),
    true,
    "cascade records end-to-end translation latency"
  );

  socket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    mutations.some((item) => item.args.feature === "translated_captions"),
    true,
    "successful cascade translation is billed once"
  );
}

async function runOutOfOrderCompletionTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const translatedOrder = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const config = { ...makeConfig(), translationPipeline: "cascade", translationDrainMs: 20 };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    openAiSocketFactory,
    translationRequester: async ({ sourceText }) => {
      translatedOrder.push(sourceText);
      return `EN: ${sourceText}`;
    },
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZORDER", "CAORDER", "call_order", "workspace_order")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  const media = Buffer.from(
    JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
  );
  socket.emit("message", media);
  connection.commitTranscriptionAudio("test");
  socket.emit("message", media);
  connection.commitTranscriptionAudio("test");
  await waitForMicrotasks();

  openAiSockets[0].onEvent({ type: "input_audio_buffer.committed", item_id: "item_first" });
  openAiSockets[0].onEvent({ type: "input_audio_buffer.committed", item_id: "item_second" });
  // OpenAI does not guarantee completion ordering: the second commit
  // completes before the first here.
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_second",
    transcript: "Segunda frase.",
  });
  await waitForMicrotasks();
  assert.deepEqual(
    translatedOrder,
    [],
    "a later commit completing early is held until the earlier commit completes"
  );
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_first",
    transcript: "Primera frase.",
  });
  await sleep(10);

  assert.deepEqual(
    translatedOrder,
    ["Primera frase.", "Segunda frase."],
    "transcripts drain strictly in commit order despite out-of-order completions"
  );
  const segments = mutations.filter(
    (item) => item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)
  );
  assert.deepEqual(
    segments.map((item) => item.args.sourceText),
    ["Primera frase.", "Segunda frase."],
    "caption rows persist in commit order"
  );
}

async function runPreReadyBufferingTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const logs = [];
  let releaseMarkActive;
  const markActiveGate = new Promise((resolve) => {
    releaseMarkActive = resolve;
  });
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      if (
        getFunctionName(reference) ===
          getFunctionName(api.realtimeRuntime.markRealtimeSessionActiveFromWorker) &&
        args.realtimeSessionId === "human_session"
      ) {
        await markActiveGate;
      }
      if (args.realtimeSessionId === "human_session" && !args.workerBuild) {
        return { version: "test", call: {}, checklist: [] };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: (level, message, details) => logs.push({ level, message, details }),
  });

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZBUFFER",
          callSid: "CABUFFER",
          customParameters: {
            voxandraCallId: "call_buffer",
            workspaceId: "workspace_buffer",
            liveCopilot: "true",
            translatedCaptions: "true",
            humanCopilotRealtimeSessionId: "human_session",
            translatedCaptionsRealtimeSessionId: "translation_session",
            translationSourceLanguage: "es",
            translationTargetLanguage: "en",
          },
        },
      })
    )
  );
  // Guidance transcription opens synchronously; the direct translation socket
  // is still blocked behind the (deliberately stalled) Convex activation.
  assert.equal(openAiSockets.length, 1, "only the transcription socket exists while Convex stalls");

  const media = Buffer.from(
    JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
  );
  socket.emit("message", media);
  socket.emit("message", media);
  socket.emit("message", media);
  assert.equal(
    openAiSockets[0].sent.filter((event) => event.type === "input_audio_buffer.append").length,
    3,
    "transcription audio flows immediately because its socket opened before Convex awaits"
  );
  assert.equal(
    connection.preReadyFrames.translation.length,
    3,
    "translation audio is retained in memory while its socket starts"
  );

  releaseMarkActive();
  await waitForMicrotasks();
  await waitForMicrotasks();

  assert.equal(openAiSockets.length, 2, "translation socket opens after Convex activation");
  const translationEvents = openAiSockets[1].sent;
  assert.equal(
    translationEvents[0]?.type,
    "session.update",
    "translation session config is sent before flushed audio"
  );
  assert.equal(
    translationEvents.filter((event) => event.type === "session.input_audio_buffer.append").length,
    3,
    "every pre-ready frame is flushed to the translation socket"
  );
  const flushLog = logs.find((item) => item.message === "pre_ready_audio_flushed");
  assert.equal(flushLog?.details.flushedFrames, 3, "flush log records frame counts");
  assert.equal(flushLog?.details.droppedFrames, 0, "no pre-ready frames were dropped");
  assert.equal(
    Object.keys(flushLog?.details ?? {}).some((key) => /audio|payload/i.test(key)),
    false,
    "pre-ready logging never contains audio"
  );
}

async function runSourceTargetAlignmentTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: `segment_${mutations.length}` };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZALIGN", "CAALIGN", "call_align", "workspace_align")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.created", session: { id: "s" } });
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  openAiSockets[0].onEvent({
    type: "session.input_transcript.delta",
    delta: "Hola señor.",
    elapsed_ms: 500,
  });
  openAiSockets[0].onEvent({
    type: "session.input_transcript.delta",
    delta: " Quiero confirmar",
    elapsed_ms: 2100,
  });
  openAiSockets[0].onEvent({
    type: "session.output_transcript.delta",
    delta: "Hello sir.",
    elapsed_ms: 1500,
  });
  // Ahead-running source for the NEXT utterance, beyond the target window
  // (1500 ms) plus the measured one-second lead tolerance.
  openAiSockets[0].onEvent({
    type: "session.input_transcript.delta",
    delta: " el pedido.",
    elapsed_ms: 2600,
  });
  await waitForMicrotasks();
  await connection.requestTranslationFlush(true, "test_boundary");

  const finals = () =>
    mutations.filter(
      (item) => typeof item.args.translatedText === "string" && item.args.isFinal === true
    );
  assert.equal(finals().length, 1, "first caption finalizes");
  assert.equal(
    finals()[0].args.sourceText,
    "Hola señor.",
    "the final consumes source only through the target window and cuts at the sentence boundary"
  );
  assert.equal(finals()[0].args.translatedText, "Hello sir.");

  openAiSockets[0].onEvent({
    type: "session.output_transcript.delta",
    delta: "I want to confirm the order.",
    elapsed_ms: 3600,
  });
  await waitForMicrotasks();
  await connection.requestTranslationFlush(true, "test_boundary");

  assert.equal(finals().length, 2, "second caption finalizes");
  assert.equal(
    finals()[1].args.sourceText,
    "Quiero confirmar el pedido.",
    "later source deltas stay buffered for the next caption and pair with its target"
  );
  assert.equal(finals()[1].args.translatedText, "I want to confirm the order.");
}

async function runSourcelessSuppressionTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const logs = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: "segment_sourceless" };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: (level, message, details) => logs.push({ level, message, details }),
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZNOSRC", "CANOSRC", "call_nosrc", "workspace_nosrc")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.created", session: { id: "s" } });
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  // Translated output with no source transcript at all — the production
  // hallucination signature. It must never become an authoritative caption.
  openAiSockets[0].onEvent({
    type: "session.output_transcript.delta",
    delta: "Go to the ocelot.",
  });
  await waitForMicrotasks();
  await connection.requestTranslationFlush(true, "test_boundary");

  const segmentWrites = mutations.filter(
    (item) => typeof item.args.translatedText === "string"
  );
  assert.ok(segmentWrites.length >= 1, "the suppressed caption is still persisted for review");
  assert.equal(
    segmentWrites.every((item) => item.args.isFinal === false),
    true,
    "source-less output is never promoted to a final caption"
  );
  assert.equal(
    mutations.some((item) => item.args.type === "translation_caption"),
    false,
    "source-less output never publishes an authoritative caption item"
  );
  const suppressedLog = logs.find((item) => item.message === "translation_final_suppressed");
  assert.equal(suppressedLog?.details.reason, "missing_source");
}

async function runCascadeTimeoutToleranceTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const logs = [];
  let requestCount = 0;
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const config = { ...makeConfig(), translationPipeline: "cascade", translationDrainMs: 20 };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    openAiSocketFactory,
    translationRequester: async ({ sourceText }) => {
      requestCount += 1;
      if (requestCount === 1) {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      return `EN: ${sourceText}`;
    },
    logger: (level, message, details) => logs.push({ level, message, details }),
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZTIMEOUT", "CATIMEOUT", "call_timeout", "workspace_timeout")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  const media = Buffer.from(
    JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
  );
  socket.emit("message", media);
  connection.commitTranscriptionAudio("test");
  socket.emit("message", media);
  connection.commitTranscriptionAudio("test");
  openAiSockets[0].onEvent({ type: "input_audio_buffer.committed", item_id: "item_a" });
  openAiSockets[0].onEvent({ type: "input_audio_buffer.committed", item_id: "item_b" });
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_a",
    transcript: "Primera frase.",
  });
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_b",
    transcript: "Segunda frase.",
  });
  await sleep(10);

  assert.equal(
    logs.some((item) => item.message === "cascade_translation_request_failed"),
    true,
    "the timed-out request is logged"
  );
  assert.equal(
    mutations.some(
      (item) => item.args.status === "failed" && item.args.errorCode === "translation_provider_error"
    ),
    false,
    "one timed-out translation request does not fail the session"
  );
  const pendingSourceOnly = mutations.find(
    (item) =>
      item.args.sourceText === "Primera frase." && item.args.translatedText === ""
  );
  assert.equal(
    pendingSourceOnly?.args.isFinal,
    false,
    "the timed-out utterance is persisted as a pending source-only caption for the delayed UI state"
  );
  const recovered = mutations.find(
    (item) => item.args.translatedText === "EN: Segunda frase."
  );
  assert.equal(recovered?.args.isFinal, true, "the next utterance recovers normally");
}

async function runCascadePersistentRequestFailureTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const config = { ...makeConfig(), translationPipeline: "cascade", translationDrainMs: 20 };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    openAiSocketFactory,
    translationRequester: async () => {
      throw new Error("OpenAI translation request failed: 500");
    },
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZPERSIST", "CAPERSIST", "call_persist", "workspace_persist")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  const media = Buffer.from(
    JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
  );
  for (let index = 0; index < 3; index += 1) {
    socket.emit("message", media);
    connection.commitTranscriptionAudio("test");
    openAiSockets[0].onEvent({ type: "input_audio_buffer.committed", item_id: `item_${index}` });
    openAiSockets[0].onEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: `item_${index}`,
      transcript: `Frase número ${index + 1}.`,
    });
    await sleep(5);
  }

  assert.equal(
    mutations.some(
      (item) =>
        item.args.realtimeSessionId === "translation_session" &&
        item.args.status === "failed" &&
        item.args.errorCode === "translation_provider_error"
    ),
    true,
    "three consecutive translation request failures fail the session"
  );
}

async function runCascadeLowConfidenceGateTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const logs = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const config = {
    ...makeConfig(),
    translationPipeline: "cascade",
    translationDrainMs: 20,
    // Calibrated on the canary set; anything below stays non-authoritative.
    translationMinConfidence: 0.9,
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    openAiSocketFactory,
    translationRequester: async ({ sourceText }) => `EN: ${sourceText}`,
    logger: (level, message, details) => logs.push({ level, message, details }),
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZCONF", "CACONF", "call_conf", "workspace_conf")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  connection.commitTranscriptionAudio("test");
  openAiSockets[0].onEvent({ type: "input_audio_buffer.committed", item_id: "item_low" });
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_low",
    transcript: "Frase dudosa.",
    // exp(-0.5) ≈ 0.607, below the 0.9 gate.
    logprobs: [{ logprob: -0.5 }],
  });
  await sleep(10);

  const segment = mutations.find(
    (item) => item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)
  );
  assert.equal(segment?.args.isFinal, false, "low-confidence captions stay pending");
  assert.ok(
    Math.abs(segment?.args.confidence - Math.exp(-0.5)) < 1e-9,
    "the raw confidence is stored for calibration"
  );
  assert.equal(
    mutations.some((item) => item.args.type === "translation_caption"),
    false,
    "low-confidence captions never publish an authoritative caption item"
  );
  const suppressedLog = logs.find((item) => item.message === "translation_final_suppressed");
  assert.equal(suppressedLog?.details.reason, "low_confidence");
}

async function runTranslationRequesterContractTest() {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    captured.push({ url, options });
    return { ok: true, json: async () => ({ output_text: " La traducción. " }) };
  };
  try {
    const currentUtterance = "La factura pendiente es de mil euros.";
    const text = await defaultTranslationRequester({
      config: { ...makeConfig(), liveTranslationTextModel: "gpt-5.6-luna" },
      sourceText: currentUtterance,
      sourceLanguage: "es",
      targetLanguage: "en",
      recentSourceUtterances: ["Buenos días.", currentUtterance],
      context: {
        prep: {
          contactName: "Auchan",
          keyFacts: [
            { type: "invoice_number", label: "Invoice", value: "F-2211" },
            { type: "risk_flag", label: "Risk", value: "Customer may cancel" },
          ],
          openActionItems: [{ title: "Chase the missing refund" }],
          reviewedCallMemories: [{ summary: "Customer was unhappy last call" }],
        },
      },
    });
    assert.equal(text, "La traducción.");
    const body = JSON.parse(captured[0].options.body);
    assert.deepEqual(
      body.reasoning,
      { effort: "none" },
      "GPT-5.6 cascade calls disable reasoning effort for latency"
    );
    assert.ok(
      captured[0].options.signal instanceof AbortSignal,
      "cascade requests carry the five-second timeout signal"
    );
    const prompt = body.input;
    assert.equal(
      prompt.includes("Chase the missing refund"),
      false,
      "action-item facts never reach the translation prompt"
    );
    assert.equal(
      prompt.includes("Customer was unhappy last call"),
      false,
      "call summaries never reach the translation prompt"
    );
    assert.equal(
      prompt.includes("Customer may cancel"),
      false,
      "non-identifier key facts never reach the translation prompt"
    );
    assert.ok(prompt.includes("Auchan"), "the spelling glossary keeps the contact name");
    assert.ok(prompt.includes("F-2211"), "the spelling glossary keeps identifiers");
    assert.equal(
      prompt.split(currentUtterance).length - 1,
      1,
      "the current utterance appears exactly once, in the translate slot"
    );
    assert.ok(prompt.includes("Buenos días."), "previous utterances remain as history");

    await defaultTranslationRequester({
      config: { ...makeConfig(), liveTranslationTextModel: "gpt-5.4-mini" },
      sourceText: "Hola.",
      sourceLanguage: "es",
      targetLanguage: "en",
      recentSourceUtterances: [],
      context: {},
    });
    const legacyBody = JSON.parse(captured[1].options.body);
    assert.equal(
      "reasoning" in legacyBody,
      false,
      "pre-5.6 models never receive the reasoning parameter"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runSpanishFixturePathTest() {
  // Synthetic, non-customer Spanish fixture that follows the real path:
  // known 8 kHz PCM → reference G.711 μ-law encoding → Twilio-style WebSocket
  // messages → the worker's actual decoder/resampler/VAD → provider events
  // carrying the fixture text → cascade translation → Convex rows. The
  // production speech threshold (550) is used deliberately: with the broken
  // decoder this audio decoded ~16× too quiet and was classified as silence.
  const fixture = SPANISH_FIXTURES.find((item) => item.id === "brand-and-time");
  assert.ok(fixture, "Spanish fixture set contains the brand-and-time case");

  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const config = {
    ...makeConfig(),
    translationPipeline: "cascade",
    translationDrainMs: 50,
    transcriptionSilenceMs: 30,
    transcriptionSpeechThreshold: 550,
  };
  const translated = "Tomorrow I am going to Pingo Doce at twelve.";
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    openAiSocketFactory,
    translationRequester: async ({ sourceText }) => {
      assert.equal(sourceText, fixture.source, "the fixture transcript reaches the translator verbatim");
      return translated;
    },
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart("MZFIXTURE", "CAFIXTURE", "call_fixture", "workspace_fixture")
  );
  await waitForMicrotasks();
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  // 500 ms of 440 Hz speech-level telephone audio in 20 ms frames.
  const amplitude = 3000;
  for (let frame = 0; frame < 25; frame += 1) {
    const samples = [];
    for (let i = 0; i < 160; i += 1) {
      const t = frame * 160 + i;
      samples.push(Math.round(amplitude * Math.sin((2 * Math.PI * 440 * t) / 8000)));
    }
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "media",
          media: { track: "outbound", payload: encodePcm8kToMuLawBase64(samples) },
        })
      )
    );
  }
  const appends = openAiSockets[0].sent.filter(
    (event) => event.type === "input_audio_buffer.append"
  );
  assert.equal(appends.length, 25, "every speech frame reaches the provider");
  const decodedRms = pcm16Rms(appends[10].audio);
  const expectedRms = amplitude / Math.SQRT2;
  assert.ok(
    Math.abs(decodedRms - expectedRms) / expectedRms < 0.05,
    `decoded telephone audio keeps its loudness through decode+resample (got ${decodedRms.toFixed(0)}, expected ~${expectedRms.toFixed(0)})`
  );
  assert.ok(
    decodedRms >= config.transcriptionSpeechThreshold,
    "speech-level audio is classified as speech at the production threshold"
  );
  assert.equal(connection.preReadyDroppedFrames.transcription, 0, "zero pre-ready dropped frames");

  // Silence long enough (wall clock) for the energy VAD to commit.
  await sleep(50);
  const silence = new Array(160).fill(0);
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "media",
        media: { track: "outbound", payload: encodePcm8kToMuLawBase64(silence) },
      })
    )
  );
  assert.equal(
    openAiSockets[0].sent.some((event) => event.type === "input_audio_buffer.commit"),
    true,
    "the energy VAD commits the utterance after real silence"
  );

  openAiSockets[0].onEvent({ type: "input_audio_buffer.committed", item_id: "item_fixture" });
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "item_fixture",
    delta: "Mañana",
  });
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_fixture",
    transcript: fixture.source,
    logprobs: [{ logprob: -0.05 }],
  });
  await sleep(10);

  const segment = mutations.find(
    (item) => item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)
  );
  assert.equal(segment?.args.sourceText, fixture.source);
  assert.equal(segment?.args.translatedText, translated);
  for (const forbidden of fixture.forbidden) {
    assert.equal(
      segment?.args.translatedText.toLowerCase().includes(forbidden),
      false,
      `the caption never contains the forbidden fixture term "${forbidden}"`
    );
  }
}

function runAudioConversionTest() {
  // Every one of the 256 μ-law codes must decode to the committed G.711
  // reference value (generated with FFmpeg). The first upsampled sample is
  // the raw decode of the code itself.
  for (let code = 0; code < 256; code += 1) {
    const pcm = Buffer.from(
      decodeMuLawBase64ToPcm24Base64(Buffer.from([code]).toString("base64")),
      "base64"
    );
    assert.equal(pcm.length, 6, "upsamples 8 kHz mu-law to 24 kHz PCM16");
    assert.equal(
      pcm.readInt16LE(0),
      G711_ULAW_DECODE_TABLE[code],
      `mu-law code 0x${code.toString(16)} decodes to the G.711 reference value`
    );
  }
  // The documented production defect: FFmpeg decodes 0x9f as 8316; the broken
  // decoder produced 512 and starved speech recognition.
  assert.equal(G711_ULAW_DECODE_TABLE[0x9f], 8316);

  // Monotonicity across every exponent boundary: negative codes 0x00..0x7f
  // rise strictly toward zero; positive codes 0x80..0xff fall strictly to
  // zero; and the two halves are sign-symmetric.
  for (let code = 1; code <= 0x7f; code += 1) {
    assert.ok(
      G711_ULAW_DECODE_TABLE[code] > G711_ULAW_DECODE_TABLE[code - 1],
      `negative mu-law codes decode strictly monotonically at 0x${code.toString(16)}`
    );
  }
  for (let code = 0x81; code <= 0xff; code += 1) {
    assert.ok(
      G711_ULAW_DECODE_TABLE[code] < G711_ULAW_DECODE_TABLE[code - 1],
      `positive mu-law codes decode strictly monotonically at 0x${code.toString(16)}`
    );
  }
  for (let code = 0; code < 128; code += 1) {
    // `+ 0` normalizes -0 so the zero codes 0x7f/0xff compare equal.
    assert.equal(
      G711_ULAW_DECODE_TABLE[code] + 0,
      -G711_ULAW_DECODE_TABLE[code + 128] + 0,
      "mu-law decoding is sign-symmetric"
    );
  }

  // The upsampler linearly interpolates between decoded 8 kHz samples
  // (repeating samples creates aliasing images above 4 kHz).
  const converted = Buffer.from(
    decodeMuLawBase64ToPcm24Base64(Buffer.from([0x9f, 0xff]).toString("base64")),
    "base64"
  );
  const samples = [];
  for (let offset = 0; offset < converted.length; offset += 2) {
    samples.push(converted.readInt16LE(offset));
  }
  assert.deepEqual(
    samples,
    [8316, 5544, 2772, 0, 0, 0],
    "upsampler linearly interpolates between 8 kHz samples"
  );

  // Waveform round-trip: an 8 kHz sine encoded with the reference compressor
  // must keep its loudness through decode+resample. The broken decoder
  // collapsed this to a fraction of the input level.
  const amplitude = 8000;
  const sine = [];
  for (let i = 0; i < 1600; i += 1) {
    sine.push(Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / 8000)));
  }
  const rms = pcm16Rms(decodeMuLawBase64ToPcm24Base64(encodePcm8kToMuLawBase64(sine)));
  const expectedRms = amplitude / Math.SQRT2;
  assert.ok(
    Math.abs(rms - expectedRms) / expectedRms < 0.05,
    `sine round-trip RMS stays within 5% of the input level (got ${rms.toFixed(0)}, expected ~${expectedRms.toFixed(0)})`
  );
}

function runOutboundAudioConversionTest() {
  // Round-trip every G.711 code through the new production encoder
  // (encodePcm24Base64ToMuLawBase64, the bridge media-path skeleton's
  // outbound counterpart to decodeMuLawBase64ToPcm24Base64). Build the 24kHz
  // input so decimation recovers the decoded sample exactly, isolating the
  // encoder's own quantization from the (already separately verified)
  // decoder's upsample.
  for (let code = 0; code < 256; code += 1) {
    // 0x7f and 0xff both decode to zero (the codec's two zero-crossing
    // representations, already normalized with "+ 0" in the decode test
    // above) — a standard encoder can only produce one of them for input 0,
    // and always picks the positive-zero code. Not a bug; skip it here.
    if (code === 0x7f) continue;
    const sample = G711_ULAW_DECODE_TABLE[code];
    const pcm24 = Buffer.alloc(6);
    pcm24.writeInt16LE(sample, 0);
    pcm24.writeInt16LE(sample, 2);
    pcm24.writeInt16LE(sample, 4);
    const reencoded = Buffer.from(
      encodePcm24Base64ToMuLawBase64(pcm24.toString("base64")),
      "base64"
    );
    assert.equal(
      reencoded.length,
      1,
      "downsamples 24 kHz PCM16 back to 8 kHz mu-law, one byte per 3 samples"
    );
    assert.equal(
      reencoded[0],
      code,
      `mu-law code 0x${code.toString(16)} round-trips through decode then re-encode`
    );
  }
}

function runConfidenceMathTest() {
  assert.equal(transcriptionConfidenceFromLogprobs(undefined), undefined);
  assert.equal(transcriptionConfidenceFromLogprobs([]), undefined);
  assert.equal(transcriptionConfidenceFromLogprobs([{ token: "a" }]), undefined);
  const value = transcriptionConfidenceFromLogprobs([{ logprob: -0.1 }, { logprob: -0.3 }]);
  assert.ok(Math.abs(value - Math.exp(-0.2)) < 1e-9, "confidence is the geometric-mean token probability");
  assert.equal(transcriptionConfidenceFromLogprobs([{ logprob: 0 }]), 1);
}

function runSourceWindowUnitTest() {
  const deltas = [
    { text: "Hola señor. ", elapsedMs: 500 },
    { text: "Segunda", elapsedMs: 2400 },
    { text: " frase.", elapsedMs: 3000 },
  ];
  const window = consumeSourceDeltasForWindow(deltas, 1000, 1000);
  assert.equal(window.text, "Hola señor. ");
  assert.equal(window.consumedCount, 1);
  const everything = consumeSourceDeltasForWindow(deltas, Number.NaN, 1000);
  assert.equal(everything.consumedCount, 3, "an unknown window falls back to full consumption");
  const untimed = consumeSourceDeltasForWindow(
    [{ text: "sin tiempo", elapsedMs: Number.NaN }],
    1000,
    1000
  );
  assert.equal(untimed.consumedCount, 1, "deltas without elapsed_ms cannot be windowed out");
}

function runCascadeGlossaryTest() {
  const glossary = buildCascadeGlossary({
    prep: {
      contactName: "Pingo Doce Support",
      keyFacts: [
        { type: "invoice_number", label: "Invoice", value: "F-2211" },
        { type: "risk_flag", label: "Risk", value: "Customer may cancel" },
        { type: "amount", label: "Amount", value: "1250.50 EUR" },
      ],
      openActionItems: [{ title: "Chase refund" }],
      reviewedCallMemories: [{ summary: "Secret summary" }],
    },
  });
  assert.deepEqual(
    glossary,
    ["Pingo Doce Support", "F-2211"],
    "the glossary keeps only explicit names and identifier spellings"
  );
  assert.deepEqual(buildCascadeGlossary(undefined), [], "missing context yields an empty glossary");
  assert.equal(modelUsesMinimalReasoning("gpt-5.6-luna"), true);
  assert.equal(modelUsesMinimalReasoning("gpt-5.6-terra"), true);
  assert.equal(modelUsesMinimalReasoning("gpt-5.4-mini"), false);
  assert.equal(modelUsesMinimalReasoning("gpt-realtime-translate"), false);
}

async function runAudioNativeGuidanceTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ reference, args });
      if (args.realtimeSessionId === "guidance_session" && args.secret) {
        return { version: "test", call: { objective: "Confirm the renewal date" } };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  new TwilioRealtimeConnection({
    socket,
    convex,
    config: {
      ...makeConfig(),
      liveGuidancePipeline: "audio_native",
      liveGuidanceTextModel: "gpt-realtime-2.1",
      liveGuidanceReasoningEffort: "low",
      liveGuidanceMinIntervalMs: 0,
      liveGuidanceSilenceMs: 0,
      liveGuidanceMaxTurnMs: 12000,
    },
    openAiSocketFactory: makeOpenAiSocketFactory(openAiSockets),
    logger: () => {},
  });

  socket.emit("message", Buffer.from(JSON.stringify({
    event: "start",
    start: {
      streamSid: "MZ_GUIDANCE",
      callSid: "CA_GUIDANCE",
      customParameters: {
        voxandraCallId: "call_guidance",
        workspaceId: "workspace_guidance",
        liveCopilot: "true",
        translatedCaptions: "false",
        humanCopilotRealtimeSessionId: "guidance_session",
      },
    },
  })));
  await waitForMicrotasks();
  await waitForMicrotasks();

  assert.equal(openAiSockets.length, 1, "audio-native Guidance opens one persistent realtime socket");
  assert.match(openAiSockets[0].url, /gpt-realtime-2\.1/);
  const sessionUpdate = openAiSockets[0].sent.find((event) => event.type === "session.update");
  assert.deepEqual(sessionUpdate.session.output_modalities, ["text"]);
  assert.equal(sessionUpdate.session.reasoning.effort, "low");
  assert.equal(sessionUpdate.session.audio.input.turn_detection, null);
  assert.deepEqual(
    sessionUpdate.session.tools.map((tool) => tool.name),
    ["emit_guidance", "wait_for_guidance"]
  );

  for (const track of ["inbound", "outbound"]) {
    socket.emit("message", Buffer.from(JSON.stringify({
      event: "media", media: { track, payload: LOUD_MULAW_PAYLOAD },
    })));
    socket.emit("message", Buffer.from(JSON.stringify({
      event: "media", media: { track, payload: SILENT_MULAW_PAYLOAD },
    })));
  }
  await waitForMicrotasks();
  const speakerMarkers = openAiSockets[0].sent
    .filter((event) => event.type === "conversation.item.create")
    .flatMap((event) => event.item.content || [])
    .filter((content) => content.type === "input_text")
    .map((content) => content.text);
  assert.deepEqual(
    speakerMarkers,
    ["[Speaker: Voxandra user]", "[Speaker: Other person]"],
    "both Twilio directions become separate explicitly labeled realtime turns"
  );
  assert.equal(
    openAiSockets[0].sent.filter((event) => event.type === "response.create").length,
    1,
    "overlapping speaker turns queue model decisions instead of creating concurrent responses"
  );

  openAiSockets[0].onEvent({
    type: "response.done",
    response: {
      usage: {
        input_tokens: 120,
        output_tokens: 20,
        input_token_details: { cached_tokens: 80 },
      },
      output: [{
        type: "function_call",
        name: "emit_guidance",
        arguments: JSON.stringify({
          label: "Confirm the renewal date",
          detail: "The date is still unresolved.",
          trigger_reason: "Open objective",
          urgency: "important",
          evidence: "The other person discussed renewal without a date.",
        }),
      }],
    },
  });
  await waitForMicrotasks();
  assert.equal(
    mutations.some((item) => item.args.label === "Confirm the renewal date"),
    true,
    "structured realtime tool output writes private Guidance"
  );
  assert.equal(
    openAiSockets[0].sent.filter((event) => event.type === "response.create").length,
    2,
    "the queued second-speaker decision starts after response.done"
  );
}

async function startAudioNativeGuidance({ mutationHook } = {}) {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      const record = { reference, args, name: getFunctionName(reference) };
      mutations.push(record);
      if (mutationHook) {
        const result = mutationHook(record);
        if (result !== undefined) return result;
      }
      if (args.realtimeSessionId === "guidance_session" && args.secret) {
        return { version: "test", call: { objective: "Confirm the renewal date" } };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: {
      ...makeConfig(),
      liveGuidancePipeline: "audio_native",
      liveGuidanceTextModel: "gpt-realtime-2.1",
      liveGuidanceReasoningEffort: "low",
      liveGuidanceMinIntervalMs: 0,
      liveGuidanceSilenceMs: 0,
      liveGuidanceMaxTurnMs: 12000,
    },
    openAiSocketFactory: makeOpenAiSocketFactory(openAiSockets),
    logger: () => {},
  });
  socket.emit("message", Buffer.from(JSON.stringify({
    event: "start",
    start: {
      streamSid: "MZ_GUIDANCE",
      callSid: "CA_GUIDANCE",
      customParameters: {
        voxandraCallId: "call_guidance",
        workspaceId: "workspace_guidance",
        liveCopilot: "true",
        translatedCaptions: "false",
        humanCopilotRealtimeSessionId: "guidance_session",
      },
    },
  })));
  await waitForMicrotasks();
  await waitForMicrotasks();
  return { connection, mutations, openAiSockets };
}

async function runGuidanceWriteFailureToleranceTest() {
  let guidanceWrites = 0;
  const { connection, mutations, openAiSockets } = await startAudioNativeGuidance({
    mutationHook: ({ name }) => {
      if (name === getFunctionName(api.callGuidance.addRealtimeGuidanceItemFromWorker)) {
        guidanceWrites += 1;
        if (guidanceWrites === 1) throw new Error("transient convex failure");
      }
      if (name === getFunctionName(api.realtimeRuntime.recordCallUtteranceFromWorker)) {
        throw new Error("transient convex failure");
      }
      return undefined;
    },
  });

  const emitGuidanceResponse = (label) => ({
    type: "response.done",
    response: {
      usage: { input_tokens: 10, output_tokens: 5, input_token_details: { cached_tokens: 0 } },
      output: [{
        type: "function_call",
        name: "emit_guidance",
        arguments: JSON.stringify({
          label,
          trigger_reason: "Open objective",
          urgency: "normal",
          evidence: "Renewal discussed without a date.",
        }),
      }],
    },
  });

  openAiSockets[0].onEvent(emitGuidanceResponse("Confirm the renewal date"));
  await waitForMicrotasks();
  assert.equal(guidanceWrites, 1, "the first guidance write was attempted");
  assert.equal(connection.guidanceStats.emitted, 0, "a failed write is not counted as emitted");

  // A rejected fire-and-forget utterance write must be caught, not crash the
  // process (an escaped rejection would abort this test run).
  openAiSockets[0].onEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "guidance_audio_1",
    transcript: "Hola",
  });
  await waitForMicrotasks();

  openAiSockets[0].onEvent(emitGuidanceResponse("Confirm the renewal date"));
  await waitForMicrotasks();
  assert.equal(guidanceWrites, 2, "the failed label was un-deduped and re-emitted");
  assert.equal(connection.guidanceStats.emitted, 1, "the retried emission succeeded");
  assert.equal(
    mutations.some(
      (item) =>
        item.name === getFunctionName(api.realtimeRuntime.finishRealtimeSessionFromWorker)
    ),
    false,
    "transient Convex failures never fail the Guidance session"
  );
}

async function runGuidanceReconnectTest() {
  const { mutations, openAiSockets } = await startAudioNativeGuidance();

  openAiSockets[0].onClose({ closedByUs: true });
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 1, "an intentional close never triggers reconnection");

  openAiSockets[0].onClose({ closedByUs: false });
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 2, "the first unexpected drop reconnects");
  assert.equal(
    openAiSockets[1].sent.some((event) => event.type === "session.update"),
    true,
    "the reconnected session is reconfigured"
  );

  openAiSockets[0].onClose({ closedByUs: false });
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 2, "callbacks from a replaced socket generation are fenced");

  openAiSockets[1].onError(new Error("socket reset"));
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 3, "the second drop uses the remaining reconnect budget");

  openAiSockets[2].onClose({ closedByUs: false });
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 3, "the reconnect budget is bounded");
  const failedFinish = mutations.find(
    (item) =>
      item.name === getFunctionName(api.realtimeRuntime.finishRealtimeSessionFromWorker) &&
      item.args.status === "failed"
  );
  assert.ok(failedFinish, "exhausting the reconnect budget fails only the Guidance session");
}

async function runGuidanceProviderErrorPolicyTest() {
  const { mutations, openAiSockets } = await startAudioNativeGuidance();
  const transientError = {
    type: "error",
    error: { type: "server_error", message: "provider blip" },
  };

  openAiSockets[0].onEvent(transientError);
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 1, "one transient provider error keeps the session");

  openAiSockets[0].onEvent({ type: "response.done", response: { usage: {}, output: [] } });
  await waitForMicrotasks();
  openAiSockets[0].onEvent(transientError);
  openAiSockets[0].onEvent(transientError);
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 1, "a completed decision resets the error streak");

  openAiSockets[0].onEvent(transientError);
  await waitForMicrotasks();
  assert.equal(
    openAiSockets.length,
    2,
    "three consecutive transient errors trigger one bounded reconnect"
  );

  openAiSockets[1].onEvent({
    type: "error",
    error: { type: "authentication_error", message: "invalid key" },
  });
  await waitForMicrotasks();
  assert.equal(openAiSockets.length, 2, "terminal errors never reconnect");
  const failedFinish = mutations.find(
    (item) =>
      item.name === getFunctionName(api.realtimeRuntime.finishRealtimeSessionFromWorker) &&
      item.args.status === "failed"
  );
  assert.ok(failedFinish, "a terminal provider error fails the Guidance session immediately");
}

function runAudioForwardAllowlistUnitTest() {
  assert.equal(
    shouldForwardTranslationAudio({ translationAudioForwardWorkspaceIds: [] }, "workspace_1"),
    false,
    "an empty allowlist forwards for nobody"
  );
  assert.equal(
    shouldForwardTranslationAudio(
      { translationAudioForwardWorkspaceIds: ["workspace_1"] },
      "workspace_1"
    ),
    true,
    "a listed workspace forwards"
  );
  assert.equal(
    shouldForwardTranslationAudio(
      { translationAudioForwardWorkspaceIds: ["workspace_1"] },
      "workspace_2"
    ),
    false,
    "an unlisted workspace never forwards"
  );

  assert.equal(
    isAllowedBrowserAudioStreamOrigin({}, "http://localhost:3000"),
    true,
    "the default dev origin is allowed with no config override"
  );
  assert.equal(
    isAllowedBrowserAudioStreamOrigin({}, "https://evil.example"),
    false,
    "an unrecognized origin is rejected"
  );
  assert.equal(
    isAllowedBrowserAudioStreamOrigin(
      { browserAudioStreamOrigins: ["https://voxandra.com"] },
      "https://voxandra.com"
    ),
    true,
    "a configured production origin is allowed"
  );

  assert.equal(
    shouldEchoTestAudio({ echoTestWorkspaceIds: [] }, "workspace_1"),
    false,
    "an empty echo-test allowlist echoes for nobody"
  );
  assert.equal(
    shouldEchoTestAudio({ echoTestWorkspaceIds: ["workspace_1"] }, "workspace_1"),
    true,
    "a listed workspace is echo-test eligible"
  );
  assert.equal(
    shouldEchoTestAudio({ echoTestWorkspaceIds: ["workspace_1"] }, "workspace_2"),
    false,
    "an unlisted workspace is never echo-test eligible"
  );
}

async function runBrowserAudioForwardTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: "translation_segment_audio_forward" };
      }
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const config = {
    ...makeConfig(),
    translationAudioForwardWorkspaceIds: ["workspace_audio_forward"],
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart(
      "MZAUDIO",
      "CAAUDIO",
      "call_audio_forward",
      "workspace_audio_forward"
    )
  );
  await waitForMicrotasks();
  assert.equal(
    connection.forwardTranslationAudio,
    true,
    "a workspace on the audio-forward allowlist enables forwarding"
  );

  const browserSocket = new FakeBrowserSocket();
  connection.attachBrowserAudioSocket(browserSocket);
  assert.equal(browserSocket.sent.length, 1, "attaching sends a ready frame");
  assert.equal(browserSocket.sent[0].type, "translation_audio_ready");

  openAiSockets[0].onEvent({ type: "session.created", session: { id: "s" } });
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  openAiSockets[0].onEvent({
    type: "session.output_audio.delta",
    delta: "AAECAw==",
    elapsed_ms: 120,
  });
  await waitForMicrotasks();

  const deltaFrames = browserSocket.sent.filter(
    (frame) => frame.type === "translation_audio_delta"
  );
  assert.equal(deltaFrames.length, 1, "the audio delta is relayed to the attached browser socket");
  assert.equal(deltaFrames[0].payload, "AAECAw==", "the base64 payload passes through unmodified");
  assert.equal(deltaFrames[0].sequence, 1, "frames are sequenced from 1");
  assert.equal(
    connection.translationTargetBuffer,
    "",
    "an audio delta never touches the caption buffer"
  );
  assert.equal(
    mutations.some(
      (item) =>
        item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)
    ),
    false,
    "an audio-only delta writes no caption segment"
  );

  openAiSockets[0].onEvent({
    type: "session.output_transcript.delta",
    delta: "Captions keep working.",
  });
  await waitForMicrotasks();
  await connection.requestTranslationFlush(true, "test_boundary");
  await waitForMicrotasks();

  assert.equal(
    mutations.some(
      (item) =>
        item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker) &&
        item.args.translatedText === "Captions keep working."
    ),
    true,
    "captions keep flowing normally alongside audio forwarding"
  );

  socket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();

  const endFrame = browserSocket.sent.find((frame) => frame.type === "translation_audio_end");
  assert.ok(endFrame, "closing the call notifies attached browser sockets");
  assert.equal(browserSocket.closed, true, "closing the call closes attached browser sockets");
}

async function runBrowserAudioForwardDisabledTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const openAiSockets = [];
  const openAiSocketFactory = makeOpenAiSocketFactory(openAiSockets);
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    openAiSocketFactory,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    makeTranslationOnlyStart(
      "MZNOAUDIO",
      "CANOAUDIO",
      "call_no_audio_forward",
      "workspace_not_allowlisted"
    )
  );
  await waitForMicrotasks();
  assert.equal(
    connection.forwardTranslationAudio,
    false,
    "a workspace not on the allowlist never forwards audio"
  );

  const browserSocket = new FakeBrowserSocket();
  connection.attachBrowserAudioSocket(browserSocket);

  openAiSockets[0].onEvent({ type: "session.created", session: { id: "s" } });
  openAiSockets[0].onEvent({ type: "session.updated", session: { id: "s" } });
  await waitForMicrotasks();

  openAiSockets[0].onEvent({
    type: "session.output_audio.delta",
    delta: "AAECAw==",
    elapsed_ms: 120,
  });
  await waitForMicrotasks();

  assert.equal(
    browserSocket.sent.some((frame) => frame.type === "translation_audio_delta"),
    false,
    "a non-allowlisted workspace never relays audio even to an attached socket"
  );
}

await runAudioNativeGuidanceTest();
await runGuidanceWriteFailureToleranceTest();
await runGuidanceReconnectTest();
await runGuidanceProviderErrorPolicyTest();
// ---------------------------------------------------------------------------
// Media Stream authentication. Twilio does not sign Media Stream connections,
// so before this gate any client reaching the worker's hostname could forge a
// `start` naming any callId/workspaceId (spend provider money, write captions
// into someone else's live call, or hold sockets to exhaust maxStreams).
// ---------------------------------------------------------------------------

const STREAM_TEST_SECRET = "test-stream-signing-secret";

function makeStreamAuthConfig(overrides = {}) {
  return { ...makeConfig(), streamSigningSecret: STREAM_TEST_SECRET, ...overrides };
}

function emitStart(socket, customParameters, { streamSid = "MZAUTH", callSid = "CAAUTH" } = {}) {
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "start", start: { streamSid, callSid, customParameters } })
    )
  );
}

// A convex fake whose query() answers the call-SID binding against a fixed
// truth table, and whose mutation() records everything the worker writes so a
// rejected stream can be proven to have written nothing.
function makeBindingConvex({ bound }) {
  const mutations = [];
  const queries = [];
  return {
    mutations,
    queries,
    async query(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      queries.push({ reference, args });
      const expectedSid = bound[`${args.callId}:${args.legRole}`];
      if (!expectedSid) return { ok: false, reason: "call_not_found" };
      if (expectedSid !== args.providerCallSid) return { ok: false, reason: "call_sid_mismatch" };
      return { ok: true };
    },
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ reference, args });
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: "translation_segment_auth" };
      }
      return { ok: true };
    },
  };
}

async function runStreamSignatureUnitTest() {
  const params = {
    voxandraCallId: "call_1",
    workspaceId: "workspace_1",
    liveCopilot: "false",
    translatedCaptions: "true",
  };
  const now = 1_700_000_000_000;
  const signed = signMediaStreamParams(params, STREAM_TEST_SECRET, { now, ttlMs: 60_000 });
  assert.equal(signed.streamSignatureExpiresAt, String(now + 60_000), "expiry is embedded");
  assert.match(signed.streamSignature, /^[0-9a-f]{64}$/, "signature is hex sha256");
  assert.deepEqual(
    verifyMediaStreamSignature(signed, STREAM_TEST_SECRET, now + 1000),
    { ok: true },
    "a fresh, untouched signature verifies"
  );
  // Twilio may reorder parameters; the canonical form must not care.
  const reordered = Object.fromEntries(Object.entries(signed).reverse());
  assert.equal(
    verifyMediaStreamSignature(reordered, STREAM_TEST_SECRET, now + 1000).ok,
    true,
    "parameter order does not affect verification"
  );
  assert.equal(
    verifyMediaStreamSignature(signed, STREAM_TEST_SECRET, now + 60_001).ok,
    false,
    "an expired signature is rejected"
  );
  assert.equal(
    verifyMediaStreamSignature(signed, STREAM_TEST_SECRET, now + 60_001).reason,
    "expired"
  );
  assert.deepEqual(
    verifyMediaStreamSignature({ ...signed, workspaceId: "workspace_2" }, STREAM_TEST_SECRET, now),
    { ok: false, reason: "invalid_signature" },
    "changing any covered parameter invalidates the signature"
  );
  assert.deepEqual(
    verifyMediaStreamSignature({ ...signed, extra: "1" }, STREAM_TEST_SECRET, now),
    { ok: false, reason: "invalid_signature" },
    "adding a parameter invalidates the signature (every parameter is covered)"
  );
  assert.deepEqual(
    verifyMediaStreamSignature(signed, "other-secret", now),
    { ok: false, reason: "invalid_signature" },
    "a different secret does not verify"
  );
  assert.deepEqual(
    verifyMediaStreamSignature(params, STREAM_TEST_SECRET, now),
    { ok: false, reason: "missing_signature" }
  );
  const withoutExpiry = { ...signed };
  delete withoutExpiry.streamSignatureExpiresAt;
  assert.deepEqual(
    verifyMediaStreamSignature(withoutExpiry, STREAM_TEST_SECRET, now),
    { ok: false, reason: "missing_expiry" }
  );
  assert.throws(() => signMediaStreamParams(params, ""), /secret is required/);
}

// The Next.js TwiML routes sign with src/lib/realtime/stream-signature.ts; the
// worker verifies with scripts/realtime-media-worker-stream-auth.mjs. They are
// hand-mirrored (the worker cannot import TypeScript), so prove they agree
// byte-for-byte on the same input or every real call would be rejected.
async function runStreamSignatureMirrorsNextJsImplementationTest() {
  const { transformSync } = await import("esbuild");
  const tsPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "lib",
    "realtime",
    "stream-signature.ts"
  );
  const { code } = transformSync(readFileSync(tsPath, "utf8"), { loader: "ts", format: "esm" });
  const nextJsImpl = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const params = {
    voxandraCallId: "call_parity",
    workspaceId: "workspace_parity",
    bridgeLeg: "callee",
    translationSourceLanguage: "es",
    translationTargetLanguage: "en",
    maxSessionSeconds: "300",
    "unicode value": "olá — 你好",
  };
  const now = 1_700_000_000_000;
  const fromNext = nextJsImpl.signMediaStreamParams(params, STREAM_TEST_SECRET, { now });
  const fromWorker = signMediaStreamParams(params, STREAM_TEST_SECRET, { now });
  assert.deepEqual(fromNext, fromWorker, "TS and worker signers produce identical output");
  assert.equal(
    verifyMediaStreamSignature(fromNext, STREAM_TEST_SECRET, now).ok,
    true,
    "worker verifies what the Next.js side signed"
  );
  assert.equal(
    nextJsImpl.verifyMediaStreamSignature(fromWorker, STREAM_TEST_SECRET, now).ok,
    true,
    "Next.js side verifies what the worker signed"
  );
  assert.equal(
    nextJsImpl.STREAM_SIGNATURE_TTL_MS,
    STREAM_SIGNATURE_TTL_MS,
    "both sides agree on the signature TTL"
  );
}

function runStreamAuthConfigTest() {
  const base = {
    OPENAI_API_KEY: "k",
    CONVEX_URL: "https://x.convex.cloud",
    REALTIME_CONVEX_WORKER_SECRET: "s",
  };
  assert.throws(
    () => validateWorkerConfig(buildWorkerConfig(base)),
    /REALTIME_STREAM_SIGNING_SECRET/,
    "the real server refuses to start without a signing secret"
  );
  const signedConfig = buildWorkerConfig({ ...base, REALTIME_STREAM_SIGNING_SECRET: "sig" });
  validateWorkerConfig(signedConfig);
  assert.equal(isStreamAuthEnabled(signedConfig), true);
  const unsignedConfig = buildWorkerConfig({ ...base, REALTIME_ALLOW_UNSIGNED_STREAMS: "true" });
  validateWorkerConfig(unsignedConfig);
  assert.equal(isStreamAuthEnabled(unsignedConfig), false, "explicit escape hatch disables auth");
  assert.equal(signedConfig.maxStreams, 40, "default stream cap raised from the QA-era 10");
  assert.equal(signedConfig.maxPendingStreamsPerIp, 4);
  assert.equal(signedConfig.streamStartTimeoutMs, 5000);
  // Fingerprint must never include the secret, and must not change when only
  // the secret changes (so a rotation is not mistaken for a config drift).
  assert.equal(
    computeConfigFingerprint(signedConfig),
    computeConfigFingerprint({ ...signedConfig, streamSigningSecret: "rotated" }),
    "config fingerprint excludes the stream signing secret"
  );

  const proxied = { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(
    resolveClientAddress(proxied, { trustProxyHeaders: false }),
    "127.0.0.1",
    "X-Forwarded-For is ignored unless a trusted proxy is declared"
  );
  assert.equal(
    resolveClientAddress(proxied, { trustProxyHeaders: true }),
    "203.0.113.9",
    "the first X-Forwarded-For hop is used behind a trusted proxy"
  );
}

async function runStreamAuthRejectsUnsignedStartTest() {
  const socket = new FakeSocket();
  let closed = false;
  socket.close = () => {
    closed = true;
  };
  const convex = makeBindingConvex({ bound: {} });
  const logs = [];
  let registered = false;
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeStreamAuthConfig(),
    openAiSocketFactory: makeOpenAiSocketFactory([]),
    logger: (level, message, details) => logs.push({ level, message, details }),
    onCallRegistered: () => {
      registered = true;
    },
  });
  emitStart(socket, {
    voxandraCallId: "call_forged",
    workspaceId: "workspace_victim",
    liveCopilot: "true",
    translatedCaptions: "true",
    humanCopilotRealtimeSessionId: "human_session",
    translatedCaptionsRealtimeSessionId: "translation_session",
  });
  await waitForMicrotasks();
  assert.equal(closed, true, "an unsigned start closes the socket");
  assert.equal(connection.ended, true);
  assert.equal(connection.streamAuthenticated, false);
  assert.equal(registered, false, "an unsigned start never registers in the call registry");
  assert.equal(convex.mutations.length, 0, "an unsigned start writes nothing to Convex");
  assert.equal(convex.queries.length, 0, "an unsigned start never even reaches the binding check");
  const rejection = logs.find((entry) => entry.message === "twilio_stream_rejected");
  assert.ok(rejection, "rejection is logged");
  assert.equal(rejection.details.reason, "signature_missing_signature");
  assert.equal(
    JSON.stringify(rejection.details).includes("workspace_victim"),
    false,
    "rejection log carries no parameter content"
  );
}

async function runStreamAuthRejectsTamperedAndStaleStartTest() {
  const legit = signMediaStreamParams(
    { voxandraCallId: "call_1", workspaceId: "workspace_1", liveCopilot: "false", translatedCaptions: "false" },
    STREAM_TEST_SECRET
  );
  const cases = [
    { name: "tampered", params: { ...legit, workspaceId: "workspace_2" }, reason: "signature_invalid_signature" },
    {
      name: "stale",
      params: signMediaStreamParams(
        { voxandraCallId: "call_1", workspaceId: "workspace_1" },
        STREAM_TEST_SECRET,
        { now: Date.now() - 2 * 60 * 60 * 1000 }
      ),
      reason: "signature_expired",
    },
  ];
  for (const testCase of cases) {
    const socket = new FakeSocket();
    const convex = makeBindingConvex({ bound: {} });
    const logs = [];
    new TwilioRealtimeConnection({
      socket,
      convex,
      config: makeStreamAuthConfig(),
      openAiSocketFactory: makeOpenAiSocketFactory([]),
      logger: (level, message, details) => logs.push({ message, details }),
    });
    emitStart(socket, testCase.params);
    await waitForMicrotasks();
    const rejection = logs.find((entry) => entry.message === "twilio_stream_rejected");
    assert.ok(rejection, `${testCase.name} start is rejected`);
    assert.equal(rejection.details.reason, testCase.reason, `${testCase.name} reason`);
    assert.equal(convex.queries.length, 0, `${testCase.name} never reaches Convex`);
  }
}

async function runStreamAuthBindsCallSidThroughConvexTest() {
  const params = signMediaStreamParams(
    {
      voxandraCallId: "call_bound",
      workspaceId: "workspace_bound",
      liveCopilot: "false",
      translatedCaptions: "true",
      translatedCaptionsRealtimeSessionId: "translation_session",
      translationTargetLanguage: "en",
    },
    STREAM_TEST_SECRET
  );

  // Replay: a valid, fresh parameter set presented by a socket whose Twilio
  // CallSid is not the call those parameters were minted for.
  {
    const socket = new FakeSocket();
    const convex = makeBindingConvex({ bound: { "call_bound:browser": "CAREAL" } });
    const logs = [];
    let registered = false;
    const connection = new TwilioRealtimeConnection({
      socket,
      convex,
      config: makeStreamAuthConfig(),
      openAiSocketFactory: makeOpenAiSocketFactory([]),
      logger: (level, message, details) => logs.push({ message, details }),
      onCallRegistered: () => {
        registered = true;
      },
    });
    emitStart(socket, params, { callSid: "CAREPLAY" });
    await waitForMicrotasks();
    await waitForMicrotasks();
    assert.equal(convex.queries.length, 1, "binding is checked exactly once");
    assert.deepEqual(
      convex.queries[0].args,
      {
        secret: "test-worker-secret",
        callId: "call_bound",
        workspaceId: "workspace_bound",
        providerCallSid: "CAREPLAY",
        legRole: "browser",
      },
      "binding check sends the Twilio-reported CallSid and this leg's role"
    );
    const rejection = logs.find((entry) => entry.message === "twilio_stream_rejected");
    assert.equal(rejection?.details.reason, "call_binding_call_sid_mismatch");
    assert.equal(connection.ended, true);
    assert.equal(registered, false, "a replayed start never registers");
    assert.equal(convex.mutations.length, 0, "a replayed start opens no session");
  }

  // Convex unreachable: fail closed rather than trust the socket.
  {
    const socket = new FakeSocket();
    const logs = [];
    const connection = new TwilioRealtimeConnection({
      socket,
      convex: {
        async query() {
          throw new Error("network down");
        },
        async mutation() {
          throw new Error("must not be called");
        },
      },
      config: makeStreamAuthConfig(),
      openAiSocketFactory: makeOpenAiSocketFactory([]),
      logger: (level, message, details) => logs.push({ message, details }),
    });
    emitStart(socket, params, { callSid: "CAREAL" });
    await waitForMicrotasks();
    await waitForMicrotasks();
    const rejection = logs.find((entry) => entry.message === "twilio_stream_rejected");
    assert.equal(rejection?.details.reason, "call_binding_unavailable");
    assert.equal(connection.ended, true, "binding errors fail closed");
  }

  // The genuine Twilio call: signed, fresh, and the CallSid matches.
  {
    const socket = new FakeSocket();
    const convex = makeBindingConvex({ bound: { "call_bound:browser": "CAREAL" } });
    const openAiSockets = [];
    const logs = [];
    let registered = false;
    let authenticatedWith;
    const connection = new TwilioRealtimeConnection({
      socket,
      convex,
      config: makeStreamAuthConfig(),
      openAiSocketFactory: makeOpenAiSocketFactory(openAiSockets),
      logger: (level, message, details) => logs.push({ message, details }),
      onCallRegistered: () => {
        registered = true;
      },
      onStreamAuthenticated: (value) => {
        authenticatedWith = value;
      },
    });
    emitStart(socket, params, { callSid: "CAREAL" });
    await waitForMicrotasks();
    await waitForMicrotasks();
    assert.equal(connection.streamAuthenticated, true);
    assert.equal(authenticatedWith, connection, "server is told the socket authenticated");
    assert.equal(registered, true, "a genuine start registers in the call registry");
    assert.equal(connection.ended, false);
    assert.ok(
      logs.some((entry) => entry.message === "twilio_stream_started"),
      "a genuine start proceeds to the normal start log"
    );
    assert.ok(
      openAiSockets.length >= 1,
      "a genuine start proceeds to open the translation provider session"
    );
    assert.equal(
      logs.some((entry) => entry.message === "twilio_stream_rejected"),
      false
    );
  }

  // Bridge callee leg binds against the callee SID, not the parent's.
  {
    const calleeParams = signMediaStreamParams(
      {
        voxandraCallId: "call_bridge",
        workspaceId: "workspace_bridge",
        bridgeLeg: "callee",
        liveCopilot: "false",
        translatedCaptions: "false",
        echoTestEnabled: "false",
      },
      STREAM_TEST_SECRET
    );
    const socket = new FakeSocket();
    const convex = makeBindingConvex({
      bound: { "call_bridge:browser": "CAPARENT", "call_bridge:callee": "CACALLEE" },
    });
    new TwilioRealtimeConnection({
      socket,
      convex,
      config: makeStreamAuthConfig(),
      openAiSocketFactory: makeOpenAiSocketFactory([]),
      logger: () => {},
    });
    emitStart(socket, calleeParams, { callSid: "CACALLEE" });
    await waitForMicrotasks();
    await waitForMicrotasks();
    assert.equal(convex.queries[0]?.args.legRole, "callee", "callee leg declares its role");
    assert.equal(convex.queries[0]?.args.providerCallSid, "CACALLEE");
  }
}

async function runStreamAuthEchoTestSkipsConvexBindingTest() {
  const socket = new FakeSocket();
  const convex = makeBindingConvex({ bound: {} });
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeStreamAuthConfig({ echoTestWorkspaceIds: ["workspace_echo"] }),
    openAiSocketFactory: makeOpenAiSocketFactory([]),
    logger: () => {},
  });
  emitStart(
    socket,
    signMediaStreamParams(
      {
        voxandraCallId: "internal_echo_test",
        workspaceId: "workspace_echo",
        liveCopilot: "false",
        translatedCaptions: "false",
        echoTestEnabled: "true",
      },
      STREAM_TEST_SECRET
    )
  );
  await waitForMicrotasks();
  assert.equal(connection.streamAuthenticated, true, "signed echo test authenticates");
  assert.equal(connection.echoTestActive, true);
  assert.equal(convex.queries.length, 0, "echo test has no Convex call row to bind against");

  // ...but the signature is still mandatory for it.
  const unsignedSocket = new FakeSocket();
  const unsigned = new TwilioRealtimeConnection({
    socket: unsignedSocket,
    convex,
    config: makeStreamAuthConfig({ echoTestWorkspaceIds: ["workspace_echo"] }),
    openAiSocketFactory: makeOpenAiSocketFactory([]),
    logger: () => {},
  });
  emitStart(unsignedSocket, {
    voxandraCallId: "internal_echo_test",
    workspaceId: "workspace_echo",
    echoTestEnabled: "true",
  });
  await waitForMicrotasks();
  assert.equal(unsigned.ended, true, "an unsigned echo-test start is still rejected");
  assert.equal(unsigned.echoTestActive, false);
}

// Real server, real sockets: unauthenticated connections are bounded per
// client address and by a start deadline, so a flood cannot hold maxStreams
// slots hostage, while a socket that authenticates promptly (as Twilio does)
// is released from the pending budget immediately.
async function runPendingStreamCapAndStartTimeoutTest() {
  const config = {
    ...makeStreamAuthConfig({
      echoTestWorkspaceIds: ["workspace_echo"],
      maxStreams: 40,
      maxPendingStreamsPerIp: 2,
      streamStartTimeoutMs: 150,
    }),
    port: 0,
  };
  const logs = [];
  const { httpServer, active } = createRealtimeMediaWorkerServer({
    config,
    convex: makeBindingConvex({ bound: {} }),
    logger: (level, message, details) => logs.push({ message, details }),
  });
  const port = await new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port));
  });
  const url = `ws://127.0.0.1:${port}/twilio/media-stream`;
  const openSocket = () =>
    new Promise((resolve) => {
      const ws = new WebSocket(url);
      const finish = (outcome) => resolve({ ws, outcome });
      ws.once("open", () => finish("open"));
      ws.once("error", () => finish("error"));
      ws.once("unexpected-response", () => finish("error"));
    });
  const waitForClose = (ws, timeoutMs = 2000) =>
    new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve(true);
      const timer = setTimeout(() => resolve(false), timeoutMs);
      ws.once("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

  try {
    // Two silent (never-authenticating) sockets fill this address's pending
    // budget; the third is refused at upgrade.
    const first = await openSocket();
    const second = await openSocket();
    assert.equal(first.outcome, "open");
    assert.equal(second.outcome, "open");
    const third = await openSocket();
    assert.equal(third.outcome, "error", "third pending socket from one address is refused");
    assert.ok(
      logs.some((entry) => entry.message === "twilio_stream_pending_cap_exceeded"),
      "pending cap refusal is logged"
    );

    // The silent sockets are evicted at the start deadline, freeing the budget.
    assert.equal(await waitForClose(first.ws), true, "silent socket is closed at the deadline");
    assert.equal(await waitForClose(second.ws), true);
    assert.ok(
      logs.some((entry) => entry.message === "twilio_stream_start_timeout"),
      "start timeout is logged"
    );
    await sleep(20);
    assert.equal(active.size, 0, "evicted sockets release their maxStreams slot");

    // A socket that authenticates promptly leaves the pending budget at once,
    // so it never counts against the next legitimate connection.
    const genuine = await openSocket();
    assert.equal(genuine.outcome, "open");
    genuine.ws.send(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZPENDING",
          callSid: "CAPENDING",
          customParameters: signMediaStreamParams(
            {
              voxandraCallId: "internal_echo_test",
              workspaceId: "workspace_echo",
              liveCopilot: "false",
              translatedCaptions: "false",
              echoTestEnabled: "true",
            },
            STREAM_TEST_SECRET
          ),
        },
      })
    );
    await sleep(50);
    const fourth = await openSocket();
    const fifth = await openSocket();
    assert.equal(fourth.outcome, "open", "authenticated socket no longer occupies pending budget");
    assert.equal(fifth.outcome, "open");
    // The authenticated socket must survive well past the start deadline.
    await sleep(config.streamStartTimeoutMs + 100);
    assert.equal(
      genuine.ws.readyState,
      WebSocket.OPEN,
      "an authenticated socket is not subject to the start deadline"
    );
    for (const { ws } of [genuine, fourth, fifth]) ws.close();
    await Promise.all([genuine, fourth, fifth].map(({ ws }) => waitForClose(ws)));
  } finally {
    await new Promise((resolve) => httpServer.close(() => resolve()));
  }
}

await runLifecycleTest();
await runTranslationFailureIsolationTest();
await runTranslationFlushFailureToleranceTest();
await runTranslationFlushPersistentFailureTest();
await runCascadeTranslationTest();
await runOutOfOrderCompletionTest();
await runPreReadyBufferingTest();
await runSourceTargetAlignmentTest();
await runSourcelessSuppressionTest();
await runCascadeTimeoutToleranceTest();
await runCascadePersistentRequestFailureTest();
await runCascadeLowConfidenceGateTest();
await runTranslationRequesterContractTest();
function runPalabraTaskUnitTest() {
  const task = buildPalabraTask("es", "en", 24000);
  assert.equal(task.input_stream.source.format, "pcm_s16le");
  assert.equal(task.input_stream.source.sample_rate, 24000);
  assert.equal(task.input_stream.source.channels, 1);
  assert.equal(task.output_stream.target.format, "pcm_s16le");
  assert.equal(task.pipeline.transcription.source_language, "es");
  assert.equal(task.pipeline.translations.length, 1);
  assert.equal(task.pipeline.translations[0].target_language, "en");
  assert.equal(
    task.pipeline.translations[0].speech_generation.voice_cloning,
    false,
    "voice cloning stays hard-off: no cloning consent surface exists"
  );
  assert.equal(
    task.pipeline.translations[0].speech_generation.voice_id,
    "default_low",
    "missing voice selections preserve Palabra's documented default_low behavior"
  );
  assert.equal(
    buildPalabraTask("en", "es", 24000, "female").pipeline.translations[0]
      .speech_generation.voice_id,
    "default_high",
    "female maps to Palabra's language-aware high-timbre built-in"
  );
  assert.equal(
    buildPalabraTask("en", "es", 24000, "unknown").pipeline.translations[0]
      .speech_generation.voice_id,
    "default_low",
    "unknown and old missing values fail safely to the production default"
  );
  assert.equal(
    buildPalabraTask(undefined, "en").pipeline.transcription.source_language,
    "auto",
    "a missing source language falls back to auto-detect"
  );

  assert.equal(
    buildPalabraTask("en", "es", 24000, "male", { palabraClonedVoiceId: "clone-123" }).pipeline
      .translations[0].speech_generation.voice_id,
    "clone-123",
    "a configured cloned voice overrides the generic male built-in"
  );
  assert.equal(
    buildPalabraTask("en", "es", 24000, "female", { palabraClonedVoiceId: "clone-123" }).pipeline
      .translations[0].speech_generation.voice_id,
    "default_high",
    "the cloned-voice override never applies to the female bucket"
  );
  assert.equal(
    buildPalabraTask("en", "es", 24000, "male").pipeline.translations[0].speech_generation
      .voice_id,
    "default_low",
    "no cloned voice configured means the generic built-in is used, unchanged"
  );
  assert.equal(
    buildPalabraTask("en", "es", 24000, "male", {
      palabraClonedVoiceId: "clone-123",
    }).pipeline.translations[0].speech_generation.voice_cloning,
    false,
    "voice_cloning itself stays hard-off even when referencing a pre-created clone by id — that flag is the separate, still-gated auto-clone-the-live-speaker behavior"
  );

  assert.equal(
    shouldUsePalabraTranslation({ translationPalabraWorkspaceIds: [] }, "workspace_1"),
    false,
    "an empty palabra allowlist selects palabra for nobody"
  );
  assert.equal(
    shouldUsePalabraTranslation(
      { translationPalabraWorkspaceIds: ["workspace_1"] },
      "workspace_1"
    ),
    true,
    "a listed workspace selects the palabra pipeline"
  );

  // Per-call REST session provisioning (2026-07-31): direct websocket
  // connections with the raw API key alias onto one implicit account-level
  // session, so the second bridge leg killed the first leg's task. Each leg
  // must request its own dedicated session.
  const sessionRequest = buildPalabraSessionRequest({
    palabraSessionApiUrl: "https://api.palabra.ai/session-storage/session",
    palabraApiKey: "test-key",
  });
  assert.equal(sessionRequest.url, "https://api.palabra.ai/session-storage/session");
  assert.equal(sessionRequest.method, "POST");
  assert.equal(sessionRequest.headers.Authorization, "Bearer test-key");
  assert.equal(sessionRequest.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(sessionRequest.body), { data: { subscriber_count: 0 } });
}

function makePalabraSocketFactory(palabraSockets) {
  return ({ url, onEvent, onError, onClose }) => {
    const fake = {
      url,
      sessionHash: "fakehash",
      sent: [],
      onEvent,
      onError,
      onClose,
      closed: false,
      sendJson(event) {
        this.sent.push(event);
      },
      close() {
        this.closed = true;
      },
    };
    palabraSockets.push(fake);
    return fake;
  };
}

function makePalabraStart(callId, workspaceId, { spokenTranslationEnabled = "true" } = {}) {
  return Buffer.from(
    JSON.stringify({
      event: "start",
      start: {
        streamSid: "MZPALABRA",
        callSid: "CAPALABRA",
        customParameters: {
          voxandraCallId: callId,
          workspaceId,
          liveCopilot: "false",
          translatedCaptions: "true",
          translatedCaptionsRealtimeSessionId: "translation_session",
          translationSourceLanguage: "es",
          translationTargetLanguage: "en",
          spokenTranslationEnabled,
        },
      },
    })
  );
}

async function runPalabraPipelineTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: "palabra_segment_1" };
      }
      return { ok: true };
    },
  };
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 16,
    translationPalabraWorkspaceIds: ["workspace_palabra"],
    translationAudioForwardWorkspaceIds: ["workspace_palabra"],
    translationCascadeWorkspaceIds: ["workspace_palabra"],
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit("message", makePalabraStart("call_palabra", "workspace_palabra"));
  await waitForMicrotasks();

  assert.equal(
    connection.translationPipeline,
    "palabra",
    "the palabra allowlist takes precedence over the cascade allowlist"
  );
  assert.equal(palabraSockets.length, 1, "opens one palabra socket");
  const palabra = palabraSockets[0];
  const setTask = palabra.sent.find((event) => event.message_type === "set_task");
  assert.ok(setTask, "sends set_task on start");
  assert.equal(setTask.data.pipeline.transcription.source_language, "es");
  assert.equal(setTask.data.pipeline.translations[0].target_language, "en");

  // Audio arriving before readiness is buffered, not dropped and not sent.
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    palabra.sent.some((event) => event.message_type === "input_audio_data"),
    false,
    "no audio is sent before the pipeline confirms readiness"
  );

  palabra.onEvent({ message_type: "error", data: { code: "NOT_FOUND" } });
  await waitForMicrotasks();
  assert.equal(
    connection.translationSessionFinished,
    false,
    "NOT_FOUND while polling readiness is never an error"
  );

  palabra.onEvent({ message_type: "current_task", data: { task_status: "running" } });
  await waitForMicrotasks();
  assert.equal(connection.palabraReady, true, "current_task confirms readiness");
  assert.equal(
    mutations.some(
      (item) =>
        item.name === getFunctionName(api.realtimeRuntime.markRealtimeSessionActiveFromWorker) &&
        item.args.pipeline === "palabra" &&
        item.args.model === "palabra-s2s"
    ),
    true,
    "readiness marks the Convex session active with the palabra pipeline"
  );

  // 16 x 20ms frames accumulate into exactly one ~320ms input_audio_data.
  for (let i = 0; i < 16; i += 1) {
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
      )
    );
  }
  await waitForMicrotasks();
  const audioSends = palabra.sent.filter((event) => event.message_type === "input_audio_data");
  assert.equal(audioSends.length, 1, "sixteen 20ms frames produce exactly one 320ms chunk");
  const sentBytes = Buffer.from(audioSends[0].data.data, "base64").length;
  // The buffered pre-ready frame joins the accumulator too, so one full
  // chunk is 16 frames x 4 mu-law bytes -> 12 PCM24 samples x 2 bytes each.
  assert.equal(sentBytes, 16 * 4 * 3 * 2, "the chunk carries all accumulated PCM bytes");

  // The user's own microphone must never reach translation.
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    palabra.sent.filter((event) => event.message_type === "input_audio_data").length,
    1,
    "inbound (own microphone) frames never reach the palabra socket"
  );

  // Double-encoded data: partial transcription arrives as a JSON string.
  palabra.onEvent({
    message_type: "partial_transcription",
    data: {
      transcription: { transcription_id: "t1", language: "es", text: "Hola, buenos" },
    },
  });
  await waitForMicrotasks();
  const pendingWrite = mutations.find(
    (item) =>
      item.name === getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)
  );
  assert.ok(pendingWrite, "a partial transcription records a pending segment");
  assert.equal(pendingWrite.args.isFinal, false);
  assert.equal(pendingWrite.args.pipeline, "palabra");
  assert.equal(pendingWrite.args.audioMode, "private_audio");

  palabra.onEvent({
    message_type: "validated_transcription",
    data: {
      transcription: { transcription_id: "t1", language: "es", text: "Hola, buenos días." },
    },
  });
  palabra.onEvent({
    message_type: "translated_transcription",
    data: {
      transcription: {
        transcription_id: "t1",
        translation_part_id: "p1",
        language: "en",
        text: "Hello, good morning.",
      },
    },
  });
  await waitForMicrotasks();

  const finalWrite = mutations.find(
    (item) =>
      item.name === getFunctionName(api.realtimeRuntime.updateTranslationSegmentFromWorker) &&
      item.args.isFinal === true
  );
  assert.ok(finalWrite, "validated + translated pair finalizes the segment in place");
  assert.equal(finalWrite.args.sourceText, "Hola, buenos días.");
  assert.equal(finalWrite.args.translatedText, "Hello, good morning.");
  assert.equal(connection.translationHasOutput, true, "translated text marks the session usable");
  assert.equal(
    mutations.some(
      (item) =>
        item.name === getFunctionName(api.callGuidance.addRealtimeGuidanceItemFromWorker) &&
        item.args.type === "translation_caption" &&
        item.args.label === "Hello, good morning."
    ),
    true,
    "a final pair writes one caption guidance item"
  );

  // Translated audio relays to an attached browser socket over the Phase 1
  // channel, byte-for-byte.
  const browserSocket = new FakeBrowserSocket();
  connection.attachBrowserAudioSocket(browserSocket);
  palabra.onEvent({
    message_type: "output_audio_data",
    data: {
      transcription_id: "t1",
      translation_part_id: "p1",
      language: "en",
      last_chunk: false,
      data: "AAECAw==",
    },
  });
  await waitForMicrotasks();
  const deltaFrames = browserSocket.sent.filter(
    (frame) => frame.type === "translation_audio_delta"
  );
  assert.equal(deltaFrames.length, 1, "palabra audio relays to the browser channel");
  assert.equal(deltaFrames[0].payload, "AAECAw==", "the PCM payload passes through unmodified");

  socket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
  assert.equal(
    palabra.sent.some((event) => event.message_type === "end_task"),
    true,
    "closing the call ends the palabra task"
  );
  assert.equal(palabra.closed, true, "closing the call closes the palabra socket");
  assert.equal(
    mutations.some(
      (item) =>
        item.name === getFunctionName(api.realtimeUsage.recordRealtimeUsageFromWorker) &&
        item.args.feature === "translated_captions"
    ),
    true,
    "a usable palabra session records translated_captions usage"
  );
}

async function runPalabraFailureIsolationTest() {
  const socket = new FakeSocket();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ name: getFunctionName(reference), args });
      return { ok: true };
    },
  };
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    translationPalabraWorkspaceIds: ["workspace_palabra_fail"],
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit("message", makePalabraStart("call_palabra_fail", "workspace_palabra_fail"));
  await waitForMicrotasks();
  const palabra = palabraSockets[0];
  palabra.onEvent({ message_type: "current_task", data: { task_status: "running" } });
  await waitForMicrotasks();

  palabra.onEvent({ message_type: "error", data: { code: "INTERNAL_ERROR" } });
  await waitForMicrotasks();

  assert.equal(
    connection.translationSessionFinished,
    true,
    "a provider error fails the translation session"
  );
  assert.equal(palabra.closed, true, "failure closes the palabra socket");
  assert.equal(connection.ended, false, "the Twilio stream itself survives a palabra failure");
  assert.equal(
    mutations.some(
      (item) =>
        item.name === getFunctionName(api.realtimeRuntime.finishRealtimeSessionFromWorker) &&
        item.args.status === "failed" &&
        item.args.errorCode === "translation_provider_error"
    ),
    true,
    "the failure finishes the Convex session with the standard error code"
  );
}

async function runPalabraMissingKeyTest() {
  const socket = new FakeSocket();
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: undefined,
    translationPalabraWorkspaceIds: ["workspace_palabra_nokey"],
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit("message", makePalabraStart("call_palabra_nokey", "workspace_palabra_nokey"));
  await waitForMicrotasks();

  assert.equal(palabraSockets.length, 0, "no palabra socket opens without an API key");
  assert.equal(
    connection.translationSessionFinished,
    true,
    "an allowlisted call without a configured key fails only the translation feature"
  );
  assert.equal(connection.ended, false, "the call itself survives the missing key");
}

async function runPalabraRequiresPerCallFlagTest() {
  const socket = new FakeSocket();
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    translationPalabraWorkspaceIds: ["workspace_palabra_noflag"],
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    makePalabraStart("call_palabra_noflag", "workspace_palabra_noflag", {
      spokenTranslationEnabled: "false",
    })
  );
  await waitForMicrotasks();

  assert.equal(
    connection.translationPipeline,
    "direct",
    "an allowlisted workspace without the per-call flag falls back to the direct pipeline"
  );
  assert.equal(
    palabraSockets.length,
    0,
    "no palabra socket opens when only the workspace allowlist matches"
  );
}

// Real two-leg translation bridge (internal-only, single-workspace test,
// sub-phase 5b — see AGENTIC_FUTURE.md). Uses the SHIPPING registry from
// realtime-media-worker-core.mjs, not a test-local mirror. The mirror this
// replaced is why the missing sibling teardown behind the 2026-07-30 orphaned
// -leg incident was invisible to these tests: the mirror was correct about
// cross-referencing and silent about lifecycle, so it passed while the real
// implementation leaked a live Palabra session for 49 minutes.
function makeBridgeRegistry() {
  return createBridgeLegRegistry();
}

function makeBridgeStart(
  callId,
  workspaceId,
  legRole,
  { translationEnabled = false, maxSessionSeconds, translatedVoice } = {}
) {
  const isCallee = legRole === "callee";
  return Buffer.from(
    JSON.stringify({
      event: "start",
      start: {
        streamSid: isCallee ? "MZBRIDGECALLEE" : "MZBRIDGEBROWSER",
        callSid: isCallee ? "CABRIDGECALLEE" : "CABRIDGEBROWSER",
        customParameters: {
          voxandraCallId: callId,
          workspaceId,
          liveCopilot: "false",
          translatedCaptions: translationEnabled && isCallee ? "true" : "false",
          ...(translationEnabled && isCallee
            ? { translatedCaptionsRealtimeSessionId: "translation_session" }
            : {}),
          ...(translationEnabled
            ? {
                spokenTranslationEnabled: "true",
                bridgeTranslationEnabled: "true",
                translationSourceLanguage: isCallee ? "es" : "en",
                translationTargetLanguage: isCallee ? "en" : "es",
                ...(translatedVoice ? { translationVoice: translatedVoice } : {}),
              }
            : {}),
          ...(maxSessionSeconds === undefined
            ? {}
            : { maxSessionSeconds: String(maxSessionSeconds) }),
          bridgeLeg: legRole,
        },
      },
    })
  );
}

async function runBridgeRegistryAndRelayTest() {
  const registry = makeBridgeRegistry();
  const mutations = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      mutations.push({ reference, args });
      return { ok: true };
    },
  };
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };

  const browserSocket = new FakeSocket();
  const browserConnection = new TwilioRealtimeConnection({
    socket: browserSocket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    logger: () => {},
    onCallRegistered: (callId, connection, legRole) => registry.register(callId, connection, legRole),
    onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
  });

  browserSocket.emit(
    "message",
    makeBridgeStart("call_bridge", "workspace_bridge", "browser", {
      translationEnabled: true,
      translatedVoice: "female",
    })
  );
  await waitForMicrotasks();

  assert.equal(browserConnection.legRole, "browser");
  assert.equal(
    browserConnection.bridgeModeActive,
    true,
    "presence of bridgeLeg marks the call as bridge mode"
  );
  assert.equal(
    browserConnection.siblingLeg,
    undefined,
    "no sibling yet before the callee leg connects"
  );
  assert.equal(
    browserConnection.translationPipeline,
    "palabra",
    "the browser leg starts the reverse-direction Palabra pipeline"
  );
  assert.equal(palabraSockets.length, 1, "the browser leg opens the first Palabra socket");
  const browserPalabra = palabraSockets[0];
  const browserTask = browserPalabra.sent.find((event) => event.message_type === "set_task");
  assert.equal(browserTask.data.pipeline.transcription.source_language, "en");
  assert.equal(browserTask.data.pipeline.translations[0].target_language, "es");
  assert.equal(
    browserTask.data.pipeline.translations[0].speech_generation.voice_id,
    "default_high",
    "the caller's female selection stays scoped to the caller-to-callee direction"
  );
  browserPalabra.onEvent({ message_type: "current_task", data: { task_status: "running" } });
  await waitForMicrotasks();

  const calleeSocket = new FakeSocket();
  const calleeConnection = new TwilioRealtimeConnection({
    socket: calleeSocket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    disclosureAudioProvider: stubDisclosureAudioProvider,
    logger: () => {},
    onCallRegistered: (callId, connection, legRole) => registry.register(callId, connection, legRole),
    onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
  });

  calleeSocket.emit(
    "message",
    makeBridgeStart("call_bridge", "workspace_bridge", "callee", {
      translationEnabled: true,
    })
  );
  await waitForMicrotasks();

  assert.equal(calleeConnection.legRole, "callee");
  assert.equal(
    browserConnection.siblingLeg,
    calleeConnection,
    "the browser leg's sibling is set once the callee leg registers"
  );
  assert.equal(
    calleeConnection.siblingLeg,
    browserConnection,
    "the callee leg's sibling is set to the already-registered browser leg"
  );
  assert.equal(palabraSockets.length, 2, "the callee leg opens the second Palabra socket");
  const calleePalabra = palabraSockets[1];
  const calleeTask = calleePalabra.sent.find((event) => event.message_type === "set_task");
  assert.equal(calleeTask.data.pipeline.transcription.source_language, "es");
  assert.equal(calleeTask.data.pipeline.translations[0].target_language, "en");
  assert.equal(
    calleeTask.data.pipeline.translations[0].speech_generation.voice_id,
    "default_low",
    "the called person's independent default does not inherit the caller's selection"
  );
  calleePalabra.onEvent({ message_type: "current_task", data: { task_status: "running" } });
  await waitForMicrotasks();
  await finishBridgeIntroduction(calleeConnection);

  // Each participant's microphone feeds that leg's own Palabra session, and is
  // also mixed into the sibling leg at reduced volume. That passthrough layer
  // replaced translation-only output on 2026-07-31: with nothing under the
  // translation, every pause while a translation caught up was dead silence,
  // which testers on both ends reported as awkward. This assertion previously
  // required zero frames here ("not relayed raw"), which is still true in the
  // sense that matters — the copy is attenuated, never raw.
  browserSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();

  const browserInput = browserPalabra.sent.find(
    (event) => event.message_type === "input_audio_data"
  );
  assert.ok(browserInput, "the browser microphone feeds the first Palabra session");
  const passthroughFrames = calleeSocket.sent.filter((frame) => frame.event === "media");
  assert.equal(
    passthroughFrames.length,
    1,
    "the user's original voice is mixed into the callee leg so there is no dead air"
  );
  assert.notEqual(
    passthroughFrames[0].media.payload,
    LOUD_MULAW_PAYLOAD,
    "the passthrough copy is attenuated, never a full-volume raw relay"
  );

  calleeSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  const calleeInput = calleePalabra.sent.find(
    (event) => event.message_type === "input_audio_data"
  );
  assert.ok(calleeInput, "the callee microphone feeds the second Palabra session");

  // Palabra output from the browser direction is queued on the callee leg and
  // released by that leg's own 20ms clock (the sibling's next inbound frame),
  // mixed over the attenuated original voice. It previously went straight to
  // Twilio on arrival, unpaced.
  const translatedPcm24 = decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD);
  const calleeFrameCountBefore = calleeSocket.sent.filter((f) => f.event === "media").length;
  browserPalabra.onEvent({
    message_type: "output_audio_data",
    data: { data: translatedPcm24 },
  });
  await waitForMicrotasks();
  assert.equal(
    calleeSocket.sent.filter((f) => f.event === "media").length,
    calleeFrameCountBefore,
    "translated audio waits for the outbound pacer instead of being sent on arrival"
  );
  browserSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  const calleeTranslatedFrames = calleeSocket.sent.filter((frame) => frame.event === "media");
  assert.equal(
    calleeTranslatedFrames.length,
    calleeFrameCountBefore + 1,
    "browser-to-callee translated audio reaches exactly the callee leg, one frame per clock tick"
  );
  const calleeMixed = calleeTranslatedFrames[calleeTranslatedFrames.length - 1];
  assert.equal(
    calleeMixed.streamSid,
    "MZBRIDGECALLEE",
    "translated audio carries the callee leg's own streamSid"
  );
  assert.notEqual(
    calleeMixed.media.payload,
    calleeTranslatedFrames[0].media.payload,
    "the mixed frame differs from a passthrough-only frame — the translation is in it"
  );

  // And the tracked callee-to-user direction reaches only the browser leg.
  const browserFrameCountBefore = browserSocket.sent.filter((f) => f.event === "media").length;
  calleePalabra.onEvent({
    message_type: "output_audio_data",
    data: { data: translatedPcm24 },
  });
  await waitForMicrotasks();
  calleeSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  const browserTranslatedFrames = browserSocket.sent.filter((frame) => frame.event === "media");
  assert.equal(
    browserTranslatedFrames.length,
    browserFrameCountBefore + 1,
    "callee-to-user translated audio reaches exactly the browser leg"
  );
  assert.equal(
    browserTranslatedFrames[browserTranslatedFrames.length - 1].streamSid,
    "MZBRIDGEBROWSER"
  );

  assert.equal(
    mutations.some(
      (item) =>
        getFunctionName(item.reference) ===
          getFunctionName(api.realtimeRuntime.markRealtimeSessionActiveFromWorker) &&
        item.args.providerStreamSid === "MZBRIDGEBROWSER"
    ),
    false,
    "the reverse browser direction does not activate or settle a second Convex session in 5b"
  );
  assert.equal(
    mutations.some(
      (item) =>
        getFunctionName(item.reference) ===
          getFunctionName(api.realtimeRuntime.markRealtimeSessionActiveFromWorker) &&
        item.args.providerStreamSid === "MZBRIDGECALLEE"
    ),
    true,
    "the callee-to-user direction owns the existing tracked translation session"
  );

  // Ending the callee leg clears the browser leg's sibling reference AND ends
  // the browser leg. This assertion used to require the opposite ("the browser
  // leg itself survives the callee leg ending"), which is precisely the
  // behaviour that let a Palabra session bill for 49 minutes after its sibling
  // hung up on 2026-07-30. A half-bridge has no purpose: it can only stream
  // audio nothing will translate.
  calleeSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
  await waitForMicrotasks();
  assert.equal(
    browserConnection.siblingLeg,
    undefined,
    "the browser leg's sibling reference clears once the callee leg ends"
  );
  assert.equal(
    browserConnection.ended,
    true,
    "losing the callee leg tears the browser leg down instead of leaving it billing"
  );
  assert.equal(
    browserPalabra.closed,
    true,
    "the browser leg's Palabra session is closed, not merely dereferenced"
  );
}

// Unit coverage for the bridge output mixer and echo-text matcher.
function runBridgeMixUnitTest() {
  const pcm = (samples) => {
    const buf = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
    return buf;
  };
  const read = (buf) => {
    const out = [];
    for (let i = 0; i + 1 < buf.length; i += 2) out.push(buf.readInt16LE(i));
    return out;
  };

  // Passthrough alone is attenuated, never muted: this is the fix for the
  // dead-silence gaps testers heard while waiting for a translation.
  assert.deepEqual(
    read(mixBridgeAudioFrame({ passthroughPcm24: pcm([1000, -2000]), passthroughGain: 0.3 })),
    [300, -600],
    "passthrough-only frames are attenuated by the configured gain"
  );
  // Translated speech sums on top at full amplitude.
  assert.deepEqual(
    read(
      mixBridgeAudioFrame({
        passthroughPcm24: pcm([1000, 1000]),
        translatedPcm24: pcm([5000, -500]),
        passthroughGain: 0.1,
      })
    ),
    [5100, -400],
    "translated audio is summed at full volume over the ducked passthrough"
  );
  // A short translated chunk covers only the head of the frame; the tail stays
  // passthrough, so a queue running dry mid-frame cannot punch a hole in audio.
  assert.deepEqual(
    read(
      mixBridgeAudioFrame({
        passthroughPcm24: pcm([1000, 1000, 1000]),
        translatedPcm24: pcm([2000]),
        passthroughGain: 0.5,
      })
    ),
    [2500, 500, 500],
    "a partial translated chunk leaves the rest of the frame as passthrough"
  );
  assert.deepEqual(
    read(
      mixBridgeAudioFrame({
        passthroughPcm24: pcm([30000]),
        translatedPcm24: pcm([30000]),
        passthroughGain: 1,
      })
    ),
    [32767],
    "summing clamps instead of wrapping around into noise"
  );

  const now = 1_000_000;
  const injected = [{ text: "Quiere obtener información sobre el pago", at: now - 2000 }];
  assert.equal(
    isLikelyInjectedEcho("quiere obtener informacion sobre el pago", injected, now),
    true,
    "our own injected translation coming back is recognised despite lost accents"
  );
  assert.equal(
    isLikelyInjectedEcho("Obtener información sobre el pago", injected, now),
    true,
    "a partial echo of a longer injected phrase still matches"
  );
  assert.equal(
    isLikelyInjectedEcho("El pago se recibirá mañana a las cuatro", injected, now),
    false,
    "a genuine reply on the same topic is not suppressed"
  );
  assert.equal(
    isLikelyInjectedEcho("quiere obtener información sobre el pago", injected, now + 60_000),
    false,
    "matches expire, so a phrase repeated much later is treated as real speech"
  );
  assert.equal(
    isLikelyInjectedEcho("Sí", [{ text: "Sí", at: now }], now),
    false,
    "short utterances are never suppressed — losing a real answer is worse"
  );
  assert.equal(isLikelyInjectedEcho("cualquier cosa", [], now), false);
}

// The bridge output path: each leg hears the other participant's attenuated
// original voice continuously, with translated speech mixed on top and paced at
// one frame per inbound frame rather than flushed at Twilio as fast as Palabra
// produces it.
async function runBridgePassthroughMixTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
    bridgePassthroughGain: 0.5,
    bridgePassthroughDuckedGain: 0.25,
    bridgeTranslatedQueueMaxMs: 100,
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { segmentId: "segment_1" };
    },
  };
  const makeLeg = (socket) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      disclosureAudioProvider: stubDisclosureAudioProvider,
      logger: () => {},
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
    });

  const browserSocket = new FakeSocket();
  makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_mix", "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();
  const calleeSocket = new FakeSocket();
  const calleeLeg = makeLeg(calleeSocket);
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_mix", "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();
  palabraSockets.forEach((s) =>
    s.onEvent({ message_type: "current_task", data: { task_status: "running" } })
  );
  await waitForMicrotasks();
  const [browserPalabra] = palabraSockets;
  await finishBridgeIntroduction(calleeLeg);

  // The user's microphone frame reaches the callee leg even with no translation
  // pending — the whole point of the passthrough layer.
  browserSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  const firstFrames = calleeSocket.sent.filter((f) => f.event === "media");
  assert.equal(firstFrames.length, 1, "the callee hears the user's original voice immediately");
  assert.notEqual(
    firstFrames[0].media.payload,
    LOUD_MULAW_PAYLOAD,
    "the passthrough copy is attenuated, not a full-volume relay"
  );

  // Palabra output is queued, NOT sent on arrival: the sibling's next inbound
  // frame is the clock that releases it.
  const translatedPcm = decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD);
  browserPalabra.onEvent({ message_type: "output_audio_data", data: { data: translatedPcm } });
  await waitForMicrotasks();
  assert.equal(
    calleeSocket.sent.filter((f) => f.event === "media").length,
    1,
    "translated audio is queued for pacing instead of being sent on arrival"
  );
  assert.ok(calleeLeg.bridgeTranslatedQueuedBytes > 0, "the queue holds the translated audio");

  browserSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    calleeSocket.sent.filter((f) => f.event === "media").length,
    2,
    "the next inbound frame releases exactly one mixed output frame"
  );
  assert.equal(
    calleeLeg.bridgeTranslatedQueuedBytes,
    0,
    "one frame's worth of translated audio was consumed"
  );

  // An oversized burst is bounded, so translation cannot drift ever further
  // behind the live conversation.
  for (let i = 0; i < 40; i += 1) {
    browserPalabra.onEvent({ message_type: "output_audio_data", data: { data: translatedPcm } });
  }
  await waitForMicrotasks();
  assert.ok(
    calleeLeg.bridgeTranslatedQueuedBytes <= config.bridgeTranslatedQueueMaxMs * 48,
    "the translated queue is capped to bound added latency"
  );

  // Raw microphone audio is still never relayed to the sibling's Palabra input.
  const calleePalabraInputs = palabraSockets[1].sent.filter(
    (e) => e.message_type === "input_audio_data"
  );
  assert.equal(
    calleePalabraInputs.length,
    0,
    "the user's voice does not leak into the callee leg's own translation input"
  );

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

// Real two-leg translation bridge, sub-phase 5c: the spoken AI-translation
// disclosure must be the very first thing the callee hears, ahead of any
// real Palabra-translated speech, and it must be primed for the callee's own
// expected language (translationSourceLanguage on that leg).
// Real 2026-08-13 incident: the sibling relationship (and therefore real
// audio relaying via mixBridgeFrameFromSibling) is established well before
// disclosure generation — a network round trip — even starts, let alone
// finishes. Without a gate, the callee could hear live conversation before
// the disclosure ever played; a real test call reproduced exactly that
// (both parties exchanged a greeting first, then the disclosure interrupted
// them). This test controls the disclosure request's timing directly to
// prove the gate actually suppresses audio for that whole window.
async function runBridgeGateSuppressesAudioDuringDisclosurePrimingTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { segmentId: "segment_1" };
    },
  };
  let resolveDisclosure;
  const disclosurePending = new Promise((resolve) => {
    resolveDisclosure = resolve;
  });
  const makeLeg = (socket, extra = {}) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      logger: () => {},
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
      ...extra,
    });

  const browserSocket = new FakeSocket();
  makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_gate", "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();

  const calleeSocket = new FakeSocket();
  const calleeLeg = makeLeg(calleeSocket, {
    // Never resolves until the test says so — simulates disclosure
    // generation still being mid-flight.
    disclosureAudioProvider: () => disclosurePending,
  });
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_gate", "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();

  assert.equal(
    calleeLeg.disclosureGateOpen,
    false,
    "the gate is closed the instant the callee leg registers, before disclosure generation even starts"
  );

  // The browser leg's own inbound mic frames are exactly what drives
  // mixBridgeFrameFromSibling on the callee leg — this is the sibling
  // relaying real audio while the disclosure is still pending.
  for (let i = 0; i < 5; i += 1) {
    browserSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
      )
    );
  }
  await waitForMicrotasks();
  assert.equal(
    calleeSocket.sent.filter((f) => f.event === "media").length,
    0,
    "the callee hears nothing at all while the disclosure is still being generated"
  );

  resolveDisclosure(Buffer.from([1, 2, 3, 4]).toString("base64"));
  await waitForMicrotasks();
  assert.equal(calleeLeg.disclosureGateOpen, false, "priming alone must not open conversation");
  await finishBridgeIntroduction(calleeLeg);

  browserSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    calleeSocket.sent.filter((f) => f.event === "media").length,
    1,
    "audio flows normally again once the gate reopens"
  );
  await calleeLeg.closeBridgeForSafety("test_complete");
}

async function runBridgeDisclosurePlaybackTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  // Three 20ms passthrough frames' worth of PCM24 (24 bytes each, matching
  // LOUD_MULAW_PAYLOAD's decoded size) — long enough to still have frames
  // left when a real-translated-audio burst arrives mid-disclosure below,
  // which is exactly the scenario that truncated a real 8.45s Spanish clip
  // against the old shared, trimmed queue (see LOG.md).
  const disclosurePcm = Buffer.from(
    Array.from({ length: 72 }, (_, i) => (i + 1) % 256)
  );
  const disclosureCalls = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
    // Zeroed so mixed frames are an exact copy of whatever is queued
    // (disclosure, then translated speech) with no passthrough noise to
    // account for in the byte-level assertions below.
    bridgePassthroughGain: 0,
    bridgePassthroughDuckedGain: 0,
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { segmentId: "segment_1" };
    },
  };
  const makeLeg = (socket, extra = {}) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      logger: () => {},
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
      ...extra,
    });

  const browserSocket = new FakeSocket();
  makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_disclosure", "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();

  const calleeSocket = new FakeSocket();
  const calleeLeg = makeLeg(calleeSocket, {
    disclosureAudioProvider: async ({ languageCode, englishText }) => {
      if (englishText === BRIDGE_DISCLOSURE_ENGLISH_TEXT) disclosureCalls.push(languageCode);
      return disclosurePcm.toString("base64");
    },
  });
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_disclosure", "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();

  assert.deepEqual(
    disclosureCalls,
    ["es"],
    "the disclosure is generated once, for the callee leg's own expected (source) language"
  );
  assert.equal(
    calleeLeg.bridgeIntroduction.disclosure.pcm.length,
    disclosurePcm.length,
    "the shared disclosure is prepared independently of translation"
  );
  assert.equal(
    calleeLeg.bridgeTranslatedQueuedBytes,
    0,
    "priming the disclosure never touches the separate real-translated-audio queue"
  );

  palabraSockets.forEach((s) =>
    s.onEvent({ message_type: "current_task", data: { task_status: "running" } })
  );
  await waitForMicrotasks();
  const [browserPalabra] = palabraSockets;

  const emitBrowserFrame = () =>
    browserSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
      )
    );

  // First frame drains the disclosure's first third.
  emitBrowserFrame();
  calleeLeg.bridgeIntroduction.tick(Date.now(), 24);
  await waitForMicrotasks();
  let sentSoFar = calleeSocket.sent.filter((f) => f.event === "media");
  assert.equal(
    sentSoFar[0].media.payload,
    encodePcm24Base64ToMuLawBase64(disclosurePcm.subarray(0, 24).toString("base64")),
    "the first frame the callee hears is the disclosure's own audio, not silence or real speech"
  );
  assert.equal(
    disclosurePcm.length - calleeLeg.bridgeIntroduction.playback.get(calleeLeg).offset,
    48,
    "two-thirds of the disclosure remains queued"
  );

  // Real translated audio now arrives from Palabra WHILE the disclosure is
  // still mid-playback — the exact scenario that truncated a real clip
  // against the old shared, trimmed queue. It must queue behind the
  // disclosure, not overwrite or race it, and must not be dropped either
  // despite an oversized burst that would exceed bridgeTranslatedQueueMaxMs
  // on its own.
  const translatedPcm = decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD);
  for (let i = 0; i < 40; i += 1) {
    browserPalabra.onEvent({ message_type: "output_audio_data", data: { data: translatedPcm } });
  }
  await waitForMicrotasks();
  assert.equal(
    calleeLeg.bridgeTranslatedQueuedBytes, 0,
    "provider output during the introduction is discarded rather than replayed later"
  );

  // The remaining two disclosure frames must still play out completely
  // intact — unaffected by the burst that just arrived.
  emitBrowserFrame();
  calleeLeg.bridgeIntroduction.tick(Date.now(), 24);
  await waitForMicrotasks();
  emitBrowserFrame();
  calleeLeg.bridgeIntroduction.tick(Date.now(), 24);
  await waitForMicrotasks();
  sentSoFar = calleeSocket.sent.filter((f) => f.event === "media");
  assert.equal(
    sentSoFar[1].media.payload,
    encodePcm24Base64ToMuLawBase64(disclosurePcm.subarray(24, 48).toString("base64")),
    "the disclosure's second third survives the mid-playback Palabra burst intact"
  );
  assert.equal(
    sentSoFar[2].media.payload,
    encodePcm24Base64ToMuLawBase64(disclosurePcm.subarray(48, 72).toString("base64")),
    "the disclosure's final third completes the clip, still untouched by the burst"
  );
  assert.equal(
    calleeLeg.disclosurePrimingQueuedBytes,
    0,
    "the disclosure is now fully drained"
  );

  // Only now does real translated speech (queued behind the disclosure)
  // start playing — proving it was preserved, not lost, while it waited.
  assert.equal(calleeLeg.isDisclosurePlaying(), true, "sending the final frame is not playback completion");
  assert.deepEqual(browserSocket.sent.filter((f) => f.event === "media"), calleeSocket.sent.filter((f) => f.event === "media").map((f) => ({ ...f, streamSid: "MZBRIDGEBROWSER" })));
  await finishBridgeIntroduction(calleeLeg);
  browserPalabra.onEvent({ message_type: "output_audio_data", data: { data: translatedPcm } });
  emitBrowserFrame();
  await waitForMicrotasks();
  const fourthFrame = calleeSocket.sent.filter((f) => f.event === "media")[0];
  assert.notEqual(
    fourthFrame.media.payload,
    encodePcm24Base64ToMuLawBase64(disclosurePcm.subarray(0, 24).toString("base64")),
    "real translated speech is never confused with the disclosure clip"
  );

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

function runBridgeComfortAudioUnitTest() {
  const rate = 24000;
  // Inside the first 2 s burst: audible dual tone.
  const burst = generateRingbackFrame(rate, 480);
  assert.ok(pcm16Rms(burst.toString("base64")) > 1500, "ringback burst carries an audible tone");
  // Between bursts (2 s .. 6 s): silence.
  const gap = generateRingbackFrame(3 * rate, 480);
  assert.equal(pcm16Rms(gap.toString("base64")), 0, "ringback is silent between bursts");
  // Pattern repeats every 6 s.
  assert.ok(pcm16Rms(generateRingbackFrame(7 * rate, 480).toString("base64")) > 1500);
  // Frame length follows the requested sample count, never a fixed 480.
  assert.equal(generateRingbackFrame(0, 12).length, 24);
  // Peak stays well under full scale so a loud mic frame cannot clip the mix.
  let peak = 0;
  for (let i = 0; i < burst.length; i += 2) peak = Math.max(peak, Math.abs(burst.readInt16LE(i)));
  assert.ok(peak <= 5000, `ringback peak ${peak} stays modest`);

  const chime = generateGoAheadChimePcm();
  assert.ok(chime.length > 0.4 * rate * 2 && chime.length < 0.6 * rate * 2, "chime is ~0.5 s");
  assert.equal(chime.readInt16LE(0), 0, "chime starts from silence (no click)");
  assert.equal(chime.readInt16LE(chime.length - 2), 0, "chime ends at silence (no click)");
  assert.ok(pcm16Rms(chime.toString("base64")) > 1500, "chime is audible");

  assert.equal(silencePcm24Base64(12), Buffer.alloc(24).toString("base64"));
  assert.equal(silencePcm24Base64(12), silencePcm24Base64(12), "silence frames are cached by size");
}

// Before the callee leg connects, the caller hears ringback (their own mic
// clock paces it) and nothing they say reaches Palabra — the session is kept
// alive with silence instead. The moment the callee registers, ringback stops
// and the mic flows.
async function runBridgeRingbackUntilCalleeConnectsTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { segmentId: "segment_1" };
    },
  };
  const logs = [];
  const makeLeg = (socket, extra = {}) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      logger: (level, message, details) => logs.push({ message, details }),
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
      ...extra,
    });

  const browserSocket = new FakeSocket();
  const browserLeg = makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_ringback", "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();
  const [browserPalabra] = palabraSockets;
  browserPalabra.onEvent({ message_type: "current_task", data: { task_status: "running" } });
  await waitForMicrotasks();

  const emitBrowserFrame = () =>
    browserSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
      )
    );
  const micPcm = decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD);
  const micSamples = Buffer.byteLength(micPcm, "base64") / 2;

  emitBrowserFrame();
  emitBrowserFrame();
  await waitForMicrotasks();

  const ringbackFrames = browserSocket.sent.filter((f) => f.event === "media");
  assert.equal(ringbackFrames.length, 2, "one ringback frame per mic frame while the callee is absent");
  assert.equal(
    ringbackFrames[0].media.payload,
    encodePcm24Base64ToMuLawBase64(generateRingbackFrame(0, micSamples).toString("base64")),
    "ringback starts at sample 0 and matches the inbound frame length"
  );
  assert.equal(
    ringbackFrames[1].media.payload,
    encodePcm24Base64ToMuLawBase64(generateRingbackFrame(micSamples, micSamples).toString("base64")),
    "the ringback clock advances by one frame per mic frame"
  );
  assert.equal(ringbackFrames[0].streamSid, "MZBRIDGEBROWSER");

  const palabraAudio = browserPalabra.sent.filter((m) => m.message_type === "input_audio_data");
  assert.equal(palabraAudio.length, 2, "Palabra is kept alive with one frame per mic frame");
  assert.ok(
    palabraAudio.every((m) => m.data.data === silencePcm24Base64(micSamples)),
    "nothing the caller says while the callee is ringing reaches Palabra — silence does"
  );
  assert.equal(browserLeg.bridgeMicGated, true);
  assert.ok(
    logs.some((l) => l.message === "bridge_mic_gated" && l.details.reason === "awaiting_callee"),
    "mic gating is logged with its reason"
  );

  // Callee connects (no disclosure requested on this leg, so its gate is open).
  const calleeSocket = new FakeSocket();
  const calleeLeg = makeLeg(calleeSocket, { disclosureAudioProvider: stubDisclosureAudioProvider });
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_ringback", "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();
  assert.ok(browserLeg.siblingLeg, "callee leg is registered as the browser leg's sibling");

  emitBrowserFrame();
  await waitForMicrotasks();
  assert.equal(
    browserSocket.sent.filter((f) => f.event === "media").length,
    2,
    "ringback stops the moment the callee connects"
  );
  const afterConnect = browserPalabra.sent.filter((m) => m.message_type === "input_audio_data");
  assert.equal(afterConnect.length, 3);
  assert.equal(afterConnect[2].data.data, silencePcm24Base64(micSamples), "answering alone does not open the microphone");
  assert.equal(browserLeg.bridgeMicGated, true);
  await finishBridgeIntroduction(calleeLeg);
  emitBrowserFrame();
  assert.equal(browserPalabra.sent.filter((m) => m.message_type === "input_audio_data").at(-1).data.data, micPcm);
  assert.equal(browserLeg.bridgeMicGated, false);
  assert.ok(logs.some((l) => l.message === "bridge_mic_open"), "mic opening is logged");

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

// While the callee hears the disclosure, the caller's mic is withheld from
// Palabra (so nothing said then is translated late and out of context), the
// disclosure lifecycle is reported to Convex for the dialer, and the moment
// the clip drains the caller hears the go-ahead chime and the mic opens.
async function runBridgeMicGatedDuringDisclosureTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const disclosurePcm = Buffer.from(Array.from({ length: 48 }, (_, i) => (i + 1) % 256));
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
    bridgePassthroughGain: 0.3,
    bridgePassthroughDuckedGain: 0.06,
  };
  const disclosureStates = [];
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      if (
        getFunctionName(reference) ===
        getFunctionName(api.realtimeRuntime.updateBridgeDisclosureStateFromWorker)
      ) {
        disclosureStates.push({ callId: args.callId, state: args.state });
      }
      return { segmentId: "segment_1" };
    },
  };
  const makeLeg = (socket, extra = {}) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      logger: () => {},
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
      ...extra,
    });

  const browserSocket = new FakeSocket();
  const browserLeg = makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_gate", "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();

  // Slow disclosure generation, so the "pending" phase is observable.
  let resolveDisclosure;
  const calleeSocket = new FakeSocket();
  const calleeLeg = makeLeg(calleeSocket, {
    disclosureAudioProvider: ({ englishText }) => englishText === BRIDGE_DISCLOSURE_ENGLISH_TEXT
      ? new Promise((resolve) => {
        resolveDisclosure = () => resolve(disclosurePcm.toString("base64"));
      })
      : Promise.resolve(disclosurePcm.toString("base64")),
  });
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_gate", "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();
  assert.deepEqual(
    disclosureStates.map((s) => s.state),
    ["pending"],
    "the dialer learns the disclosure is pending before the clip exists"
  );
  assert.equal(disclosureStates[0].callId, "call_gate");
  assert.equal(calleeLeg.isDisclosurePlaying(), true, "pending counts as playing for the mic gate");

  clearInterval(calleeLeg.bridgeIntroduction.timer);
  resolveDisclosure();
  await waitForMicrotasks();
  await waitForMicrotasks();
  assert.deepEqual(disclosureStates.map((s) => s.state), ["pending"]);
  palabraSockets.forEach((s) =>
    s.onEvent({ message_type: "current_task", data: { task_status: "running" } })
  );
  await waitForMicrotasks();
  const [browserPalabra] = palabraSockets;

  const micPcm = decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD);
  const micSamples = Buffer.byteLength(micPcm, "base64") / 2;
  const emitBrowserFrame = () =>
    browserSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
      )
    );
  const emitCalleeFrame = () =>
    calleeSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
      )
    );

  // Two caller frames drain the 48-byte disclosure (24 bytes per frame).
  emitBrowserFrame();
  emitCalleeFrame();
  calleeLeg.bridgeIntroduction.tick(Date.now(), 24);
  await waitForMicrotasks();
  assert.equal(browserLeg.bridgeMicGated, true, "mic is gated while the disclosure plays");
  assert.equal(
    calleeSocket.sent.filter((frame) => frame.event === "media").at(-1).media.payload,
    encodePcm24Base64ToMuLawBase64(disclosurePcm.subarray(0, 24).toString("base64")),
    "loud original microphone audio must not contaminate the announcement"
  );
  assert.equal(
    browserPalabra.sent.filter((m) => m.message_type === "input_audio_data").at(-1).data.data,
    silencePcm24Base64(micSamples),
    "Palabra receives silence, not the caller, during the disclosure"
  );
  assert.equal(
    browserSocket.sent.filter((f) => f.event === "media").at(-1).media.payload,
    calleeSocket.sent.filter((f) => f.event === "media").at(-1).media.payload,
    "both people hear exactly the announcement, without either original microphone"
  );
  assert.equal(calleeLeg.bridgeMicGated, true);
  assert.equal(palabraSockets[1].sent.filter((m) => m.message_type === "input_audio_data").at(-1).data.data, silencePcm24Base64(micSamples));
  assert.equal(calleeLeg.bridgeIntroduction.playback.get(calleeLeg).offset, 24, "half the disclosure remains");
  assert.deepEqual(disclosureStates.map((s) => s.state), ["pending", "playing"]);

  emitBrowserFrame();
  calleeLeg.bridgeIntroduction.tick(Date.now(), 24);
  await waitForMicrotasks();
  assert.equal(calleeLeg.bridgeIntroduction.playback.get(calleeLeg).offset, 48, "disclosure fully sent");
  assert.deepEqual(disclosureStates.map((s) => s.state), ["pending", "playing"]);
  assert.equal(calleeLeg.isDisclosurePlaying(), true, "sending is not playback completion");
  const callerMark = browserSocket.sent.find((frame) => frame.event === "mark");
  await browserLeg.handleTwilioMessage(Buffer.from(JSON.stringify(callerMark)));
  assert.equal(calleeLeg.isDisclosurePlaying(), true, "one acknowledgement cannot open either microphone");
  await finishBridgeIntroduction(calleeLeg);
  assert.deepEqual(disclosureStates.map((s) => s.state), ["pending", "playing", "readying", "done"]);

  // Next caller frame: mic is open and real audio reaches Palabra.
  emitBrowserFrame();
  await waitForMicrotasks();
  assert.equal(browserLeg.bridgeMicGated, false, "mic opens once the disclosure is done");
  assert.equal(
    browserPalabra.sent.filter((m) => m.message_type === "input_audio_data").at(-1).data.data,
    micPcm,
    "the caller's real mic reaches Palabra after the disclosure"
  );

  // The chime plays to the caller via the callee's mic clock, ahead of any
  // translated speech, and is never routed anywhere else.
  emitCalleeFrame();
  await waitForMicrotasks();
  const callerHears = browserSocket.sent.filter((f) => f.event === "media");
  assert.equal(callerHears.length, 1);
  assert.equal(
    callerHears[0].media.payload,
    encodePcm24Base64ToMuLawBase64(mixBridgeAudioFrame({ passthroughPcm24: Buffer.from(micPcm, "base64"), translatedPcm24: Buffer.alloc(0), passthroughGain: 0.3 }).toString("base64")),
    "the existing original voice mix resumes after both spoken cues complete"
  );

  // The browser leg's own state never reports a disclosure (it has none).
  assert.equal(browserLeg.disclosureState, undefined);
  assert.equal(
    disclosureStates.length,
    4,
    "only the shared controller reports the four ordered startup states"
  );

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

// Shared two-leg bridge harness for the degrade / observability tests below.
async function startTranslatedBridge({ callId, convex, config: configOverrides = {}, finishIntroduction = true, providerReady = true, disclosureAudioProvider = async () => Buffer.alloc(24).toString("base64") }) {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
    ...configOverrides,
  };
  const logs = [];
  const makeLeg = (socket, extra = {}) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      logger: (level, message, details) => logs.push({ level, message, details }),
      onCallRegistered: (id, conn, legRole) => registry.register(id, conn, legRole),
      onCallUnregistered: (id, legRole) => registry.unregister(id, legRole),
      ...extra,
    });
  const browserSocket = new FakeSocket();
  const browserLeg = makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart(callId, "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();
  await waitForMicrotasks();
  const calleeSocket = new FakeSocket();
  const calleeLeg = makeLeg(calleeSocket, { disclosureAudioProvider });
  calleeSocket.emit(
    "message",
    makeBridgeStart(callId, "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();
  await waitForMicrotasks();
  if (providerReady) palabraSockets.forEach((s) =>
    s.onEvent({ message_type: "current_task", data: { task_status: "running" } })
  );
  await waitForMicrotasks();
  const [browserPalabra, calleePalabra] = palabraSockets;
  if (finishIntroduction) await finishBridgeIntroduction(calleeLeg);
  else clearInterval(calleeLeg.bridgeIntroduction.timer);
  const emitFrame = (socket) =>
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
      )
    );
  return {
    browserSocket,
    browserLeg,
    calleeSocket,
    calleeLeg,
    browserPalabra,
    calleePalabra,
    logs,
    emitBrowserFrame: () => emitFrame(browserSocket),
    emitCalleeFrame: () => emitFrame(calleeSocket),
  };
}

function makeRecordingConvex() {
  const mutations = [];
  let sessionCounter = 0;
  return {
    mutations,
    named(reference) {
      const name = getFunctionName(reference);
      return mutations.filter((m) => m.name === name);
    },
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      const name = getFunctionName(reference);
      mutations.push({ name, args });
      if (name === getFunctionName(api.realtimeRuntime.createRealtimeSessionFromWorker)) {
        sessionCounter += 1;
        return { realtimeSessionId: `reverse_session_${sessionCounter}` };
      }
      if (typeof args.translatedText === "string" && !args.segmentId) {
        return { segmentId: `segment_${mutations.length}` };
      }
      return { ok: true };
    },
  };
}

// Either Palabra direction failing mid-call degrades the whole bridge to a
// plain full-volume phone call for both people — previously both kept hearing
// each other at 30% with nothing on top, and the untracked browser leg's
// failure was invisible everywhere.
async function runBridgeDegradesToPlainCallOnTranslationFailureTest() {
  const convex = makeRecordingConvex();
  const bridge = await startTranslatedBridge({
    callId: "call_degrade",
    convex,
    config: { bridgePassthroughGain: 0.3, bridgePassthroughDuckedGain: 0.06 },
  });
  const { browserLeg, calleeLeg, browserPalabra, calleePalabra, browserSocket, calleeSocket, logs } =
    bridge;
  const micPcm = decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD);

  // Callee leg's disclosure has to drain before real speech is mixed on it;
  // one browser frame does that (24-byte clip).
  bridge.emitBrowserFrame();
  await waitForMicrotasks();
  // Some translated speech is queued on the browser leg, and the callee leg
  // receives a ducked passthrough frame — the normal translating state.
  calleePalabra.onEvent({ message_type: "output_audio_data", data: { data: micPcm } });
  await waitForMicrotasks();
  assert.ok(browserLeg.bridgeTranslatedQueuedBytes > 0, "translated speech is queued pre-failure");
  bridge.emitBrowserFrame();
  await waitForMicrotasks();
  const duckedFrame = calleeSocket.sent.filter((f) => f.event === "media").at(-1);
  assert.equal(
    duckedFrame.media.payload,
    encodePcm24Base64ToMuLawBase64(
      mixBridgeAudioFrame({ passthroughPcm24: micPcm, translatedPcm24: "", passthroughGain: 0.3 }).toString("base64")
    ),
    "before the failure the callee hears the caller at the reduced passthrough gain"
  );

  // The BROWSER leg's Palabra session (user→callee direction) dies. This is
  // the direction that had no Convex record at all before.
  browserPalabra.onEvent({ message_type: "error", data: { code: "INTERNAL_ERROR" } });
  await waitForMicrotasks();
  await waitForMicrotasks();

  assert.equal(browserLeg.bridgeDegraded, true, "failing leg degrades");
  assert.equal(calleeLeg.bridgeDegraded, true, "sibling leg degrades too");
  assert.equal(browserLeg.translationSessionFinished, true);
  assert.equal(calleeLeg.translationSessionFinished, true, "the surviving direction is shut down as well");
  assert.equal(calleePalabra.closed, true, "the sibling's Palabra socket is closed");
  assert.equal(browserLeg.bridgeTranslatedQueuedBytes, 0, "stale translated speech is dropped");
  assert.equal(calleeLeg.bridgeTranslatedQueuedBytes, 0);
  assert.equal(
    logs.filter((l) => l.message === "bridge_degraded_to_plain_call").length,
    2,
    "each leg logs its own degrade"
  );

  // Both mixers now pass the other person's real voice at full volume.
  bridge.emitBrowserFrame();
  bridge.emitCalleeFrame();
  await waitForMicrotasks();
  const calleeHears = calleeSocket.sent.filter((f) => f.event === "media").at(-1);
  const callerHears = browserSocket.sent.filter((f) => f.event === "media").at(-1);
  assert.equal(
    calleeHears.media.payload,
    LOUD_MULAW_PAYLOAD,
    "degraded: the callee hears the caller's real voice at full volume (byte-identical round trip)"
  );
  assert.equal(
    callerHears.media.payload,
    LOUD_MULAW_PAYLOAD,
    "degraded: the caller hears the callee's real voice at full volume"
  );

  // Late provider output for a dead direction can never be mixed in again.
  calleePalabra.onEvent({ message_type: "output_audio_data", data: { data: micPcm } });
  await waitForMicrotasks();
  assert.equal(browserLeg.bridgeTranslatedQueuedBytes, 0, "no translated audio is accepted once degraded");
  browserLeg.enqueuePriorityClip(Buffer.alloc(48, 1));
  assert.equal(browserLeg.disclosurePrimingQueuedBytes, 0, "no priority clips either");

  // Convex: degraded flag written exactly once, by the leg that failed first.
  const degradedWrites = convex.named(api.realtimeRuntime.markBridgeTranslationDegradedFromWorker);
  assert.equal(degradedWrites.length, 1, "the degrade is recorded once per call, not once per leg");
  assert.deepEqual(degradedWrites[0].args, {
    secret: "test-worker-secret",
    callId: "call_degrade",
    legRole: "browser",
  });

  // Convex: the browser leg's reverse direction is now observable — created,
  // activated, and finished as failed with the standard error code.
  const created = convex.named(api.realtimeRuntime.createRealtimeSessionFromWorker);
  assert.equal(created.length, 1, "exactly one reverse session is created (browser leg only)");
  assert.equal(created[0].args.mode, "translated_audio_bridge");
  assert.equal(created[0].args.provider, "palabra");
  assert.equal(created[0].args.callId, "call_degrade");
  assert.equal(created[0].args.workspaceId, "workspace_bridge");
  assert.equal(created[0].args.inputLanguage, browserLeg.sourceLanguage);
  assert.equal(created[0].args.targetLanguage, browserLeg.targetLanguage);
  assert.equal(browserLeg.bridgeReverseRealtimeSessionId, "reverse_session_1");
  const activated = convex
    .named(api.realtimeRuntime.markRealtimeSessionActiveFromWorker)
    .filter((m) => m.args.realtimeSessionId === "reverse_session_1");
  assert.equal(activated.length, 1, "the reverse session is marked active once Palabra is ready");
  const finished = convex.named(api.realtimeRuntime.finishRealtimeSessionFromWorker);
  const reverseFinish = finished.find((m) => m.args.realtimeSessionId === "reverse_session_1");
  assert.ok(reverseFinish, "the reverse session is finished");
  assert.equal(reverseFinish.args.status, "failed");
  assert.equal(reverseFinish.args.errorCode, "translation_provider_error");
  const trackedFinish = finished.find((m) => m.args.realtimeSessionId === "translation_session");
  assert.equal(trackedFinish?.args.status, "failed", "the callee leg's tracked session is finished as failed too");

  // Teardown: no translated_audio usage is billed for a degraded call, and the
  // reverse session is not finished a second time.
  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  calleeSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
  await waitForMicrotasks();
  assert.equal(
    convex.named(api.realtimeUsage.recordRealtimeUsageFromWorker).length,
    0,
    "a degraded bridge bills no translated_audio usage"
  );
  assert.equal(
    convex
      .named(api.realtimeRuntime.finishRealtimeSessionFromWorker)
      .filter((m) => m.args.realtimeSessionId === "reverse_session_1").length,
    1,
    "the reverse session is finished exactly once"
  );
}

// Happy path for the reverse-direction record: created on start, activated
// when Palabra confirms, finished as completed on hangup, never billed, and
// the browser leg's captions carry its id.
async function runBridgeReverseSessionLifecycleTest() {
  const convex = makeRecordingConvex();
  const bridge = await startTranslatedBridge({ callId: "call_reverse", convex });
  const { browserLeg, browserPalabra, browserSocket, calleeSocket } = bridge;

  assert.equal(browserLeg.bridgeReverseRealtimeSessionId, "reverse_session_1");
  assert.equal(
    bridge.calleeLeg.bridgeReverseRealtimeSessionId,
    undefined,
    "the callee leg keeps using its pre-created tracked session"
  );
  assert.equal(
    convex.named(api.realtimeRuntime.createRealtimeSessionFromWorker)[0].args.status,
    "starting"
  );

  // A caption from the browser leg is attributed to the reverse session.
  browserPalabra.onEvent({
    message_type: "validated_transcription",
    data: { transcription: { transcription_id: "t1", text: "Hello there, how are you today" } },
  });
  browserPalabra.onEvent({
    message_type: "translated_transcription",
    data: { transcription: { transcription_id: "t1", text: "Hola, ¿cómo estás hoy?" } },
  });
  await waitForMicrotasks();
  await waitForMicrotasks();
  const segment = convex.named(api.realtimeRuntime.recordTranslationSegmentFromWorker).at(-1);
  assert.ok(segment, "browser leg wrote a caption");
  assert.equal(segment.args.realtimeSessionId, "reverse_session_1");
  assert.equal(segment.args.direction, "user_to_caller");

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  calleeSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
  await waitForMicrotasks();
  const reverseFinish = convex
    .named(api.realtimeRuntime.finishRealtimeSessionFromWorker)
    .filter((m) => m.args.realtimeSessionId === "reverse_session_1");
  assert.equal(reverseFinish.length, 1, "reverse session finished exactly once on hangup");
  assert.equal(reverseFinish[0].args.status, "completed");
  assert.equal(reverseFinish[0].args.errorCode, undefined);
  assert.ok(
    convex
      .named(api.realtimeUsage.recordRealtimeUsageFromWorker)
      .every((m) => m.args.realtimeSessionId !== "reverse_session_1"),
    "the reverse session is never billed — the callee leg records the one translated_audio event"
  );
  assert.equal(
    convex.named(api.realtimeRuntime.markBridgeTranslationDegradedFromWorker).length,
    0,
    "a clean call is never marked degraded"
  );
}

// The bridge must never start a callee leg without a disclosure: a failure
// generating it aborts that leg's setup instead of silently proceeding.
// A disclosure generation failure must never end the underlying phone call
// (2026-08-13 live incident: it used to, cascading through sibling teardown
// to kill both real legs). The leg should log the failure loudly and
// otherwise continue setup completely normally, just without a primed
// disclosure.
async function runBridgeDisclosureFailureClosesLegTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const failures = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { segmentId: "segment_1" };
    },
  };
  const calleeSocket = new FakeSocket();
  const connection = new TwilioRealtimeConnection({
    socket: calleeSocket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    disclosureAudioProvider: async () => {
      throw new Error("synthetic disclosure generation failure");
    },
    logger: (level, message, details) => {
      if (level === "error") failures.push({ message, details });
    },
    onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
    onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
  });

  calleeSocket.emit(
    "message",
    makeBridgeStart("call_disclosure_fail", "workspace_bridge", "callee", {
      translationEnabled: true,
    })
  );
  await waitForMicrotasks();

  assert.ok(
    failures.some(
      (f) =>
        f.message === "bridge_introduction_failed" &&
        f.details?.reason === "audio_unavailable"
    ),
    "the disclosure failure is logged loudly for audit"
  );
  assert.equal(
    connection.ended,
    true,
    "startup fails closed when disclosure audio cannot be generated"
  );
  assert.equal(
    connection.disclosurePrimingQueuedBytes,
    0,
    "nothing is queued for a disclosure that failed to generate"
  );
  assert.equal(
    connection.translationPipeline,
    "palabra",
    "the requested pipeline remains identifiable after startup failure"
  );
  assert.equal(connection.disclosureState, "failed");
  assert.equal(calleeSocket.closed, true, "the provider socket closes even if no failure clip is available");
  assert.ok(palabraSockets.every((socket) => socket.closed), "no translation session survives setup failure");
}

// The disclosure request can now take several seconds (translation + TTS,
// occasionally retried). If the connection's sibling disconnects and tears
// it down while that's still in flight, handleStart must stop cleanly right
// after — not continue on to open a Palabra session with no live socket
// left to serve it.
async function runBridgeHandleStartStopsIfEndedDuringDisclosureTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { segmentId: "segment_1" };
    },
  };
  const calleeSocket = new FakeSocket();
  const connection = new TwilioRealtimeConnection({
    socket: calleeSocket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    // Simulates the sibling disconnecting (ending this leg) while the
    // disclosure request is still in flight, exactly like the live incident.
    disclosureAudioProvider: async () => {
      connection.ended = true;
      return stubDisclosureAudioProvider();
    },
    logger: () => {},
    onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
    onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
  });

  calleeSocket.emit(
    "message",
    makeBridgeStart("call_disclosure_race", "workspace_bridge", "callee", {
      translationEnabled: true,
    })
  );
  await waitForMicrotasks();

  assert.equal(
    palabraSockets.length,
    0,
    "no Palabra session opens on a connection that already ended while disclosure priming was in flight"
  );
}

// Echo captions, reproduced. The tracked callee leg must not publish a caption
// for the translated speech we injected into that same leg.
async function runBridgeCaptionEchoSuppressionTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const written = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationCaptionIntervalMs: 0,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      if (
        getFunctionName(reference) ===
        getFunctionName(api.realtimeRuntime.recordTranslationSegmentFromWorker)
      ) {
        written.push(args);
        return { segmentId: `segment_${written.length}` };
      }
      return { ok: true };
    },
  };
  const makeLeg = (socket) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      disclosureAudioProvider: stubDisclosureAudioProvider,
      logger: () => {},
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
    });

  const browserSocket = new FakeSocket();
  makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_echo", "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();
  const calleeSocket = new FakeSocket();
  const calleeLeg = makeLeg(calleeSocket);
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_echo", "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();
  palabraSockets.forEach((s) =>
    s.onEvent({ message_type: "current_task", data: { task_status: "running" } })
  );
  await waitForMicrotasks();
  const [browserPalabra, calleePalabra] = palabraSockets;
  await finishBridgeIntroduction(calleeLeg);

  // The browser leg translates the user's English into Spanish and speaks it
  // into the callee's phone.
  browserPalabra.onEvent({
    message_type: "translated_transcription",
    data: {
      transcription: {
        transcription_id: "b1",
        text: "Quiere obtener información sobre el pago",
      },
    },
  });
  await waitForMicrotasks();
  assert.equal(
    calleeLeg.recentInjectedTexts.length,
    1,
    "the callee leg records what was spoken into it"
  );

  // That Spanish comes straight back off the handset and the callee leg's own
  // Palabra transcribes it. No caption may be written.
  calleePalabra.onEvent({
    message_type: "partial_transcription",
    data: {
      transcription: { transcription_id: "c1", text: "quiere obtener informacion sobre el pago" },
    },
  });
  calleePalabra.onEvent({
    message_type: "validated_transcription",
    data: {
      transcription: { transcription_id: "c1", text: "Quiere obtener información sobre el pago" },
    },
  });
  calleePalabra.onEvent({
    message_type: "translated_transcription",
    data: {
      transcription: {
        transcription_id: "c1",
        text: "She wants to get information about the payment",
      },
    },
  });
  await waitForMicrotasks();
  await waitForMicrotasks();
  assert.equal(written.length, 0, "an echoed utterance produces no caption at all");
  assert.equal(calleeLeg.bridgeEchoSuppressedCaptions, 1);

  // The callee's genuine answer still captions normally.
  calleePalabra.onEvent({
    message_type: "validated_transcription",
    data: {
      transcription: {
        transcription_id: "c2",
        text: "El pago se recibirá mañana a las cuatro de la tarde",
      },
    },
  });
  calleePalabra.onEvent({
    message_type: "translated_transcription",
    data: {
      transcription: {
        transcription_id: "c2",
        text: "The payment will arrive tomorrow at four in the afternoon",
      },
    },
  });
  await waitForMicrotasks();
  await waitForMicrotasks();
  assert.equal(written.length, 1, "the callee's real reply is still captioned");
  assert.equal(written[0].isFinal, true);

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

// Per-utterance bridge latency instrumentation: unlike
// translationFirstOutputLatencyMs (connection-start-relative, fires once per
// call), bridge_translation_utterance_latency must fire once per exchange —
// this is the number that actually tells us whether the bridge is getting
// faster or slower to work with.
async function runBridgeUtteranceLatencyLoggingTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const logs = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationCaptionIntervalMs: 0,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const makeLeg = (socket) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      disclosureAudioProvider: stubDisclosureAudioProvider,
      logger: (level, message, details) => logs.push({ level, message, details }),
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
    });

  const browserSocket = new FakeSocket();
  makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_latency", "workspace_bridge", "browser", { translationEnabled: true })
  );
  await waitForMicrotasks();
  const calleeSocket = new FakeSocket();
  makeLeg(calleeSocket);
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_latency", "workspace_bridge", "callee", { translationEnabled: true })
  );
  await waitForMicrotasks();
  palabraSockets.forEach((s) =>
    s.onEvent({ message_type: "current_task", data: { task_status: "running" } })
  );
  await waitForMicrotasks();
  const [browserPalabra] = palabraSockets;
  await finishBridgeIntroduction(registry.connectionsByCallId.get("call_latency").calleeLeg);

  // The user's utterance: ASR finalizes, then translation text finalizes,
  // then the resulting speech audio arrives.
  browserPalabra.onEvent({
    message_type: "validated_transcription",
    data: { transcription: { transcription_id: "u1", text: "Hola, buenas tardes" } },
  });
  browserPalabra.onEvent({
    message_type: "translated_transcription",
    data: { transcription: { transcription_id: "u1", text: "Hello, good afternoon" } },
  });
  browserPalabra.onEvent({
    message_type: "output_audio_data",
    data: { data: decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD) },
  });
  await waitForMicrotasks();

  const latencyLogs = logs.filter((l) => l.message === "bridge_translation_utterance_latency");
  assert.equal(latencyLogs.length, 1, "one latency measurement per utterance, not per audio chunk");
  assert.equal(latencyLogs[0].details.legRole, "browser");
  assert.equal(typeof latencyLogs[0].details.validatedToAudioMs, "number");
  assert.ok(latencyLogs[0].details.validatedToAudioMs >= 0);
  assert.equal(typeof latencyLogs[0].details.translatedTextToAudioMs, "number");
  assert.ok(latencyLogs[0].details.translatedTextToAudioMs >= 0);
  assert.ok(
    latencyLogs[0].details.validatedToAudioMs >= latencyLogs[0].details.translatedTextToAudioMs,
    "the full ASR-to-audio span is never shorter than the translation-text-to-audio span within it"
  );

  // A second audio chunk for the same utterance (Palabra streams speech in
  // multiple pieces) must not log a second, spurious measurement.
  browserPalabra.onEvent({
    message_type: "output_audio_data",
    data: { data: decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD) },
  });
  await waitForMicrotasks();
  assert.equal(
    logs.filter((l) => l.message === "bridge_translation_utterance_latency").length,
    1,
    "later audio chunks of the same utterance do not re-trigger a measurement"
  );

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

// A configured cloned voice must only ever be applied to the browser leg's
// own Palabra session (translating the Voxandra user's own microphone) —
// never to the callee leg's session, which translates a different real
// person's actual speech. Both legs are given "male" here specifically to
// prove the override is scoped by leg role, not just by the voice-gender
// value, which would otherwise silently apply one account's clone to
// whoever they called.
async function runBridgeClonedVoiceScopedToBrowserLegTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
    palabraClonedVoiceId: "clone-abc123",
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const makeLeg = (socket) =>
    new TwilioRealtimeConnection({
      socket,
      convex,
      config,
      palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
      guidanceRequester: async () => null,
      disclosureAudioProvider: stubDisclosureAudioProvider,
      logger: () => {},
      onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
      onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
    });

  const browserSocket = new FakeSocket();
  makeLeg(browserSocket);
  browserSocket.emit(
    "message",
    makeBridgeStart("call_clone_scope", "workspace_bridge", "browser", {
      translationEnabled: true,
    })
  );
  await waitForMicrotasks();
  const calleeSocket = new FakeSocket();
  makeLeg(calleeSocket);
  calleeSocket.emit(
    "message",
    makeBridgeStart("call_clone_scope", "workspace_bridge", "callee", {
      translationEnabled: true,
    })
  );
  await waitForMicrotasks();

  const [browserTaskEvent, calleeTaskEvent] = palabraSockets.map((s) =>
    s.sent.find((event) => event.message_type === "set_task")
  );
  assert.equal(
    browserTaskEvent.data.pipeline.translations[0].speech_generation.voice_id,
    "clone-abc123",
    "the browser leg (the Voxandra user's own voice) uses the configured clone"
  );
  assert.equal(
    calleeTaskEvent.data.pipeline.translations[0].speech_generation.voice_id,
    "default_low",
    "the callee leg (a different real person's voice) is never given the account's own clone"
  );

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

// Diagnostics added after the 2026-07-31 acceptance test: the callee heard
// nothing, and the worker logs could not distinguish a silent browser
// microphone from a Palabra synthesis failure — the untracked browser leg
// discarded every transcription event, and nothing measured inbound energy.
// Bridge legs must log periodic inbound audio stats and a one-time
// first-transcription marker, both counts/energy only, never content.
async function runBridgeAudioDiagnosticsTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const logs = [];
  const config = {
    ...makeConfig(),
    palabraApiKey: "test-palabra-key",
    palabraChunkFrames: 1,
    translationPalabraWorkspaceIds: ["workspace_bridge"],
  };
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const browserSocket = new FakeSocket();
  const connection = new TwilioRealtimeConnection({
    socket: browserSocket,
    convex,
    config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    guidanceRequester: async () => null,
    logger: (level, message, details) => logs.push({ level, message, details }),
    onCallRegistered: (callId, conn, legRole) => registry.register(callId, conn, legRole),
    onCallUnregistered: (callId, legRole) => registry.unregister(callId, legRole),
  });
  browserSocket.emit(
    "message",
    makeBridgeStart("call_bridge_diag", "workspace_bridge", "browser", {
      translationEnabled: true,
    })
  );
  await waitForMicrotasks();
  palabraSockets[0].onEvent({ message_type: "current_task", data: { task_status: "running" } });
  await waitForMicrotasks();

  const emitFrame = (payload) =>
    browserSocket.emit(
      "message",
      Buffer.from(JSON.stringify({ event: "media", media: { track: "inbound", payload } }))
    );
  emitFrame(LOUD_MULAW_PAYLOAD);
  emitFrame(SILENT_MULAW_PAYLOAD);
  await waitForMicrotasks();
  assert.equal(
    logs.filter((line) => line.message === "bridge_leg_audio_stats").length,
    0,
    "audio stats are not logged before the interval elapses"
  );

  // Rewind the stats window instead of sleeping through the real cadence.
  connection.bridgeAudioStats.lastLogAt = Date.now() - 60_000;
  emitFrame(LOUD_MULAW_PAYLOAD);
  await waitForMicrotasks();
  const statsLine = logs.find((line) => line.message === "bridge_leg_audio_stats");
  assert.ok(statsLine, "bridge legs log periodic inbound audio stats");
  assert.equal(statsLine.details.legRole, "browser");
  assert.equal(statsLine.details.frames, 3, "every inbound frame is counted");
  assert.equal(
    statsLine.details.speechFrames,
    2,
    "loud frames count as speech, silent frames do not"
  );
  assert.ok(statsLine.details.maxRms >= config.transcriptionSpeechThreshold);
  assert.equal(statsLine.details.palabraReady, true);
  // Named so the production log redactor (which hides /transcript/i keys)
  // does not blank it out — the 2026-07-31 diagnostic run printed
  // "[redacted]" for this flag.
  assert.equal(statsLine.details.providerRecognizedSpeech, false);
  assert.equal(connection.bridgeAudioStats.frames, 0, "counters reset after each stats line");
  const calleeSocket = new FakeSocket();
  const callee = new TwilioRealtimeConnection({
    socket: calleeSocket, convex, config,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
    disclosureAudioProvider: stubDisclosureAudioProvider,
    logger: () => {},
    onCallRegistered: (id, leg, role) => registry.register(id, leg, role),
    onCallUnregistered: (id, role) => registry.unregister(id, role),
  });
  calleeSocket.emit("message", makeBridgeStart("call_bridge_diag", "workspace_bridge", "callee", { translationEnabled: true }));
  await waitForMicrotasks();
  await finishBridgeIntroduction(callee);

  // The untracked browser leg logs a one-time marker when Palabra first
  // transcribes anything — proving speech reached the provider — without
  // ever logging transcript text.
  palabraSockets[0].onEvent({
    message_type: "partial_transcription",
    data: { transcription: { transcription_id: "t1", text: "hola" } },
  });
  palabraSockets[0].onEvent({
    message_type: "partial_transcription",
    data: { transcription: { transcription_id: "t1", text: "hola otra vez" } },
  });
  await waitForMicrotasks();
  const markers = logs.filter(
    (line) => line.message === "bridge_translation_transcription_observed"
  );
  assert.equal(markers.length, 1, "the transcription marker logs exactly once");
  assert.equal(markers[0].details.legRole, "browser");
  assert.equal(markers[0].details.firstType, "partial_transcription");
  assert.equal("text" in markers[0].details, false, "the marker never carries transcript text");

  browserSocket.emit("message", Buffer.from(JSON.stringify({ event: "stop", stop: {} })));
  await waitForMicrotasks();
}

// The 2026-07-30 incident, reproduced as a test. Production evidence: on call
// kd7d5n2c88a1sd6s31ax1fssw18bhxvs the browser leg's session ended after 52
// seconds while the callee leg's Palabra session ran for 2,940 more, because
// unregistering a leg only dropped a registry reference. Losing either leg must
// now tear the other one down — vendor session AND Twilio socket, since closing
// a <Connect><Stream> socket is what ends that leg's Twilio call.
async function runBridgeSiblingTeardownTest() {
  for (const endedLeg of ["browser", "callee"]) {
    const registry = makeBridgeRegistry();
    const palabraSockets = [];
    const convex = {
      async mutation(reference, args) {
        assertWorkerFunctionArgs(reference, args);
        return { ok: true };
      },
    };
    const config = {
      ...makeConfig(),
      palabraApiKey: "test-palabra-key",
      palabraChunkFrames: 1,
      translationPalabraWorkspaceIds: ["workspace_bridge"],
    };

    const legs = {};
    for (const legRole of ["browser", "callee"]) {
      const socket = new FakeSocket();
      const connection = new TwilioRealtimeConnection({
        socket,
        convex,
        config,
        palabraSocketFactory: makePalabraSocketFactory(palabraSockets),
        guidanceRequester: async () => null,
        disclosureAudioProvider: stubDisclosureAudioProvider,
        logger: () => {},
        onCallRegistered: registry.register,
        onCallUnregistered: registry.unregister,
      });
      socket.emit(
        "message",
        makeBridgeStart("call_teardown", "workspace_bridge", legRole, {
          translationEnabled: true,
        })
      );
      await waitForMicrotasks();
      legs[legRole] = { socket, connection };
    }

    const survivingLeg = endedLeg === "browser" ? "callee" : "browser";
    assert.equal(palabraSockets.length, 2, "both legs opened a Palabra session");
    assert.equal(
      legs[survivingLeg].connection.siblingLeg,
      legs[endedLeg].connection,
      "siblings cross-reference before teardown"
    );
    const survivorPalabra = palabraSockets[survivingLeg === "browser" ? 0 : 1];
    assert.equal(survivorPalabra.closed, false, "the surviving leg's vendor socket is open");

    // Twilio drops the ended leg's media-stream socket.
    legs[endedLeg].socket.emit("close");
    await waitForMicrotasks();
    await waitForMicrotasks();

    assert.equal(
      legs[endedLeg].connection.ended,
      true,
      `${endedLeg} leg ended when its socket closed`
    );
    assert.equal(
      legs[survivingLeg].connection.ended,
      true,
      `losing the ${endedLeg} leg must end the ${survivingLeg} leg, not just unlink it`
    );
    assert.equal(
      survivorPalabra.closed,
      true,
      `the ${survivingLeg} leg's Palabra session must be closed, not merely dereferenced`
    );
    assert.equal(
      registry.connectionsByCallId.has("call_teardown"),
      false,
      "the registry entry is removed once both legs are gone"
    );
    assert.equal(
      legs[survivingLeg].connection.siblingLeg,
      undefined,
      "no dangling sibling reference survives"
    );
  }
}

// A bridge leg must bound its own session even if every Twilio- and
// Convex-side cap fails. The browser leg is answered with <Connect><Stream>,
// which has no `timeLimit` attribute, so before this its only ceiling was
// Twilio's four-hour global maximum.
async function runBridgeSessionDeadlineTest() {
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const makeLeg = (params) => {
    const socket = new FakeSocket();
    const connection = new TwilioRealtimeConnection({
      socket,
      convex,
      config: { ...makeConfig(), bridgeMaxSessionSeconds: 600 },
      guidanceRequester: async () => null,
      logger: () => {},
    });
    socket.emit("message", makeBridgeStart("call_deadline", "workspace_bridge", "browser", params));
    return { socket, connection };
  };

  // The signed per-call cap is honoured when it is below the worker ceiling.
  const capped = makeLeg({ maxSessionSeconds: 120 });
  await waitForMicrotasks();
  assert.ok(capped.connection.bridgeSessionDeadlineTimer, "a bridge leg arms a deadline timer");
  // A parameter above the worker's ceiling must be clamped down, never honoured:
  // the worker is the last line of defence and cannot be talked into waiting
  // longer by anything upstream.
  const overreaching = makeLeg({ maxSessionSeconds: 99999 });
  await waitForMicrotasks();
  assert.ok(
    overreaching.connection.bridgeSessionDeadlineTimer,
    "an over-large parameter still arms a timer"
  );
  // A missing parameter must still arm the ceiling, not disable the cap.
  const unspecified = makeLeg({});
  await waitForMicrotasks();
  assert.ok(
    unspecified.connection.bridgeSessionDeadlineTimer,
    "a missing maxSessionSeconds falls back to the worker ceiling instead of no cap"
  );

  // Firing the deadline must end the session and close the Twilio socket, which
  // is what actually hangs up a <Connect><Stream> leg.
  let closed = false;
  capped.socket.close = () => {
    closed = true;
  };
  await capped.connection.terminateForLifecycleEvent("bridge_session_deadline");
  assert.equal(capped.connection.ended, true, "the deadline ends the media session");
  assert.equal(closed, true, "the deadline closes the Twilio socket so the leg hangs up");
  assert.equal(
    capped.connection.bridgeSessionDeadlineTimer,
    undefined,
    "the timer is cleared so it cannot fire against a closed connection"
  );

  // A non-bridge call must not arm a deadline at all.
  const plainSocket = new FakeSocket();
  const plainConnection = new TwilioRealtimeConnection({
    socket: plainSocket,
    convex,
    config: makeConfig(),
    guidanceRequester: async () => null,
    logger: () => {},
  });
  plainSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZPLAIN",
          callSid: "CAPLAIN",
          customParameters: {
            voxandraCallId: "call_plain",
            workspaceId: "workspace_bridge",
            liveCopilot: "false",
            translatedCaptions: "false",
          },
        },
      })
    )
  );
  await waitForMicrotasks();
  assert.equal(plainConnection.bridgeModeActive, false);
  assert.equal(
    plainConnection.bridgeSessionDeadlineTimer,
    undefined,
    "a normal call is bounded by <Dial timeLimit> and must not arm a bridge deadline"
  );
}

async function runBridgeRelayWithoutCalleeLegTest() {
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const browserSocket = new FakeSocket();
  const connection = new TwilioRealtimeConnection({
    socket: browserSocket,
    convex,
    config: makeConfig(),
    guidanceRequester: async () => null,
    logger: () => {},
  });

  browserSocket.emit(
    "message",
    makeBridgeStart("call_bridge_alone", "workspace_bridge", "browser")
  );
  await waitForMicrotasks();
  assert.equal(connection.bridgeModeActive, true);
  assert.equal(connection.siblingLeg, undefined);

  // No registry callbacks wired at all (mirrors a browser leg that connects
  // before the callee leg, or whose sibling never arrives) — the relay must
  // be a silent no-op, never a crash.
  browserSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    browserSocket.sent.filter((frame) => frame.event === "media").length,
    0,
    "with no sibling leg registered, the relay drops frames silently instead of throwing"
  );
}

async function runEchoTestPipelineTest() {
  const socket = new FakeSocket();
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const config = { ...makeConfig(), echoTestWorkspaceIds: ["workspace_echo"] };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZECHO",
          callSid: "CAECHO",
          customParameters: {
            voxandraCallId: "call_echo",
            workspaceId: "workspace_echo",
            liveCopilot: "false",
            translatedCaptions: "false",
            echoTestEnabled: "true",
          },
        },
      })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    connection.echoTestActive,
    true,
    "workspace allowlist and the per-call flag both set enables echo test mode"
  );

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();

  const outboundFrames = socket.sent.filter((frame) => frame.event === "media");
  assert.equal(
    outboundFrames.length,
    1,
    "one inbound frame produces exactly one echoed outbound frame"
  );
  assert.equal(
    outboundFrames[0].streamSid,
    "MZECHO",
    "the echoed frame carries the call's streamSid"
  );
  assert.equal(
    outboundFrames[0].media.payload,
    LOUD_MULAW_PAYLOAD,
    "a constant-value frame round-trips through decode+encode unchanged"
  );

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "outbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    socket.sent.filter((frame) => frame.event === "media").length,
    1,
    "only the caller's own inbound mic is echoed, never the (nonexistent, since there is no <Dial>) outbound track"
  );
}

async function runEchoTestDisabledWhenNotAllowlistedTest() {
  const socket = new FakeSocket();
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config: makeConfig(),
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZNOECHO",
          callSid: "CANOECHO",
          customParameters: {
            voxandraCallId: "call_no_echo",
            workspaceId: "workspace_not_allowlisted",
            liveCopilot: "false",
            translatedCaptions: "false",
            echoTestEnabled: "true",
          },
        },
      })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    connection.echoTestActive,
    false,
    "a workspace not on the allowlist never activates echo test mode, even with the flag set"
  );

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();

  assert.equal(
    socket.sent.filter((frame) => frame.event === "media").length,
    0,
    "a non-allowlisted workspace never echoes audio back to Twilio"
  );
}

async function runEchoTestDisabledWithoutFlagTest() {
  const socket = new FakeSocket();
  const convex = {
    async mutation(reference, args) {
      assertWorkerFunctionArgs(reference, args);
      return { ok: true };
    },
  };
  const config = { ...makeConfig(), echoTestWorkspaceIds: ["workspace_echo_flagoff"] };
  const connection = new TwilioRealtimeConnection({
    socket,
    convex,
    config,
    guidanceRequester: async () => null,
    logger: () => {},
  });

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZFLAGOFF",
          callSid: "CAFLAGOFF",
          customParameters: {
            voxandraCallId: "call_flag_off",
            workspaceId: "workspace_echo_flagoff",
            liveCopilot: "false",
            translatedCaptions: "false",
          },
        },
      })
    )
  );
  await waitForMicrotasks();
  assert.equal(
    connection.echoTestActive,
    false,
    "an allowlisted workspace without the explicit per-call flag never activates echo test mode"
  );

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ event: "media", media: { track: "inbound", payload: LOUD_MULAW_PAYLOAD } })
    )
  );
  await waitForMicrotasks();

  assert.equal(
    socket.sent.filter((frame) => frame.event === "media").length,
    0,
    "an allowlisted workspace still needs the explicit per-call flag to echo audio"
  );
}

// getOrGenerateDisclosureAudio: cache-miss -> translate+synthesize ->
// disk-cache-write -> cache-hit on a later call, plus de-duplication when two
// callers race for the same not-yet-cached language. Uses a temp directory
// per test run so this never touches the real worker's disk cache.
async function runDisclosureCacheMissGeneratesAndCachesTest() {
  clearDisclosureAudioCacheForTests();
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "voxandra-disclosure-cache-"));
  const config = makeConfig();
  const translateCalls = [];
  const speechCalls = [];
  // Plausibly long relative to the ~35-character fake translation below, so
  // it clears synthesizeDisclosureAudio's truncation-plausibility floor on
  // the first attempt (that floor gets its own dedicated tests further
  // down). Uint8Array.from allocates its own exact-sized ArrayBuffer, unlike
  // Buffer.from (which may allocate from Node's shared pool, making .buffer
  // larger than the bytes actually written).
  const fakePcm = Uint8Array.from({ length: 200_000 }, (_, i) => i % 256);
  const fetchImpl = async (url, init) => {
    if (url.includes("/v1/responses")) {
      translateCalls.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({ output_text: "Esta llamada esta siendo traducida." }),
      };
    }
    if (url.includes("/v1/audio/speech")) {
      speechCalls.push(JSON.parse(init.body));
      return { ok: true, arrayBuffer: async () => fakePcm.buffer };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const first = await defaultGetOrGenerateDisclosureAudio({
    config,
    languageCode: "es",
    fetchImpl,
    cacheDir,
  });
  assert.equal(translateCalls.length, 1, "a cache miss triggers exactly one translation call");
  assert.equal(speechCalls.length, 1, "a cache miss triggers exactly one TTS call");
  assert.equal(first, Buffer.from(fakePcm).toString("base64"));

  // The filename must embed the English-script hash: that hash is what makes
  // a wording change invalidate every cached language clip automatically.
  const { pcmPath } = disclosureCachePaths("es", cacheDir);
  assert.match(
    path.basename(pcmPath),
    /^es\.[0-9a-f]{10}\.pcm$/,
    "cache filenames carry the English-script content hash"
  );

  const onDiskAfterFirst = await fs.readFile(pcmPath);
  assert.ok(
    onDiskAfterFirst.equals(Buffer.from(fakePcm)),
    "the generated clip is written to the disk cache"
  );

  clearDisclosureAudioCacheForTests();
  const second = await defaultGetOrGenerateDisclosureAudio({
    config,
    languageCode: "es",
    fetchImpl,
    cacheDir,
  });
  assert.equal(
    translateCalls.length,
    1,
    "a warm process restart reads the disk cache instead of regenerating"
  );
  assert.equal(second, first);

  const third = await defaultGetOrGenerateDisclosureAudio({
    config,
    languageCode: "es",
    fetchImpl,
    cacheDir,
  });
  assert.equal(
    translateCalls.length,
    1,
    "a warm in-memory cache never re-reads disk or regenerates"
  );
  assert.equal(third, first);
  for (const englishText of [BRIDGE_GO_AHEAD_ENGLISH_TEXT, BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT, BRIDGE_DISCLOSURE_ENGLISH_TEXT]) {
    let spokenText;
    await defaultGetOrGenerateDisclosureAudio({ config, languageCode: "es", englishText, fetchImpl, cacheDir, onText: (text) => { spokenText = text; } });
    assert.equal(spokenText, "Esta llamada esta siendo traducida.", "echo filtering receives the actual cached text, not a second translation");
    assert.equal(await readCachedDisclosureText("es", cacheDir, englishText), spokenText, "prewarming reads the correct clip family's text sidecar");
  }
  assert.equal(translateCalls.length, 3, "notice, go-ahead and failure clips each have independent caches");
  assert.equal(speechCalls.length, 3);

  await fs.rm(cacheDir, { recursive: true, force: true });
}

async function runDisclosureConcurrentGenerationDeduplicatesTest() {
  clearDisclosureAudioCacheForTests();
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "voxandra-disclosure-cache-"));
  const config = makeConfig();
  let translateCallCount = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/v1/responses")) {
      translateCallCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, json: async () => ({ output_text: "Ce texte est traduit." }) };
    }
    if (url.includes("/v1/audio/speech")) {
      // Plausibly long relative to the ~22-character fake translation above.
      const pcm = Uint8Array.from({ length: 150_000 }, (_, i) => (i * 7) % 256);
      return { ok: true, arrayBuffer: async () => pcm.buffer };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const [a, b, c] = await Promise.all([
    defaultGetOrGenerateDisclosureAudio({ config, languageCode: "fr", fetchImpl, cacheDir }),
    defaultGetOrGenerateDisclosureAudio({ config, languageCode: "fr", fetchImpl, cacheDir }),
    defaultGetOrGenerateDisclosureAudio({ config, languageCode: "fr", fetchImpl, cacheDir }),
  ]);
  assert.equal(
    translateCallCount,
    1,
    "three callers racing for the same not-yet-cached language trigger exactly one generation"
  );
  assert.equal(a, b);
  assert.equal(b, c);

  await fs.rm(cacheDir, { recursive: true, force: true });
}

function runDisclosureTranslateSkipsForEnglishUnitTest() {
  // English never round-trips through the model — it IS the source script.
  const fetchImpl = async () => {
    throw new Error("English must never call the translation API");
  };
  return translateDisclosureText({ config: makeConfig(), languageCode: "en", fetchImpl }).then(
    (text) => {
      assert.equal(text, BRIDGE_DISCLOSURE_ENGLISH_TEXT);
    }
  );
}

async function runDisclosureSpeechRejectsEmptyAudioTest() {
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(
    () => synthesizeDisclosureAudio({ config: makeConfig(), text: "hola", fetchImpl }),
    /empty audio/,
    "an empty TTS response is treated as a failure, not a silent disclosure"
  );
}

// Reproduces the real 2026-08-13 incident: an identical request returned a
// clip that was audibly cut off short on one attempt and complete on the
// next. A response shorter than the plausibility floor is retried once, not
// accepted immediately.
async function runDisclosureSpeechRetriesOnTruncatedAudioTest() {
  const text =
    "Esta chamada esta sendo traduzida em tempo real pela Voxandra, um servico de traducao.";
  const minBytes = minExpectedPcmBytesForText(text);
  assert.ok(minBytes > 0, "a non-empty sentence has a non-zero plausibility floor");

  const tooShort = Uint8Array.from({ length: Math.floor(minBytes / 3) }, (_, i) => i % 256);
  const complete = Uint8Array.from({ length: minBytes + 5000 }, (_, i) => (i * 3) % 256);
  const attempts = [];
  const fetchImpl = async () => {
    attempts.push(attempts.length);
    // The first attempt looks truncated; the second is a plausible length.
    const pcm = attempts.length < 2 ? tooShort : complete;
    return { ok: true, arrayBuffer: async () => pcm.buffer };
  };

  const base64Pcm = await synthesizeDisclosureAudio({ config: makeConfig(), text, fetchImpl });
  assert.equal(attempts.length, 2, "retries once when the first attempt looks truncated");
  assert.equal(
    base64Pcm,
    Buffer.from(complete).toString("base64"),
    "the accepted result is the plausible-length attempt, not a truncated one"
  );
}

// Real 2026-08-13 incident: throwing here (the original design) cascaded
// through the bridge's sibling-teardown logic and killed a live phone call
// for both real participants over what may have just been a marginally
// brisk-but-complete delivery. A probably-short disclosure is now preferred
// over discarding real audio and serving nothing at all — only a genuinely
// empty response is treated as an outright failure.
async function runDisclosureSpeechAcceptsLongestAttemptAfterPersistentTruncationTest() {
  const text = "Esta llamada esta siendo traducida en tiempo real por Voxandra.";
  const minBytes = minExpectedPcmBytesForText(text);
  let attemptCount = 0;
  const shorter = Uint8Array.from({ length: Math.floor(minBytes / 2) }, (_, i) => i % 256);
  const longerButStillShort = Uint8Array.from(
    { length: Math.floor(minBytes / 2) + 1000 },
    (_, i) => (i * 5) % 256
  );
  const fetchImpl = async () => {
    attemptCount += 1;
    const pcm = attemptCount === 1 ? shorter : longerButStillShort;
    return { ok: true, arrayBuffer: async () => pcm.buffer };
  };

  const base64Pcm = await synthesizeDisclosureAudio({ config: makeConfig(), text, fetchImpl });
  assert.equal(attemptCount, 2, "tries twice, never more, before accepting the best attempt");
  assert.equal(
    base64Pcm,
    Buffer.from(longerButStillShort).toString("base64"),
    "the longest attempt is used even though neither cleared the plausibility floor"
  );
}

async function runProtectedIntroductionLifecycleTest() {
  const requests = [];
  const provider = async ({ languageCode, englishText, onText }) => {
    requests.push({ languageCode, englishText });
    onText?.(`${languageCode} ${englishText}`);
    const bytes = englishText === BRIDGE_DISCLOSURE_ENGLISH_TEXT ? 2880
      : englishText === BRIDGE_GO_AHEAD_ENGLISH_TEXT && languageCode === "es" ? 1920 : 960;
    return Buffer.alloc(bytes, 23).toString("base64");
  };
  const bridge = await startTranslatedBridge({
    callId: "call_protected", convex: makeRecordingConvex(), finishIntroduction: false,
    providerReady: false, disclosureAudioProvider: provider,
    config: { bridgePassthroughGain: 0.3, bridgePassthroughDuckedGain: 0.06 },
  });
  const { browserLeg, calleeLeg, browserSocket, calleeSocket, browserPalabra, calleePalabra } = bridge;
  const introduction = calleeLeg.bridgeIntroduction;
  const lastMark = (leg) => leg.socket.sent.filter((event) => event.event === "mark").at(-1);
  const acknowledge = (leg, event = lastMark(leg)) => leg.handleTwilioMessage(Buffer.from(JSON.stringify(event)));
  assert.equal(requests.filter((request) => request.englishText === BRIDGE_DISCLOSURE_ENGLISH_TEXT).length, 1);
  assert.deepEqual(requests.filter((request) => request.englishText === BRIDGE_GO_AHEAD_ENGLISH_TEXT).map((request) => request.languageCode), ["es", "en"]);
  let guidanceFrames = 0;
  browserLeg.liveCopilot = true;
  browserLeg.routeGuidanceFrame = () => { guidanceFrames += 1; };
  for (let i = 0; i < 3; i += 1) {
    bridge.emitBrowserFrame();
    bridge.emitCalleeFrame();
    introduction.tick();
    assert.equal(calleeLeg.isDisclosurePlaying(), true);
    assert.equal(browserLeg.isDisclosurePlaying(), true);
  }
  assert.equal(guidanceFrames, 0, "neither system audio nor early speech reaches Guidance");
  browserLeg.liveCopilot = false;
  assert.equal(calleeSocket.sent.filter((event) => event.event === "media").length, 3, "microphone clocks cannot duplicate startup output");
  for (const socket of [browserSocket, calleeSocket]) {
    assert.ok(socket.sent.filter((event) => event.event === "media").every((event) =>
      event.media.payload === encodePcm24Base64ToMuLawBase64(Buffer.alloc(960, 23).toString("base64"))));
  }
  browserLeg.mixBridgeFrameFromSibling(decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD));
  assert.equal(browserSocket.sent.filter((event) => event.event === "media").length, 3, "direct mixer calls cannot bypass protection");
  browserPalabra.onEvent({ message_type: "output_audio_data", data: { data: Buffer.alloc(960, 42).toString("base64") } });
  assert.equal(browserLeg.translationHasOutput, false, "startup output cannot count as usable translated usage");
  assert.equal(calleeLeg.bridgeTranslatedQueuedBytes, 0);
  await browserLeg.tickBridgeInactivity();
  assert.equal(browserLeg.inactivityClock.state(Date.now()), "waiting");
  const oldCalleeMark = lastMark(calleeLeg);
  await acknowledge(calleeLeg, { ...oldCalleeMark, streamSid: browserLeg.streamSid });
  await acknowledge(calleeLeg, { ...oldCalleeMark, mark: { name: "unknown" } });
  assert.equal(introduction.playback.get(calleeLeg).acknowledged, false);
  await acknowledge(browserLeg);
  await acknowledge(browserLeg);
  assert.equal(introduction.phase, "playing", "duplicates cannot stand in for the other leg");
  await acknowledge(calleeLeg);
  assert.equal(introduction.phase, "playing", "playback completion alone does not prove translation readiness");
  browserPalabra.onEvent({ message_type: "current_task", data: { task_status: "running" } });
  introduction.tick();
  assert.equal(introduction.phase, "playing", "both translation directions must be ready");
  calleePalabra.onEvent({ message_type: "current_task", data: { task_status: "running" } });
  introduction.tick();
  assert.equal(introduction.phase, "readying");
  assert.deepEqual(introduction.playback.get(browserLeg).pcm.subarray(0, 960), Buffer.alloc(960), "the shorter cue starts later so both cues finish together");
  assert.equal(introduction.playback.get(browserLeg).pcm.length, introduction.playback.get(calleeLeg).pcm.length);
  introduction.tick();
  await acknowledge(calleeLeg, oldCalleeMark);
  assert.equal(calleeLeg.bridgeConversationOpen, false, "a previous-stage mark cannot finish the cue");
  await acknowledge(browserLeg);
  assert.equal(calleeLeg.bridgeConversationOpen, false);
  await acknowledge(calleeLeg);
  assert.equal(browserLeg.bridgeConversationOpen, true);
  assert.equal(calleeLeg.bridgeConversationOpen, true);
  assert.equal(introduction.stopped, true);
  bridge.emitBrowserFrame();
  assert.equal(browserPalabra.sent.filter((event) => event.message_type === "input_audio_data").at(-1).data.data,
    decodeMuLawBase64ToPcm24Base64(LOUD_MULAW_PAYLOAD), "the first word after go-ahead is not muted or dropped");
  await browserLeg.tickBridgeInactivity();
  assert.equal(browserLeg.inactivityClock.state(Date.now()), "active");
  await calleeLeg.closeBridgeForSafety("test_complete");

  for (const failure of ["clear", "timeout", "provider", "hangup"]) {
    const convex = makeRecordingConvex();
    const current = await startTranslatedBridge({ callId: `call_intro_${failure}`, convex, finishIntroduction: false, disclosureAudioProvider: provider });
    const intro = current.calleeLeg.bridgeIntroduction;
    for (let i = 0; i < 3; i += 1) intro.tick();
    const staleMark = lastMark(current.calleeLeg);
    if (failure === "clear") current.calleeLeg.sendClearToTwilio();
    if (failure === "timeout") intro.tick(intro.deadline);
    if (failure === "provider") await current.browserLeg.failTranslation(new Error("provider unavailable"));
    if (failure === "hangup") await current.browserLeg.closeBridgeForSafety("test_hangup");
    await acknowledge(current.calleeLeg, staleMark);
    assert.equal(current.calleeLeg.bridgeConversationOpen, false, `${failure} never opens the call`);
    assert.equal(current.browserLeg.bridgeDegraded, false, `${failure} cannot fall through to plain calling during setup`);
    if (failure !== "hangup") {
      assert.equal(intro.phase, "failed");
      intro.tick();
      if (failure === "timeout") intro.tick(intro.deadline);
      else {
        await acknowledge(current.browserLeg);
        await acknowledge(current.calleeLeg);
      }
    }
    await waitForMicrotasks();
    assert.equal(current.browserSocket.closed, true, `${failure} closes the browser socket`);
    assert.equal(current.calleeSocket.closed, true, `${failure} closes the recipient socket`);
    assert.equal(intro.stopped, true);
    assert.equal(convex.named(api.realtimeRuntime.updateBridgeDisclosureStateFromWorker).some((item) => item.args.state === "done"), false);
  }
  assert.equal(BRIDGE_INTRODUCTION_TIMEOUT_MS, 60_000);
  assert.ok(requests.some((request) => request.englishText === BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT));
}

async function runIntroductionConnectionOrderAndCancellationTest() {
  const registry = makeBridgeRegistry();
  const palabraSockets = [];
  const convex = makeRecordingConvex();
  const config = { ...makeConfig(), palabraApiKey: "test-palabra-key", palabraChunkFrames: 1, translationPalabraWorkspaceIds: ["workspace_bridge"] };
  const makeLeg = () => new TwilioRealtimeConnection({
    socket: new FakeSocket(), convex, config,
    disclosureAudioProvider: stubDisclosureAudioProvider,
    palabraSocketFactory: makePalabraSocketFactory(palabraSockets), logger: () => {},
    onCallRegistered: (id, leg, role) => registry.register(id, leg, role),
    onCallUnregistered: (id, role) => registry.unregister(id, role),
  });
  const callee = makeLeg();
  callee.socket.emit("message", makeBridgeStart("callee_first", "workspace_bridge", "callee", { translationEnabled: true }));
  await waitForMicrotasks();
  clearInterval(callee.bridgeIntroduction.timer);
  callee.bridgeIntroduction.tick();
  assert.equal(callee.socket.sent.length, 0, "the announcement waits for the caller's stream even if the recipient connects first");
  const browser = makeLeg();
  browser.socket.emit("message", makeBridgeStart("callee_first", "workspace_bridge", "browser", { translationEnabled: true }));
  await waitForMicrotasks();
  for (const leg of [browser, callee]) leg.handlePalabraEvent({ message_type: "current_task", data: { task_status: "running" } });
  callee.bridgeIntroduction.tick(Date.now() + 1100);
  for (const socket of palabraSockets) {
    assert.equal(socket.sent.filter((event) => event.message_type === "input_audio_data").at(-1).data.data, Buffer.alloc(960).toString("base64"),
      "silence keepalives do not depend on a muted or missing microphone clock");
  }
  await finishBridgeIntroduction(callee);
  await callee.closeBridgeForSafety("test_complete");

  for (const action of ["timeout", "hangup"]) {
    let resolveDisclosure;
    const pending = new Promise((resolve) => { resolveDisclosure = resolve; });
    const waiting = await startTranslatedBridge({
      callId: `pending_${action}`, convex: makeRecordingConvex(), finishIntroduction: false,
      disclosureAudioProvider: ({ englishText }) => englishText === BRIDGE_DISCLOSURE_ENGLISH_TEXT ? pending : stubDisclosureAudioProvider(),
    });
    const intro = waiting.calleeLeg.bridgeIntroduction;
    if (action === "timeout") {
      intro.tick(intro.deadline);
      intro.tick(intro.deadline);
    } else await waiting.browserLeg.closeBridgeForSafety("test_hangup");
    await waitForMicrotasks();
    resolveDisclosure(Buffer.alloc(960, 23).toString("base64"));
    await waitForMicrotasks();
    intro.tick();
    assert.equal(intro.stopped, true);
    assert.equal(waiting.calleeLeg.bridgeConversationOpen, false);
    assert.equal(waiting.browserSocket.closed, true);
    assert.equal(waiting.calleeSocket.closed, true);
    assert.equal(waiting.calleeSocket.sent.some((event) => event.event === "media"), false, "late synthesis cannot restart canceled playback");
  }
}

await runIntroductionConnectionOrderAndCancellationTest();
await runProtectedIntroductionLifecycleTest();
await runSpanishFixturePathTest();
await runBrowserAudioForwardTest();
await runBrowserAudioForwardDisabledTest();
await runBridgeRegistryAndRelayTest();
await runBridgeClonedVoiceScopedToBrowserLegTest();
await runBridgeAudioDiagnosticsTest();
await runBridgePassthroughMixTest();
await runBridgeGateSuppressesAudioDuringDisclosurePrimingTest();
await runBridgeDisclosurePlaybackTest();
runBridgeComfortAudioUnitTest();
await runBridgeRingbackUntilCalleeConnectsTest();
await runBridgeMicGatedDuringDisclosureTest();
await runBridgeDegradesToPlainCallOnTranslationFailureTest();
await runBridgeReverseSessionLifecycleTest();
await runBridgeDisclosureFailureClosesLegTest();
await runBridgeHandleStartStopsIfEndedDuringDisclosureTest();
await runBridgeCaptionEchoSuppressionTest();
await runBridgeUtteranceLatencyLoggingTest();
runBridgeMixUnitTest();
await runBridgeSiblingTeardownTest();
await runBridgeSessionDeadlineTest();
await runBridgeRelayWithoutCalleeLegTest();
await runEchoTestPipelineTest();
await runEchoTestDisabledWhenNotAllowlistedTest();
await runEchoTestDisabledWithoutFlagTest();
await runStreamSignatureUnitTest();
await runStreamSignatureMirrorsNextJsImplementationTest();
runStreamAuthConfigTest();
await runStreamAuthRejectsUnsignedStartTest();
await runStreamAuthRejectsTamperedAndStaleStartTest();
await runStreamAuthBindsCallSidThroughConvexTest();
await runStreamAuthEchoTestSkipsConvexBindingTest();
await runPendingStreamCapAndStartTimeoutTest();
await runPalabraPipelineTest();
await runPalabraFailureIsolationTest();
await runPalabraMissingKeyTest();
await runPalabraRequiresPerCallFlagTest();
runAudioConversionTest();
runOutboundAudioConversionTest();
runConfidenceMathTest();
runSourceWindowUnitTest();
runCascadeGlossaryTest();
runAudioForwardAllowlistUnitTest();
runPalabraTaskUnitTest();
await runDisclosureCacheMissGeneratesAndCachesTest();
await runDisclosureConcurrentGenerationDeduplicatesTest();
await runDisclosureTranslateSkipsForEnglishUnitTest();
await runDisclosureSpeechRejectsEmptyAudioTest();
await runDisclosureSpeechRetriesOnTruncatedAudioTest();
await runDisclosureSpeechAcceptsLongestAttemptAfterPersistentTruncationTest();
const { BridgeInactivityClock, createBridgeSpeechDetector } = await import("./realtime-media-worker-inactivity.mjs");
const inactivityClock = new BridgeInactivityClock();
assert.equal(inactivityClock.state(1_000_000), "waiting");
inactivityClock.start(1_000_000);
assert.equal(inactivityClock.state(1_119_999), "active");
assert.equal(inactivityClock.state(1_120_000), "warning");
assert.equal(inactivityClock.state(1_180_000), "expired");
inactivityClock.activity(1_170_000);
assert.equal(inactivityClock.state(1_180_000), "active");
inactivityClock.activity(1_100_000);
assert.equal(inactivityClock.lastActivityAt, 1_170_000, "stale activity never moves the timer backwards");
const speechDetector = await createBridgeSpeechDetector();
try {
  const silence = Buffer.alloc(960).toString("base64");
  for (let i = 0; i < 100; i += 1) assert.equal(speechDetector.detect(silence), false);
  const dc = Buffer.alloc(960);
  for (let i = 0; i < dc.length; i += 2) dc.writeInt16LE(12000, i);
  let dcSpeech;
  for (let i = 0; i < 100; i += 1) dcSpeech = speechDetector.detect(dc.toString("base64"));
  assert.equal(dcSpeech, false, "sustained loud non-speech is not activity merely because of its volume");
  assert.equal(speechDetector.detect(dc.toString("base64"), true), false, "injected audio is excluded");
  let voicedFrames = 0;
  for (let frame = 0; frame < 150; frame += 1) {
    const pcm = Buffer.alloc(960);
    for (let sample = 0; sample < 480; sample += 1) {
      const t = (frame * 480 + sample) / 24000;
      const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
      let value = 0;
      for (let harmonic = 1; harmonic <= 20; harmonic += 1) value += Math.sin(2 * Math.PI * 140 * harmonic * t) / harmonic;
      pcm.writeInt16LE(Math.round(7000 * envelope * value), sample * 2);
    }
    if (speechDetector.detect(pcm.toString("base64"))) voicedFrames += 1;
  }
  assert.ok(voicedFrames > 20, "the actual detector recognizes modulated voiced harmonics, not just silence fixtures");
} finally { speechDetector.destroy(); }

const realNow = Date.now;
let inactivityNow = 10_000_000;
Date.now = () => inactivityNow;
const warningRequests = [];
let keepAt = 0;
let networkFailed = false;
const inactivityConfig = { ...makeConfig(), translationDrainMs: 0 };
const speech = { browser: false, callee: false };
const inactivityLegs = {};
try {
  for (const role of ["browser", "callee"]) {
    const leg = new TwilioRealtimeConnection({
      socket: new FakeSocket(),
      config: inactivityConfig,
      convex: { mutation: async (ref, args) => {
        assertWorkerFunctionArgs(ref, args);
        if (networkFailed) throw new Error("offline");
        return { ended: args.durationLimitReached || (args.endIfIdle && keepAt <= args.lastActivityAt), lastActivityAt: Math.max(args.lastActivityAt, keepAt) };
      } },
      disclosureAudioProvider: async (args) => { warningRequests.push(args); return Buffer.alloc(48000).toString("base64"); },
      logger: () => {},
    });
    Object.assign(leg, { legRole: role, callId: "call_idle", workspaceId: "workspace", providerCallSid: `CA${role}`, streamSid: `MZ${role}`, bridgeModeActive: true, sourceLanguage: role === "browser" ? "en" : "es" });
    leg.bridgeSpeechDetector = { detect: (_pcm, suppressed) => !suppressed && speech[role], destroy: () => {} };
    inactivityLegs[role] = leg;
  }
  const { browser, callee } = inactivityLegs;
  await browser.tickBridgeInactivity();
  assert.equal(browser.inactivityClock.state(inactivityNow), "waiting", "ringing does not start the inactivity window");
  browser.siblingLeg = callee;
  callee.siblingLeg = browser;
  callee.bridgeTranslationRequested = true;
  callee.disclosureGateOpen = false;
  await browser.tickBridgeInactivity();
  assert.equal(browser.inactivityClock.state(inactivityNow), "waiting", "disclosure time does not count as inactivity");
  callee.disclosureGateOpen = true;
  callee.bridgeConversationOpen = true;
  await browser.tickBridgeInactivity();
  browser.startBridgeSessionDeadline("99999");
  assert.equal(browser.bridgeSessionDeadlineTimer._idleTimeout, 3600_000, "worker independently caps all settings at 60 minutes");
  browser.clearBridgeSessionDeadline();
  inactivityNow += 60_000;
  await browser.tickBridgeInactivity();
  await waitForMicrotasks();
  assert.equal(warningRequests.length, 2, "warning clips are prepared before their playback deadline");
  assert.equal(browser.safetyAudio.length + callee.safetyAudio.length, 0, "preparing a clip does not play it early");
  inactivityNow += 60_000;
  await browser.tickBridgeInactivity();
  await waitForMicrotasks();
  assert.deepEqual(warningRequests.map((args) => args.languageCode), ["en", "es"]);
  assert.ok(warningRequests.every((args) => args.englishText.includes("Keep connected")));
  assert.ok(browser.safetyAudio.length && callee.safetyAudio.length);
  await browser.tickBridgeInactivity();
  assert.equal(warningRequests.length, 2, "a warning plays once per inactivity window");
  browser.bridgeDegraded = true;
  browser.mixBridgeFrameFromSibling(Buffer.alloc(960).toString("base64"));
  assert.equal(browser.safetyAudio.length, 48000 - 960, "safety notices still play after translation degrades");
  const beforeEcho = browser.inactivityClock.lastActivityAt;
  speech.browser = true;
  browser.handleMedia({ track: "inbound", payload: SILENT_MULAW_PAYLOAD });
  assert.equal(browser.inactivityClock.lastActivityAt, beforeEcho, "our spoken notice cannot reset the timer through speakerphone echo");
  browser.safetyAudio = Buffer.alloc(0);
  callee.safetyAudio = Buffer.alloc(0);
  inactivityNow += 1000;
  speech.browser = false;
  speech.callee = true;
  callee.handleMedia({ track: "inbound", payload: SILENT_MULAW_PAYLOAD });
  assert.equal(browser.inactivityClock.lastActivityAt, inactivityNow, "speech on either leg resets the shared inactivity window");
  await browser.tickBridgeInactivity();
  assert.equal(browser.inactivityWarningFor, undefined);
  inactivityNow += 120_000;
  await browser.tickBridgeInactivity();
  await waitForMicrotasks();
  keepAt = inactivityNow + 1000;
  inactivityNow = keepAt;
  await browser.tickBridgeInactivity();
  assert.equal(browser.inactivityClock.lastActivityAt, keepAt);
  assert.equal(browser.safetyAudio.length + callee.safetyAudio.length, 0, "Keep connected cancels both pending notices");
  inactivityNow += 120_000;
  await browser.tickBridgeInactivity();
  inactivityNow += 60_000;
  networkFailed = true;
  await browser.tickBridgeInactivity();
  assert.equal(browser.ended, true, "the local inactivity deadline survives a backend outage");
  assert.equal(callee.ended, true, "inactivity ends both legs, not just the browser");
} finally {
  for (const leg of Object.values(inactivityLegs)) await leg.close("completed");
  Date.now = realNow;
}
let releaseSettlement;
let safetySocketClosed = false;
const settlementPending = new Promise((resolve) => { releaseSettlement = resolve; });
const safetyTermination = TwilioRealtimeConnection.prototype.terminateForLifecycleEvent.call({
  logger: () => {},
  close: () => settlementPending,
  socket: { close: () => { safetySocketClosed = true; } },
}, "bridge_inactivity");
assert.equal(safetySocketClosed, true, "provider sockets close before waiting on backend settlement");
releaseSettlement();
await safetyTermination;
console.log("Realtime media worker tests passed.");
