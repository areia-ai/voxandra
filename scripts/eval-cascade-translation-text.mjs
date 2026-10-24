import { readFile } from "node:fs/promises";
import {
  buildWorkerConfig,
  defaultTranslationRequester,
} from "./realtime-media-worker-core.mjs";

const config = buildWorkerConfig(process.env);
if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required.");
const cases = JSON.parse(
  await readFile(new URL("./fixtures/live-translation-es-en.json", import.meta.url), "utf8")
);
const results = [];
let recentSourceUtterances = [];

for (const fixture of cases) {
  const translatedText = await defaultTranslationRequester({
    config,
    sourceText: fixture.source,
    sourceLanguage: "es",
    targetLanguage: "en",
    recentSourceUtterances,
    context: {},
  });
  recentSourceUtterances = [...recentSourceUtterances, fixture.source].slice(-3);
  const normalized = translatedText.toLowerCase();
  const missing = fixture.required.filter((value) => !normalized.includes(value));
  const forbidden = fixture.forbidden.filter((value) => normalized.includes(value));
  results.push({
    id: fixture.id,
    pass: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
    translatedText,
  });
}

const passed = results.filter((result) => result.pass).length;
console.log(JSON.stringify({ passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
