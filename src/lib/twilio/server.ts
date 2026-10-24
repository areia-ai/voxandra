import { ConvexHttpClient } from "convex/browser";
import twilio from "twilio";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { signMediaStreamParams } from "@/lib/realtime/stream-signature";

export const TWILIO_TOKEN_TTL_SECONDS = 15 * 60;

let twilioClient: twilio.Twilio | null = null;

export function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function getConvexHttpClient(authToken?: string) {
  const convexUrl = getRequiredEnv("NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(convexUrl);
  if (authToken) {
    client.setAuth(authToken);
  }
  return client;
}

export function getTwilioClient() {
  if (!twilioClient) {
    twilioClient = twilio(
      getRequiredEnv("TWILIO_ACCOUNT_SID"),
      getRequiredEnv("TWILIO_AUTH_TOKEN")
    );
  }
  return twilioClient;
}

export async function startBridgeLegRecording(args: {
  callId: Id<"calls">;
  leg: "parent" | "callee";
  providerCallSid: string;
  appUrl: string;
}) {
  const convex = getConvexHttpClient();
  const callbackUrl = new URL(`${args.appUrl.trim().replace(/\/$/, "")}/api/twilio/recording`);
  callbackUrl.searchParams.set("voxandraCallId", String(args.callId));
  callbackUrl.searchParams.set("bridgeLeg", args.leg);
  return await convex.mutation(api.bridgeRecordings.claimBridgeRecording, {
    secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
    callId: args.callId,
    leg: args.leg,
    providerCallSid: args.providerCallSid,
    startedAt: Date.now(),
    callbackUrl: callbackUrl.toString(),
  });
}

export function createTwilioAccessToken(identity: string) {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(
    getRequiredEnv("TWILIO_ACCOUNT_SID"),
    getRequiredEnv("TWILIO_API_KEY"),
    getRequiredEnv("TWILIO_API_SECRET"),
    {
      identity,
      ttl: TWILIO_TOKEN_TTL_SECONDS,
    }
  );

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: getRequiredEnv("TWILIO_TWIML_APP_SID"),
      incomingAllow: false,
    })
  );

  return token.toJwt();
}

export function getTwilioDeviceIdentity(userId: string) {
  return `vox_${userId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 110)}`;
}

export function twilioDebugLogsEnabled() {
  return process.env.TWILIO_DEBUG_LOGS === "true";
}

export function logTwilioDebug(
  message: string,
  details: Record<string, string | number | boolean | null | undefined> = {}
) {
  if (!twilioDebugLogsEnabled()) return;
  console.log(message, details);
}

export function getCanonicalUrl(request: Request, envOverride: string | undefined) {
  const requestUrl = new URL(request.url);
  if (envOverride) {
    const override = new URL(envOverride);
    if (!override.search && requestUrl.search) {
      override.search = requestUrl.search;
    }
    return override.toString();
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return `${appUrl.replace(/\/$/, "")}${requestUrl.pathname}${requestUrl.search}`;
  }
  return request.url;
}

export async function validateTwilioRequest(
  request: Request,
  params: Record<string, string>,
  envOverride?: string
) {
  const authToken = getRequiredEnv("TWILIO_AUTH_TOKEN");
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = getCanonicalUrl(request, envOverride);
  return twilio.validateRequest(authToken, signature, url, params);
}

export function createVoiceTwiML(args: {
  destinationE164: string;
  callerId?: string;
  statusCallbackUrl: string;
  maxCallSeconds: number;
  recordingStatusCallbackUrl?: string;
  aiCaptureEnabled: boolean;
  mediaStreamUrl?: string;
  mediaStreamTrack?: "inbound_track" | "outbound_track" | "both_tracks";
  mediaStreamParams?: Record<string, string>;
}) {
  if (args.aiCaptureEnabled && !args.recordingStatusCallbackUrl) {
    throw new Error("Recording callback URL is required when AI capture is enabled.");
  }

  const response = new twilio.twiml.VoiceResponse();
  if (args.mediaStreamUrl) {
    const start = response.start();
    const stream = start.stream({
      url: args.mediaStreamUrl,
      // Leg-relative Twilio semantics: on the parent (caller) leg,
      // outbound_track is what the caller hears — the other party.
      track: args.mediaStreamTrack ?? "outbound_track",
    });
    appendSignedStreamParameters(stream, args.mediaStreamParams ?? {});
  }

  const dial = response.dial({
    callerId: args.callerId || getRequiredEnv("TWILIO_CALLER_ID"),
    timeLimit: args.maxCallSeconds,
    ...(args.aiCaptureEnabled
      ? {
          record: "record-from-answer-dual" as const,
          recordingStatusCallback: args.recordingStatusCallbackUrl,
          recordingStatusCallbackEvent: ["completed"] as const,
          recordingStatusCallbackMethod: "POST" as const,
        }
      : {}),
  });

  dial.number(
    {
      statusCallback: args.statusCallbackUrl,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    },
    args.destinationE164
  );

  return response.toString();
}

// Real two-leg translation bridge (internal-only, single-workspace test,
// sub-phase 5b — see AGENTIC_FUTURE.md). Deliberately separate from
// createVoiceTwiML, which every real customer call still uses unmodified:
// bridge mode drops <Dial> entirely (there is nothing for the worker to
// inject translated audio into on a Twilio-bridged leg — <Start><Stream> is
// receive-only) in favor of <Connect><Stream> on both the browser leg (this
// function) and a second, worker-controllable leg placed separately via the
// Twilio REST API (see the voice route for the calls.create() call).
export function createBridgeParentTwiML(args: {
  mediaStreamUrl: string;
  mediaStreamParams: Record<string, string>;
  statusCallbackUrl: string;
}) {
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({
    url: args.mediaStreamUrl,
    statusCallback: args.statusCallbackUrl,
    statusCallbackMethod: "POST",
  });
  appendSignedStreamParameters(stream, args.mediaStreamParams);
  return response.toString();
}

// TwiML for the second, worker-placed leg (the real callee). No <Dial>, no
// recording, no billing side effects here — this leg's only audio interface
// is the worker's WebSocket.
export function createBridgeCalleeTwiML(args: {
  mediaStreamUrl: string;
  mediaStreamParams: Record<string, string>;
  statusCallbackUrl: string;
}) {
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({
    url: args.mediaStreamUrl,
    statusCallback: args.statusCallbackUrl,
    statusCallbackMethod: "POST",
  });
  appendSignedStreamParameters(stream, args.mediaStreamParams);
  return response.toString();
}

// Every <Stream> the app emits goes through here, so no TwiML path can hand
// the worker an unsigned parameter set. The worker rejects unsigned or stale
// `start` events (see src/lib/realtime/stream-signature.ts for why Twilio's
// own webhook signatures do not cover Media Stream connections).
export function appendSignedStreamParameters(
  stream: { parameter: (attrs: { name: string; value: string }) => unknown },
  params: Record<string, string>
) {
  const signed = signMediaStreamParams(params, getRequiredEnv("REALTIME_STREAM_SIGNING_SECRET"));
  for (const [name, value] of Object.entries(signed)) {
    stream.parameter({ name, value });
  }
}

export async function getAuthenticatedProfile(authToken: string) {
  const convex = getConvexHttpClient(authToken);
  return await convex.query(api.profiles.getMyProfile, {});
}

export function formDataToParams(formData: FormData) {
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      params[key] = value;
    }
  }
  return params;
}
