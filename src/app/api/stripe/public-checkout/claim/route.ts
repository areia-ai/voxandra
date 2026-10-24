import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import {
  BillingAccessError,
  getBearerToken,
  getOwnerBillingContext,
  getRequiredEnv,
  getStripe,
} from "@/lib/billing/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      stripeCheckoutSessionId?: string;
      claimToken?: string;
    };
    const stripeCheckoutSessionId = body.stripeCheckoutSessionId?.trim();
    const claimToken = body.claimToken?.trim();
    if (!stripeCheckoutSessionId || !claimToken) {
      return NextResponse.json({ error: "Missing checkout claim details." }, { status: 400 });
    }

    const { convex } = await getOwnerBillingContext(authToken);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(stripeCheckoutSessionId, {
      expand: ["subscription.latest_invoice"],
    });

    const result = await convex.mutation(api.stripeBilling.claimPublicStripeCheckout, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      stripeCheckoutSessionId,
      claimToken,
      stripeSessionJson: JSON.stringify(session),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not claim Stripe checkout." },
      { status: error instanceof BillingAccessError ? error.status : 500 }
    );
  }
}
