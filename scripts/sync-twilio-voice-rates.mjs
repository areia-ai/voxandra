#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_FILE = "src/lib/twilio-rate-catalog.ts";

// Non-rate cost constants live in the generated file but are NOT Twilio rate
// data — they are hand-tuned and must survive a sync. The template's own copies
// had already drifted from the checked-in file by 2026-07-31 (it omitted
// TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE entirely, which would not compile,
// and would have silently halved OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE
// from 1.2 to 0.6, understating AI cost and inflating every margin). So they
// are read back out of the existing file instead of being re-declared here.
const PRESERVED_COST_CONSTANTS = {
  TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE: 0.4,
  TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE: 0.85,
  TWILIO_RECORDING_COST_CENTS_PER_MINUTE: 0.25,
  OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE: 1.2,
  AI_EXTRACTION_ALLOWANCE_CENTS_PER_MINUTE: 0.25,
};

function preservedCostConstants() {
  let existing = "";
  try {
    existing = readFileSync(resolve(process.cwd(), OUTPUT_FILE), "utf8");
  } catch {
    return { ...PRESERVED_COST_CONSTANTS };
  }
  const preserved = {};
  for (const [name, fallback] of Object.entries(PRESERVED_COST_CONSTANTS)) {
    const match = existing.match(
      new RegExp(`export const ${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`)
    );
    const parsed = match ? Number(match[1]) : NaN;
    preserved[name] = Number.isFinite(parsed) ? parsed : fallback;
    if (!match) {
      console.error(
        `[sync] ${name} not found in ${OUTPUT_FILE}; using built-in default ${fallback}.`
      );
    }
  }
  return preserved;
}
const PRICING_API_BASE_URL = "https://pricing.twilio.com/v2/Voice/Countries";
const DEFAULT_UPDATED_AT = new Date().toISOString().slice(0, 10);

const EEA_ISO_COUNTRIES = new Set([
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

function envList(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function expandedCountriesFromAllowedEnv() {
  const countries = envList("TWILIO_ALLOWED_COUNTRIES");
  const expanded = new Set();
  for (const country of countries) {
    if (country === "US/CA") {
      expanded.add("US");
      expanded.add("CA");
    } else {
      expanded.add(country);
    }
  }
  return [...expanded].sort();
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function catalogDestinationCountry(isoCountry) {
  if (isoCountry === "US" || isoCountry === "CA") return "US/CA";
  return isoCountry;
}

function normalizePrefix(prefix) {
  const digits = String(prefix).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : null;
}

function centsPerMinute(price) {
  const parsed = Number(price);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.ceil(parsed * 10000) / 100;
}

function slug(value) {
  return String(value || "standard")
    .toLowerCase()
    .replace(/programmable outbound minute/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "standard";
}

function classifyRoute(friendlyName) {
  if (!friendlyName) return "blocked_unclassified";
  const name = String(friendlyName ?? "").toLowerCase();
  if (name.includes("unknown") || name.includes("unclassified")) {
    return "blocked_unclassified";
  }
  if (name.includes("emergency")) return "blocked_emergency";
  if (name.includes("premium")) return "blocked_premium";
  if (name.includes("satellite")) return "blocked_satellite";
  if (name.includes("shared")) return "blocked_shared_cost";
  if (
    name.includes("special") ||
    name.includes("toll free") ||
    name.includes("toll-free") ||
    name.includes("universal")
  ) {
    return "blocked_special_service";
  }
  return "standard";
}

// Twilio expresses one row per (destination tier, origination zone). An
// `origination_prefixes` of exactly ["ALL"] is the price that applies to any
// caller ID — the one Voxandra actually pays from its US number. Anything else
// is an *origin-restricted tier* ("- from EEA", "- from Surcharge Zone 1",
// "- from Twilio number"). Usually cheaper than the ALL row (Portugal mobile
// from EEA is 4.95c against 49.5c) but not always: Ireland's mobile
// "from Surcharged Zone" rows are 16.93c against a 9.45c ALL row.
//
// Mapping a discount row to "any" is a 10x underpricing bug: the Portugal
// "Mobile - from EEA" row (4.95c) then tied with the real "Mobile" row (49.5c)
// on prefix length and won, quoting a US-origin PT mobile call at a tenth of its
// cost. The previous test — `origination_prefixes.every(p => EEA_CALLING_PREFIXES
// .has(p))` — did exactly that, because Twilio's EEA origination list includes
// '44' (UK origination is still priced in the EEA zone) which the hardcoded set
// lacked. Anything not recognised silently became "any".
//
// The fix is to key off the shape of the row, not a hardcoded prefix list, and to
// return an origin group that quoteOutboundCall can only ever select when it has
// independently established the caller's origin: "eea" is chosen there only when
// the origin country is in its own EEA set, so a US caller ID can never match an
// EEA discount row no matter what this list contains. Tiers that no origin group
// can express (UK "from Surcharge Zone", ZA "from Twilio number") are dropped:
// omitting a discount row can only over-estimate cost, which fails safe.
function originGroupFor(isoCountry, originationPrefixes) {
  const prefixes = originationPrefixes.map((prefix) => String(prefix).toUpperCase());
  const isAll = prefixes.length === 1 && prefixes[0] === "ALL";
  const isRow = prefixes.length === 1 && prefixes[0] === "ROW";

  if (isAll) return "any";
  if (isRow) {
    if (isoCountry === "ZA") return "non_za";
    if (EEA_ISO_COUNTRIES.has(isoCountry)) return "non_eea";
    return "any";
  }

  // An explicit origination list: an origin-restricted discount tier.
  if (isoCountry === "ZA") return prefixes.includes("27") ? "za" : null;
  if (EEA_ISO_COUNTRIES.has(isoCountry)) return "eea";
  return null;
}

async function fetchVoiceCountry(isoCountry) {
  const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(`${PRICING_API_BASE_URL}/${encodeURIComponent(isoCountry)}`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Twilio pricing fetch failed for ${isoCountry}: ${response.status}`);
  }
  return await response.json();
}

function ratesFromCountryPayload(isoCountry, payload) {
  const rows = payload.outbound_prefix_prices ?? payload.outboundPrefixPrices ?? [];
  return rows.flatMap((row) => {
    const destinationPrefixes = row.destination_prefixes ?? row.destinationPrefixes ?? [];
    const originationPrefixes = row.origination_prefixes ?? row.originationPrefixes ?? ["ALL"];
    const prefixes = destinationPrefixes.map(normalizePrefix).filter(Boolean);
    const providerCostCentsPerMinute = centsPerMinute(row.current_price ?? row.currentPrice);
    if (prefixes.length === 0 || providerCostCentsPerMinute === null) return [];
    const originGroup = originGroupFor(isoCountry, originationPrefixes);
    // Unmatchable origin-restricted discount tier — see originGroupFor.
    if (originGroup === null) return [];

    return [
      {
        destinationCountry: catalogDestinationCountry(isoCountry),
        routeType: slug(row.friendly_name ?? row.friendlyName),
        prefixes,
        originGroup,
        providerCostCentsPerMinute,
        classification: classifyRoute(row.friendly_name ?? row.friendlyName),
        source: "twilio_pricing_api_v2",
        updatedAt: DEFAULT_UPDATED_AT,
      },
    ];
  });
}

function generatedCatalogSource(rates, costConstants) {
  return `export type TwilioProviderRateOriginGroup = "any" | "eea" | "non_eea" | "za" | "non_za";

export type TwilioProviderRateClassification =
  | "standard"
  | "blocked_premium"
  | "blocked_satellite"
  | "blocked_shared_cost"
  | "blocked_special_service"
  | "blocked_emergency"
  | "blocked_unclassified";

export type TwilioProviderRate = {
  destinationCountry: string;
  routeType: string;
  prefixes: string[];
  originGroup: TwilioProviderRateOriginGroup;
  providerCostCentsPerMinute: number;
  classification: TwilioProviderRateClassification;
  source: string;
  updatedAt: string;
};

export const TWILIO_RATE_CATALOG_VERSION = "twilio-pricing-api-${DEFAULT_UPDATED_AT}";

// Hand-tuned, not Twilio rate data: carried over from the previous file by
// preservedCostConstants() so a rate sync can never silently change them.
export const TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE = ${costConstants.TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE};
export const TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE = ${costConstants.TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE};
export const TWILIO_RECORDING_COST_CENTS_PER_MINUTE = ${costConstants.TWILIO_RECORDING_COST_CENTS_PER_MINUTE};
export const OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE = ${costConstants.OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE};
export const AI_EXTRACTION_ALLOWANCE_CENTS_PER_MINUTE = ${costConstants.AI_EXTRACTION_ALLOWANCE_CENTS_PER_MINUTE};

export const TWILIO_PROVIDER_RATES: TwilioProviderRate[] = ${JSON.stringify(
    rates,
    null,
    2
  )};
`;
}

async function main() {
  const allowedCountries = expandedCountriesFromAllowedEnv();
  if (allowedCountries.length === 0) {
    throw new Error("TWILIO_ALLOWED_COUNTRIES must be set before syncing rates.");
  }

  const rates = [];
  for (const country of allowedCountries) {
    const payload = await fetchVoiceCountry(country);
    rates.push(...ratesFromCountryPayload(country, payload));
  }

  rates.sort((a, b) => {
    if (a.destinationCountry !== b.destinationCountry) {
      return a.destinationCountry.localeCompare(b.destinationCountry);
    }
    const aPrefix = a.prefixes[0] ?? "";
    const bPrefix = b.prefixes[0] ?? "";
    return aPrefix.localeCompare(bPrefix);
  });

  const source = generatedCatalogSource(rates, preservedCostConstants());
  if (process.argv.includes("--write")) {
    writeFileSync(resolve(process.cwd(), OUTPUT_FILE), source);
    console.log(`Wrote ${rates.length} Twilio Voice rate rows to ${OUTPUT_FILE}.`);
  } else {
    console.log(source);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
