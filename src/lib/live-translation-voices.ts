export const TRANSLATED_VOICE_GENDERS = ["male", "female"] as const;

export type TranslatedVoiceGender = (typeof TRANSLATED_VOICE_GENDERS)[number];

// Palabra's documented default pipeline uses default_low. Keep male as the
// product default so old calls and omitted fields preserve production behavior.
export const DEFAULT_TRANSLATED_VOICE_GENDER: TranslatedVoiceGender = "male";

export function normalizeTranslatedVoiceGender(
  value: string | null | undefined
): TranslatedVoiceGender {
  return value === "female" ? "female" : DEFAULT_TRANSLATED_VOICE_GENDER;
}

export function palabraVoiceIdForGender(value: string | null | undefined) {
  return normalizeTranslatedVoiceGender(value) === "female"
    ? "default_high"
    : "default_low";
}
