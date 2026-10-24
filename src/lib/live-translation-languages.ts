import {
  PALABRA_LANGUAGE_CATALOG,
  LEGACY_LANGUAGE_CODES,
  LEGACY_TRANSLATION_TARGET_CODES,
  getVoiceTranslationLanguages,
} from "../../scripts/translation-language-catalog.mjs";

export const LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE = "auto";
export const DEFAULT_LIVE_TRANSLATION_TARGET_LANGUAGE = "en";

// Legacy caption-provider support must not grow when Palabra adds languages.
export const LIVE_TRANSLATION_LANGUAGES = PALABRA_LANGUAGE_CATALOG.filter(
  ({ code }) => LEGACY_LANGUAGE_CODES.includes(code)
);
const LIVE_TRANSLATION_TARGET_LANGUAGE_CODES = new Set(LEGACY_TRANSLATION_TARGET_CODES);
export const LIVE_TRANSLATION_TARGET_LANGUAGES = LIVE_TRANSLATION_LANGUAGES.filter(
  ({ code }) => LIVE_TRANSLATION_TARGET_LANGUAGE_CODES.has(code)
);

// Build-time public switch is enabled only after coordinated worker/backend acceptance.
export function publicExpandedLanguagesEnabled() {
  return process.env.NEXT_PUBLIC_PALABRA_EXPANDED_LANGUAGES_ENABLED === "true";
}
export function getPublicVoiceTranslationLanguages(recipient = false) {
  return getVoiceTranslationLanguages({ expanded: publicExpandedLanguagesEnabled(), recipient });
}
export function getPublicVoiceTranslationLanguageNames() {
  return getPublicVoiceTranslationLanguages().map(({ label }) => label).join(", ");
}

export type LiveTranslationLanguageCode = (typeof LIVE_TRANSLATION_LANGUAGES)[number]["code"];

const LIVE_TRANSLATION_LANGUAGE_LABELS = new Map<string, string>(
  PALABRA_LANGUAGE_CATALOG.map((language) => [language.code, language.label])
);

function compactLanguageCode(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function isSupportedLiveTranslationLanguage(
  value?: string | null
): value is LiveTranslationLanguageCode {
  return LEGACY_LANGUAGE_CODES.includes(compactLanguageCode(value));
}

export function normalizeLiveTranslationSourceLanguage(value?: string | null) {
  const code = compactLanguageCode(value);
  if (!code || code === LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE) {
    return undefined;
  }
  if (!isSupportedLiveTranslationLanguage(code)) {
    throw new Error("Choose a supported language for the other person.");
  }
  return code;
}

export function normalizeLiveTranslationTargetLanguage(value?: string | null) {
  const code = compactLanguageCode(value);
  if (!code) {
    throw new Error("Choose a language to translate into.");
  }
  if (code === LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE) {
    throw new Error("Detect language is only available for the other person's language.");
  }
  if (
    !isSupportedLiveTranslationLanguage(code) ||
    !LIVE_TRANSLATION_TARGET_LANGUAGE_CODES.has(code)
  ) {
    throw new Error("Choose a supported language to translate into.");
  }
  return code;
}

export function assertLiveTranslationLanguageDirection(args: {
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  mode?: "legacy" | "voice";
  expandedLanguages?: boolean;
}) {
  if (args.mode === "voice") {
    const sourceLanguage = compactLanguageCode(args.sourceLanguage);
    const targetLanguage = compactLanguageCode(args.targetLanguage);
    const sourceChoices = getVoiceTranslationLanguages({ expanded: args.expandedLanguages, recipient: true });
    const targetChoices = getVoiceTranslationLanguages({ expanded: args.expandedLanguages });
    if (!sourceChoices.some(({ code }) => code === sourceLanguage) ||
        !targetChoices.some(({ code }) => code === targetLanguage)) {
      throw new Error("Choose two supported languages for Voice Translation.");
    }
    if (sourceLanguage === targetLanguage) throw new Error("Choose two different languages for Live Translation.");
    return { sourceLanguage, targetLanguage };
  }
  const sourceLanguage = normalizeLiveTranslationSourceLanguage(args.sourceLanguage);
  const targetLanguage = normalizeLiveTranslationTargetLanguage(args.targetLanguage);

  if (sourceLanguage && sourceLanguage === targetLanguage) {
    throw new Error("Choose two different languages for Live Translation.");
  }

  return { sourceLanguage, targetLanguage };
}

export function getLiveTranslationLanguageLabel(value?: string | null) {
  const code = compactLanguageCode(value);
  if (!code || code === LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE) {
    return "Detect language";
  }
  return LIVE_TRANSLATION_LANGUAGE_LABELS.get(code) ?? code;
}
