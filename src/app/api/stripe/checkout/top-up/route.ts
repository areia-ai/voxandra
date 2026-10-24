import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import {
  CUSTOM_TOP_UP_MAX_CENTS,
  CUSTOM_TOP_UP_MIN_CENTS,
  getTopUpOption,
} from "@/lib/billing/config";
import {
  BillingAccessError,
  ensureStripeCustomer,
  getAppUrl,
  getBearerToken,
  getStripe,
  getTopUpBillingContext,
  resolvePriceIdByLookupKey,
  topUpCheckoutMetadata,
  VOXANDRA_CHECKOUT_BRANDING,
  VOXANDRA_CHECKOUT_PRODUCT_IMAGE_URL,
} from "@/lib/billing/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      topUpId?: string;
      customAmountCents?: number;
      businessInvoiceRequested?: boolean;
    };
    const topUp = getTopUpOption(body.topUpId);
    const customAmountCents =
      typeof body.customAmountCents === "number" ? body.customAmountCents : null;
    const amountCents = topUp?.amountCents ?? customAmountCents;

    if (
      !amountCents ||
      amountCents < CUSTOM_TOP_UP_MIN_CENTS ||
      amountCents > CUSTOM_TOP_UP_MAX_CENTS ||
      amountCents % 100 !== 0
    ) {
      return NextResponse.json({ error: "Unknown top-up amount." }, { status: 400 });
    }

    // Owners and admins, not owners only — see getTopUpBillingContext.
    const { convex, profile, workspace, wallet } = await getTopUpBillingContext(authToken);
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer({
      authToken,
      email: profile.email,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      existingCustomerId: wallet.stripeCustomerId,
    });
    if (body.businessInvoiceRequested !== undefined) {
      await convex.mutation(api.stripeBilling.setBillingPreferencesForCurrentWorkspace, {
        businessInvoiceRequested: Boolean(body.businessInvoiceRequested),
      });
    }

    const lineItem = topUp
      ? {
          price: await resolvePriceIdByLookupKey(stripe, {
            lookupKey: topUp.stripeLookupKey,
            unitAmountCents: topUp.amountCents,
            kind: "one_time",
            label: `${topUp.label} top-up credits`,
          }),
          quantity: 1,
        }
      : {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: "Voxandra custom calling credits",
              description: "Prepaid calling credits for browser calls in Voxandra.",
              images: [VOXANDRA_CHECKOUT_PRODUCT_IMAGE_URL],
              metadata: { app: "voxandra", topUpId: "custom" },
            },
          },
          quantity: 1,
        };
    const appUrl = getAppUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      branding_settings: VOXANDRA_CHECKOUT_BRANDING,
      allow_promotion_codes: true,
      customer: customerId,
      client_reference_id: workspace._id,
      line_items: [lineItem],
      metadata: topUpCheckoutMetadata({
        workspaceId: workspace._id,
        topUp: topUp ?? undefined,
        amountCents,
        businessInvoiceRequested: Boolean(body.businessInvoiceRequested),
      }),
      billing_address_collection: body.businessInvoiceRequested ? "required" : "auto",
      customer_update: {
        address: "auto",
        name: "auto",
      },
      success_url: `${appUrl}/app/wallet?checkout=success&topUp=${topUp?.id ?? "custom"}`,
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
