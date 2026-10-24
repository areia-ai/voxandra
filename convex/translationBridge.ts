import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspace, requireWorkspaceMembership } from "./authHelpers";
import { isTerminalVoxandraCallStatus } from "../src/lib/twilio/bridge-lifecycle";
import { resolveLiveBridgeCalleePhase } from "../src/lib/live-bridge-state";
import { translatedTrialEnabled } from "../src/lib/translated-trial";

// What the caller should be told while a Voice Translation call is being set
// up. In bridge mode the browser leg is "answered" the instant its
// <Connect><Stream> starts, so the Twilio Device fires `accept` while the
// other person's phone is still ringing — without this the dialer says "In
// call" over what the caller experiences as silence for up to a minute
// (ringing, then the spoken disclosure). Reads only fields already written by
// the Twilio status callbacks and the worker.
export const getLiveBridgeState = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId || !call.bridgeModeRequested) return null;
    const translationDegraded = call.bridgeTranslationDegradedAt !== undefined;
    return {
      inactivityDeadlineAt: call.bridgeInactivityDeadlineAt ?? null,
      endReason: call.bridgeEndReason ?? null,
      calleePhase: resolveLiveBridgeCalleePhase({
        calleeStatus: call.bridgeCalleeStatus,
        disclosureState: call.bridgeDisclosureState,
        translationDegraded,
      }),
      calleeStatus: call.bridgeCalleeStatus ?? null,
      disclosureState: call.bridgeDisclosureState ?? null,
      translationDegraded,
    };
  },
});

// Real two-leg translation bridge (internal-only, single-workspace test,
// sub-phase 5a — see AGENTIC_FUTURE.md). The worker places a second, real
// Twilio call to the destination and injects translated audio into it, so
// the callee hears the Voxandra user's voice translated into their own
// language. Deliberately a SEPARATE allowlist from
// REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS (Spoken Translation
// Phase 1/3's listen-along mode) — placing a real second call is
// categorically riskier than listening in, and a bug here must never be
// able to touch the already-proven listen-along mode.

export const keepBridgeConnected = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { workspaceId, profile } = await requireWorkspaceMembership(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call?.bridgeModeRequested || call.workspaceId !== workspaceId || call.createdByProfileId !== profile._id) {
      throw new Error("Only the caller can keep this call connected.");
    }
    const now = Date.now();
    if (call.endedAt || call.bridgeEndReason || isTerminalVoxandraCallStatus(call.status) ||
      !call.bridgeInactivityDeadlineAt || now >= call.bridgeInactivityDeadlineAt) {
      throw new Error("This inactivity warning is no longer active.");
    }
    await ctx.db.patch(call._id, {
      bridgeKeepConnectedAt: now,
      bridgeLastActivityAt: now,
      bridgeInactivityDeadlineAt: undefined,
    });
    return { keptConnectedAt: now };
  },
});

function splitEnvList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// This is the ONLY allowlist gate for bridge mode. The worker deliberately has
// no mirror of it (see REALTIME_WORKER_RUNBOOK.md): it trusts the signed
// `bridgeLeg` stream parameter, which only exists once this check has already
// passed here. Do not describe this as a dual gate — the worker's independent
// check is the Palabra workspace allowlist, which is a different list for a
// different purpose. Empty by default.
export function isVoiceTranslationGloballyEnabled() {
  return process.env.REALTIME_VOICE_TRANSLATION_ENABLED === "true";
}

// Kept as a temporary compatibility path for private QA deployments while the
// global switch stays closed. Production GA uses the global switch, paid-plan
// entitlement, and the owner setting instead of a customer allowlist.
export function isWorkspaceOnBridgeAllowlist(workspaceId: string) {
  return (
    isVoiceTranslationGloballyEnabled() ||
    splitEnvList(process.env.REALTIME_TRANSLATION_BRIDGE_WORKSPACE_IDS).includes(workspaceId)
  );
}

export const getBridgeModeAvailability = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const [workspace, wallet] = await Promise.all([
      ctx.db.get(workspaceId),
      ctx.db
        .query("walletSummaries")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .first(),
    ]);
    const paidPlan = Boolean(
      wallet &&
        wallet.aiFeaturesEnabled !== false &&
        wallet.planId !== "free" &&
        wallet.planId !== "calls_only"
    );
    const trialEligible = translatedTrialEnabled() &&
      wallet?.planId === "free" && wallet.subscriptionStatus === "free" && !wallet.freeCallUsed;
    const globallyAvailable = isWorkspaceOnBridgeAllowlist(workspaceId);
    const workspaceEnabled = workspace?.voiceTranslationEnabled !== false;
    return {
      available: globallyAvailable && (paidPlan || trialEligible) && workspaceEnabled,
      globallyAvailable,
      paidPlan,
      workspaceEnabled,
      blockedReason: !globallyAvailable
        ? "Live Voice Translation is not released on this deployment."
        : !paidPlan && !trialEligible
          ? "Start a paid plan to use Live Voice Translation."
          : !workspaceEnabled
            ? "A workspace owner has turned Live Voice Translation off."
            : undefined,
    };
  },
});
