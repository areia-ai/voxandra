import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getSubscriptionPlan } from "@/lib/billing/config";
import {
  getAppUrl,
  getConvexHttpClient,
  getRequiredEnv,
  getStripe,
  resolvePriceIdByLookupKey,
  VOXANDRA_CHECKOUT_BRANDING,
} from "@/lib/billing/server";
import {
  PUBLIC_CHECKOUT_CLAIM_TTL_MS,
  createPublicCheckoutClaimToken,
  hashPublicCheckoutClaimToken,
  publicCheckoutCancelUrl,
  publicCheckoutSuccessUrl,
} from "@/lib/billing/public-checkout";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { planId?: string };
    const plan = getSubscriptionPlan(body.planId);
    if (!plan) {
      return NextResponse.json({ error: "Unknown subscription plan." }, { status: 400 });
    }

    const stripe = getStripe();
    const appUrl = getAppUrl();
    const claimToken = createPublicCheckoutClaimToken();
    const priceId = await resolvePriceIdByLookupKey(stripe, {
      lookupKey: plan.stripeLookupKey,
      unitAmountCents: plan.monthlyPriceCents,
      kind: "monthly_recurring",
      label: plan.name,
    });
    const metadata = {
      kind: "subscription",
      planId: plan.id,
      lookupKey: plan.stripeLookupKey,
      publicCheckout: "true",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      branding_settings: VOXANDRA_CHECKOUT_BRANDING,
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: publicCheckoutSuccessUrl(appUrl, claimToken),
      cancel_url: publicCheckoutCancelUrl(appUrl),
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL." }, { status: 500 });
    }

    const convex = getConvexHttpClient();
    await convex.mutation(api.stripeBilling.recordPublicStripeCheckoutStarted, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      stripeCheckoutSessionId: session.id,
      checkoutType: "subscription",
      planId: plan.id,
      lookupKey: plan.stripeLookupKey,
      amountCents: plan.monthlyPriceCents,
      claimTokenHash: hashPublicCheckoutClaimToken(claimToken),
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : session.customer?.id,
      stripePriceId: priceId,
      expiresAt: session.expires_at
        ? session.expires_at * 1000
        : Date.now() + PUBLIC_CHECKOUT_CLAIM_TTL_MS,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Stripe checkout." },
      { status: 500 }
    );
  }
}
