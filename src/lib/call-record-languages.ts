import { PALABRA_LANGUAGE_CATALOG, LEGACY_LANGUAGE_CODES } from "../../scripts/translation-language-catalog.mjs";
import { publicExpandedLanguagesEnabled } from "./live-translation-languages";

export const CALL_RECORD_LANGUAGE_AUTO = "auto";
export const DEFAULT_CALL_RECORD_LANGUAGE = "en";

// Output preferences are independent of any realtime provider's target restrictions.
export const CALL_RECORD_LANGUAGES = PALABRA_LANGUAGE_CATALOG.filter(({ code }) =>
  LEGACY_LANGUAGE_CODES.includes(code) || publicExpandedLanguagesEnabled()
);
export type CallRecordLanguageCode = (typeof CALL_RECORD_LANGUAGES)[number]["code"];

const LANGUAGE_LABEL_BY_CODE = new Map<string, string>(
  PALABRA_LANGUAGE_CATALOG.map((language) => [language.code, language.label])
);
const LANGUAGE_CODE_BY_NAME = new Map<string, CallRecordLanguageCode>(
  PALABRA_LANGUAGE_CATALOG.flatMap((language) => [
    [language.code, language.code] as const,
    [language.label.toLowerCase(), language.code] as const,
  ])
);

export function normalizeCallRecordLanguage(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === CALL_RECORD_LANGUAGE_AUTO) return undefined;
  return LANGUAGE_CODE_BY_NAME.get(normalized);
}

export function assertCallRecordLanguagePreference(value?: string | null) {
  const normalized = value?.trim().toLowerCase() || CALL_RECORD_LANGUAGE_AUTO;
  if (normalized === CALL_RECORD_LANGUAGE_AUTO) return normalized;
  const language = normalizeCallRecordLanguage(normalized);
  const expanded = process.env.PALABRA_EXPANDED_LANGUAGES_ENABLED === "true";
  if (!language || (!expanded && !LEGACY_LANGUAGE_CODES.includes(language))) {
    throw new Error("Choose a supported call record language.");
  }
  return language;
}

export function getCallRecordLanguageLabel(value?: string | null) {
  if (!value || value === CALL_RECORD_LANGUAGE_AUTO) return "Auto — detect my spoken language";
  return LANGUAGE_LABEL_BY_CODE.get(value.toLowerCase()) ?? value;
}

