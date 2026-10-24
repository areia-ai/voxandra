#!/usr/bin/env node

// Derives the customer-facing retail rate card in src/lib/calling-rates.ts from
// the provider costs in src/lib/twilio-rate-catalog.ts.
//
// Why this exists: the card used to claim it was "derived from cost, not
// hand-picked", but it had drifted badly by 2026-07-31 — Portugal was advertised
// at 11c/min against a real 49.5c/min US-origin mobile cost, and eight countries
// sat below their own 2x margin floor. Nothing under-billed (quoteOutboundCall
// takes max(baseline, 2x floor, absolute floor), so the floor always won), but
// the advertised number was fiction. Deriving it mechanically is the only way
// that claim stays true.
//
// Two numbers per country, because one cannot describe a country any more: a
// Portuguese landline costs 1.71c/min and a Portuguese mobile 49.5c/min from our
// US caller ID. The `from` value is the billing baseline — it must track the
// CHEAPEST route so it never lifts a cheap route above its own floor — and the
// `to` value exists so the dialer can advertise the real span instead of quoting
// a landline price for a mobile call.
//
// Usage:
//   node scripts/derive-retail-rate-card.mjs            # print the block
//   node scripts/derive-retail-rate-card.mjs --write    # rewrite in place

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CARD_FILE = "src/lib/calling-rates.ts";
const CATALOG_FILE = "src/lib/twilio-rate-catalog.ts";
const PRICING_FILE = "src/lib/call-pricing.ts";
const BEGIN = "// <generated:retail-rate-card>";
const END = "// </generated:retail-rate-card>";

function read(file) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

// Read the pricing constants out of source rather than restating them here.
// A second copy is exactly how the Twilio rate sync came to hold a stale
// transcription cost and a missing inbound-leg constant.
function num(source, name, file) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`));
  if (!match) throw new Error(`${name} not found in ${file}`);
  return Number(match[1]);
}

function parseCatalogRates(source) {
  const marker = "TWILIO_PROVIDER_RATES: TwilioProviderRate[] = ";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("TWILIO_PROVIDER_RATES not found in the catalog");
  const json = source.slice(start + marker.length).trimEnd().replace(/;$/, "");
  return JSON.parse(json);
}

// Every country the catalog has rates for — which is exactly the allowed calling
// countries, since the catalog is synced from TWILIO_ALLOWED_COUNTRIES. Taking the
// set from the catalog rather than the env var keeps the card consistent with the
// rates that actually exist and removes an env dependency from this script.
//
// The card used to cover only 39 of them, leaving 51 dialable destinations on the
// flat DEFAULT_RETAIL_RATE_CENTS_PER_MINUTE. That was not a rounding problem: 32 of
// them were advertised below what the quote engine charged (Serbia showed 35c and
// billed 166c) and 18 were advertised at 35c when the real rate was as low as 6c
// (Romania), making cheap destinations look 6x pricier than they are.
//
// Existing card countries keep their current order so the marketing list stays
// recognisable; the rest are appended alphabetically.
function cardCountries(cardSource, rates) {
  const existing = [];
  const block = cardSource.match(
    /RETAIL_RATE_CENTS_PER_MINUTE: Record<string, number> = \{([\s\S]*?)\n\};/
  );
  if (block) {
    existing.push(...[...block[1].matchAll(/"?([A-Z][A-Z/]*)"?\s*:\s*\d+\s*,/g)].map((m) => m[1]));
  }
  const fromCatalog = [...new Set(rates.map((rate) => rate.destinationCountry))].sort();
  const seen = new Set();
  const ordered = [];
  for (const country of [...existing, ...fromCatalog]) {
    if (seen.has(country)) continue;
    seen.add(country);
    ordered.push(country);
  }
  return ordered;
}

const cardSource = read(CARD_FILE);
const catalogSource = read(CATALOG_FILE);
const pricingSource = read(PRICING_FILE);

const browserLeg = num(catalogSource, "TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE", CATALOG_FILE);
const marginMultiple = num(pricingSource, "MINIMUM_MARGIN_MULTIPLE", PRICING_FILE);
const retailFloor = num(pricingSource, "MINIMUM_RETAIL_RATE_CENTS_PER_MINUTE", PRICING_FILE);
const selfServeCap = num(pricingSource, "MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE", PRICING_FILE);

const rates = parseCatalogRates(catalogSource);
const countries = cardCountries(cardSource, rates);

// Mirrors quoteOutboundCall: retail is floored at 2x telephony cost (provider +
// browser leg), then at the absolute retail floor.
function retailFor(providerCostCentsPerMinute) {
  return Math.max(
    retailFloor,
    Math.ceil((providerCostCentsPerMinute + browserLeg) * marginMultiple)
  );
}

// The catalog's plain-landline route for a country is the row whose slug is the
// country name with no tier suffix ("portugal", "united_states_canada"). It is
// found by taking the shortest slug that every other slug in the country extends,
// rather than transliterating ISO codes to Twilio's friendly names.
function mainstreamSlug(country, routes) {
  const slugs = routes.map((r) => r.routeType).sort((a, b) => a.length - b.length);
  const base = slugs.find((candidate) => slugs.every((s) => s === candidate || s.startsWith(candidate)));
  return base ?? slugs[0] ?? country.toLowerCase();
}

const derived = [];
const unavailable = [];
const warnings = [];
for (const country of countries) {
  // A US caller ID never matches an EEA or ZA-domestic discount tier, so those
  // rows must not influence an advertised price we would never charge.
  const quotable = rates
    .filter(
      (rate) =>
        rate.destinationCountry === country &&
        rate.classification === "standard" &&
        (rate.originGroup === "any" || rate.originGroup === "non_eea")
    )
    .map((rate) => ({ routeType: rate.routeType, retail: retailFor(rate.providerCostCentsPerMinute) }));

  if (quotable.length === 0) {
    warnings.push(`${country}: no standard route in the catalog; marked unavailable`);
    unavailable.push(country);
    continue;
  }

  // The billing baseline must track the cheapest route of ANY kind, including
  // regional carve-outs, or the baseline would lift one of them above its own
  // floor and overcharge it.
  const from = Math.min(...quotable.map((r) => r.retail));

  // Routes above the self-serve cap are refused at quote time, so advertising
  // one as the top of the range would quote a price we will not sell.
  const sellable = quotable.filter((r) => r.retail <= selfServeCap);
  if (sellable.length === 0) {
    // Every route in the country is over the cap, so every call to it is
    // refused. Macau is the live example: its cheapest route floors to 178c.
    // Publishing any number for it advertises a price for a call that cannot be
    // placed, which is what the flat default rate was doing.
    warnings.push(
      `${country}: every route is above the ${selfServeCap}c cap; marked unavailable (cheapest ${from}c)`
    );
    unavailable.push(country);
    continue;
  }
  if (sellable.length !== quotable.length) {
    const blocked = quotable
      .filter((r) => r.retail > selfServeCap)
      .map((r) => `${r.routeType} ${r.retail}c`)
      .join(", ");
    warnings.push(`${country}: above the ${selfServeCap}c cap and excluded from the range: ${blocked}`);
  }

  // The advertised ceiling covers the two tiers a caller actually chooses
  // between — the country's ordinary landline route and its mobile routes.
  // Regional carve-outs (Canada's Yukon Territory at 15.25c, Alaska at 9.45c)
  // and personal-numbering ranges are excluded: including them advertised
  // US/CA as "$0.06-$0.32/min" when essentially every real US call is $0.06,
  // overstating the common case by 5x. Those routes are still priced correctly
  // at quote time, and the page promises rates before you dial.
  const countrySlug = mainstreamSlug(country, sellable);
  const mainstream = sellable.filter(
    (r) => r.routeType === countrySlug || /(^|_)mobile(_|$)/.test(r.routeType)
  );
  const ceilingPool = mainstream.length > 0 ? mainstream : sellable;
  if (mainstream.length > 0 && mainstream.length !== sellable.length) {
    const excluded = sellable
      .filter((r) => !mainstream.includes(r))
      .filter((r) => r.retail > Math.max(...mainstream.map((m) => m.retail)))
      .map((r) => `${r.routeType} ${r.retail}c`);
    if (excluded.length > 0) {
      warnings.push(
        `${country}: pricier than the advertised ceiling but still quotable: ${excluded.join(", ")}`
      );
    }
  }
  const to = ceilingPool.length > 0 ? Math.max(...ceilingPool.map((r) => r.retail)) : from;
  derived.push({ country, from, to: Math.max(from, to) });
}

const key = (country) => (/^[A-Z]+$/.test(country) ? country : JSON.stringify(country));
const fromEntries = derived.map((d) => `  ${key(d.country)}: ${d.from},`).join("\n");
const toEntries = derived.map((d) => `  ${key(d.country)}: ${d.to},`).join("\n");

const block = `${BEGIN}
// Generated by scripts/derive-retail-rate-card.mjs from the provider costs in
// twilio-rate-catalog.ts. Do not hand-edit: rerun the script instead.
//
// Every value is at or above ${marginMultiple}x that route's telephony cost (provider +
// browser leg) and at or above the ${retailFloor}c absolute floor, computed the same way
// quoteOutboundCall computes it. Routes above the ${selfServeCap}c self-serve cap are
// refused at quote time and excluded from the advertised range.
//
// RETAIL_RATE_CENTS_PER_MINUTE is the CHEAPEST quotable route per country and is
// the billing baseline, so it can never lift a cheap route above its own floor —
// a Portuguese landline is priced as a landline. Pricier routes in the same
// country (mobile, personal numbering) are lifted to their own floor by
// quoteOutboundCall, up to RETAIL_RATE_MAX_CENTS_PER_MINUTE.
export const RETAIL_RATE_CENTS_PER_MINUTE: Record<string, number> = {
${fromEntries}
};

// The priciest quotable route per country. Display only — never a billing input.
// The dialer advertises the span so a mobile call is not quoted at the landline
// price: Portugal is $0.06-$1.00/min, not "$0.06/min".
export const RETAIL_RATE_MAX_CENTS_PER_MINUTE: Record<string, number> = {
${toEntries}
};

// Destinations where every route is refused at quote time — either no standard
// route exists or all of them exceed the ${selfServeCap}c self-serve cap. They must show
// as unavailable rather than carrying a price: a number here would advertise a
// call the quote engine will not place.
export const UNAVAILABLE_DESTINATION_COUNTRIES: readonly string[] = ${JSON.stringify(unavailable)};
${END}`;

if (process.argv.includes("--write")) {
  const start = cardSource.indexOf(BEGIN);
  const end = cardSource.indexOf(END);
  if (start < 0 || end < 0) {
    throw new Error(`${CARD_FILE} is missing the ${BEGIN} / ${END} markers.`);
  }
  const next = cardSource.slice(0, start) + block + cardSource.slice(end + END.length);
  writeFileSync(resolve(process.cwd(), CARD_FILE), next);
  console.error(`Wrote ${derived.length} retail rates to ${CARD_FILE}.`);
} else {
  console.log(block);
}

for (const warning of warnings) console.error(`[card] ${warning}`);
const raised = derived.filter((d) => {
  const existing = cardSource.match(new RegExp(`"?${d.country}"?\\s*:\\s*(\\d+)\\s*,`));
  return existing && Number(existing[1]) < d.from;
});
if (raised.length > 0) {
  console.error(
    `[card] advertised floor rises for: ${raised
      .map((d) => `${d.country} ${d.from}c`)
      .join(", ")} (these were advertised below their own margin floor; the floor was already being charged)`
  );
}
