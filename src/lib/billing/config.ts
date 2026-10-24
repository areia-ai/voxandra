import {
  estimateBillableCallCostCents,
  getAffordableBillableCallSeconds,
} from "../call-pricing";

export const STRIPE_API_VERSION = "2026-02-25.clover";

export { getRetailRateCentsPerMinute } from "../calling-rates";
import { getRetailRateCentsPerMinute } from "../calling-rates";
export {
  CALL_BILLING_INCREMENT_SECONDS,
  MINIMUM_BILLABLE_CALL_SECONDS,
  estimateBillableCallCostCents,
  getBillableCallSeconds,
} from "../call-pricing";

export type SubscriptionPlanId = "solo" | "starter" | "team" | "operations";
export type BillingPlanId = SubscriptionPlanId | "calls_only" | "free";
export type TopUpId = "topup_10" | "topup_25" | "topup_50" | "topup_100";

export type SubscriptionPlanConfig = {
  id: SubscriptionPlanId;
  name: string;
  stripeLookupKey: string;
  monthlyPriceCents: number;
  includedCreditCents: number;
  includedSeats: number;
  aiFeaturesEnabled: true;
};

export type TopUpConfig = {
  id: TopUpId;
  label: string;
  stripeLookupKey: string;
  amountCents: number;
};

// Purchased top-up credits never expire (product decision, 2026-07-29). The
// `expire` ledger type and the "Credits expired" label are kept so historical
// entries from the previous 12-month policy still render, and
// clearLegacyTopUpExpiry in convex/billingHelpers.ts strips any stamped expiry
// so credits bought under the old policy also become permanent.
export const TOP_UP_CREDIT_EXPIRY_LABEL = "never";
export const MIN_CALL_RESERVATION_SECONDS = 60;
export const CUSTOM_TOP_UP_MIN_CENTS = 500;
export const CUSTOM_TOP_UP_MAX_CENTS = 100000;
export const AUTO_TOP_UP_THRESHOLD_CENTS = 1000;
export const AUTO_TOP_UP_AMOUNT_CENTS = 2500;
export const CALLING_NUMBER_RENTAL_PRICE_CENTS = 300;
export const DEFAULT_CALLING_NUMBER_RENTAL_LOOKUP_KEY = "voxandra_calling_number_monthly";

// Included credits halved on 2026-07-29 alongside the US/CA rate cut from 12c to
// 6c. Credits are a DOLLAR allowance, so a cheaper rate means the same dollars buy
// more minutes and cost more to serve - halving the dollars holds included minutes
// roughly constant instead of silently doubling the telephony bill. This is why
// the pricing page now leads with minutes: see includedCallMinutesForPlan, which
// derives them so the two can never drift.
export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlanConfig> = {
  solo: {
    id: "solo",
    name: "Solo",
    stripeLookupKey: "voxandra_solo_monthly",
    monthlyPriceCents: 2900,
    includedCreditCents: 250,
    includedSeats: 1,
    aiFeaturesEnabled: true,
  },
  starter: {
    id: "starter",
    name: "Starter",
    stripeLookupKey: "voxandra_starter_monthly",
    monthlyPriceCents: 4900,
    includedCreditCents: 500,
    // 5, not 3: seats have no direct cost (every cost driver -- included credits,
    // Live Guidance and Live Translation minutes -- is workspace-level, never
    // per-seat), and at 3 a fourth teammate forced a 3x jump to Team purely to
    // add one person. 5 moves that wall to the sixth teammate, where $149 is a
    // far easier decision. Volume, not headcount, still separates the plans.
    includedSeats: 5,
    aiFeaturesEnabled: true,
  },
  team: {
    id: "team",
    name: "Team",
    stripeLookupKey: "voxandra_team_monthly",
    monthlyPriceCents: 14900,
    includedCreditCents: 2500,
    includedSeats: 8,
    aiFeaturesEnabled: true,
  },
  operations: {
    id: "operations",
    name: "Operations",
    stripeLookupKey: "voxandra_operations_monthly",
    // $449 since 2026-07-29. Must stay in lockstep with the live Stripe price
    // under lookup key voxandra_operations_monthly: resolvePriceIdByLookupKey
    // validates the amount and throws, so a mismatch makes the plan unbuyable.
    monthlyPriceCents: 44900,
    includedCreditCents: 7500,
    includedSeats: 12,
    aiFeaturesEnabled: true,
  },
};

export const TOP_UP_OPTIONS: Record<TopUpId, TopUpConfig> = {
  topup_10: {
    id: "topup_10",
    label: "$10",
    stripeLookupKey: "voxandra_topup_10",
    amountCents: 1000,
  },
  topup_25: {
    id: "topup_25",
    label: "$25",
    stripeLookupKey: "voxandra_topup_25",
    amountCents: 2500,
  },
  topup_50: {
    id: "topup_50",
    label: "$50",
    stripeLookupKey: "voxandra_topup_50",
    amountCents: 5000,
  },
  topup_100: {
    id: "topup_100",
    label: "$100",
    stripeLookupKey: "voxandra_topup_100",
    amountCents: 10000,
  },
};

// Included calling allowance expressed the way customers actually think about it.
// Derived from the credit dollars and the live US/CA rate rather than written into
// copy, so a future rate change cannot leave the pricing page claiming minutes the
// credits no longer buy. Approximate by nature: credits are a dollar balance and
// other destinations cost more per minute.
export const INCLUDED_MINUTES_REFERENCE_COUNTRY = "US/CA";

export function includedCallMinutesForPlan(planId: SubscriptionPlanId) {
  const plan = SUBSCRIPTION_PLANS[planId];
  const rate = getRetailRateCentsPerMinute(INCLUDED_MINUTES_REFERENCE_COUNTRY);
  if (!plan || !rate) return null;
  return Math.round(plan.includedCreditCents / rate);
}

// Minutes only, no credit figure. "$2.50 credits" next to "~42 minutes" anchors the
// reader on a small dollar amount and makes the allowance read as less than it is,
// when minutes are what they are actually buying. The dollar balance is still shown
// where it is actionable — the wallet — and the pricing footnote and FAQ both explain
// that one credit balance covers calls plus live-feature overage.
//
// The "~" and the explicit "US/Canada" are load-bearing: credits are a dollar
// balance, so other destinations buy fewer minutes than this figure.
export function formatIncludedCallingAllowance(planId: SubscriptionPlanId) {
  const minutes = includedCallMinutesForPlan(planId);
  if (minutes === null) return null;
  return `~${minutes.toLocaleString()} US/Canada minutes included`;
}

export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function getSubscriptionPlan(planId: string | undefined | null) {
  if (!planId) return null;
  return SUBSCRIPTION_PLANS[planId as SubscriptionPlanId] ?? null;
}

export function getSubscriptionPlanByLookupKey(lookupKey: string | undefined | null) {
  if (!lookupKey) return null;
  return (
    Object.values(SUBSCRIPTION_PLANS).find((plan) => plan.stripeLookupKey === lookupKey) ??
    null
  );
}

export function getTopUpOption(topUpId: string | undefined | null) {
  if (!topUpId) return null;
  return TOP_UP_OPTIONS[topUpId as TopUpId] ?? null;
}

export function getTopUpOptionByLookupKey(lookupKey: string | undefined | null) {
  if (!lookupKey) return null;
  return (
    Object.values(TOP_UP_OPTIONS).find((option) => option.stripeLookupKey === lookupKey) ??
    null
  );
}

export function getCallingNumberRentalLookupKey() {
  return (
    process.env.STRIPE_NUMBER_RENTAL_LOOKUP_KEY?.trim() ||
    DEFAULT_CALLING_NUMBER_RENTAL_LOOKUP_KEY
  );
}

export function isCallingNumberRentalLookupKey(lookupKey: string | undefined | null) {
  return Boolean(lookupKey && lookupKey === getCallingNumberRentalLookupKey());
}

export function estimateCallCostCents(rateCentsPerMinute: number, seconds: number) {
  return estimateBillableCallCostCents(rateCentsPerMinute, seconds);
}

export function getAffordableCallSeconds(args: {
  availableCreditCents: number;
  maxCallSeconds: number;
  rateCentsPerMinute: number;
}) {
  return getAffordableBillableCallSeconds(args);
}
