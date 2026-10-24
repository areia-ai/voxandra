// Resolving a typed phone number to the exact route that will bill it.
//
// The rate a call is charged depends on the number range, not the country: a
// Portuguese landline is 1.71c/min and a Portuguese mobile 49.5c/min from a US
// caller ID. Twilio bills by that range too, so this is not a guess about the
// handset — number portability cannot make the displayed price wrong.
//
// One rule, two data sources. The public landing dialer feeds it a lazily loaded
// per-country prefix table (see scripts/derive-rate-prefix-tables.mjs); the
// authenticated dialer feeds it the full provider catalog server-side. Keeping the
// rule here is what stops the two surfaces disagreeing about the same number.

export type RateTier = "mobile" | "landline" | "special" | "other";

export type RatePrefixEntry = {
  /** Digits only, no leading "+". */
  prefix: string;
  /** Retail cents per minute, or 0 when the route is refused at quote time. */
  rateCentsPerMinute: number;
  tier: RateTier;
};

export type RateResolution =
  | {
      status: "resolved";
      rateCentsPerMinute: number;
      tier: RateTier;
    }
  | {
      /** More than one price is still reachable as the caller keeps typing. */
      status: "ambiguous";
      minCentsPerMinute: number | null;
      maxCentsPerMinute: number | null;
    }
  | {
      /** Every reachable route is refused — premium, special service, over the cap. */
      status: "refused";
    }
  | {
      /** No prefix data covers these digits; the caller should fall back. */
      status: "unknown";
    };

/** Digits of an E.164 number, without the leading "+" or any formatting. */
export function toDialedDigits(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

// A tier ranking for the rare case where several routes share one price but
// disagree on tier: prefer the concrete ones over the catch-alls, so a resolved
// price is labelled "mobile" rather than "other" when both apply.
const TIER_PRIORITY: RateTier[] = ["mobile", "landline", "special", "other"];

function pickTier(tiers: RateTier[]): RateTier {
  for (const tier of TIER_PRIORITY) {
    if (tiers.includes(tier)) return tier;
  }
  return "other";
}

export function resolveRateForDigits(
  entries: readonly RatePrefixEntry[],
  dialedDigits: string
): RateResolution {
  const digits = toDialedDigits(dialedDigits);
  if (digits.length === 0 || entries.length === 0) return { status: "unknown" };

  // The route that bills the number as typed: longest prefix that the digits
  // already contain. Mirrors the longest-prefix match quoteOutboundCall uses.
  let matched: RatePrefixEntry | undefined;
  // Routes still reachable if the caller keeps typing — a prefix that extends
  // what has been entered so far. Without these, "+3519" would confidently show
  // the 6c Portuguese landline rate one keystroke before "+35191" jumps to
  // $1.00, which reads as a bait and switch.
  const reachable: RatePrefixEntry[] = [];
  for (const entry of entries) {
    if (digits.startsWith(entry.prefix)) {
      if (!matched || entry.prefix.length > matched.prefix.length) matched = entry;
    } else if (entry.prefix.startsWith(digits)) {
      reachable.push(entry);
    }
  }

  const candidates = matched ? [matched, ...reachable] : reachable;
  if (candidates.length === 0) return { status: "unknown" };

  const prices = [...new Set(candidates.map((c) => c.rateCentsPerMinute))];
  if (prices.length === 1) {
    const [rateCentsPerMinute] = prices;
    if (rateCentsPerMinute === 0) return { status: "refused" };
    return {
      status: "resolved",
      rateCentsPerMinute,
      tier: pickTier(candidates.map((c) => c.tier)),
    };
  }

  const sellable = prices.filter((price) => price > 0);
  if (sellable.length === 0) return { status: "refused" };
  return {
    status: "ambiguous",
    minCentsPerMinute: Math.min(...sellable),
    maxCentsPerMinute: Math.max(...sellable),
  };
}

/** Compact on-the-wire form: prefix -> [retail cents, tier code]. */
export type SerializedRatePrefixTable = Record<string, [number, number]>;

const TIER_BY_CODE: RateTier[] = ["other", "mobile", "landline", "special"];

export function tierCode(tier: RateTier) {
  const index = TIER_BY_CODE.indexOf(tier);
  return index < 0 ? 0 : index;
}

export function deserializeRatePrefixTable(
  table: SerializedRatePrefixTable
): RatePrefixEntry[] {
  return Object.entries(table).map(([prefix, [rateCentsPerMinute, code]]) => ({
    prefix,
    rateCentsPerMinute,
    tier: TIER_BY_CODE[code] ?? "other",
  }));
}

const TIER_LABELS: Record<RateTier, string> = {
  mobile: "mobile",
  landline: "landline",
  special: "special-rate",
  other: "",
};

/** "Portugal mobile" / "United States/Canada" when there is no useful tier. */
export function describeResolvedRoute(routeLabel: string, tier: RateTier) {
  const suffix = TIER_LABELS[tier];
  return suffix ? `${routeLabel} ${suffix}` : routeLabel;
}
