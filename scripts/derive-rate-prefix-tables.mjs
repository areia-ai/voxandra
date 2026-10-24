#!/usr/bin/env node

// Generates the per-country prefix tables the PUBLIC landing dialer uses to price
// the exact number a visitor types, rather than showing a country-wide range.
//
// Why per country rather than one global table: the whole world is 12,469 prefixes
// (153 KB raw, 28.8 KB gzipped), but the dialer always knows which country is
// selected, so it only needs that country's slice — 0.1 KB for the median country,
// 1.4 KB for the UK, 7.1 KB for South Africa at the worst. Each table is a separate
// module so the bundler code-splits it and the marketing page's initial payload is
// untouched.
//
// The authenticated dialer does NOT use these tables; it resolves against the full
// catalog server-side through estimateDestinationRate. Both share the resolution
// rule in src/lib/rate-prefix-lookup.ts so the two surfaces cannot disagree.
//
// Usage:
//   node scripts/derive-rate-prefix-tables.mjs           # report what it would write
//   node scripts/derive-rate-prefix-tables.mjs --write

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CATALOG_FILE = "src/lib/twilio-rate-catalog.ts";
const PRICING_FILE = "src/lib/call-pricing.ts";
const OUTPUT_DIR = "src/lib/rate-prefixes";

function read(file) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

// Read pricing constants from source; a second copy is how the Twilio rate sync
// came to hold a stale transcription cost.
function num(source, name, file) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`));
  if (!match) throw new Error(`${name} not found in ${file}`);
  return Number(match[1]);
}

const catalogSource = read(CATALOG_FILE);
const pricingSource = read(PRICING_FILE);
const browserLeg = num(catalogSource, "TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE", CATALOG_FILE);
const marginMultiple = num(pricingSource, "MINIMUM_MARGIN_MULTIPLE", PRICING_FILE);
const retailFloor = num(pricingSource, "MINIMUM_RETAIL_RATE_CENTS_PER_MINUTE", PRICING_FILE);
const selfServeCap = num(pricingSource, "MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE", PRICING_FILE);

const marker = "TWILIO_PROVIDER_RATES: TwilioProviderRate[] = ";
const rates = JSON.parse(
  catalogSource.slice(catalogSource.indexOf(marker) + marker.length).trimEnd().replace(/;$/, "")
);

// Mirrors quoteOutboundCall's retail derivation. The baseline from the rate card is
// deliberately NOT applied: it is a per-country floor, and applying it here would
// hide the very landline/mobile difference these tables exist to expose. The
// resolved figure is the route's own 2x floor, which is what the quote charges
// whenever it exceeds the baseline.
function retailFor(providerCostCentsPerMinute) {
  return Math.max(
    retailFloor,
    Math.ceil((providerCostCentsPerMinute + browserLeg) * marginMultiple)
  );
}

// Tier codes must match TIER_BY_CODE in src/lib/rate-prefix-lookup.ts.
const TIER_CODES = { other: 0, mobile: 1, landline: 2, special: 3 };

function baseSlugFor(countryRates) {
  const slugs = countryRates.map((r) => r.routeType).sort((a, b) => a.length - b.length);
  return slugs.find((candidate) => slugs.every((s) => s === candidate || s.startsWith(candidate)));
}

function tierFor(rate, baseSlug) {
  if (rate.classification !== "standard") return "special";
  if (/(^|_)mobile(_|$)/.test(rate.routeType)) return "mobile";
  if (rate.routeType === baseSlug) return "landline";
  return "other";
}

// "US/CA" cannot be a filename.
function moduleName(country) {
  return country.replace(/[^A-Z0-9]+/gi, "_");
}

const byCountry = new Map();
for (const rate of rates) {
  // A US caller ID never matches an EEA or ZA-domestic tier, and these tables
  // serve the public dialer where the caller is always Voxandra's US number.
  if (rate.originGroup !== "any" && rate.originGroup !== "non_eea") continue;
  if (!byCountry.has(rate.destinationCountry)) byCountry.set(rate.destinationCountry, []);
  byCountry.get(rate.destinationCountry).push(rate);
}

const written = [];
for (const [country, countryRates] of [...byCountry.entries()].sort()) {
  const baseSlug = baseSlugFor(countryRates);
  const table = {};
  for (const rate of countryRates) {
    const retail = retailFor(rate.providerCostCentsPerMinute);
    // 0 marks a route the quote engine refuses, so the dialer can say "not
    // available" for that specific number instead of quoting a price for a call
    // that will be rejected. A UK +449 premium number used to display the
    // ordinary UK range.
    const refused = rate.classification !== "standard" || retail > selfServeCap;
    const value = [refused ? 0 : retail, TIER_CODES[tierFor(rate, baseSlug)]];
    for (const prefix of rate.prefixes) {
      const digits = prefix.replace(/\D/g, "");
      if (!digits) continue;
      const existing = table[digits];
      // Same prefix from two rows: keep the refused/more expensive reading rather
      // than under-quoting.
      if (!existing || existing[0] === 0 || (value[0] !== 0 && value[0] > existing[0])) {
        table[digits] = value;
      }
    }
  }
  written.push({ country, table, entries: Object.keys(table).length });
}

const indexSource = `// Generated by scripts/derive-rate-prefix-tables.mjs. Do not hand-edit.
//
// One lazily loaded module per country so the landing page ships none of this
// until a visitor actually types a number. The importers are listed explicitly
// rather than built from a template literal so the split is deterministic under
// both webpack and Turbopack.
import type { SerializedRatePrefixTable } from "../rate-prefix-lookup";

const LOADERS: Record<string, () => Promise<{ default: SerializedRatePrefixTable }>> = {
${written
  .map((w) => `  ${JSON.stringify(w.country)}: () => import("./${moduleName(w.country)}"),`)
  .join("\n")}
};

export function hasRatePrefixTable(destinationCountry: string | undefined | null) {
  return Boolean(destinationCountry && destinationCountry in LOADERS);
}

export async function loadRatePrefixTable(
  destinationCountry: string
): Promise<SerializedRatePrefixTable | null> {
  const loader = LOADERS[destinationCountry];
  if (!loader) return null;
  const loaded = await loader();
  return loaded.default;
}
`;

if (process.argv.includes("--write")) {
  const dir = resolve(process.cwd(), OUTPUT_DIR);
  // Remove stale country modules so a destination dropped from the allowed list
  // cannot keep serving prices.
  try {
    for (const file of readdirSync(dir)) rmSync(resolve(dir, file));
  } catch {
    // First run: directory does not exist yet.
  }
  mkdirSync(dir, { recursive: true });
  for (const { country, table } of written) {
    writeFileSync(
      resolve(dir, `${moduleName(country)}.ts`),
      `// Generated by scripts/derive-rate-prefix-tables.mjs. Do not hand-edit.\n` +
        `// ${country}: prefix (digits, no "+") -> [retail cents per minute, tier code].\n` +
        `// A rate of 0 means the quote engine refuses that range.\n` +
        `import type { SerializedRatePrefixTable } from "../rate-prefix-lookup";\n\n` +
        `const TABLE: SerializedRatePrefixTable = ${JSON.stringify(table)};\n\nexport default TABLE;\n`
    );
  }
  writeFileSync(resolve(dir, "index.ts"), indexSource);
  console.error(
    `Wrote ${written.length} country tables (${written.reduce((n, w) => n + w.entries, 0)} prefixes) to ${OUTPUT_DIR}/.`
  );
} else {
  const biggest = [...written].sort((a, b) => b.entries - a.entries).slice(0, 5);
  console.log(
    `${written.length} countries, ${written.reduce((n, w) => n + w.entries, 0)} prefixes total.\n` +
      `largest: ${biggest.map((w) => `${w.country} ${w.entries}`).join(", ")}`
  );
}
