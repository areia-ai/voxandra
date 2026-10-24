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

function unavailableTwiML(message = "This Voxandra number is not available right now.") {
  const response = new twilio.twiml.VoiceResponse();
  response.say(message);
  response.hangup();
  return response.toString();
}

function recordingCallbackUrl(appUrl: string, callId: Id<"calls">) {
  const url = new URL(`${appUrl}/api/twilio/recording`);
  url.searchParams.set("voxandraCallId", String(callId));
  return url.toString();
}

function afterDialUrl(appUrl: string, callId: Id<"calls">) {
  const url = new URL(`${appUrl}/api/twilio/inbound/after-dial`);
  url.searchParams.set("voxandraCallId", String(callId));
  return url.toString();
}

function inboundForwardingTwiML(args: {
  appUrl: string;
  callId: Id<"calls">;
  forwardingNumber: string;
  ringTimeoutSeconds: number;
  maxCallSeconds: number;
  aiCaptureEnabled: boolean;
}) {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    timeout: args.ringTimeoutSeconds,
    timeLimit: args.maxCallSeconds,
    action: afterDialUrl(args.appUrl, args.callId),
    method: "POST",
    ...(args.aiCaptureEnabled
      ? {
          record: "record-from-answer-dual" as const,
          recordingStatusCallback: recordingCallbackUrl(args.appUrl, args.callId),
          recordingStatusCallbackEvent: ["completed"] as const,
          recordingStatusCallbackMethod: "POST" as const,
        }
      : {}),
  });
  dial.number(args.forwardingNumber);
  return response.toString();
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return twimlResponse(unavailableTwiML("Invalid Voxandra inbound call request."), 200);
  }

  const params = formDataToParams(formData);
  const valid = await validateTwilioRequest(
    request,
    params,
    process.env.TWILIO_INBOUND_WEBHOOK_URL
  );
  if (!valid) {
    return twimlResponse(unavailableTwiML("Invalid Twilio signature."), 403);
  }

  try {
    const convex = getConvexHttpClient();
    const result = await convex.mutation(api.twilioProvider.prepareInboundCall, {
      secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
      providerCallSid: params.CallSid,
      from: params.From,
      to: params.To || params.Called,
      direction: params.Direction,
      incomingPhoneNumberSid: params.IncomingPhoneNumberSid || undefined,
    });

    if (
      result.action !== "forward" ||
      !result.callId ||
      !result.forwardingNumber
    ) {
      return twimlResponse(unavailableTwiML());
    }

    const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "").trim();
    return twimlResponse(
      inboundForwardingTwiML({
        appUrl,
        callId: result.callId as Id<"calls">,
        forwardingNumber: result.forwardingNumber,
        ringTimeoutSeconds: result.ringTimeoutSeconds,
        maxCallSeconds: result.maxCallSeconds,
        aiCaptureEnabled: Boolean(result.aiCaptureEnabled),
      })
    );
  } catch (error) {
    console.error("Twilio inbound webhook failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return twimlResponse(unavailableTwiML(), 200);
  }
}
