"use client";

import { loadPostHog } from "@/lib/posthog-client";

export type ProductAnalyticsEvent =
  | "signup_completed"
  | "checkout_started"
  | "subscription_completed"
  | "call_started"
  | "call_completed"
  | "free_call_trial_started"
  | "call_memory_opened"
  | "call_memory_reviewed"
  | "feedback_request_created"
  | "feedback_workspace_vote_toggled"
  | "seat_limit_reached"
  | "translation_landing_view"
  | "translation_language_pair_selected"
  | "translated_call_started"
  | "translated_call_connected"
  | "translation_successfully_heard"
  | "translation_guidance_shown"
  | "translated_call_record_created"
  | "first_paid_translated_call"
  | "repeat_translated_usage";

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

const SAFE_PROPERTY_KEYS = new Set([
  "area",
  "callMode",
  "companyType",
  "destination",
  "enabled",
  "environment",
  "feature",
  "feedbackCategory",
  "hasContact",
  "hasLiveCopilot",
  "hasTranslatedCaptions",
  "hasVoiceTranslation",
  "isFreeCall",
  "maxSeconds",
  "planId",
  "result",
  "roleSegment",
  "sourceLanguage",
  "seatLimit",
  "route",
  "source",
  "status",
  "targetLanguage",
  "subscriptionStatus",
  "view",
  "workflowTemplateKey",
  "workspaceId",
  "useCase",
]);

export function isPostHogConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

function safeAnalyticsProperties(properties: AnalyticsProperties = {}) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      return SAFE_PROPERTY_KEYS.has(key) && value !== undefined;
    })
  );
}

// Sends every product event to PostHog under the whitelisted property set.
export function captureProductEvent(
  event: ProductAnalyticsEvent,
  properties: AnalyticsProperties = {}
) {
  if (typeof window === "undefined") return;
  const safeProperties = safeAnalyticsProperties(properties);

  if (isPostHogConfigured()) {
    void loadPostHog().then((posthog) => posthog.capture(event, safeProperties));
  }
}
