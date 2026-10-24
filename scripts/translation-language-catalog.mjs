// Shared by the browser, Convex, and the standalone worker (copy this file with worker modules).
// Source: https://platform.palabra.ai/docs/speech-to-speech/supported-languages
// Reviewed 2026-10-04. Only languages with BOTH recognition and translated speech.
// Regional variants do not increase the count. Existing stored codes stay stable.
export const LEGACY_LANGUAGE_CODES = ["en", "es", "pt", "fr", "de", "it", "nl", "pl", "uk", "ru", "ar", "hi", "id", "vi", "ko", "ja", "zh", "tr"];
export const LEGACY_TRANSLATION_TARGET_CODES = ["en", "es", "pt", "fr", "de", "it", "ru", "hi", "id", "vi", "ko", "ja", "zh"];

const languageRows = [
  ["en", "English"], ["es", "Spanish"], ["pt", "Portuguese"], ["fr", "French"],
  ["de", "German"], ["it", "Italian"], ["nl", "Dutch"], ["pl", "Polish"],
  ["uk", "Ukrainian"], ["ru", "Russian"], ["ar", "Arabic"], ["hi", "Hindi"],
  ["id", "Indonesian"], ["vi", "Vietnamese"], ["ko", "Korean"], ["ja", "Japanese"],
  ["zh", "Chinese"], ["tr", "Turkish"],
  ["hy", "Armenian"], ["be", "Belarusian"], ["bg", "Bulgarian"], ["ca", "Catalan"],
  ["hr", "Croatian"], ["cs", "Czech"], ["da", "Danish"], ["et", "Estonian"],
  ["fil", "Filipino"], ["fi", "Finnish"], ["gl", "Galician"], ["el", "Greek"],
  ["he", "Hebrew"], ["hu", "Hungarian"], ["kk", "Kazakh"], ["lv", "Latvian"],
  ["lt", "Lithuanian"], ["mk", "Macedonian"], ["ms", "Malay"], ["no", "Norwegian"],
  ["ro", "Romanian"], ["sr", "Serbian"], ["sk", "Slovak"], ["sl", "Slovenian"],
  ["sw", "Swahili"], ["sv", "Swedish"], ["ta", "Tamil"], ["th", "Thai"],
  ["ur", "Urdu"], ["cy", "Welsh"],
];

export const PALABRA_LANGUAGE_CATALOG = languageRows.map(([code, label]) => ({
  code, label,
  recognitionCode: code,
  speechCode: code === "zh" ? "zh-hans" : code,
  // Provider docs are capability evidence, not a claim of live Voxandra acceptance.
  release: LEGACY_TRANSLATION_TARGET_CODES.includes(code) ? "existing" : "pending_validation",
}));

/** @param {{ expanded?: boolean, recipient?: boolean }} [options] */
export function getVoiceTranslationLanguages({ expanded = false, recipient = false } = {}) {
  if (expanded) return PALABRA_LANGUAGE_CATALOG;
  const codes = recipient ? LEGACY_LANGUAGE_CODES : LEGACY_TRANSLATION_TARGET_CODES;
  return PALABRA_LANGUAGE_CATALOG.filter(({ code }) => codes.includes(code));
}

/** @param {string} code */
export function getLanguageName(code) {
  return PALABRA_LANGUAGE_CATALOG.find((language) => language.code === code)?.label ?? code;
}

/** Map stable app codes at the provider boundary, never in persisted Call Records.
 * @param {string} code
 * @param {"recognition" | "speech"} direction
 * @param {boolean} [expanded]
 */
export function getPalabraLanguageCode(code, direction, expanded = false) {
  if (code === "auto" && direction === "recognition") return code;
  const language = PALABRA_LANGUAGE_CATALOG.find((item) => item.code === code);
  if (!language || (!expanded && !LEGACY_LANGUAGE_CODES.includes(code))) {
    throw new Error("Language is not enabled for voice translation.");
  }
  // Preserve the currently deployed Chinese alias until expanded-mode acceptance.
  if (code === "zh" && !expanded && direction === "speech") return "zh";
  return direction === "recognition" ? language.recognitionCode : language.speechCode;
}
