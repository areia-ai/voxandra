import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";
import { getMaxCallSeconds } from "./twilioShared";

// Spoken Translation Phase 1 (internal-only infra, see AGENTIC_FUTURE.md):
// lets an allowlisted workspace's browser tab open a second WebSocket
// straight to the realtime worker and receive translated speech audio that
// the worker already receives from OpenAI but has historically discarded.
// No customer-facing UI reads this yet.

function assertBrowserAudioStreamSecret(secret: string) {
  const expectedSecret = process.env.REALTIME_CONVEX_WORKER_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    throw new Error("Realtime worker access denied");
  }
}

function splitEnvList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Mirrors shouldForwardTranslationAudio() in
// scripts/realtime-media-worker-core.mjs. Convex and the worker are separate
// processes with separate env, so this same var name must be set on both
// deployments independently before the end-to-end path activates for a
// workspace. Empty by default: the feature is off for every workspace.
export function isWorkspaceOnAudioForwardAllowlist(workspaceId: string) {
  return splitEnvList(
    process.env.REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS
  ).includes(workspaceId);
}

// Live Audio Translation (internal-only, single-workspace test — see
// AGENTIC_FUTURE.md): lets the dialer decide whether to render the toggle at
// all. Reuses the same allowlist as the browser-audio token mint above (one
// workspace list to keep in sync, not two) — a workspace can play translated
// audio if and only if it can also get a token for it.
export const getSpokenTranslationAvailability = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    return { available: isWorkspaceOnAudioForwardAllowlist(workspaceId) };
  },
});

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createStreamToken() {
  if (typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

// Called from createOutboundSession once the call row and the
// translated_captions realtimeSessions row already exist. Returns undefined
// (mints nothing) for any workspace not on the allowlist, so the browser
// channel stays entirely absent for production traffic by default.
//
// Deliberately not single-use, unlike twilioCallSessions.connectTokenHash: a
// flaky browser tab must be able to reconnect and re-present the same token
// for the life of the call, so validation below only checks status/expiry
// and never flips status on a successful check. expiresAt is bounded to the
// call's own max duration rather than the short one-shot Twilio connect TTL.
export async function mintBrowserAudioStreamTokenForCall(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    callId: Id<"calls">;
    realtimeSessionId: Id<"realtimeSessions">;
    now: number;
  }
): Promise<string | undefined> {
  if (!isWorkspaceOnAudioForwardAllowlist(args.workspaceId)) return undefined;

  const token = createStreamToken();
  const tokenHash = await sha256(token);
  await ctx.db.insert("browserAudioStreamTokens", {
    workspaceId: args.workspaceId,
    callId: args.callId,
    realtimeSessionId: args.realtimeSessionId,
    tokenHash,
    expiresAt: args.now + getMaxCallSeconds() * 1000,
    status: "issued",
    createdAt: args.now,
  });
  return token;
}

// Called by the worker on every /browser/audio-stream upgrade, including
// reconnects mid-call.
export const validateBrowserAudioStreamToken = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    assertBrowserAudioStreamSecret(args.secret);

    const tokenHash = await sha256(args.token);
    const row = await ctx.db
      .query("browserAudioStreamTokens")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (
      !row ||
      row.callId !== args.callId ||
      row.status !== "issued" ||
      row.expiresAt <= Date.now()
    ) {
      throw new Error("Invalid or expired browser audio stream token");
    }

    return {
      workspaceId: row.workspaceId,
      realtimeSessionId: row.realtimeSessionId,
    };
  },
});

// Test-only helper for scripts/smoke-browser-audio-stream.mjs: creates a
// minimal, clearly-synthetic call + realtimeSessions row so the smoke script
// can exercise the same mint path createOutboundSession uses, without a
// logged-in browser session. Inserts real rows, so it refuses to run unless
// the deployment explicitly opts in via env, in addition to the shared
// worker secret and the audio-forward allowlist both already required.
export const seedSmokeCallForAudioStream = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertBrowserAudioStreamSecret(args.secret);
    if (process.env.ALLOW_BROWSER_AUDIO_STREAM_SMOKE_SEED !== "true") {
      throw new Error(
        "Set ALLOW_BROWSER_AUDIO_STREAM_SMOKE_SEED=true on this Convex deployment to run the browser audio stream smoke test."
      );
    }
    if (!isWorkspaceOnAudioForwardAllowlist(args.workspaceId)) {
      throw new Error("Workspace is not on the audio-forward allowlist.");
    }

    const startedAt = new Date(args.now).toISOString();
    const callId = await ctx.db.insert("calls", {
      workspaceId: args.workspaceId,
      dialedNumber: "+10000000000",
      startedAt,
      durationSeconds: 0,
      status: "created",
      processingStatus: "calling",
      aiMemoryReady: false,
      reviewPending: false,
      highlights: ["Browser audio stream smoke test"],
      simulated: true,
      callMode: "human_twilio",
    });

    const realtimeSessionId = await ctx.db.insert("realtimeSessions", {
      workspaceId: args.workspaceId,
      callId,
      mode: "translated_captions",
      provider: "twilio_media_stream",
      status: "requested",
      createdAt: args.now,
      updatedAt: args.now,
    });

    const token = await mintBrowserAudioStreamTokenForCall(ctx, {
      workspaceId: args.workspaceId,
      callId,
      realtimeSessionId,
      now: args.now,
    });
    if (!token) {
      throw new Error(
        "Failed to mint a browser audio stream token — check the allowlist env var."
      );
    }

    return { callId, realtimeSessionId, token };
  },
});
