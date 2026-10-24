import { getPalabraLanguageCode } from "./translation-language-catalog.mjs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { BridgeIntroduction, defaultGetOrGenerateDisclosureAudio, BRIDGE_INACTIVITY_WARNING_ENGLISH_TEXT } from "./realtime-media-worker-disclosures.mjs";
import { BridgeInactivityClock, createBridgeSpeechDetector } from "./realtime-media-worker-inactivity.mjs";
import {
  signMediaStreamParams,
  verifyMediaStreamSignature,
} from "./realtime-media-worker-stream-auth.mjs";

export { signMediaStreamParams, verifyMediaStreamSignature };

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
const OPENAI_TRANSLATION_URL = "wss://api.openai.com/v1/realtime/translations";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// Source fingerprint of this worker build, verified inside the running
// container during deploys and persisted on realtime session records so a
// stale container can never masquerade as the committed worker again.
export const WORKER_BUILD = (() => {
  try {
    return createHash("sha256")
      .update(readFileSync(fileURLToPath(import.meta.url)))
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "unknown";
  }
})();

export function computeConfigFingerprint(config = {}) {
  const safe = {};
  for (const key of Object.keys(config).sort()) {
    if (
      key === "openaiApiKey" ||
      key === "workerSecret" ||
      key === "palabraApiKey" ||
      key === "streamSigningSecret"
    ) {
      continue;
    }
    safe[key] = config[key];
  }
  return createHash("sha256").update(JSON.stringify(safe)).digest("hex").slice(0, 16);
}

export function buildTranslationSessionUpdate(targetLanguage, transcriptionModel) {
  return {
    type: "session.update",
    session: {
      audio: {
        input: {
          transcription: { model: transcriptionModel },
          // Do NOT add noise_reduction here: near_field is accepted by the
          // endpoint but regressed a live call on 2026-07-10 (no model output
          // for the first 32 s of telephone audio). Do NOT add
          // transcription.language either — rejected with unknown_parameter.
        },
        output: {
          language: targetLanguage,
        },
      },
    },
  };
}

export function buildLiveGuidanceInstructions(context) {
  return [
    "# Role and objective",
    "You are a silent, private business-call copilot for the Voxandra user.",
    "Listen to both labeled speakers and help the Voxandra user complete the call objective.",
    "Never speak into the call. Every decision must call exactly one provided tool.",
    "",
    "# When to emit guidance",
    "Use emit_guidance only for a timely, material intervention: an unanswered objective, an important commitment to confirm, a name/amount/date/identifier/next step needing clarification, an unresolved contradiction, or a relevant reviewed fact the user is missing.",
    "Prefer one strong prompt over several marginal prompts.",
    "Use wait_for_guidance for routine acknowledgements, repetition, unclear audio, silence, hold music, background speech, side conversation, or when the user already handled the issue.",
    "Do not invent or infer facts. Evidence must briefly describe the heard/context trigger without quoting sensitive content unnecessarily.",
    "Keep labels under 14 words, actionable, calm, and non-alarming.",
    "Do not expose internal reasoning.",
    "",
    "# Call context",
    JSON.stringify(context).slice(0, 12000),
  ].join("\n");
}

const DEFAULT_CONFIG = {
  port: 8787,
  // Total concurrent Twilio Media Stream sockets. A bridge (Voice
  // Translation) call uses two. Was 10 through the QA phase, which capped the
  // whole platform at five translated calls; the worker's real per-stream
  // cost is a few WebSockets and some buffers, so this is a safety rail, not
  // a capacity plan — watch /healthz activeStreams and raise it deliberately.
  maxStreams: 40,
  // A socket that has connected but not yet sent a valid, signed `start` is
  // "pending". Twilio sends `start` within milliseconds of connecting, so
  // legitimate sockets are almost never pending for long — which is what lets
  // the pending phase be bounded aggressively (per client IP and by a short
  // deadline) without touching real Twilio traffic. This is the rail that
  // stops an unauthenticated flood from exhausting maxStreams above.
  maxPendingStreamsPerIp: 4,
  streamStartTimeoutMs: 5000,
  // gpt-live-transcribe replaces gpt-realtime-whisper at the identical
  // $0.017/min: 9.60% vs 11.65% error on OpenAI's nine-language real-world
  // benchmark. Same Realtime WebSocket class, so it drops into
  // audio.input.transcription.model unchanged. It also accepts prompt/keywords/
  // languages, which this worker is well placed to fill from the pre-call brief,
  // contact and company names, and the already-selected expected language.
  liveGuidanceTranscriptionModel: "gpt-live-transcribe",
  liveGuidanceTextModel: "gpt-realtime-2.1",
  liveGuidancePipeline: "audio_native",
  liveGuidanceReasoningEffort: "low",
  liveGuidanceMinIntervalMs: 1800,
  liveGuidanceSilenceMs: 500,
  liveGuidanceMaxTurnMs: 12000,
  liveTranslationModel: "gpt-realtime-translate",
  // Start with the cheapest GPT-5.6 model for cascade text translation; upgrade
  // to terra/sol if live quality review shows Luna is not enough.
  liveTranslationTextModel: "gpt-5.6-luna",
  translationPipeline: "direct",
  translationCascadeWorkspaceIds: [],
  // Spoken Translation Phase 1 (internal-only infra, see AGENTIC_FUTURE.md):
  // workspaces on this list get the direct pipeline's already-flowing
  // session.output_audio.delta relayed to any attached browser socket for
  // the call, instead of discarded. No global on-switch by design — this
  // never has a "true for everyone" mode like translationCascadeWorkspaceIds.
  translationAudioForwardWorkspaceIds: [],
  // Spoken Translation Phase 3 (internal-only, see AGENTIC_FUTURE.md):
  // workspaces on this list run Live Translation through Palabra's
  // speech-to-speech endpoint instead of the OpenAI direct/cascade
  // pipelines — captions AND translated speech audio from one vendor
  // session. Allowlist only, no global on-switch, and voice cloning is
  // hard-off in buildPalabraTask (no cloning consent surface exists).
  translationPalabraWorkspaceIds: [],
  // {random_hash} is generated per session at connect time. Legacy direct
  // endpoint — kept only for the probe's PALABRA_LEGACY_DIRECT_WS mode; the
  // worker itself connects via per-call REST sessions (see
  // buildPalabraSessionRequest for why direct connection is broken).
  palabraTranslationUrl:
    "wss://streaming.palabra.ai/streaming-api/{random_hash}/v1/speech-to-speech/stream",
  // REST endpoint that provisions one dedicated Palabra session per call
  // leg, so two bridge directions can run concurrently on one API key.
  palabraSessionApiUrl: "https://api.palabra.ai/session-storage/session",
  // ~320ms per input_audio_data chunk (Palabra's documented optimum) at
  // 20ms Twilio frames = 16 frames per chunk.
  palabraChunkFrames: 16,
  // Real two-leg translation bridge: each leg hears the other participant's
  // ORIGINAL voice continuously at reduced volume, with translated speech
  // mixed on top at full volume. Translation-only output left dead silence
  // whenever a speaker was mid-sentence and the translation had not caught
  // up, which testers reported as awkward, disconnected-sounding gaps.
  bridgePassthroughGain: 0.3,
  // Passthrough is attenuated further while translated speech is playing, so
  // the translation stays the intelligible layer (what a human interpreter on
  // a conference bridge sounds like). Lowered from 0.12 (2026-08-13): two real
  // testers heard the original voice layered under the AI voice, and while
  // the first wanted it audible at all, the second found 0.12 "disconcerting"
  // — two competing voices rather than one voice with faint texture
  // underneath. 0.06 keeps some ambient presence without competing.
  bridgePassthroughDuckedGain: 0.06,
  // Translated speech is paced out at one 20ms frame per inbound frame. If a
  // provider burst queues more than this, the oldest audio is dropped so the
  // conversation cannot drift permanently behind the live voices.
  bridgeTranslatedQueueMaxMs: 4000,
  // Bridge media-path skeleton (internal-only, see AGENTIC_FUTURE.md):
  // workspaces on this list, on a call whose Twilio leg is <Connect><Stream>
  // (bidirectional) and carries the echoTestEnabled custom parameter, get
  // their own audio echoed straight back — no model involved, just proving
  // the worker can encode/pace/send audio into a real Twilio call at all.
  echoTestWorkspaceIds: [],
  transcriptionDelay: "low",
  guidanceCommitIntervalMs: 900,
  guidanceMinIntervalMs: 7000,
  // Lower partial caption flush so captions feel live. Each partial updates the
  // same segment row in place, so the extra write rate is bounded to one row
  // per utterance rather than one row per flush.
  //
  // 200ms rather than 350: partials are what make translation read as streaming
  // instead of arriving in blocks, and finals are unaffected (they bypass this
  // throttle entirely), so phrase grouping via translationSegmentIdleMs is
  // preserved. Not lowered further because each partial patches the same Convex
  // row and the write round-trip is ~100-200ms; flushing faster than writes
  // complete only queues them and risks OCC conflicts on that row.
  translationCaptionIntervalMs: 200,
  // Wait a little longer before finalizing a direct-translation caption. This
  // groups clauses into fuller lines instead of breaking one sentence across
  // several short captions; the small latency cost is acceptable for readable
  // live translation.
  translationSegmentIdleMs: 1600,
  translationSegmentMaxMs: 15000,
  translationSegmentMaxChars: 320,
  translationDrainMs: 5000,
  // Hard ceiling for a single bridge leg's media session, independent of
  // Twilio and of Convex. Each leg is handed a `maxSessionSeconds` stream
  // parameter derived from the call's own cap; this clamps whatever it is
  // handed, so a wrong value upstream cannot extend a session. Closing the
  // Twilio socket ends a <Connect><Stream> leg (there is no further TwiML
  // verb), which makes this a kill switch that needs no Twilio credentials —
  // the last line of defence if both Twilio's timeLimit and the Convex
  // deadline job fail.
  bridgeMaxSessionSeconds: 3600,
  // The provider's source transcript runs about one second ahead of its
  // translated transcript on the audio timeline; source deltas beyond the
  // target window plus this tolerance belong to the next caption.
  translationSourceLeadToleranceMs: 1000,
  // Cascade text-translation calls must never stall a live caption pipeline.
  translationRequestTimeoutMs: 5000,
  // Minimum cascade transcription confidence (geometric-mean token
  // probability) for an authoritative caption. 0 disables the gate until the
  // threshold is calibrated to >=95% precision on the canary set.
  translationMinConfidence: 0,
  // ~3 s of 20 ms Twilio frames retained while provider sockets and Convex
  // context finish starting; audio never waits on a Convex round-trip.
  preReadyAudioMaxFrames: 150,
  // In the cascade path, phrase boundaries come from telephone audio energy.
  // A longer silence threshold keeps brief clause pauses from fragmenting one
  // long sentence into multiple caption lines.
  transcriptionSilenceMs: 900,
  transcriptionMaxUtteranceMs: 12000,
  transcriptionSpeechThreshold: 550,
};

export function buildWorkerConfig(env = process.env) {
  return {
    port: Number(env.REALTIME_WORKER_PORT || DEFAULT_CONFIG.port),
    maxStreams: Number(env.REALTIME_WORKER_MAX_STREAMS || DEFAULT_CONFIG.maxStreams),
    maxPendingStreamsPerIp: Number(
      env.REALTIME_WORKER_MAX_PENDING_STREAMS_PER_IP || DEFAULT_CONFIG.maxPendingStreamsPerIp
    ),
    streamStartTimeoutMs: Number(
      env.REALTIME_WORKER_STREAM_START_TIMEOUT_MS || DEFAULT_CONFIG.streamStartTimeoutMs
    ),
    // The worker sits behind a reverse proxy (Caddy) in production, so the
    // TCP peer is always 127.0.0.1; per-IP limits need X-Forwarded-For, which
    // must only be trusted when a proxy we control is guaranteed to set it.
    trustProxyHeaders: env.REALTIME_WORKER_TRUST_PROXY === "true",
    openaiApiKey: env.OPENAI_API_KEY,
    convexUrl: env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL,
    workerSecret: env.REALTIME_CONVEX_WORKER_SECRET,
    // Shared with the Next.js app (Vercel), NOT with Convex: the TwiML routes
    // sign every Media Stream parameter set with it and handleStart refuses
    // anything unsigned, stale, or tampered. See
    // scripts/realtime-media-worker-stream-auth.mjs.
    streamSigningSecret: env.REALTIME_STREAM_SIGNING_SECRET,
    // Escape hatch for local smoke scripts that drive the worker with a
    // synthetic Twilio client and no TwiML route in the loop. Never set in
    // production: validateWorkerConfig refuses to start without a signing
    // secret unless this is explicitly true, and the startup log shouts.
    allowUnsignedStreams: env.REALTIME_ALLOW_UNSIGNED_STREAMS === "true",
    liveGuidanceTranscriptionModel:
      env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ||
      env.OPENAI_REALTIME_MODEL ||
      DEFAULT_CONFIG.liveGuidanceTranscriptionModel,
    liveGuidanceTextModel:
      env.OPENAI_LIVE_GUIDANCE_MODEL ||
      env.OPENAI_CALL_MEMORY_ASK_MODEL ||
      DEFAULT_CONFIG.liveGuidanceTextModel,
    liveGuidancePipeline:
      env.REALTIME_LIVE_GUIDANCE_PIPELINE || DEFAULT_CONFIG.liveGuidancePipeline,
    liveGuidanceReasoningEffort:
      env.REALTIME_LIVE_GUIDANCE_REASONING_EFFORT ||
      DEFAULT_CONFIG.liveGuidanceReasoningEffort,
    liveGuidanceMinIntervalMs: Number(
      env.REALTIME_LIVE_GUIDANCE_MIN_INTERVAL_MS ||
        DEFAULT_CONFIG.liveGuidanceMinIntervalMs
    ),
    liveGuidanceSilenceMs: Number(
      env.REALTIME_LIVE_GUIDANCE_SILENCE_MS || DEFAULT_CONFIG.liveGuidanceSilenceMs
    ),
    liveGuidanceMaxTurnMs: Number(
      env.REALTIME_LIVE_GUIDANCE_MAX_TURN_MS || DEFAULT_CONFIG.liveGuidanceMaxTurnMs
    ),
    liveTranslationModel:
      env.OPENAI_REALTIME_TRANSLATION_MODEL || DEFAULT_CONFIG.liveTranslationModel,
    // No OPENAI_LIVE_GUIDANCE_MODEL fallback here on purpose. These two models
    // are different classes: guidance runs on a Realtime WebSocket model, while
    // cascade translation is a plain Responses API text call. Falling back meant
    // changing the guidance model (e.g. the mini canary) silently reassigned the
    // translation text model to a Realtime model the Responses API rejects.
    liveTranslationTextModel:
      env.OPENAI_LIVE_TRANSLATION_TEXT_MODEL ||
      DEFAULT_CONFIG.liveTranslationTextModel,
    translationPipeline:
      env.REALTIME_TRANSLATION_PIPELINE || DEFAULT_CONFIG.translationPipeline,
    translationCascadeWorkspaceIds: String(
      env.REALTIME_TRANSLATION_CASCADE_WORKSPACE_IDS || ""
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    translationAudioForwardWorkspaceIds: String(
      env.REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS || ""
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    echoTestWorkspaceIds: String(env.REALTIME_ECHO_TEST_WORKSPACE_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    translationPalabraWorkspaceIds: String(
      env.REALTIME_TRANSLATION_PALABRA_WORKSPACE_IDS || ""
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    voiceTranslationEnabled: env.REALTIME_VOICE_TRANSLATION_ENABLED === "true",
    palabraApiKey: env.PALABRA_API_KEY,
    expandedLanguages: env.PALABRA_EXPANDED_LANGUAGES_ENABLED === "true",
    // Optional: a specific voice already created via Palabra's own Clone
    // Voice API/dashboard (explicit sample upload, explicit consent), used
    // in place of the generic "male" built-in voice for the bridge's
    // browser leg only — see palabraVoiceIdForGender. Empty by default.
    palabraClonedVoiceId: env.PALABRA_CLONED_VOICE_ID,
    palabraTranslationUrl:
      env.PALABRA_TRANSLATION_URL || DEFAULT_CONFIG.palabraTranslationUrl,
    palabraSessionApiUrl:
      env.PALABRA_SESSION_API_URL || DEFAULT_CONFIG.palabraSessionApiUrl,
    bridgePassthroughGain: Number(
      env.REALTIME_BRIDGE_PASSTHROUGH_GAIN || DEFAULT_CONFIG.bridgePassthroughGain
    ),
    bridgePassthroughDuckedGain: Number(
      env.REALTIME_BRIDGE_PASSTHROUGH_DUCKED_GAIN ||
        DEFAULT_CONFIG.bridgePassthroughDuckedGain
    ),
    bridgeTranslatedQueueMaxMs: Number(
      env.REALTIME_BRIDGE_TRANSLATED_QUEUE_MAX_MS ||
        DEFAULT_CONFIG.bridgeTranslatedQueueMaxMs
    ),
    palabraChunkFrames: Number(
      env.REALTIME_PALABRA_CHUNK_FRAMES || DEFAULT_CONFIG.palabraChunkFrames
    ),
    browserAudioStreamOrigins: env.REALTIME_WORKER_BROWSER_AUDIO_STREAM_ORIGINS
      ? String(env.REALTIME_WORKER_BROWSER_AUDIO_STREAM_ORIGINS)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : DEFAULT_BROWSER_AUDIO_STREAM_ORIGINS,
    maxBrowserAudioStreams: Number(
      env.REALTIME_WORKER_MAX_BROWSER_AUDIO_STREAMS || 20
    ),
    transcriptionDelay:
      env.OPENAI_REALTIME_TRANSCRIPTION_DELAY || DEFAULT_CONFIG.transcriptionDelay,
    guidanceCommitIntervalMs: Number(
      env.REALTIME_GUIDANCE_COMMIT_INTERVAL_MS ||
        DEFAULT_CONFIG.guidanceCommitIntervalMs
    ),
    guidanceMinIntervalMs: Number(
      env.REALTIME_GUIDANCE_MIN_INTERVAL_MS || DEFAULT_CONFIG.guidanceMinIntervalMs
    ),
    translationCaptionIntervalMs: Number(
      env.REALTIME_TRANSLATION_CAPTION_INTERVAL_MS ||
        DEFAULT_CONFIG.translationCaptionIntervalMs
    ),
    translationSegmentIdleMs: Number(
      env.REALTIME_TRANSLATION_SEGMENT_IDLE_MS || DEFAULT_CONFIG.translationSegmentIdleMs
    ),
    translationSegmentMaxMs: Number(
      env.REALTIME_TRANSLATION_SEGMENT_MAX_MS || DEFAULT_CONFIG.translationSegmentMaxMs
    ),
    translationSegmentMaxChars: Number(
      env.REALTIME_TRANSLATION_SEGMENT_MAX_CHARS || DEFAULT_CONFIG.translationSegmentMaxChars
    ),
    translationDrainMs: Number(
      env.REALTIME_TRANSLATION_DRAIN_MS || DEFAULT_CONFIG.translationDrainMs
    ),
    bridgeMaxSessionSeconds: Number(
      env.REALTIME_BRIDGE_MAX_SESSION_SECONDS || DEFAULT_CONFIG.bridgeMaxSessionSeconds
    ),
    translationSourceLeadToleranceMs: Number(
      env.REALTIME_TRANSLATION_SOURCE_LEAD_TOLERANCE_MS ||
        DEFAULT_CONFIG.translationSourceLeadToleranceMs
    ),
    translationRequestTimeoutMs: Number(
      env.REALTIME_TRANSLATION_REQUEST_TIMEOUT_MS ||
        DEFAULT_CONFIG.translationRequestTimeoutMs
    ),
    translationMinConfidence: Number(
      env.REALTIME_TRANSLATION_MIN_CONFIDENCE ||
        DEFAULT_CONFIG.translationMinConfidence
    ),
    preReadyAudioMaxFrames: Number(
      env.REALTIME_PRE_READY_AUDIO_MAX_FRAMES || DEFAULT_CONFIG.preReadyAudioMaxFrames
    ),
    transcriptionSilenceMs: Number(
      env.REALTIME_TRANSCRIPTION_SILENCE_MS || DEFAULT_CONFIG.transcriptionSilenceMs
    ),
    transcriptionMaxUtteranceMs: Number(
      env.REALTIME_TRANSCRIPTION_MAX_UTTERANCE_MS ||
        DEFAULT_CONFIG.transcriptionMaxUtteranceMs
    ),
    transcriptionSpeechThreshold: Number(
      env.REALTIME_TRANSCRIPTION_SPEECH_THRESHOLD ||
        DEFAULT_CONFIG.transcriptionSpeechThreshold
    ),
  };
}

export function shouldUseCascadeTranslation(config, workspaceId) {
  if (config.translationPipeline === "cascade") return true;
  return (config.translationCascadeWorkspaceIds || []).includes(String(workspaceId || ""));
}

export function shouldForwardTranslationAudio(config, workspaceId) {
  return (config.translationAudioForwardWorkspaceIds || []).includes(
    String(workspaceId || "")
  );
}

// Bridge media-path skeleton (internal-only, see AGENTIC_FUTURE.md): proves
// the worker can send correctly-encoded audio back to Twilio at all, before
// any real bridge topology exists. Workspace allowlist only, no global
// on-switch, same shape as shouldForwardTranslationAudio.
export function shouldEchoTestAudio(config, workspaceId) {
  return (config.echoTestWorkspaceIds || []).includes(String(workspaceId || ""));
}

// Spoken Translation Phase 3 (internal-only, see AGENTIC_FUTURE.md).
// Allowlist only, no global on-switch. Takes precedence over the cascade
// allowlist in handleStart's pipeline selection.
export function shouldUsePalabraTranslation(config, workspaceId) {
  return (
    config.voiceTranslationEnabled === true ||
    (config.translationPalabraWorkspaceIds || []).includes(String(workspaceId || ""))
  );
}

// set_task payload for Palabra's speech-to-speech WebSocket transport.
// Shape verified against the real API by scripts/probe-palabra-translation.mjs
// (and mirrors build_task() in Palabra's official Python client).
//
// voice_cloning: false stays hard-off deliberately — that flag controls
// Palabra auto-cloning whoever is *live* on the call in real time, with no
// consent surface for that (AGENTIC_FUTURE.md gate). It is unrelated to
// voice_id below: referencing a specific voice already created ahead of time
// via Palabra's own Clone Voice API/dashboard (explicit sample upload,
// explicit consent, the account owner's own voice) is a separate, much
// lower-risk action — it works exactly like picking a built-in voice_id.
// palabraClonedVoiceId (env PALABRA_CLONED_VOICE_ID, worker-only, same
// pattern as PALABRA_API_KEY) optionally overrides the "male" bucket with a
// specific pre-created clone, so the existing dialer "Your translated voice:
// Male/Female" picker needs no changes to pick it up.
export function palabraVoiceIdForGender(value, config = {}) {
  if (value !== "female" && config.palabraClonedVoiceId) {
    return config.palabraClonedVoiceId;
  }
  return value === "female" ? "default_high" : "default_low";
}

export function buildPalabraTask(
  sourceLanguage,
  targetLanguage,
  sampleRate = 24000,
  translatedVoice = "male",
  config = {}
) {
  return {
    input_stream: {
      content_type: "audio",
      source: {
        type: "ws",
        format: "pcm_s16le",
        sample_rate: sampleRate,
        channels: 1,
      },
    },
    output_stream: {
      content_type: "audio",
      target: { type: "ws", format: "pcm_s16le" },
    },
    pipeline: {
      transcription: { source_language: getPalabraLanguageCode(sourceLanguage || "auto", "recognition", config.expandedLanguages) },
      translations: [
        {
          target_language: getPalabraLanguageCode(targetLanguage, "speech", config.expandedLanguages),
          speech_generation: {
            voice_cloning: false,
            voice_id: palabraVoiceIdForGender(translatedVoice, config),
          },
        },
      ],
      allowed_message_types: [
        "partial_transcription",
        "validated_transcription",
        "translated_transcription",
      ],
    },
  };
}

const DEFAULT_BROWSER_AUDIO_STREAM_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export function isAllowedBrowserAudioStreamOrigin(config, origin) {
  const allowed = config.browserAudioStreamOrigins || DEFAULT_BROWSER_AUDIO_STREAM_ORIGINS;
  return Boolean(origin) && allowed.includes(origin);
}

export function validateWorkerConfig(config) {
  const missing = [];
  if (!config.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (!config.convexUrl) missing.push("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  if (!config.workerSecret) missing.push("REALTIME_CONVEX_WORKER_SECRET");
  if (!config.streamSigningSecret && config.allowUnsignedStreams !== true) {
    missing.push("REALTIME_STREAM_SIGNING_SECRET (or REALTIME_ALLOW_UNSIGNED_STREAMS=true for local smokes only)");
  }
  if (missing.length > 0) {
    throw new Error(`Missing realtime worker env: ${missing.join(", ")}`);
  }
}

// Stream authentication is on whenever a signing secret is configured. Unit
// tests that construct TwilioRealtimeConnection directly without one keep the
// legacy behavior; the real server refuses to start in that state (see
// validateWorkerConfig) unless allowUnsignedStreams is explicitly set.
export function isStreamAuthEnabled(config) {
  return Boolean(config.streamSigningSecret);
}

// Client address for per-IP pending-stream limits. Only honors
// X-Forwarded-For when the operator has declared a trusted proxy in front;
// otherwise a client could spoof its way around the cap with a header.
export function resolveClientAddress(req, config) {
  if (config.trustProxyHeaders) {
    const forwarded = req.headers?.["x-forwarded-for"];
    const first = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || "")
      .split(",")[0]
      .trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || "unknown";
}

function safeLog(level, message, details = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    if (/text|transcript|payload|phone|number|email|name/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = value;
    }
  }
  const line = JSON.stringify({
    level,
    message,
    ...redacted,
    at: new Date().toISOString(),
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .slice(0, 600);
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireParam(params, name) {
  const value = params[name];
  if (!value || typeof value !== "string") {
    throw new Error(`Missing Twilio stream parameter: ${name}`);
  }
  return value;
}

function hashSafetyIdentifier(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeLanguage(value, fallback) {
  if (!value || value === "auto") return fallback;
  return value;
}

function hasTerminalPunctuation(value) {
  return /[.!?…]["')\]]?$/.test(String(value || "").trim());
}

export function translationSourceCutIndex(source, translatedText) {
  // The provider's source transcript runs ahead of its translated transcript
  // on the audio timeline, so when an utterance finalizes the source buffer
  // usually already holds the start of the next sentence. When the finalized
  // translation ends at a sentence boundary, cut the source after its own last
  // sentence boundary and keep the remainder buffered for the next caption;
  // otherwise pairing is unknown and the whole buffer is used.
  if (!hasTerminalPunctuation(translatedText)) return source.length;
  const boundary = /[.!?…]["')\]]?(?=\s|$)/g;
  let cut = -1;
  let match;
  while ((match = boundary.exec(source)) !== null) {
    cut = match.index + match[0].length;
  }
  return cut === -1 ? source.length : cut;
}

export function consumeSourceDeltasForWindow(deltas, windowEndMs, toleranceMs) {
  // Pair source deltas with the finalized target by provider audio timeline:
  // only deltas at or before the last target elapsed_ms plus the measured
  // source lead tolerance belong to this caption; later deltas stay buffered
  // for the next one. Deltas without elapsed_ms cannot be windowed and fall
  // back to full consumption, matching the pre-pairing behavior.
  if (!Number.isFinite(windowEndMs)) {
    return {
      text: deltas.map((delta) => delta.text).join(""),
      consumedCount: deltas.length,
    };
  }
  let consumedCount = 0;
  let text = "";
  for (const delta of deltas) {
    if (
      Number.isFinite(delta.elapsedMs) &&
      delta.elapsedMs > windowEndMs + toleranceMs
    ) {
      break;
    }
    text += delta.text;
    consumedCount += 1;
  }
  return { text, consumedCount };
}

export function transcriptionConfidenceFromLogprobs(logprobs) {
  if (!Array.isArray(logprobs) || logprobs.length === 0) return undefined;
  const values = logprobs
    .map((item) => Number(item?.logprob))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  // Geometric-mean token probability in (0, 1].
  return Math.min(1, Math.max(0, Math.exp(mean)));
}

export function buildCascadeGlossary(context) {
  // Spelling glossary only: the contact name and identifier-like key facts.
  // Summaries, reminders, and action-item facts are deliberately excluded so
  // the translator can never import call-context facts into a caption.
  const identifierTypes = ["reference", "case_number", "invoice_number", "claim_number"];
  const entries = [];
  const push = (value) => {
    const text = String(value || "").trim().slice(0, 80);
    if (text && !entries.includes(text)) entries.push(text);
  };
  push(context?.prep?.contactName);
  for (const fact of context?.prep?.keyFacts || []) {
    const type = String(fact?.type || "").toLowerCase();
    if (identifierTypes.some((candidate) => type.includes(candidate))) {
      push(fact?.value);
    }
  }
  return entries.slice(0, 12);
}

export function modelUsesMinimalReasoning(model) {
  // GPT-5.6+ Responses default to medium reasoning effort, which only adds
  // latency for literal translation; earlier models reject the parameter.
  return /^gpt-5\.[6-9]/.test(String(model || ""));
}

// One dropped provider socket must not end Live Guidance for the call; the
// budget bounds a flapping provider so reconnect loops cannot run away.
const GUIDANCE_MAX_RECONNECT_ATTEMPTS = 2;
// Bridge-leg inbound audio diagnostics cadence (see recordBridgeInboundAudio).
const BRIDGE_AUDIO_STATS_INTERVAL_MS = 5000;
// How long injected translated text stays echo-matchable, and how many phrases
// are retained. A PSTN echo returns within a second or two; the window is wide
// enough to cover a slow round trip through the callee's handset.
const BRIDGE_ECHO_TEXT_WINDOW_MS = 20_000;
const BRIDGE_ECHO_TEXT_MAX_ENTRIES = 12;
const GUIDANCE_MAX_CONSECUTIVE_PROVIDER_ERRORS = 3;

export function isTerminalGuidanceError(event) {
  // Auth and permission problems cannot be fixed by reconnecting with the
  // same key. Everything else (rate limits, transient server errors, one
  // rejected event) is survivable, or bounded by the error streak and the
  // reconnect budget.
  const type = String(event?.error?.type || "");
  const code = String(event?.error?.code || "");
  return (
    type === "authentication_error" ||
    type === "permission_error" ||
    code === "invalid_api_key" ||
    code === "insufficient_quota"
  );
}

function isTerminalTranslationError(event) {
  const type = String(event?.error?.type || "");
  const code = String(event?.error?.code || "");
  return (
    type === "invalid_request_error" ||
    type === "authentication_error" ||
    type === "permission_error" ||
    code === "invalid_event" ||
    code === "invalid_parameter"
  );
}

function decodeMulawSample(muLawByte) {
  // Canonical ITU-T G.711 μ-law expansion: the 0x84 bias sits inside the
  // shifted mantissa and is subtracted once after the exponent shift. The
  // previous variant biased before the shift cancelled out, compressing e.g.
  // the standard 8316 code point down to 512 and starving speech recognition.
  const MULAW_BIAS = 0x84;
  const byte = ~muLawByte & 0xff;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  const magnitude = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
  return sign ? -magnitude : magnitude;
}

export function decodeMuLawBase64ToPcm24Base64(payload) {
  const mulaw = Buffer.from(payload, "base64");
  const pcm = Buffer.alloc(mulaw.length * 3 * 2);
  let offset = 0;
  for (let i = 0; i < mulaw.length; i += 1) {
    const current = Math.max(-32768, Math.min(32767, decodeMulawSample(mulaw[i])));
    // Linear interpolation to 24 kHz. Repeating each 8 kHz sample three times
    // creates aliasing images above 4 kHz that degrade the provider's speech
    // recognition; interpolating keeps the waveform smooth.
    const next =
      i + 1 < mulaw.length
        ? Math.max(-32768, Math.min(32767, decodeMulawSample(mulaw[i + 1])))
        : current;
    const step = (next - current) / 3;
    pcm.writeInt16LE(current, offset);
    pcm.writeInt16LE(Math.round(current + step), offset + 2);
    pcm.writeInt16LE(Math.round(current + step * 2), offset + 4);
    offset += 6;
  }
  return pcm.toString("base64");
}

// Canonical G.711 μ-law compressor (Sun linear2ulaw), the inverse of
// decodeMulawSample above. Previously only existed as test-fixture scaffolding
// (scripts/test-realtime-media-worker.mjs); moved into production code here
// because the echo-test pipeline is the first thing that needs to send real
// audio back to Twilio.
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

// Inverse of decodeMuLawBase64ToPcm24Base64: 24kHz PCM16 -> 8kHz mu-law,
// simple 3:1 decimation (no interpolation needed on the way down the way the
// upsample above needs it on the way up). Good enough for an echo test; a
// bridge that sends model-generated speech may want the OpenAI output's
// native sample rate handled directly instead of always assuming 24kHz in.
export function encodePcm24Base64ToMuLawBase64(pcm24Base64) {
  const pcm = Buffer.from(pcm24Base64, "base64");
  const sampleCount = Math.floor(pcm.length / 2 / 3);
  const muLaw = Buffer.alloc(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    muLaw[i] = encodeMuLawSample(pcm.readInt16LE(i * 3 * 2));
  }
  return muLaw.toString("base64");
}

// --- Bridge comfort audio ---------------------------------------------------
//
// In bridge mode the browser leg has no <Dial>, so Twilio plays it no ringback:
// the caller's Device fires `accept` the instant <Connect><Stream> starts and
// then hears dead silence while the other person's phone rings, and again
// while the spoken disclosure plays to the callee. Everything below is
// synthesized in-worker (no provider call, no cached asset) and injected into
// the browser leg only. 24 kHz PCM s16le mono throughout, matching the mixer.

const BRIDGE_AUDIO_SAMPLE_RATE = 24000;
// 20 ms Twilio frame at 24 kHz.
export const BRIDGE_FRAME_SAMPLES = 480;
const silenceFrameCache = new Map();
export function silencePcm24Base64(sampleCount = BRIDGE_FRAME_SAMPLES) {
  let cached = silenceFrameCache.get(sampleCount);
  if (!cached) {
    cached = Buffer.alloc(sampleCount * 2).toString("base64");
    silenceFrameCache.set(sampleCount, cached);
  }
  return cached;
}

// North American ringback (440 Hz + 480 Hz, 2 s on / 4 s off). Chosen because
// it is the tone Twilio's own <Dial> plays on these calls today, so the caller
// hears what a non-translated Voxandra call already sounds like. Amplitude is
// deliberately modest (~ -16 dBFS) — it sits under, not over, a real ring.
const RINGBACK_ON_SAMPLES = 2 * BRIDGE_AUDIO_SAMPLE_RATE;
const RINGBACK_PERIOD_SAMPLES = 6 * BRIDGE_AUDIO_SAMPLE_RATE;
const RINGBACK_AMPLITUDE = 5000;

export function generateRingbackFrame(sampleOffset, sampleCount = BRIDGE_FRAME_SAMPLES) {
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const n = sampleOffset + i;
    const phase = n % RINGBACK_PERIOD_SAMPLES;
    if (phase >= RINGBACK_ON_SAMPLES) continue;
    const t = n / BRIDGE_AUDIO_SAMPLE_RATE;
    // Short linear fade at each burst edge so the tone does not click on/off.
    const edge = Math.min(phase, RINGBACK_ON_SAMPLES - 1 - phase);
    const envelope = Math.min(1, edge / (0.01 * BRIDGE_AUDIO_SAMPLE_RATE));
    const sample =
      (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) *
      0.5 *
      RINGBACK_AMPLITUDE *
      envelope;
    pcm.writeInt16LE(Math.round(sample), i * 2);
  }
  return pcm;
}

// Two-note "go ahead" chime played to the caller the moment the callee's
// disclosure finishes: the audible counterpart of the dialer's "you can speak
// now", since the caller may not be looking at the screen. ~0.5 s total.
export function generateGoAheadChimePcm() {
  const notes = [
    { frequency: 660, durationMs: 180 },
    { frequency: 880, durationMs: 280 },
  ];
  const totalSamples = notes.reduce(
    (sum, note) => sum + Math.round((note.durationMs / 1000) * BRIDGE_AUDIO_SAMPLE_RATE),
    0
  );
  const pcm = Buffer.alloc(totalSamples * 2);
  let offset = 0;
  for (const note of notes) {
    const samples = Math.round((note.durationMs / 1000) * BRIDGE_AUDIO_SAMPLE_RATE);
    for (let i = 0; i < samples; i += 1) {
      const t = i / BRIDGE_AUDIO_SAMPLE_RATE;
      const attack = Math.min(1, i / (0.01 * BRIDGE_AUDIO_SAMPLE_RATE));
      const release = Math.min(1, (samples - 1 - i) / (0.06 * BRIDGE_AUDIO_SAMPLE_RATE));
      const sample = Math.sin(2 * Math.PI * note.frequency * t) * 6000 * attack * release;
      pcm.writeInt16LE(Math.round(sample), (offset + i) * 2);
    }
    offset += samples;
  }
  return pcm;
}

// Sum two PCM s16le buffers sample-for-sample, attenuating the passthrough
// (original voice) leg. Exported for tests. `translatedPcm24` may be shorter
// than the passthrough frame (or absent) when the translated-speech queue runs
// dry mid-frame; the remainder is then passthrough only. Saturating clamp, so
// a loud speaker plus loud translation distorts rather than wrapping around
// into noise.
export function mixBridgeAudioFrame({ passthroughPcm24, translatedPcm24, passthroughGain }) {
  const passthrough = Buffer.isBuffer(passthroughPcm24)
    ? passthroughPcm24
    : Buffer.from(passthroughPcm24 || "", "base64");
  const translated = Buffer.isBuffer(translatedPcm24)
    ? translatedPcm24
    : Buffer.from(translatedPcm24 || "", "base64");
  const gain = Number.isFinite(passthroughGain) ? passthroughGain : 0;
  const sampleCount = Math.floor(passthrough.length / 2);
  const mixed = Buffer.alloc(sampleCount * 2);
  const translatedSamples = Math.floor(translated.length / 2);
  for (let i = 0; i < sampleCount; i += 1) {
    let value = Math.round(passthrough.readInt16LE(i * 2) * gain);
    if (i < translatedSamples) value += translated.readInt16LE(i * 2);
    mixed.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
  }
  return mixed;
}

// Whether a transcription of leg X's own microphone is really the translated
// speech Voxandra just injected INTO leg X, echoing back through the callee's
// handset or speakerphone. Confirmed from production captions on
// kd782e5te5v4gg9k4txatxs4ed8bk8sk: the user said "I want information about
// the payment" in English, Palabra spoke "Quiere obtener información sobre el
// pago" into the callee's phone, and the callee leg then transcribed that
// Spanish and translated it back as "She wants to get information about the
// payment" — attributed to the callee, in the third person.
//
// Matched on token containment rather than equality because the round trip is
// lossy. Short utterances are never suppressed (`minWords`): "sí" or "hola"
// would collide with genuine replies, and losing a real answer is worse than
// showing one echo line.
export function isLikelyInjectedEcho(
  sourceText,
  recentInjectedTexts,
  now,
  { windowMs = 20_000, minWords = 3, similarity = 0.7 } = {}
) {
  const tokens = tokenizeForEchoMatch(sourceText);
  if (tokens.length < minWords) return false;
  const candidate = new Set(tokens);
  for (const entry of recentInjectedTexts || []) {
    if (now - entry.at > windowMs) continue;
    const injected = tokenizeForEchoMatch(entry.text);
    if (injected.length === 0) continue;
    const injectedSet = new Set(injected);
    let shared = 0;
    for (const token of candidate) {
      if (injectedSet.has(token)) shared += 1;
    }
    // Containment in the smaller token set: the echo may be transcribed as a
    // fragment of a longer injected sentence, or vice versa.
    if (shared / Math.min(candidate.size, injectedSet.size) >= similarity) return true;
  }
  return false;
}

function tokenizeForEchoMatch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    // Strip combining accents so "informacion" matches "información".
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function pcm16Rms(base64Audio) {
  const pcm = Buffer.from(base64Audio, "base64");
  if (pcm.length < 2) return 0;
  let sumSquares = 0;
  const samples = Math.floor(pcm.length / 2);
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples);
}

export function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text || "")
    .join("")
    .trim();
}

function parseGuidanceJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  const label = String(parsed.label || "").trim();
  if (!label || label.toLowerCase() === "none") return null;
  return {
    label: label.slice(0, 180),
    detail: parsed.detail ? String(parsed.detail).trim().slice(0, 280) : undefined,
  };
}

async function defaultGuidanceRequester({ config, context, recentUtterances }) {
  const prompt = [
    "You generate private, concise Live Guidance for a human making a business phone call.",
    "Use only the provided call context and recent transcript. Do not invent facts.",
    "Return JSON only: {\"label\":\"...\",\"detail\":\"...\"}.",
    "If there is no useful guidance, return {\"label\":\"none\"}.",
    "Keep label under 14 words. Make it actionable and non-alarming.",
    "",
    "Call context:",
    JSON.stringify(context).slice(0, 8000),
    "",
    "Recent transcript from the other party:",
    recentUtterances.join("\n").slice(-3000),
  ].join("\n");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.liveGuidanceTextModel,
      input: prompt,
      max_output_tokens: 160,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI guidance request failed: ${response.status}`);
  }

  return parseGuidanceJson(extractResponseText(await response.json()));
}

export async function defaultTranslationRequester({
  config,
  sourceText,
  sourceLanguage,
  targetLanguage,
  recentSourceUtterances,
  context,
}) {
  const glossary = buildCascadeGlossary(context);
  // History is previous utterances only; the current utterance appears once,
  // in the translate slot, so the model can never treat it as prior context.
  const history = (recentSourceUtterances || [])
    .filter((utterance) => utterance !== sourceText)
    .slice(-3);
  const prompt = [
    "Translate one phone-call utterance faithfully.",
    `Source language: ${sourceLanguage || "unknown"}.`,
    `Target language: ${targetLanguage}.`,
    "Return only the translation, with no commentary or quotation marks.",
    "Preserve names, organizations, numbers, dates, amounts, and uncertainty exactly.",
    "Do not add, infer, complete, or explain content that is not present.",
    "Use the previous utterances only to resolve references and spelling.",
    "Use the spelling glossary only to spell names and identifiers; never add its entries to the translation.",
    "",
    "Spelling glossary:",
    glossary.length > 0 ? glossary.join("; ") : "(none)",
    "",
    "Previous utterances (context only, do not translate):",
    history.join("\n").slice(-1800) || "(none)",
    "",
    "Utterance to translate:",
    sourceText,
  ].join("\n");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.liveTranslationTextModel,
      input: prompt,
      max_output_tokens: 400,
      ...(modelUsesMinimalReasoning(config.liveTranslationTextModel)
        ? { reasoning: { effort: "none" } }
        : {}),
    }),
    signal: AbortSignal.timeout(
      config.translationRequestTimeoutMs || DEFAULT_CONFIG.translationRequestTimeoutMs
    ),
  });
  if (!response.ok) {
    throw new Error(`OpenAI translation request failed: ${response.status}`);
  }
  return extractResponseText(await response.json()).trim();
}

function createOpenAIJsonSocket({ url, config, safetyIdentifier, onEvent, onError, onClose }) {
  const socket = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
  });
  const queue = [];
  let open = false;
  let closedByUs = false;

  socket.on("open", () => {
    open = true;
    for (const item of queue.splice(0)) {
      socket.send(JSON.stringify(item));
    }
  });
  socket.on("message", (data) => {
    try {
      onEvent(JSON.parse(data.toString()));
    } catch (error) {
      onError(error);
    }
  });
  socket.on("error", onError);
  socket.on("close", () => {
    onClose?.({ closedByUs });
  });

  return {
    sendJson(event) {
      if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
        return;
      }
      if (open) {
        socket.send(JSON.stringify(event));
      } else {
        queue.push(event);
      }
    },
    close() {
      closedByUs = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}

// Palabra speech-to-speech WebSocket (Spoken Translation Phase 3). Same
// interface contract as createOpenAIJsonSocket so a fake factory slots into
// the fixture tests identically. Differences, all verified live by
// scripts/probe-palabra-translation.mjs: the API key rides as a ?token=
// query param on a per-session URL (client-generated random hash), the
// client keeps the connection alive with WS pings every 10s, and the server
// may double-encode a message's data field as a JSON string.
// The REST request that provisions one dedicated Palabra session. Exported
// for tests. Connecting to the streaming endpoint directly with the raw API
// key instead aliases every connection onto one implicit account-level
// session: verified live on 2026-07-31, the second concurrent connection
// kills the first one's task (code-1000 close). That is exactly how the
// translation bridge's browser leg went silent — it always connects first,
// and the callee leg's session displaced it seconds later. Per-call REST
// sessions run concurrently (two staggered probe sessions both completed).
export function buildPalabraSessionRequest(config) {
  return {
    url: config.palabraSessionApiUrl,
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.palabraApiKey || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { subscriber_count: 0 } }),
  };
}

function createPalabraJsonSocket({ config, onEvent, onError, onClose }) {
  const sessionHash = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 32);
  const queue = [];
  let socket;
  let open = false;
  let closedByUs = false;
  let sessionId;
  let pingTimer;

  const deleteSession = () => {
    if (!sessionId) return;
    const id = sessionId;
    sessionId = undefined;
    // Best-effort: unused sessions expire server-side, but deleting promptly
    // frees the account's simultaneously-active-session budget.
    void fetch(`${config.palabraSessionApiUrl}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.palabraApiKey || ""}` },
    }).catch(() => {});
  };

  void (async () => {
    let wsUrl;
    try {
      const request = buildPalabraSessionRequest(config);
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      const body = await response.json();
      if (!response.ok || !body?.ok || !body?.data?.ws_url || !body?.data?.publisher) {
        throw new Error(`Palabra session creation failed: HTTP ${response.status}`);
      }
      sessionId = body.data.id;
      wsUrl = `${body.data.ws_url}?token=${encodeURIComponent(body.data.publisher)}`;
    } catch (error) {
      onError(error);
      return;
    }
    if (closedByUs) {
      deleteSession();
      return;
    }

    socket = new WebSocket(wsUrl);
    pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 10_000);

    socket.on("open", () => {
      open = true;
      for (const item of queue.splice(0)) {
        socket.send(JSON.stringify(item));
      }
    });
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (typeof message.data === "string") {
          try {
            message.data = JSON.parse(message.data);
          } catch {
            // Leave as-is; the handler treats unknown shapes as ignorable.
          }
        }
        onEvent(message);
      } catch (error) {
        onError(error);
      }
    });
    socket.on("error", onError);
    socket.on("close", () => {
      clearInterval(pingTimer);
      deleteSession();
      onClose?.({ closedByUs });
    });
  })();

  return {
    sessionHash,
    sendJson(event) {
      if (
        socket &&
        (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED)
      ) {
        return;
      }
      if (open) {
        socket.send(JSON.stringify(event));
      } else {
        queue.push(event);
      }
    },
    close() {
      closedByUs = true;
      if (pingTimer) clearInterval(pingTimer);
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) {
        socket.close();
      } else {
        deleteSession();
      }
    },
  };
}

export class TwilioRealtimeConnection {
  constructor({
    socket,
    convex,
    config,
    openAiSocketFactory,
    palabraSocketFactory,
    guidanceRequester,
    translationRequester,
    disclosureAudioProvider,
    logger,
    onCallRegistered,
    onCallUnregistered,
    onStreamAuthenticated,
  }) {
    this.socket = socket;
    this.convex = convex;
    this.config = config;
    this.onStreamAuthenticated = onStreamAuthenticated;
    this.streamAuthenticated = false;
    this.openAiSocketFactory = openAiSocketFactory || createOpenAIJsonSocket;
    this.palabraSocketFactory = palabraSocketFactory || createPalabraJsonSocket;
    this.guidanceRequester = guidanceRequester || defaultGuidanceRequester;
    this.translationRequester = translationRequester || defaultTranslationRequester;
    this.disclosureAudioProvider = disclosureAudioProvider || defaultGetOrGenerateDisclosureAudio;
    this.logger = logger || safeLog;
    this.onCallRegistered = onCallRegistered;
    this.onCallUnregistered = onCallUnregistered;
    this.startedAt = Date.now();
    this.ended = false;
    this.sequence = 0;
    this.activeSessions = new Map();
    this.pendingGuidanceAudio = false;
    this.lastGuidanceCommitAt = 0;
    this.lastGuidanceAt = 0;
    this.recentUtterances = [];
    this.guidanceLabels = new Set();
    this.guidanceProviderSessionId = undefined;
    this.guidanceSessionFailed = false;
    this.guidanceLastTrack = undefined;
    this.guidanceTurnSequence = 0;
    this.guidanceTrackByItemId = new Map();
    this.guidanceResponseActive = false;
    this.guidanceResponsePending = false;
    this.guidanceSocketGeneration = 0;
    this.guidanceReconnectAttempts = 0;
    this.guidanceErrorStreak = 0;
    this.guidanceTrackState = {
      inbound: { preRoll: [], audio: [], speechStartedAt: 0, lastSpeechAt: 0 },
      outbound: { preRoll: [], audio: [], speechStartedAt: 0, lastSpeechAt: 0 },
    };
    this.guidanceStats = {
      decisions: 0,
      emitted: 0,
      noops: 0,
      deduplicated: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    };
    this.translationSourceDeltas = [];
    this.translationTargetBuffer = "";
    this.lastFlushedCaptionKey = "";
    this.lastTranslationCaptionAt = 0;
    this.translationUtteranceStartedAt = 0;
    this.currentTranslationSegmentId = undefined;
    this.translationBoundaryTimer = undefined;
    this.translationFlushInProgress = false;
    this.translationFlushRequest = undefined;
    this.translationFlushFailureCount = 0;
    this.translationHasOutput = false;
    this.translationFirstOutputLatencyMs = undefined;
    // Real two-leg translation bridge: per-utterance latency, repeated for
    // every exchange through the whole call — unlike
    // translationFirstOutputLatencyMs above, which is connection-start-
    // relative and only ever fires once (and for the browser leg, that
    // start includes ringing time before the callee even answers, so it
    // overstates true model latency badly). validated_transcription is the
    // closest available signal to "this participant just finished
    // speaking"; translated_transcription marks translation-text-complete.
    // Both are simple last-timestamp fields, not per-transcription_id state,
    // because output_audio_data carries no transcription_id to correlate
    // against — acceptable for a real conversation's natural pacing, where
    // utterances rarely overlap tightly enough to misattribute.
    this.bridgeUtteranceValidatedAt = undefined;
    this.bridgeUtteranceTranslatedTextAt = undefined;
    this.translationSessionActive = false;
    this.translationSessionFinished = false;
    this.translationSessionClosing = false;
    this.translationProviderSessionId = undefined;
    this.translationSessionClosedPromise = undefined;
    this.resolveTranslationSessionClosed = undefined;
    this.translationPipeline = "direct";
    this.transcriptionPreRoll = [];
    this.transcriptionSpeechStartedAt = 0;
    this.transcriptionLastSpeechAt = 0;
    this.transcriptionPendingAudio = false;
    // Commits get ordinals at commit time; completions can arrive out of
    // order from OpenAI and are drained strictly in commit order.
    this.transcriptionCommitSequence = 0;
    this.transcriptionNextEmitOrdinal = 1;
    this.transcriptionCommitQueue = [];
    this.transcriptionEntriesByOrdinal = new Map();
    this.transcriptionOrdinalByItemId = new Map();
    this.translationWorkPromise = Promise.resolve();
    this.cascadeRecentSourceUtterances = [];
    this.cascadeTranslateFailureCount = 0;
    // Spoken Translation Phase 1 (internal-only, see AGENTIC_FUTURE.md):
    // computed once in handleStart from the workspace allowlist, then read
    // as a plain boolean on every translation event — never re-evaluates the
    // allowlist per event, so non-allowlisted calls pay only one extra field
    // read on the hot path.
    this.forwardTranslationAudio = false;
    this.browserAudioSockets = new Set();
    this.browserAudioSocketGeneration = 0;
    this.browserAudioFrameSequence = 0;
    // Bridge media-path skeleton (internal-only, see AGENTIC_FUTURE.md).
    this.echoTestActive = false;
    // Real two-leg translation bridge (internal-only, single-workspace
    // test, sub-phases 5a/5b — see AGENTIC_FUTURE.md). legRole defaults to
    // "browser" for every non-bridge call, preserving today's single-
    // connection-per-call registry behavior unchanged. siblingLeg is set by
    // the server's call registry once both legs have registered, letting
    // one leg's connection object reach the other's sendAudioFrameToTwilio.
    this.legRole = "browser";
    this.bridgeModeActive = false;
    this.bridgeSessionDeadlineTimer = undefined;
    this.inactivityClock = new BridgeInactivityClock();
    this.inactivityTimer = undefined;
    this.inactivitySyncPending = false;
    this.inactivityNeedsSync = false;
    this.inactivityWarningFor = undefined;
    this.bridgeSpeechDetector = undefined;
    this.safetyAudio = Buffer.alloc(0);
    this.syntheticAudioUntil = 0;
    this.bridgeTranslationRequested = false;
    this.siblingLeg = undefined;
    // Palabra pipeline state (Spoken Translation Phase 3, internal-only).
    this.palabraSocket = undefined;
    this.palabraReady = false;
    this.palabraReadyPollTimer = undefined;
    this.palabraReadyDeadlineTimer = undefined;
    this.palabraChunkFrames = [];
    // Bridge-leg inbound audio diagnostics (counts and energy only, never
    // audio bytes). Exists because the 2026-07-31 acceptance test produced
    // zero en→es output with no way to tell mic silence from a Palabra
    // failure: the browser leg's Palabra events are untracked, so nothing
    // recorded whether speech ever reached the provider.
    this.bridgeAudioStats = { frames: 0, speechFrames: 0, maxRms: 0, lastLogAt: 0 };
    this.bridgeTranscriptionObserved = false;
    // Output mixer for audio this leg SENDS to its own Twilio socket. Fed
    // exclusively by the sibling leg: the sibling's microphone frames are the
    // 20ms clock, and the sibling's Palabra output queues here as translated
    // speech to mix on top.
    this.bridgeTranslatedQueue = [];
    this.bridgeTranslatedQueuedBytes = 0;
    // Real two-leg translation bridge, sub-phase 5c (internal-only, see
    // AGENTIC_FUTURE.md). Deliberately a separate, unbounded queue from
    // bridgeTranslatedQueue above: the disclosure must never be truncated by
    // that queue's drift-bounding trim logic, which exists to protect real
    // conversation audio from lagging the live call, not a one-shot,
    // known-length clip played once at the very start of a leg. Drains
    // first in mixBridgeFrameFromSibling; real translated audio keeps
    // accumulating in bridgeTranslatedQueue untouched while this plays, and
    // starts draining automatically once this empties.
    this.disclosurePrimingQueue = [];
    this.disclosurePrimingQueuedBytes = 0;
    // Real two-leg translation bridge, sub-phase 5c. Guards
    // mixBridgeFrameFromSibling: without this, a callee leg starts relaying
    // the sibling's real (ducked) mic audio the instant the two legs
    // register with each other — which happens well before disclosure
    // generation (a network round trip) has finished — so the callee could
    // already be hearing live conversation before the disclosure clip ever
    // plays. A live 2026-08-13 test call reproduced exactly this: both
    // parties exchanged a greeting before the disclosure interrupted them.
    // Defaults open (true) for every leg that never needs to gate on a
    // disclosure (the browser leg, and any non-bridge-translation callee);
    // only closed for the specific callee leg awaiting its own disclosure,
    // and only for the duration of that one request.
    this.disclosureGateOpen = true;
    // Callee-leg disclosure lifecycle, reported to Convex so the dialer can
    // tell the caller to wait / go ahead. "pending" until the clip is primed,
    // "playing" while disclosurePrimingQueue drains, then "done" (or
    // "skipped" if generation failed and the leg continued without one).
    this.disclosureState = undefined;
    this.bridgeConversationOpen = false;
    this.bridgeIntroduction = undefined;
    // Browser-leg comfort audio: ringback sample clock while the callee leg
    // has not connected yet, and whether the caller's microphone is currently
    // being withheld from Palabra (ringing / callee disclosure playing).
    this.ringbackSampleOffset = 0;
    this.bridgeMicGated = false;
    // Set on BOTH legs when either Palabra direction fails mid-call: the
    // bridge then carries each participant's real voice at full volume with
    // no translated audio, i.e. a plain phone call. Before this, a failure
    // left both people hearing each other at 30% with nothing on top and no
    // explanation — and if it was the browser leg's session that died, no
    // record anywhere even said so.
    this.bridgeDegraded = false;
    // The browser leg's own reverse-direction Palabra session has no
    // pre-created Convex realtime session (the callee leg owns the billed
    // one). It creates this observability-only row itself so a failure of
    // the user→callee direction is visible in realtimeSessions.
    this.bridgeReverseRealtimeSessionId = undefined;
    this.bridgeMixStats = {
      frames: 0,
      translatedFrames: 0,
      droppedTranslatedBytes: 0,
      lastLogAt: 0,
    };
    // Translated text recently spoken INTO this leg, for echo rejection.
    this.recentInjectedTexts = [];
    this.bridgeEchoSuppressedCaptions = 0;
    // transcription_id -> { segmentId, sourceText, translatedText,
    //   finalized, startedAt, lastPartialFlushAt }
    this.palabraEntries = new Map();
    this.palabraSequence = 0;
    // Audio that arrives before its provider socket exists is held briefly
    // in memory (never logged or persisted) and flushed once the socket is
    // created; only frame counts are recorded.
    this.preReadyFrames = { guidance: [], transcription: [], translation: [] };
    this.preReadyDroppedFrames = { guidance: 0, transcription: 0, translation: 0 };
    this.preReadyFlushedFrames = { guidance: 0, transcription: 0, translation: 0 };
    this.workerBuild = WORKER_BUILD;
    this.configFingerprint = computeConfigFingerprint(config);

    socket.on("message", (data) => {
      void this.handleTwilioMessage(data);
    });
    socket.on("close", () => {
      void this.close("completed");
    });
    socket.on("error", (error) => {
      void this.fail(error);
    });
  }

  async handleTwilioMessage(data) {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch (error) {
      await this.fail(error);
      return;
    }

    try {
      if (event.event === "start") {
        await this.handleStart(event.start || {});
      } else if (event.event === "media" && this.streamAuthenticated && !this.ended) {
        this.handleMedia(event.media || {});
      } else if (event.event === "mark" && this.streamAuthenticated && !this.ended) {
        const introduction = this.bridgeIntroduction ?? this.siblingLeg?.bridgeIntroduction;
        introduction?.acknowledge(this, event);
      } else if (event.event === "stop") {
        await this.close("completed");
      }
    } catch (error) {
      await this.fail(error);
    }
  }

  // Nothing in a Media Stream `start` event can be trusted until the
  // parameters' signature checks out: Twilio does not authenticate Media
  // Stream connections, so before this gate existed any client that reached
  // the worker's hostname could name any callId/workspaceId and have the
  // worker spend provider money or write into someone else's live call. The
  // reason is logged without any parameter content.
  rejectStream(reason, details = {}) {
    this.logger("error", "twilio_stream_rejected", { reason, ...details });
    this.ended = true;
    try {
      this.socket.close();
    } catch {
      // Already closing; nothing to do.
    }
  }

  async handleStart(start) {
    const params = start.customParameters || {};
    if (isStreamAuthEnabled(this.config)) {
      const verification = verifyMediaStreamSignature(params, this.config.streamSigningSecret);
      if (!verification.ok) {
        this.rejectStream(`signature_${verification.reason}`, { streamSid: start.streamSid });
        return;
      }
    }
    this.streamSid = start.streamSid;
    this.providerCallSid = start.callSid;
    this.callId = requireParam(params, "voxandraCallId");
    this.workspaceId = requireParam(params, "workspaceId");
    this.liveCopilot = parseBoolean(params.liveCopilot);
    this.translatedCaptions = parseBoolean(params.translatedCaptions);
    this.humanCopilotRealtimeSessionId = params.humanCopilotRealtimeSessionId;
    this.translatedCaptionsRealtimeSessionId = params.translatedCaptionsRealtimeSessionId;
    this.sourceLanguage = normalizeLanguage(params.translationSourceLanguage, undefined);
    this.targetLanguage = normalizeLanguage(params.translationTargetLanguage, "en");
    // Each bridge leg carries the voice of the participant whose speech that
    // leg translates. Missing/unknown values preserve the old default_low.
    this.translatedVoice = params.translationVoice === "female" ? "female" : "male";
    // Live Audio Translation (internal-only, single-workspace test — see
    // AGENTIC_FUTURE.md): a per-call flag, separate from the workspace
    // allowlist below. Without it, an allowlisted workspace's plain "Live
    // Translation" checkbox would silently switch to Palabra with no way to
    // pick captions-only — both must agree, same dual-gate discipline as
    // every other allowlisted feature in this file.
    this.spokenTranslationRequested = parseBoolean(params.spokenTranslationEnabled);
    // Real two-leg translation bridge (internal-only, single-workspace
    // test, sub-phases 5a/5b — see AGENTIC_FUTURE.md). bridgeLeg is only ever
    // set by the two new bridge-mode TwiML paths (voice/route.ts's bridge
    // branch, and the leg-twiml route) — its mere presence is what marks a
    // call as bridge-mode; every existing call type never sets it and keeps
    // legRole "browser" (the single-connection-per-call default).
    this.legRole = params.bridgeLeg === "callee" ? "callee" : "browser";
    this.bridgeModeActive = Boolean(params.bridgeLeg);
    this.bridgeTranslationRequested =
      this.bridgeModeActive && parseBoolean(params.bridgeTranslationEnabled);
    if (this.bridgeModeActive) this.startBridgeSessionDeadline(params.maxSessionSeconds);
    // Close the disclosure gate here, before onCallRegistered below can let
    // the sibling start calling mixBridgeFrameFromSibling on this
    // connection — otherwise there is a window where the sibling is already
    // registered but disclosure priming (a network round trip, awaited
    // further down) hasn't even started yet, and real audio would leak
    // through before the disclosure ever plays.
    if (this.bridgeTranslationRequested) {
      this.disclosureGateOpen = false;
    }

    if (this.liveCopilot && !this.humanCopilotRealtimeSessionId) {
      throw new Error("Missing Live Guidance realtime session id.");
    }
    if (this.translatedCaptions && !this.translatedCaptionsRealtimeSessionId) {
      throw new Error("Missing Live Translation realtime session id.");
    }
    if (this.bridgeTranslationRequested && (!this.sourceLanguage || !this.targetLanguage)) {
      throw new Error("Missing concrete bridge translation language direction.");
    }

    if (this.bridgeTranslationRequested) {
      // Fail closed before opening provider sockets if rollout flags disagree.
      getPalabraLanguageCode(this.sourceLanguage, "recognition", this.config.expandedLanguages);
      getPalabraLanguageCode(this.targetLanguage, "speech", this.config.expandedLanguages);
    }
    this.safetyIdentifier = hashSafetyIdentifier(`${this.workspaceId}:${this.callId}`);
    // Select the pipeline before any await so media frames that arrive while
    // sessions start are routed (or buffered) for the correct sockets.
    // Precedence: palabra (Phase 3 vendor allowlist + a per-call spoken or
    // bridge flag) >
    // cascade > direct.
    const palabraRequested =
      (this.translatedCaptions && this.spokenTranslationRequested) ||
      this.bridgeTranslationRequested;
    this.translationPipeline =
      palabraRequested &&
      shouldUsePalabraTranslation(this.config, this.workspaceId)
        ? "palabra"
        : this.translatedCaptions && shouldUseCascadeTranslation(this.config, this.workspaceId)
          ? "cascade"
          : "direct";
    if (this.bridgeTranslationRequested && this.translationPipeline !== "palabra") {
      throw new Error("Bridge translation is not enabled for this worker workspace.");
    }
    // Second authentication factor: the signature proved these parameters
    // were minted by our TwiML routes recently; this proves the socket
    // presenting them is the Twilio call they were minted for, by checking
    // the CallSid Twilio reports in `start` against the SID Convex recorded
    // when the call was placed. Closes replay of a captured parameter set.
    // The internal echo test has no Convex call row, so it rests on the
    // signature plus its own allowlist alone. Fails closed on any error:
    // nothing downstream works without Convex anyway.
    if (isStreamAuthEnabled(this.config) && !parseBoolean(params.echoTestEnabled)) {
      let binding;
      try {
        binding = await this.convex.query(api.realtimeRuntime.validateWorkerStreamStart, {
          secret: this.config.workerSecret,
          callId: this.callId,
          workspaceId: this.workspaceId,
          providerCallSid: String(this.providerCallSid || ""),
          legRole: this.legRole,
        });
      } catch (error) {
        this.rejectStream("call_binding_unavailable", {
          streamSid: this.streamSid,
          error: sanitizeError(error),
        });
        return;
      }
      if (!binding?.ok) {
        this.rejectStream(`call_binding_${binding?.reason || "rejected"}`, {
          streamSid: this.streamSid,
          legRole: this.legRole,
        });
        return;
      }
    }
    this.streamAuthenticated = true;
    this.onStreamAuthenticated?.(this);
    // Register in the call registry right after authentication so a browser
    // socket that connected before this Twilio stream's start event arrived
    // gets attached promptly instead of waiting out its idle timeout.
    this.onCallRegistered?.(this.callId, this, this.legRole);
    if (this.legRole === "callee" && this.bridgeTranslationRequested) {
      this.bridgeIntroduction = new BridgeIntroduction(this);
      void this.primeBridgeDisclosureAudio();
    }
    if (this.bridgeModeActive) {
      const detector = await createBridgeSpeechDetector();
      if (this.ended) { detector.destroy(); return; }
      this.bridgeSpeechDetector = detector;
      if (this.legRole === "browser") {
        this.inactivityTimer = setInterval(() => void this.tickBridgeInactivity(), 1000);
        this.inactivityTimer.unref?.();
      }
    }
    // Real two-leg translation bridge, sub-phase 5c (internal-only, see
    // AGENTIC_FUTURE.md): the callee should hear the spoken AI-translation
    // disclosure before anything else, primed ahead of startLiveTranslation()
    // opening the Palabra session so it's always first in the queue Palabra
    // output uses. A live 2026-08-13 test call proved the original design
    // here was wrong: letting a disclosure failure throw and abort this
    // leg's setup cascaded through sibling teardown and ended the whole
    // bridge call for both real participants — a strictly worse outcome
    // than an occasional undisclosed call while this stays internal-only.
    // Errors are logged loudly (for audit) but never rethrown.
    if (this.legRole === "callee" && this.bridgeTranslationRequested) {
        // Reopen regardless of outcome: success queues the disclosure to
        // play first as designed; failure means there's nothing left to
        // wait for, and holding the gate closed forever would silence the
        // callee for the rest of the call. Skipped when the connection
        // already ended below anyway, but harmless either way.
      // The same incident showed disclosure generation can now take several
      // seconds (translation + TTS, occasionally retried) — long enough for
      // this connection's sibling to disconnect and tear it down while the
      // await above was still in flight. Continuing past this point on an
      // already-ended connection would open a Palabra session with no live
      // socket left to serve it, wasting the session and producing a
      // confusing multi-second readiness timeout instead of stopping
      // cleanly right here.
      if (this.ended) return;
    }
    this.forwardTranslationAudio =
      this.translatedCaptions &&
      (this.translationPipeline === "direct" || this.translationPipeline === "palabra") &&
      shouldForwardTranslationAudio(this.config, this.workspaceId);
    // Bridge media-path skeleton (internal-only, see AGENTIC_FUTURE.md): both
    // the workspace allowlist AND an explicit per-call parameter must agree,
    // same dual-gate discipline as forwardTranslationAudio above. Only ever
    // true for a call whose TwiML used <Connect><Stream> (bidirectional) —
    // sending on a <Start><Stream> (receive-only) socket would just fail
    // silently or error, since Twilio never expects media from that leg.
    this.echoTestActive =
      shouldEchoTestAudio(this.config, this.workspaceId) &&
      parseBoolean(params.echoTestEnabled);
    this.logger("info", "twilio_stream_started", {
      streamSid: this.streamSid,
      liveCopilot: this.liveCopilot,
      translatedCaptions: this.translatedCaptions,
      bridgeTranslationRequested: this.bridgeTranslationRequested,
      legRole: this.legRole,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      workerBuild: this.workerBuild,
      configFingerprint: this.configFingerprint,
    });

    if (this.liveCopilot) {
      await this.startLiveGuidance();
    }
    if (this.translatedCaptions || this.bridgeTranslationRequested) {
      await this.startLiveTranslation();
    }
  }

  // Self-enforced maximum for one bridge leg's media session.
  //
  // A browser leg answered with <Connect><Stream> has no <Dial>, so Twilio has
  // no `timeLimit` for it: before this, its only bound was Twilio's four-hour
  // global ceiling, and its Palabra session billed for all of it. Closing this
  // socket ends the Twilio leg, so this works with no Twilio credentials and no
  // Convex round trip — the failure-independent backstop.
  startBridgeSessionDeadline(rawMaxSessionSeconds) {
    const configuredCeiling = Number(this.config.bridgeMaxSessionSeconds);
    const ceiling =
      Number.isFinite(configuredCeiling) && configuredCeiling > 0
        ? Math.min(Math.floor(configuredCeiling), 3600)
        : DEFAULT_CONFIG.bridgeMaxSessionSeconds;
    const requested = Number(rawMaxSessionSeconds);
    // Clamp, never extend: a bad or hostile parameter can only shorten this.
    const seconds =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), ceiling)
        : ceiling;
    this.bridgeSessionDeadlineTimer = setTimeout(() => {
      this.bridgeSessionDeadlineTimer = undefined;
      if (this.ended) return;
      this.logger("error", "bridge_session_deadline_exceeded", {
        callId: this.callId,
        legRole: this.legRole,
        maxSessionSeconds: seconds,
      });
      const browser = this.legRole === "browser" ? this : this.siblingLeg;
      if (browser) void browser.endBridgeForSafety("duration_limit");
      else void this.terminateForLifecycleEvent("bridge_session_deadline");
    }, seconds * 1000);
    this.bridgeSessionDeadlineTimer.unref?.();
  }

  noteBridgeActivity(now) {
    this.inactivityClock.activity(now);
    if (this.inactivityWarningFor !== undefined) {
      this.inactivityWarningFor = undefined;
      this.inactivityNeedsSync = true;
      this.safetyAudio = Buffer.alloc(0);
      if (this.siblingLeg) this.siblingLeg.safetyAudio = Buffer.alloc(0);
    }
  }

  async syncBridgeInactivity(endIfIdle = false, durationLimitReached = false) {
    let timer;
    try {
      const result = await Promise.race([
        this.convex.mutation(api.realtimeRuntime.syncBridgeInactivityFromWorker, {
          secret: this.config.workerSecret,
          callId: this.callId,
          providerCallSid: this.providerCallSid,
          lastActivityAt: this.inactivityClock.lastActivityAt ?? Date.now(),
          endIfIdle,
          durationLimitReached,
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Inactivity sync timed out")), 3000); }),
      ]);
      if (result?.lastActivityAt > (this.inactivityClock.lastActivityAt ?? 0)) {
        this.noteBridgeActivity(result.lastActivityAt);
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async tickBridgeInactivity(now = Date.now()) {
    if (this.ended || this.inactivitySyncPending || this.legRole !== "browser" ||
      !this.bridgeSpeechDetector || !this.siblingLeg?.bridgeSpeechDetector || this.siblingLeg.isDisclosurePlaying()) return;
    this.inactivityClock.start(now);
    const state = this.inactivityClock.state(now);
    if (state === "active" && now - this.inactivityClock.lastActivityAt >= 60_000) {
      for (const leg of [this, this.siblingLeg]) void this.loadBridgeInactivityWarningAudio(leg);
    }
    if (state === "active" && !this.inactivityNeedsSync) return;
    this.inactivitySyncPending = true;
    const sentActivityAt = this.inactivityClock.lastActivityAt;
    try {
      const result = await this.syncBridgeInactivity(state === "expired");
      if (this.ended) return;
      if (result?.ended) {
        await this.closeBridgeForSafety("bridge_inactivity");
        return;
      }
      this.inactivityNeedsSync = this.inactivityClock.lastActivityAt > sentActivityAt;
      const currentState = this.inactivityClock.state(Date.now());
      if (currentState === "warning" && this.inactivityWarningFor !== this.inactivityClock.lastActivityAt) {
        this.inactivityWarningFor = this.inactivityClock.lastActivityAt;
        void this.playBridgeInactivityWarning(this.inactivityWarningFor);
      }
    } catch (error) {
      this.logger("error", "bridge_inactivity_sync_failed", { error: sanitizeError(error) });
      if (this.inactivityClock.state(Date.now()) === "expired") await this.closeBridgeForSafety("bridge_inactivity");
    } finally {
      this.inactivitySyncPending = false;
    }
  }

  loadBridgeInactivityWarningAudio(leg) {
    leg.inactivityWarningAudioPromise ??= this.disclosureAudioProvider({
      config: this.config,
      languageCode: leg.sourceLanguage || "en",
      englishText: BRIDGE_INACTIVITY_WARNING_ENGLISH_TEXT,
      fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }),
    }).catch((error) => {
      this.logger("error", "bridge_inactivity_warning_audio_failed", { legRole: leg.legRole, error: sanitizeError(error) });
      return undefined;
    });
    return leg.inactivityWarningAudioPromise;
  }

  async playBridgeInactivityWarning(activityAt) {
    await Promise.all([this, this.siblingLeg].filter(Boolean).map(async (leg) => {
      try {
        const audio = await this.loadBridgeInactivityWarningAudio(leg);
        if (!audio) return;
        if (!this.ended && !leg.ended && this.inactivityWarningFor === activityAt &&
          this.inactivityClock.state(Date.now()) === "warning") {
          leg.safetyAudio = Buffer.from(audio, "base64");
        }
      } catch (error) {
        this.logger("error", "bridge_inactivity_warning_audio_failed", { legRole: leg.legRole, error: sanitizeError(error) });
      }
    }));
  }

  async closeBridgeForSafety(reason) {
    const sibling = this.siblingLeg;
    await Promise.all([
      this.terminateForLifecycleEvent(reason),
      sibling?.terminateForLifecycleEvent(reason),
    ]);
  }

  async endBridgeForSafety(reason) {
    if (this.ended || this.safetyEnding) return;
    this.safetyEnding = true;
    await Promise.all([
      this.syncBridgeInactivity(false, reason === "duration_limit").catch((error) => {
        this.logger("error", "bridge_safety_end_write_failed", { reason, error: sanitizeError(error) });
      }),
      this.closeBridgeForSafety(reason === "duration_limit" ? "bridge_session_deadline" : "bridge_inactivity"),
    ]);
  }

  clearBridgeSessionDeadline() {
    if (!this.bridgeSessionDeadlineTimer) return;
    clearTimeout(this.bridgeSessionDeadlineTimer);
    this.bridgeSessionDeadlineTimer = undefined;
  }

  /**
   * Ends this leg's vendor sessions AND its Twilio socket.
   *
   * `close()` alone is not enough for a leg we are tearing down proactively:
   * it settles usage and closes the vendor sockets but leaves the Twilio
   * WebSocket open, because it is normally invoked *by* that socket closing.
   * Used for the sibling-loss and deadline paths.
   */
  async terminateForLifecycleEvent(reason) {
    this.logger("info", "bridge_leg_terminating", {
      callId: this.callId,
      legRole: this.legRole,
      reason,
    });
    const closing = this.close("completed");
    try {
      this.socket.close();
    } catch {
      // Socket already gone; the Twilio leg is ending either way.
    }
    try {
      await closing;
    } catch (error) {
      this.logger("error", "bridge_leg_terminate_failed", {
        reason,
        error: sanitizeError(error),
      });
    }
  }

  async startLiveGuidance() {
    // Preserve the rollback pipeline's pre-context socket behavior so no
    // opening words are lost if Convex context assembly is slow.
    if (this.config.liveGuidancePipeline !== "audio_native") {
      this.ensureTranscriptionSocket();
    }
    this.liveGuidanceContext = await this.convex.mutation(
      api.callGuidance.getLiveGuidanceContextForWorker,
      {
        secret: this.config.workerSecret,
        realtimeSessionId: this.humanCopilotRealtimeSessionId,
      }
    );
    if (this.config.liveGuidancePipeline !== "audio_native") {
      await this.convex.mutation(api.realtimeRuntime.markRealtimeSessionActiveFromWorker, {
        secret: this.config.workerSecret,
        realtimeSessionId: this.humanCopilotRealtimeSessionId,
        providerStreamSid: this.streamSid,
        providerCallSid: this.providerCallSid,
        model: this.config.liveGuidanceTranscriptionModel,
        startedAt: this.startedAt,
        pipeline: "transcription_responses",
        workerBuild: this.workerBuild,
        configFingerprint: this.configFingerprint,
      });
      this.activeSessions.set("live_copilot", {
        realtimeSessionId: this.humanCopilotRealtimeSessionId,
        model: this.config.liveGuidanceTranscriptionModel,
      });
      return;
    }
    this.openGuidanceSocket();
    this.activeSessions.set("live_copilot", {
      realtimeSessionId: this.humanCopilotRealtimeSessionId,
      model: this.config.liveGuidanceTextModel,
    });
    this.flushPreReadyFrames("guidance");
  }

  openGuidanceSocket() {
    const url = `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(
      this.config.liveGuidanceTextModel
    )}`;
    // The generation counter fences callbacks from replaced sockets: after a
    // reconnect, a late error/close from the old socket must not trigger a
    // second recovery or feed stale events into the new session.
    const generation = ++this.guidanceSocketGeneration;
    const isCurrent = () => generation === this.guidanceSocketGeneration;
    this.guidanceSocket = this.openAiSocketFactory({
      url,
      config: this.config,
      safetyIdentifier: this.safetyIdentifier,
      onEvent: (event) => {
        if (!isCurrent()) return;
        // handleGuidanceEvent is async; an escaped rejection here would be an
        // unhandled rejection and take down the whole worker process.
        this.handleGuidanceEvent(event).catch((error) => void this.failGuidance(error));
      },
      onError: (error) => {
        if (!isCurrent()) return;
        void this.recoverGuidanceSession(error);
      },
      onClose: (info) => {
        if (!isCurrent() || info?.closedByUs) return;
        void this.recoverGuidanceSession(
          new Error("OpenAI guidance socket closed unexpectedly")
        );
      },
    });
    this.guidanceSocket.sendJson({
      type: "session.update",
      session: {
        type: "realtime",
        model: this.config.liveGuidanceTextModel,
        output_modalities: ["text"],
        max_output_tokens: 220,
        reasoning: { effort: this.config.liveGuidanceReasoningEffort },
        tool_choice: "required",
        tools: [
          {
            type: "function",
            name: "emit_guidance",
            description: "Emit one timely, high-value private prompt for the Voxandra user.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                detail: { type: "string" },
                trigger_reason: { type: "string" },
                urgency: { type: "string", enum: ["normal", "important"] },
                evidence: { type: "string" },
              },
              required: ["label", "trigger_reason", "urgency", "evidence"],
            },
          },
          {
            type: "function",
            name: "wait_for_guidance",
            description: "Use when no prompt would materially help right now.",
            parameters: { type: "object", additionalProperties: false, properties: {} },
          },
        ],
        instructions: buildLiveGuidanceInstructions(this.liveGuidanceContext),
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: this.config.liveGuidanceTranscriptionModel },
            // Speaker-separated local VAD creates explicitly labeled audio
            // turns. A single provider VAD buffer would mix Twilio's two
            // frame-interleaved tracks and lose speaker identity.
            turn_detection: null,
          },
        },
      },
    });
  }

  async recoverGuidanceSession(error) {
    if (this.ended || this.guidanceSessionFailed) return;
    this.guidanceReconnectAttempts += 1;
    if (this.guidanceReconnectAttempts > GUIDANCE_MAX_RECONNECT_ATTEMPTS) {
      await this.failGuidance(error);
      return;
    }
    this.logger("info", "live_guidance_reconnecting", {
      attempt: this.guidanceReconnectAttempts,
      error: sanitizeError(error),
    });
    const previous = this.guidanceSocket;
    this.guidanceSocket = undefined;
    previous?.close();
    // The provider conversation is lost with the socket. The fresh session
    // reuses the same instructions and context; in-progress turn buffers keep
    // accumulating and dedupe/metrics state carries across, but response
    // sequencing and item-id maps belong to the dead session.
    this.guidanceErrorStreak = 0;
    this.guidanceResponseActive = false;
    this.guidanceResponsePending = false;
    this.guidanceTrackByItemId.clear();
    this.openGuidanceSocket();
  }

  async startLiveTranslation() {
    if (this.translatedCaptionsRealtimeSessionId) {
      // A bridged call bills as translated_audio, not translated_captions: it
      // runs one Palabra session per direction, so its all-in cost is ~9c/min
      // against the 4c captions basis. Only the tracked leg reaches here, so
      // exactly ONE event is recorded per bridged call at the all-in rate —
      // which is how the previously invisible reverse-direction session is now
      // accounted for, without double-counting it as a second event.
      this.activeSessions.set(this.bridgeTranslationRequested ? "translated_audio" : "translated_captions", {
        realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
        model:
          this.translationPipeline === "palabra"
            ? "palabra-s2s"
            : this.translationPipeline === "cascade"
              ? `${this.config.liveGuidanceTranscriptionModel}+${this.config.liveTranslationTextModel}`
              : this.config.liveTranslationModel,
      });
    }
    this.logger("info", "translation_pipeline_selected", {
      pipeline: this.translationPipeline,
      tracked: Boolean(this.translatedCaptionsRealtimeSessionId),
      bridgeTranslationRequested: this.bridgeTranslationRequested,
      legRole: this.legRole,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
    });
    // The bridge's reverse direction (the untracked browser leg, translating
    // the Voxandra user for the callee) previously had no Convex record at
    // all: if its Palabra session died, the dialer kept showing the callee
    // leg's session as active while the callee heard nothing translated.
    // Create an observability-only realtimeSessions row for it. Deliberately
    // NOT added to activeSessions: the callee leg records the single billed
    // translated_audio event for the whole bridged call. Never blocks the
    // call — a failed insert just leaves this direction unrecorded as before.
    if (this.bridgeTranslationRequested && !this.translatedCaptionsRealtimeSessionId) {
      try {
        const created = await this.convex.mutation(
          api.realtimeRuntime.createRealtimeSessionFromWorker,
          {
            secret: this.config.workerSecret,
            workspaceId: this.workspaceId,
            callId: this.callId,
            mode: "translated_audio_bridge",
            provider: "palabra",
            status: "starting",
            providerStreamSid: this.streamSid,
            providerCallSid: this.providerCallSid,
            model: "palabra-s2s",
            inputLanguage: this.sourceLanguage,
            targetLanguage: this.targetLanguage,
            startedAt: this.startedAt,
          }
        );
        this.bridgeReverseRealtimeSessionId = created?.realtimeSessionId;
      } catch (error) {
        this.logger("error", "bridge_reverse_session_create_failed", {
          legRole: this.legRole,
          error: sanitizeError(error),
        });
      }
      if (this.ended) return;
    }

    if (this.translationPipeline === "palabra") {
      this.startPalabraTranslation();
      return;
    }

    if (this.translationPipeline === "cascade") {
      // The transcription socket opens before the Convex context await so
      // the first words of the call are never lost to context loading.
      this.ensureTranscriptionSocket();
      this.translationContext = await this.convex.mutation(
        api.callGuidance.getLiveGuidanceContextForWorker,
        {
          secret: this.config.workerSecret,
          realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
        }
      );
      return;
    }

    this.translationSessionClosedPromise = new Promise((resolve) => {
      this.resolveTranslationSessionClosed = resolve;
    });

    const url = `${OPENAI_TRANSLATION_URL}?model=${encodeURIComponent(
      this.config.liveTranslationModel
    )}`;
    this.translationSocket = this.openAiSocketFactory({
      url,
      config: this.config,
      safetyIdentifier: this.safetyIdentifier,
      onEvent: (event) => this.handleTranslationEvent(event),
      onError: (error) => void this.failTranslation(error),
    });
    const translationSessionUpdate = buildTranslationSessionUpdate(
      this.targetLanguage,
      this.config.liveGuidanceTranscriptionModel
    );
    this.logger("info", "translation_session_update", {
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      inputTranscriptionConfigured: Boolean(
        translationSessionUpdate.session?.audio?.input?.transcription?.model
      ),
    });
    this.translationSocket.sendJson(translationSessionUpdate);
    this.flushPreReadyFrames("translation");
  }

  // Spoken Translation Phase 3 (internal-only, see AGENTIC_FUTURE.md).
  // Protocol verified live by scripts/probe-palabra-translation.mjs:
  // set_task gets no ack — poll get_task until current_task arrives
  // (measured +249ms), then audio flows. Palabra warns and closes (code
  // 1000) after ~10s without input audio; a live call streams continuously
  // so that only matters for scripts. No reconnect by design (session is
  // tied to one connection server-side) — a mid-call drop fails only the
  // translation feature, per the standing failTranslation discipline.
  startPalabraTranslation() {
    if (!this.config.palabraApiKey) {
      void this.failTranslation(new Error("PALABRA_API_KEY is not configured on the worker."));
      return;
    }
    this.palabraSocket = this.palabraSocketFactory({
      url: this.config.palabraTranslationUrl,
      config: this.config,
      onEvent: (event) => this.handlePalabraEvent(event),
      onError: (error) => void this.failTranslation(error),
      onClose: (info) => {
        if (!info?.closedByUs && !this.ended && !this.translationSessionFinished) {
          void this.failTranslation(new Error("Palabra socket closed unexpectedly"));
        }
      },
    });
    this.translationProviderSessionId = this.palabraSocket.sessionHash
      ? `palabra-${this.palabraSocket.sessionHash}`
      : "palabra";
    this.palabraSocket.sendJson({
      message_type: "set_task",
      data: buildPalabraTask(
        this.sourceLanguage,
        this.targetLanguage,
        24000,
        this.translatedVoice,
        // The cloned-voice override only makes sense for the specific
        // session that translates the Voxandra USER's own microphone (the
        // bridge's browser leg) — that's the only direction whose synthesized
        // voice is actually supposed to represent this account's own person.
        // Every other Palabra session (the bridge's callee leg, translating
        // the OTHER participant; the plain caption+listen-along pipeline,
        // also translating the other participant) must keep using the
        // generic built-in voice regardless of this override being
        // configured, so a real caller's clone is never applied to a
        // different real person's actual speech.
        this.legRole === "browser" && this.bridgeTranslationRequested ? this.config : {}
      ),
    });
    this.palabraReadyPollTimer = setInterval(() => {
      if (this.palabraReady || this.ended || this.translationSessionFinished) {
        clearInterval(this.palabraReadyPollTimer);
        this.palabraReadyPollTimer = undefined;
        return;
      }
      this.palabraSocket?.sendJson({ message_type: "get_task", data: {} });
    }, 1000);
    this.palabraReadyPollTimer.unref?.();
    this.palabraReadyDeadlineTimer = setTimeout(() => {
      if (!this.palabraReady && !this.translationSessionFinished) {
        void this.failTranslation(new Error("Palabra pipeline did not confirm the task in time."));
      }
    }, 15_000);
    this.palabraReadyDeadlineTimer.unref?.();
  }

  handlePalabraEvent(event) {
    const type = event?.message_type;
    if (type === "current_task") {
      if (this.ended || this.translationSessionFinished || event.data?.task_status !== "running") return;
      if (!this.palabraReady) {
        this.palabraReady = true;
        if (this.palabraReadyPollTimer) clearInterval(this.palabraReadyPollTimer);
        this.palabraReadyPollTimer = undefined;
        if (this.palabraReadyDeadlineTimer) clearTimeout(this.palabraReadyDeadlineTimer);
        this.palabraReadyDeadlineTimer = undefined;
        this.logger("info", "palabra_session_ready", {
          readyMs: Date.now() - this.startedAt,
        });
        void this.activateTranslationSession();
        this.flushPreReadyFrames("translation");
      }
      return;
    }
    if (type === "error") {
      const code = event.data?.code || event.data?.error_code;
      // NOT_FOUND is the expected reply to get_task while the pipeline is
      // still spinning up — never an error condition.
      if (code === "NOT_FOUND") return;
      this.logger("error", "palabra_provider_error", { errorCode: code });
      void this.failTranslation(new Error(`Palabra error: ${code || "unknown"}`));
      return;
    }
    if (type === "warning") {
      this.logger("info", "palabra_provider_warning", {
        warningCode: event.data?.code,
      });
      return;
    }

    if (this.ended || this.translationSessionFinished || this.isDisclosurePlaying()) return;

    if (type === "output_audio_data") {
      const payload = event.data?.data;
      if (typeof payload !== "string" || payload.length === 0) return;
      if (!this.translationHasOutput) {
        this.translationHasOutput = true;
        this.translationFirstOutputLatencyMs = Math.max(0, Date.now() - this.startedAt);
        this.logger("info", "translation_first_output", {
          latencyMs: this.translationFirstOutputLatencyMs,
          pipeline: "palabra",
          legRole: this.legRole,
        });
      }
      this.browserAudioFrameSequence += 1;

      if (this.bridgeTranslationRequested) {
        // Per-utterance latency, logged for every exchange through the
        // whole call (unlike translationFirstOutputLatencyMs above, which
        // is connection-start-relative and only ever fires once). Only the
        // first audio chunk after a pending validated/translated timestamp
        // counts — later chunks of the same utterance's speech are cleared
        // out below so they don't re-trigger this.
        if (this.bridgeUtteranceValidatedAt !== undefined) {
          const now = Date.now();
          this.logger("info", "bridge_translation_utterance_latency", {
            legRole: this.legRole,
            validatedToAudioMs: now - this.bridgeUtteranceValidatedAt,
            translatedTextToAudioMs:
              this.bridgeUtteranceTranslatedTextAt !== undefined
                ? now - this.bridgeUtteranceTranslatedTextAt
                : undefined,
          });
          this.bridgeUtteranceValidatedAt = undefined;
          this.bridgeUtteranceTranslatedTextAt = undefined;
        }
        // Palabra emits PCM s16le 24 kHz mono. Queue it on the OTHER
        // independent <Connect><Stream> leg, where it is paced out at 20ms and
        // mixed over that participant's attenuated original voice (see
        // mixBridgeFrameFromSibling). Encoding to μ-law happens there, after
        // mixing, so the two sources sum in the linear domain.
        this.siblingLeg?.enqueueTranslatedAudio(payload);
        if (this.browserAudioFrameSequence % 25 === 0) {
          this.logger("info", "bridge_translation_audio_forwarded", {
            sequence: this.browserAudioFrameSequence,
            byteLength: Buffer.byteLength(payload, "base64"),
            legRole: this.legRole,
            siblingConnected: Boolean(this.siblingLeg),
            pipeline: "palabra",
          });
        }
        return;
      }

      if (!this.forwardTranslationAudio || this.browserAudioSockets.size === 0) return;
      // Same frame shape as Phase 1's OpenAI relay — the browser channel
      // and harness are shared byte-for-byte (PCM s16le 24kHz mono).
      const frame = JSON.stringify({
        type: "translation_audio_delta",
        callId: this.callId,
        sequence: this.browserAudioFrameSequence,
        payload,
      });
      for (const ws of this.browserAudioSockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
      if (this.browserAudioFrameSequence % 25 === 0) {
        this.logger("info", "translation_audio_forwarded", {
          sequence: this.browserAudioFrameSequence,
          byteLength: Buffer.byteLength(payload, "base64"),
          attachedSockets: this.browserAudioSockets.size,
          pipeline: "palabra",
        });
      }
      return;
    }

    // Diagnostic marker (counts only, never text): whether Palabra ever
    // transcribed anything on this leg. Without this, an untracked bridge
    // leg discards every transcription event below, leaving no way to tell
    // silent input from a failed synthesis when no audio comes back.
    if (
      !this.bridgeTranscriptionObserved &&
      this.bridgeTranslationRequested &&
      (type === "partial_transcription" ||
        type === "validated_transcription" ||
        type === "translated_transcription") &&
      event?.data?.transcription?.text
    ) {
      this.bridgeTranscriptionObserved = true;
      this.logger("info", "bridge_translation_transcription_observed", {
        legRole: this.legRole,
        firstType: type,
        sinceStartMs: Date.now() - this.startedAt,
      });
    }

    // Tell the sibling leg what we are about to speak into it, so when that
    // audio echoes back off the callee's handset the sibling can recognise its
    // own transcription as echo instead of publishing it as a caption. Done
    // before the caption guard below because the untracked browser leg is
    // precisely the one whose translations are injected into the tracked leg.
    if (this.bridgeTranslationRequested && type === "translated_transcription") {
      const injected = event?.data?.transcription?.text;
      if (injected) this.siblingLeg?.noteInjectedTranslationText(injected);
    }

    // Per-utterance latency capture (see bridge_translation_utterance_latency
    // above, logged when the resulting output_audio_data chunk arrives).
    // Deliberately before the caption-only guard below, so this covers the
    // untracked browser leg's own Palabra session too, not just the tracked
    // one.
    if (this.bridgeTranslationRequested && event?.data?.transcription?.text) {
      if (type === "validated_transcription") {
        this.bridgeUtteranceValidatedAt = Date.now();
      } else if (type === "translated_transcription") {
        this.bridgeUtteranceTranslatedTextAt = Date.now();
      }
    }

    const transcription = event?.data?.transcription;
    const transcriptionId = transcription?.transcription_id || event?.data?.transcription_id;
    if (type === "partial_transcription" && transcription?.text) {
      const entry = this.ensurePalabraEntry(transcriptionId);
      if (entry.finalized) return;
      entry.sourceText = transcription.text;
      if (this.suppressPalabraEntryIfEcho(entry)) return;
      const now = Date.now();
      if (now - entry.lastPartialFlushAt >= this.config.translationCaptionIntervalMs) {
        entry.lastPartialFlushAt = now;
        this.queuePalabraSegmentWrite(transcriptionId, false);
      }
      return;
    }
    if (type === "validated_transcription" && transcription?.text) {
      const entry = this.ensurePalabraEntry(transcriptionId);
      entry.sourceText = transcription.text;
      entry.sourceValidated = true;
      if (this.suppressPalabraEntryIfEcho(entry)) return;
      this.maybeFinalizePalabraEntry(transcriptionId);
      return;
    }
    if (type === "translated_transcription" && transcription?.text) {
      const entry = this.ensurePalabraEntry(transcriptionId);
      if (entry.echoSuppressed) return;
      entry.translatedText = transcription.text;
      entry.translated = true;
      if (!this.translationHasOutput) {
        this.translationHasOutput = true;
        this.translationFirstOutputLatencyMs = Math.max(0, Date.now() - this.startedAt);
        this.logger("info", "translation_first_output", {
          latencyMs: this.translationFirstOutputLatencyMs,
          pipeline: "palabra",
        });
      }
      this.maybeFinalizePalabraEntry(transcriptionId);
      return;
    }
  }

  ensurePalabraEntry(transcriptionId) {
    const key = String(transcriptionId || "unknown");
    let entry = this.palabraEntries.get(key);
    if (!entry) {
      entry = {
        segmentId: undefined,
        sourceText: "",
        translatedText: "",
        sourceValidated: false,
        translated: false,
        finalized: false,
        echoSuppressed: false,
        startedAt: Date.now(),
        lastPartialFlushAt: 0,
      };
      this.palabraEntries.set(key, entry);
    }
    return entry;
  }

  // True once this utterance is judged to be our own injected translation
  // echoing back off the far handset, in which case it is never written as a
  // caption. Sticky: a later partial or the validated text must not resurrect
  // a row we already decided to drop.
  suppressPalabraEntryIfEcho(entry) {
    if (entry.echoSuppressed) return true;
    if (!this.bridgeTranslationRequested || this.recentInjectedTexts.length === 0) return false;
    if (!isLikelyInjectedEcho(entry.sourceText, this.recentInjectedTexts, Date.now())) {
      return false;
    }
    entry.echoSuppressed = true;
    this.bridgeEchoSuppressedCaptions += 1;
    this.logger("info", "bridge_caption_echo_suppressed", {
      legRole: this.legRole,
      totalSuppressed: this.bridgeEchoSuppressedCaptions,
    });
    return true;
  }

  maybeFinalizePalabraEntry(transcriptionId) {
    const entry = this.palabraEntries.get(String(transcriptionId || "unknown"));
    if (!entry || entry.finalized || entry.echoSuppressed) return;
    if (!entry.sourceValidated || !entry.translated) return;
    entry.finalized = true;
    this.queuePalabraSegmentWrite(transcriptionId, true);
  }

  // Serialize Convex writes per call on the shared work chain (same pattern
  // as cascade) so a partial patch can never race its own final.
  queuePalabraSegmentWrite(transcriptionId, isFinal) {
    this.translationWorkPromise = this.translationWorkPromise
      .then(() => this.writePalabraSegment(transcriptionId, isFinal))
      .catch((error) => {
        this.logger("error", "palabra_caption_flush_failed", {
          isFinal,
          error: sanitizeError(error),
        });
      });
  }

  async writePalabraSegment(transcriptionId, isFinal) {
    const entry = this.palabraEntries.get(String(transcriptionId || "unknown"));
    if (!entry || this.translationSessionFinished) {
      return;
    }
    const writeStartedAt = Date.now();
    const latencyMs = Math.max(0, writeStartedAt - entry.startedAt);
    if (!entry.segmentId) {
      const result = await this.convex.mutation(
        api.realtimeRuntime.recordTranslationSegmentFromWorker,
        {
          secret: this.config.workerSecret,
          callId: this.callId,
          realtimeSessionId:
            this.translatedCaptionsRealtimeSessionId ?? this.bridgeReverseRealtimeSessionId,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          sourceText: entry.sourceText,
          translatedText: entry.translatedText,
          direction: this.legRole === "browser" ? "user_to_caller" : "caller_to_user",
          audioMode: this.bridgeTranslationRequested
            ? "bridged_audio"
            : this.forwardTranslationAudio
              ? "private_audio"
              : "caption_only",
          latencyMs,
          model: "palabra-s2s",
          pipeline: "palabra",
          isFinal,
        }
      );
      entry.segmentId = result?.segmentId;
    } else {
      await this.convex.mutation(api.realtimeRuntime.updateTranslationSegmentFromWorker, {
        secret: this.config.workerSecret,
        segmentId: entry.segmentId,
        sourceText: entry.sourceText,
        translatedText: entry.translatedText,
        latencyMs,
        isFinal,
      });
    }
    this.logger("info", "palabra_translation_flushed", {
      isFinal,
      latencyMs,
      convexWriteMs: Date.now() - writeStartedAt,
    });
    if (isFinal && entry.translatedText) {
      await this.convex.mutation(api.callGuidance.addRealtimeGuidanceItemFromWorker, {
        secret: this.config.workerSecret,
        callId: this.callId,
        realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
        type: "translation_caption",
        label: entry.translatedText.slice(0, 220),
        detail: entry.sourceText.slice(0, 220),
        source: "translated_captions",
      });
    }
  }

  ensureTranscriptionSocket() {
    if (this.transcriptionSocket) return;
    const url = `${OPENAI_REALTIME_URL}?intent=transcription`;
    this.transcriptionSocket = this.openAiSocketFactory({
      url,
      config: this.config,
      safetyIdentifier: this.safetyIdentifier,
      onEvent: (event) => this.handleTranscriptionEvent(event),
      onError: (error) => {
        if (this.translationPipeline === "cascade" && this.translatedCaptions) {
          void this.failTranslation(error);
        } else {
          void this.fail(error);
        }
      },
    });
    this.transcriptionSocket.sendJson({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: this.config.liveGuidanceTranscriptionModel,
              delay: this.config.transcriptionDelay,
              ...(this.sourceLanguage ? { language: this.sourceLanguage } : {}),
            },
            turn_detection: null,
          },
        },
        include: ["item.input_audio_transcription.logprobs"],
      },
    });
    this.flushPreReadyFrames("transcription");
  }

  bufferPreReadyFrame(target, pcm24, at) {
    const frames = this.preReadyFrames[target];
    frames.push({ pcm24, at });
    const maxFrames = this.config.preReadyAudioMaxFrames;
    if (frames.length > maxFrames) {
      frames.splice(0, frames.length - maxFrames);
      this.preReadyDroppedFrames[target] += 1;
    }
  }

  flushPreReadyFrames(target) {
    const frames = this.preReadyFrames[target].splice(0);
    if (frames.length === 0) return;
    for (const frame of frames) {
      if (target === "guidance") {
        this.sendGuidanceFrame(frame.pcm24, frame.track);
      } else if (target === "transcription") {
        this.handleTranscriptionMedia(frame.pcm24, frame.at);
      } else if (this.translationPipeline === "palabra") {
        this.sendPalabraAudioFrame(frame.pcm24);
      } else {
        this.translationSocket?.sendJson({
          type: "session.input_audio_buffer.append",
          audio: frame.pcm24,
        });
      }
    }
    this.preReadyFlushedFrames[target] += frames.length;
    this.logger("info", "pre_ready_audio_flushed", {
      target,
      flushedFrames: frames.length,
      droppedFrames: this.preReadyDroppedFrames[target],
    });
  }

  // Bridge media-path skeleton (internal-only, see AGENTIC_FUTURE.md): the
  // worker has never sent anything back to Twilio's Media Stream WebSocket
  // before this. These three methods are the entire outbound protocol
  // surface — no jitter buffer/pacer yet, since a 1:1 echo is inherently
  // already paced at 20ms (one outbound frame per inbound frame). A bridge
  // sending asynchronously-generated (translated) speech will need real
  // pacing on top of these; that's explicitly deferred, not built here.
  sendAudioFrameToTwilio(muLawBase64Chunk) {
    if (!this.streamSid) return;
    this.socket.send(
      JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: { payload: muLawBase64Chunk },
      })
    );
  }

  sendMarkToTwilio(name) {
    if (!this.streamSid) return;
    this.socket.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
  }

  sendClearToTwilio() {
    if (!this.streamSid) return;
    const introduction = this.bridgeIntroduction ?? this.siblingLeg?.bridgeIntroduction;
    if (this.isDisclosurePlaying() && introduction && introduction.phase !== "failed") {
      introduction.fail("playback_cleared");
      return;
    }
    this.socket.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
  }

  handleMedia(media) {
    // The stream rides the parent (browser caller) leg, so Twilio's "outbound"
    // track carries the audio played to the Voxandra user — the called person.
    // "inbound" on this leg is the user's own microphone and must never reach
    // transcription or translation.
    if (!media.payload || !["inbound", "outbound"].includes(media.track)) return;
    const pcm24 = decodeMuLawBase64ToPcm24Base64(media.payload);
    const now = Date.now();

    if (this.echoTestActive && media.track === "inbound") {
      // Pure passthrough, no model, entirely isolated from guidance/
      // translation below. Echoes the caller's own mic — the only audio a
      // no-<Dial> <Connect><Stream> test call ever receives — straight back
      // so it's audible on the same call. Which Twilio track carries the
      // caller's mic on a <Connect>-only leg (vs the <Start><Stream>+<Dial>
      // parent-leg semantics documented elsewhere in this file) is the one
      // assumption only a real live test call can confirm.
      this.sendAudioFrameToTwilio(encodePcm24Base64ToMuLawBase64(pcm24));
      return;
    }

    // Real two-leg translation bridge (internal-only, single-workspace
    // test, sub-phase 5b — see AGENTIC_FUTURE.md). Each independent
    // <Connect><Stream> leg contributes its own participant's microphone on
    // "inbound". Each leg owns one Palabra direction; translated output is
    // injected into siblingLeg by handlePalabraEvent above. This replaces
    // 5a's raw browser-mic echo relay completely.
    if (this.bridgeModeActive && media.track === "inbound") {
      this.lastBridgeInputAt = now;
      this.recordBridgeInboundAudio(pcm24, now);
      const browser = this.legRole === "browser" ? this : this.siblingLeg;
      const speechSuppressed = now < this.syntheticAudioUntil || now < (this.siblingLeg?.syntheticAudioUntil ?? 0) ||
        this.isDisclosurePlaying() || Boolean(this.siblingLeg?.isDisclosurePlaying());
      if (this.bridgeSpeechDetector?.detect(pcm24, speechSuppressed)) browser?.noteBridgeActivity(now);
      // The browser leg owns Guidance for a translated call. Give it the
      // operator's original microphone, before translation, as the operator
      // track. The callee leg never owns a Guidance session.
      if (this.legRole === "browser" && this.liveCopilot && !this.isDisclosurePlaying()) {
        this.routeGuidanceFrame(pcm24, "inbound", now);
      }
      // Browser leg, before the callee has connected: the caller hears
      // ringback (their own 20 ms mic clock paces it, exactly as the sibling's
      // clock paces the mixer once it exists). Nothing else the browser leg
      // sends to Twilio can collide with this, because mixBridgeFrameFromSibling
      // only runs once a sibling is registered.
      const micGated = this.isDisclosurePlaying() || Boolean(this.siblingLeg?.isDisclosurePlaying());
      // Comfort frames mirror the inbound frame's length so the outbound
      // cadence matches Twilio's exactly, whatever frame size it sends.
      const frameSamples = Math.floor(Buffer.byteLength(pcm24, "base64") / 2);
      if (this.legRole === "browser" && this.bridgeTranslationRequested && !this.siblingLeg) {
        this.sendAudioFrameToTwilio(
          encodePcm24Base64ToMuLawBase64(
            generateRingbackFrame(this.ringbackSampleOffset, frameSamples).toString("base64")
          )
        );
        this.ringbackSampleOffset += frameSamples;
      }
      if (micGated !== this.bridgeMicGated) {
        this.bridgeMicGated = micGated;
        this.logger("info", micGated ? "bridge_mic_gated" : "bridge_mic_open", {
          legRole: this.legRole,
          reason: !this.siblingLeg ? "awaiting_callee" : "callee_disclosure",
        });
      }
      if (this.bridgeTranslationRequested && this.translationPipeline === "palabra") {
        // While the mic is gated, Palabra gets silence rather than nothing:
        // it closes a session after ~10 s without input audio, and nothing
        // spoken during ringing or the callee's disclosure should ever be
        // translated — before this gate, whatever the caller said during the
        // ~18 s disclosure queued behind it, got trimmed to the last 4 s by the
        // drift bound, and then played out of context.
        const frameForPalabra = micGated ? silencePcm24Base64(frameSamples) : pcm24;
        if (this.palabraSocket && this.palabraReady) {
          this.sendPalabraAudioFrame(frameForPalabra);
        } else if (!this.ended && !this.translationSessionFinished && !micGated) {
          this.bufferPreReadyFrame("translation", pcm24, now);
        }
      }
      // This participant's real voice is also mixed into the other leg at
      // reduced volume. Twilio delivers these frames every 20ms for the whole
      // call, silence included, so this doubles as the sibling's output clock:
      // translated speech queued by our Palabra session drains one frame per
      // frame, instead of being flung at Twilio as fast as it arrives.
      if (!micGated) this.siblingLeg?.mixBridgeFrameFromSibling(pcm24);
      return;
    }

    if (this.liveCopilot && this.config.liveGuidancePipeline === "audio_native") {
      this.routeGuidanceFrame(pcm24, media.track, now);
    }

    // Translation and the legacy Guidance rollback consume only the remote
    // participant. Audio-native Guidance above observes both labeled tracks.
    if (media.track !== "outbound") return;

    const wantsTranscription =
      (this.liveCopilot && this.config.liveGuidancePipeline !== "audio_native") ||
      (this.translatedCaptions &&
        this.translationPipeline === "cascade" &&
        !this.translationSessionFinished);
    if (wantsTranscription) {
      if (this.transcriptionSocket) {
        this.handleTranscriptionMedia(pcm24, now);
      } else if (!this.ended) {
        this.bufferPreReadyFrame("transcription", pcm24, now);
      }
    }

    if (this.translatedCaptions && this.translationPipeline === "direct") {
      if (this.translationSocket) {
        this.translationSocket.sendJson({
          type: "session.input_audio_buffer.append",
          audio: pcm24,
        });
      } else if (!this.ended && !this.translationSessionFinished) {
        this.bufferPreReadyFrame("translation", pcm24, now);
      }
    }

    if (this.translatedCaptions && this.translationPipeline === "palabra") {
      if (this.palabraSocket && this.palabraReady) {
        this.sendPalabraAudioFrame(pcm24);
      } else if (!this.ended && !this.translationSessionFinished) {
        this.bufferPreReadyFrame("translation", pcm24, now);
      }
    }
  }

  routeGuidanceFrame(pcm24, track, at = Date.now()) {
    if (!this.liveCopilot || this.config.liveGuidancePipeline !== "audio_native") return;
    if (this.guidanceSocket) {
      this.sendGuidanceFrame(pcm24, track);
      return;
    }
    if (this.ended || this.guidanceSessionFailed) return;
    const frames = this.preReadyFrames.guidance;
    frames.push({ pcm24, at, track });
    if (frames.length > this.config.preReadyAudioMaxFrames) {
      frames.splice(0, frames.length - this.config.preReadyAudioMaxFrames);
      this.preReadyDroppedFrames.guidance += 1;
    }
  }

  // Real two-leg translation bridge, sub-phase 5c (internal-only, see
  // AGENTIC_FUTURE.md). Seeds disclosurePrimingQueue — its own unbounded
  // queue, never bridgeTranslatedQueue's trim-on-overflow one — because a
  // disclosure clip's length depends on the target language and must never
  // be truncated by a burst of real translated audio arriving while it is
  // still draining (measured: some languages render well past
  // bridgeTranslatedQueueMaxMs's 4s cap). Called once per callee leg from
  // handleStart, before startLiveTranslation() opens the Palabra session.
  async primeBridgeDisclosureAudio() {
    await this.bridgeIntroduction?.prepare();
  }

  sendBridgeStartupAudio(pcm) {
    this.sendAudioFrameToTwilio(encodePcm24Base64ToMuLawBase64(pcm.toString("base64")));
  }

  // Queue a one-shot clip that must play into THIS leg in full, ahead of any
  // translated speech: the callee's disclosure, or the caller's go-ahead
  // chime. Same unbounded queue either way — see disclosurePrimingQueue.
  enqueuePriorityClip(chunk) {
    if (this.ended || this.bridgeDegraded || !chunk || chunk.length === 0) return;
    this.disclosurePrimingQueue.push(chunk);
    this.disclosurePrimingQueuedBytes += chunk.length;
  }

  // Whether the caller should still be held back from speaking: this callee
  // leg's disclosure is either not yet primed (gate closed) or still draining.
  // Read by the sibling browser leg on every mic frame to gate its Palabra
  // input, so it must stay a cheap field check.
  isDisclosurePlaying() {
    return this.bridgeTranslationRequested && !this.bridgeConversationOpen;
  }

  // Persist the disclosure lifecycle for the dialer. Fire-and-forget: a lost
  // status update degrades the caller's UI copy, never the call.
  reportDisclosureState(state) {
    if (this.disclosureState === state) return;
    this.disclosureState = state;
    this.logger("info", "bridge_disclosure_state", { legRole: this.legRole, state });
    if (!this.callId) return;
    void this.convex
      .mutation(api.realtimeRuntime.updateBridgeDisclosureStateFromWorker, {
        secret: this.config.workerSecret,
        callId: this.callId,
        state,
      })
      .catch((error) => {
        this.logger("error", "bridge_disclosure_state_write_failed", {
          state,
          error: sanitizeError(error),
        });
      });
  }

  // Called by the mixer the frame the disclosure queue empties. Tells the
  // dialer the caller may speak and plays the audible counterpart into the
  // caller's ear, since they may not be looking at the screen.
  handleDisclosureFinished() {
    this.bridgeIntroduction?.advance();
  }

  // Either translation direction dying turns the whole bridge into a plain
  // phone call for BOTH participants: each leg's mixer switches to
  // full-volume passthrough, queued translated speech (now stale) is dropped,
  // and the surviving direction's Palabra session is shut down too. A
  // half-translated call — one person hearing an AI voice, the other not —
  // is more confusing than a normal call, and the dialer can explain a normal
  // call in one line. Idempotent; the first leg to degrade reports to Convex
  // and fans out to its sibling, whose own failTranslation then lands here as
  // a no-op.
  degradeBridgeToPlainCall(reason) {
    if (!this.bridgeTranslationRequested || this.bridgeDegraded) return;
    if (this.isDisclosurePlaying()) {
      const introduction = this.bridgeIntroduction ?? this.siblingLeg?.bridgeIntroduction;
      if (introduction) introduction.fail("translation_unavailable");
      else {
        this.reportDisclosureState("failed");
        void this.closeBridgeForSafety("bridge_introduction_failed");
      }
      return;
    }
    this.bridgeDegraded = true;
    this.bridgeTranslatedQueue = [];
    this.bridgeTranslatedQueuedBytes = 0;
    this.disclosurePrimingQueue = [];
    this.disclosurePrimingQueuedBytes = 0;
    this.disclosureGateOpen = true;
    this.logger("error", "bridge_degraded_to_plain_call", {
      legRole: this.legRole,
      reason,
    });
    const sibling = this.siblingLeg;
    const siblingAlreadyDegraded = Boolean(sibling?.bridgeDegraded);
    if (sibling && !siblingAlreadyDegraded) {
      // Mark the sibling first so its failTranslation → degrade re-entry is a
      // no-op, then let it tear down its own provider session and records.
      sibling.degradeBridgeToPlainCall(`sibling_${this.legRole}_${reason}`);
      if (!sibling.translationSessionFinished) {
        void sibling.failTranslation(new Error(`Sibling translation direction failed: ${reason}`));
      }
    }
    if (!siblingAlreadyDegraded && this.callId) {
      void this.convex
        .mutation(api.realtimeRuntime.markBridgeTranslationDegradedFromWorker, {
          secret: this.config.workerSecret,
          callId: this.callId,
          legRole: this.legRole,
        })
        .catch((error) => {
          this.logger("error", "bridge_degraded_write_failed", { error: sanitizeError(error) });
        });
    }
  }

  // Palabra wants ~320ms input chunks; Twilio delivers 20ms frames, so
  // accumulate palabraChunkFrames (default 16) decoded frames per
  // input_audio_data send. Twilio's own arrival rate provides the
  // real-time pacing Palabra requires.
  // Queue translated speech for playback into THIS leg. Called on the
  // destination leg by the sibling whose Palabra session produced the audio.
  // Nothing is sent here: mixBridgeFrameFromSibling drains the queue at the
  // 20ms rate the phone actually consumes, which is also the outbound pacer
  // that was deferred when raw relaying was the only mode.
  enqueueTranslatedAudio(pcm24Base64) {
    if (this.ended || this.bridgeDegraded || this.isDisclosurePlaying()) return;
    const chunk = Buffer.from(pcm24Base64, "base64");
    if (chunk.length === 0) return;
    this.bridgeTranslatedQueue.push(chunk);
    this.bridgeTranslatedQueuedBytes += chunk.length;
    // 24kHz PCM16 mono = 48 bytes per millisecond.
    const maxBytes = Math.max(0, this.config.bridgeTranslatedQueueMaxMs * 48);
    while (this.bridgeTranslatedQueuedBytes > maxBytes && this.bridgeTranslatedQueue.length > 0) {
      const oldest = this.bridgeTranslatedQueue.shift();
      this.bridgeTranslatedQueuedBytes -= oldest.length;
      this.bridgeMixStats.droppedTranslatedBytes += oldest.length;
    }
  }

  // Pull up to `byteCount` bytes of queued translated speech.
  takeQueuedTranslatedAudio(byteCount) {
    if (byteCount <= 0 || this.bridgeTranslatedQueue.length === 0) return Buffer.alloc(0);
    const parts = [];
    let remaining = byteCount;
    while (remaining > 0 && this.bridgeTranslatedQueue.length > 0) {
      const head = this.bridgeTranslatedQueue[0];
      if (head.length <= remaining) {
        parts.push(head);
        remaining -= head.length;
        this.bridgeTranslatedQueue.shift();
        this.bridgeTranslatedQueuedBytes -= head.length;
      } else {
        parts.push(head.subarray(0, remaining));
        this.bridgeTranslatedQueue[0] = head.subarray(remaining);
        this.bridgeTranslatedQueuedBytes -= remaining;
        remaining = 0;
      }
    }
    return Buffer.concat(parts);
  }

  // Pull up to `byteCount` bytes of queued disclosure audio. Unlike
  // takeQueuedTranslatedAudio's queue, nothing ever trims this one — it
  // holds exactly one clip, primed once, and must play out in full.
  takeQueuedDisclosureAudio(byteCount) {
    if (byteCount <= 0 || this.disclosurePrimingQueue.length === 0) return Buffer.alloc(0);
    const parts = [];
    let remaining = byteCount;
    while (remaining > 0 && this.disclosurePrimingQueue.length > 0) {
      const head = this.disclosurePrimingQueue[0];
      if (head.length <= remaining) {
        parts.push(head);
        remaining -= head.length;
        this.disclosurePrimingQueue.shift();
        this.disclosurePrimingQueuedBytes -= head.length;
      } else {
        parts.push(head.subarray(0, remaining));
        this.disclosurePrimingQueue[0] = head.subarray(remaining);
        this.disclosurePrimingQueuedBytes -= remaining;
        remaining = 0;
      }
    }
    return Buffer.concat(parts);
  }

  // One 20ms output frame for THIS leg, built from the sibling participant's
  // microphone frame (attenuated, so the real voice is always audible) plus any
  // translated speech due now (full volume, ducking the original further).
  // The disclosure drains first and in full from its own unbounded queue; real
  // translated audio keeps accumulating in bridgeTranslatedQueue untouched
  // while it plays and only starts draining once the disclosure empties, so
  // nothing produced during the disclosure is ever lost either.
  mixBridgeFrameFromSibling(passthroughPcm24Base64) {
    if (this.ended || !this.streamSid) return;
    // A callee leg awaiting its own disclosure sends nothing at all (silence
    // by omission) until priming settles — see disclosureGateOpen. Without
    // this, the sibling relationship (established well before disclosure
    // generation, a network round trip, has even started) already lets real
    // audio start flowing, so the callee could hear live conversation before
    // the disclosure ever plays. A live 2026-08-13 test call reproduced
    // exactly that: both parties exchanged a greeting first, and only then
    // did the disclosure interrupt them.
    if (!this.disclosureGateOpen || this.isDisclosurePlaying()) return;
    const passthrough = Buffer.from(passthroughPcm24Base64, "base64");
    if (passthrough.length === 0) return;
    if (this.safetyAudio.length > 0) {
      const warning = this.safetyAudio.subarray(0, passthrough.length);
      this.safetyAudio = this.safetyAudio.subarray(warning.length);
      this.syntheticAudioUntil = Date.now() + 500;
      const mixed = mixBridgeAudioFrame({ passthroughPcm24: passthrough, translatedPcm24: warning, passthroughGain: 0.2 });
      this.sendAudioFrameToTwilio(encodePcm24Base64ToMuLawBase64(mixed.toString("base64")));
      return;
    }
    const wasPlayingDisclosure = this.disclosureState === "playing";
    const disclosurePart = this.takeQueuedDisclosureAudio(passthrough.length);
    if (wasPlayingDisclosure && this.disclosurePrimingQueue.length === 0) {
      this.handleDisclosureFinished();
    }
    const translatedPart =
      disclosurePart.length < passthrough.length
        ? this.takeQueuedTranslatedAudio(passthrough.length - disclosurePart.length)
        : Buffer.alloc(0);
    const translated =
      disclosurePart.length > 0 ? Buffer.concat([disclosurePart, translatedPart]) : translatedPart;
    if (translated.length > 0) this.syntheticAudioUntil = Date.now() + 500;
    // Guidance hears exactly what the operator receives as translated speech,
    // labeled as the other person. Do not send disclosure audio, the faint
    // original-voice passthrough, or the final mixed frame.
    if (
      this.legRole === "browser" &&
      this.liveCopilot &&
      disclosurePart.length === 0 &&
      translatedPart.length > 0
    ) {
      this.routeGuidanceFrame(translatedPart.toString("base64"), "outbound");
    }
    // Degraded bridge: a plain call, so the other participant's real voice at
    // full volume (the queues are already empty, so `translated` is too).
    const gain = this.bridgeDegraded
      ? 1
      : translated.length > 0
        ? this.config.bridgePassthroughDuckedGain
        : this.config.bridgePassthroughGain;
    const mixed = mixBridgeAudioFrame({
      passthroughPcm24: passthrough,
      translatedPcm24: translated,
      passthroughGain: gain,
    });
    this.bridgeMixStats.frames += 1;
    if (translated.length > 0) this.bridgeMixStats.translatedFrames += 1;
    this.sendAudioFrameToTwilio(encodePcm24Base64ToMuLawBase64(mixed.toString("base64")));

    const now = Date.now();
    if (this.bridgeMixStats.lastLogAt === 0) this.bridgeMixStats.lastLogAt = now;
    if (now - this.bridgeMixStats.lastLogAt >= BRIDGE_AUDIO_STATS_INTERVAL_MS) {
      this.logger("info", "bridge_mix_stats", {
        legRole: this.legRole,
        frames: this.bridgeMixStats.frames,
        translatedFrames: this.bridgeMixStats.translatedFrames,
        queuedMs: Math.round(this.bridgeTranslatedQueuedBytes / 48),
        droppedTranslatedMs: Math.round(this.bridgeMixStats.droppedTranslatedBytes / 48),
        echoSuppressedCaptions: this.bridgeEchoSuppressedCaptions,
      });
      this.bridgeMixStats.frames = 0;
      this.bridgeMixStats.translatedFrames = 0;
      this.bridgeMixStats.droppedTranslatedBytes = 0;
      this.bridgeMixStats.lastLogAt = now;
    }
  }

  // Remember translated text spoken into this leg so its own microphone
  // transcriptions can be recognised as echo (see isLikelyInjectedEcho).
  noteInjectedTranslationText(text) {
    if (!text) return;
    const now = Date.now();
    this.recentInjectedTexts.push({ text, at: now });
    this.recentInjectedTexts = this.recentInjectedTexts
      .filter((entry) => now - entry.at <= BRIDGE_ECHO_TEXT_WINDOW_MS)
      .slice(-BRIDGE_ECHO_TEXT_MAX_ENTRIES);
  }

  // Diagnostic counters for bridge-leg inbound (microphone) audio. Logs
  // energy statistics — never audio content — every ~5s per leg so a live
  // test distinguishes "the mic audio is silence by the time it reaches the
  // worker" from "audio is live but the translation provider emits nothing".
  recordBridgeInboundAudio(pcm24, now) {
    const stats = this.bridgeAudioStats;
    if (stats.lastLogAt === 0) stats.lastLogAt = now;
    const rms = pcm16Rms(pcm24);
    stats.frames += 1;
    if (rms >= this.config.transcriptionSpeechThreshold) stats.speechFrames += 1;
    if (rms > stats.maxRms) stats.maxRms = rms;
    if (now - stats.lastLogAt >= BRIDGE_AUDIO_STATS_INTERVAL_MS) {
      this.logger("info", "bridge_leg_audio_stats", {
        legRole: this.legRole,
        frames: stats.frames,
        speechFrames: stats.speechFrames,
        maxRms: Math.round(stats.maxRms),
        speechThreshold: this.config.transcriptionSpeechThreshold,
        palabraReady: this.palabraReady,
        providerRecognizedSpeech: this.bridgeTranscriptionObserved,
      });
      stats.frames = 0;
      stats.speechFrames = 0;
      stats.maxRms = 0;
      stats.lastLogAt = now;
    }
  }

  sendPalabraAudioFrame(pcm24) {
    this.palabraChunkFrames.push(Buffer.from(pcm24, "base64"));
    if (this.palabraChunkFrames.length < this.config.palabraChunkFrames) return;
    const chunk = Buffer.concat(this.palabraChunkFrames.splice(0));
    this.palabraSocket?.sendJson({
      message_type: "input_audio_data",
      data: { data: chunk.toString("base64") },
    });
  }

  sendGuidanceFrame(pcm24, track) {
    if (!this.guidanceSocket) return;
    const state = this.guidanceTrackState[track];
    if (!state) return;
    const now = Date.now();
    const isSpeech = pcm16Rms(pcm24) >= this.config.transcriptionSpeechThreshold;
    if (!state.speechStartedAt) {
      state.preRoll.push(pcm24);
      state.preRoll = state.preRoll.slice(-10);
      if (!isSpeech) return;
      state.speechStartedAt = now;
      state.lastSpeechAt = now;
      state.audio.push(...state.preRoll);
      state.preRoll = [];
      return;
    }
    state.audio.push(pcm24);
    if (isSpeech) state.lastSpeechAt = now;
    if (
      now - state.lastSpeechAt >= this.config.liveGuidanceSilenceMs ||
      now - state.speechStartedAt >= this.config.liveGuidanceMaxTurnMs
    ) {
      this.commitGuidanceTurn(track);
    }
  }

  commitGuidanceTurn(track) {
    const state = this.guidanceTrackState[track];
    if (!this.guidanceSocket || !state?.audio.length) return;
    this.guidanceTurnSequence += 1;
    const itemId = `guidance_audio_${this.guidanceTurnSequence}`;
    const audio = Buffer.concat(state.audio.map((frame) => Buffer.from(frame, "base64")))
      .toString("base64");
    this.guidanceTrackByItemId.set(itemId, track);
    this.guidanceSocket.sendJson({
      type: "conversation.item.create",
      item: {
        id: `guidance_speaker_${this.guidanceTurnSequence}`,
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: track === "inbound"
            ? "[Speaker: Voxandra user]"
            : "[Speaker: Other person]",
        }],
      },
    });
    this.guidanceSocket.sendJson({
      type: "conversation.item.create",
      item: {
        id: itemId,
        type: "message",
        role: "user",
        content: [{ type: "input_audio", audio }],
      },
    });
    if (this.guidanceResponseActive) {
      this.guidanceResponsePending = true;
    } else {
      this.guidanceResponseActive = true;
      this.guidanceSocket.sendJson({ type: "response.create" });
    }
    state.preRoll = [];
    state.audio = [];
    state.speechStartedAt = 0;
    state.lastSpeechAt = 0;
  }

  async handleGuidanceEvent(event) {
    if (event.type === "error") {
      const providerError = new Error(event.error?.message || "OpenAI guidance error");
      const terminal = isTerminalGuidanceError(event);
      this.guidanceErrorStreak += 1;
      this.logger(terminal ? "error" : "info", "guidance_provider_error", {
        error: sanitizeError(providerError),
        errorType: event.error?.type,
        errorCode: event.error?.code,
        terminal,
        consecutiveErrors: this.guidanceErrorStreak,
      });
      if (terminal) {
        await this.failGuidance(providerError);
      } else if (this.guidanceErrorStreak >= GUIDANCE_MAX_CONSECUTIVE_PROVIDER_ERRORS) {
        // A live socket that keeps erroring is treated like a dropped one:
        // recover through the bounded reconnect budget instead of failing.
        await this.recoverGuidanceSession(providerError);
      }
      return;
    }
    if (event.type === "session.created" || event.type === "session.updated") {
      this.guidanceProviderSessionId = event.session?.id || this.guidanceProviderSessionId;
      if (event.type === "session.updated") {
        try {
          await this.convex.mutation(api.realtimeRuntime.markRealtimeSessionActiveFromWorker, {
            secret: this.config.workerSecret,
            realtimeSessionId: this.humanCopilotRealtimeSessionId,
            providerSessionId: this.guidanceProviderSessionId,
            providerStreamSid: this.streamSid,
            providerCallSid: this.providerCallSid,
            model: this.config.liveGuidanceTextModel,
            startedAt: this.startedAt,
            pipeline: "audio_native",
            workerBuild: this.workerBuild,
            configFingerprint: this.configFingerprint,
          });
        } catch (activateError) {
          // The session row keeps its prior status; Guidance itself keeps
          // running and emitted items still reach the UI.
          this.logger("error", "realtime_session_activate_failed", {
            feature: "live_copilot",
            error: sanitizeError(activateError),
          });
        }
      }
      return;
    }
    if (event.type === "response.created") {
      this.guidanceResponseActive = true;
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(event.transcript || "").trim();
      if (transcript) {
        this.sequence += 1;
        const track = this.guidanceTrackByItemId.get(event.item_id) || "unknown";
        this.guidanceTrackByItemId.delete(event.item_id);
        const remote = track === "outbound";
        void this.convex
          .mutation(api.realtimeRuntime.recordCallUtteranceFromWorker, {
            secret: this.config.workerSecret,
            callId: this.callId,
            realtimeSessionId: this.humanCopilotRealtimeSessionId,
            speakerLabel: remote ? "Other person" : "Voxandra user",
            speakerRole: remote ? "caller" : "voxandra_user",
            track: track === "unknown" ? "unknown" : track,
            text: transcript,
            source: "realtime_transcription",
            sequence: this.sequence,
            isFinal: true,
          })
          .catch((utteranceError) => {
            // Losing one stored utterance is acceptable; an unhandled
            // rejection from a fire-and-forget write is not.
            this.logger("error", "call_utterance_record_failed", {
              error: sanitizeError(utteranceError),
            });
          });
      }
      return;
    }
    if (event.type === "response.done") {
      this.guidanceResponseActive = false;
      this.guidanceErrorStreak = 0;
      const usage = event.response?.usage || {};
      this.guidanceStats.decisions += 1;
      this.guidanceStats.inputTokens += Number(usage.input_tokens || 0);
      this.guidanceStats.outputTokens += Number(usage.output_tokens || 0);
      this.guidanceStats.cachedTokens += Number(
        usage.input_token_details?.cached_tokens || 0
      );
      const outputs = Array.isArray(event.response?.output) ? event.response.output : [];
      const calls = outputs.filter((item) => item.type === "function_call");
      if (calls.length === 0) this.guidanceStats.noops += 1;
      for (const call of calls) await this.handleGuidanceToolCall(call, event.response);
      if (this.guidanceResponsePending && this.guidanceSocket) {
        this.guidanceResponsePending = false;
        this.guidanceResponseActive = true;
        this.guidanceSocket.sendJson({ type: "response.create" });
      }
    }
  }

  async handleGuidanceToolCall(call, response) {
    if (call.name === "wait_for_guidance") {
      this.guidanceStats.noops += 1;
      return;
    }
    if (call.name !== "emit_guidance") return;
    let args;
    try { args = JSON.parse(call.arguments || "{}"); } catch { return; }
    const label = String(args.label || "").trim().slice(0, 180);
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const now = Date.now();
    if (
      this.guidanceLabels.has(key) ||
      now - this.lastGuidanceAt < this.config.liveGuidanceMinIntervalMs
    ) {
      this.guidanceStats.deduplicated += 1;
      return;
    }
    this.guidanceLabels.add(key);
    this.lastGuidanceAt = now;
    const writeStartedAt = Date.now();
    try {
      await this.convex.mutation(api.callGuidance.addRealtimeGuidanceItemFromWorker, {
        secret: this.config.workerSecret,
        callId: this.callId,
        realtimeSessionId: this.humanCopilotRealtimeSessionId,
        type: "copilot",
        label,
        detail: args.detail ? String(args.detail).trim().slice(0, 280) : undefined,
        source: "live_copilot",
        evidence: args.evidence ? String(args.evidence).trim().slice(0, 220) : undefined,
      });
    } catch (writeError) {
      // One transient Convex failure drops only this prompt, not the whole
      // Guidance session. Un-dedupe the label so the model can emit it again.
      this.guidanceLabels.delete(key);
      this.logger("error", "live_guidance_write_failed", {
        error: sanitizeError(writeError),
      });
      return;
    }
    this.guidanceStats.emitted += 1;
    this.logger("info", "live_guidance_emitted", {
      urgency: args.urgency === "important" ? "important" : "normal",
      providerResponseMs: response?.created_at
        ? Math.max(0, now - Number(response.created_at) * 1000)
        : undefined,
      convexWriteMs: Date.now() - writeStartedAt,
    });
  }

  async failGuidance(error) {
    if (this.guidanceSessionFailed) return;
    this.guidanceSessionFailed = true;
    this.guidanceSocket?.close();
    this.guidanceSocket = undefined;
    const endedAt = Date.now();
    this.logger("error", "live_guidance_session_failed", { error: sanitizeError(error) });
    try {
      await this.convex.mutation(api.realtimeRuntime.finishRealtimeSessionFromWorker, {
        secret: this.config.workerSecret,
        realtimeSessionId: this.humanCopilotRealtimeSessionId,
        status: "failed",
        durationSeconds: Math.max(0, Math.ceil((endedAt - this.startedAt) / 1000)),
        endedAt,
        errorCode: "guidance_provider_error",
        errorMessage: sanitizeError(error),
        guidanceMetrics: this.guidanceStats,
      });
    } catch (finishError) {
      this.logger("error", "realtime_session_finish_failed", {
        feature: "live_copilot",
        error: sanitizeError(finishError),
      });
    }
  }

  handleTranscriptionMedia(pcm24, now) {
    const rms = pcm16Rms(pcm24);
    const isSpeech = rms >= this.config.transcriptionSpeechThreshold;

    if (!this.transcriptionSpeechStartedAt) {
      this.transcriptionPreRoll.push(pcm24);
      this.transcriptionPreRoll = this.transcriptionPreRoll.slice(-10);
      if (!isSpeech) return;
      this.transcriptionSpeechStartedAt = now;
      this.transcriptionLastSpeechAt = now;
      for (const frame of this.transcriptionPreRoll) {
        this.transcriptionSocket.sendJson({
          type: "input_audio_buffer.append",
          audio: frame,
        });
      }
      this.transcriptionPreRoll = [];
      this.transcriptionPendingAudio = true;
      return;
    }

    this.transcriptionSocket.sendJson({ type: "input_audio_buffer.append", audio: pcm24 });
    this.transcriptionPendingAudio = true;
    if (isSpeech) this.transcriptionLastSpeechAt = now;

    const silenceMs = now - this.transcriptionLastSpeechAt;
    const utteranceMs = now - this.transcriptionSpeechStartedAt;
    if (
      silenceMs >= this.config.transcriptionSilenceMs ||
      utteranceMs >= this.config.transcriptionMaxUtteranceMs
    ) {
      this.commitTranscriptionAudio(silenceMs >= this.config.transcriptionSilenceMs ? "silence" : "max");
    }
  }

  commitTranscriptionAudio(reason = "close") {
    if (!this.transcriptionSocket || !this.transcriptionPendingAudio) return;
    const committedAt = Date.now();
    this.transcriptionSocket.sendJson({ type: "input_audio_buffer.commit" });
    this.transcriptionCommitSequence += 1;
    const entry = {
      ordinal: this.transcriptionCommitSequence,
      speechStartedAt: this.transcriptionSpeechStartedAt || committedAt,
      committedAt,
      reason,
      completed: false,
      transcript: "",
    };
    this.transcriptionCommitQueue.push(entry);
    this.transcriptionEntriesByOrdinal.set(entry.ordinal, entry);
    this.transcriptionPendingAudio = false;
    this.transcriptionSpeechStartedAt = 0;
    this.transcriptionLastSpeechAt = 0;
    this.transcriptionPreRoll = [];
  }

  lookupTranscriptionEntry(itemId) {
    if (itemId && this.transcriptionOrdinalByItemId.has(itemId)) {
      return this.transcriptionEntriesByOrdinal.get(
        this.transcriptionOrdinalByItemId.get(itemId)
      );
    }
    // Map insertion order is commit order; attribute unmapped provider events
    // to the oldest commit that has not completed yet.
    for (const entry of this.transcriptionEntriesByOrdinal.values()) {
      if (!entry.completed) {
        if (itemId) this.transcriptionOrdinalByItemId.set(itemId, entry.ordinal);
        return entry;
      }
    }
    return undefined;
  }

  drainCompletedTranscriptions() {
    // OpenAI does not guarantee completion ordering across commits; emit
    // strictly by commit ordinal so captions never swap places.
    while (true) {
      const entry = this.transcriptionEntriesByOrdinal.get(this.transcriptionNextEmitOrdinal);
      if (!entry || !entry.completed) return;
      this.transcriptionEntriesByOrdinal.delete(entry.ordinal);
      this.transcriptionNextEmitOrdinal += 1;
      if (entry.transcript) this.emitCompletedTranscription(entry);
    }
  }

  emitCompletedTranscription(entry) {
    const transcript = entry.transcript;
    this.sequence += 1;
    this.recentUtterances.push(transcript);
    this.recentUtterances = this.recentUtterances.slice(-6);
    if (this.liveCopilot) {
      void this.convex
        .mutation(api.realtimeRuntime.recordCallUtteranceFromWorker, {
          secret: this.config.workerSecret,
          callId: this.callId,
          realtimeSessionId: this.humanCopilotRealtimeSessionId,
          speakerLabel: "Other person",
          speakerRole: "caller",
          track: "outbound",
          language: this.sourceLanguage,
          text: transcript,
          confidence: entry.confidence,
          source: "realtime_transcription",
          sequence: this.sequence,
          isFinal: true,
        })
        .catch((utteranceError) => {
          this.logger("error", "call_utterance_record_failed", {
            error: sanitizeError(utteranceError),
          });
        });
      void this.maybeCreateGuidance();
    }
    if (
      this.translationPipeline === "cascade" &&
      this.translatedCaptions &&
      !this.translationSessionFinished
    ) {
      this.translationWorkPromise = this.translationWorkPromise
        .then(() => this.translateCascadeUtterance(entry))
        .catch((error) => this.failTranslation(error));
    }
  }

  handleTranscriptionEvent(event) {
    if (event.type === "error") {
      const error = new Error(event.error?.message || "OpenAI transcription error");
      if (this.translationPipeline === "cascade" && this.translatedCaptions) {
        void this.failTranslation(error);
      } else {
        void this.fail(error);
      }
      return;
    }
    if (event.type === "session.updated") {
      this.transcriptionProviderSessionId =
        event.session?.id || this.transcriptionProviderSessionId;
      if (this.translationPipeline === "cascade" && this.translatedCaptions) {
        void this.activateTranslationSession();
      }
      return;
    }
    if (event.type === "input_audio_buffer.committed") {
      const entry = this.transcriptionCommitQueue.shift();
      if (event.item_id && entry) {
        this.transcriptionOrdinalByItemId.set(event.item_id, entry.ordinal);
      }
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const entry = this.lookupTranscriptionEntry(event.item_id);
      if (entry && !entry.firstDeltaLogged) {
        entry.firstDeltaLogged = true;
        entry.firstDeltaAt = Date.now();
        this.logger("info", "translation_source_first_delta", {
          pipeline: this.translationPipeline,
          speechToFirstDeltaMs: entry.firstDeltaAt - entry.speechStartedAt,
          commitToFirstDeltaMs: entry.firstDeltaAt - entry.committedAt,
        });
      }
      return;
    }
    if (
      event.type !== "conversation.item.input_audio_transcription.completed" &&
      event.type !== "conversation.item.input_audio_transcription.failed"
    ) {
      return;
    }
    const entry = this.lookupTranscriptionEntry(event.item_id);
    if (event.item_id) this.transcriptionOrdinalByItemId.delete(event.item_id);
    if (!entry) {
      // A completion with no tracked commit cannot be ordered; emitting it
      // immediately beats dropping recognized words.
      const transcript =
        event.type === "conversation.item.input_audio_transcription.completed"
          ? String(event.transcript || "").trim()
          : "";
      if (transcript) {
        this.emitCompletedTranscription({
          transcript,
          confidence: transcriptionConfidenceFromLogprobs(event.logprobs),
          speechStartedAt: 0,
          committedAt: 0,
        });
      }
      return;
    }
    entry.completed = true;
    entry.completedAt = Date.now();
    entry.transcript =
      event.type === "conversation.item.input_audio_transcription.completed"
        ? String(event.transcript || "").trim()
        : "";
    entry.confidence = transcriptionConfidenceFromLogprobs(event.logprobs);
    this.drainCompletedTranscriptions();
  }

  async maybeCreateGuidance() {
    const now = Date.now();
    if (now - this.lastGuidanceAt < this.config.guidanceMinIntervalMs) return;
    if (this.recentUtterances.join(" ").length < 24) return;
    this.lastGuidanceAt = now;

    try {
      const item = await this.guidanceRequester({
        config: this.config,
        context: this.liveGuidanceContext,
        recentUtterances: this.recentUtterances,
      });
      if (!item || this.guidanceLabels.has(item.label.toLowerCase())) return;
      this.guidanceLabels.add(item.label.toLowerCase());
      await this.convex.mutation(api.callGuidance.addRealtimeGuidanceItemFromWorker, {
        secret: this.config.workerSecret,
        callId: this.callId,
        realtimeSessionId: this.humanCopilotRealtimeSessionId,
        type: "copilot",
        label: item.label,
        detail: item.detail,
        source: "live_copilot",
        evidence: "Recent live transcript",
      });
    } catch (error) {
      this.logger("error", "live_guidance_generation_failed", {
        error: sanitizeError(error),
      });
    }
  }

  async translateCascadeUtterance(entry) {
    const sourceText = entry.transcript;
    const translationStartedAt = Date.now();
    // History for the requester is previous utterances only; the current
    // utterance goes exclusively into the translate slot of the prompt.
    const previousUtterances = this.cascadeRecentSourceUtterances.slice(-3);
    this.cascadeRecentSourceUtterances.push(sourceText);
    this.cascadeRecentSourceUtterances = this.cascadeRecentSourceUtterances.slice(-6);

    let translatedText;
    try {
      translatedText = await this.translationRequester({
        config: this.config,
        sourceText,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
        recentSourceUtterances: previousUtterances,
        context: this.translationContext,
      });
      if (!translatedText) throw new Error("Translation model returned empty text.");
      this.cascadeTranslateFailureCount = 0;
    } catch (error) {
      this.cascadeTranslateFailureCount += 1;
      this.logger("error", "cascade_translation_request_failed", {
        consecutiveFailures: this.cascadeTranslateFailureCount,
        error: sanitizeError(error),
      });
      if (this.cascadeTranslateFailureCount >= 3) throw error;
      // Keep the pipeline alive on an isolated timeout/failure: persist the
      // recognized source as a pending source-only caption so the UI can show
      // a delayed state instead of silently dropping the utterance.
      await this.convex.mutation(api.realtimeRuntime.recordTranslationSegmentFromWorker, {
        secret: this.config.workerSecret,
        callId: this.callId,
        realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
        sourceText,
        translatedText: "",
        confidence: entry.confidence,
        model: `${this.config.liveGuidanceTranscriptionModel}+${this.config.liveTranslationTextModel}`,
        pipeline: this.translationPipeline,
        isFinal: false,
        direction: "caller_to_user",
        audioMode: "caption_only",
        audioStored: false,
      });
      return;
    }

    const translatedAt = Date.now();
    const speechToTranslationMs = entry.speechStartedAt
      ? translatedAt - entry.speechStartedAt
      : undefined;
    const utteranceEndToTranslationMs = entry.committedAt
      ? translatedAt - entry.committedAt
      : undefined;
    const stageTimings = {
      translationRequestMs: translatedAt - translationStartedAt,
      ...(entry.firstDeltaAt && entry.speechStartedAt
        ? { speechToFirstSourceDeltaMs: entry.firstDeltaAt - entry.speechStartedAt }
        : {}),
      ...(entry.firstDeltaAt && entry.committedAt
        ? { commitToFirstSourceDeltaMs: entry.firstDeltaAt - entry.committedAt }
        : {}),
      ...(speechToTranslationMs !== undefined ? { speechToTranslationMs } : {}),
      ...(utteranceEndToTranslationMs !== undefined ? { utteranceEndToTranslationMs } : {}),
    };
    // Below the calibrated confidence floor a caption is stored as pending
    // (visible but never authoritative) instead of final.
    const lowConfidence =
      this.config.translationMinConfidence > 0 &&
      entry.confidence !== undefined &&
      entry.confidence < this.config.translationMinConfidence;
    const writeStartedAt = Date.now();
    await this.convex.mutation(api.realtimeRuntime.recordTranslationSegmentFromWorker, {
      secret: this.config.workerSecret,
      callId: this.callId,
      realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      sourceText,
      translatedText,
      latencyMs: speechToTranslationMs,
      firstAudioLatencyMs: this.translationFirstOutputLatencyMs ?? speechToTranslationMs,
      model: `${this.config.liveGuidanceTranscriptionModel}+${this.config.liveTranslationTextModel}`,
      confidence: entry.confidence,
      pipeline: this.translationPipeline,
      stageTimings,
      isFinal: !lowConfidence,
      direction: "caller_to_user",
      audioMode: "caption_only",
      audioStored: false,
    });
    if (lowConfidence) {
      this.logger("info", "translation_final_suppressed", {
        pipeline: this.translationPipeline,
        reason: "low_confidence",
        confidence: entry.confidence,
        minConfidence: this.config.translationMinConfidence,
      });
    } else {
      await this.convex.mutation(api.callGuidance.addRealtimeGuidanceItemFromWorker, {
        secret: this.config.workerSecret,
        callId: this.callId,
        realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
        type: "translation_caption",
        label: translatedText.slice(0, 220),
        detail: sourceText.slice(0, 220),
        source: "translated_captions",
      });
    }
    if (!this.translationHasOutput) {
      this.translationHasOutput = true;
      this.translationFirstOutputLatencyMs = Math.max(0, translatedAt - this.startedAt);
    }
    this.logger("info", "cascade_translation_flushed", {
      transcriptionDelay: this.config.transcriptionDelay,
      translationRequestMs: translatedAt - translationStartedAt,
      speechToTranslationMs,
      utteranceEndToTranslationMs,
      convexWriteMs: Date.now() - writeStartedAt,
    });
  }

  // Spoken Translation Phase 1 (internal-only, see AGENTIC_FUTURE.md). Called
  // by the server for a /browser/audio-stream WebSocket that has already
  // passed origin allowlisting and Convex token validation for this call.
  // Multiple sockets per call can be attached at once (e.g. a tab reload
  // mid-call); the generation counter here is for clean logging only, not
  // for evicting older sockets.
  attachBrowserAudioSocket(ws) {
    this.browserAudioSocketGeneration += 1;
    const generation = this.browserAudioSocketGeneration;
    this.browserAudioSockets.add(ws);
    ws.on("close", () => {
      this.browserAudioSockets.delete(ws);
    });
    this.logger("info", "browser_audio_stream_attached", {
      generation,
      attachedSockets: this.browserAudioSockets.size,
    });
    try {
      ws.send(
        JSON.stringify({
          type: "translation_audio_ready",
          callId: this.callId,
          targetLanguage: this.targetLanguage,
        })
      );
    } catch {
      // Closed between attach and send; its own "close" listener above
      // already removes it from browserAudioSockets.
    }
  }

  handleTranslationEvent(event) {
    if (event.type === "error") {
      const error = new Error(event.error?.message || "OpenAI translation error");
      const terminal = isTerminalTranslationError(event);
      this.logger(terminal ? "error" : "info", "translation_provider_error", {
        error: sanitizeError(error),
        errorType: event.error?.type,
        errorCode: event.error?.code,
        terminal,
      });
      if (terminal) void this.failTranslation(error);
      return;
    }
    if (event.type === "session.created") {
      this.translationProviderSessionId = event.session?.id;
      return;
    }
    if (event.type === "session.updated") {
      this.translationProviderSessionId = event.session?.id || this.translationProviderSessionId;
      void this.activateTranslationSession();
      return;
    }
    if (event.type === "session.closed") {
      this.resolveTranslationSessionClosed?.();
      return;
    }
    if (event.type === "session.input_transcript.delta") {
      const delta = String(event.delta || "");
      if (delta) {
        this.translationSourceDeltas.push({
          text: delta,
          elapsedMs: Number(event.elapsed_ms),
        });
        // Source-first pending captions: recognized words render before any
        // translated text exists.
        void this.requestTranslationFlush(false, "source_partial");
      }
      return;
    }
    if (event.type === "session.output_audio.delta") {
      // No-op path for the ~100% of calls not on the audio-forward
      // allowlist or with no attached browser tab: one boolean read and one
      // Set.size read, no Convex round-trip, entirely separate from the
      // caption state machine below.
      if (!this.forwardTranslationAudio || this.browserAudioSockets.size === 0) return;
      this.browserAudioFrameSequence += 1;
      const frame = JSON.stringify({
        type: "translation_audio_delta",
        callId: this.callId,
        sequence: this.browserAudioFrameSequence,
        elapsedMs: event.elapsed_ms,
        payload: event.delta,
      });
      for (const ws of this.browserAudioSockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
      if (this.browserAudioFrameSequence % 25 === 0) {
        this.logger("info", "translation_audio_forwarded", {
          sequence: this.browserAudioFrameSequence,
          byteLength: Buffer.byteLength(event.delta || "", "base64"),
          attachedSockets: this.browserAudioSockets.size,
        });
      }
      return;
    }

    if (event.type !== "session.output_transcript.delta") return;

    const delta = String(event.delta || "");
    if (!delta) return;
    const now = Date.now();
    if (!this.translationTargetBuffer) {
      this.translationUtteranceStartedAt = now;
    }
    if (!this.translationHasOutput) {
      this.translationHasOutput = true;
      this.translationFirstOutputLatencyMs = Math.max(0, now - this.startedAt);
      this.logger("info", "translation_first_output", {
        latencyMs: this.translationFirstOutputLatencyMs,
        elapsedMs: event.elapsed_ms,
      });
    }
    this.translationTargetBuffer += delta;
    this.translationLastElapsedMs = event.elapsed_ms;

    const segmentAgeMs = this.translationUtteranceStartedAt
      ? now - this.translationUtteranceStartedAt
      : 0;
    const reachedBoundary =
      this.translationTargetBuffer.length >= this.config.translationSegmentMaxChars ||
      segmentAgeMs >= this.config.translationSegmentMaxMs;
    if (reachedBoundary) {
      void this.requestTranslationFlush(true, "limit");
      return;
    }

    void this.requestTranslationFlush(false, "partial");
    this.scheduleTranslationBoundary(
      hasTerminalPunctuation(this.translationTargetBuffer) ? "punctuation" : "idle"
    );
  }

  async activateTranslationSession() {
    if (
      this.translationSessionActive ||
      this.translationSessionActivating ||
      this.translationSessionFinished
    ) {
      return;
    }
    if (!this.translatedCaptionsRealtimeSessionId) {
      this.translationSessionActive = true;
      this.logger("info", "bridge_translation_session_active", {
        streamSid: this.streamSid,
        legRole: this.legRole,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
        pipeline: this.translationPipeline,
      });
      // Observability only: a failed write must not fail the direction.
      if (this.bridgeReverseRealtimeSessionId) {
        void this.convex
          .mutation(api.realtimeRuntime.markRealtimeSessionActiveFromWorker, {
            secret: this.config.workerSecret,
            realtimeSessionId: this.bridgeReverseRealtimeSessionId,
            providerSessionId: this.translationProviderSessionId,
            providerStreamSid: this.streamSid,
            providerCallSid: this.providerCallSid,
            model: "palabra-s2s",
            startedAt: this.startedAt,
            pipeline: this.translationPipeline,
            workerBuild: this.workerBuild,
            configFingerprint: this.configFingerprint,
          })
          .catch((error) => {
            this.logger("error", "bridge_reverse_session_activate_failed", {
              error: sanitizeError(error),
            });
          });
      }
      return;
    }
    this.translationSessionActivating = true;
    try {
      await this.convex.mutation(api.realtimeRuntime.markRealtimeSessionActiveFromWorker, {
        secret: this.config.workerSecret,
        realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
        providerSessionId:
          this.translationPipeline === "cascade"
            ? this.transcriptionProviderSessionId
            : this.translationProviderSessionId,
        providerStreamSid: this.streamSid,
        providerCallSid: this.providerCallSid,
        model:
          this.translationPipeline === "palabra"
            ? "palabra-s2s"
            : this.translationPipeline === "cascade"
              ? `${this.config.liveGuidanceTranscriptionModel}+${this.config.liveTranslationTextModel}`
              : this.config.liveTranslationModel,
        startedAt: this.startedAt,
        pipeline: this.translationPipeline,
        workerBuild: this.workerBuild,
        configFingerprint: this.configFingerprint,
      });
      this.translationSessionActive = true;
      this.logger("info", "translation_session_active", {
        streamSid: this.streamSid,
        targetLanguage: this.targetLanguage,
        pipeline: this.translationPipeline,
      });
    } catch (error) {
      await this.failTranslation(error);
    } finally {
      this.translationSessionActivating = false;
    }
  }

  scheduleTranslationBoundary(reason) {
    if (this.translationBoundaryTimer) clearTimeout(this.translationBoundaryTimer);
    const delay =
      reason === "punctuation"
        ? Math.min(700, this.config.translationSegmentIdleMs)
        : this.config.translationSegmentIdleMs;
    this.translationBoundaryTimer = setTimeout(() => {
      this.translationBoundaryTimer = undefined;
      void this.requestTranslationFlush(true, reason);
    }, delay);
    this.translationBoundaryTimer.unref?.();
  }

  requestTranslationFlush(isFinal, reason) {
    if (!this.translationTargetBuffer.trim() && this.translationSourceDeltas.length === 0) {
      return Promise.resolve();
    }
    const existing = this.translationFlushRequest;
    this.translationFlushRequest = {
      isFinal: Boolean(existing?.isFinal || isFinal),
      reason: isFinal ? reason : existing?.reason || reason,
    };
    if (!this.translationFlushInProgress) {
      this.translationFlushPromise = this.drainTranslationFlushes();
    }
    return this.translationFlushPromise;
  }

  async drainTranslationFlushes() {
    this.translationFlushInProgress = true;
    try {
      while (this.translationFlushRequest) {
        const request = this.translationFlushRequest;
        this.translationFlushRequest = undefined;
        try {
          await this.flushTranslation(request.isFinal, request.reason);
          this.translationFlushFailureCount = 0;
        } catch (error) {
          this.translationFlushFailureCount += 1;
          // A dropped partial re-sends on the next flush because the buffer
          // accumulates; clear the dedupe snapshot so the retry is not skipped.
          this.lastFlushedCaptionKey = "";
          this.logger("error", "translation_caption_flush_failed", {
            reason: request.reason,
            isFinal: request.isFinal,
            consecutiveFailures: this.translationFlushFailureCount,
            error: sanitizeError(error),
          });
          if (this.translationFlushFailureCount >= 3) {
            await this.failTranslation(error);
            return;
          }
          if (request.isFinal) {
            this.translationFlushRequest = { isFinal: true, reason: request.reason };
          }
        }
      }
    } finally {
      this.translationFlushInProgress = false;
    }
  }

  async flushTranslation(isFinal, reason) {
    const now = Date.now();
    const translatedSnapshot = this.translationTargetBuffer;
    const translatedText = translatedSnapshot.trim();
    // Finals pair source and target on the provider audio timeline: consume
    // source deltas through the target window plus the measured lead
    // tolerance, then cut at the last source sentence boundary. Partials show
    // everything recognized so far so the UI can render source-first.
    let consumedCount = this.translationSourceDeltas.length;
    let windowText = this.translationSourceDeltas.map((delta) => delta.text).join("");
    let sourceCut = windowText.length;
    if (isFinal) {
      const window = consumeSourceDeltasForWindow(
        this.translationSourceDeltas,
        Number(this.translationLastElapsedMs),
        this.config.translationSourceLeadToleranceMs
      );
      consumedCount = window.consumedCount;
      windowText = window.text;
      sourceCut = translationSourceCutIndex(windowText, translatedText);
    }
    const sourceText = windowText.slice(0, sourceCut).trim();
    // Partials may be source-only (source-first rendering); finals always
    // carry translated text.
    if (!translatedText && (isFinal || !sourceText)) return;
    if (
      !isFinal &&
      now - this.lastTranslationCaptionAt < this.config.translationCaptionIntervalMs
    ) {
      return;
    }
    const captionKey = `${sourceText}\u0000${translatedText}`;
    if (!isFinal && captionKey === this.lastFlushedCaptionKey) return;

    this.lastTranslationCaptionAt = now;
    this.lastFlushedCaptionKey = captionKey;
    const latencyMs = this.translationUtteranceStartedAt
      ? Math.max(0, now - this.translationUtteranceStartedAt)
      : undefined;
    // A final without aligned source text is never promoted to an
    // authoritative caption; it is persisted as a suppressed pending row.
    const suppressedFinal = isFinal && !sourceText;
    const persistedIsFinal = isFinal && !suppressedFinal;
    const writeStartedAt = Date.now();
    const inPlaceUpdate = Boolean(this.currentTranslationSegmentId);
    const stageTimings = Number.isFinite(Number(this.translationLastElapsedMs))
      ? { providerElapsedMs: Number(this.translationLastElapsedMs) }
      : undefined;

    // Each mutation gets exactly the fields its Convex validator accepts;
    // Convex rejects mutations that carry extra fields.
    if (this.currentTranslationSegmentId) {
      await this.convex.mutation(api.realtimeRuntime.updateTranslationSegmentFromWorker, {
        secret: this.config.workerSecret,
        segmentId: this.currentTranslationSegmentId,
        sourceText,
        translatedText,
        latencyMs,
        firstAudioLatencyMs: this.translationFirstOutputLatencyMs,
        stageTimings,
        isFinal: persistedIsFinal,
      });
    } else {
      const result = await this.convex.mutation(
        api.realtimeRuntime.recordTranslationSegmentFromWorker,
        {
          secret: this.config.workerSecret,
          callId: this.callId,
          realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          sourceText,
          translatedText,
          latencyMs,
          firstAudioLatencyMs: this.translationFirstOutputLatencyMs,
          model: this.config.liveTranslationModel,
          pipeline: this.translationPipeline,
          stageTimings,
          isFinal: persistedIsFinal,
          direction: "caller_to_user",
          audioMode: "caption_only",
          audioStored: false,
        }
      );
      if (!isFinal && result?.segmentId) {
        this.currentTranslationSegmentId = result.segmentId;
      }
    }

    this.logger("info", "translation_caption_flushed", {
      isFinal,
      reason,
      latencyMs,
      elapsedMs: this.translationLastElapsedMs,
      convexWriteMs: Date.now() - writeStartedAt,
      inPlaceUpdate,
    });
    if (!isFinal) return;

    if (suppressedFinal) {
      this.logger("info", "translation_final_suppressed", {
        pipeline: this.translationPipeline,
        reason: "missing_source",
        targetChars: translatedText.length,
      });
    } else {
      await this.convex.mutation(api.callGuidance.addRealtimeGuidanceItemFromWorker, {
        secret: this.config.workerSecret,
        callId: this.callId,
        realtimeSessionId: this.translatedCaptionsRealtimeSessionId,
        type: "translation_caption",
        label: translatedText.slice(0, 220),
        detail: sourceText ? sourceText.slice(0, 220) : undefined,
        source: "translated_captions",
      });
    }

    this.translationTargetBuffer = this.translationTargetBuffer.slice(
      translatedSnapshot.length
    );
    // Keep the uncut remainder of the consumed window plus every unconsumed
    // delta buffered for the next caption.
    const remainderText = windowText.slice(sourceCut);
    const remainingDeltas = this.translationSourceDeltas.slice(consumedCount);
    const lastConsumedElapsedMs =
      consumedCount > 0
        ? this.translationSourceDeltas[consumedCount - 1].elapsedMs
        : undefined;
    this.translationSourceDeltas = remainderText
      ? [{ text: remainderText, elapsedMs: lastConsumedElapsedMs }, ...remainingDeltas]
      : remainingDeltas;
    this.lastFlushedCaptionKey = "";
    this.lastTranslationCaptionAt = 0;
    this.currentTranslationSegmentId = undefined;
    this.translationUtteranceStartedAt = this.translationTargetBuffer ? Date.now() : 0;
    if (this.translationTargetBuffer.trim()) {
      this.scheduleTranslationBoundary("idle");
      void this.requestTranslationFlush(false, "partial");
    }
  }

  async failTranslation(error) {
    if (this.translationSessionFinished || this.ended) return;
    this.translationSessionFinished = true;
    if (this.translationBoundaryTimer) clearTimeout(this.translationBoundaryTimer);
    this.translationBoundaryTimer = undefined;
    const sanitizedError = sanitizeError(error);
    this.logger("error", "translation_session_failed", { error: sanitizedError });
    const socket = this.translationSocket;
    this.translationSocket = undefined;
    socket?.close();
    if (this.translationPipeline === "cascade" && !this.liveCopilot) {
      this.transcriptionSocket?.close();
      this.transcriptionSocket = undefined;
    }
    if (this.palabraReadyPollTimer) clearInterval(this.palabraReadyPollTimer);
    this.palabraReadyPollTimer = undefined;
    if (this.palabraReadyDeadlineTimer) clearTimeout(this.palabraReadyDeadlineTimer);
    this.palabraReadyDeadlineTimer = undefined;
    const palabraSocket = this.palabraSocket;
    this.palabraSocket = undefined;
    palabraSocket?.close();
    this.resolveTranslationSessionClosed?.();

    // Bridge: one direction failing degrades the whole call for both people.
    // Runs before the Convex finish below so the mixers switch to full volume
    // on the very next frame rather than after a network round trip.
    this.degradeBridgeToPlainCall(sanitizedError);

    const endedAt = Date.now();
    const durationSeconds = Math.max(0, Math.ceil((endedAt - this.startedAt) / 1000));
    const failedSessionId =
      this.translatedCaptionsRealtimeSessionId ?? this.bridgeReverseRealtimeSessionId;
    if (failedSessionId) {
      try {
        await this.convex.mutation(api.realtimeRuntime.finishRealtimeSessionFromWorker, {
          secret: this.config.workerSecret,
          realtimeSessionId: failedSessionId,
          status: "failed",
          durationSeconds,
          endedAt,
          errorCode: "translation_provider_error",
          errorMessage: sanitizedError,
        });
      } catch (finishError) {
        this.logger("error", "realtime_session_finish_failed", {
          feature: this.translatedCaptionsRealtimeSessionId
            ? "translated_captions"
            : "translated_audio_bridge_reverse",
          error: sanitizeError(finishError),
        });
      }
    }
  }

  async fail(error) {
    this.logger("error", "realtime_stream_failed", { error: sanitizeError(error) });
    await this.close("failed", error);
  }

  async drainCascadeTranslation() {
    const deadline = Date.now() + this.config.translationDrainMs;
    while (
      (this.transcriptionCommitQueue.length > 0 ||
        this.transcriptionEntriesByOrdinal.size > 0) &&
      Date.now() < deadline
    ) {
      await sleep(50);
    }
    const remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs > 0) {
      await Promise.race([this.translationWorkPromise, sleep(remainingMs)]);
    }
  }

  async close(status, error) {
    if (this.ended) return;
    this.ended = true;
    const introduction = this.bridgeIntroduction ?? this.siblingLeg?.bridgeIntroduction;
    introduction?.stop();
    this.clearBridgeSessionDeadline();
    clearInterval(this.inactivityTimer);
    this.inactivityTimer = undefined;
    this.bridgeSpeechDetector?.destroy();
    this.bridgeSpeechDetector = undefined;
    this.safetyAudio = Buffer.alloc(0);
    this.commitGuidanceTurn("inbound");
    this.commitGuidanceTurn("outbound");
    this.commitTranscriptionAudio("close");
    if (this.translationPipeline === "palabra" && this.palabraSocket) {
      if (!this.translationSessionFinished) {
        this.palabraSocket.sendJson({ message_type: "end_task", data: {} });
        // Bounded drain so in-flight caption writes land before session
        // accounting below reads translationHasOutput.
        await Promise.race([this.translationWorkPromise, sleep(this.config.translationDrainMs)]);
      }
      if (this.palabraReadyPollTimer) clearInterval(this.palabraReadyPollTimer);
      this.palabraReadyPollTimer = undefined;
      if (this.palabraReadyDeadlineTimer) clearTimeout(this.palabraReadyDeadlineTimer);
      this.palabraReadyDeadlineTimer = undefined;
      this.palabraSocket.close();
      this.palabraSocket = undefined;
    } else if (this.translationPipeline === "cascade" && this.translatedCaptions) {
      await this.drainCascadeTranslation();
    } else if (this.translationSocket && !this.translationSessionFinished) {
      this.translationSessionClosing = true;
      this.translationSocket.sendJson({ type: "session.close" });
      if (this.translationSessionClosedPromise && this.config.translationDrainMs > 0) {
        await Promise.race([
          this.translationSessionClosedPromise,
          sleep(this.config.translationDrainMs),
        ]);
      }
      await this.requestTranslationFlush(true, "session_close");
    }
    const endedAt = Date.now();
    const durationSeconds = Math.max(0, Math.ceil((endedAt - this.startedAt) / 1000));

    for (const [feature, session] of this.activeSessions.entries()) {
      // Both translation features must clear this gate. Naming only
      // translated_captions here would have let a bridged call bill 9c/min even
      // when the translation produced nothing, because the new feature literal
      // would fall through as "not a translation feature".
      const isTranslationFeature =
        feature === "translated_captions" || feature === "translated_audio";
      const translationWasUsable =
        !isTranslationFeature ||
        (this.translationHasOutput && !this.translationSessionFinished);
      const guidanceWasUsable =
        feature !== "live_copilot" ||
        (!this.guidanceSessionFailed || this.guidanceStats.emitted > 0);
      if (translationWasUsable && guidanceWasUsable) {
        try {
          await this.convex.mutation(api.realtimeUsage.recordRealtimeUsageFromWorker, {
            secret: this.config.workerSecret,
            workspaceId: this.workspaceId,
            callId: this.callId,
            realtimeSessionId: session.realtimeSessionId,
            feature,
            durationSeconds,
            model: session.model,
            startedAt: this.startedAt,
            endedAt,
          });
        } catch (usageError) {
          this.logger("error", "realtime_usage_record_failed", {
            feature,
            error: sanitizeError(usageError),
          });
        }
      } else {
        this.logger("info", "realtime_usage_skipped", {
          feature,
          reason: this.translationSessionFinished ? "session_failed" : "no_output",
        });
      }
      // Must use the same predicate as translationWasUsable above. Naming only
      // translated_captions here meant a bridged call whose Palabra session had
      // already been marked failed by failTranslation fell through and was
      // finished a SECOND time as "completed", with the full leg duration and the
      // errorCode cleared — so a mid-call provider failure looked like a clean
      // session in realtimeSessions. The charge was correctly skipped either way;
      // the damage was to the record, which is what cost reconciliation reads.
      if (isTranslationFeature && this.translationSessionFinished) continue;
      if (feature === "live_copilot" && this.guidanceSessionFailed) continue;
      try {
        await this.convex.mutation(api.realtimeRuntime.finishRealtimeSessionFromWorker, {
          secret: this.config.workerSecret,
          realtimeSessionId: session.realtimeSessionId,
          status,
          durationSeconds,
          endedAt,
          errorCode: error ? "worker_error" : undefined,
          errorMessage: error ? sanitizeError(error) : undefined,
          guidanceMetrics: feature === "live_copilot" ? this.guidanceStats : undefined,
        });
      } catch (finishError) {
        this.logger("error", "realtime_session_finish_failed", {
          feature,
          error: sanitizeError(finishError),
        });
      }
    }

    // The browser leg's observability-only reverse session is not in
    // activeSessions (it bills nothing), so it is finished here. A failed
    // direction was already finished as "failed" by failTranslation.
    if (this.bridgeReverseRealtimeSessionId && !this.translationSessionFinished) {
      try {
        await this.convex.mutation(api.realtimeRuntime.finishRealtimeSessionFromWorker, {
          secret: this.config.workerSecret,
          realtimeSessionId: this.bridgeReverseRealtimeSessionId,
          status,
          durationSeconds,
          endedAt,
          errorCode: error ? "worker_error" : undefined,
          errorMessage: error ? sanitizeError(error) : undefined,
        });
      } catch (finishError) {
        this.logger("error", "realtime_session_finish_failed", {
          feature: "translated_audio_bridge_reverse",
          error: sanitizeError(finishError),
        });
      }
    }

    this.transcriptionSocket?.close();
    this.guidanceSocket?.close();
    this.translationSocket?.close();
    this.transcriptionSocket = undefined;
    this.guidanceSocket = undefined;
    this.translationSocket = undefined;

    const endFrame = JSON.stringify({ type: "translation_audio_end", callId: this.callId });
    for (const ws of this.browserAudioSockets) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(endFrame);
        ws.close();
      } catch {
        // Best-effort notification only; the socket is being torn down.
      }
    }
    this.browserAudioSockets.clear();
    if (this.callId) this.onCallUnregistered?.(this.callId, this.legRole);

    this.logger("info", "twilio_stream_closed", {
      streamSid: this.streamSid,
      status,
      durationSeconds,
    });
  }
}

// Two-leg call registry for the translation bridge.
//
// Exported (rather than left as a closure inside
// createRealtimeMediaWorkerServer) so scripts/test-realtime-media-worker.mjs
// can exercise the real implementation. The previous test re-implemented this
// logic locally, which is why the missing sibling teardown that caused the
// 2026-07-30 incident was invisible to it.
//
// Every non-bridge call only ever registers a "browser" leg, so this is a
// superset of the old single-connection-per-call behavior.
export function createBridgeLegRegistry({ onBrowserLegRegistered, onCallRemoved } = {}) {
  const connectionsByCallId = new Map();

  function register(callId, connection, legRole) {
    let entry = connectionsByCallId.get(callId);
    if (!entry) {
      entry = { browserLeg: undefined, calleeLeg: undefined };
      connectionsByCallId.set(callId, entry);
    }
    const key = legRole === "callee" ? "calleeLeg" : "browserLeg";
    const siblingKey = legRole === "callee" ? "browserLeg" : "calleeLeg";
    entry[key] = connection;
    // Cross-reference both ways, whichever leg happened to register first.
    connection.siblingLeg = entry[siblingKey];
    if (entry[siblingKey]) entry[siblingKey].siblingLeg = connection;

    if (key !== "browserLeg") return;
    onBrowserLegRegistered?.(callId, connection);
  }

  function unregister(callId, legRole) {
    const entry = connectionsByCallId.get(callId);
    if (!entry) return;
    const key = legRole === "callee" ? "calleeLeg" : "browserLeg";
    const siblingKey = legRole === "callee" ? "browserLeg" : "calleeLeg";
    const sibling = entry[siblingKey];
    if (sibling) sibling.siblingLeg = undefined;
    entry[key] = undefined;

    // The 2026-07-30 incident, exactly: the browser leg's session ended at 52
    // seconds while the callee leg's Palabra session ran for 2,940 more,
    // because unregistering only dropped the registry reference. One half of a
    // bridge has no purpose without the other — a surviving leg can only stream
    // audio nothing will translate, and bill for it — so tear it down here
    // instead of waiting for Twilio-side termination to succeed.
    if (sibling && !sibling.ended && sibling.bridgeModeActive) {
      entry[siblingKey] = undefined;
      void sibling.terminateForLifecycleEvent(`sibling_${legRole}_disconnected`);
    }

    if (entry.browserLeg || entry.calleeLeg) return;
    connectionsByCallId.delete(callId);
    onCallRemoved?.(callId);
  }

  return { register, unregister, connectionsByCallId };
}

export function createRealtimeMediaWorkerServer({
  config = buildWorkerConfig(),
  convex,
  openAiSocketFactory,
  guidanceRequester,
  translationRequester,
  disclosureAudioProvider,
  logger = safeLog,
} = {}) {
  validateWorkerConfig(config);
  const configFingerprint = computeConfigFingerprint(config);
  logger("info", "realtime_worker_fingerprint", {
    workerBuild: WORKER_BUILD,
    configFingerprint,
  });
  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      // The fingerprints let deploy verification confirm the source and
      // configuration inside the running container, not just on the host.
      res.end(
        JSON.stringify({
          ok: true,
          workerBuild: WORKER_BUILD,
          configFingerprint,
          // Capacity signal for operators: how close the worker is to
          // config.maxStreams (a bridge call consumes two).
          activeStreams: active.size,
          maxStreams: config.maxStreams,
        })
      );
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  const wss = new WebSocketServer({ noServer: true });
  const active = new Set();
  // Sockets that have connected but not yet passed handleStart's
  // authentication, keyed by client address — see maxPendingStreamsPerIp.
  const pendingByAddress = new Map();
  const convexClient = convex || new ConvexHttpClient(config.convexUrl);
  if (!isStreamAuthEnabled(config)) {
    logger("error", "stream_auth_disabled", {
      message:
        "REALTIME_ALLOW_UNSIGNED_STREAMS is set: any client can drive this worker. Local smoke use only.",
    });
  }

  // Spoken Translation Phase 1 (internal-only, see AGENTIC_FUTURE.md): lets a
  // /browser/audio-stream connection find the in-progress call's browser-leg
  // TwilioRealtimeConnection by Voxandra callId. pendingBrowserSockets holds
  // a browser socket that connected before the matching Twilio stream's
  // "start" event registered the call (or after the call already ended).
  //
  // Real two-leg translation bridge (internal-only, single-workspace test,
  // sub-phase 5b — see AGENTIC_FUTURE.md): each callId now maps to up to two
  // connections, one per leg ({ browserLeg, calleeLeg }), not a single
  // connection. Every non-bridge call only ever registers a "browser" leg,
  // so this is a superset of the old single-connection behavior, not a
  // breaking change for existing call types.
  const pendingBrowserSockets = new Map();
  let browserAudioSocketCount = 0;

  const legRegistry = createBridgeLegRegistry({
    // Only the browser leg carries the Phase 1 listen-along channel.
    onBrowserLegRegistered: (callId, connection) => {
      const pending = pendingBrowserSockets.get(callId);
      if (!pending) return;
      pendingBrowserSockets.delete(callId);
      for (const ws of pending) {
        if (ws.readyState === WebSocket.OPEN) connection.attachBrowserAudioSocket(ws);
      }
    },
    onCallRemoved: (callId) => {
      const pending = pendingBrowserSockets.get(callId);
      if (!pending) return;
      pendingBrowserSockets.delete(callId);
      for (const ws of pending) {
        try {
          ws.close();
        } catch {
          // Already closing; nothing to do.
        }
      }
    },
  });
  const connectionsByCallId = legRegistry.connectionsByCallId;
  const registerCallConnection = legRegistry.register;
  const unregisterCallConnection = legRegistry.unregister;

  function rejectBrowserAudioStream(ws, reason) {
    logger("info", "browser_audio_stream_rejected", { reason });
    try {
      ws.send(JSON.stringify({ type: "translation_audio_error", reason }));
    } catch {
      // Socket already gone; nothing to notify.
    }
    ws.close();
  }

  async function handleBrowserAudioStreamUpgrade(ws, { token, callId }) {
    browserAudioSocketCount += 1;
    ws.on("close", () => {
      browserAudioSocketCount = Math.max(0, browserAudioSocketCount - 1);
    });

    let validated;
    try {
      validated = await convexClient.mutation(
        api.browserAudioStream.validateBrowserAudioStreamToken,
        { secret: config.workerSecret, callId, token }
      );
    } catch {
      rejectBrowserAudioStream(ws, "invalid_token");
      return;
    }
    // Defense in depth: Convex and the worker read the allowlist from
    // separate env, so both must independently agree before any audio flows.
    if (!shouldForwardTranslationAudio(config, validated.workspaceId)) {
      rejectBrowserAudioStream(ws, "not_allowlisted");
      return;
    }

    // The browser-audio-stream (listen-along) channel only ever attaches to
    // the browser leg — a bridge call's callee leg has no such concept.
    const connection = connectionsByCallId.get(callId)?.browserLeg;
    if (connection) {
      connection.attachBrowserAudioSocket(ws);
      return;
    }

    let pending = pendingBrowserSockets.get(callId);
    if (!pending) {
      pending = new Set();
      pendingBrowserSockets.set(callId, pending);
    }
    pending.add(ws);
    const idleTimeout = setTimeout(() => {
      const stillPending = pendingBrowserSockets.get(callId);
      if (stillPending?.has(ws)) {
        stillPending.delete(ws);
        try {
          ws.close();
        } catch {
          // Already closing; nothing to do.
        }
      }
    }, 30_000);
    ws.on("close", () => {
      clearTimeout(idleTimeout);
      pendingBrowserSockets.get(callId)?.delete(ws);
    });
  }

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname, searchParams } = new URL(req.url || "/", "http://localhost");

    if (pathname === "/twilio/media-stream") {
      if (active.size >= config.maxStreams) {
        logger("error", "twilio_stream_capacity_exceeded", { maxStreams: config.maxStreams });
        socket.destroy();
        return;
      }
      const address = resolveClientAddress(req, config);
      const pendingForAddress = pendingByAddress.get(address) || 0;
      if (pendingForAddress >= config.maxPendingStreamsPerIp) {
        // Address is deliberately not logged: it is the only thing here that
        // could identify a client, and the count is what matters.
        logger("error", "twilio_stream_pending_cap_exceeded", {
          maxPendingStreamsPerIp: config.maxPendingStreamsPerIp,
        });
        socket.destroy();
        return;
      }
      pendingByAddress.set(address, pendingForAddress + 1);
      let pending = true;
      const settlePending = () => {
        if (!pending) return;
        pending = false;
        const remaining = (pendingByAddress.get(address) || 1) - 1;
        if (remaining <= 0) pendingByAddress.delete(address);
        else pendingByAddress.set(address, remaining);
      };
      wss.handleUpgrade(req, socket, head, (ws) => {
        active.add(ws);
        // A socket that never authenticates must not hold a slot: Twilio
        // sends `start` immediately, so anything still pending at the
        // deadline is not Twilio.
        const startTimer = setTimeout(() => {
          if (!pending) return;
          logger("error", "twilio_stream_start_timeout", {
            streamStartTimeoutMs: config.streamStartTimeoutMs,
          });
          try {
            ws.close();
          } catch {
            // Already closing; nothing to do.
          }
        }, config.streamStartTimeoutMs);
        startTimer.unref?.();
        ws.on("close", () => {
          clearTimeout(startTimer);
          settlePending();
          active.delete(ws);
        });
        new TwilioRealtimeConnection({
          socket: ws,
          convex: convexClient,
          config,
          openAiSocketFactory,
          guidanceRequester,
          translationRequester,
          disclosureAudioProvider,
          logger,
          onCallRegistered: registerCallConnection,
          onCallUnregistered: unregisterCallConnection,
          onStreamAuthenticated: () => {
            clearTimeout(startTimer);
            settlePending();
          },
        });
      });
      return;
    }

    if (pathname === "/browser/audio-stream") {
      const origin = req.headers.origin;
      const token = searchParams.get("token");
      const callId = searchParams.get("callId");
      if (
        !isAllowedBrowserAudioStreamOrigin(config, origin) ||
        !token ||
        !callId ||
        browserAudioSocketCount >= config.maxBrowserAudioStreams
      ) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handleBrowserAudioStreamUpgrade(ws, { token, callId });
      });
      return;
    }

    socket.destroy();
  });

  return { httpServer, wss, active };
}
