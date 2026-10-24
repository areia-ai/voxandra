"use client";

import { useEffect } from "react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { isPostHogConfigured } from "@/lib/analytics";
import { loadPostHog } from "@/lib/posthog-client";

export function PostHogIdentityBridge() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const profile = useQuery(api.profiles.getMyProfile, isAuthenticated ? {} : "skip");
  const workspace = useQuery(api.profiles.getMyWorkspace, profile ? {} : "skip");
  const wallet = useQuery(api.walletSummaries.getWalletSummary, workspace ? {} : "skip");

  useEffect(() => {
    if (!isPostHogConfigured() || isLoading) return;

    if (!isAuthenticated) {
      void loadPostHog().then((posthog) => posthog.reset());
      return;
    }

    if (!profile || !workspace) return;

    void loadPostHog().then((posthog) =>
      posthog.identify(profile._id, {
        workspaceId: workspace._id,
        planId: wallet?.planId ?? workspace.plan ?? "free",
        subscriptionStatus: wallet?.subscriptionStatus ?? "free",
        environment: process.env.NODE_ENV,
      })
    );
  }, [isAuthenticated, isLoading, profile, wallet, workspace]);

  return null;
}
