import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  STALE_RESERVATION_GRACE_SECONDS,
  isReservationAbandoned,
  isTerminalTwilioCallStatus,
  isTerminalVoxandraCallStatus,
  resolveTwilioTerminationStatus,
} from "../src/lib/twilio/bridge-lifecycle";
import { releaseCallReservation, settleCallReservation } from "./billingHelpers";
import { settleOutstandingRealtimeCharges } from "./realtimeBilling";

// Provider-leg lifecycle enforcement for Twilio calls.
//
// Everything here exists because of the 2026-07-30 translated-bridge incident:
// a browser leg ended after 52 seconds while its separately created callee leg
// stayed connected for 49 minutes. The original fix terminated the surviving
// leg with a single, un-retried REST call made from inside the status-webhook
// request, and swallowed every failure. Three things were therefore still
// possible: the termination request could fail (or race Twilio's own state
// change) and never be retried; the instruction to terminate travelled in an
// HTTP response body that could be lost; and a browser leg answered with
// <Connect><Stream> has no provider-side maximum of any kind.
//
// The fix for all three is to make termination a *scheduled Convex job*
// committed in the same transaction that observed the hangup, with retries and
// an independent deadline per leg. Convex already holds TWILIO_ACCOUNT_SID and
// TWILIO_AUTH_TOKEN, so this path keeps working even if the Next.js deployment
// is degraded.

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const TERMINATION_MAX_ATTEMPTS = 5;
// Backoff for transient (5xx / network / 429) failures only. 4xx state
// mismatches are retried inline instead, because they mean "wrong verb", not
// "try again later".
const TERMINATION_BACKOFF_MS = [5_000, 15_000, 45_000, 120_000];
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Hand-rolled so this file makes no assumption about btoa/Buffer being present
// in whichever Convex runtime executes it.
function toBase64(input: string) {
  const bytes = new TextEncoder().encode(input);
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    output += BASE64_ALPHABET[b0 >> 2];
    output += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    output += b1 === undefined ? "=" : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    output += b2 === undefined ? "=" : BASE64_ALPHABET[b2 & 0x3f];
  }
  return output;
}

function twilioCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    throw new Error("Twilio REST credentials are not configured for Convex.");
  }
  return { accountSid, authHeader: `Basic ${toBase64(`${accountSid}:${authToken}`)}` };
}

type TwilioCallResult =
  | { outcome: "ok"; status?: string }
  | { outcome: "gone" }
  | { outcome: "rejected"; httpStatus: number; code?: number }
  | { outcome: "transient"; detail: string };

async function twilioCallRequest(
  callSid: string,
  update?: "canceled" | "completed",
  signal?: AbortSignal
): Promise<TwilioCallResult> {
  const { accountSid, authHeader } = twilioCredentials();
  const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Calls/${encodeURIComponent(callSid)}.json`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: update ? "POST" : "GET",
      signal,
      headers: {
        Authorization: authHeader,
        ...(update ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(update ? { body: new URLSearchParams({ Status: update }).toString() } : {}),
    });
  } catch (error) {
    return {
      outcome: "transient",
      detail: error instanceof Error ? error.message : "fetch failed",
    };
  }

  // A SID Twilio no longer knows about cannot be consuming money.
  if (response.status === 404) return { outcome: "gone" };
  if (response.status === 429 || response.status >= 500) {
    return { outcome: "transient", detail: `http_${response.status}` };
  }
  if (!response.ok) {
    let code: number | undefined;
    try {
      const body = (await response.json()) as { code?: number };
      code = typeof body?.code === "number" ? body.code : undefined;
    } catch {
      // Twilio always returns JSON errors, but never let parsing decide control flow.
    }
    return { outcome: "rejected", httpStatus: response.status, code };
  }

  try {
    const body = (await response.json()) as { status?: string };
    return { outcome: "ok", status: typeof body?.status === "string" ? body.status : undefined };
  } catch {
    return { outcome: "ok" };
  }
}

/**
 * Ends one Twilio call leg, durably.
 *
 * Reads the leg's current state, POSTs the verb Twilio accepts for that state,
 * and — if Twilio rejects it because the state changed in between (a `ringing`
 * leg answered mid-flight) — immediately retries with the other verb, then
 * re-reads and tries once more. Transient failures reschedule with backoff.
 * Safe to invoke repeatedly and concurrently: an already-terminal leg is a
 * no-op.
 */
export const terminateProviderCall = internalAction({
  args: {
    callSid: v.string(),
    reason: v.string(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 1;

    const reschedule = (detail: string) => {
      const delay = TERMINATION_BACKOFF_MS[attempt - 1];
      if (attempt >= TERMINATION_MAX_ATTEMPTS || delay === undefined) {
        console.error("[Twilio Lifecycle] Gave up terminating provider leg", {
          reason: args.reason,
          attempt,
          detail,
        });
        return { terminated: false, gaveUp: true as const, detail };
      }
      console.warn("[Twilio Lifecycle] Retrying provider leg termination", {
        reason: args.reason,
        attempt,
        detail,
      });
      void ctx.scheduler.runAfter(delay, internal.twilioLifecycle.terminateProviderCall, {
        callSid: args.callSid,
        reason: args.reason,
        attempt: attempt + 1,
      });
      return { terminated: false, retrying: true as const, detail };
    };

    for (let pass = 1; pass <= 2; pass += 1) {
      const fetched = await twilioCallRequest(args.callSid);
      if (fetched.outcome === "gone") return { terminated: false, alreadyTerminal: true };
      if (fetched.outcome === "transient") return reschedule(`fetch:${fetched.detail}`);
      if (fetched.outcome === "rejected") {
        return reschedule(`fetch_rejected:${fetched.httpStatus}:${fetched.code ?? "?"}`);
      }

      const plan = resolveTwilioTerminationStatus(fetched.status);
      if (!plan) return { terminated: false, alreadyTerminal: true };

      for (const status of [plan.primary, plan.fallback]) {
        const updated = await twilioCallRequest(args.callSid, status);
        if (updated.outcome === "ok") {
          console.warn("[Twilio Lifecycle] Terminated provider leg", {
            reason: args.reason,
            appliedStatus: status,
            observedStatus: fetched.status,
          });
          return { terminated: true, appliedStatus: status };
        }
        if (updated.outcome === "gone") return { terminated: false, alreadyTerminal: true };
        if (updated.outcome === "transient") return reschedule(`update:${updated.detail}`);
        // "rejected": wrong verb for the leg's real state. Fall through to the
        // other verb, and if that is rejected too, re-read on the next pass.
      }
    }

    return reschedule("both_verbs_rejected");
  },
});

export const startBridgeRecording = internalAction({
  args: {
    recordingId: v.id("bridgeCallRecordings"),
    callbackUrl: v.string(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const attempt = args.attempt ?? 1;
    const context = await ctx.runQuery(internal.bridgeRecordings.getBridgeRecordingStartContext, {
      recordingId: args.recordingId,
    });
    if (!context) return;

    const fail = async (detail: string) => {
      console.error("[Bridge Recording] Capture unavailable", { attempt, detail });
      await ctx.runMutation(internal.bridgeRecordings.failBridgeRecordingStart, {
        recordingId: args.recordingId,
      });
    };
    const retry = async (detail: string) => {
      const delay = [1_000, 2_000, 4_000, 8_000][attempt - 1];
      if (delay === undefined) return await fail(detail);
      await ctx.scheduler.runAfter(delay, internal.twilioLifecycle.startBridgeRecording, {
        ...args,
        attempt: attempt + 1,
      });
    };
    if (!context.canStart) return await fail("call_ended_or_unavailable");

    try {
      const state = await twilioCallRequest(context.providerCallSid, undefined, AbortSignal.timeout(10_000));
      if (state.outcome === "gone" || (state.outcome === "ok" && isTerminalTwilioCallStatus(state.status))) {
        return await fail("provider_call_ended");
      }
      if (state.outcome !== "ok" || state.status !== "in-progress") {
        return await retry("provider_call_not_ready");
      }

      const { accountSid, authHeader } = twilioCredentials();
      const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Calls/${encodeURIComponent(context.providerCallSid)}/Recordings.json`;
      const headers = { Authorization: authHeader };
      const existingResponse = await fetch(`${url}?PageSize=20`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!existingResponse.ok) return await retry(`recordings_list_http_${existingResponse.status}`);
      const existing = await existingResponse.json() as {
        recordings: Array<{ sid: string; channels: number; start_time?: string; date_created?: string }>;
      };
      const previous = existing.recordings.find((recording) => recording.channels === 1);
      const startedAt = Date.now();
      let recordingSid = previous?.sid;
      if (!recordingSid) {
        const response = await fetch(url, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(10_000),
          body: new URLSearchParams([
            ["RecordingChannels", "mono"],
            ["RecordingTrack", "inbound"],
            ["RecordingStatusCallback", args.callbackUrl],
            ["RecordingStatusCallbackEvent", "completed"],
            ["RecordingStatusCallbackEvent", "absent"],
            ["RecordingStatusCallbackMethod", "POST"],
            ["Trim", "do-not-trim"],
          ]).toString(),
        });
        const body = await response.json() as { sid?: string; message?: string; code?: number };
        if (!response.ok) {
          const detail = `recording_http_${response.status}_code_${body.code ?? "unknown"}`;
          if (response.status === 429 || response.status >= 500 ||
            (response.status === 400 && body.message?.includes("not eligible for recording"))) {
            return await retry(detail);
          }
          return await fail(detail);
        }
        recordingSid = body.sid;
        if (!recordingSid) return await retry("recording_sid_missing");
      }
      const previousStartedAt = Date.parse(previous?.start_time ?? previous?.date_created ?? "");
      await ctx.runMutation(internal.bridgeRecordings.markBridgeRecordingStarted, {
        recordingId: args.recordingId,
        recordingSid,
        startedAt: Number.isFinite(previousStartedAt) ? previousStartedAt : startedAt,
      });
    } catch {
      await retry("provider_request_failed");
    }
  },
});

export const getCallTerminationState = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return null;
    return {
      status: call.status,
      endedAt: call.endedAt,
      bridgeModeRequested: call.bridgeModeRequested === true,
      parentCallSid: call.parentCallSid,
      bridgeCalleeCallSid: call.bridgeCalleeCallSid,
      bridgeParentStatus: call.bridgeParentStatus,
      bridgeCalleeStatus: call.bridgeCalleeStatus,
    };
  },
});

/**
 * Independent per-call deadline for bridge calls.
 *
 * The callee leg is created with Twilio's `timeLimit`, which is proven to work
 * (the incident's orphan ended at its 2940s limit to the second). The browser
 * leg is answered with `<Connect><Stream>` — no `<Dial>`, so no `timeLimit`
 * attribute exists for it, and its only bound would otherwise be Twilio's
 * four-hour global ceiling. This job is that leg's missing cap, and a second
 * line of defence for the callee.
 *
 * Deliberately does not settle billing: at this point the legs have only just
 * been killed and their terminal callbacks are seconds away. Stranded
 * reservations are the sweeper's job.
 */
export const enforceBridgeCallDeadline = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(internal.twilioLifecycle.getCallTerminationState, {
      callId: args.callId,
    });
    if (!state || !state.bridgeModeRequested) return { terminated: [] as string[] };

    const targets: { callSid: string; leg: string }[] = [];
    if (state.parentCallSid && !isTerminalTwilioCallStatus(state.bridgeParentStatus)) {
      targets.push({ callSid: state.parentCallSid, leg: "parent" });
    }
    if (state.bridgeCalleeCallSid && !isTerminalTwilioCallStatus(state.bridgeCalleeStatus)) {
      targets.push({ callSid: state.bridgeCalleeCallSid, leg: "callee" });
    }
    if (targets.length === 0) return { terminated: [] as string[] };

    console.warn("[Twilio Lifecycle] Bridge deadline reached with live legs", {
      callId: args.callId,
      legs: targets.map((target) => target.leg),
    });
    for (const target of targets) {
      await ctx.runAction(internal.twilioLifecycle.terminateProviderCall, {
        callSid: target.callSid,
        reason: `bridge_deadline_${target.leg}`,
      });
    }
    return { terminated: targets.map((target) => target.leg) };
  },
});

/**
 * Releases or settles credit reservations whose terminal status callback never
 * arrived.
 *
 * This is the direct fix for the $37.80 that sat reserved during the incident.
 * Before this, once a session moved from `pending` to `used` the *only* path
 * that could free its reservation was a terminal provider callback — and the
 * status route answers 200 on failure so Twilio never retries. A single lost
 * callback stranded the credits permanently, because reservation expiry ran
 * only opportunistically, and only when another *free* call was started.
 *
 * Every call path caps its provider leg at `reservedSeconds`, so a reservation
 * older than that plus a grace window cannot belong to a live call.
 */
export const sweepAbandonedCallReservations = internalMutation({
  args: {
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    const coarseCutoff = now - STALE_RESERVATION_GRACE_SECONDS * 1000;

    const candidates = await ctx.db
      .query("creditReservations")
      .withIndex("by_status_created", (q) =>
        q.eq("status", "reserved").lt("createdAt", coarseCutoff)
      )
      .take(limit);

    let settled = 0;
    let released = 0;
    const swept: string[] = [];

    for (const reservation of candidates) {
      if (
        !isReservationAbandoned({
          createdAt: reservation.createdAt,
          reservedSeconds: reservation.reservedSeconds,
          now,
        })
      ) {
        continue;
      }

      const call = await ctx.db.get(reservation.callId);
      const durationSeconds = call?.durationSeconds ?? 0;

      // Cheap insurance: if we still hold provider SIDs for this call, make
      // sure neither leg is somehow alive before we close the books.
      if (call) {
        for (const callSid of [call.parentCallSid, call.bridgeCalleeCallSid]) {
          if (!callSid) continue;
          await ctx.scheduler.runAfter(0, internal.twilioLifecycle.terminateProviderCall, {
            callSid,
            reason: "abandoned_reservation_sweep",
          });
        }
      }

      if (durationSeconds > 0) {
        const result = await settleCallReservation(ctx, {
          callId: reservation.callId,
          durationSeconds,
          now,
        });
        if (result.settled) {
          settled += 1;
          if (call) {
            await ctx.db.patch(call._id, { settledCreditCents: result.settledCents });
          }
        }
      } else {
        const result = await releaseCallReservation(ctx, {
          callId: reservation.callId,
          now,
          description: "Released credits for call with no terminal provider callback",
        });
        if (result.released) released += 1;
      }

      if (call) {
        await ctx.db.patch(call._id, {
          ...(isTerminalVoxandraCallStatus(call.status)
            ? {}
            : { status: durationSeconds > 0 ? "completed" : "failed" }),
          ...(durationSeconds > 0 ? {} : { processingStatus: "failed" }),
          ...(call.endedAt ? {} : { endedAt: new Date(now).toISOString() }),
        });
        if (call.realtimeCopilotRequested || call.translatedCaptionsRequested) {
          await settleOutstandingRealtimeCharges(ctx, {
            workspaceId: call.workspaceId,
            callId: call._id,
            now,
          });
        }
      }

      swept.push(reservation._id);
    }

    if (swept.length > 0) {
      console.error("[Twilio Lifecycle] Swept abandoned call reservations", {
        count: swept.length,
        settled,
        released,
      });
    }
    return { examined: candidates.length, swept: swept.length, settled, released };
  },
});
