import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import type { Id } from "@convex/_generated/dataModel";
import {
  CALLING_NUMBER_RENTAL_PRICE_CENTS,
  getCallingNumberRentalLookupKey,
} from "@/lib/billing/config";
import {
  getAppUrl,
  getConvexHttpClient,
  getRequiredEnv,
  getStripe,
} from "@/lib/billing/server";
import { getTwilioClient } from "@/lib/twilio/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const rawBody = await request.text();

  try {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getRequiredEnv("STRIPE_WEBHOOK_SECRET")
    );
    const convex = getConvexHttpClient();
    const data = event.data.object as unknown as Record<string, unknown>;

    await enrichSubscriptionMetadata(stripe, event.type, data);

    if (
      event.type === "checkout.session.completed" &&
      data.metadata &&
      typeof data.metadata === "object" &&
      (data.metadata as Record<string, unknown>).kind === "auto_top_up_setup" &&
      typeof data.setup_intent === "string" &&
      typeof data.customer === "string"
    ) {
      const setupIntent = await stripe.setupIntents.retrieve(data.setup_intent);
      const paymentMethodId =
        typeof setupIntent.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;
      if (paymentMethodId) {
        await stripe.customers.update(data.customer, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
        data.setup_intent_payment_method = paymentMethodId;
      }
    }

    if (
      (event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded") &&
      isCallingNumberRentalData(data)
    ) {
      await provisionCallingNumberFromCheckout(stripe, convex, data);
    }

    if (
      event.type === "customer.subscription.deleted" &&
      isCallingNumberRentalData(data)
    ) {
      await releaseCallingNumberFromSubscription(convex, data);
    }

    await convex.mutation(api.stripeBilling.processStripeWebhookEvent, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      stripeCreatedAt: event.created,
      dataJson: JSON.stringify(data),
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Stripe webhook." },
      { status: 400 }
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, key: string) {
  const field = asRecord(value)?.[key];
  return typeof field === "string" ? field : null;
}

function metadata(data: Record<string, unknown>) {
  const existing = asRecord(data.metadata);
  if (existing) return existing as Record<string, string>;
  const next: Record<string, string> = {};
  data.metadata = next;
  return next;
}

function getSubscriptionId(data: Record<string, unknown>) {
  const direct = stringField(data, "subscription");
  if (direct) return direct;
  const parent = asRecord(data.parent);
  const details = asRecord(parent?.subscription_details);
  const nested = details?.subscription;
  return typeof nested === "string" ? nested : null;
}

function isCallingNumberRentalData(data: Record<string, unknown>) {
  const dataMetadata = metadata(data);
  return (
    dataMetadata.kind === "calling_number_rental" ||
    dataMetadata.lookupKey === getCallingNumberRentalLookupKey()
  );
}

async function enrichSubscriptionMetadata(
  stripe: Stripe,
  eventType: string,
  data: Record<string, unknown>
) {
  if (!eventType.startsWith("invoice.")) return;
  const subscriptionId = getSubscriptionId(data);
  if (!subscriptionId) return;

  const dataMetadata = metadata(data);
  if (dataMetadata.kind) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  for (const [key, value] of Object.entries(subscription.metadata)) {
    if (typeof value === "string" && dataMetadata[key] === undefined) {
      dataMetadata[key] = value;
    }
  }
  data.subscription = subscriptionId;
}

async function provisionCallingNumberFromCheckout(
  stripe: Stripe,
  convex: ConvexHttpClient,
  data: Record<string, unknown>
) {
  const dataMetadata = metadata(data);
  const sessionId = stringField(data, "id");
  const subscriptionId = getSubscriptionId(data);
  const workspaceId = dataMetadata.workspaceId as Id<"workspaces"> | undefined;
  const phoneNumber = dataMetadata.phoneNumber;
  const label = dataMetadata.label || "Rented number";
  if (!sessionId || !workspaceId || !phoneNumber) return;

  const paymentStatus = stringField(data, "payment_status");
  if (paymentStatus && paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
    return;
  }

  const state = await convex.query(api.callingNumbers.getCallingNumberProvisioningState, {
    secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
    stripeCheckoutSessionId: sessionId,
    stripeSubscriptionId: subscriptionId ?? undefined,
  });
  if (state?.status === "active" && state.twilioIncomingPhoneNumberSid) return;

  let subscriptionItemId: string | undefined;
  let stripePriceId: string | undefined;
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
    const item = subscription.items.data[0];
    subscriptionItemId = item?.id;
    stripePriceId =
      typeof item?.price === "string" ? item.price : item?.price?.id;
  }

  try {
    const appUrl = getAppUrl();
    const incomingNumber = await getTwilioClient().incomingPhoneNumbers.create({
      phoneNumber,
      friendlyName: label,
      voiceUrl: `${appUrl}/api/twilio/inbound`,
      voiceMethod: "POST",
      statusCallback: `${appUrl}/api/twilio/status`,
      statusCallbackMethod: "POST",
    });

    await convex.mutation(api.callingNumbers.recordRentedNumberProvisioned, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      workspaceId,
      phoneNumber,
      label,
      twilioIncomingPhoneNumberSid: incomingNumber.sid,
      stripeCheckoutSessionId: sessionId,
      stripeSubscriptionId: subscriptionId ?? undefined,
      stripeSubscriptionItemId: subscriptionItemId,
      stripeCustomerId: stringField(data, "customer") ?? undefined,
      stripePriceId,
      rentalPriceCents: CALLING_NUMBER_RENTAL_PRICE_CENTS,
      isoCountry: dataMetadata.isoCountry || undefined,
      region: dataMetadata.region || undefined,
      locality: dataMetadata.locality || undefined,
      addressRequirements: "none",
    });
  } catch (error) {
    await convex.mutation(api.callingNumbers.recordRentedNumberProvisioningFailed, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      workspaceId,
      phoneNumber,
      stripeCheckoutSessionId: sessionId,
      errorMessage: error instanceof Error ? error.message : "Twilio number provisioning failed.",
    });
  }
}

async function releaseCallingNumberFromSubscription(
  convex: ConvexHttpClient,
  data: Record<string, unknown>
) {
  const subscriptionId = stringField(data, "id");
  if (!subscriptionId) return;

  const state = await convex.query(api.callingNumbers.getCallingNumberProvisioningState, {
    secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
    stripeSubscriptionId: subscriptionId,
  });
  if (!state || state.status === "released") return;

  try {
    if (state.twilioIncomingPhoneNumberSid) {
      await getTwilioClient().incomingPhoneNumbers(state.twilioIncomingPhoneNumberSid).remove();
    }
    await convex.mutation(api.callingNumbers.recordRentedNumberReleased, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      stripeSubscriptionId: subscriptionId,
      twilioIncomingPhoneNumberSid: state.twilioIncomingPhoneNumberSid,
    });
  } catch (error) {
    await convex.mutation(api.callingNumbers.recordRentedNumberReleaseFailed, {
      secret: getRequiredEnv("STRIPE_CONVEX_WEBHOOK_SECRET"),
      stripeSubscriptionId: subscriptionId,
      twilioIncomingPhoneNumberSid: state.twilioIncomingPhoneNumberSid,
      errorMessage: error instanceof Error ? error.message : "Twilio number release failed.",
    });
  }
}
