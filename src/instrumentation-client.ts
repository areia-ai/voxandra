import { loadPostHog } from "@/lib/posthog-client";

if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  void loadPostHog();
}
