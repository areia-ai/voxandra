"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { captureProductEvent } from "@/lib/analytics";

const MAX_RETRIES = 5;

export function useEnsureProfile() {
  const { signOut } = useAuthActions();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const profile = useQuery(api.profiles.getMyProfile);
  const workspace = useQuery(api.profiles.getMyWorkspace);
  const createProfile = useMutation(api.profiles.createProfileAndWorkspace);
  const syncProfileIdentity = useMutation(api.profiles.syncMyProfileIdentity);
  const creatingRef = useRef(false);
  const syncedProfileIdRef = useRef<string | null>(null);
  const [authErrorCount, setAuthErrorCount] = useState(0);

  useEffect(() => {
    // Stop retrying after max retries - user should refresh or sign out/in
    if (authErrorCount >= MAX_RETRIES) {
      return;
    }

    if (
      !isAuthLoading &&
      isAuthenticated &&
      profile !== undefined &&
      workspace === null &&
      !creatingRef.current
    ) {
      creatingRef.current = true;

      // Delay slightly to allow OAuth token to propagate after redirect
      // OAuth redirects need extra time for token exchange
      const delay =
        authErrorCount > 0
          ? Math.min(1000 * Math.pow(2, authErrorCount), 10000)
          : 1200;

      const timer = setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        const paidCheckoutPending =
          params.has("claimCheckout") && params.has("claimToken");

        createProfile({ paidCheckoutPending })
          .then((result) => {
            if (result?.authPending) {
              creatingRef.current = false;
              setAuthErrorCount((prev) => Math.min(prev + 1, MAX_RETRIES));
              return;
            }
            creatingRef.current = false;
            setAuthErrorCount(0);
            captureProductEvent("signup_completed", { source: "profile_setup" });
          })
          .catch((err: Error) => {
            creatingRef.current = false;

            // If auth isn't ready yet, retry with exponential backoff
            if (err.message?.includes("Not authenticated")) {
              setAuthErrorCount((prev) => Math.min(prev + 1, MAX_RETRIES));
            }
          });
      }, delay);

      return () => clearTimeout(timer);
    }
  }, [
    isAuthLoading,
    isAuthenticated,
    profile,
    workspace,
    createProfile,
    authErrorCount,
  ]);

  useEffect(() => {
    if (
      isAuthLoading ||
      !isAuthenticated ||
      !profile ||
      syncedProfileIdRef.current === profile._id
    ) {
      return;
    }

    const hasEmail = Boolean(profile.email.trim());
    const hasDisplayName = Boolean(profile.displayName?.trim());
    if (hasEmail && hasDisplayName) {
      return;
    }

    syncedProfileIdRef.current = profile._id;
    void syncProfileIdentity().catch(() => {
      // Profile identity sync is opportunistic; the account remains usable.
    });
  }, [isAuthLoading, isAuthenticated, profile, syncProfileIdentity]);

  // isReady: auth loading done and profile query has resolved
  const isReady = !isAuthLoading && profile !== undefined && workspace !== undefined;
  const hasWorkspace = workspace !== null;
  const isAuthError = authErrorCount > 3; // Show error after multiple retries

  return { profile, workspace, signOut, isReady, hasWorkspace, isAuthError };
}
