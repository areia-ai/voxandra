export const TRANSLATED_TRIAL_SECONDS = 90;

export function translatedTrialEnabled() {
  return process.env.TRANSLATED_TRIAL_ENABLED === "true";
}

export function publicTranslatedTrialEnabled() {
  return process.env.NEXT_PUBLIC_TRANSLATED_TRIAL_ENABLED === "true";
}

export function freeTrialLabel() {
  return publicTranslatedTrialEnabled() ? "free 90-second translated call" : "free 90-second standard call";
}
