import type { PostHog } from "posthog-js";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

let loading: Promise<PostHog> | null = null;

// Single lazy chunk: the SDK is parsed after hydration instead of inside it,
// and every caller gets the same initialized instance.
export function loadPostHog(): Promise<PostHog> {
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    if (POSTHOG_KEY) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        ui_host: "https://eu.posthog.com",
        capture_pageview: "history_change",
        capture_pageleave: true,
        autocapture: false,
        disable_session_recording: true,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
      });
    }
    return posthog;
  });
  return loading;
}
