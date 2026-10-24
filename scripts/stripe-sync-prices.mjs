#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-02-25.clover";
const CONFIG_PATH = "src/lib/billing/config.ts";
const SUBSCRIPTION_PLAN_IDS = ["solo", "starter", "team", "operations"];
const TOP_UP_IDS = ["topup_10", "topup_25", "topup_50", "topup_100"];

function parseArgs(argv) {
  const args = {
    apply: false,
    envPath: ".env.local",
    includeOneTimeChecks: true,
    productNamesOnly: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--dry-run") {
      args.apply = false;
    } else if (arg === "--no-env") {
      args.envPath = null;
    } else if (arg.startsWith("--env=")) {
      args.envPath = arg.slice("--env=".length);
    } else if (arg === "--subscriptions-only") {
      args.includeOneTimeChecks = false;
    } else if (arg === "--product-names-only") {
      args.productNamesOnly = true;
      args.includeOneTimeChecks = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: node scripts/stripe-sync-prices.mjs [--dry-run] [--apply] [--env=.env.local] [--no-env] [--subscriptions-only] [--product-names-only]",
        "",
        "Dry-run is the default. Apply mode creates replacement monthly subscription Prices",
        "when a configured lookup key resolves to an active Stripe Price with the wrong amount.",
        "",
        "--apply --product-names-only updates subscription Stripe Product names only,",
        "without creating or replacing Prices and without touching top-up Products.",
      ].join("\n"));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function loadEnv(envPath) {
  if (!envPath) return;
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function extractObjectBody(source, objectName) {
  const anchor = source.indexOf(`export const ${objectName}`);
  if (anchor === -1) throw new Error(`Could not find ${objectName} in ${CONFIG_PATH}`);
  const openBrace = source.indexOf("{", anchor);
  if (openBrace === -1) throw new Error(`Could not parse ${objectName}`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, index);
  }

  throw new Error(`Could not parse ${objectName}`);
}

function extractNamedEntry(body, key) {
  const anchor = body.indexOf(`${key}:`);
  if (anchor === -1) throw new Error(`Could not find ${key} in billing config`);
  const openBrace = body.indexOf("{", anchor);
  if (openBrace === -1) throw new Error(`Could not parse ${key}`);

  let depth = 0;
  for (let index = openBrace; index < body.length; index += 1) {
    const char = body[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return body.slice(openBrace + 1, index);
  }

  throw new Error(`Could not parse ${key}`);
}

function stringField(body, field) {
  const match = body.match(new RegExp(`${field}:\\s*"([^"]+)"`));
  if (!match) throw new Error(`Missing ${field}`);
  return match[1];
}

function numberField(body, field) {
  const match = body.match(new RegExp(`${field}:\\s*(\\d+)`));
  if (!match) throw new Error(`Missing ${field}`);
  return Number(match[1]);
}

function readBillingConfig() {
  const source = fs.readFileSync(CONFIG_PATH, "utf8");
  const subscriptionBody = extractObjectBody(source, "SUBSCRIPTION_PLANS");
  const topUpBody = extractObjectBody(source, "TOP_UP_OPTIONS");
  const rentalMatch = source.match(/CALLING_NUMBER_RENTAL_PRICE_CENTS\s*=\s*(\d+)/);
  if (!rentalMatch) throw new Error("Missing CALLING_NUMBER_RENTAL_PRICE_CENTS");

  return {
    subscriptions: SUBSCRIPTION_PLAN_IDS.map((id) => {
      const entry = extractNamedEntry(subscriptionBody, id);
      return {
        id,
        label: stringField(entry, "name"),
        lookupKey: stringField(entry, "stripeLookupKey"),
        unitAmountCents: numberField(entry, "monthlyPriceCents"),
        kind: "monthly_recurring",
        syncable: true,
      };
    }),
    topUps: TOP_UP_IDS.map((id) => {
      const entry = extractNamedEntry(topUpBody, id);
      return {
        id,
        label: `${stringField(entry, "label")} top-up credits`,
        lookupKey: stringField(entry, "stripeLookupKey"),
        unitAmountCents: numberField(entry, "amountCents"),
        kind: "one_time",
        syncable: false,
      };
    }),
    callingNumberRental: {
      id: "calling_number_rental",
      label: "Calling number rental",
      lookupKey:
        process.env.STRIPE_NUMBER_RENTAL_LOOKUP_KEY?.trim() ||
        "voxandra_calling_number_monthly",
      unitAmountCents: Number(rentalMatch[1]),
      kind: "monthly_recurring",
      syncable: false,
    },
  };
}

function priceShape(price) {
  return {
    id: price.id,
    product:
      typeof price.product === "string" ? price.product : price.product.id,
    productName:
      typeof price.product === "string" ? null : (price.product.name ?? null),
    active: price.active,
    livemode: price.livemode,
    lookupKey: price.lookup_key,
    currency: price.currency,
    unitAmountCents: price.unit_amount,
    kind:
      price.type === "recurring" &&
      price.recurring?.interval === "month" &&
      price.recurring?.interval_count === 1
        ? "monthly_recurring"
        : price.type,
    recurringInterval: price.recurring?.interval ?? null,
    recurringIntervalCount: price.recurring?.interval_count ?? null,
  };
}

function mismatchReasons(price, expected) {
  const actual = priceShape(price);
  const reasons = [];
  if (actual.currency !== "usd") reasons.push(`currency=${actual.currency}`);
  if (actual.unitAmountCents !== expected.unitAmountCents) {
    reasons.push(`amount=${actual.unitAmountCents}`);
  }
  if (actual.kind !== expected.kind) reasons.push(`kind=${actual.kind}`);
  return reasons;
}

function productNameMismatch(price, expected) {
  if (!expected.syncable) return null;
  const product =
    typeof price.product === "string"
      ? { id: price.product, name: null }
      : { id: price.product.id, name: price.product.name ?? null };
  if (product.name === expected.label) return null;
  return {
    productId: product.id,
    productName: product.name,
    expectedProductName: expected.label,
  };
}

async function getActivePrice(stripe, expected) {
  const prices = await stripe.prices.list({
    active: true,
    lookup_keys: [expected.lookupKey],
    limit: 10,
    expand: ["data.product"],
  });
  return prices.data;
}

async function updateSubscriptionProductName(stripe, expected, price) {
  const productId =
    typeof price.product === "string" ? price.product : price.product.id;
  const product = await stripe.products.update(productId, {
    name: expected.label,
    metadata: {
      app: "voxandra",
      planId: expected.id,
      syncedBy: "scripts/stripe-sync-prices.mjs",
      syncScope: "product_name",
    },
  });
  return {
    id: product.id,
    name: product.name,
    active: product.active,
    livemode: product.livemode,
  };
}

async function createReplacementSubscriptionPrice(stripe, expected, oldPrice) {
  const productId =
    typeof oldPrice.product === "string" ? oldPrice.product : oldPrice.product.id;
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: expected.unitAmountCents,
    recurring: { interval: "month", interval_count: 1 },
    product: productId,
    lookup_key: expected.lookupKey,
    transfer_lookup_key: true,
    metadata: {
      app: "voxandra",
      planId: expected.id,
      syncedBy: "scripts/stripe-sync-prices.mjs",
    },
  });

  await stripe.products.update(productId, { default_price: price.id });

  const resolved = await stripe.prices.list({
    active: true,
    lookup_keys: [expected.lookupKey],
    limit: 10,
  });
  const resolvedNewPrice = resolved.data.find((candidate) => candidate.id === price.id);
  if (!resolvedNewPrice) {
    throw new Error(
      `Created ${price.id}, but ${expected.lookupKey} did not resolve to the new price.`
    );
  }

  await stripe.prices.update(oldPrice.id, { active: false });
  return price;
}

async function inspectExpectedPrice(stripe, expected, apply, options = {}) {
  const prices = await getActivePrice(stripe, expected);
  if (prices.length === 0) {
    return {
      expected,
      status: "missing",
      action: "manual_required",
      message: "No active Stripe price found for lookup key.",
    };
  }
  if (prices.length > 1) {
    return {
      expected,
      status: "duplicate",
      action: "manual_required",
      message: `Found ${prices.length} active prices for lookup key.`,
      prices: prices.map(priceShape),
    };
  }

  const price = prices[0];
  const reasons = mismatchReasons(price, expected);
  const nameMismatch = productNameMismatch(price, expected);

  if (options.productNamesOnly) {
    if (reasons.length > 0) {
      return {
        expected,
        status: "mismatch",
        action: "manual_required",
        message: `Price shape mismatch prevents product-name-only sync: ${reasons.join(", ")}.`,
        price: priceShape(price),
        productNameMismatch: nameMismatch,
      };
    }

    if (!nameMismatch) {
      return {
        expected,
        status: "ok",
        action: "none",
        price: priceShape(price),
      };
    }

    if (!apply) {
      return {
        expected,
        status: "product_name_mismatch",
        action: "would_update_product_name",
        message: `Product name is ${nameMismatch.productName ?? "(unknown)"}.`,
        price: priceShape(price),
        productNameMismatch: nameMismatch,
      };
    }

    const product = await updateSubscriptionProductName(stripe, expected, price);
    return {
      expected,
      status: "fixed",
      action: "updated_product_name",
      price: priceShape(price),
      oldProductName: nameMismatch.productName,
      expectedProductName: expected.label,
      product,
    };
  }

  if (reasons.length === 0) {
    if (nameMismatch) {
      return {
        expected,
        status: "product_name_mismatch",
        action: "run_product_names_only",
        message: `Product name is ${nameMismatch.productName ?? "(unknown)"}. Re-run with --apply --product-names-only to update only subscription Product names.`,
        price: priceShape(price),
        productNameMismatch: nameMismatch,
      };
    }

    return {
      expected,
      status: "ok",
      action: "none",
      price: priceShape(price),
    };
  }

  if (!expected.syncable) {
    return {
      expected,
      status: "mismatch",
      action: "manual_required",
      message: `Mismatched non-subscription price: ${reasons.join(", ")}.`,
      price: priceShape(price),
    };
  }

  if (!apply) {
    return {
      expected,
      status: "mismatch",
      action: "would_create_replacement_price",
      message: reasons.join(", "),
      price: priceShape(price),
      productNameMismatch: nameMismatch,
    };
  }

  const replacement = await createReplacementSubscriptionPrice(stripe, expected, price);
  if (nameMismatch) {
    return {
      expected,
      status: "fixed_price_product_name_mismatch",
      action: "created_replacement_price_run_product_names_only",
      message:
        "Created replacement Price. Re-run with --apply --product-names-only to update the subscription Product name.",
      oldPrice: priceShape(price),
      price: priceShape(replacement),
      productNameMismatch: nameMismatch,
    };
  }

  return {
    expected,
    status: "fixed",
    action: "created_replacement_price",
    oldPrice: priceShape(price),
    price: priceShape(replacement),
  };
}

function safeSummary(result) {
  const base = {
    id: result.expected.id,
    label: result.expected.label,
    lookupKey: result.expected.lookupKey,
    expectedAmountCents: result.expected.unitAmountCents,
    expectedKind: result.expected.kind,
    status: result.status,
    action: result.action,
  };
  if (result.message) base.message = result.message;
  if (result.price) base.price = result.price;
  if (result.oldPrice) base.oldPrice = result.oldPrice;
  if (result.prices) base.prices = result.prices;
  if (result.productNameMismatch) base.productNameMismatch = result.productNameMismatch;
  if (result.oldProductName !== undefined) base.oldProductName = result.oldProductName;
  if (result.expectedProductName) base.expectedProductName = result.expectedProductName;
  if (result.product) base.product = result.product;
  return base;
}

const args = parseArgs(process.argv.slice(2));
loadEnv(args.envPath);

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error(
    `STRIPE_SECRET_KEY is not configured. Set it in ${path.resolve(args.envPath)} or the process environment.`
  );
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
});
const mode = process.env.STRIPE_SECRET_KEY.startsWith("sk_live_")
  ? "live"
  : process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")
    ? "test"
    : "unknown";
const config = readBillingConfig();
const expectedPrices = args.productNamesOnly
  ? config.subscriptions
  : [
      ...config.subscriptions,
      ...(args.includeOneTimeChecks
        ? [...config.topUps, config.callingNumberRental]
        : []),
    ];

console.log(
  JSON.stringify(
    {
      mode,
      apply: args.apply,
      productNamesOnly: args.productNamesOnly,
      envPath: args.envPath ?? null,
      checkedLookupKeys: expectedPrices.map((price) => price.lookupKey),
    },
    null,
    2
  )
);

const results = [];
for (const expected of expectedPrices) {
  const canApply = args.apply && expected.syncable;
  results.push(
    await inspectExpectedPrice(stripe, expected, canApply, {
      productNamesOnly: args.productNamesOnly,
    })
  );
}

console.log(JSON.stringify(results.map(safeSummary), null, 2));

const unresolved = results.filter(
  (result) => result.status !== "ok" && result.status !== "fixed"
);

if (unresolved.length > 0) {
  console.log(
    JSON.stringify(
      {
        unresolved: unresolved.map((result) => ({
          id: result.expected.id,
          lookupKey: result.expected.lookupKey,
          status: result.status,
          action: result.action,
        })),
      },
      null,
      2
    )
  );
}
