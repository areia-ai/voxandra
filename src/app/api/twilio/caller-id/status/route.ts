import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import {
  formDataToParams,
  getConvexHttpClient,
  getRequiredEnv,
  validateTwilioRequest,
} from "@/lib/twilio/server";
import { normalizePhoneE164 } from "@/lib/phone";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid Twilio request." }, { status: 400 });
  }

  const params = formDataToParams(formData);
  const valid = await validateTwilioRequest(
    request,
    params,
    process.env.TWILIO_CALLER_ID_STATUS_CALLBACK_URL
  );
  if (!valid) {
    return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 403 });
  }

  const phoneNumber = normalizePhoneE164(params.Called || params.To || "");

  try {
    await getConvexHttpClient().mutation(api.callingNumbers.recordVerificationResult, {
      secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
      verificationStatus: params.VerificationStatus || "failed",
      outgoingCallerIdSid: params.OutgoingCallerIdSid || undefined,
      callSid: params.CallSid || undefined,
      phoneNumber: phoneNumber || undefined,
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record caller ID verification." },
      { status: 500 }
    );
  }
}
