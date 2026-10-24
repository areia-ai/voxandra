import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import {
  AUTO_TOP_UP_AMOUNT_CENTS,
  AUTO_TOP_UP_THRESHOLD_CENTS,
  CUSTOM_TOP_UP_MAX_CENTS,
  CUSTOM_TOP_UP_MIN_CENTS,
  getSubscriptionPlan,
  getSubscriptionPlanByLookupKey,
  getTopUpOption,
  getTopUpOptionByLookupKey,
  isCallingNumberRentalLookupKey,
} from "../src/lib/billing/config";
import {
  requireWorkspace,
  requireWorkspaceAdmin,
  requireWorkspaceOwner,
} from "./authHelpers";
import {
  createCreditLedgerEntry,
  clearLegacyTopUpExpiry,
  grantTopUpCredits,
} from "./billingHelpers";

function assertStripeSecret(secret: string) {
  const expected = process.env.STRIPE_CONVEX_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized Stripe billing mutation");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, key: string) {
  const record = asRecord(value);
  const field = record?.[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: unknown, key: string) {
  const record = asRecord(value);
  const field = record?.[key];
  return typeof field === "number" ? field : null;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function recordId(value: unknown, key: string) {
  const field = asRecord(value)?.[key];
  if (typeof field === "string") return field;
  const id = asRecord(field)?.id;
  return typeof id === "string" ? id : null;
}

function metadataField(value: unknown, key: string) {
  const metadata = asRecord(asRecord(value)?.metadata);
  const field = metadata?.[key];
  return typeof field === "string" ? field : null;
}

function booleanMetadataField(value: unknown, key: string) {
  const field = metadataField(value, key);
  return field === "true" ? true : field === "false" ? false : null;
}

function numberMetadataField(value: unknown, key: string) {
  const field = metadataField(value, key);
  if (!field) return null;
  const parsed = Number(field);
  return Number.isFinite(parsed) ? parsed : null;
}

function nestedRecord(value: unknown, keys: string[]) {
  let current: unknown = value;
  for (const key of keys) {
    current = asRecord(current)?.[key];
  }
  return asRecord(current);
}

function addressPatchFromCheckoutSession(data: unknown) {
  const address = nestedRecord(data, ["customer_details", "address"]);
  if (!address) return {};
  return {
    billingAddressLine1:
      typeof address.line1 === "string" ? address.line1 : undefined,
    billingAddressLine2:
      typeof address.line2 === "string" ? address.line2 : undefined,
    billingAddressCity: typeof address.city === "string" ? address.city : undefined,
    billingAddressState:
      typeof address.state === "string" ? address.state : undefined,
    billingAddressPostalCode:
      typeof address.postal_code === "string" ? address.postal_code : undefined,
    billingAddressCountry:
      typeof address.country === "string" ? address.country : undefined,
  };
}

function findLookupKey(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLookupKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;

  if (typeof record.lookup_key === "string") return record.lookup_key;
  for (const item of Object.values(record)) {
    const found = findLookupKey(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function findPriceId(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string" && value.startsWith("price_")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPriceId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.id === "string" && record.id.startsWith("price_")) return record.id;
  for (const item of Object.values(record)) {
    const found = findPriceId(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function isCallingNumberRentalEvent(data: unknown) {
  return (
    metadataField(data, "kind") === "calling_number_rental" ||
    isCallingNumberRentalLookupKey(findLookupKey(data))
  );
}

function nestedPeriodMs(value: unknown, key: "start" | "end") {
  const record = asRecord(value);
  const direct = numberField(record, `current_period_${key}`);
  if (direct) return direct * 1000;

  const lines = asRecord(record?.lines);
  const data = Array.isArray(lines?.data) ? lines.data : [];
  for (const line of data) {
    const period = asRecord(asRecord(line)?.period);
    const periodValue = period?.[key];
    if (typeof periodValue === "number") return periodValue * 1000;
  }
  return undefined;
}

async function getWalletByStripeCustomer(ctx: MutationCtx, stripeCustomerId: string) {
  return await ctx.db
    .query("walletSummaries")
    .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", stripeCustomerId))
    .first();
}

// Owner OR admin, not any member. Reached from ensureStripeCustomer on every
// checkout path, and top-up checkout admits admins (see getTopUpBillingContext),
// so narrowing this to the owner would break admin credit purchases.
export const setStripeCustomerForCurrentWorkspace = mutation({
  args: {
    stripeCustomerId: v.string(),
    billingEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAdmin(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();

    if (!wallet) throw new Error("Wallet not found");

    await ctx.db.patch(wallet._id, {
      stripeCustomerId: args.stripeCustomerId,
      billingEmail: args.billingEmail,
    });

    return { workspaceId, walletSummaryId: wallet._id };
  },
});

export const recordPublicStripeCheckoutStarted = mutation({
  args: {
    secret: v.string(),
    stripeCheckoutSessionId: v.string(),
    checkoutType: v.union(v.literal("subscription"), v.literal("top_up")),
    planId: v.optional(v.string()),
    topUpId: v.optional(v.string()),
    lookupKey: v.string(),
    amountCents: v.number(),
    claimTokenHash: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertStripeSecret(args.secret);

    const existing = await ctx.db
      .query("publicStripeCheckouts")
      .withIndex("by_stripe_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId)
      )
      .first();
    if (existing) {
      return { checkoutId: existing._id, status: existing.status };
    }

    const now = Date.now();
    const checkoutId = await ctx.db.insert("publicStripeCheckouts", {
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      checkoutType: args.checkoutType,
      planId: args.planId,
      topUpId: args.topUpId,
      lookupKey: args.lookupKey,
      amountCents: args.amountCents,
      claimTokenHash: args.claimTokenHash,
      status: "pending",
      stripeCustomerId: args.stripeCustomerId,
      stripePriceId: args.stripePriceId,
      createdAt: now,
      updatedAt: now,
      expiresAt: args.expiresAt,
    });

    return { checkoutId, status: "pending" as const };
  },
});

export const claimPublicStripeCheckout = mutation({
  args: {
    secret: v.string(),
    stripeCheckoutSessionId: v.string(),
    claimToken: v.string(),
    stripeSessionJson: v.string(),
  },
  handler: async (ctx, args) => {
    assertStripeSecret(args.secret);

    const workspaceId = await requireWorkspace(ctx);
    const now = Date.now();
    const checkout = await ctx.db
      .query("publicStripeCheckouts")
      .withIndex("by_stripe_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId)
      )
      .first();

    if (!checkout) {
      throw new Error("This checkout could not be found. Start checkout again from pricing.");
    }
    if (checkout.status === "claimed") {
      if (checkout.claimedWorkspaceId === workspaceId) {
        return {
          claimed: true as const,
          alreadyClaimed: true as const,
          checkoutType: checkout.checkoutType,
          planId: checkout.planId,
          topUpId: checkout.topUpId,
        };
      }
      throw new Error("This checkout has already been claimed by another workspace.");
    }
    if (checkout.expiresAt < now) {
      await ctx.db.patch(checkout._id, { status: "expired", updatedAt: now });
      throw new Error("This checkout claim link expired. Start checkout again from pricing.");
    }

    const tokenHash = await sha256(args.claimToken);
    if (tokenHash !== checkout.claimTokenHash) {
      throw new Error("This checkout claim link is invalid.");
    }

    const data = JSON.parse(args.stripeSessionJson) as unknown;
    if (recordId(data, "id") !== args.stripeCheckoutSessionId) {
      throw new Error("Stripe checkout session mismatch.");
    }

    const sessionStatus = stringField(data, "status");
    if (sessionStatus && sessionStatus !== "complete") {
      throw new Error("Stripe checkout is not complete yet.");
    }

    const paymentStatus = stringField(data, "payment_status");
    if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
      throw new Error("Stripe checkout payment is not complete yet.");
    }

    const walletBeforeExpiry = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (!walletBeforeExpiry) {
      throw new Error("Wallet not found.");
    }
    const wallet = await clearLegacyTopUpExpiry(ctx, walletBeforeExpiry);
    const stripeCustomerId = recordId(data, "customer");
    if (!stripeCustomerId) {
      throw new Error("Stripe checkout is missing a customer.");
    }

    const customerDetails = nestedRecord(data, ["customer_details"]);
    const billingEmail =
      typeof customerDetails?.email === "string"
        ? customerDetails.email
        : wallet.billingEmail;
    const stripePriceId = findPriceId(data) ?? checkout.stripePriceId;
    const addressPatch = addressPatchFromCheckoutSession(data);

    if (checkout.checkoutType === "subscription") {
      const plan = getSubscriptionPlan(checkout.planId);
      if (!plan) {
        throw new Error("Unknown subscription plan for this checkout.");
      }

      const subscription = asRecord(asRecord(data)?.subscription);
      const stripeSubscriptionId = recordId(data, "subscription");
      const subscriptionStatus = stringField(subscription, "status") ?? "active";
      if (!stripeSubscriptionId) {
        throw new Error("Stripe checkout is missing a subscription.");
      }
      if (subscriptionStatus !== "active" && subscriptionStatus !== "trialing") {
        throw new Error("Stripe subscription is not active yet.");
      }

      const topUpBalance = wallet.topUpCreditBalanceCents ?? 0;
      const invoiceId =
        recordId(data, "invoice") ??
        recordId(subscription, "latest_invoice");
      const includedCreditExternalId = invoiceId
        ? `stripe_invoice:${invoiceId}`
        : `stripe_public_subscription:${args.stripeCheckoutSessionId}:included`;

      await ctx.db.patch(wallet._id, {
        planId: plan.id,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        stripeCurrentPeriodStart: nestedPeriodMs(subscription, "start"),
        stripeCurrentPeriodEnd: nestedPeriodMs(subscription, "end"),
        subscriptionStatus,
        billingEmail,
        aiFeaturesEnabled: true,
        includedCreditBalanceCents: plan.includedCreditCents,
        includedCreditGrantedCents: plan.includedCreditCents,
        reservedCreditCents: wallet.reservedCreditCents ?? 0,
        usageThisMonth: 0,
        lastCreditResetAt: now,
        creditBalance: (plan.includedCreditCents + topUpBalance) / 100,
        ...addressPatch,
      });
      await ctx.db.patch(workspaceId, { plan: plan.id });

      await createCreditLedgerEntry(ctx, {
        workspaceId,
        walletSummaryId: wallet._id,
        externalId: includedCreditExternalId,
        type: "grant_included",
        bucket: "included",
        amountCents: plan.includedCreditCents,
        description: `${plan.name} monthly included credits from paid public checkout`,
        createdAt: now,
      });

      await ctx.db.patch(checkout._id, {
        status: "claimed",
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        claimedWorkspaceId: workspaceId,
        claimedAt: now,
        updatedAt: now,
      });

      return {
        claimed: true as const,
        checkoutType: checkout.checkoutType,
        planId: plan.id,
      };
    }

    const topUp = getTopUpOption(checkout.topUpId);
    const amountCents = topUp?.amountCents ?? checkout.amountCents;
    if (
      !amountCents ||
      amountCents < CUSTOM_TOP_UP_MIN_CENTS ||
      amountCents > CUSTOM_TOP_UP_MAX_CENTS
    ) {
      throw new Error("Unknown top-up amount for this checkout.");
    }

    await ctx.db.patch(wallet._id, {
      stripeCustomerId,
      billingEmail,
      ...addressPatch,
    });

    await grantTopUpCredits(ctx, {
      workspaceId,
      walletSummaryId: wallet._id,
      amountCents,
      externalId: `stripe_top_up:${args.stripeCheckoutSessionId}`,
      description: `${topUp?.label ?? "Custom"} top-up credits purchased through public Stripe checkout`,
      now,
    });

    const hadActiveSubscription = ["active", "trialing"].includes(wallet.subscriptionStatus);
    if (!hadActiveSubscription) {
      await ctx.db.patch(workspaceId, { plan: "calls_only" });
    }

    await ctx.db.patch(checkout._id, {
      status: "claimed",
      stripeCustomerId,
      stripePriceId,
      claimedWorkspaceId: workspaceId,
      claimedAt: now,
      updatedAt: now,
    });

    return {
      claimed: true as const,
      checkoutType: checkout.checkoutType,
      topUpId: topUp?.id ?? checkout.topUpId,
    };
  },
});

// Split gate, because this one mutation carries two very different authorities.
//
// The auto top-up fields are a STANDING AUTHORIZATION to charge the owner's saved
// card whenever the balance dips — so they are owner-only, matching the API route
// at src/app/api/stripe/auto-top-up/setup. That route's check was previously the
// ONLY thing enforcing it: this mutation is public and was guarded by bare
// requireWorkspace, so any member could call it straight from the browser and turn
// auto top-up on against someone else's card. A role check in a Next route is not a
// gate; the Convex function is the authoritative surface and has to re-check.
//
// businessInvoiceRequested is just an invoicing preference set during top-up
// checkout, so it stays open to admins, who can buy credits.
export const setBillingPreferencesForCurrentWorkspace = mutation({
  args: {
    businessInvoiceRequested: v.optional(v.boolean()),
    autoTopUpEnabled: v.optional(v.boolean()),
    autoTopUpThresholdCents: v.optional(v.number()),
    autoTopUpAmountCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const touchesAutoTopUp =
      args.autoTopUpEnabled !== undefined ||
      args.autoTopUpThresholdCents !== undefined ||
      args.autoTopUpAmountCents !== undefined;
    const { workspaceId } = touchesAutoTopUp
      ? await requireWorkspaceOwner(ctx)
      : await requireWorkspaceAdmin(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();

    if (!wallet) throw new Error("Wallet not found");

    const patch: {
      businessInvoiceRequested?: boolean;
      autoTopUpEnabled?: boolean;
      autoTopUpThresholdCents?: number;
      autoTopUpAmountCents?: number;
    } = {};
    if (args.businessInvoiceRequested !== undefined) {
      patch.businessInvoiceRequested = args.businessInvoiceRequested;
    }
    if (args.autoTopUpEnabled !== undefined) {
      patch.autoTopUpEnabled = args.autoTopUpEnabled;
    }
    if (args.autoTopUpThresholdCents !== undefined) {
      patch.autoTopUpThresholdCents = args.autoTopUpThresholdCents;
    }
    if (args.autoTopUpAmountCents !== undefined) {
      patch.autoTopUpAmountCents = args.autoTopUpAmountCents;
    }

    await ctx.db.patch(wallet._id, patch);

    return { saved: true };
  },
});

export const saveAutoTopUpFromStripe = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    stripeDefaultPaymentMethodId: v.optional(v.string()),
    autoTopUpEnabled: v.boolean(),
    autoTopUpThresholdCents: v.number(),
    autoTopUpAmountCents: v.number(),
  },
  handler: async (ctx, args) => {
    assertStripeSecret(args.secret);
    const wallet = await getWalletByStripeCustomer(ctx, args.stripeCustomerId);
    if (!wallet) throw new Error("Wallet not found");

    await ctx.db.patch(wallet._id, {
      autoTopUpEnabled: args.autoTopUpEnabled,
      autoTopUpThresholdCents: args.autoTopUpThresholdCents,
      autoTopUpAmountCents: args.autoTopUpAmountCents,
      stripeDefaultPaymentMethodId:
        args.stripeDefaultPaymentMethodId ?? wallet.stripeDefaultPaymentMethodId,
    });

    return { saved: true };
  },
});

export const grantAutoTopUpCreditsByCustomer = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    paymentIntentId: v.string(),
    amountCents: v.number(),
  },
  handler: async (ctx, args) => {
    assertStripeSecret(args.secret);
    const wallet = await getWalletByStripeCustomer(ctx, args.stripeCustomerId);
    if (!wallet) throw new Error("Wallet not found");

    const now = Date.now();
    return await grantTopUpCredits(ctx, {
      workspaceId: wallet.workspaceId,
      walletSummaryId: wallet._id,
      amountCents: args.amountCents,
      externalId: `stripe_auto_topup:${args.paymentIntentId}`,
      description: "Auto Top-up credits purchased through Stripe",
      now,
    });
  },
});

export const processStripeWebhookEvent = mutation({
  args: {
    secret: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    livemode: v.boolean(),
    stripeCreatedAt: v.number(),
    dataJson: v.string(),
  },
  handler: async (ctx, args) => {
    assertStripeSecret(args.secret);

    const previous = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (previous?.status === "processed" || previous?.status === "skipped") {
      return { status: "duplicate" as const };
    }

    const receivedAt = Date.now();
    try {
      const data = JSON.parse(args.dataJson) as unknown;
      const result = await applyStripeEvent(ctx, args.eventType, data, receivedAt);

      await ctx.db.insert("stripeWebhookEvents", {
        eventId: args.eventId,
        eventType: args.eventType,
        livemode: args.livemode,
        stripeCreatedAt: args.stripeCreatedAt,
        receivedAt,
        processedAt: Date.now(),
        status: result.status,
      });

      return result;
    } catch (error) {
      await ctx.db.insert("stripeWebhookEvents", {
        eventId: args.eventId,
        eventType: args.eventType,
        livemode: args.livemode,
        stripeCreatedAt: args.stripeCreatedAt,
        receivedAt,
        processedAt: Date.now(),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown Stripe webhook error",
      });
      throw error;
    }
  },
});

async function applyStripeEvent(
  ctx: MutationCtx,
  eventType: string,
  data: unknown,
  now: number
) {
  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return await applyCheckoutSession(ctx, data, now);
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return await applyPaidInvoice(ctx, data, now);
    case "invoice.payment_failed":
      return await applyFailedInvoice(ctx, data);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return await applySubscriptionUpdate(ctx, data);
    case "customer.subscription.deleted":
      return await applySubscriptionDeleted(ctx, data);
    case "payment_intent.succeeded":
      return await applyPaymentIntentSucceeded(ctx, data, now);
    default:
      return { status: "skipped" as const, reason: "unhandled_event_type" };
  }
}

async function recordPublicCheckoutWaitingForClaim(
  ctx: MutationCtx,
  data: unknown,
  now: number
) {
  const sessionId = recordId(data, "id");
  if (!sessionId) return { status: "skipped" as const, reason: "missing_public_checkout_session" };

  const checkout = await ctx.db
    .query("publicStripeCheckouts")
    .withIndex("by_stripe_checkout_session", (q) =>
      q.eq("stripeCheckoutSessionId", sessionId)
    )
    .first();
  if (!checkout) return { status: "skipped" as const, reason: "public_checkout_not_found" };
  if (checkout.status === "claimed") {
    return { status: "processed" as const, reason: "public_checkout_already_claimed" };
  }

  await ctx.db.patch(checkout._id, {
    status: "paid",
    stripeCustomerId: recordId(data, "customer") ?? checkout.stripeCustomerId,
    stripeSubscriptionId: recordId(data, "subscription") ?? checkout.stripeSubscriptionId,
    stripePriceId: findPriceId(data) ?? checkout.stripePriceId,
    updatedAt: now,
  });

  return { status: "processed" as const, reason: "public_checkout_waiting_for_claim" };
}

async function applyCheckoutSession(
  ctx: MutationCtx,
  data: unknown,
  now: number
) {
  const kind = metadataField(data, "kind");
  const customerId = recordId(data, "customer");
  if (!customerId) return { status: "skipped" as const, reason: "missing_customer" };

  const walletBeforeExpiry = await getWalletByStripeCustomer(ctx, customerId);
  if (!walletBeforeExpiry) {
    if (metadataField(data, "publicCheckout") === "true") {
      return await recordPublicCheckoutWaitingForClaim(ctx, data, now);
    }
    return { status: "skipped" as const, reason: "wallet_not_found" };
  }
  const wallet = await clearLegacyTopUpExpiry(ctx, walletBeforeExpiry);

  if (kind === "auto_top_up_setup") {
    const paymentMethodId =
      stringField(data, "setup_intent_payment_method") ??
      stringField(data, "payment_method");
    await ctx.db.patch(wallet._id, {
      autoTopUpEnabled: true,
      autoTopUpThresholdCents:
        numberMetadataField(data, "autoTopUpThresholdCents") ??
        AUTO_TOP_UP_THRESHOLD_CENTS,
      autoTopUpAmountCents:
        numberMetadataField(data, "autoTopUpAmountCents") ??
        AUTO_TOP_UP_AMOUNT_CENTS,
      stripeDefaultPaymentMethodId:
        paymentMethodId ?? wallet.stripeDefaultPaymentMethodId,
      businessInvoiceRequested:
        booleanMetadataField(data, "businessInvoiceRequested") ??
        wallet.businessInvoiceRequested,
      ...addressPatchFromCheckoutSession(data),
    });
    return { status: "processed" as const, reason: "auto_top_up_setup_saved" };
  }

  if (isCallingNumberRentalEvent(data)) {
    return { status: "processed" as const, reason: "calling_number_checkout_recorded" };
  }

  if (kind === "top_up") {
    const topUpId = metadataField(data, "topUpId");
    const topUp = getTopUpOption(topUpId) ?? getTopUpOptionByLookupKey(findLookupKey(data));
    const metadataAmountCents = numberMetadataField(data, "amountCents");
    const amountCents = topUp?.amountCents ?? metadataAmountCents;
    if (
      !amountCents ||
      amountCents < CUSTOM_TOP_UP_MIN_CENTS ||
      amountCents > CUSTOM_TOP_UP_MAX_CENTS
    ) {
      return { status: "skipped" as const, reason: "unknown_top_up" };
    }

    const paymentStatus = stringField(data, "payment_status");
    if (paymentStatus && paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
      return { status: "skipped" as const, reason: "top_up_payment_not_paid" };
    }

    const externalId = `stripe_top_up:${stringField(data, "id") ?? "unknown"}`;
    const existing = await ctx.db
      .query("creditLedgerEntries")
      .withIndex("by_external", (q) => q.eq("externalId", externalId))
      .first();
    if (existing) return { status: "processed" as const, reason: "top_up_already_granted" };

    await ctx.db.patch(wallet._id, {
      businessInvoiceRequested:
        booleanMetadataField(data, "businessInvoiceRequested") ??
        wallet.businessInvoiceRequested,
      ...addressPatchFromCheckoutSession(data),
    });

    await grantTopUpCredits(ctx, {
      workspaceId: wallet.workspaceId,
      walletSummaryId: wallet._id,
      amountCents,
      externalId,
      description: `${topUp?.label ?? "Custom"} top-up credits purchased through Stripe`,
      now,
    });

    return { status: "processed" as const, reason: "top_up_granted" };
  }

  const plan = getSubscriptionPlan(metadataField(data, "planId")) ?? getSubscriptionPlanByLookupKey(findLookupKey(data));
  if (!plan) return { status: "skipped" as const, reason: "unknown_subscription_plan" };

  await ctx.db.patch(wallet._id, {
    planId: plan.id,
    stripeSubscriptionId: stringField(data, "subscription") ?? wallet.stripeSubscriptionId,
    stripePriceId: findPriceId(data) ?? wallet.stripePriceId,
    subscriptionStatus: "active",
    aiFeaturesEnabled: true,
  });

  await ctx.db.patch(wallet.workspaceId, { plan: plan.id });

  return { status: "processed" as const, reason: "subscription_checkout_recorded" };
}

async function applyPaymentIntentSucceeded(
  ctx: MutationCtx,
  data: unknown,
  now: number
) {
  if (metadataField(data, "kind") !== "auto_top_up") {
    return { status: "skipped" as const, reason: "not_auto_top_up" };
  }
  const customerId = stringField(data, "customer");
  const paymentIntentId = stringField(data, "id");
  const amountCents = numberField(data, "amount_received") ?? numberField(data, "amount");
  if (!customerId || !paymentIntentId || !amountCents) {
    return { status: "skipped" as const, reason: "missing_auto_top_up_payment_data" };
  }
  const wallet = await getWalletByStripeCustomer(ctx, customerId);
  if (!wallet) return { status: "skipped" as const, reason: "wallet_not_found" };

  await grantTopUpCredits(ctx, {
    workspaceId: wallet.workspaceId,
    walletSummaryId: wallet._id,
    amountCents,
    externalId: `stripe_auto_topup:${paymentIntentId}`,
    description: "Auto Top-up credits purchased through Stripe",
    now,
  });

  return { status: "processed" as const, reason: "auto_top_up_granted" };
}

async function applyPaidInvoice(
  ctx: MutationCtx,
  data: unknown,
  now: number
) {
  const customerId = stringField(data, "customer");
  if (!customerId) return { status: "skipped" as const, reason: "missing_customer" };

  const walletBeforeExpiry = await getWalletByStripeCustomer(ctx, customerId);
  if (!walletBeforeExpiry) return { status: "skipped" as const, reason: "wallet_not_found" };
  const wallet = await clearLegacyTopUpExpiry(ctx, walletBeforeExpiry);

  if (isCallingNumberRentalEvent(data)) {
    return { status: "processed" as const, reason: "calling_number_invoice_recorded" };
  }

  const plan = getSubscriptionPlanByLookupKey(findLookupKey(data)) ?? getSubscriptionPlan(wallet.planId);
  if (!plan) return { status: "skipped" as const, reason: "unknown_invoice_plan" };

  const invoiceId = stringField(data, "id") ?? argsFallbackExternalId(now);
  const externalId = `stripe_invoice:${invoiceId}`;
  const existing = await ctx.db
    .query("creditLedgerEntries")
    .withIndex("by_external", (q) => q.eq("externalId", externalId))
    .first();
  if (existing) return { status: "processed" as const, reason: "included_credits_already_granted" };

  const topUpBalance = wallet.topUpCreditBalanceCents ?? 0;
  const subscriptionId = stringField(data, "subscription") ?? wallet.stripeSubscriptionId;

  await ctx.db.patch(wallet._id, {
    planId: plan.id,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: findPriceId(data) ?? wallet.stripePriceId,
    stripeCurrentPeriodStart: nestedPeriodMs(data, "start"),
    stripeCurrentPeriodEnd: nestedPeriodMs(data, "end"),
    subscriptionStatus: "active",
    aiFeaturesEnabled: true,
    includedCreditBalanceCents: plan.includedCreditCents,
    includedCreditGrantedCents: plan.includedCreditCents,
    reservedCreditCents: wallet.reservedCreditCents ?? 0,
    usageThisMonth: 0,
    lastCreditResetAt: now,
    creditBalance: (plan.includedCreditCents + topUpBalance) / 100,
  });

  await ctx.db.patch(wallet.workspaceId, { plan: plan.id });

  await createCreditLedgerEntry(ctx, {
    workspaceId: wallet.workspaceId,
    walletSummaryId: wallet._id,
    externalId,
    type: "grant_included",
    bucket: "included",
    amountCents: plan.includedCreditCents,
    description: `${plan.name} monthly included credits reset from paid Stripe invoice`,
    createdAt: now,
  });

  return { status: "processed" as const, reason: "included_credits_reset" };
}

async function applyFailedInvoice(
  ctx: MutationCtx,
  data: unknown
) {
  const customerId = stringField(data, "customer");
  if (!customerId) return { status: "skipped" as const, reason: "missing_customer" };
  const wallet = await getWalletByStripeCustomer(ctx, customerId);
  if (!wallet) return { status: "skipped" as const, reason: "wallet_not_found" };

  if (isCallingNumberRentalEvent(data)) {
    return { status: "processed" as const, reason: "calling_number_invoice_failed" };
  }

  await ctx.db.patch(wallet._id, {
    subscriptionStatus: "past_due",
    aiFeaturesEnabled: false,
  });

  return { status: "processed" as const, reason: "invoice_failed" };
}

async function applySubscriptionUpdate(
  ctx: MutationCtx,
  data: unknown
) {
  const customerId = stringField(data, "customer");
  if (!customerId) return { status: "skipped" as const, reason: "missing_customer" };
  const wallet = await getWalletByStripeCustomer(ctx, customerId);
  if (!wallet) return { status: "skipped" as const, reason: "wallet_not_found" };

  if (isCallingNumberRentalEvent(data)) {
    return { status: "processed" as const, reason: "calling_number_subscription_updated" };
  }

  const plan = getSubscriptionPlanByLookupKey(findLookupKey(data)) ?? getSubscriptionPlan(wallet.planId);
  const status = stringField(data, "status") ?? wallet.subscriptionStatus;
  const active = status === "active" || status === "trialing";
  const nextPlanId = active && plan ? plan.id : wallet.planId;

  await ctx.db.patch(wallet._id, {
    planId: nextPlanId,
    stripeSubscriptionId: stringField(data, "id") ?? wallet.stripeSubscriptionId,
    stripePriceId: findPriceId(data) ?? wallet.stripePriceId,
    stripeCurrentPeriodStart: nestedPeriodMs(data, "start"),
    stripeCurrentPeriodEnd: nestedPeriodMs(data, "end"),
    stripeCancelAtPeriodEnd:
      asRecord(data)?.cancel_at_period_end === true
        ? true
        : asRecord(data)?.cancel_at_period_end === false
          ? false
          : wallet.stripeCancelAtPeriodEnd,
    subscriptionStatus: status,
    aiFeaturesEnabled: active,
  });

  if (active && plan) await ctx.db.patch(wallet.workspaceId, { plan: plan.id });

  return { status: "processed" as const, reason: "subscription_updated" };
}

async function applySubscriptionDeleted(ctx: MutationCtx, data: unknown) {
  const customerId = stringField(data, "customer");
  if (!customerId) return { status: "skipped" as const, reason: "missing_customer" };
  const walletBeforeExpiry = await getWalletByStripeCustomer(ctx, customerId);
  if (!walletBeforeExpiry) return { status: "skipped" as const, reason: "wallet_not_found" };
  const wallet = await clearLegacyTopUpExpiry(ctx, walletBeforeExpiry);

  if (isCallingNumberRentalEvent(data)) {
    return { status: "processed" as const, reason: "calling_number_subscription_deleted" };
  }

  const topUpBalance = wallet.topUpCreditBalanceCents ?? 0;
  await ctx.db.patch(wallet._id, {
    planId: topUpBalance > 0 ? "calls_only" : "free",
    subscriptionStatus: topUpBalance > 0 ? "calls_only" : "canceled",
    stripeSubscriptionId: undefined,
    stripePriceId: undefined,
    stripeCurrentPeriodStart: undefined,
    stripeCurrentPeriodEnd: undefined,
    stripeCancelAtPeriodEnd: false,
    includedCreditBalanceCents: 0,
    includedCreditGrantedCents: 0,
    aiFeaturesEnabled: false,
    creditBalance: topUpBalance / 100,
  });

  await ctx.db.patch(wallet.workspaceId, { plan: topUpBalance > 0 ? "calls_only" : "free" });

  return { status: "processed" as const, reason: "subscription_deleted" };
}

function argsFallbackExternalId(now: number) {
  return `missing-invoice-id-${now}`;
}
