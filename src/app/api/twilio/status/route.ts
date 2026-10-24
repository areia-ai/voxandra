import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  formDataToParams,
  getConvexHttpClient,
  getRequiredEnv,
  logTwilioDebug,
  startBridgeLegRecording,
  validateTwilioRequest,
} from "@/lib/twilio/server";

export const runtime = "nodejs";

function parseDuration(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined;
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid status callback" }, { status: 400 });
  }

  const params = formDataToParams(formData);
  const valid = await validateTwilioRequest(
    request,
    params,
    process.env.TWILIO_STATUS_CALLBACK_URL?.trim()
  );
  if (!valid) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }

  const callbackUrl = new URL(request.url);
  const callId =
    params.voxandraCallId || callbackUrl.searchParams.get("voxandraCallId") || undefined;
  const eventType = params.CallStatus || params.CallStatusCallbackEvent || "status";
  const bridgeLegParam = callbackUrl.searchParams.get("bridgeLeg");
  const bridgeLeg =
    bridgeLegParam === "callee" || bridgeLegParam === "parent"
      ? bridgeLegParam
      : undefined;
  logTwilioDebug("[Status Webhook] Parsed callback", {
    hasCallId: Boolean(callId),
    eventType,
  });

  try {
    if (params.StreamEvent) {
      if (params.StreamEvent === "stream-started" && callId && bridgeLeg && params.CallSid) {
        await startBridgeLegRecording({
          callId: callId as Id<"calls">,
          leg: bridgeLeg,
          providerCallSid: params.CallSid,
          appUrl: getRequiredEnv("NEXT_PUBLIC_APP_URL"),
        });
      }
      return NextResponse.json({ ok: true });
    }

    const convex = getConvexHttpClient();
    // Sibling-leg termination is NOT driven from this response. recordStatusCallback
    // schedules it inside the same Convex transaction that records the hangup, so a
    // lost response, a cold lambda, or a Twilio 4xx on the first termination verb can
    // no longer leave the other leg connected and billing. `terminateCallSid` below
    // is returned for logging only.
    await convex.mutation(api.twilioProvider.recordStatusCallback, {
      secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
      callId: callId ? (callId as Id<"calls">) : undefined,
      providerCallSid: params.CallSid,
      parentCallSid: params.ParentCallSid,
      providerStatus: params.CallStatus,
      eventType,
      durationSeconds: parseDuration(params.CallDuration),
      bridgeLeg,
      payloadSummary: {
        from: params.From,
        to: params.To,
        callStatus: params.CallStatus,
        callDuration: params.CallDuration,
        direction: params.Direction,
        sequenceNumber: params.SequenceNumber,
        timestamp: params.Timestamp,
        callbackSource: params.CallbackSource,
      },
    });

    logTwilioDebug("[Status Webhook] Successfully processed", {
      hasCallId: Boolean(callId),
      eventType,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Status Webhook] Failed", {
      message,
      callId,
      eventType,
    });
    // Answer 500, not 200. The previous 200-on-failure silently discarded
    // terminal call events: a failed mutation meant the reservation was never
    // settled and, because reservation expiry only ever ran opportunistically,
    // those credits stayed reserved forever. A 5xx surfaces in Twilio's
    // Debugger (error 11200) and lets Twilio retry where it retries at all;
    // recordStatusCallback is idempotent, so a replay is safe. The
    // sweep-abandoned-call-reservations cron is the backstop for the cases
    // Twilio does not retry.
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
