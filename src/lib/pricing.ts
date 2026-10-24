import {
  formatCents,
  formatIncludedCallingAllowance,
  SUBSCRIPTION_PLANS,
  TOP_UP_OPTIONS,
  type SubscriptionPlanId,
  type TopUpId,
} from "@/lib/billing/config";

import {
  getRealtimePlanEntitlement,
  includedSecondsForFeature,
  overageCentsPerMinuteForFeature,
  type RealtimeFeature,
} from "@/lib/realtime-entitlements";

function formatMonthlyPlanPrice(cents: number) {
  return formatCents(cents).replace(".00", "");
}

// Derived, never hand-written. These strings were hard-coded per plan and every
// one of them said "$0.40/min" — correct only while the Live Guidance overage
// rate was flat across all tiers. The moment it was tiered, all four became
// false advertising, the same class of defect as the three phantom features
// deleted on 2026-07-31. Reading the entitlement makes drift impossible.
function formatLiveFeatureUsage(planId: SubscriptionPlanId, feature: RealtimeFeature) {
  const entitlement = getRealtimePlanEntitlement(planId);
  const includedMinutes = Math.round(includedSecondsForFeature(entitlement, feature) / 60);
  const overage = overageCentsPerMinuteForFeature(entitlement, feature);
  return `${includedMinutes} min/mo included, then $${(overage / 100).toFixed(2)}/min`;
}

// Ratio of a plan's included Live Guidance minutes to Starter's, for copy that
// compares tiers. Rounded to one decimal and trimmed so 3 reads "3x", not "3.0x".
function formatLiveGuidanceMultipleVsStarter(planId: SubscriptionPlanId) {
  const starter = includedSecondsForFeature(
    getRealtimePlanEntitlement("starter"),
    "live_copilot"
  );
  const plan = includedSecondsForFeature(getRealtimePlanEntitlement(planId), "live_copilot");
  if (starter <= 0) return "More of";
  const ratio = plan / starter;
  return `${Number(ratio.toFixed(1))}x`;
}

export interface PublicPricingPlan {
  planId?: string;
  stripeLookupKey?: string;
  publicCheckout?:
    | { type: "subscription"; planId: SubscriptionPlanId }
    | { type: "top_up"; topUpId: TopUpId };
  monthlyPriceCents?: number;
  includedCreditCents?: number;
  includedSeats?: number;
  name: string;
  price: string | null;
  priceLabel?: string;
  period: string | null;
  seats: string | null;
  credits: string | null;
  description: string;
  features: string[];
  realtimeCallout?: {
    eyebrow: string;
    title: string;
    details: string[];
  };
  liveFeatureCallouts?: Array<{
    tone: "purple" | "green";
    title: string;
    description: string;
    usage: string;
  }>;
  badge?: string;
  featured?: boolean;
  secondary?: boolean;
  ctaText: string;
  ctaHref?: string;
}

export const soloMemoryPlan: PublicPricingPlan = {
  planId: "solo",
  stripeLookupKey: SUBSCRIPTION_PLANS.solo.stripeLookupKey,
  monthlyPriceCents: SUBSCRIPTION_PLANS.solo.monthlyPriceCents,
  includedCreditCents: SUBSCRIPTION_PLANS.solo.includedCreditCents,
  includedSeats: SUBSCRIPTION_PLANS.solo.includedSeats,
  name: "Solo",
  price: formatMonthlyPlanPrice(SUBSCRIPTION_PLANS.solo.monthlyPriceCents),
  period: "/month",
  seats: "1 seat included",
  credits: formatIncludedCallingAllowance("solo"),
  description: "For one person who makes important calls abroad",
  features: [
    "Reviewed Call Records: notes, transcripts, extracted details",
    "Review every record before it's trusted",
    "Pre-call briefs and workflow templates",
    "Contacts, reminders, and work threads",
  ],
  liveFeatureCallouts: [
    {
      tone: "purple",
      title: "Live Guidance",
      description: "Private in-call guidance",
      usage: formatLiveFeatureUsage("solo", "live_copilot"),
    },
    {
      tone: "green",
      title: "Live Voice Translation",
      description: "Two-way spoken translation for business calls",
      usage: formatLiveFeatureUsage("solo", "translated_audio"),
    },
  ],
  ctaText: "Start Solo",
  publicCheckout: { type: "subscription", planId: "solo" },
};

export const memoryPlans: PublicPricingPlan[] = [
  {
    planId: "starter",
    stripeLookupKey: SUBSCRIPTION_PLANS.starter.stripeLookupKey,
    monthlyPriceCents: SUBSCRIPTION_PLANS.starter.monthlyPriceCents,
    includedCreditCents: SUBSCRIPTION_PLANS.starter.includedCreditCents,
    includedSeats: SUBSCRIPTION_PLANS.starter.includedSeats,
    name: "Starter",
    price: formatMonthlyPlanPrice(SUBSCRIPTION_PLANS.starter.monthlyPriceCents),
    period: "/month",
    seats: "5 seats included",
    credits: formatIncludedCallingAllowance("starter"),
    description: "For a small team starting translated calls",
    features: [
      "Reviewed Call Records: notes, transcripts, extracted details",
      "Review every record before it's trusted",
      "Pre-call briefs and workflow templates",
      "Shared contacts, reminders, and work threads",
      // Direct email support starts at Starter: the team plans are the ones a
      // business depends on, and Solo is a single-professional plan. This is a
      // commitment a person honours, not a code path — do not add a claim here
      // that nothing in the product implements (see the 2026-07-31 removals).
      "Direct email support",
    ],
    liveFeatureCallouts: [
      {
        tone: "purple",
        title: "Live Guidance",
        description: "Private in-call guidance",
        usage: formatLiveFeatureUsage("starter", "live_copilot"),
      },
      {
        tone: "green",
        title: "Live Voice Translation",
        description: "Two-way spoken translation for business calls",
        usage: formatLiveFeatureUsage("starter", "translated_audio"),
      },
    ],
    ctaText: "Start Starter",
    publicCheckout: { type: "subscription", planId: "starter" },
  },
  {
    planId: "team",
    stripeLookupKey: SUBSCRIPTION_PLANS.team.stripeLookupKey,
    monthlyPriceCents: SUBSCRIPTION_PLANS.team.monthlyPriceCents,
    includedCreditCents: SUBSCRIPTION_PLANS.team.includedCreditCents,
    includedSeats: SUBSCRIPTION_PLANS.team.includedSeats,
    name: "Team",
    price: "$149",
    period: "/month",
    seats: "8 seats included",
    credits: formatIncludedCallingAllowance("team"),
    description: "For teams running recurring phone workflows across languages",
    features: [
      "Everything in Starter, plus:",
      // "priority processing" and "Advanced extraction" removed 2026-07-31:
      // neither existed anywhere in the product. Every line here must name
      // something a customer can actually observe.
      // Derived: this said "4x" and became false the moment Team went 250 -> 180
      // minutes (it is now 3x). Same drift class as the "$0.40/min" strings.
      `${formatLiveGuidanceMultipleVsStarter("team")} the Live Guidance minutes of Starter`,
      "8 seats and shared workspace history",
      "Direct email support",
    ],
    liveFeatureCallouts: [
      {
        tone: "purple",
        title: "Live Guidance",
        description: "Private in-call guidance",
        usage: formatLiveFeatureUsage("team", "live_copilot"),
      },
      {
        tone: "green",
        title: "Live Voice Translation",
        description: "Two-way spoken translation for business calls",
        usage: formatLiveFeatureUsage("team", "translated_audio"),
      },
    ],
    badge: "Most popular",
    featured: true,
    ctaText: "Start Team",
    publicCheckout: { type: "subscription", planId: "team" },
  },
  {
    planId: "operations",
    stripeLookupKey: SUBSCRIPTION_PLANS.operations.stripeLookupKey,
    monthlyPriceCents: SUBSCRIPTION_PLANS.operations.monthlyPriceCents,
    includedCreditCents: SUBSCRIPTION_PLANS.operations.includedCreditCents,
    includedSeats: SUBSCRIPTION_PLANS.operations.includedSeats,
    name: "Operations",
    price: "$449",
    period: "/month",
    seats: "12 seats included",
    credits: formatIncludedCallingAllowance("operations"),
    description: "For high-volume international operations teams",
    features: [
      "Everything in Team, plus:",
      "Highest reviewed Call Record usage",
      "Workspace-level contacts and thread-aware notes",
      // "Admin controls and priority support" removed 2026-07-31: there were no
      // admin controls beyond the seat limit every plan enforces, and no support
      // tier existed. Replaced with the two things that are actually true.
      "12 seats included",
      "Direct email support",
    ],
    liveFeatureCallouts: [
      {
        tone: "purple",
        title: "Live Guidance",
        description: "Private in-call guidance",
        usage: formatLiveFeatureUsage("operations", "live_copilot"),
      },
      {
        tone: "green",
        title: "Live Voice Translation",
        description: "Two-way spoken translation for business calls",
        usage: formatLiveFeatureUsage("operations", "translated_audio"),
      },
    ],
    ctaText: "Start Operations",
    publicCheckout: { type: "subscription", planId: "operations" },
  },
];

export const publicMemoryPlans: PublicPricingPlan[] = [
  soloMemoryPlan,
  ...memoryPlans,
];

export const enterprisePlan: PublicPricingPlan = {
  name: "Enterprise",
  price: null,
  priceLabel: "Contact us",
  period: null,
  seats: "13+ seats",
  credits: "Custom calling credits and usage limits",
  description: "Custom seats, credits, multilingual calling usage, rollout, and compliance support.",
  features: [
    "Custom seat count and usage limits",
    "High-volume multilingual calling planning",
    "Custom Live Guidance limits and rollout support",
    "Compliance, support, and rollout help",
  ],
  realtimeCallout: {
    eyebrow: "Enterprise Live Guidance",
    title: "Custom Live Guidance limits",
    details: [
      "Custom Live Guidance and Live Translation caps",
      "Rollout and compliance support",
    ],
  },
  ctaText: "Contact us",
  ctaHref: "mailto:contact@voxandra.com?subject=Voxandra%20Enterprise",
};

export const callsOnlyPlan: PublicPricingPlan = {
  name: "Calls only",
  price: null,
  priceLabel: "No subscription",
  period: null,
  seats: null,
  credits: null,
  description: "Browser calling without AI Call Records or realtime AI features.",
  features: [
    "Affordable international browser calls",
    "Rates before calling",
    "Basic call history",
    "No AI call records or transcripts",
    "No Live Guidance or Live Translation",
  ],
  secondary: true,
  ctaText: "Buy credits",
  publicCheckout: { type: "top_up", topUpId: "topup_25" },
};

export const topUpPlans = Object.values(TOP_UP_OPTIONS);
