import { NextResponse } from "next/server";
import { getSubscriptionPlan } from "@/lib/billing/config";
import {
  BillingAccessError,
  ensureStripeCustomer,
  getAppUrl,
  getBearerToken,
  getOwnerBillingContext,
  getStripe,
  resolvePriceIdByLookupKey,
  subscriptionCheckoutMetadata,
  VOXANDRA_CHECKOUT_BRANDING,
} from "@/lib/billing/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { planId?: string };
    const plan = getSubscriptionPlan(body.planId);
    if (!plan) {
      return NextResponse.json({ error: "Unknown subscription plan." }, { status: 400 });
    }

    const { profile, workspace, wallet } = await getOwnerBillingContext(authToken);
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer({
      authToken,
      email: profile.email,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      existingCustomerId: wallet.stripeCustomerId,
    });
    const priceId = await resolvePriceIdByLookupKey(stripe, {
      lookupKey: plan.stripeLookupKey,
      unitAmountCents: plan.monthlyPriceCents,
      kind: "monthly_recurring",
      label: plan.name,
    });
    const appUrl = getAppUrl();
    const metadata = subscriptionCheckoutMetadata({ workspaceId: workspace._id, plan });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      branding_settings: VOXANDRA_CHECKOUT_BRANDING,
      allow_promotion_codes: true,
      customer: customerId,
      client_reference_id: workspace._id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: `${appUrl}/app/wallet?checkout=success&plan=${plan.id}`,
      cancel_url: `${appUrl}/app/wallet?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Stripe checkout." },
      { status: error instanceof BillingAccessError ? error.status : 500 }
    );
  }
}
