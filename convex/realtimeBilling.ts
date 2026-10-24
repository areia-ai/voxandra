import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isAuthorizedTranslatedTrialCall } from "./trialAccess";
import {
  consumeTopUpCredits,
  createCreditLedgerEntry,
  clearLegacyTopUpExpiry,
  getWalletForWorkspace,
  legacyBalanceDollars,
  walletIncludedBalance,
  walletTopUpBalance,
} from "./billingHelpers";
import {
  assertRealtimeFeatureOverageMargin,
  estimatedRealtimeCostCentsPerMinuteForFeature,
  getRealtimePlanEntitlement,
  includedSecondsForFeature,
  isFeatureEnabled,
  isOverageEnabledForFeature,
  overageCentsPerMinuteForFeature,
  trialSecondsForFeature,
  type RealtimeFeature,
} from "../src/lib/realtime-entitlements";

type RealtimeContext = QueryCtx | MutationCtx;

const FEATURE_LABELS: Record<RealtimeFeature, string> = {
  live_copilot: "Live Guidance",
  translated_captions: "Live Translation",
  translated_audio: "Live Audio Translation",
};

// Longer names used only where a customer is being told what a plan includes.
// "Text-only" is load-bearing now that spoken translation is a separate SKU:
// without it, "Live Translation is included on every plan" reads as a promise
// that the audio bridge is included too.
const FEATURE_INCLUSION_NAMES: Record<RealtimeFeature, string> = {
  live_copilot: "Live Guidance",
  translated_captions: "Text-only Live Translation",
  translated_audio: "Live Audio Translation",
};

// Which realtime session modes may report usage for each billed feature.
const ALLOWED_SESSION_MODES_BY_FEATURE: Record<RealtimeFeature, readonly string[]> = {
  live_copilot: ["human_copilot"],
  translated_captions: ["translated_captions"],
  translated_audio: ["translated_captions", "translated_audio_bridge"],
};

function currentBillingPeriod(wallet: Doc<"walletSummaries"> | null) {
  const now = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const nextMonthStart = new Date(monthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);

  const walletStart = wallet?.stripeCurrentPeriodStart;
  const walletEnd = wallet?.stripeCurrentPeriodEnd;
  return {
    start: walletStart && walletStart <= now ? walletStart : monthStart.getTime(),
    end: walletEnd && walletEnd > now ? walletEnd : nextMonthStart.getTime(),
  };
}

async function getWallet(ctx: RealtimeContext, workspaceId: Id<"workspaces">) {
  return await ctx.db
    .query("walletSummaries")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

async function getRecordedEvents(ctx: RealtimeContext, workspaceId: Id<"workspaces">) {
  const events = await ctx.db
    .query("realtimeUsageEvents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  return events.filter((event) => event.status === "recorded");
}

function eventOverageSeconds(event: Doc<"realtimeUsageEvents">) {
  return event.overageSeconds ?? Math.max(0, event.billedSeconds - event.includedSecondsApplied);
}

function billableOverageMinutes(seconds: number) {
  return seconds > 0 ? Math.ceil(seconds / 60) : 0;
}

function usesLifetimeTrial(
  entitlement: ReturnType<typeof getRealtimePlanEntitlement>,
  feature: RealtimeFeature
) {
  return (
    trialSecondsForFeature(entitlement, feature) > 0 &&
    includedSecondsForFeature(entitlement, feature) === 0 &&
    !isOverageEnabledForFeature(entitlement, feature)
  );
}

function buildFeatureUsage(args: {
  feature: RealtimeFeature;
  entitlement: ReturnType<typeof getRealtimePlanEntitlement>;
  periodEvents: Doc<"realtimeUsageEvents">[];
  lifetimeEvents: Doc<"realtimeUsageEvents">[];
  availableCreditCents: number;
}) {
  const { feature, entitlement, periodEvents, lifetimeEvents, availableCreditCents } = args;
  const enabled = isFeatureEnabled(entitlement, feature);
  const includedSeconds = includedSecondsForFeature(entitlement, feature);
  const trialSeconds = trialSecondsForFeature(entitlement, feature);
  const overageEnabled = isOverageEnabledForFeature(entitlement, feature);
  const overageCentsPerMinute = overageCentsPerMinuteForFeature(entitlement, feature);
  const trialMode = usesLifetimeTrial(entitlement, feature);
  const featurePeriodEvents = periodEvents.filter((event) => event.feature === feature && !event.isFreeTrial);
  const featureLifetimeEvents = lifetimeEvents.filter((event) => event.feature === feature && !event.isFreeTrial);
  const includedWindowEvents = trialMode ? featureLifetimeEvents : featurePeriodEvents;
  const visibleUsageEvents = trialMode ? featureLifetimeEvents : featurePeriodEvents;
  const usedSeconds = visibleUsageEvents.reduce((total, event) => total + event.billedSeconds, 0);
  const includedUsedSeconds = includedWindowEvents.reduce(
    (total, event) => total + event.includedSecondsApplied,
    0
  );
  const includedLimitSeconds = trialMode ? trialSeconds : includedSeconds;
  const remainingIncludedSeconds = Math.max(0, includedLimitSeconds - includedUsedSeconds);
  const trialUsedSeconds = trialMode ? includedUsedSeconds : 0;
  const trialRemainingSeconds = trialMode
    ? Math.max(0, trialSeconds - trialUsedSeconds)
    : 0;
  const overageCents = featurePeriodEvents.reduce(
    (total, event) => total + event.overageCents,
    0
  );
  const chargedCents = featurePeriodEvents.reduce(
    (total, event) => total + (event.chargedCents ?? 0),
    0
  );
  const unpaidCents = featureLifetimeEvents.reduce((total, event) => {
    if (event.chargeStatus !== "unpaid") return total;
    return total + (event.unpaidCents ?? event.overageCents);
  }, 0);

  let canStart = false;
  let blockedReason: string | undefined;
  if (!enabled) {
    blockedReason = `${FEATURE_INCLUSION_NAMES[feature]} is included on every paid plan. Start a subscription to use it.`;
  } else if (unpaidCents > 0) {
    blockedReason = `Add credits to settle ${FEATURE_LABELS[feature]} overage before using it again.`;
  } else if (trialMode) {
    canStart = trialRemainingSeconds > 0;
    if (!canStart) {
      blockedReason = `Your one-time ${FEATURE_LABELS[feature]} trial has ended.`;
    }
  } else if (remainingIncludedSeconds > 0) {
    canStart = true;
  } else if (overageEnabled && availableCreditCents >= overageCentsPerMinute) {
    canStart = true;
  } else if (overageEnabled) {
    blockedReason = `Add credits before using ${FEATURE_LABELS[feature]} overage.`;
  } else {
    blockedReason = `${FEATURE_LABELS[feature]} is not available on this plan.`;
  }

  const chargeStatus =
    unpaidCents > 0 ? "unpaid" : chargedCents > 0 ? "charged" : "not_required";

  return {
    enabled,
    canStart,
    blockedReason,
    billingMode: trialMode ? "trial" : overageEnabled ? "metered" : "locked",
    includedSeconds: includedLimitSeconds,
    usedSeconds,
    includedUsedSeconds,
    remainingIncludedSeconds,
    trialSeconds,
    trialUsedSeconds,
    trialRemainingSeconds,
    overageCents,
    chargedCents,
    unpaidCents,
    chargeStatus,
    overageCentsPerMinute,
    overageEnabled,
  };
}

export async function buildRealtimeUsageSummary(
  ctx: RealtimeContext,
  workspaceId: Id<"workspaces">
) {
  const wallet = await getWallet(ctx, workspaceId);
  const entitlement = getRealtimePlanEntitlement(wallet?.planId);
  const period = currentBillingPeriod(wallet);
  const lifetimeEvents = await getRecordedEvents(ctx, workspaceId);
  const periodEvents = lifetimeEvents.filter(
    (event) => event.startedAt >= period.start && event.startedAt < period.end
  );
  const availableCreditCents =
    (wallet?.includedCreditBalanceCents ?? 0) + (wallet?.topUpCreditBalanceCents ?? 0);

  return {
    planId: wallet?.planId ?? null,
    realtimeEnabled: entitlement.realtimeEnabled,
    availableCreditCents,
    periodStart: period.start,
    periodEnd: period.end,
    liveCopilot: buildFeatureUsage({
      feature: "live_copilot",
      entitlement,
      periodEvents,
      lifetimeEvents,
      availableCreditCents,
    }),
    translatedCaptions: buildFeatureUsage({
      feature: "translated_captions",
      entitlement,
      periodEvents,
      lifetimeEvents,
      availableCreditCents,
    }),
    translatedAudio: buildFeatureUsage({
      feature: "translated_audio",
      entitlement,
      periodEvents,
      lifetimeEvents,
      availableCreditCents,
    }),
  };
}

async function chargeRealtimeUsageEvent(
  ctx: MutationCtx,
  eventId: Id<"realtimeUsageEvents">,
  now: number
) {
  const event = await ctx.db.get(eventId);
  if (!event || event.status !== "recorded") {
    return { status: "skipped" as const, reason: "event_not_recorded" };
  }

  const chargeCents = Math.max(0, event.overageCents);
  if (chargeCents <= 0) {
    await ctx.db.patch(event._id, {
      chargeStatus: "not_required",
      chargedCents: 0,
      includedChargedCents: 0,
      topUpChargedCents: 0,
      unpaidCents: 0,
    });
    return { status: "not_required" as const };
  }

  if (event.chargeStatus === "charged") {
    return { status: "already_charged" as const, chargedCents: event.chargedCents ?? 0 };
  }

  const walletBeforeExpiry = await getWalletForWorkspace(ctx, event.workspaceId);
  if (!walletBeforeExpiry) {
    await ctx.db.patch(event._id, {
      chargeStatus: "unpaid",
      chargedCents: 0,
      unpaidCents: chargeCents,
    });
    return { status: "unpaid" as const, unpaidCents: chargeCents };
  }

  const wallet = await clearLegacyTopUpExpiry(ctx, walletBeforeExpiry);
  const includedBalance = walletIncludedBalance(wallet);
  const topUpBalance = walletTopUpBalance(wallet);
  const availableCreditCents = includedBalance + topUpBalance;

  if (availableCreditCents < chargeCents) {
    await ctx.db.patch(event._id, {
      chargeStatus: "unpaid",
      chargedCents: 0,
      unpaidCents: chargeCents,
    });
    return { status: "unpaid" as const, unpaidCents: chargeCents };
  }

  const includedChargedCents = Math.min(includedBalance, chargeCents);
  const topUpChargedCents = chargeCents - includedChargedCents;
  let nextTopUpExpiry = wallet.topUpCreditExpiresAt;

  if (topUpChargedCents > 0) {
    const topUpConsumption = await consumeTopUpCredits(ctx, {
      workspaceId: event.workspaceId,
      amountCents: topUpChargedCents,
      now,
    });
    if (!topUpConsumption.consumed) {
      await ctx.db.patch(event._id, {
        chargeStatus: "unpaid",
        chargedCents: 0,
        unpaidCents: chargeCents,
      });
      return { status: "unpaid" as const, unpaidCents: chargeCents };
    }
    nextTopUpExpiry = topUpConsumption.nextTopUpExpiry;
  }

  const nextIncludedBalance = includedBalance - includedChargedCents;
  const nextTopUpBalance = topUpBalance - topUpChargedCents;
  await ctx.db.patch(wallet._id, {
    includedCreditBalanceCents: nextIncludedBalance,
    topUpCreditBalanceCents: nextTopUpBalance,
    topUpCreditExpiresAt: nextTopUpExpiry,
    lifetimeCreditSpendCents: (wallet.lifetimeCreditSpendCents ?? 0) + chargeCents,
    creditBalance: legacyBalanceDollars(nextIncludedBalance, nextTopUpBalance),
  });

  const ledgerEntryId = await createCreditLedgerEntry(ctx, {
    workspaceId: event.workspaceId,
    walletSummaryId: wallet._id,
    callId: event.callId,
    realtimeUsageEventId: event._id,
    externalId: `realtime_charge:${event._id}`,
    type: "realtime_charge",
    bucket:
      includedChargedCents > 0 && topUpChargedCents > 0
        ? "mixed"
        : includedChargedCents > 0
          ? "included"
          : "top_up",
    amountCents: -chargeCents,
    description: `Charged credits for ${FEATURE_LABELS[event.feature]} overage`,
    createdAt: now,
  });

  await ctx.db.patch(event._id, {
    chargeStatus: "charged",
    chargedCents: chargeCents,
    includedChargedCents,
    topUpChargedCents,
    unpaidCents: 0,
    chargedAt: now,
    chargeLedgerEntryId: ledgerEntryId,
  });

  return { status: "charged" as const, chargedCents: chargeCents };
}

export async function settleOutstandingRealtimeCharges(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    callId?: Id<"calls">;
    now: number;
  }
) {
  const events = await ctx.db
    .query("realtimeUsageEvents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .collect();
  const unpaidEvents = events
    .filter(
      (event) =>
        event.status === "recorded" &&
        event.chargeStatus === "unpaid" &&
        (!args.callId || event.callId === args.callId)
    )
    .sort((a, b) => a.createdAt - b.createdAt);

  let chargedCents = 0;
  let unpaidCents = 0;
  for (const event of unpaidEvents) {
    const result = await chargeRealtimeUsageEvent(ctx, event._id, args.now);
    if (result.status === "charged" || result.status === "already_charged") {
      chargedCents += result.chargedCents ?? 0;
      continue;
    }
    if (result.status === "unpaid") {
      unpaidCents += result.unpaidCents;
      break;
    }
  }

  return { checked: unpaidEvents.length, chargedCents, unpaidCents };
}

// Exhaustive by construction: the Record type makes a missing feature a compile
// error, and the return type is pinned to one feature's usage block so no feature
// can be served another's included pool, overage rate or unpaid balance.
function selectFeatureSummary(
  summary: Awaited<ReturnType<typeof buildRealtimeUsageSummary>>,
  feature: RealtimeFeature
) {
  const byFeature: Record<RealtimeFeature, typeof summary.liveCopilot> = {
    live_copilot: summary.liveCopilot,
    translated_captions: summary.translatedCaptions,
    translated_audio: summary.translatedAudio,
  };
  return byFeature[feature];
}

export async function assertRealtimeFeatureCanStart(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    feature: RealtimeFeature;
    now: number;
  }
) {
  await settleOutstandingRealtimeCharges(ctx, {
    workspaceId: args.workspaceId,
    now: args.now,
  });
  const summary = await buildRealtimeUsageSummary(ctx, args.workspaceId);
  // Keyed lookup, not a ternary. This was
  // `feature === "live_copilot" ? liveCopilot : translatedCaptions`, which sent
  // translated_audio down the else branch to the CAPTIONS summary. The gate then
  // fed the 10c captions rate into a margin check against the 9c audio cost
  // (needing 18c) and threw, so every bridged call failed to start — the exact
  // inverse of the false pass this feature literal was added to fix. It also
  // consulted the captions pool rather than the audio pool. Adding a feature must
  // fail to compile here rather than silently borrow another feature's meter.
  const featureSummary = selectFeatureSummary(summary, args.feature);

  if (featureSummary.overageEnabled) {
    assertRealtimeFeatureOverageMargin({
      feature: args.feature,
      overageCentsPerMinute: featureSummary.overageCentsPerMinute,
    });
  }

  if (!featureSummary.canStart) {
    throw new Error(
      featureSummary.blockedReason ??
        `${FEATURE_LABELS[args.feature]} is not available right now.`
    );
  }

  return featureSummary;
}

export async function recordRealtimeUsageEvent(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    callId?: Id<"calls">;
    realtimeSessionId?: Id<"realtimeSessions">;
    feature: RealtimeFeature;
    durationSeconds: number;
    model?: string;
    startedAt?: number;
    endedAt?: number;
  }
) {
  const wallet = await getWallet(ctx, args.workspaceId);
  const entitlement = getRealtimePlanEntitlement(wallet?.planId);
  let effectiveCallId = args.callId;
  if (args.realtimeSessionId) {
    const session = await ctx.db.get(args.realtimeSessionId);
    if (!session || session.workspaceId !== args.workspaceId) {
      throw new Error("Realtime session not found");
    }

    // An explicit map rather than a ternary: with a third feature the old
    // `feature === "live_copilot" ? ... : "translated_captions"` would have
    // silently accepted translated_audio against a captions session by falling
    // through the else branch. Bridge calls currently open their session with
    // mode "translated_captions" (convex/twilioCalls.ts), and the schema already
    // defines "translated_audio_bridge", so both are accepted — the check stays
    // meaningful while surviving that migration whenever it happens.
    const allowedModes = ALLOWED_SESSION_MODES_BY_FEATURE[args.feature];
    if (!allowedModes.includes(session.mode)) {
      throw new Error("Realtime usage session mode does not match feature.");
    }
    if (args.callId && session.callId && session.callId !== args.callId) {
      throw new Error("Realtime usage session does not belong to this call.");
    }

    effectiveCallId = args.callId ?? session.callId;
    const existingSessionEvents = await ctx.db
      .query("realtimeUsageEvents")
      .withIndex("by_session", (q) => q.eq("realtimeSessionId", args.realtimeSessionId))
      .collect();
    const existingRecordedEvent = existingSessionEvents.find(
      (event) => event.feature === args.feature && event.status === "recorded"
    );
    if (existingRecordedEvent) {
      return existingRecordedEvent._id;
    }
  }

  const call = effectiveCallId ? await ctx.db.get(effectiveCallId) : null;
  if (effectiveCallId && (!call || call.workspaceId !== args.workspaceId)) throw new Error("Call not found");
  const authorizedTrial = Boolean(args.realtimeSessionId && await isAuthorizedTranslatedTrialCall(ctx, call, args.feature));
  if (!authorizedTrial && !isFeatureEnabled(entitlement, args.feature)) {
    throw new Error(`${FEATURE_LABELS[args.feature]} is not available on this plan.`);
  }
  if (call?.isFreeCall && !authorizedTrial) throw new Error("Trial realtime usage is not authorized.");
  if (!Number.isFinite(args.durationSeconds) || args.durationSeconds < 0) throw new Error("Invalid usage duration.");

  const period = currentBillingPeriod(wallet);
  const lifetimeEvents = await getRecordedEvents(ctx, args.workspaceId);
  const periodEvents = lifetimeEvents.filter(
    (event) => event.startedAt >= period.start && event.startedAt < period.end
  );
  const trialMode = usesLifetimeTrial(entitlement, args.feature);
  const includedWindowEvents = (trialMode ? lifetimeEvents : periodEvents).filter(
    (event) => event.feature === args.feature && !event.isFreeTrial
  );
  const usedIncludedSeconds = includedWindowEvents.reduce(
    (total, event) => total + event.includedSecondsApplied,
    0
  );
  const includedLimitSeconds = trialMode
    ? trialSecondsForFeature(entitlement, args.feature)
    : includedSecondsForFeature(entitlement, args.feature);
  const remainingIncludedSeconds = Math.max(0, includedLimitSeconds - usedIncludedSeconds);
  const billedSeconds = Math.max(0, Math.ceil(args.durationSeconds));
  const includedSecondsApplied = authorizedTrial ? billedSeconds : Math.min(remainingIncludedSeconds, billedSeconds);
  const overageSeconds = authorizedTrial ? 0 : Math.max(0, billedSeconds - includedSecondsApplied);
  const overageEnabled = !authorizedTrial && isOverageEnabledForFeature(entitlement, args.feature);
  if (overageEnabled) {
    assertRealtimeFeatureOverageMargin({
      feature: args.feature,
      overageCentsPerMinute: overageCentsPerMinuteForFeature(entitlement, args.feature),
    });
  }
  const chargeTrackedEvents = periodEvents.filter(
    (event) => event.feature === args.feature && event.chargeStatus !== undefined
  );
  const previousOverageSeconds = chargeTrackedEvents.reduce(
    (total, event) => total + eventOverageSeconds(event),
    0
  );
  const previousBillableMinutes = billableOverageMinutes(previousOverageSeconds);
  const nextBillableMinutes = billableOverageMinutes(
    previousOverageSeconds + overageSeconds
  );
  const chargedOverageMinutes = overageEnabled
    ? Math.max(0, nextBillableMinutes - previousBillableMinutes)
    : 0;
  const overageCents =
    chargedOverageMinutes *
    overageCentsPerMinuteForFeature(entitlement, args.feature);
  const endedAt = args.endedAt ?? Date.now();
  const startedAt = args.startedAt ?? Math.max(0, endedAt - billedSeconds * 1000);

  if (effectiveCallId) {
    const call = await ctx.db.get(effectiveCallId);
    if (!call || call.workspaceId !== args.workspaceId) {
      throw new Error("Call not found");
    }
  }

  // Cost is charged on every billed second, whether the customer paid for it or
  // it came out of their included allowance, so this is derived from
  // billedSeconds rather than overageSeconds.
  const estimatedCostCentsPerMinute = estimatedRealtimeCostCentsPerMinuteForFeature(
    args.feature
  );
  const estimatedProviderCostCents =
    (billedSeconds / 60) * estimatedCostCentsPerMinute;

  const eventId = await ctx.db.insert("realtimeUsageEvents", {
    workspaceId: args.workspaceId,
    callId: effectiveCallId,
    realtimeSessionId: args.realtimeSessionId,
    feature: args.feature,
    planId: wallet?.planId,
    model: args.model,
    durationSeconds: args.durationSeconds,
    billedSeconds,
    includedSecondsApplied,
    isFreeTrial: authorizedTrial || undefined,
    overageSeconds,
    overageCents,
    estimatedProviderCostCents,
    estimatedCostCentsPerMinute,
    chargeStatus: overageCents > 0 ? "unpaid" : "not_required",
    chargedCents: 0,
    includedChargedCents: 0,
    topUpChargedCents: 0,
    unpaidCents: overageCents,
    status: "recorded",
    startedAt,
    endedAt,
    createdAt: Date.now(),
  });

  if (overageCents > 0) {
    await chargeRealtimeUsageEvent(ctx, eventId, Date.now());
  }

  return eventId;
}
