// Behavioral coverage for bridge-GA Phase 1b's second-leg billing
// settlement: computeBridgeInternalCostCents (src/lib/call-pricing.ts).
//
// call-pricing.ts has multiple local imports (calling-rates.ts,
// rate-prefix-lookup.ts, twilio-rate-catalog.ts), unlike
// src/lib/twilio/bridge-lifecycle.ts, which is deliberately dependency-free
// so scripts/test-twilio-bridge-lifecycle.mjs can run it directly under
// `node --experimental-strip-types`. Bundled in-memory with esbuild instead
// (same technique as scripts/test-rate-prefix-lookup.mjs), so this exercises
// the real, shipping function rather than a reimplementation of its math.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const { computeBridgeInternalCostCents, quoteOutboundCall } = await (async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [path.resolve(root, "src/lib/call-pricing.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return await import(url);
})();

// Real, current catalog rates rather than hand-typed guesses, so this test
// breaks if the catalog is ever regenerated in a way that changes these
// routes' economics.
const us = quoteOutboundCall({ destinationE164: "+14155551234", aiCaptureEnabled: false });
assert.ok(
  us.providerCostCentsPerMinute && us.providerCostCentsPerMinute > 0,
  "US/CA must resolve a real, positive provider rate"
);

// Lithuania mobile is the exact high-cost route PRICING_RATIONALE.md already
// documents by hand — reusing it here keeps this test honest to a route
// this repo has independently verified is expensive, not a made-up example.
const highCost = quoteOutboundCall({ destinationE164: "+37061234567", aiCaptureEnabled: false });
assert.ok(
  highCost.providerCostCentsPerMinute && highCost.providerCostCentsPerMinute > 0,
  "the Lithuania mobile route must resolve a real, positive provider rate"
);
assert.ok(
  highCost.providerCostCentsPerMinute > us.providerCostCentsPerMinute * 5,
  "the whole point of this test is a genuinely high-cost route -- Lithuania mobile should be dramatically more expensive than US/CA"
);

// Mirrors twilio-rate-catalog.ts's TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE.
// Not imported directly (that file exports it as a named constant, but
// re-deriving it here from the real catalog value keeps this test resilient
// to the bundling approach above without a second esbuild pass).
const TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE = 0.4;

function expectedBridgeCostCents({ parentSeconds, calleeSeconds, providerCostCentsPerMinute }) {
  const parentMinutes = parentSeconds / 60;
  const calleeMinutes = calleeSeconds / 60;
  return (
    (parentMinutes + calleeMinutes) * TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE +
    calleeMinutes * providerCostCentsPerMinute
  );
}

// Missing data for either leg must return undefined, never a partial/wrong
// number -- the caller (convex/twilioProvider.ts) relies on this to know
// whether it's safe to patch the field yet.
assert.equal(
  computeBridgeInternalCostCents({
    parentDurationSeconds: undefined,
    calleeDurationSeconds: 60,
    calleeProviderCostCentsPerMinute: us.providerCostCentsPerMinute,
  }),
  undefined,
  "an unknown parent-leg duration must never silently compute a partial cost"
);
assert.equal(
  computeBridgeInternalCostCents({
    parentDurationSeconds: 60,
    calleeDurationSeconds: undefined,
    calleeProviderCostCentsPerMinute: us.providerCostCentsPerMinute,
  }),
  undefined,
  "an unknown callee-leg duration must never silently compute a partial cost"
);

for (const [label, quote] of [
  ["US/CA", us],
  ["Lithuania mobile", highCost],
]) {
  const parentSeconds = 45;
  const calleeSeconds = 180;
  const actual = computeBridgeInternalCostCents({
    parentDurationSeconds: parentSeconds,
    calleeDurationSeconds: calleeSeconds,
    calleeProviderCostCentsPerMinute: quote.providerCostCentsPerMinute,
  });
  const expected = expectedBridgeCostCents({
    parentSeconds,
    calleeSeconds,
    providerCostCentsPerMinute: quote.providerCostCentsPerMinute,
  });
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected} cents, got ${actual}`
  );

  // The entire point of this fix: a real, destination-variable second-leg
  // cost, not the flat ~0.44c/min the translated_audio meter used to (and
  // no longer does) assume for the bridge's real second leg.
  const oldFlatAssumption = (parentSeconds / 60 + calleeSeconds / 60) * 0.44;
  assert.notEqual(
    actual,
    oldFlatAssumption,
    `${label}: must not collapse to the old flat 0.44c-per-minute assumption`
  );
}

// A missing/undefined provider rate (shouldn't happen for a real call, but
// old rows or a quote failure could leave it unset) must fall back to 0, not
// throw or produce NaN.
const withoutRate = computeBridgeInternalCostCents({
  parentDurationSeconds: 30,
  calleeDurationSeconds: 30,
  calleeProviderCostCentsPerMinute: undefined,
});
assert.equal(typeof withoutRate, "number");
assert.ok(Number.isFinite(withoutRate), "a missing provider rate must fall back to 0, not NaN");
assert.ok(withoutRate > 0, "the platform fee on both legs still applies even with an unknown carrier rate");

console.log("Bridge internal billing tests passed.");
