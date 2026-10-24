import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { api } from "@convex/_generated/api";
import {
  AUTO_TOP_UP_AMOUNT_CENTS,
  AUTO_TOP_UP_THRESHOLD_CENTS,
} from "@/lib/billing/config";
import {
  BillingAccessError,
  autoTopUpSetupMetadata,
  ensureStripeCustomer,
  getAppUrl,
  getBearerToken,
  getConvexHttpClient,
  getOwnerBillingContext,
  getRequiredEnv,
  getStripe,
  VOXANDRA_CHECKOUT_BRANDING,
} from "@/lib/billing/server";

export const runtime = "nodejs";

function defaultPaymentMethodId(customer: Stripe.Customer | Stripe.DeletedCustomer) {
  if (customer.deleted) return null;
  const paymentMethod = customer.invoice_settings.default_payment_method;
  if (!paymentMethod) return null;
  return typeof paymentMethod === "string" ? paymentMethod : paymentMethod.id;
}

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      businessInvoiceRequested?: boolean;
    };
    const { convex, profile, workspace, wallet } = await getOwnerBillingContext(authToken);

    if (!body.enabled) {
      await convex.mutation(api.stripeBilling.setBillingPreferencesForCurrentWorkspace, {
        autoTopUpEnabled: false,
        autoTopUpThresholdCents: AUTO_TOP_UP_THRESHOLD_CENTS,
        autoTopUpAmountCents: AUTO_TOP_UP_AMOUNT_CENTS,
        businessInvoiceRequested: body.businessInvoiceRequested,
      });
      return NextResponse.json({ saved: true });
    }

    const stripe = getStripe();
    const customerId = await ensureStripeCustomer({
      authToken,
      email: profile.email,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      existingCustomerId: wallet.stripeCustomerId,
    });
    const customer = await stripe.customers.retrieve(customerId);
    const paymentMethodId = defaultPaymentMethodId(customer);

    if (paymentMethodId) {
      const convexServer = getConvexHttpClient();
      await convexServer.mutation(api.stripeBilling.saveAutoTopUpFromStripe, {
        secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
        stripeCustomerId: customerId,
        stripeDefaultPaymentMethodId: paymentMethodId,
        autoTopUpEnabled: true,
        autoTopUpThresholdCents: AUTO_TOP_UP_THRESHOLD_CENTS,
        autoTopUpAmountCents: AUTO_TOP_UP_AMOUNT_CENTS,
      });
      if (body.businessInvoiceRequested !== undefined) {
        await convex.mutation(api.stripeBilling.setBillingPreferencesForCurrentWorkspace, {
          businessInvoiceRequested: Boolean(body.businessInvoiceRequested),
        });
      }
      return NextResponse.json({ saved: true });
    }

    const metadata = autoTopUpSetupMetadata({
      workspaceId: workspace._id,
      businessInvoiceRequested: Boolean(body.businessInvoiceRequested),
      autoTopUpThresholdCents: AUTO_TOP_UP_THRESHOLD_CENTS,
      autoTopUpAmountCents: AUTO_TOP_UP_AMOUNT_CENTS,
    });
    const appUrl = getAppUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      branding_settings: VOXANDRA_CHECKOUT_BRANDING,
      currency: "usd",
      customer: customerId,
      client_reference_id: workspace._id,
      metadata,
      billing_address_collection: body.businessInvoiceRequested ? "required" : "auto",
      customer_update: {
        address: "auto",
        name: "auto",
      },
      success_url: `${appUrl}/app/wallet?autoTopUp=enabled`,
      cancel_url: `${appUrl}/app/wallet?autoTopUp=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not configure Auto Top-up." },
      { status: error instanceof BillingAccessError ? error.status : 500 }
    );
  }
}
