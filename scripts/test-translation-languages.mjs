import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { PALABRA_LANGUAGE_CATALOG, getVoiceTranslationLanguages, getPalabraLanguageCode } from "./translation-language-catalog.mjs";
import { buildPalabraTask } from "./realtime-media-worker-core.mjs";
import { translateDisclosureText, BRIDGE_DISCLOSURE_ENGLISH_TEXT, BRIDGE_GO_AHEAD_ENGLISH_TEXT, BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT, BRIDGE_INACTIVITY_WARNING_ENGLISH_TEXT } from "./realtime-media-worker-disclosures.mjs";

const env = {};
const bundle = await build({
  stdin: { contents: `export * from './src/lib/live-translation-languages'; export * from './src/lib/call-record-languages'; export { GET as homeMarkdown } from './src/app/markdown/home/route'; export { GET as translationMarkdown } from './src/app/markdown/live-voice-translation/route'; export { faqItems } from './src/components/landing/faq-data'; export { buildExtractionPrompt } from './src/lib/ai/extraction-prompt';`, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
});
function load() {
  const testModule = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, { module: testModule, exports: testModule.exports, require: createRequire(import.meta.url), process: { env, cwd: () => process.cwd() } });
  return testModule.exports;
}
let api = load();
assert.equal(PALABRA_LANGUAGE_CATALOG.length, 48);
assert.equal(new Set(PALABRA_LANGUAGE_CATALOG.map(x => x.code)).size, 48, 'regional variants must not inflate the catalog');
assert.equal(api.LIVE_TRANSLATION_LANGUAGES.length, 18);
assert.equal(api.LIVE_TRANSLATION_TARGET_LANGUAGES.length, 13);
assert.equal(api.getPublicVoiceTranslationLanguages().length, 13);
assert.equal(api.getPublicVoiceTranslationLanguages(true).length, 18, 'preserve existing recipient choices before expansion');
assert.equal(api.CALL_RECORD_LANGUAGES.length, 18, 'preserve existing record preferences');
assert.ok((await (await api.homeMarkdown()).text()).includes('English, Spanish'));
assert.ok(!(await (await api.homeMarkdown()).text()).includes('{{VOICE_TRANSLATION_LANGUAGES}}'));
assert.ok(api.faqItems.find(x => x.id === 'after-cta').answer.includes('standard call'));
assert.throws(() => api.assertCallRecordLanguagePreference('he'));
assert.equal(api.normalizeCallRecordLanguage('Hebrew'), 'he', 'read historical expanded records even after rollback');
assert.equal(api.assertCallRecordLanguagePreference('Dutch'), 'nl');
assert.equal(api.assertCallRecordLanguagePreference('auto'), 'auto');
assert.throws(() => api.assertLiveTranslationLanguageDirection({ sourceLanguage: 'he', targetLanguage: 'en', mode: 'voice' }));
assert.throws(() => getPalabraLanguageCode('he', 'speech'));
assert.equal(getPalabraLanguageCode('zh', 'speech'), 'zh', 'preserve deployed Chinese alias in default mode');
assert.equal(getPalabraLanguageCode('zh', 'speech', true), 'zh-hans');
assert.equal(getPalabraLanguageCode('zh', 'recognition', true), 'zh');
for (const code of ['auto', '', 'az', 'bn', 'yue', 'is', 'fa', 'xx', 'zh-hant']) {
  assert.throws(() => api.assertLiveTranslationLanguageDirection({ sourceLanguage: code, targetLanguage: 'en', mode: 'voice', expandedLanguages: true }), code);
  assert.throws(() => api.assertLiveTranslationLanguageDirection({ sourceLanguage: 'en', targetLanguage: code, mode: 'voice', expandedLanguages: true }), code);
}
for (const source of PALABRA_LANGUAGE_CATALOG) {
  for (const target of PALABRA_LANGUAGE_CATALOG) {
    const args = { sourceLanguage: source.code, targetLanguage: target.code, mode: 'voice', expandedLanguages: true };
    if (source.code === target.code) { assert.throws(() => api.assertLiveTranslationLanguageDirection(args)); continue; }
    const pair = api.assertLiveTranslationLanguageDirection(args);
    assert.equal(pair.sourceLanguage, source.code); assert.equal(pair.targetLanguage, target.code);
    const task = buildPalabraTask(pair.sourceLanguage, pair.targetLanguage, 24000, 'female', { expandedLanguages: true });
    assert.equal(task.pipeline.transcription.source_language, source.recognitionCode);
    assert.equal(task.pipeline.translations[0].target_language, target.speechCode);
    assert.equal(task.pipeline.translations[0].speech_generation.voice_cloning, false);
  }
  // Each system utterance must identify the language correctly. No paid requests.
  for (const englishText of [BRIDGE_DISCLOSURE_ENGLISH_TEXT, BRIDGE_GO_AHEAD_ENGLISH_TEXT, BRIDGE_STARTUP_FAILURE_ENGLISH_TEXT, BRIDGE_INACTIVITY_WARNING_ENGLISH_TEXT]) {
    const result = await translateDisclosureText({ config: { openaiApiKey: 'offline', liveTranslationTextModel: 'offline' }, languageCode: source.code, englishText,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.ok(body.input.includes(source.label)); assert.ok(body.input.includes(englishText));
        return { ok: true, json: async () => ({ output_text: `mock-${source.code}` }) };
      } });
    assert.equal(result, source.code === 'en' ? englishText : `mock-${source.code}`);
  }
}
Object.assign(env, { NEXT_PUBLIC_PALABRA_EXPANDED_LANGUAGES_ENABLED: 'true', PALABRA_EXPANDED_LANGUAGES_ENABLED: 'true' });
env.NEXT_PUBLIC_TRANSLATED_TRIAL_ENABLED = 'true';
api = load();
const expandedMarkdown = await (await api.homeMarkdown()).text();
assert.ok(expandedMarkdown.includes('Welsh') && expandedMarkdown.includes('Hebrew'));
assert.ok(expandedMarkdown.includes('one free 90-second translated call'));
assert.ok(!expandedMarkdown.includes('{{VOICE_TRANSLATION_LANGUAGES}}'));
assert.ok((await (await api.translationMarkdown()).text()).includes('Welsh'));
assert.ok(api.faqItems.find(x => x.id === 'after-cta').answer.includes('Live Guidance is not included'));
assert.equal(api.getPublicVoiceTranslationLanguages().length, 48);
assert.deepEqual(api.getPublicVoiceTranslationLanguages(), api.getPublicVoiceTranslationLanguages(true));
assert.equal(api.CALL_RECORD_LANGUAGES.length, 48);
assert.equal(api.assertCallRecordLanguagePreference('Hebrew'), 'he');
for (const language of PALABRA_LANGUAGE_CATALOG) {
  const prompt = api.buildExtractionPrompt({ transcriptText: 'בדיקת תשלום – 支払確認', callRecordLanguage: language.code, cases: [], contacts: [] });
  assert.ok(prompt.taskInstructions.includes(`"callRecordLanguage": "${language.code}"`), "extraction receives the exact saved language code");
  assert.ok(JSON.stringify(prompt).includes('בדיקת תשלום – 支払確認'), 'multilingual evidence is preserved in extraction input');
}
assert.throws(() => api.assertLiveTranslationLanguageDirection({ sourceLanguage: 'en', targetLanguage: 'nl', mode: 'legacy', expandedLanguages: true }), 'Palabra expansion must not expand legacy OpenAI outputs');
assert.throws(() => api.assertLiveTranslationLanguageDirection({ sourceLanguage: 'he', targetLanguage: 'en', mode: 'legacy', expandedLanguages: true }));
assert.equal(api.assertLiveTranslationLanguageDirection({ sourceLanguage: 'auto', targetLanguage: 'en' }).targetLanguage, 'en');
assert.equal(getVoiceTranslationLanguages({ expanded: true }).length, 48);
console.log('Language catalog tests passed: 48 candidates, 2,256 directed pairs, rollout gates, provider mappings, record compatibility, and mocked system speech. No live audio tested.');
