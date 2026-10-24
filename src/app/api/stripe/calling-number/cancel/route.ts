import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  BillingAccessError,
  getBearerToken,
  getConvexHttpClient,
  getOwnerBillingContext,
  getRequiredEnv,
  getStripe,
} from "@/lib/billing/server";
import { getTwilioClient } from "@/lib/twilio/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      callingNumberId?: string;
    };
    if (!body.callingNumberId) {
      return NextResponse.json({ error: "Missing calling number." }, { status: 400 });
    }

    const { convex } = await getOwnerBillingContext(authToken);
    const number = await convex.mutation(
      api.callingNumbers.markRentedNumberCancellationRequested,
      {
        callingNumberId: body.callingNumberId as Id<"callingNumbers">,
      }
    );

    if (number.stripeSubscriptionId) {
      await getStripe().subscriptions.cancel(number.stripeSubscriptionId);
      return NextResponse.json({ cancelled: true });
    }

    if (number.twilioIncomingPhoneNumberSid) {
      await getTwilioClient().incomingPhoneNumbers(number.twilioIncomingPhoneNumberSid).remove();
      await getConvexHttpClient().mutation(api.callingNumbers.recordRentedNumberReleased, {
        secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
        twilioIncomingPhoneNumberSid: number.twilioIncomingPhoneNumberSid,
      });
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json({ cancelled: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cancel rented number." },
      { status: error instanceof BillingAccessError ? error.status : 500 }
    );
  }
}
