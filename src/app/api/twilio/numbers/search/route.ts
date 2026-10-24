import { NextResponse } from "next/server";
import { getAuthenticatedBillingContext, getBearerToken } from "@/lib/billing/server";
import { getTwilioClient } from "@/lib/twilio/server";

export const runtime = "nodejs";

function allowedSearchCountries() {
  return (process.env.TWILIO_NUMBER_SEARCH_COUNTRIES || "US,CA")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await getAuthenticatedBillingContext(authToken);

    const url = new URL(request.url);
    const country = (url.searchParams.get("country") || "US").trim().toUpperCase();
    const countries = allowedSearchCountries();
    if (!countries.includes(country)) {
      return NextResponse.json(
        { error: `Number rental is only enabled for ${countries.join(", ")}.` },
        { status: 400 }
      );
    }

    const areaCode = url.searchParams.get("areaCode")?.replace(/[^0-9]/g, "").slice(0, 3);
    const contains = url.searchParams.get("contains")?.trim();
    const params: {
      voiceEnabled: true;
      excludeAllAddressRequired: true;
      limit: number;
      areaCode?: number;
      contains?: string;
    } = {
      voiceEnabled: true,
      excludeAllAddressRequired: true,
      limit: 10,
    };
    if (areaCode && areaCode.length === 3) params.areaCode = Number(areaCode);
    if (contains) params.contains = contains;

    const numbers = await getTwilioClient().availablePhoneNumbers(country).local.list(params);

    return NextResponse.json({
      numbers: numbers
        .filter((number) => number.capabilities?.voice && number.addressRequirements === "none")
        .slice(0, 10)
        .map((number) => ({
          phoneNumber: number.phoneNumber,
          friendlyName: number.friendlyName,
          isoCountry: number.isoCountry || country,
          region: number.region || undefined,
          locality: number.locality || undefined,
          addressRequirements: number.addressRequirements || "none",
        })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not search Twilio numbers." },
      { status: 500 }
    );
  }
}
