import { getRetailRateCentsPerMinute } from "../calling-rates";
import type { RealtimeFeature } from "../realtime-entitlements";
import { INCLUDED_MINUTES_REFERENCE_COUNTRY } from "./config";

// What a top-up actually buys, per thing you can spend it on.
//
// The same credit dollar buys wildly different amounts depending on where it is
// pointed: at current rates $10 is ~166 US/Canada call minutes, 100 Live
// Translation minutes, or 14 Live Guidance minutes on Solo. A customer who does
// not know that experiences their balance "disappearing" and turns the feature
// off instead of buying more, so the spread is shown at the moment of purchase.
//
// EVERY figure here is derived from the live rate. Never hand-write a minutes or
// per-minute figure into copy: four hard-coded "$0.40/min" strings in
// src/lib/pricing.ts became false advertising the moment Live Guidance overage
// was tiered on 2026-07-31, and this display would fail the same way.
export type BuyingPowerRow = {
  key: "calling" | RealtimeFeature;
  label: string;
  minutes: number;
  centsPerMinute: number;
  // Calling only. Credits are a dollar balance and every destination has its own
  // rate, so the figure is a US/Canada reference, not what every minute costs.
  // Live-feature rates are a single number per workspace, so those are exact.
  approximate: boolean;
};

const FEATURE_LABELS: Record<RealtimeFeature, string> = {
  live_copilot: "Live Guidance",
  translated_captions: "Live Translation",
  translated_audio: "Voice Translation",
};

export type FeatureRatesCentsPerMinute = Partial<
  Record<RealtimeFeature, number | null | undefined>
>;

// Whole minutes only, always rounded DOWN. A top-up must never advertise a
// minute the money does not cover.
function affordableMinutes(amountCents: number, centsPerMinute: number) {
  return Math.floor(amountCents / centsPerMinute);
}

export function describeTopUpBuyingPower(args: {
  amountCents: number;
  // Pass only the features the workspace can actually use today. A rate that is
  // null, zero or absent drops its row rather than rendering an infinity.
  featureRatesCentsPerMinute?: FeatureRatesCentsPerMinute;
}): BuyingPowerRow[] {
  const { amountCents, featureRatesCentsPerMinute } = args;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return [];

  const rows: BuyingPowerRow[] = [];

  const callingRate = getRetailRateCentsPerMinute(INCLUDED_MINUTES_REFERENCE_COUNTRY);
  if (callingRate && callingRate > 0) {
    rows.push({
      key: "calling",
      // "US/Canada" spelled out rather than the raw "US/CA" constant, matching
      // formatIncludedCallingAllowance in ./config — the explicit country is
      // load-bearing, because other destinations buy fewer minutes than this.
      label: "US/Canada calls",
      minutes: affordableMinutes(amountCents, callingRate),
      centsPerMinute: callingRate,
      approximate: true,
    });
  }

  const featureRows = (Object.keys(FEATURE_LABELS) as RealtimeFeature[])
    .flatMap<BuyingPowerRow>((feature) => {
      const centsPerMinute = featureRatesCentsPerMinute?.[feature];
      if (!centsPerMinute || centsPerMinute <= 0) return [];
      return [
        {
          key: feature,
          label: FEATURE_LABELS[feature],
          minutes: affordableMinutes(amountCents, centsPerMinute),
          centsPerMinute,
          approximate: false,
        },
      ];
    })
    // Sorted by rate rather than listed in a fixed order, so the rows always read
    // as a descending scale of minutes even after a rate is retiered.
    .sort((a, b) => a.centsPerMinute - b.centsPerMinute);

  return [...rows, ...featureRows];
}
