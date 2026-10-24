// Behavioural coverage for resolving a typed number to the route that bills it
// (src/lib/rate-prefix-lookup.ts), using the real generated Portugal and UK
// tables. Run from npm test.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// The lookup module is TypeScript, so it is transformed in-memory rather than
// adding a build step to the test suite.

const { resolveRateForDigits, deserializeRatePrefixTable, describeResolvedRoute, toDialedDigits } =
  await (async () => {
    const { transformSync } = await import("esbuild");
    const source = readFileSync(
      path.resolve(root, "src/lib/rate-prefix-lookup.ts"),
      "utf8"
    );
    const { code } = transformSync(source, { loader: "ts", format: "esm" });
    const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
    return await import(url);
  })();

function tableFor(country) {
  const source = readFileSync(
    path.resolve(root, `src/lib/rate-prefixes/${country}.ts`),
    "utf8"
  );
  const json = source.slice(
    source.indexOf("= {", source.indexOf("const TABLE")) + 2,
    source.lastIndexOf("};") + 1
  );
  return deserializeRatePrefixTable(JSON.parse(json));
}

const PT = tableFor("PT");
const GB = tableFor("GB");
const US = tableFor("US_CA");

// The exact case the ambiguity rule exists for. "+3519" already matches the 6c
// Portuguese landline row by longest prefix, but "+35191" (mobile, 100c) is still
// reachable — showing 6c here and then jumping to $1.00 one keystroke later reads
// as a bait and switch, so it must report ambiguous instead.
const partial = resolveRateForDigits(PT, "3519");
assert.equal(partial.status, "ambiguous", "a prefix that can still reach mobile is ambiguous");
assert.equal(partial.minCentsPerMinute, 6);
assert.equal(partial.maxCentsPerMinute, 100);

const ptMobile = resolveRateForDigits(PT, "351910000002");
assert.equal(ptMobile.status, "resolved");
assert.equal(ptMobile.rateCentsPerMinute, 100, "a Portuguese mobile resolves to its own rate");
assert.equal(ptMobile.tier, "mobile");

// Two national digits are enough, which is what makes this worth doing live.
const ptEarly = resolveRateForDigits(PT, "35191");
assert.equal(ptEarly.status, "resolved");
assert.equal(ptEarly.rateCentsPerMinute, 100);

const ptLandline = resolveRateForDigits(PT, "351210000000");
assert.equal(ptLandline.status, "resolved");
assert.equal(ptLandline.rateCentsPerMinute, 6, "a Portuguese landline stays at the landline rate");
assert.equal(ptLandline.tier, "landline");

// Refused ranges must not display a price. A UK +449 premium number used to show
// the ordinary UK range and then fail at call time.
const ukPremium = resolveRateForDigits(GB, "449001234567");
assert.equal(ukPremium.status, "refused", "premium ranges report refused, not a price");

// The UK is the case a country-wide figure cannot describe at all: 589 listed
// mobile ranges cost 3.05c while any other +447 number falls to a 32c generic
// row — a 10x spread inside one country's mobiles.
const ukMobileCheap = resolveRateForDigits(GB, "447106123456");
assert.equal(ukMobileCheap.status, "resolved");
assert.equal(ukMobileCheap.tier, "mobile");
assert.equal(ukMobileCheap.rateCentsPerMinute, 7);
// 44710… matches no listed range, so it resolves to the generic +447 fallback.
const ukMobileFallback = resolveRateForDigits(GB, "447101234567");
assert.equal(ukMobileFallback.status, "resolved");
assert.equal(ukMobileFallback.rateCentsPerMinute, 65);
assert.ok(
  ukMobileFallback.rateCentsPerMinute > ukMobileCheap.rateCentsPerMinute,
  "the generic +447 mobile fallback is dearer than the listed cheap ranges"
);

// A country with one price everywhere resolves immediately, with no range shown.
const us = resolveRateForDigits(US, "12125551234");
assert.equal(us.status, "resolved");
assert.equal(us.rateCentsPerMinute, 6);

// Digits outside the table (wrong country selected, say) must not invent a price.
assert.equal(resolveRateForDigits(PT, "9998887776").status, "unknown");
assert.equal(resolveRateForDigits(PT, "").status, "unknown");
assert.equal(resolveRateForDigits([], "351910000002").status, "unknown");

assert.equal(toDialedDigits(" +351 910 000 002 "), "351910000002");
assert.equal(describeResolvedRoute("Portugal", "mobile"), "Portugal mobile");
assert.equal(
  describeResolvedRoute("United States/Canada", "other"),
  "United States/Canada",
  "a country with no meaningful tier is not given a dangling suffix"
);

console.log("Rate prefix lookup tests passed.");
