import { NextResponse } from "next/server";
import {
  createBridgeCalleeTwiML,
  formDataToParams,
  getRequiredEnv,
  validateTwilioRequest,
} from "@/lib/twilio/server";

export const runtime = "nodejs";

function twimlError(message: string, status = 400) {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say><Hangup/></Response>`,
    {
      status,
      headers: { "Content-Type": "text/xml" },
    }
  );
}

// Real two-leg translation bridge (internal-only, single-workspace test,
// sub-phases 5a/5b — see AGENTIC_FUTURE.md). TwiML for the SECOND leg — the
// real callee, placed by the voice route via the Twilio REST API, never via
// <Dial>. It owns the existing tracked caller->user translation session;
// settlement for the second, reverse-direction Palabra session remains
// deferred. This leg's only audio interface is the worker's WebSocket. 404s
// unless bridge mode is explicitly enabled on this deployment.
export async function POST(request: Request) {
  if (process.env.TWILIO_BRIDGE_MODE_ENABLED !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return twimlError("Invalid Twilio request.", 400);
  }

  const params = formDataToParams(formData);
  const valid = await validateTwilioRequest(
    request,
    params,
    process.env.TWILIO_BRIDGE_LEG_WEBHOOK_URL
  );
  if (!valid) {
    return twimlError("Invalid Twilio signature.", 403);
  }

  const requestUrl = new URL(request.url);
  const voxandraCallId = requestUrl.searchParams.get("voxandraCallId");
  const workspaceId = requestUrl.searchParams.get("workspaceId");
  const translatedCaptionsRealtimeSessionId = requestUrl.searchParams.get(
    "translatedCaptionsRealtimeSessionId"
  );
  const translationSourceLanguage = requestUrl.searchParams.get("translationSourceLanguage");
  const translationTargetLanguage = requestUrl.searchParams.get("translationTargetLanguage");
  const translationVoice = requestUrl.searchParams.get("translationVoice");
  const bridgeTranslationEnabled =
    requestUrl.searchParams.get("bridgeTranslationEnabled") === "true";
  // Signature-covered (it is part of the signed URL), so this cannot be forged
  // by a caller; the worker clamps it again against its own configured ceiling.
  const parsedMaxSessionSeconds = Number(requestUrl.searchParams.get("maxSessionSeconds"));
  const maxSessionSeconds =
    Number.isFinite(parsedMaxSessionSeconds) && parsedMaxSessionSeconds > 0
      ? Math.floor(parsedMaxSessionSeconds)
      : undefined;
  const mediaStreamUrl = process.env.REALTIME_MEDIA_STREAM_URL?.trim();
  if (
    !voxandraCallId ||
    !workspaceId ||
    !translatedCaptionsRealtimeSessionId ||
    !translationSourceLanguage ||
    !translationTargetLanguage ||
    !translationVoice ||
    !bridgeTranslationEnabled ||
    !maxSessionSeconds ||
    !mediaStreamUrl
  ) {
    return twimlError("Bridge leg is not fully configured.", 500);
  }

  const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
  const statusUrl = new URL(
    (process.env.TWILIO_STATUS_CALLBACK_URL || `${appUrl}/api/twilio/status`).trim()
  );
  statusUrl.searchParams.set("voxandraCallId", voxandraCallId);
  statusUrl.searchParams.set("bridgeLeg", "callee");
  const twiml = createBridgeCalleeTwiML({
    statusCallbackUrl: statusUrl.toString(),
    mediaStreamUrl,
    mediaStreamParams: {
      voxandraCallId,
      workspaceId,
      bridgeLeg: "callee",
      liveCopilot: "false",
      translatedCaptions: "true",
      spokenTranslationEnabled: "true",
      bridgeTranslationEnabled: "true",
      translationDirection: "caller_to_user",
      translationSourceLanguage,
      translationTargetLanguage,
      translationVoice,
      translatedCaptionsRealtimeSessionId,
      maxSessionSeconds: String(maxSessionSeconds),
    },
  });

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
