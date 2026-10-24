"use client";

import { useEffect } from "react";
import { isPostHogConfigured } from "@/lib/analytics";
import { loadPostHog } from "@/lib/posthog-client";
import { fetchSessionState, hasSignedInHint } from "@/lib/session-state";

// Public pages have no Convex provider, so a live session is identified to
// PostHog here instead of by the in-app bridge. Anonymous visitors get no
// request and no reset — resetting them split sessions before.
export function SessionIdentityBridge() {
  useEffect(() => {
    if (!isPostHogConfigured() || !hasSignedInHint()) return;
    let cancelled = false;
    void loadPostHog().then((posthog) => {
      void fetchSessionState().then((session) => {
        if (cancelled || !session?.identity) return;
        posthog.identify(session.identity.profileId, {
          workspaceId: session.identity.workspaceId,
          planId: session.identity.planId,
          subscriptionStatus: session.identity.subscriptionStatus,
          environment: process.env.NODE_ENV,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
