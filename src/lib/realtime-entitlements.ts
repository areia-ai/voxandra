// translated_audio is the two-leg spoken bridge, metered separately from
// translated_captions because it consumes one Palabra session PER DIRECTION.
// Riding the captions meter would have billed a ~9c/min feature at the 10c
// captions rate (1.19x) while assertRealtimeFeatureOverageMargin checked it
// against the 4c captions cost and passed — a false pass on every bridge minute.
export type RealtimeFeature = "live_copilot" | "translated_captions" | "translated_audio";

export type RealtimePlanEntitlement = {
  realtimeEnabled: boolean;
  liveCopilotEnabled: boolean;
  translatedCaptionsEnabled: boolean;
  translatedAudioEnabled: boolean;
  liveCopilotIncludedSeconds: number;
  translatedCaptionsIncludedSeconds: number;
  translatedAudioIncludedSeconds: number;
  liveCopilotTrialSeconds: number;
  translatedCaptionsTrialSeconds: number;
  translatedAudioTrialSeconds: number;
  liveCopilotOverageEnabled: boolean;
  translatedCaptionsOverageEnabled: boolean;
  translatedAudioOverageEnabled: boolean;
  liveCopilotOverageCentsPerMinute: number;
  translatedCaptionsOverageCentsPerMinute: number;
  translatedAudioOverageCentsPerMinute: number;
};

// Every paid plan gets recurring monthly minutes of both live features plus
// metered overage. Tiers differ by volume, not by which features exist: gating
// the flagship features behind Team made the entry plans degrade after their
// one-time trial and left an enthusiastic Solo customer with no way to buy more
// than a 5x plan jump. Included minutes are sized to roughly 70-80% of what each
// plan's included calling credits buy at the US/CA retail rate, so the two
// allowances run out together.
export const SOLO_LIVE_COPILOT_INCLUDED_SECONDS = 30 * 60;
export const SOLO_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 10 * 60;
export const STARTER_LIVE_COPILOT_INCLUDED_SECONDS = 60 * 60;
export const STARTER_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 20 * 60;
// 250 -> 180 on 2026-07-31. Team was the only plan failing its own marginal
// floor: +$100 of price over Starter bought +$52.97 of cost, a 1.89x step
// against a 2x minimum, because those 250 included Live Guidance minutes are
// $47.50 of vendor cost given away for nothing. At 180 the step becomes ~2.4x
// with no price change, and Team's included-Guidance share of plan cost drops
// from 31.9% to 23.0%.
export const TEAM_LIVE_COPILOT_INCLUDED_SECONDS = 180 * 60;
export const TEAM_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 50 * 60;
export const OPERATIONS_LIVE_COPILOT_INCLUDED_SECONDS = 500 * 60;
export const OPERATIONS_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 200 * 60;
// Live Audio Translation pools. Sized against absorbable headroom
// (price/2 - current cost), not margin dollars: Team is the binding tier with
// ~$16.02 of room and 30 minutes spends $2.70 of it. Deliberately conservative
// because the 9c cost basis is still a model. NOT yet advertised anywhere —
// the feature has not passed a live acceptance test, and the plan copy must
// never promise something the product cannot demonstrably do.
export const SOLO_TRANSLATED_AUDIO_INCLUDED_SECONDS = 5 * 60;
export const STARTER_TRANSLATED_AUDIO_INCLUDED_SECONDS = 10 * 60;
export const TEAM_TRANSLATED_AUDIO_INCLUDED_SECONDS = 30 * 60;
export const OPERATIONS_TRANSLATED_AUDIO_INCLUDED_SECONDS = 120 * 60;

// Live Guidance overage, TIERED on 2026-07-31, replacing a single flat 40c on
// every plan. (The rate's history: 6c, raised to 15c, then 40c when production
// Live Guidance moved off gpt-realtime-2.1-mini back to gpt-realtime-2.1 on
// 2026-07-29 and the cost estimate was corrected from 7c to 19c.)
//
// A flat overage rate made the ladder arithmetically dominated by its cheapest
// rung: out-of-pocket was `plan price + 0.40 x minutes` on every tier, so the
// lines never crossed and Team stayed permanently dearer than Starter at ANY
// volume. Combined with never-expiring fungible credits, no customer had a
// reason to upgrade except seats. Replicating Team's whole bundle on Starter
// cost ~$145 against Team's $149.
//
// 40c was also below the company's own subscription margin: 40/19 = 2.11x
// against Team's 2.16x plan multiple, so every marginal AI minute pulled
// blended margin DOWN. Growth in usage made the business less profitable.
//
// Tiering fixes both at once — a rate is the one thing a customer cannot top up
// past, so it creates a real crossover — while raising the entry multiple to
// 3.68x. Operations at 45c is 2.37x, mildly dilutive at the top by design:
// volume buyers get the best rate, which is the point of a ladder.
export const SOLO_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 70;
export const STARTER_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 65;
export const TEAM_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 50;
export const OPERATIONS_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 45;
// Retained as the default for workspaces with no plan (EMPTY_ENTITLEMENT) and as
// the conservative floor any new tier must clear.
export const LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 40;
// Live Audio Translation overage. Against the 9c all-in cost these are
// 3.89x/3.89x/3.33x/2.78x — the best-margin SKU in the product, because the
// bridge is 2.1x cheaper to serve than Live Guidance while carrying far more
// pricing power (its buyer reference price is human interpretation at
// $0.80-$5.00/min, not a per-seat SaaS suite).
export const SOLO_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE = 35;
export const STARTER_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE = 35;
export const TEAM_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE = 30;
export const OPERATIONS_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE = 25;
// 10c against the 4c cost estimate keeps a 2.5x multiple. At the previous 8c
// this sat exactly on REALTIME_MINIMUM_MARGIN_MULTIPLE, so any upward drift in
// real cost would make assertRealtimeFeatureOverageMargin throw at call start.
export const TRANSLATED_CAPTIONS_OVERAGE_CENTS_PER_MINUTE = 10;
export const REALTIME_MINIMUM_MARGIN_MULTIPLE = 2;
// Modeled for the standard gpt-realtime-2.1 observer as it is actually
// configured: audio input on BOTH call tracks, output_modalities ["text"],
// reasoning effort low, and a persistent session re-reading context as cached
// input. Published rates put audio in at $32/M, cached in at $0.40/M, and text
// out at $24/M, giving ~6.4c/min in the base case across a 3.5-10.1c range; 7c
// is that base rounded up. The previous value of 2c was written on 2026-06-28
// for the older whisper + gpt-5.4-mini Responses pipeline and was never
// revalidated when the audio-native observer replaced it two weeks later.
// This is still a model, not a measurement: guidanceMetrics (input/output/cached
// tokens) is persisted per realtime session, so reset this from a real call.
export const LIVE_COPILOT_ESTIMATED_COST_CENTS_PER_MINUTE = 19;
// 4c is Palabra's PUBLISHED pay-as-you-go speech-to-speech rate: "$0.04 / MIN"
// at palabra.ai/pricing, confirmed 2026-07-31. This constant previously had no
// provenance comment at all, which mattered because it is the only AI cost figure
// in the repo that is a vendor list price rather than a model — Live Guidance's
// 19c above is still an unmeasured estimate.
//
// It is a rate PER PALABRA SESSION-MINUTE, not per translated call-minute. A
// captions-only call runs one session; the two-leg audio bridge runs one session
// PER DIRECTION, so a bridged minute costs 2 x 4c plus a second Twilio media
// stream (~0.44c) = ~8.4c/min. The bridge is therefore NOT metered on this
// constant: it has its own feature literal and its own all-in cost constant
// (TRANSLATED_AUDIO_ESTIMATED_COST_CENTS_PER_MINUTE below).
//
// Palabra exposes GET /billing/usage?utc_from_ts=&utc_to_ts= (Bearer PALABRA_API_KEY)
// for reconciliation. As of 2026-07-31 it returns zero items across two months
// because the account is still inside the $50 free-credit grant, so nothing has
// been invoiced yet and the 4c figure cannot yet be checked against a real bill.
// Volume pricing exists (their published tiers reach ~20 credits/hour at Business),
// so revisit this constant, and ask for API volume terms, once real usage accrues.
export const TRANSLATED_CAPTIONS_ESTIMATED_COST_CENTS_PER_MINUTE = 4;
// AI-only cost for one bridged minute: two Palabra sessions at the published
// 4c session-minute rate (one per direction) = 8c/min. This constant is why
// the second Palabra session is now accounted for: the bridge records ONE
// usage event at this rate rather than two events, so nothing double-counts
// and the dedupe on (session, feature) stays correct.
//
// Previously 9c, folding in an extra "~0.44c second Twilio media stream"
// line inherited from the private listen-along topology (a second stream on
// the SAME Twilio call — bandwidth only, no new carrier-billed leg). The
// bridge's real second leg is a genuinely separate, destination-variable,
// carrier-billed Twilio Call (1.6-59c/min depending on destination — see
// src/lib/twilio-rate-catalog.ts), already priced correctly by the ordinary
// per-call retail-rate reservation and settled off the callee leg's
// duration (convex/twilioProvider.ts, settleCallReservation). That 0.44c
// line double-counted a telephony cost this AI-only meter was never the
// right place to carry. Real bridge telephony cost is now tracked
// separately, internal-only, via computeBridgeInternalCostCents
// (src/lib/call-pricing.ts) and calls.bridgeInternalCostCents — see LOG.md,
// bridge-GA Phase 1b (2026-08-13).
//
// Do NOT also multiply this by a session count — that would bill 16c/min.
// Recheck it against Palabra's GET /billing/usage once the free-credit grant
// is exhausted and real invoicing begins; if a bridged call turns out to run
// a THIRD session for captions, this becomes ~12c and every rate above needs
// revisiting.
export const TRANSLATED_AUDIO_ESTIMATED_COST_CENTS_PER_MINUTE = 8;

const EMPTY_ENTITLEMENT: RealtimePlanEntitlement = {
  realtimeEnabled: false,
  liveCopilotEnabled: false,
  translatedCaptionsEnabled: false,
  liveCopilotIncludedSeconds: 0,
  translatedCaptionsIncludedSeconds: 0,
  liveCopilotTrialSeconds: 0,
  translatedCaptionsTrialSeconds: 0,
  liveCopilotOverageEnabled: false,
  translatedCaptionsOverageEnabled: false,
  liveCopilotOverageCentsPerMinute: LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE,
  translatedCaptionsOverageCentsPerMinute: TRANSLATED_CAPTIONS_OVERAGE_CENTS_PER_MINUTE,
  translatedAudioEnabled: false,
  translatedAudioIncludedSeconds: 0,
  translatedAudioTrialSeconds: 0,
  translatedAudioOverageEnabled: false,
  translatedAudioOverageCentsPerMinute: SOLO_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE,
};

export function getRealtimePlanEntitlement(
  planId: string | null | undefined
): RealtimePlanEntitlement {
  if (planId === "solo") {
    return {
      realtimeEnabled: true,
      liveCopilotEnabled: true,
      translatedCaptionsEnabled: true,
      liveCopilotIncludedSeconds: SOLO_LIVE_COPILOT_INCLUDED_SECONDS,
      translatedCaptionsIncludedSeconds: SOLO_TRANSLATED_CAPTIONS_INCLUDED_SECONDS,
      liveCopilotTrialSeconds: 0,
      translatedCaptionsTrialSeconds: 0,
      liveCopilotOverageEnabled: true,
      translatedCaptionsOverageEnabled: true,
      liveCopilotOverageCentsPerMinute: SOLO_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE,
      translatedCaptionsOverageCentsPerMinute: TRANSLATED_CAPTIONS_OVERAGE_CENTS_PER_MINUTE,
      translatedAudioEnabled: true,
      translatedAudioIncludedSeconds: SOLO_TRANSLATED_AUDIO_INCLUDED_SECONDS,
      translatedAudioTrialSeconds: 0,
      translatedAudioOverageEnabled: true,
      translatedAudioOverageCentsPerMinute:
        SOLO_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE,
    };
  }

  if (planId === "starter") {
    return {
      realtimeEnabled: true,
      liveCopilotEnabled: true,
      translatedCaptionsEnabled: true,
      liveCopilotIncludedSeconds: STARTER_LIVE_COPILOT_INCLUDED_SECONDS,
      translatedCaptionsIncludedSeconds: STARTER_TRANSLATED_CAPTIONS_INCLUDED_SECONDS,
      liveCopilotTrialSeconds: 0,
      translatedCaptionsTrialSeconds: 0,
      liveCopilotOverageEnabled: true,
      translatedCaptionsOverageEnabled: true,
      liveCopilotOverageCentsPerMinute: STARTER_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE,
      translatedCaptionsOverageCentsPerMinute: TRANSLATED_CAPTIONS_OVERAGE_CENTS_PER_MINUTE,
      translatedAudioEnabled: true,
      translatedAudioIncludedSeconds: STARTER_TRANSLATED_AUDIO_INCLUDED_SECONDS,
      translatedAudioTrialSeconds: 0,
      translatedAudioOverageEnabled: true,
      translatedAudioOverageCentsPerMinute:
        STARTER_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE,
    };
  }

  if (planId === "team") {
    return {
      realtimeEnabled: true,
      liveCopilotEnabled: true,
      translatedCaptionsEnabled: true,
      liveCopilotIncludedSeconds: TEAM_LIVE_COPILOT_INCLUDED_SECONDS,
      translatedCaptionsIncludedSeconds: TEAM_TRANSLATED_CAPTIONS_INCLUDED_SECONDS,
      liveCopilotTrialSeconds: 0,
      translatedCaptionsTrialSeconds: 0,
      liveCopilotOverageEnabled: true,
      translatedCaptionsOverageEnabled: true,
      liveCopilotOverageCentsPerMinute: TEAM_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE,
      translatedCaptionsOverageCentsPerMinute: TRANSLATED_CAPTIONS_OVERAGE_CENTS_PER_MINUTE,
      translatedAudioEnabled: true,
      translatedAudioIncludedSeconds: TEAM_TRANSLATED_AUDIO_INCLUDED_SECONDS,
      translatedAudioTrialSeconds: 0,
      translatedAudioOverageEnabled: true,
      translatedAudioOverageCentsPerMinute:
        TEAM_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE,
    };
  }

  if (planId === "operations") {
    return {
      realtimeEnabled: true,
      liveCopilotEnabled: true,
      translatedCaptionsEnabled: true,
      liveCopilotIncludedSeconds: OPERATIONS_LIVE_COPILOT_INCLUDED_SECONDS,
      translatedCaptionsIncludedSeconds: OPERATIONS_TRANSLATED_CAPTIONS_INCLUDED_SECONDS,
      liveCopilotTrialSeconds: 0,
      translatedCaptionsTrialSeconds: 0,
      liveCopilotOverageEnabled: true,
      translatedCaptionsOverageEnabled: true,
      liveCopilotOverageCentsPerMinute: OPERATIONS_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE,
      translatedCaptionsOverageCentsPerMinute: TRANSLATED_CAPTIONS_OVERAGE_CENTS_PER_MINUTE,
      translatedAudioEnabled: true,
      translatedAudioIncludedSeconds: OPERATIONS_TRANSLATED_AUDIO_INCLUDED_SECONDS,
      translatedAudioTrialSeconds: 0,
      translatedAudioOverageEnabled: true,
      translatedAudioOverageCentsPerMinute:
        OPERATIONS_TRANSLATED_AUDIO_OVERAGE_CENTS_PER_MINUTE,
    };
  }

  return EMPTY_ENTITLEMENT;
}

export function includedSecondsForFeature(
  entitlement: RealtimePlanEntitlement,
  feature: RealtimeFeature
) {
  if (feature === "live_copilot") return entitlement.liveCopilotIncludedSeconds;
  if (feature === "translated_audio") return entitlement.translatedAudioIncludedSeconds;
  return entitlement.translatedCaptionsIncludedSeconds;
}

// No plan currently grants lifetime trial seconds — every paid tier gets
// recurring monthly minutes instead. The mechanism is kept intact (see
// usesLifetimeTrial in convex/realtimeBilling.ts) so a future free tier can be
// given a one-time taste without reworking the billing core.
export function trialSecondsForFeature(
  entitlement: RealtimePlanEntitlement,
  feature: RealtimeFeature
) {
  if (feature === "live_copilot") return entitlement.liveCopilotTrialSeconds;
  if (feature === "translated_audio") return entitlement.translatedAudioTrialSeconds;
  return entitlement.translatedCaptionsTrialSeconds;
}

export function isFeatureEnabled(
  entitlement: RealtimePlanEntitlement,
  feature: RealtimeFeature
) {
  if (feature === "live_copilot") return entitlement.liveCopilotEnabled;
  if (feature === "translated_audio") return entitlement.translatedAudioEnabled;
  return entitlement.translatedCaptionsEnabled;
}

export function isOverageEnabledForFeature(
  entitlement: RealtimePlanEntitlement,
  feature: RealtimeFeature
) {
  if (feature === "live_copilot") return entitlement.liveCopilotOverageEnabled;
  if (feature === "translated_audio") return entitlement.translatedAudioOverageEnabled;
  return entitlement.translatedCaptionsOverageEnabled;
}

export function overageCentsPerMinuteForFeature(
  entitlement: RealtimePlanEntitlement,
  feature: RealtimeFeature
) {
  if (feature === "live_copilot") return entitlement.liveCopilotOverageCentsPerMinute;
  if (feature === "translated_audio") return entitlement.translatedAudioOverageCentsPerMinute;
  return entitlement.translatedCaptionsOverageCentsPerMinute;
}

export function estimatedRealtimeCostCentsPerMinuteForFeature(feature: RealtimeFeature) {
  if (feature === "live_copilot") return LIVE_COPILOT_ESTIMATED_COST_CENTS_PER_MINUTE;
  if (feature === "translated_audio") return TRANSLATED_AUDIO_ESTIMATED_COST_CENTS_PER_MINUTE;
  return TRANSLATED_CAPTIONS_ESTIMATED_COST_CENTS_PER_MINUTE;
}

export function realtimeOverageMeetsMargin(args: {
  feature: RealtimeFeature;
  overageCentsPerMinute: number;
}) {
  return (
    args.overageCentsPerMinute >=
    estimatedRealtimeCostCentsPerMinuteForFeature(args.feature) *
      REALTIME_MINIMUM_MARGIN_MULTIPLE
  );
}

export function assertRealtimeFeatureOverageMargin(args: {
  feature: RealtimeFeature;
  overageCentsPerMinute: number;
}) {
  if (!realtimeOverageMeetsMargin(args)) {
    throw new Error(
      "Live feature overage is below the configured minimum margin. Disable overage or update realtime pricing."
    );
  }
}

export function isRealtimePlan(planId: string | null | undefined) {
  return getRealtimePlanEntitlement(planId).realtimeEnabled;
}

export function formatRealtimeMinutes(seconds: number) {
  return `${Math.floor(seconds / 60).toLocaleString()} min`;
}
