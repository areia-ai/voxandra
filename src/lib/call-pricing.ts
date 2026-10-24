import {
  getDestinationCountryForPrefix,
  getRetailRateCentsPerMinute,
} from "./calling-rates";
import {
  resolveRateForDigits,
  type RatePrefixEntry,
  type RateResolution,
  type RateTier,
} from "./rate-prefix-lookup";
import {
  AI_EXTRACTION_ALLOWANCE_CENTS_PER_MINUTE,
  OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE,
  TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE,
  TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE,
  TWILIO_PROVIDER_RATES,
  TWILIO_RATE_CATALOG_VERSION,
  TWILIO_RECORDING_COST_CENTS_PER_MINUTE,
  type TwilioProviderRate,
  type TwilioProviderRateClassification,
  type TwilioProviderRateOriginGroup,
} from "./twilio-rate-catalog";

export type CallMarginStatus = "healthy" | "blocked";

export type OutboundCallQuote = {
  available: boolean;
  destinationE164: string;
  destinationCountry: string;
  routeType: string;
  providerCostCentsPerMinute: number | null;
  aiCaptureCostCentsPerMinute: number;
  totalVariableCostCentsPerMinute: number | null;
  baselineRetailRateCentsPerMinute: number | null;
  rateCentsPerMinute: number | null;
  billingIncrementSeconds: number;
  minimumBillableSeconds: number;
  minimumChargeCents: number | null;
  marginMultiple: number | null;
  marginStatus: CallMarginStatus;
  aiCaptureEnabled: boolean;
  pricingCatalogVersion: string;
  pricingSource: string | null;
  blockReason: string | null;
};

export const MINIMUM_MARGIN_MULTIPLE = 2;
// 2x means each plan keeps at least 50% gross margin even if a customer consumes
// every included credit and every included realtime minute in a month. Deliberately
// a catastrophe floor, not a target: real utilization is far below 100%.
export const PLAN_MINIMUM_MARGIN_MULTIPLE = 2;
// Lowered 12 -> 6 on 2026-07-29. This absolute floor, not cost and not
// MINIMUM_MARGIN_MULTIPLE, was what held US/CA at 12c while its telephony cost is
// 2.0c. Each destination is still protected by its own 2x telephony floor, so
// this only stops the card going implausibly low.
export const MINIMUM_RETAIL_RATE_CENTS_PER_MINUTE = 6;
// 99 -> 150 -> 240 on 2026-07-31, alongside the catalog resync that put real
// US-origin provider costs in place. Voxandra calls from a US number and expects
// most customers to do the same, so the non-EEA-origin surcharge on EU mobile is
// the normal case rather than an edge case: Portugal mobile costs 49.5c/min from
// a US caller ID (verified against Twilio's own price on live calls), whose 2x
// floor is 100c and was blocked outright by the original 99c cap.
//
// 150 was still refusing nine standard routes, and it split countries in a way
// that made no sense to sell: Serbian, Croatian, Montenegrin, Kosovan and
// Macedonian LANDLINES were quotable while their MOBILES were refused, and Macau
// was unreachable entirely. 240c admits every standard route in the catalog —
// the most expensive is Kosovo mobile at 117.14c, needing 236c. This is a
// deliberate product decision: Voxandra sells to companies that pay
// international rates, so an expensive route should be priced honestly rather
// than hidden. The guardrail still matters — blocked_* classifications (premium,
// special service, shared cost, satellite) are refused on classification no
// matter how the arithmetic lands, and any future provider increase that pushes a
// standard route past 240c fails closed rather than silently repricing.
export const MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE = 240;
// Narrow outbound exceptions for standard routes that have been live-quoted,
// reviewed, and intentionally offered above the general launch cap. The route
// still fails closed if a future provider-price increase pushes the 2x floor
// above its explicit ceiling. `lithuania_mobile: 120` was removed with the cap
// raise: an entry below the global cap would silently make a route *stricter*
// than the default, which inverts what this map is for.
export const OUTBOUND_SELF_SERVE_RATE_CAP_EXCEPTIONS_CENTS_PER_MINUTE: Record<
  string,
  number
> = {};
export const CALL_BILLING_INCREMENT_SECONDS = 60;
export const MINIMUM_BILLABLE_CALL_SECONDS = 60;

const EEA_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

export const BLOCKED_DESTINATION_PREFIXES: Array<{
  prefix: string;
  classification: Exclude<TwilioProviderRateClassification, "standard">;
  reason: string;
}> = [
  {
    prefix: "+1900",
    classification: "blocked_premium",
    reason: "Premium-rate NANP routes are not available for self-serve calling.",
  },
  {
    prefix: "+1976",
    classification: "blocked_premium",
    reason: "Premium-rate NANP routes are not available for self-serve calling.",
  },
  {
    prefix: "+800",
    classification: "blocked_special_service",
    reason: "International toll-free and special-service routes are not available.",
  },
  {
    prefix: "+808",
    classification: "blocked_shared_cost",
    reason: "Shared-cost routes are not available for self-serve calling.",
  },
  {
    prefix: "+870",
    classification: "blocked_satellite",
    reason: "Satellite routes are not available for self-serve calling.",
  },
  {
    prefix: "+878",
    classification: "blocked_special_service",
    reason: "Universal personal telecommunications routes are not available.",
  },
  {
    prefix: "+881",
    classification: "blocked_satellite",
    reason: "Satellite routes are not available for self-serve calling.",
  },
  {
    prefix: "+882",
    classification: "blocked_special_service",
    reason: "International networks are not available for self-serve calling.",
  },
  {
    prefix: "+883",
    classification: "blocked_special_service",
    reason: "International networks are not available for self-serve calling.",
  },
  {
    prefix: "+979",
    classification: "blocked_premium",
    reason: "Premium-rate international routes are not available for self-serve calling.",
  },
];

export const BLOCKED_EMERGENCY_SERVICE_CODES = new Set(["000", "110", "112", "119", "911", "999"]);

function normalizeCountryCode(country: string | undefined | null) {
  const normalized = country?.trim().toUpperCase();
  return normalized || undefined;
}

function normalizeE164(value: string | undefined | null) {
  return value?.replace(/[^\d+]/g, "") ?? "";
}

function getOriginCountry(args: {
  originCountry?: string | null;
  originE164?: string | null;
}) {
  const explicitCountry = normalizeCountryCode(args.originCountry);
  if (explicitCountry) return explicitCountry;

  const originE164 = normalizeE164(args.originE164);
  if (!originE164) return undefined;
  const country = getDestinationCountryForPrefix(originE164);
  return country === "unknown" ? undefined : country;
}

function getOriginGroup(args: {
  destinationCountry: string;
  originCountry?: string;
}): TwilioProviderRateOriginGroup {
  if (args.destinationCountry === "ZA") {
    return args.originCountry === "ZA" ? "za" : "non_za";
  }

  if (EEA_COUNTRIES.has(args.destinationCountry)) {
    return args.originCountry && EEA_COUNTRIES.has(args.originCountry) ? "eea" : "non_eea";
  }

  return "any";
}

function matchingPrefixLength(destinationE164: string, rate: TwilioProviderRate) {
  const match = rate.prefixes
    .filter((prefix) => destinationE164.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  return match?.length ?? 0;
}

function findBlockedPrefix(destinationE164: string) {
  return BLOCKED_DESTINATION_PREFIXES.find((entry) =>
    destinationE164.startsWith(entry.prefix)
  );
}

function findProviderRate(args: {
  destinationE164: string;
  destinationCountry: string;
  originGroup: TwilioProviderRateOriginGroup;
}) {
  const matches = TWILIO_PROVIDER_RATES.filter(
    (rate) =>
      rate.destinationCountry === args.destinationCountry &&
      matchingPrefixLength(args.destinationE164, rate) > 0 &&
      (rate.originGroup === args.originGroup || rate.originGroup === "any")
  ).sort((a, b) => {
    const prefixDelta =
      matchingPrefixLength(args.destinationE164, b) -
      matchingPrefixLength(args.destinationE164, a);
    if (prefixDelta !== 0) return prefixDelta;
    if (a.originGroup === args.originGroup && b.originGroup !== args.originGroup) return -1;
    if (b.originGroup === args.originGroup && a.originGroup !== args.originGroup) return 1;
    return 0;
  });

  return matches[0] ?? null;
}

function aiCaptureCostCentsPerMinute(aiCaptureEnabled: boolean) {
  if (!aiCaptureEnabled) return 0;
  return (
    TWILIO_RECORDING_COST_CENTS_PER_MINUTE +
    OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE +
    AI_EXTRACTION_ALLOWANCE_CENTS_PER_MINUTE
  );
}

export function getBillableCallSeconds(actualSeconds: number) {
  if (actualSeconds <= 0) return 0;
  return Math.max(
    MINIMUM_BILLABLE_CALL_SECONDS,
    Math.ceil(actualSeconds / CALL_BILLING_INCREMENT_SECONDS) *
      CALL_BILLING_INCREMENT_SECONDS
  );
}

export function estimateBillableCallCostCents(
  rateCentsPerMinute: number,
  actualSeconds: number
) {
  const billableSeconds = getBillableCallSeconds(actualSeconds);
  if (billableSeconds <= 0) return 0;
  return Math.max(1, Math.ceil((rateCentsPerMinute * billableSeconds) / 60));
}

export function getAffordableBillableCallSeconds(args: {
  availableCreditCents: number;
  maxCallSeconds: number;
  rateCentsPerMinute: number;
}) {
  if (args.availableCreditCents < args.rateCentsPerMinute) return 0;
  const affordableStartedMinutes = Math.floor(
    Math.max(0, args.availableCreditCents) / args.rateCentsPerMinute
  );
  return Math.min(args.maxCallSeconds, affordableStartedMinutes * 60);
}

function blockedQuote(args: {
  destinationE164: string;
  destinationCountry: string;
  routeType?: string;
  aiCaptureCostCentsPerMinute: number;
  aiCaptureEnabled: boolean;
  baselineRetailRateCentsPerMinute: number | null;
  blockReason: string;
  providerRate?: TwilioProviderRate | null;
}) {
  return {
    available: false,
    destinationE164: args.destinationE164,
    destinationCountry: args.destinationCountry,
    routeType: args.routeType ?? "unknown",
    providerCostCentsPerMinute: args.providerRate?.providerCostCentsPerMinute ?? null,
    aiCaptureCostCentsPerMinute: args.aiCaptureCostCentsPerMinute,
    totalVariableCostCentsPerMinute:
      args.providerRate?.providerCostCentsPerMinute === undefined
        ? null
        : args.providerRate.providerCostCentsPerMinute +
          TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE +
          args.aiCaptureCostCentsPerMinute,
    baselineRetailRateCentsPerMinute: args.baselineRetailRateCentsPerMinute,
    rateCentsPerMinute: null,
    billingIncrementSeconds: CALL_BILLING_INCREMENT_SECONDS,
    minimumBillableSeconds: MINIMUM_BILLABLE_CALL_SECONDS,
    minimumChargeCents: null,
    marginMultiple: null,
    marginStatus: "blocked" as const,
    aiCaptureEnabled: args.aiCaptureEnabled,
    pricingCatalogVersion: TWILIO_RATE_CATALOG_VERSION,
    pricingSource: args.providerRate?.source ?? null,
    blockReason: args.blockReason,
  };
}

// Which route will bill a partially typed number, and whether that is settled
// yet. The authenticated dialer uses this instead of the generated per-country
// prefix tables the public landing page loads: it already has the whole catalog
// server-side, and both paths share resolveRateForDigits so they cannot disagree
// about the same number.
//
// The retail figure here is each route's own 2x floor, which is exactly what
// quoteOutboundCall charges: the card's baseline is by construction the cheapest
// route's floor, so max(baseline, routeFloor, absoluteFloor) always reduces to the
// route's own floor.
export function resolveDestinationRateDetail(args: {
  destinationE164: string;
  originCountry?: string | null;
  originE164?: string | null;
}): RateResolution {
  const destinationE164 = normalizeE164(args.destinationE164);
  const destinationCountry = getDestinationCountryForPrefix(destinationE164);
  if (destinationCountry === "unknown") return { status: "unknown" };
  const originGroup = getOriginGroup({
    destinationCountry,
    originCountry: getOriginCountry(args),
  });

  const blockedPrefix = findBlockedPrefix(destinationE164);
  const entries: RatePrefixEntry[] = [];
  const countryRates = TWILIO_PROVIDER_RATES.filter(
    (rate) =>
      rate.destinationCountry === destinationCountry &&
      (rate.originGroup === originGroup || rate.originGroup === "any")
  );
  const routeSlugs = countryRates.map((rate) => rate.routeType).sort((a, b) => a.length - b.length);
  const baseSlug = routeSlugs.find((candidate) =>
    routeSlugs.every((slug) => slug === candidate || slug.startsWith(candidate))
  );

  for (const rate of countryRates) {
    const telephonyCost =
      rate.providerCostCentsPerMinute + TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE;
    const retail = Math.max(
      MINIMUM_RETAIL_RATE_CENTS_PER_MINUTE,
      Math.ceil(telephonyCost * MINIMUM_MARGIN_MULTIPLE)
    );
    const cap =
      OUTBOUND_SELF_SERVE_RATE_CAP_EXCEPTIONS_CENTS_PER_MINUTE[rate.routeType] ??
      MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE;
    const refused = rate.classification !== "standard" || retail > cap || Boolean(blockedPrefix);
    const tier: RateTier =
      rate.classification !== "standard"
        ? "special"
        : /(^|_)mobile(_|$)/.test(rate.routeType)
          ? "mobile"
          : rate.routeType === baseSlug
            ? "landline"
            : "other";
    for (const prefix of rate.prefixes) {
      entries.push({
        prefix: prefix.replace(/\D/g, ""),
        rateCentsPerMinute: refused ? 0 : retail,
        tier,
      });
    }
  }

  return resolveRateForDigits(entries, destinationE164);
}

export function quoteOutboundCall(args: {
  destinationE164: string;
  originCountry?: string | null;
  originE164?: string | null;
  aiCaptureEnabled: boolean;
}): OutboundCallQuote {
  const destinationE164 = normalizeE164(args.destinationE164);
  const destinationCountry = getDestinationCountryForPrefix(destinationE164);
  const captureCost = aiCaptureCostCentsPerMinute(args.aiCaptureEnabled);
  const baselineRetailRateCentsPerMinute =
    getRetailRateCentsPerMinute(destinationCountry) ?? null;

  if (!destinationE164.startsWith("+")) {
    return blockedQuote({
      destinationE164,
      destinationCountry: "unknown",
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute: null,
      blockReason: "Enter a full international number.",
    });
  }

  const blockedPrefix = findBlockedPrefix(destinationE164);
  if (blockedPrefix) {
    return blockedQuote({
      destinationE164,
      destinationCountry,
      routeType: blockedPrefix.classification,
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute,
      blockReason: blockedPrefix.reason,
    });
  }

  if (BLOCKED_EMERGENCY_SERVICE_CODES.has(destinationE164.replace(/[^\d]/g, ""))) {
    return blockedQuote({
      destinationE164,
      destinationCountry,
      routeType: "blocked_emergency",
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute,
      blockReason: "Emergency service codes are not available from Voxandra browser calling.",
    });
  }

  if (destinationCountry === "unknown") {
    return blockedQuote({
      destinationE164,
      destinationCountry,
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute,
      blockReason: "This destination needs a provider-rate quote before launch.",
    });
  }

  const originCountry = getOriginCountry(args);
  const originGroup = getOriginGroup({ destinationCountry, originCountry });
  const providerRate = findProviderRate({
    destinationE164,
    destinationCountry,
    originGroup,
  });

  if (!providerRate) {
    return blockedQuote({
      destinationE164,
      destinationCountry,
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute,
      blockReason: "This destination needs a current Twilio provider-rate row before launch.",
    });
  }

  if (providerRate.classification !== "standard") {
    return blockedQuote({
      destinationE164,
      destinationCountry,
      routeType: providerRate.routeType,
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute,
      providerRate,
      blockReason: "This provider route is not available for self-serve calling.",
    });
  }

  if (!baselineRetailRateCentsPerMinute) {
    return blockedQuote({
      destinationE164,
      destinationCountry,
      routeType: providerRate.routeType,
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute,
      providerRate,
      blockReason: "This destination does not have a public Voxandra retail rate yet.",
    });
  }

  // The per-minute rate prices TELEPHONY. AI capture (recording, transcription,
  // extraction) is a subscription feature: only subscribers get it, and the plan
  // price funds it — see assertPlanCoversAiCost. Folding capture into this floor
  // made calls-only customers carry AI cost they never use and held cheap routes
  // artificially high. totalVariableCostCentsPerMinute still reports all-in cost
  // for telemetry and the margin multiple; only the floor is telephony-scoped.
  const telephonyCostCentsPerMinute =
    providerRate.providerCostCentsPerMinute + TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE;
  const totalVariableCostCentsPerMinute = telephonyCostCentsPerMinute + captureCost;
  const minimumMarginRetailRate = Math.ceil(
    telephonyCostCentsPerMinute * MINIMUM_MARGIN_MULTIPLE
  );
  const rateCentsPerMinute = Math.max(
    baselineRetailRateCentsPerMinute,
    minimumMarginRetailRate,
    MINIMUM_RETAIL_RATE_CENTS_PER_MINUTE
  );
  const marginMultiple = Number(
    (rateCentsPerMinute / totalVariableCostCentsPerMinute).toFixed(2)
  );
  const selfServeRateCapCentsPerMinute =
    OUTBOUND_SELF_SERVE_RATE_CAP_EXCEPTIONS_CENTS_PER_MINUTE[providerRate.routeType] ??
    MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE;

  if (rateCentsPerMinute > selfServeRateCapCentsPerMinute) {
    return blockedQuote({
      destinationE164,
      destinationCountry,
      routeType: providerRate.routeType,
      aiCaptureCostCentsPerMinute: captureCost,
      aiCaptureEnabled: args.aiCaptureEnabled,
      baselineRetailRateCentsPerMinute,
      providerRate,
      blockReason: "This route is above the current self-serve launch cap.",
    });
  }

  return {
    available: true,
    destinationE164,
    destinationCountry,
    routeType: providerRate.routeType,
    providerCostCentsPerMinute: providerRate.providerCostCentsPerMinute,
    aiCaptureCostCentsPerMinute: captureCost,
    totalVariableCostCentsPerMinute,
    baselineRetailRateCentsPerMinute,
    rateCentsPerMinute,
    billingIncrementSeconds: CALL_BILLING_INCREMENT_SECONDS,
    minimumBillableSeconds: MINIMUM_BILLABLE_CALL_SECONDS,
    minimumChargeCents: estimateBillableCallCostCents(
      rateCentsPerMinute,
      MINIMUM_BILLABLE_CALL_SECONDS
    ),
    marginMultiple,
    marginStatus: "healthy",
    aiCaptureEnabled: args.aiCaptureEnabled,
    pricingCatalogVersion: TWILIO_RATE_CATALOG_VERSION,
    pricingSource: providerRate.source,
    blockReason: null,
  };
}

export function quoteInboundForwardingCall(args: {
  forwardingE164: string;
  inboundNumberE164: string;
  originCountry?: string | null;
  aiCaptureEnabled: boolean;
}): OutboundCallQuote {
  const outboundQuote = quoteOutboundCall({
    destinationE164: args.forwardingE164,
    originE164: args.inboundNumberE164,
    originCountry: args.originCountry,
    aiCaptureEnabled: args.aiCaptureEnabled,
  });

  if (!outboundQuote.available || !outboundQuote.rateCentsPerMinute) {
    return {
      ...outboundQuote,
      routeType: `inbound_forwarding_${outboundQuote.routeType}`,
    };
  }

  const providerCostCentsPerMinute =
    (outboundQuote.providerCostCentsPerMinute ?? 0) +
    TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE;
  const totalVariableCostCentsPerMinute =
    (outboundQuote.providerCostCentsPerMinute ?? 0) +
    TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE +
    outboundQuote.aiCaptureCostCentsPerMinute;
  const minimumMarginRetailRate = Math.ceil(
    totalVariableCostCentsPerMinute * MINIMUM_MARGIN_MULTIPLE
  );
  const rateCentsPerMinute = Math.max(
    outboundQuote.baselineRetailRateCentsPerMinute ?? 0,
    minimumMarginRetailRate,
    MINIMUM_RETAIL_RATE_CENTS_PER_MINUTE
  );
  const marginMultiple = Number(
    (rateCentsPerMinute / totalVariableCostCentsPerMinute).toFixed(2)
  );

  if (rateCentsPerMinute > MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE) {
    return {
      ...outboundQuote,
      available: false,
      routeType: `inbound_forwarding_${outboundQuote.routeType}`,
      providerCostCentsPerMinute,
      totalVariableCostCentsPerMinute,
      rateCentsPerMinute: null,
      minimumChargeCents: null,
      marginMultiple: null,
      marginStatus: "blocked",
      blockReason: "This inbound forwarding route is above the current self-serve launch cap.",
    };
  }

  return {
    ...outboundQuote,
    routeType: `inbound_forwarding_${outboundQuote.routeType}`,
    providerCostCentsPerMinute,
    totalVariableCostCentsPerMinute,
    rateCentsPerMinute,
    minimumChargeCents: estimateBillableCallCostCents(
      rateCentsPerMinute,
      MINIMUM_BILLABLE_CALL_SECONDS
    ),
    marginMultiple,
  };
}

/**
 * Plan-level margin guard.
 *
 * Counterpart to the per-minute rate floor. Since 2026-07-29 the call rate covers
 * telephony only, so AI capture (recording, transcription, extraction) is funded by
 * the subscription instead — and something has to check that it actually is.
 *
 * Worst case per plan is every included credit spent on the cheapest destination
 * (most minutes, therefore most capture cost) with AI capture on, plus every
 * included realtime minute consumed. Included minutes are free to the customer, so
 * they generate no usage revenue and must be covered by the plan price alone.
 *
 * Throws rather than warns: a plan whose price cannot cover its own worst case is a
 * pricing bug, and it should fail a test run rather than reach production quietly.
 */
export function assertPlanCoversAiCost(args: {
  planId: string;
  monthlyPriceCents: number;
  includedCreditCents: number;
  cheapestRateCentsPerMinute: number;
  includedLiveGuidanceMinutes: number;
  includedLiveTranslationMinutes: number;
  liveGuidanceCostCentsPerMinute: number;
  liveTranslationCostCentsPerMinute: number;
  minimumMarginMultiple?: number;
}) {
  const multiple = args.minimumMarginMultiple ?? PLAN_MINIMUM_MARGIN_MULTIPLE;
  const minutesCreditsBuy = args.includedCreditCents / args.cheapestRateCentsPerMinute;
  const captureCost = minutesCreditsBuy * aiCaptureCostCentsPerMinute(true);
  const guidanceCost = args.includedLiveGuidanceMinutes * args.liveGuidanceCostCentsPerMinute;
  const translationCost =
    args.includedLiveTranslationMinutes * args.liveTranslationCostCentsPerMinute;
  // Credits are an allowance, not a cost: Voxandra pays the telephony cost of the
  // minutes actually dialled. Worst case is credits x (telephonyCost / retailRate),
  // and MINIMUM_MARGIN_MULTIPLE caps that ratio at 1/2 for every destination, so
  // credits/2 is the true upper bound. Using face value here instead would overstate
  // this line by 2x and reject viable plans.
  const telephonyCost = args.includedCreditCents / MINIMUM_MARGIN_MULTIPLE;
  const aiAndUsageCost = telephonyCost + captureCost + guidanceCost + translationCost;

  if (args.monthlyPriceCents < aiAndUsageCost * multiple) {
    const needed = Math.ceil(aiAndUsageCost * multiple);
    throw new Error(
      `Plan ${args.planId} costs up to ${aiAndUsageCost.toFixed(0)} cents/month at full utilization (telephony ${telephonyCost.toFixed(0)}, AI capture ${captureCost.toFixed(0)}, Live Guidance ${guidanceCost.toFixed(0)}, Live Translation ${translationCost.toFixed(0)}) but is priced at ${args.monthlyPriceCents} cents, below the ${multiple}x floor of ${needed} cents. Raise the price, cut included credits, or cut included realtime minutes.`
    );
  }
}

/**
 * Bridge-GA Phase 1b (2026-08-13, see LOG.md): internal-only real telephony
 * cost estimate for a completed two-leg translation bridge call. The bridge
 * places two genuinely separate Twilio Call resources — the browser
 * (parent) leg and the callee leg — where an ordinary call has exactly one.
 * Each leg pays its own TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE platform
 * fee; the callee leg additionally pays the real destination carrier rate
 * (calleeProviderCostCentsPerMinute — the same call.providerCostCentsPerMinute
 * every normal call already has stored from quoteOutboundCall at creation
 * time, so no new rate lookup is needed here).
 *
 * This does not change what the customer is charged (that stays the
 * existing per-call retail-rate reservation, settled off the callee leg's
 * duration — see settleCallReservation) — it exists purely so Voxandra can
 * see what a bridge call actually costs, replacing the flat, wrong "~0.44c
 * second Twilio media stream" assumption that used to be folded into the
 * translated_audio AI-cost meter (that flat figure was inherited from the
 * private listen-along topology, where a second stream rides the SAME
 * Twilio call — not the bridge's genuinely separate, destination-variable
 * second leg).
 *
 * Returns undefined if either leg's duration isn't known yet (calls land in
 * two independent, asynchronously-arriving terminal callbacks — whichever
 * arrives second has both durations available; the first does not).
 */
export function computeBridgeInternalCostCents(args: {
  parentDurationSeconds: number | undefined;
  calleeDurationSeconds: number | undefined;
  calleeProviderCostCentsPerMinute: number | null | undefined;
}): number | undefined {
  if (args.parentDurationSeconds === undefined || args.calleeDurationSeconds === undefined) {
    return undefined;
  }
  const parentMinutes = args.parentDurationSeconds / 60;
  const calleeMinutes = args.calleeDurationSeconds / 60;
  const platformFeeCents =
    (parentMinutes + calleeMinutes) * TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE;
  const carrierCents = calleeMinutes * (args.calleeProviderCostCentsPerMinute ?? 0);
  return platformFeeCents + carrierCents;
}
