import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  formDataToParams,
  getConvexHttpClient,
  getRequiredEnv,
  logTwilioDebug,
  validateTwilioRequest,
} from "@/lib/twilio/server";

export const runtime = "nodejs";

export async function GET() {
  logTwilioDebug("[Recording Webhook] Received unexpected GET request");
  return NextResponse.json(
    { error: "Use POST for recording callbacks" },
    { status: 405 }
  );
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    console.error("[Recording Webhook] Failed to parse form data", error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const params = formDataToParams(formData);
  logTwilioDebug("[Recording Webhook] Parsed callback", {
    hasRecordingUrl: Boolean(params.RecordingUrl),
    hasRecordingSid: Boolean(params.RecordingSid),
  });

  const valid = await validateTwilioRequest(request, params);
  if (!valid) {
    console.error("[Recording Webhook] Invalid Twilio signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const callbackUrl = new URL(request.url);
  const voxandraCallId =
    params.voxandraCallId || callbackUrl.searchParams.get("voxandraCallId");

  logTwilioDebug("[Recording Webhook] Resolved call", {
    hasCallId: Boolean(voxandraCallId),
  });

  if (!voxandraCallId) {
    console.error("[Recording Webhook] Missing call ID");
    return NextResponse.json({ error: "Missing call ID" }, { status: 400 });
  }

  const recordingUrl = params.RecordingUrl;
  const recordingDuration = params.RecordingDuration;
  const recordingSid = params.RecordingSid;
  const recordingChannels = params.RecordingChannels
    ? Number.parseInt(params.RecordingChannels, 10)
    : undefined;
  const bridgeLegParam = callbackUrl.searchParams.get("bridgeLeg");
  const bridgeLeg = bridgeLegParam === "parent" || bridgeLegParam === "callee" ? bridgeLegParam : undefined;

  if (!recordingUrl) {
    console.error("[Recording Webhook] No recording URL in params");
    return NextResponse.json({ error: "No recording URL" }, { status: 400 });
  }

  try {
    logTwilioDebug("[Recording Webhook] Recording ready for transcription", {
      callId: voxandraCallId,
      hasRecordingSid: Boolean(recordingSid),
    });

    const convex = getConvexHttpClient();
    const secret = getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET");
    if (bridgeLeg) {
      if (!recordingSid) throw new Error("Bridge recording SID missing");
      await convex.mutation(api.bridgeRecordings.recordBridgeRecordingCallback, {
        secret,
        callId: voxandraCallId as Id<"calls">,
        leg: bridgeLeg,
        recordingUrl,
        durationSeconds: recordingDuration ? parseInt(recordingDuration, 10) : undefined,
        recordingSid,
      });
    } else {
      await convex.mutation(api.twilioProvider.recordRecordingCallback, {
        secret,
        callId: voxandraCallId as Id<"calls">,
        recordingUrl,
        recordingDuration: recordingDuration ? parseInt(recordingDuration, 10) : undefined,
        recordingSid,
        recordingChannels:
          recordingChannels && Number.isFinite(recordingChannels) ? recordingChannels : undefined,
      });
    }

    logTwilioDebug("[Recording Webhook] Successfully processed", {
      callId: voxandraCallId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Recording Webhook] Failed to process", {
      message: error instanceof Error ? error.message : "Unknown error",
      hasCallId: Boolean(voxandraCallId),
    });
    return NextResponse.json(
      { error: "Failed to process recording" },
      { status: 500 }
    );
  }
}
