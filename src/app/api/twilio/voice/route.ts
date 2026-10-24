import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  createBridgeParentTwiML,
  createVoiceTwiML,
  formDataToParams,
  getConvexHttpClient,
  getRequiredEnv,
  getTwilioClient,
  logTwilioDebug,
  validateTwilioRequest,
} from "@/lib/twilio/server";
import { resolveTwilioTerminationStatus } from "@/lib/twilio/bridge-lifecycle";

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

// Inline fast path only. Convex owns the durable, retrying termination
// (internal.twilioLifecycle.terminateProviderCall); this exists so a setup
// failure kills the callee leg in the same request instead of one scheduler
// tick later. Tries both accepted verbs because Twilio rejects the wrong one
// for the leg's current state, and that state can change between the read and
// the write.
async function terminateTwilioCall(callSid: string) {
  const client = getTwilioClient();
  const call = await client.calls(callSid).fetch();
  const plan = resolveTwilioTerminationStatus(call.status);
  if (!plan) return;
  try {
    await client.calls(callSid).update({ status: plan.primary });
  } catch {
    await client.calls(callSid).update({ status: plan.fallback });
  }
}

export async function POST(request: Request) {
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
    process.env.TWILIO_WEBHOOK_URL
  );
  if (!valid) {
    return twimlError("Invalid Twilio signature.", 403);
  }

  const voxandraCallId = params.voxandraCallId;
  const voxandraSessionToken = params.voxandraSessionToken;
  if (!voxandraCallId || !voxandraSessionToken || !params.CallSid) {
    return twimlError("Missing Voxandra call session.", 400);
  }

  try {
    const convex = getConvexHttpClient();
    const result = await convex.mutation(api.twilioProvider.validateSessionForTwiML, {
      secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
      callId: voxandraCallId as Id<"calls">,
      sessionToken: voxandraSessionToken,
      parentCallSid: params.CallSid,
    });

    const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "").trim();
    const statusCallbackUrl =
      (process.env.TWILIO_STATUS_CALLBACK_URL || `${appUrl}/api/twilio/status`).trim();
    const statusUrl = new URL(statusCallbackUrl);
    statusUrl.searchParams.set("voxandraCallId", String(result.callId));
    const recordingStatusCallbackUrl = result.aiCaptureEnabled
      ? (() => {
          const recordingUrl = new URL(`${appUrl}/api/twilio/recording`);
          recordingUrl.searchParams.set("voxandraCallId", String(result.callId));
          return recordingUrl.toString();
        })()
      : undefined;
    const mediaStreamUrl = process.env.REALTIME_MEDIA_STREAM_URL?.trim();
    const realtimeRequested =
      Boolean(result.realtimeCopilotRequested) || Boolean(result.translatedCaptionsRequested);
    const realtimeMediaStreamUrl = mediaStreamUrl && realtimeRequested ? mediaStreamUrl : undefined;

    logTwilioDebug("[Voice Webhook] Creating outbound TwiML", {
      callId: result.callId,
      hasCallerId: Boolean(result.callerIdNumber),
      aiCaptureEnabled: Boolean(result.aiCaptureEnabled),
      realtimeMediaStreamEnabled: Boolean(realtimeMediaStreamUrl),
    });

    const mediaStreamParams = realtimeMediaStreamUrl
      ? {
          voxandraCallId: String(result.callId),
          workspaceId: String(result.workspaceId),
          liveCopilot: result.realtimeCopilotRequested ? "true" : "false",
          translatedCaptions: result.translatedCaptionsRequested ? "true" : "false",
          ...(result.translatedCaptionsRequested
            ? {
                translationDirection: "caller_to_user",
                spokenTranslationEnabled: result.spokenTranslationRequested ? "true" : "false",
                ...(result.translatedCaptionsSourceLanguage
                  ? { translationSourceLanguage: result.translatedCaptionsSourceLanguage }
                  : {}),
                ...(result.translatedCaptionsTargetLanguage
                  ? { translationTargetLanguage: result.translatedCaptionsTargetLanguage }
                  : {}),
              }
            : {}),
          ...(result.realtimeSessionIds.humanCopilot
            ? {
                humanCopilotRealtimeSessionId: String(
                  result.realtimeSessionIds.humanCopilot
                ),
              }
            : {}),
          ...(result.realtimeSessionIds.translatedCaptions
            ? {
                translatedCaptionsRealtimeSessionId: String(
                  result.realtimeSessionIds.translatedCaptions
                ),
              }
            : {}),
        }
      : undefined;

    // Real two-leg translation bridge (internal-only, single-workspace test,
    // sub-phases 5a/5b — see AGENTIC_FUTURE.md). Drops <Dial> entirely and
    // places the callee as a genuinely separate call via the Twilio REST
    // API, so the worker controls that leg's audio directly instead of
    // Twilio bridging real audio between the two legs. In 5b the callee leg
    // owns the existing tracked caller->user translation session, while the
    // browser leg starts a second, bridge-only Palabra session with the
    // language pair reversed.
    if (result.bridgeModeRequested && realtimeMediaStreamUrl) {
      const sourceLanguage = result.translatedCaptionsSourceLanguage;
      const targetLanguage = result.translatedCaptionsTargetLanguage;
      const translatedCaptionsRealtimeSessionId =
        result.realtimeSessionIds.translatedCaptions;
      if (!sourceLanguage || !targetLanguage || !translatedCaptionsRealtimeSessionId) {
        return twimlError("Voxandra could not configure both translation directions.", 400);
      }

      const legTwimlUrl = new URL(
        (process.env.TWILIO_BRIDGE_LEG_WEBHOOK_URL || `${appUrl}/api/twilio/internal/bridge/leg-twiml`).trim()
      );
      legTwimlUrl.searchParams.set("voxandraCallId", String(result.callId));
      legTwimlUrl.searchParams.set("workspaceId", String(result.workspaceId));
      legTwimlUrl.searchParams.set(
        "translatedCaptionsRealtimeSessionId",
        String(translatedCaptionsRealtimeSessionId)
      );
      legTwimlUrl.searchParams.set("translationSourceLanguage", sourceLanguage);
      legTwimlUrl.searchParams.set("translationTargetLanguage", targetLanguage);
      // This leg captures the called person's microphone. Its Palabra output
      // is injected into the browser leg, using the called person's voice.
      legTwimlUrl.searchParams.set("translationVoice", result.calledPersonTranslatedVoice);
      legTwimlUrl.searchParams.set("bridgeTranslationEnabled", "true");
      // Signed, server-computed, and clamped again inside the worker: the
      // worker closes its own Twilio socket at this deadline, which ends a
      // <Connect><Stream> leg without needing the Twilio REST API at all.
      legTwimlUrl.searchParams.set("maxSessionSeconds", String(result.maxCallSeconds));

      let bridgeCalleeCallSid: string | undefined;
      try {
        const calleeStatusUrl = new URL(statusUrl);
        calleeStatusUrl.searchParams.set("bridgeLeg", "callee");
        const bridgeCall = await getTwilioClient().calls.create({
          to: result.destinationE164,
          from: result.callerIdNumber || getRequiredEnv("TWILIO_CALLER_ID"),
          url: legTwimlUrl.toString(),
          statusCallback: calleeStatusUrl.toString(),
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          statusCallbackMethod: "POST",
          timeLimit: result.maxCallSeconds,
        });
        bridgeCalleeCallSid = bridgeCall.sid;
        const recorded = await convex.mutation(
          api.twilioProvider.recordBridgeCalleeCallSid,
          {
            secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
            callId: result.callId,
            bridgeCalleeCallSid,
            maxCallSeconds: result.maxCallSeconds,
          }
        );
        if (recorded.terminateImmediately) {
          await terminateTwilioCall(bridgeCalleeCallSid);
          throw new Error("Browser leg ended before the translated call connected");
        }
        // The browser leg is not yet recordable while Twilio awaits this
        // TwiML. Both inbound-only transient recordings start from signed
        // stream-started callbacks after their bridge streams connect.
      } catch (error) {
        if (bridgeCalleeCallSid) {
          await terminateTwilioCall(bridgeCalleeCallSid).catch((terminationError) => {
            console.error("Bridge leg cleanup failed", {
              message:
                terminationError instanceof Error
                  ? terminationError.message
                  : "Unknown error",
            });
          });
        }
        await convex
          .mutation(api.twilioProvider.failBridgeCallSetup, {
            secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
            callId: result.callId,
          })
          .catch((cleanupError) => {
            console.error("Bridge call setup cleanup failed", {
              message:
                cleanupError instanceof Error ? cleanupError.message : "Unknown error",
            });
          });
        console.error("Bridge leg placement failed", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        return twimlError("Voxandra could not place the translated call.", 400);
      }

      const parentStreamStatusUrl = new URL(statusUrl);
      parentStreamStatusUrl.searchParams.set("bridgeLeg", "parent");
      const bridgeTwiml = createBridgeParentTwiML({
        statusCallbackUrl: parentStreamStatusUrl.toString(),
        mediaStreamUrl: realtimeMediaStreamUrl,
        mediaStreamParams: {
          voxandraCallId: String(result.callId),
          workspaceId: String(result.workspaceId),
          liveCopilot: result.realtimeCopilotRequested ? "true" : "false",
          translatedCaptions: "false",
          spokenTranslationEnabled: "true",
          bridgeTranslationEnabled: "true",
          translationDirection: "user_to_callee",
          translationSourceLanguage: targetLanguage,
          translationTargetLanguage: sourceLanguage,
          // This leg captures the Voxandra caller's microphone. Its Palabra
          // output is injected into the callee leg, using the caller's voice.
          translationVoice: result.callerTranslatedVoice,
          ...(result.realtimeSessionIds.humanCopilot
            ? {
                humanCopilotRealtimeSessionId: String(
                  result.realtimeSessionIds.humanCopilot
                ),
              }
            : {}),
          // This leg has no <Dial>, so Twilio has no `timeLimit` for it. The
          // worker self-closes at this deadline, which ends a
          // <Connect><Stream> leg on Twilio's side.
          maxSessionSeconds: String(result.maxCallSeconds),
          bridgeLeg: "browser",
        },
      });

      return new NextResponse(bridgeTwiml, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    const twiml = createVoiceTwiML({
      destinationE164: result.destinationE164,
      callerId: result.callerIdNumber,
      statusCallbackUrl: statusUrl.toString(),
      maxCallSeconds: result.maxCallSeconds,
      recordingStatusCallbackUrl,
      aiCaptureEnabled: Boolean(result.aiCaptureEnabled),
      mediaStreamUrl: realtimeMediaStreamUrl,
      // Live Guidance needs the complete conversation. Twilio keeps the two
      // directions separate on this parent leg: inbound is the Voxandra user
      // and outbound is the called person. The worker still routes only the
      // outbound track into Live Translation.
      mediaStreamTrack: result.realtimeCopilotRequested ? "both_tracks" : "outbound_track",
      mediaStreamParams,
    });

    return new NextResponse(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("Twilio voice webhook failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return twimlError("Voxandra could not start this call.", 400);
  }
}
