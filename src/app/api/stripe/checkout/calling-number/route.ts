import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import {
  CALLING_NUMBER_RENTAL_PRICE_CENTS,
  getCallingNumberRentalLookupKey,
} from "@/lib/billing/config";
import {
  BillingAccessError,
  callingNumberRentalCheckoutMetadata,
  ensureStripeCustomer,
  getAppUrl,
  getBearerToken,
  getOwnerBillingContext,
  getStripe,
  resolvePriceIdByLookupKey,
  VOXANDRA_CHECKOUT_BRANDING,
} from "@/lib/billing/server";
import { normalizePhoneE164 } from "@/lib/phone";
import { getTwilioClient } from "@/lib/twilio/server";

export const runtime = "nodejs";

function allowedSearchCountries() {
  return (process.env.TWILIO_NUMBER_SEARCH_COUNTRIES || "US,CA")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
}

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      phoneNumber?: string;
      label?: string;
      isoCountry?: string;
      region?: string;
      locality?: string;
      addressRequirements?: string;
    };
    const phoneNumber = normalizePhoneE164(body.phoneNumber ?? "");
    const isoCountry = (body.isoCountry || "US").trim().toUpperCase();
    const countries = allowedSearchCountries();

    if (!phoneNumber) {
      return NextResponse.json({ error: "Choose a valid phone number." }, { status: 400 });
    }
    if (!countries.includes(isoCountry)) {
      return NextResponse.json(
        { error: `Number rental is only enabled for ${countries.join(", ")}.` },
        { status: 400 }
      );
    }

    const available = await getTwilioClient().availablePhoneNumbers(isoCountry).local.list({
      contains: phoneNumber,
      voiceEnabled: true,
      excludeAllAddressRequired: true,
      limit: 1,
    });
    const selected = available.find(
      (number) =>
        number.phoneNumber === phoneNumber &&
        number.capabilities?.voice &&
        number.addressRequirements === "none"
    );
    if (!selected) {
      return NextResponse.json(
        { error: "That number is no longer available. Search again before checkout." },
        { status: 409 }
      );
    }

    const { convex, profile, workspace, wallet } =
      await getOwnerBillingContext(authToken);
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer({
      authToken,
      email: profile.email,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      existingCustomerId: wallet.stripeCustomerId,
    });
    const priceId = await resolvePriceIdByLookupKey(
      stripe,
      {
        lookupKey: getCallingNumberRentalLookupKey(),
        unitAmountCents: CALLING_NUMBER_RENTAL_PRICE_CENTS,
        kind: "monthly_recurring",
        label: "Calling number rental",
      }
    );
    const appUrl = getAppUrl();
    const label = body.label?.trim() || selected.friendlyName || "Rented number";
    const metadata = callingNumberRentalCheckoutMetadata({
      workspaceId: workspace._id,
      phoneNumber,
      label,
      isoCountry,
      region: selected.region || body.region,
      locality: selected.locality || body.locality,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      branding_settings: VOXANDRA_CHECKOUT_BRANDING,
      allow_promotion_codes: true,
      customer: customerId,
      client_reference_id: workspace._id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: `${appUrl}/app/wallet?checkout=success&callingNumber=1`,
      cancel_url: `${appUrl}/app/wallet?checkout=cancelled`,
    });

    await convex.mutation(api.callingNumbers.recordRentedNumberCheckoutStarted, {
      phoneNumber,
      label,
      stripeCustomerId: customerId,
      stripeCheckoutSessionId: session.id,
      stripePriceId: priceId,
      rentalPriceCents: CALLING_NUMBER_RENTAL_PRICE_CENTS,
      isoCountry,
      region: selected.region || body.region || undefined,
      locality: selected.locality || body.locality || undefined,
      addressRequirements: selected.addressRequirements || body.addressRequirements || "none",
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start number checkout." },
      { status: error instanceof BillingAccessError ? error.status : 500 }
    );
  }
}
