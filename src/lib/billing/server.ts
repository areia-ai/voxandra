import { ConvexHttpClient } from "convex/browser";
import Stripe from "stripe";
import { api } from "@convex/_generated/api";
import {
  CALLING_NUMBER_RENTAL_PRICE_CENTS,
  STRIPE_API_VERSION,
  getCallingNumberRentalLookupKey,
  type SubscriptionPlanConfig,
  type TopUpConfig,
} from "@/lib/billing/config";

let stripeClient: Stripe | null = null;

export class BillingAccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "BillingAccessError";
    this.status = status;
  }
}

const checkoutLogoFileId = process.env.STRIPE_CHECKOUT_LOGO_FILE_ID?.trim();

export const VOXANDRA_CHECKOUT_PRODUCT_IMAGE_URL =
  "https://voxandra.com/brand/voxandra-mark.png";

export const VOXANDRA_CHECKOUT_BRANDING = {
  background_color: "#F3ECFF",
  button_color: "#3B1676",
  border_style: "rounded",
  display_name: "Voxandra",
  font_family: "inter",
  ...(checkoutLogoFileId
    ? { logo: { type: "file", file: checkoutLogoFileId } }
    : {}),
} satisfies Stripe.Checkout.SessionCreateParams.BrandingSettings;

export function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function getAppUrl() {
  return getRequiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
}

export function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: STRIPE_API_VERSION as never,
    });
  }
  return stripeClient;
}

export function getConvexHttpClient(authToken?: string) {
  const client = new ConvexHttpClient(getRequiredEnv("NEXT_PUBLIC_CONVEX_URL"));
  if (authToken) client.setAuth(authToken);
  return client;
}

export function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

export async function getAuthenticatedBillingContext(authToken: string) {
  const convex = getConvexHttpClient(authToken);
  const [profile, workspace, wallet] = await Promise.all([
    convex.query(api.profiles.getMyProfile, {}),
    convex.query(api.profiles.getMyWorkspace, {}),
    convex.query(api.walletSummaries.getWalletSummary, {}),
  ]);

  if (!profile || !workspace || !wallet) {
    throw new Error("No authenticated workspace found.");
  }

  return { convex, profile, workspace, wallet };
}

export async function getOwnerBillingContext(authToken: string) {
  const context = await getAuthenticatedBillingContext(authToken);
  const role = await context.convex.query(api.team.getMyWorkspaceRole, {});
  if (role !== "owner") {
    throw new BillingAccessError("Only the workspace owner can manage billing.");
  }
  return { ...context, role };
}

// Buying credits is deliberately a WIDER gate than the rest of billing: admins may
// add money, only the owner may change what the workspace is committed to.
//
// Owner-only purchasing was a direct brake on top-up revenue — a rep who runs out
// mid-afternoon could do nothing but wait for one person. Everything else in
// billing stays on getOwnerBillingContext, because subscriptions, the Stripe
// portal, auto top-up (a standing charge authorization, not a purchase) and number
// rentals all create or cancel recurring commitments. A one-off top-up does not.
export async function getTopUpBillingContext(authToken: string) {
  const context = await getAuthenticatedBillingContext(authToken);
  const role = await context.convex.query(api.team.getMyWorkspaceRole, {});
  if (role !== "owner" && role !== "admin") {
    throw new BillingAccessError("Only workspace owners and admins can buy credits.");
  }
  return { ...context, role };
}

export type StripePriceExpectation = {
  lookupKey: string;
  unitAmountCents: number;
  kind: "one_time" | "monthly_recurring";
  currency?: string;
  label?: string;
};

function describePriceExpectation(expectation: StripePriceExpectation) {
  const currency = (expectation.currency ?? "usd").toLowerCase();
  const cadence =
    expectation.kind === "monthly_recurring" ? "monthly recurring" : "one-time";
  return `${expectation.label ?? expectation.lookupKey} ${cadence} ${currency} ${expectation.unitAmountCents} cents`;
}

function validateResolvedStripePrice(
  price: Stripe.Price,
  expectation: StripePriceExpectation
) {
  const expectedCurrency = (expectation.currency ?? "usd").toLowerCase();
  const errors: string[] = [];

  if (!price.active) errors.push("inactive");
  if (price.currency !== expectedCurrency) {
    errors.push(`currency ${price.currency}`);
  }
  if (price.unit_amount !== expectation.unitAmountCents) {
    errors.push(`amount ${price.unit_amount ?? "unknown"} cents`);
  }

  if (expectation.kind === "monthly_recurring") {
    if (price.type !== "recurring") {
      errors.push(`type ${price.type}`);
    }
    if (price.recurring?.interval !== "month") {
      errors.push(`interval ${price.recurring?.interval ?? "none"}`);
    }
    if ((price.recurring?.interval_count ?? 0) !== 1) {
      errors.push(`interval_count ${price.recurring?.interval_count ?? "none"}`);
    }
  } else if (price.type !== "one_time") {
    errors.push(`type ${price.type}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Stripe price ${price.id} for ${expectation.lookupKey} does not match ${describePriceExpectation(expectation)} (${errors.join(", ")}).`
    );
  }
}

export async function resolvePriceIdByLookupKey(
  stripe: Stripe,
  expectation: StripePriceExpectation
) {
  const prices = await stripe.prices.list({
    active: true,
    lookup_keys: [expectation.lookupKey],
    limit: 10,
  });

  if (prices.data.length > 1) {
    throw new Error(
      `Stripe lookup key ${expectation.lookupKey} returned multiple active prices. Keep exactly one active price per lookup key.`
    );
  }

  const price = prices.data[0];
  if (!price) {
    throw new Error(`Stripe price with lookup key ${expectation.lookupKey} was not found.`);
  }

  validateResolvedStripePrice(price, expectation);
  return price.id;
}

export async function ensureStripeCustomer(args: {
  authToken: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  existingCustomerId?: string;
}) {
  const stripe = getStripe();
  if (args.existingCustomerId) {
    return args.existingCustomerId;
  }

  const customer = await stripe.customers.create({
    email: args.email || undefined,
    name: args.workspaceName,
    metadata: {
      workspaceId: args.workspaceId,
    },
  });

  const convex = getConvexHttpClient(args.authToken);
  await convex.mutation(api.stripeBilling.setStripeCustomerForCurrentWorkspace, {
    stripeCustomerId: customer.id,
    billingEmail: args.email || undefined,
  });

  return customer.id;
}

export function subscriptionCheckoutMetadata(args: {
  workspaceId: string;
  plan: SubscriptionPlanConfig;
}) {
  return {
    kind: "subscription",
    workspaceId: args.workspaceId,
    planId: args.plan.id,
    lookupKey: args.plan.stripeLookupKey,
  };
}

export function callingNumberRentalCheckoutMetadata(args: {
  workspaceId: string;
  phoneNumber: string;
  label?: string;
  isoCountry: string;
  region?: string;
  locality?: string;
}) {
  return {
    kind: "calling_number_rental",
    workspaceId: args.workspaceId,
    phoneNumber: args.phoneNumber,
    label: args.label ?? "",
    isoCountry: args.isoCountry,
    region: args.region ?? "",
    locality: args.locality ?? "",
    lookupKey: getCallingNumberRentalLookupKey(),
    amountCents: String(CALLING_NUMBER_RENTAL_PRICE_CENTS),
  };
}

export function topUpCheckoutMetadata(args: {
  workspaceId: string;
  topUp?: TopUpConfig;
  amountCents: number;
  businessInvoiceRequested?: boolean;
}) {
  return {
    kind: "top_up",
    workspaceId: args.workspaceId,
    topUpId: args.topUp?.id ?? "custom",
    lookupKey: args.topUp?.stripeLookupKey ?? "custom",
    amountCents: String(args.amountCents),
    businessInvoiceRequested: args.businessInvoiceRequested ? "true" : "false",
  };
}

export function autoTopUpSetupMetadata(args: {
  workspaceId: string;
  businessInvoiceRequested?: boolean;
  autoTopUpThresholdCents: number;
  autoTopUpAmountCents: number;
}) {
  return {
    kind: "auto_top_up_setup",
    workspaceId: args.workspaceId,
    businessInvoiceRequested: args.businessInvoiceRequested ? "true" : "false",
    autoTopUpThresholdCents: String(args.autoTopUpThresholdCents),
    autoTopUpAmountCents: String(args.autoTopUpAmountCents),
  };
}
