import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  TWILIO_TOKEN_TTL_SECONDS,
  createTwilioAccessToken,
  getConvexHttpClient,
  getAuthenticatedProfile,
  getRequiredEnv,
  getTwilioDeviceIdentity,
} from "@/lib/twilio/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  const authToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  try {
    let body: { callId?: string; sessionToken?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    let identity: string | null = null;

    if (body.callId && body.sessionToken) {
      const convex = getConvexHttpClient();
      const session = await convex.mutation(api.twilioProvider.validateSessionForAccessToken, {
        secret: getRequiredEnv("TWILIO_CONVEX_WEBHOOK_SECRET"),
        callId: body.callId as Id<"calls">,
        sessionToken: body.sessionToken,
      });
      identity = session.identity;
    }

    if (!identity && authToken) {
      const profile = await getAuthenticatedProfile(authToken);
      if (profile) {
        identity = getTwilioDeviceIdentity(String(profile.userId));
      }
    }

    if (!identity) {
      return NextResponse.json({ error: "Could not verify the Voxandra call session." }, { status: 403 });
    }

    const token = createTwilioAccessToken(identity);

    return NextResponse.json({
      token,
      identity,
      expiresIn: TWILIO_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Twilio token.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
