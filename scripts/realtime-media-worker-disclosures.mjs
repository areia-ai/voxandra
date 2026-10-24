import { getLanguageName } from "./translation-language-catalog.mjs";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractResponseText } from "./realtime-media-worker-core.mjs";

// Real two-leg translation bridge, sub-phase 5c (internal-only, see
// AGENTIC_FUTURE.md / REALTIME_WORKER_RUNBOOK.md): the spoken AI-translation
// disclosure that every doc names as the last thing blocking the bridge from
// leaving the single allowlisted test workspace. Played once, at the start of
// the callee leg, before any real Palabra-translated speech.
//
// Deliberately generated on demand rather than pregenerated for a fixed
// language list: Voxandra's whole pitch is broad multilingual reach, so
// adding a language must never require a manual translate/record/deploy
// cycle. The first bridge call in a given language pays a one-time
// translate+synthesize round trip; every call after that hits the cache.

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

// gpt-4o-mini-tts over tts-1: OpenAI's newer, more reliable TTS model: see
// LOG.md/this feature's entry for the model-choice note. Fixed voice/model —
// this is a short, one-time-per-language disclosure, not something that
// needs per-call tuning.
const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_VOICE = "alloy";

// The fixed English source script every other language is translated from.
// Deliberately explains the bridge's mechanics rather than just naming the
// service: real-tester feedback was that first-time callees are confused by
// hearing two voices at once (a faint real one and an AI one), so the script
// tells them what each voice is, that their own speech is translated the same
// way for the other side, and gives the one tip that measurably helps quality.
export const BRIDGE_DISCLOSURE_ENGLISH_TEXT =
  "Voxandra's AI translates this call for both of you. During the conversation, you'll hear a translated voice over the other person's quieter voice. Speak in your own language and pause between sentences. Please wait for the go-ahead.";

export const BRIDGE_GO_AHEAD_ENGLISH_TEXT = "You can speak now.";
export const BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT = "We couldn't start translation. Please hang up and try again.";
export const BRIDGE_INACTIVITY_WARNING_ENGLISH_TEXT = "No speech has been detected for two minutes. This call will end in less than one minute unless someone speaks. The caller can also choose Keep connected in Voxandra.";
export const BRIDGE_INTRODUCTION_TIMEOUT_MS = 60_000;

// Short hash of the English script, folded into every cache filename below:
// translations aren't deterministic and nothing else can tell the worker that
// a cached clip was generated from older wording, so a wording change must
// invalidate every cached language on its own instead of relying on someone
// remembering which files to delete by hand (that step was missed once already
// — see LOG.md's first wording update). Ten hex characters is far beyond
// collision-safe for how often this script changes.
const DISCLOSURE_TEXT_HASH = createHash("sha256")
  .update(BRIDGE_DISCLOSURE_ENGLISH_TEXT)
  .digest("hex")
  .slice(0, 10);

const DEFAULT_CACHE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "cache",
  "bridge-disclosure"
);

function cacheFilePath(cacheDir, languageCode) {
  return path.join(cacheDir, `${languageCode}.${DISCLOSURE_TEXT_HASH}.pcm`);
}

function textCacheFilePath(cacheDir, languageCode) {
  return path.join(cacheDir, `${languageCode}.${DISCLOSURE_TEXT_HASH}.json`);
}

// Where a language's clip lives on disk — exported so tests and manual QA
// tools can locate (or hand-delete) files without duplicating the naming
// scheme. Old-format un-hashed files are simply never read again; delete them
// manually if the orphaned bytes bother you.
export function disclosureCachePaths(languageCode, cacheDir = DEFAULT_CACHE_DIR) {
  const code = String(languageCode).toLowerCase();
  return { pcmPath: cacheFilePath(cacheDir, code), textPath: textCacheFilePath(cacheDir, code) };
}

async function readFromDisk(cacheDir, languageCode) {
  try {
    const buffer = await fs.readFile(cacheFilePath(cacheDir, languageCode));
    return buffer.length > 0 ? buffer.toString("base64") : undefined;
  } catch {
    return undefined;
  }
}

// Text sidecar alongside the cached clip — not read by the worker (which
// only ever needs the audio), but the only reliable way to know exactly
// what a cached clip actually says, since translation isn't perfectly
// deterministic: two independent translateDisclosureText calls for the same
// language can legitimately return different wording. Manual QA
// (scripts/generate-bridge-disclosure-audio.mjs) reads this back instead of
// re-translating, so the text it prints always matches the audio it wrote.
export async function readCachedDisclosureText(languageCode, cacheDir = DEFAULT_CACHE_DIR, englishText = BRIDGE_DISCLOSURE_ENGLISH_TEXT) {
  if (englishText !== BRIDGE_DISCLOSURE_ENGLISH_TEXT) {
    cacheDir = path.join(cacheDir, createHash("sha256").update(englishText).digest("hex").slice(0, 10));
  }
  try {
    const raw = await fs.readFile(disclosureCachePaths(languageCode, cacheDir).textPath);
    return JSON.parse(raw.toString("utf8")).text;
  } catch {
    return undefined;
  }
}

async function writeToDisk(cacheDir, languageCode, base64Pcm, text) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFilePath(cacheDir, languageCode), Buffer.from(base64Pcm, "base64"));
  await fs.writeFile(
    textCacheFilePath(cacheDir, languageCode),
    JSON.stringify({ text, generatedAt: new Date().toISOString() }, null, 2)
  );
}

export async function translateDisclosureText({ config, languageCode, fetchImpl = fetch, englishText = BRIDGE_DISCLOSURE_ENGLISH_TEXT }) {
  if (languageCode === "en") return englishText;

  const languageName = getLanguageName(languageCode);
  const prompt = [
    "Translate the following short phone-call disclosure message faithfully.",
    "It is a few sentences long; translate all of them.",
    `Target language: ${languageName} (ISO code: ${languageCode}).`,
    "Return only the translated text: no commentary, no quotation marks, no explanation.",
    "It will be spoken aloud during a phone call, so keep it natural to say, not literal/awkward.",
    "Do not add or omit meaning.",
    "",
    "Message to translate:",
    englishText,
  ].join("\n");

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.liveTranslationTextModel,
      input: prompt,
      // Headroom for the multi-sentence source and token-heavy target scripts
      // (ja/ko/zh/ar/hi): a silently truncated translation would become an
      // audibly incomplete disclosure, so over-provision rather than squeeze.
      max_output_tokens: 400,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI disclosure translation request failed: ${response.status}`);
  }
  const text = extractResponseText(await response.json()).trim();
  if (!text) {
    throw new Error(`OpenAI disclosure translation returned empty text for ${languageCode}`);
  }
  return text;
}

// Returns base64-encoded PCM s16le 24kHz mono — response_format: "pcm" on
// this endpoint returns exactly that, headerless, so no ffmpeg/codec step is
// needed before this can be queued straight into the bridge's translated-
// audio mixer (encodePcm24Base64ToMuLawBase64 in realtime-media-worker-core.mjs
// expects the same format for Palabra output).
// gpt-4o-mini-tts occasionally returns an audibly truncated clip for the
// exact same input on some calls — confirmed 2026-08-13: two consecutive
// real requests for the identical Portuguese disclosure sentence returned
// 9.9s and 13.65s of audio, and a human listener confirmed the shorter one
// cut off mid-sentence. Neither a Content-Length header nor the WAV
// response's own header (declares the streaming "unknown length"
// placeholder, 0xFFFFFFFF, for this endpoint) give any server-side signal
// to detect this, so a plausibility floor on the audio's own duration
// relative to the input text length is the only check available.
// PCM_BYTES_PER_SECOND is fixed by the format this endpoint returns (24kHz,
// 16-bit, mono). MIN_CHARS_PER_SECOND is deliberately generous — real
// speech, and this endpoint's own complete responses (measured), speak
// well under that pace, so a clip faster than this is far more likely a
// cut-off response than genuinely fast delivery.
const MIN_CHARS_PER_SECOND = 14;
const PCM_BYTES_PER_SECOND = 48000;
// Kept small deliberately: this whole call is awaited before a bridge
// callee leg finishes handleStart (see primeBridgeDisclosureAudio in
// realtime-media-worker-core.mjs). A live 2026-08-13 test call showed the
// browser leg can disconnect for unrelated reasons while this is still in
// flight; every extra attempt widens that race window, so retry sparingly
// rather than exhaustively.
const MAX_SYNTHESIS_ATTEMPTS = 2;

export function minExpectedPcmBytesForText(text) {
  const minSeconds = text.trim().length / MIN_CHARS_PER_SECOND;
  return Math.round(minSeconds * PCM_BYTES_PER_SECOND);
}

async function requestDisclosureSpeech({ config, text, fetchImpl }) {
  const response = await fetchImpl(OPENAI_SPEECH_URL, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      response_format: "pcm",
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI disclosure speech request failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesizeDisclosureAudio({ config, text, fetchImpl = fetch }) {
  const minBytes = minExpectedPcmBytesForText(text);
  let longest = Buffer.alloc(0);
  for (let attempt = 1; attempt <= MAX_SYNTHESIS_ATTEMPTS; attempt += 1) {
    const pcm = await requestDisclosureSpeech({ config, text, fetchImpl });
    if (pcm.length > longest.length) longest = pcm;
    if (pcm.length >= minBytes) {
      return pcm.toString("base64");
    }
  }
  if (longest.length === 0) {
    throw new Error(`OpenAI disclosure speech returned empty audio for "${text.slice(0, 40)}..."`);
  }
  // Every attempt looked shorter than expected, but a probably-truncated
  // disclosure is still far better than none. The caller
  // (primeBridgeDisclosureAudio) never lets a disclosure problem end the
  // underlying phone call — a 2026-08-13 live test call showed throwing
  // here cascades through sibling teardown and kills the whole bridge call
  // for both real participants, which is a strictly worse outcome than
  // playing a clip that might be a little short.
  return longest.toString("base64");
}

const memoryCache = new Map();
const inFlight = new Map();

// In-memory -> disk -> generate-and-cache. One in-flight promise per
// language so two calls racing to be "the first" for a language never
// trigger two parallel translate+synthesize round trips.
export async function defaultGetOrGenerateDisclosureAudio({
  config,
  languageCode,
  fetchImpl = fetch,
  cacheDir = DEFAULT_CACHE_DIR,
  englishText = BRIDGE_DISCLOSURE_ENGLISH_TEXT,
  onText,
}) {
  const code = String(languageCode || "en").toLowerCase();
  const textHash = createHash("sha256").update(englishText).digest("hex").slice(0, 10);
  if (englishText !== BRIDGE_DISCLOSURE_ENGLISH_TEXT) cacheDir = path.join(cacheDir, textHash);
  const key = `${cacheDir}:${code}:${textHash}`;
  const withText = async (audio) => {
    if (onText) onText(await readCachedDisclosureText(code, cacheDir));
    return audio;
  };

  if (memoryCache.has(key)) return withText(memoryCache.get(key));
  if (inFlight.has(key)) return withText(await inFlight.get(key));

  const promise = (async () => {
    const cached = await readFromDisk(cacheDir, code);
    if (cached) {
      memoryCache.set(key, cached);
      return cached;
    }
    const text = await translateDisclosureText({ config, languageCode: code, fetchImpl, englishText });
    const base64Pcm = await synthesizeDisclosureAudio({ config, text, fetchImpl });
    await writeToDisk(cacheDir, code, base64Pcm, text).catch(() => {
      // Disk cache is best-effort: a write failure (e.g. read-only
      // filesystem) still leaves the in-memory cache warm for this process's
      // lifetime, and the next process regenerates once, transparently.
    });
    memoryCache.set(key, base64Pcm);
    return base64Pcm;
  })();

  inFlight.set(key, promise);
  try {
    return await withText(await promise);
  } finally {
    inFlight.delete(key);
  }
}

// Test-only: the module-level caches must not leak generated/faked audio
// across independent fixture-test runs in the same process.
export function clearDisclosureAudioCacheForTests() {
  memoryCache.clear();
  inFlight.clear();
}

export class BridgeIntroduction {
  constructor(callee) {
    this.callee = callee;
    this.phase = "pending";
    this.generation = randomUUID();
    this.playback = new Map();
    this.failureClips = new Map();
    this.deadline = Date.now() + BRIDGE_INTRODUCTION_TIMEOUT_MS;
    this.callee.reportDisclosureState("pending");
    this.timer = setInterval(() => {
      try { this.tick(); } catch { this.fail("playback_error"); }
    }, 20);
    this.timer.unref?.();
  }

  get legs() {
    return [this.callee, this.callee.siblingLeg].filter(Boolean);
  }

  async loadClip(languageCode, englishText) {
    let text;
    const audio = await this.callee.disclosureAudioProvider({
      config: this.callee.config,
      languageCode,
      englishText,
      onText: (value) => { text = value; },
    });
    const pcm = Buffer.from(audio || "", "base64");
    if (!pcm.length || pcm.length % 2 || pcm.length > 45 * 48000) {
      throw new Error("Invalid introduction audio.");
    }
    return { pcm, text: text || (languageCode === "en" ? englishText : undefined) };
  }

  async prepare() {
    const languages = [this.callee.sourceLanguage, this.callee.targetLanguage];
    for (const language of new Set(languages)) {
      void this.loadClip(language, BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT)
        .then((clip) => { if (!this.stopped) this.failureClips.set(language, clip); })
        .catch(() => {});
    }
    try {
      const [disclosure, ...cues] = await Promise.all([
        this.loadClip(languages[0], BRIDGE_DISCLOSURE_ENGLISH_TEXT),
        ...languages.map((language) => this.loadClip(language, BRIDGE_GO_AHEAD_ENGLISH_TEXT)),
      ]);
      if (this.stopped || this.phase !== "pending") return;
      this.disclosure = disclosure;
      this.cues = new Map(languages.map((language, index) => [language, cues[index]]));
    } catch {
      this.fail("audio_unavailable");
    }
  }

  beginPlayback(phase, clips) {
    this.phase = phase;
    this.callee.reportDisclosureState(phase);
    const length = Math.max(...clips.map((clip) => clip.pcm.length));
    this.playback.clear();
    this.legs.forEach((leg, index) => {
      const clip = clips[index];
      const pcm = Buffer.concat([Buffer.alloc(length - clip.pcm.length), clip.pcm]);
      this.playback.set(leg, { pcm, text: clip.text, offset: 0, acknowledged: false });
      leg.bridgeTranslatedQueue = [];
      leg.bridgeTranslatedQueuedBytes = 0;
      leg.preReadyFrames.translation = [];
      leg.palabraChunkFrames = [];
    });
  }

  tick(now = Date.now(), frameBytes = 960) {
    if (this.stopped) return;
    if (this.legs.some((leg) => leg.ended)) {
      this.stop();
      void this.callee.closeBridgeForSafety("bridge_introduction_interrupted");
      return;
    }
    if (now >= this.deadline) {
      if (this.phase === "failed") this.finishFailure();
      else this.fail("startup_timeout");
      return;
    }
    if (this.phase === "pending" && this.disclosure && this.legs.length === 2) {
      this.beginPlayback("playing", this.legs.map(() => this.disclosure));
    }
    this.advance();
    if (this.stopped) return;
    for (const leg of this.legs) {
      if (leg.palabraReady && !leg.translationSessionFinished && now - (leg.lastBridgeInputAt ?? leg.startedAt) >= 1000) {
        leg.sendPalabraAudioFrame(Buffer.alloc(960).toString("base64"));
      }
    }
    for (const [leg, playback] of this.playback) {
      if (playback.offset >= playback.pcm.length) continue;
      const frame = playback.pcm.subarray(playback.offset, playback.offset + frameBytes);
      leg.sendBridgeStartupAudio(frame);
      leg.syntheticAudioUntil = now + 500;
      if (playback.text && (playback.offset === 0 || playback.offset + frame.length === playback.pcm.length)) {
        leg.noteInjectedTranslationText(playback.text);
      }
      playback.offset += frame.length;
      if (playback.offset === playback.pcm.length) {
        playback.mark = `${this.generation}:${this.phase}:${leg.legRole}`;
        leg.sendMarkToTwilio(playback.mark);
      }
    }
  }

  acknowledge(leg, event) {
    if (this.stopped || event.streamSid !== leg.streamSid) return;
    if (Date.now() >= this.deadline) { this.tick(); return; }
    const playback = this.playback.get(leg);
    if (!playback?.mark || event.mark?.name !== playback.mark || playback.acknowledged) return;
    playback.acknowledged = true;
    leg.syntheticAudioUntil = Date.now() + 500;
    if (playback.text) leg.noteInjectedTranslationText(playback.text);
    this.advance();
  }

  advance() {
    if (this.stopped || !this.playback.size ||
      [...this.playback.values()].some((playback) => !playback.acknowledged)) return;
    if (this.phase === "failed") {
      this.finishFailure();
    } else if (this.phase === "playing") {
      if (this.legs.length !== 2 || this.legs.some((leg) => !leg.palabraReady || leg.translationSessionFinished)) return;
      this.beginPlayback("readying", this.legs.map((leg) => this.cues.get(leg.sourceLanguage)));
    } else if (this.phase === "readying") {
      if (this.legs.some((leg) => !leg.palabraReady || leg.translationSessionFinished)) {
        this.fail("translation_unavailable");
        return;
      }
      for (const leg of this.legs) {
        leg.disclosureGateOpen = true;
        leg.bridgeConversationOpen = true;
        leg.preReadyFrames.translation = [];
        leg.palabraChunkFrames = [];
      }
      this.phase = "done";
      this.callee.reportDisclosureState("done");
      this.stop();
    }
  }

  fail(reason) {
    if (this.stopped || this.phase === "failed") return;
    this.phase = "failed";
    this.playback.clear();
    this.callee.reportDisclosureState("failed");
    this.callee.logger("error", "bridge_introduction_failed", { reason });
    this.deadline = Date.now() + 8000;
    try {
      for (const leg of this.legs) {
        leg.bridgeConversationOpen = false;
        leg.sendClearToTwilio();
        const clip = this.failureClips.get(leg.sourceLanguage);
        if (clip) this.playback.set(leg, { ...clip, offset: 0, acknowledged: false });
      }
    } catch {
      this.finishFailure();
      return;
    }
    if (!this.playback.size) this.finishFailure();
  }

  finishFailure() {
    this.stop();
    void this.callee.closeBridgeForSafety("bridge_introduction_failed");
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.playback.clear();
    this.failureClips.clear();
    this.disclosure = undefined;
    this.cues = undefined;
  }
}
