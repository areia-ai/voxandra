import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getTopUpOption } from "@/lib/billing/config";
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
    const body = (await request.json().catch(() => ({}))) as { topUpId?: string };
    const topUp = getTopUpOption(body.topUpId);
    if (!topUp) {
      return NextResponse.json({ error: "Unknown top-up amount." }, { status: 400 });
    }

    const stripe = getStripe();
    const appUrl = getAppUrl();
    const claimToken = createPublicCheckoutClaimToken();
    const priceId = await resolvePriceIdByLookupKey(stripe, {
      lookupKey: topUp.stripeLookupKey,
      unitAmountCents: topUp.amountCents,
      kind: "one_time",
      label: `${topUp.label} top-up credits`,
    });
    const metadata = {
      kind: "top_up",
      topUpId: topUp.id,
      lookupKey: topUp.stripeLookupKey,
      amountCents: String(topUp.amountCents),
      publicCheckout: "true",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      branding_settings: VOXANDRA_CHECKOUT_BRANDING,
      allow_promotion_codes: true,
      customer_creation: "always",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
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
      checkoutType: "top_up",
      topUpId: topUp.id,
      lookupKey: topUp.stripeLookupKey,
      amountCents: topUp.amountCents,
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
