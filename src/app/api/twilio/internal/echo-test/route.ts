import { NextResponse } from "next/server";
import twilio from "twilio";
import {
  appendSignedStreamParameters,
  formDataToParams,
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

// Bridge media-path skeleton (internal-only, see AGENTIC_FUTURE.md): proves
// the worker can send audio back into a real Twilio call at all, before any
// real bridge topology exists. Deliberately isolated from createVoiceTwiML
// and the real call-creation flow — no <Dial>, no billing, no recording, no
// Convex call/session row, so nothing here can touch a real customer call.
// 404s unless explicitly enabled on a dev/canary deployment.
export async function POST(request: Request) {
  if (process.env.TWILIO_ECHO_TEST_ENABLED !== "true") {
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
    process.env.TWILIO_ECHO_TEST_WEBHOOK_URL
  );
  if (!valid) {
    return twimlError("Invalid Twilio signature.", 403);
  }

  const mediaStreamUrl = process.env.REALTIME_MEDIA_STREAM_URL?.trim();
  const workspaceId = process.env.TWILIO_ECHO_TEST_WORKSPACE_ID?.trim();
  if (!mediaStreamUrl || !workspaceId) {
    return twimlError("Echo test is not fully configured.", 500);
  }

  const response = new twilio.twiml.VoiceResponse();
  // <Connect><Stream> (bidirectional) rather than createVoiceTwiML's
  // <Start><Stream> (receive-only) — this is the one place in the codebase
  // that actually needs the worker to send media back.
  const connect = response.connect();
  const stream = connect.stream({ url: mediaStreamUrl });
  appendSignedStreamParameters(stream, {
    voxandraCallId: "internal_echo_test",
    workspaceId,
    liveCopilot: "false",
    translatedCaptions: "false",
    echoTestEnabled: "true",
  });

  return new NextResponse(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
