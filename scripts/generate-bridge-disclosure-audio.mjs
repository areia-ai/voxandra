#!/usr/bin/env node
// Manual pre-warm + listen tool for the bridge's spoken AI-translation
// disclosure (sub-phase 5c — see AGENTIC_FUTURE.md /
// REALTIME_WORKER_RUNBOOK.md). Runs the same translate+synthesize+cache path
// the worker uses at call time (realtime-media-worker-disclosures.mjs), then
// writes a playable .wav for each language so wording and voice quality can
// be reviewed by ear before a live bridge test call ever uses it for real.
//
// Usage:
//   OPENAI_API_KEY=... node scripts/generate-bridge-disclosure-audio.mjs es fr pt ja
//   OPENAI_API_KEY=... node scripts/generate-bridge-disclosure-audio.mjs --all
//
// Never part of `npm test` or CI — this hits the real OpenAI API and costs a
// fraction of a cent per language. A language already cached on disk
// (scripts/cache/bridge-disclosure/<lang>.<texthash>.pcm) is read, not
// regenerated; changing the English script in
// realtime-media-worker-disclosures.mjs auto-invalidates every cached clip.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_DISCLOSURE_ENGLISH_TEXT,
  BRIDGE_GO_AHEAD_ENGLISH_TEXT,
  BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT,
  BRIDGE_INACTIVITY_WARNING_ENGLISH_TEXT,
  defaultGetOrGenerateDisclosureAudio,
  readCachedDisclosureText,
} from "./realtime-media-worker-disclosures.mjs";

import { getVoiceTranslationLanguages } from "./translation-language-catalog.mjs";
const expanded = process.env.PALABRA_EXPANDED_LANGUAGES_ENABLED === "true";
const LAUNCH_LANGUAGES = getVoiceTranslationLanguages({ expanded }).map(({ code }) => code);
const requestedLanguages = process.argv.slice(2);
const languages = requestedLanguages.includes("--all") ? LAUNCH_LANGUAGES : requestedLanguages;
if (languages.some((code) => !getVoiceTranslationLanguages({ expanded, recipient: true }).some((language) => language.code === code))) {
  throw new Error("Requested language is not enabled. Review the language rollout before prewarming.");
}
if (languages.length === 0) {
  throw new Error(
    "Usage: OPENAI_API_KEY=... node scripts/generate-bridge-disclosure-audio.mjs --all | <lang> [lang...]"
  );
}
const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
  throw new Error("OPENAI_API_KEY is required.");
}

// Matches DEFAULT_CONFIG.liveTranslationTextModel in
// realtime-media-worker-core.mjs, overridable for A/B review of wording.
const config = {
  openaiApiKey,
  liveTranslationTextModel: process.env.OPENAI_DISCLOSURE_TEXT_MODEL || "gpt-5.6-luna",
};
const outDir = path.dirname(fileURLToPath(import.meta.url));

function wrapPcmAsWav(pcmBuffer, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

for (const languageCode of languages) {
  // Translate exactly once, inside this call — translation isn't perfectly
  // deterministic, so a second, separate translateDisclosureText call here
  // could legitimately return different wording than what was actually
  // synthesized. The text printed below is read back from the sidecar this
  // call writes, guaranteeing it matches the audio exactly.
  for (const [kind, englishText] of [
    ["disclosure", BRIDGE_DISCLOSURE_ENGLISH_TEXT],
    ["go-ahead", BRIDGE_GO_AHEAD_ENGLISH_TEXT],
    ["startup-failure", BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT],
    ["inactivity-warning", BRIDGE_INACTIVITY_WARNING_ENGLISH_TEXT],
  ]) {
    const base64Pcm = await defaultGetOrGenerateDisclosureAudio({ config, languageCode, englishText });
    const text = (await readCachedDisclosureText(languageCode, undefined, englishText)) || "(cached before this feature tracked text)";
    const pcm = Buffer.from(base64Pcm, "base64");
    const wavPath = path.join(outDir, `${kind}-${languageCode}.wav`);
    await writeFile(wavPath, wrapPcmAsWav(pcm));
    console.log(`${kind} ${languageCode}: "${text}"`);
    console.log(`  -> ${wavPath} (${pcm.length} bytes PCM, ${(pcm.length / 48000).toFixed(2)}s)`);
  }
}

console.log("\nListen with: afplay scripts/disclosure-<lang>.wav");
