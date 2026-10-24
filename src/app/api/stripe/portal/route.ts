import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  BillingAccessError,
  ensureStripeCustomer,
  getAppUrl,
  getBearerToken,
  getOwnerBillingContext,
  getStripe,
} from "@/lib/billing/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Optional { flow: "cancel" } deep-links the portal straight to the
  // subscription cancellation confirmation. Any other/absent body opens the
  // normal "manage billing" portal home.
  let flow: string | undefined;
  try {
    const body = (await request.json()) as { flow?: string } | null;
    flow = body?.flow;
  } catch {
    flow = undefined;
  }

  try {
    const { profile, workspace, wallet } = await getOwnerBillingContext(authToken);
    const customerId = await ensureStripeCustomer({
      authToken,
      email: profile.email,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      existingCustomerId: wallet.stripeCustomerId,
    });

    const params: Stripe.BillingPortal.SessionCreateParams = {
      customer: customerId,
      return_url: `${getAppUrl()}/app/wallet`,
    };

    // Only deep-link to cancellation when there's an actual subscription to
    // cancel; otherwise fall back to the portal home so the request still works.
    if (flow === "cancel" && wallet.stripeSubscriptionId) {
      params.flow_data = {
        type: "subscription_cancel",
        subscription_cancel: { subscription: wallet.stripeSubscriptionId },
      };
    }

    const session = await getStripe().billingPortal.sessions.create(params);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open billing portal." },
      { status: error instanceof BillingAccessError ? error.status : 500 }
    );
  }
}
