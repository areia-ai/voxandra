import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getAppUrl, getAuthenticatedBillingContext, getBearerToken } from "@/lib/billing/server";
import { normalizePhoneE164 } from "@/lib/phone";
import { getTwilioClient } from "@/lib/twilio/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authToken = getBearerToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      phoneNumber?: string;
      label?: string;
    };
    const phoneNumber = normalizePhoneE164(body.phoneNumber ?? "");
    if (!phoneNumber) {
      return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
    }

    const { convex } = await getAuthenticatedBillingContext(authToken);
    const appUrl = getAppUrl();
    const statusCallback =
      process.env.TWILIO_CALLER_ID_STATUS_CALLBACK_URL?.trim() ||
      `${appUrl}/api/twilio/caller-id/status`;

    const validation = await getTwilioClient().validationRequests.create({
      phoneNumber,
      friendlyName: body.label?.trim() || "Voxandra caller ID",
      statusCallback,
      statusCallbackMethod: "POST",
    });

    await convex.mutation(api.callingNumbers.recordVerificationStarted, {
      phoneNumber,
      label: body.label?.trim() || undefined,
      twilioValidationCode: validation.validationCode,
      twilioValidationCallSid: validation.callSid ?? undefined,
    });

    return NextResponse.json({
      phoneNumber,
      validationCode: validation.validationCode,
      callSid: validation.callSid,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start caller ID verification." },
      { status: 500 }
    );
  }
}
