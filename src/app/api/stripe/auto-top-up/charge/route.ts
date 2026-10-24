import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import {
  AUTO_TOP_UP_AMOUNT_CENTS,
  AUTO_TOP_UP_THRESHOLD_CENTS,
} from "@/lib/billing/config";
import {
  BillingAccessError,
  getBearerToken,
  getConvexHttpClient,
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
    const body = (await request.json().catch(() => ({}))) as { force?: boolean };
    const { workspace, wallet } = await getOwnerBillingContext(authToken);
    const includedBalanceCents = wallet.includedCreditBalanceCents ?? 0;
    const topUpBalanceCents = wallet.topUpCreditBalanceCents ?? 0;
    const availableCreditCents = includedBalanceCents + topUpBalanceCents;
    const thresholdCents = wallet.autoTopUpThresholdCents ?? AUTO_TOP_UP_THRESHOLD_CENTS;
    const amountCents = wallet.autoTopUpAmountCents ?? AUTO_TOP_UP_AMOUNT_CENTS;

    if (!wallet.autoTopUpEnabled) {
      return NextResponse.json(
        { error: "Auto Top-up is not enabled for this workspace." },
        { status: 400 }
      );
    }
    if (!wallet.stripeCustomerId || !wallet.stripeDefaultPaymentMethodId) {
      return NextResponse.json(
        { error: "Auto Top-up needs a saved payment method." },
        { status: 402 }
      );
    }
    if (!body.force && availableCreditCents >= thresholdCents) {
      return NextResponse.json({ charged: false, reason: "balance_above_threshold" });
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: wallet.stripeCustomerId,
      payment_method: wallet.stripeDefaultPaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        kind: "auto_top_up",
        workspaceId: workspace._id,
        amountCents: String(amountCents),
      },
      description: "Voxandra Auto Top-up calling credits",
    });

    if (paymentIntent.status !== "succeeded") {
      return NextResponse.json(
        { error: "Auto Top-up payment needs another payment method." },
        { status: 402 }
      );
    }

    const convex = getConvexHttpClient();
    await convex.mutation(api.stripeBilling.grantAutoTopUpCreditsByCustomer, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      stripeCustomerId: wallet.stripeCustomerId,
      paymentIntentId: paymentIntent.id,
      amountCents,
    });

    return NextResponse.json({ charged: true, amountCents });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Auto Top-up payment failed. Add credits manually before calling.",
      },
      { status: error instanceof BillingAccessError ? error.status : 402 }
    );
  }
}
