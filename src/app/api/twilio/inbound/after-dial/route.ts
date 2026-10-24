import { NextResponse } from "next/server";
import twilio from "twilio";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  formDataToParams,
  getConvexHttpClient,
  getRequiredEnv,
  validateTwilioRequest,
} from "@/lib/twilio/server";

export const runtime = "nodejs";

function twimlResponse(twiml: string, status = 200) {
  return new NextResponse(twiml, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

function parseDuration(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined;
}

function hangupTwiML(message?: string) {
  const response = new twilio.twiml.VoiceResponse();
  if (message) response.say(message);
  response.hangup();
  return response.toString();
}

function voicemailTwiML(args: {
  appUrl: string;
  callId: Id<"calls">;
  greeting: string;
}) {
  const response = new twilio.twiml.VoiceResponse();
  response.say(args.greeting);
  const recordingUrl = new URL(`${args.appUrl}/api/twilio/recording`);
  recordingUrl.searchParams.set("voxandraCallId", String(args.callId));
  response.record({
    playBeep: true,
    maxLength: 180,
    trim: "trim-silence",
    recordingStatusCallback: recordingUrl.toString(),
    recordingStatusCallbackMethod: "POST",
  });
  response.say("Thank you. Goodbye.");
  response.hangup();
  return response.toString();
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return twimlResponse(hangupTwiML("Invalid Voxandra inbound call request."), 200);
  }

  const params = formDataToParams(formData);
  const valid = await validateTwilioRequest(request, params);
  if (!valid) {
    return twimlResponse(hangupTwiML("Invalid Twilio signature."), 403);
  }

  const callbackUrl = new URL(request.url);
  const callId = params.voxandraCallId || callbackUrl.searchParams.get("voxandraCallId");
  if (!callId) {
    return twimlResponse(hangupTwiML(), 200);
  }

  try {
    const convex = getConvexHttpClient();
    const result = await convex.mutation(api.twilioProvider.recordInboundDialOutcome, {
      secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
      callId: callId as Id<"calls">,
      dialCallSid: params.DialCallSid || undefined,
      dialCallStatus: params.DialCallStatus || undefined,
      dialCallDuration: parseDuration(params.DialCallDuration),
    });

    if (result.action === "voicemail") {
      const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "").trim();
      return twimlResponse(
        voicemailTwiML({
          appUrl,
          callId: callId as Id<"calls">,
          greeting: result.voicemailGreeting,
        })
      );
    }

    return twimlResponse(hangupTwiML());
  } catch (error) {
    console.error("Twilio inbound after-dial webhook failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return twimlResponse(hangupTwiML(), 200);
  }
}
