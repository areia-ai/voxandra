import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { computeBridgeInternalCostCents, quoteInboundForwardingCall } from "../src/lib/call-pricing";
import { normalizePhoneE164 } from "../src/lib/phone";
import { CALL_RECORD_LANGUAGE_AUTO } from "../src/lib/call-record-languages";
import { normalizeTranslatedVoiceGender } from "../src/lib/live-translation-voices";
import {
  assertServerSecret,
  getBridgeMaxCallSeconds,
  getFreeCallMaxSeconds,
  getMaxCallSeconds,
  getTwilioDeviceIdentity,
  normalizeTwilioStatus,
} from "./twilioShared";
import {
  bridgeTerminationDelayMs,
  classifyBridgeLeg,
  isTerminalTwilioCallStatus,
  shouldApplyProviderStatusPatch,
} from "../src/lib/twilio/bridge-lifecycle";
import { requireWorkspace } from "./authHelpers";
import {
  releaseCallReservation,
  reserveCallCredits,
  settleCallReservation,
} from "./billingHelpers";
import { settleOutstandingRealtimeCharges } from "./realtimeBilling";
import { trialRequire } from "./trialAccess";
import { translatedTrialEnabled } from "../src/lib/translated-trial";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const payloadSummaryValidator = v.object({
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  callStatus: v.optional(v.string()),
  callDuration: v.optional(v.string()),
  direction: v.optional(v.string()),
  sequenceNumber: v.optional(v.string()),
  timestamp: v.optional(v.string()),
  callbackSource: v.optional(v.string()),
});

const RECORDING_CALLBACK_GRACE_MS = 2 * 60 * 1000;
const TERMINAL_CALL_STATUSES = new Set([
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
]);
const DEFAULT_INBOUND_RING_TIMEOUT_SECONDS = 25;
// Outbound browser-originated call modes — the bridge's browser (parent) leg
// authenticates through the same session/token flow as an ordinary outbound
// call, so both values must pass these gates identically.
const OUTBOUND_BROWSER_CALL_MODES = new Set(["human_twilio", "human_twilio_bridge"]);
const INBOUND_FEATURE_ENABLED_ENV = "TWILIO_INBOUND_CALLING_ENABLED";

function inboundCallingEnabled() {
  return process.env[INBOUND_FEATURE_ENABLED_ENV] === "true";
}

function defaultVoicemailGreeting() {
  return "Please leave a message after the tone. The team will follow up.";
}

function inboundPayloadSummary(args: {
  from?: string;
  to?: string;
  callStatus?: string;
  direction?: string;
}) {
  return {
    from: args.from,
    to: args.to,
    callStatus: args.callStatus,
    callDuration: undefined,
    direction: args.direction,
    sequenceNumber: undefined,
    timestamp: undefined,
    callbackSource: "inbound",
  };
}

async function markFreeCallClaimed(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  callId: Id<"calls">,
  maxCallSeconds: number,
  now: number
) {
  const wallet = await ctx.db
    .query("walletSummaries")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();

  if (!wallet) {
    throw new Error("The free call trial is not available for this workspace.");
  }
  if (wallet.freeCallUsed) {
    throw new Error("Your free call has already been used. Please add credits to continue calling.");
  }
  if (wallet.planId !== "free" || wallet.subscriptionStatus !== "free") {
    throw new Error("The free call trial is only available before adding credits or starting a plan.");
  }

  const call = await ctx.db.get(callId);
  trialRequire(call && call.workspaceId === workspaceId, "trial_invalid_grant");
  if (call.bridgeModeRequested) {
    trialRequire(translatedTrialEnabled() && call.translatedTrialAuthorized === true, "trial_translation_required");
  } else trialRequire(!translatedTrialEnabled(), "trial_translation_required");

  await ctx.db.patch(wallet._id, {
    freeCallUsed: true,
    freeCallUsedAt: now,
    freeCallUsedCallId: callId,
  });

  await ctx.db.patch(callId, {
    freeCallClaimedAt: now,
    freeCallMaxSeconds: maxCallSeconds,
  });
}

async function markRealtimeSessionsStarting(
  ctx: MutationCtx,
  args: {
    callId: Id<"calls">;
    providerCallSid?: string;
    liveCopilotRequested: boolean;
    translatedCaptionsRequested: boolean;
    now: number;
  }
) {
  const sessions = await ctx.db
    .query("realtimeSessions")
    .withIndex("by_call", (q) => q.eq("callId", args.callId))
    .collect();

  const realtimeSessionIds: {
    humanCopilot?: Id<"realtimeSessions">;
    translatedCaptions?: Id<"realtimeSessions">;
  } = {};

  for (const session of sessions) {
    const shouldStart =
      (args.liveCopilotRequested && session.mode === "human_copilot") ||
      (args.translatedCaptionsRequested && session.mode === "translated_captions");
    if (!shouldStart || !["requested", "starting"].includes(session.status)) {
      continue;
    }

    await ctx.db.patch(session._id, {
      status: "starting",
      providerCallSid: args.providerCallSid ?? session.providerCallSid,
      updatedAt: args.now,
    });

    if (session.mode === "human_copilot") {
      realtimeSessionIds.humanCopilot = session._id;
    }
    if (session.mode === "translated_captions") {
      realtimeSessionIds.translatedCaptions = session._id;
    }
  }

  return realtimeSessionIds;
}

export const prepareInboundCall = mutation({
  args: {
    secret: v.string(),
    providerCallSid: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    direction: v.optional(v.string()),
    incomingPhoneNumberSid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);

    const now = Date.now();
    const callerNumber = normalizePhoneE164(args.from ?? "");
    const calledNumber = normalizePhoneE164(args.to ?? "");

    const existing = await ctx.db
      .query("calls")
      .withIndex("by_provider_call_sid", (q) => q.eq("providerCallSid", args.providerCallSid))
      .first();
    if (existing) {
      return {
        action:
          existing.status === "ringing" && existing.inboundForwardingNumber
            ? "forward"
            : "unavailable",
        callId: existing._id,
        forwardingNumber: existing.inboundForwardingNumber,
        ringTimeoutSeconds: DEFAULT_INBOUND_RING_TIMEOUT_SECONDS,
        maxCallSeconds: getMaxCallSeconds(),
        aiCaptureEnabled: existing.aiCaptureEnabled ?? false,
        voicemailEnabled: false,
        voicemailGreeting: defaultVoicemailGreeting(),
        reason: existing.inboundMissedReason,
      };
    }

    let rentedNumber = args.incomingPhoneNumberSid
      ? await ctx.db
          .query("callingNumbers")
          .withIndex("by_twilio_incoming_sid", (q) =>
            q.eq("twilioIncomingPhoneNumberSid", args.incomingPhoneNumberSid)
          )
          .first()
      : null;

    if (!rentedNumber && calledNumber) {
      rentedNumber = await ctx.db
        .query("callingNumbers")
        .withIndex("by_phone_number", (q) => q.eq("phoneNumber", calledNumber))
        .first();
    }

    if (
      !rentedNumber ||
      rentedNumber.source !== "rented" ||
      rentedNumber.status !== "active"
    ) {
      return {
        action: "unavailable" as const,
        reason: "inbound_number_not_found",
      };
    }

    const insertUnavailableCall = async (reason: string) => {
      const callId = await ctx.db.insert("calls", {
        workspaceId: rentedNumber.workspaceId,
        dialedNumber: callerNumber || args.from || "Unknown inbound caller",
        startedAt: new Date(now).toISOString(),
        durationSeconds: 0,
        status: "failed",
        processingStatus: "completed",
        aiMemoryReady: false,
        reviewPending: false,
        highlights: [reason],
        userNotes: "",
        simulated: false,
        callMode: "human_twilio_inbound",
        callRecordLanguagePreference: CALL_RECORD_LANGUAGE_AUTO,
        provider: "twilio",
        providerCallSid: args.providerCallSid,
        parentCallSid: args.providerCallSid,
        callDirection: "inbound",
        inboundCallingNumberId: rentedNumber._id,
        inboundCallerNumber: callerNumber || args.from,
        inboundCalledNumber: calledNumber || rentedNumber.phoneNumber,
        inboundMissedReason: reason,
        aiCaptureEnabled: false,
      });
      await ctx.db.insert("providerEvents", {
        workspaceId: rentedNumber.workspaceId,
        callId,
        provider: "twilio",
        eventType: "inbound_unavailable",
        providerCallSid: args.providerCallSid,
        providerStatus: "failed",
        receivedAt: now,
        payloadSummary: inboundPayloadSummary({
          from: args.from,
          to: args.to,
          callStatus: "failed",
          direction: args.direction,
        }),
      });
      return callId;
    };

    if (!inboundCallingEnabled()) {
      await insertUnavailableCall("Inbound calls are not enabled for this workspace yet.");
      return {
        action: "unavailable" as const,
        reason: "inbound_feature_disabled",
      };
    }

    if (!rentedNumber.inboundEnabled || !rentedNumber.inboundForwardingNumber) {
      await insertUnavailableCall("Inbound calls are not enabled for this number yet.");
      return {
        action: "unavailable" as const,
        reason: "inbound_number_disabled",
      };
    }

    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", rentedNumber.workspaceId))
      .first();
    const aiCaptureEnabled = Boolean(
      rentedNumber.inboundAiCaptureEnabled &&
        rentedNumber.inboundRecordingComplianceAttested &&
        wallet?.aiFeaturesEnabled !== false &&
        wallet?.planId !== "calls_only"
    );
    const forwardingNumber = normalizePhoneE164(rentedNumber.inboundForwardingNumber);
    const quote = quoteInboundForwardingCall({
      forwardingE164: forwardingNumber,
      inboundNumberE164: rentedNumber.phoneNumber,
      originCountry: process.env.TWILIO_PRICING_ORIGIN_COUNTRY,
      aiCaptureEnabled,
    });

    const callId = await ctx.db.insert("calls", {
      workspaceId: rentedNumber.workspaceId,
      dialedNumber: callerNumber || args.from || "Unknown inbound caller",
      startedAt: new Date(now).toISOString(),
      durationSeconds: 0,
      status: "ringing",
      processingStatus: "calling",
      aiMemoryReady: false,
      reviewPending: false,
      highlights: [`Inbound call to ${rentedNumber.label}`],
      userNotes: "",
      simulated: false,
      callMode: "human_twilio_inbound",
      callRecordLanguagePreference: CALL_RECORD_LANGUAGE_AUTO,
      provider: "twilio",
      providerCallSid: args.providerCallSid,
      parentCallSid: args.providerCallSid,
      callDirection: "inbound",
      inboundCallingNumberId: rentedNumber._id,
      inboundCallerNumber: callerNumber || args.from,
      inboundCalledNumber: calledNumber || rentedNumber.phoneNumber,
      inboundForwardingNumber: forwardingNumber,
      destinationCountry: quote.destinationCountry,
      destinationType: quote.routeType,
      retailRateCentsPerMinute: quote.rateCentsPerMinute ?? undefined,
      baselineRetailRateCentsPerMinute: quote.baselineRetailRateCentsPerMinute ?? undefined,
      providerCostCentsPerMinute: quote.providerCostCentsPerMinute ?? undefined,
      aiCaptureCostCentsPerMinute: quote.aiCaptureCostCentsPerMinute,
      totalVariableCostCentsPerMinute: quote.totalVariableCostCentsPerMinute ?? undefined,
      marginMultiple: quote.marginMultiple ?? undefined,
      marginStatus: quote.marginStatus,
      pricingCatalogVersion: quote.pricingCatalogVersion,
      pricingSource: quote.pricingSource ?? undefined,
      billingIncrementSeconds: quote.billingIncrementSeconds,
      minimumBillableSeconds: quote.minimumBillableSeconds,
      aiCaptureEnabled,
      quoteBlockReason: quote.blockReason ?? undefined,
    });

    await ctx.db.insert("providerEvents", {
      workspaceId: rentedNumber.workspaceId,
      callId,
      provider: "twilio",
      eventType: "inbound_started",
      providerCallSid: args.providerCallSid,
      providerStatus: "ringing",
      receivedAt: now,
      payloadSummary: inboundPayloadSummary({
        from: args.from,
        to: args.to,
        callStatus: "ringing",
        direction: args.direction,
      }),
    });

    if (!quote.available || !quote.rateCentsPerMinute) {
      await ctx.db.patch(callId, {
        status: "failed",
        processingStatus: "completed",
        inboundMissedReason: quote.blockReason ?? "Inbound forwarding is unavailable.",
      });
      return {
        action: "unavailable" as const,
        callId,
        reason: quote.blockReason ?? "quote_blocked",
      };
    }

    try {
      const reservation = await reserveCallCredits(ctx, {
        workspaceId: rentedNumber.workspaceId,
        callId,
        rateCentsPerMinute: quote.rateCentsPerMinute,
        maxCallSeconds: getMaxCallSeconds(),
        now,
        providerCostCentsPerMinute: quote.providerCostCentsPerMinute,
        aiCaptureCostCentsPerMinute: quote.aiCaptureCostCentsPerMinute,
        totalVariableCostCentsPerMinute: quote.totalVariableCostCentsPerMinute,
        marginMultiple: quote.marginMultiple,
        billingIncrementSeconds: quote.billingIncrementSeconds,
        minimumBillableSeconds: quote.minimumBillableSeconds,
        pricingCatalogVersion: quote.pricingCatalogVersion,
        description: "Reserved credits for inbound forwarded call",
      });
      await ctx.db.patch(callId, {
        creditReservationId: reservation.reservationId,
        reservedCreditCents: reservation.reservedCents,
        estimatedCostCents: reservation.reservedCents,
      });
      return {
        action: "forward" as const,
        callId,
        forwardingNumber,
        ringTimeoutSeconds:
          rentedNumber.inboundRingTimeoutSeconds ?? DEFAULT_INBOUND_RING_TIMEOUT_SECONDS,
        maxCallSeconds: reservation.reservedSeconds,
        aiCaptureEnabled,
        voicemailEnabled: rentedNumber.inboundVoicemailEnabled ?? true,
        voicemailGreeting: rentedNumber.inboundVoicemailGreeting ?? defaultVoicemailGreeting(),
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Inbound forwarding could not reserve credits.";
      await ctx.db.patch(callId, {
        status: "failed",
        processingStatus: "completed",
        inboundMissedReason: reason,
      });
      return {
        action: "unavailable" as const,
        callId,
        reason,
      };
    }
  },
});

export const recordInboundDialOutcome = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    dialCallSid: v.optional(v.string()),
    dialCallStatus: v.optional(v.string()),
    dialCallDuration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call || call.provider !== "twilio" || call.callDirection !== "inbound") {
      throw new Error("Inbound call not found");
    }

    const now = Date.now();
    const status = args.dialCallStatus ?? "unknown";
    const completed = status === "completed";
    const dialDurationSeconds = args.dialCallDuration ?? 0;
    const startedMs = Date.parse(call.startedAt);
    const elapsedSeconds = Number.isFinite(startedMs)
      ? Math.max(0, Math.ceil((now - startedMs) / 1000))
      : 0;
    const durationSeconds = completed
      ? Math.max(dialDurationSeconds, elapsedSeconds)
      : dialDurationSeconds;

    await ctx.db.insert("providerEvents", {
      workspaceId: call.workspaceId,
      callId: call._id,
      provider: "twilio",
      eventType: "inbound_dial_outcome",
      providerCallSid: args.dialCallSid,
      parentCallSid: call.providerCallSid,
      providerStatus: status,
      durationSeconds,
      receivedAt: now,
      payloadSummary: {
        from: call.inboundCallerNumber,
        to: call.inboundForwardingNumber,
        callStatus: status,
        callDuration: String(durationSeconds),
        direction: "inbound_forward",
        sequenceNumber: undefined,
        timestamp: undefined,
        callbackSource: "inbound_dial_action",
      },
    });

    if (completed) {
      if (call.creditReservationId) {
        const settlement = await settleCallReservation(ctx, {
          callId: call._id,
          durationSeconds,
          now,
        });
        if (settlement.settled) {
          await ctx.db.patch(call._id, {
            settledCreditCents: settlement.settledCents,
          });
        }
      }
      await ctx.db.patch(call._id, {
        status: "completed",
        processingStatus: call.aiCaptureEnabled === false ? "completed" : "transcript_needed",
        durationSeconds,
        endedAt: new Date(now).toISOString(),
      });
      if (call.aiCaptureEnabled !== false) {
        await ctx.scheduler.runAfter(
          RECORDING_CALLBACK_GRACE_MS,
          internal.twilioProvider.markRecordingCallbackMissing,
          { callId: call._id }
        );
      }
      return { action: "hangup" as const };
    }

    if (call.creditReservationId) {
      await releaseCallReservation(ctx, {
        callId: call._id,
        now,
        description: "Released credits for inbound call that was not answered",
      });
    }

    const number = call.inboundCallingNumberId
      ? await ctx.db.get(call.inboundCallingNumberId)
      : null;
    const shouldRecordVoicemail = Boolean(
      number?.inboundVoicemailEnabled && call.aiCaptureEnabled !== false
    );
    await ctx.db.patch(call._id, {
      status,
      processingStatus: shouldRecordVoicemail ? "transcript_needed" : "completed",
      durationSeconds: 0,
      endedAt: shouldRecordVoicemail ? call.endedAt : new Date(now).toISOString(),
      inboundVoicemail: shouldRecordVoicemail,
      inboundMissedReason: status,
    });

    if (shouldRecordVoicemail) {
      await ctx.scheduler.runAfter(
        RECORDING_CALLBACK_GRACE_MS,
        internal.twilioProvider.markRecordingCallbackMissing,
        { callId: call._id }
      );
    }

    return {
      action: shouldRecordVoicemail ? "voicemail" as const : "hangup" as const,
      voicemailGreeting: number?.inboundVoicemailGreeting ?? defaultVoicemailGreeting(),
    };
  },
});

export const validateSessionForAccessToken = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);

    const call = await ctx.db.get(args.callId);
    if (!call || call.provider !== "twilio" || !OUTBOUND_BROWSER_CALL_MODES.has(call.callMode)) {
      throw new Error("Call not found");
    }

    const connectTokenHash = await sha256(args.sessionToken);
    const session = await ctx.db
      .query("twilioCallSessions")
      .withIndex("by_token", (q) => q.eq("connectTokenHash", connectTokenHash))
      .first();

    if (!session || session.callId !== args.callId || session.workspaceId !== call.workspaceId) {
      throw new Error("Invalid Twilio call session");
    }
    const now = Date.now();
    if (session.expiresAt < now) {
      if (session.status === "pending") {
        await ctx.db.patch(session._id, { status: "expired" });
        if (!call.isFreeCall && call.creditReservationId) {
          await releaseCallReservation(ctx, {
            callId: call._id,
            now,
            description: "Released credits for call session that expired before connecting",
          });
          await ctx.db.patch(call._id, {
            status: "expired",
            processingStatus: "failed",
            endedAt: new Date(now).toISOString(),
          });
        }
      }
      throw new Error("Twilio call session expired");
    }
    if (call.endedAt || TERMINAL_CALL_STATUSES.has(call.status)) {
      throw new Error("Twilio call session is no longer active");
    }
    if (session.status !== "pending" && session.status !== "used") {
      throw new Error("Twilio call session is not active");
    }

    return {
      identity: call.twilioDeviceIdentity ?? getTwilioDeviceIdentity(session.userId),
      callId: args.callId,
    };
  },
});

export const validateSessionForTwiML = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    sessionToken: v.string(),
    parentCallSid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);

    const call = await ctx.db.get(args.callId);
    if (!call || call.provider !== "twilio" || !OUTBOUND_BROWSER_CALL_MODES.has(call.callMode)) {
      throw new Error("Call not found");
    }

    const connectTokenHash = await sha256(args.sessionToken);
    const session = await ctx.db
      .query("twilioCallSessions")
      .withIndex("by_token", (q) => q.eq("connectTokenHash", connectTokenHash))
      .first();

    const now = Date.now();
    if (!session || session.callId !== args.callId || session.workspaceId !== call.workspaceId) {
      throw new Error("Invalid Twilio call session");
    }
    if (session.status !== "pending" || session.usedAt) {
      throw new Error("Twilio call session has already been used");
    }
    if (session.expiresAt < now) {
      await ctx.db.patch(session._id, { status: "expired" });
      if (!call.isFreeCall && call.creditReservationId) {
        await releaseCallReservation(ctx, {
          callId: call._id,
          now,
          description: "Released credits for call session that expired before connecting",
        });
        await ctx.db.patch(call._id, {
          status: "expired",
          processingStatus: "failed",
          endedAt: new Date(now).toISOString(),
        });
      }
      throw new Error("Twilio call session expired");
    }
    if (call.endedAt || TERMINAL_CALL_STATUSES.has(call.status)) {
      throw new Error("Twilio call session is no longer active");
    }

    const reservation = await ctx.db
      .query("creditReservations")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    if (call.bridgeModeRequested && !call.isFreeCall && reservation?.status !== "reserved") {
      throw new Error("The call credit reservation is no longer active.");
    }
    const providerMaxCallSeconds = call.bridgeModeRequested ? getBridgeMaxCallSeconds(60) : getMaxCallSeconds();
    const quotedMaxCallSeconds =
      call.isFreeCall
        ? getFreeCallMaxSeconds()
        : reservation?.status === "reserved"
        ? Math.min(reservation.reservedSeconds, providerMaxCallSeconds)
        : providerMaxCallSeconds;
    // Paid bridges require an active reservation above. Independently clamp
    // the reserved duration, trials, and legacy calls to the call's own cap
    // and the current operator ceiling before sending Twilio its timeLimit.
    // A workspace preference change must not extend a pending call, and a
    // shorter operator ceiling must still be able to contain that call.
    const maxCallSeconds = call.bridgeModeRequested
      ? Math.min(quotedMaxCallSeconds, call.bridgeMaxCallSeconds ?? getBridgeMaxCallSeconds(), getBridgeMaxCallSeconds(60))
      : quotedMaxCallSeconds;

    if (call.isFreeCall) {
      await markFreeCallClaimed(ctx, call.workspaceId, args.callId, maxCallSeconds, now);
    }

    await ctx.db.patch(session._id, {
      status: "used",
      usedAt: now,
    });

    await ctx.db.patch(args.callId, {
      parentCallSid: args.parentCallSid,
      status: "connecting",
      processingStatus: "calling",
    });

    const realtimeSessionIds = await markRealtimeSessionsStarting(ctx, {
      callId: args.callId,
      providerCallSid: args.parentCallSid,
      liveCopilotRequested: call.realtimeCopilotRequested ?? false,
      translatedCaptionsRequested: call.translatedCaptionsRequested ?? false,
      now,
    });

    return {
      callId: args.callId,
      destinationE164: session.destinationE164,
      callerIdNumber: session.callerIdNumber,
      workspaceId: call.workspaceId,
      maxCallSeconds,
      aiCaptureEnabled: call.aiCaptureEnabled ?? true,
      realtimeCopilotRequested: call.realtimeCopilotRequested ?? false,
      translatedCaptionsRequested: call.translatedCaptionsRequested ?? false,
      spokenTranslationRequested: call.spokenTranslationRequested ?? false,
      bridgeModeRequested: call.bridgeModeRequested ?? false,
      callerTranslatedVoice: normalizeTranslatedVoiceGender(call.callerTranslatedVoice),
      calledPersonTranslatedVoice: normalizeTranslatedVoiceGender(
        call.calledPersonTranslatedVoice
      ),
      translatedCaptionsSourceLanguage: call.translatedCaptionsSourceLanguage,
      translatedCaptionsTargetLanguage: call.translatedCaptionsTargetLanguage,
      realtimeSessionIds,
    };
  },
});

export const recordBridgeCalleeCallSid = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    bridgeCalleeCallSid: v.string(),
    maxCallSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call || call.provider !== "twilio" || !call.bridgeModeRequested) {
      throw new Error("Twilio bridge call not found");
    }

    await ctx.db.patch(call._id, {
      bridgeCalleeCallSid: args.bridgeCalleeCallSid,
      providerCallSid: args.bridgeCalleeCallSid,
    });

    const terminateImmediately = isTerminalTwilioCallStatus(call.bridgeParentStatus);

    // Independent deadline for both legs, committed here rather than left to
    // the caller: the browser leg is answered with <Connect><Stream> and has
    // no Twilio `timeLimit` of its own, so without this a failed sibling
    // termination leaves it billing until Twilio's four-hour global ceiling.
    if (!terminateImmediately) {
      await ctx.scheduler.runAfter(
        bridgeTerminationDelayMs(args.maxCallSeconds ?? getBridgeMaxCallSeconds()),
        internal.twilioLifecycle.enforceBridgeCallDeadline,
        { callId: call._id }
      );
    }

    return { terminateImmediately };
  },
});

export const failBridgeCallSetup = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);
    const call = await ctx.db.get(args.callId);
    if (!call || call.provider !== "twilio" || !call.bridgeModeRequested) {
      return { failed: false };
    }

    const now = Date.now();
    // A callee leg may already exist even though setup failed. The voice route
    // also terminates it inline, but that attempt is best-effort and inside a
    // request that is about to return an error, so schedule the durable,
    // retrying path as well.
    if (call.bridgeCalleeCallSid && !isTerminalTwilioCallStatus(call.bridgeCalleeStatus)) {
      await ctx.scheduler.runAfter(0, internal.twilioLifecycle.terminateProviderCall, {
        callSid: call.bridgeCalleeCallSid,
        reason: "bridge_setup_failed",
      });
    }
    if (call.creditReservationId) {
      await releaseCallReservation(ctx, {
        callId: call._id,
        now,
        description: "Released credits after translated call setup failed",
      });
    }
    await ctx.db.patch(call._id, {
      status: "failed",
      processingStatus: "failed",
      endedAt: new Date(now).toISOString(),
    });
    if (call.realtimeCopilotRequested || call.translatedCaptionsRequested) {
      await settleOutstandingRealtimeCharges(ctx, {
        workspaceId: call.workspaceId,
        callId: call._id,
        now,
      });
    }
    return { failed: true };
  },
});

export const recordStatusCallback = mutation({
  args: {
    secret: v.string(),
    callId: v.optional(v.id("calls")),
    providerCallSid: v.optional(v.string()),
    parentCallSid: v.optional(v.string()),
    providerStatus: v.optional(v.string()),
    eventType: v.string(),
    durationSeconds: v.optional(v.number()),
    bridgeLeg: v.optional(v.union(v.literal("parent"), v.literal("callee"))),
    payloadSummary: payloadSummaryValidator,
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);

    let call = args.callId ? await ctx.db.get(args.callId) : null;

    if (!call && args.providerCallSid) {
      call =
        (await ctx.db
          .query("calls")
          .withIndex("by_provider_call_sid", (q) =>
            q.eq("providerCallSid", args.providerCallSid)
          )
          .first()) ?? null;

      // Some callbacks use the parent CallSid as the CallSid; try that too
      if (!call) {
        call =
          (await ctx.db
            .query("calls")
            .withIndex("by_parent_call_sid", (q) =>
              q.eq("parentCallSid", args.providerCallSid)
            )
            .first()) ?? null;
      }

      // A bridge call's callee leg is a separately created call. Resolve it by
      // its own dedicated index rather than relying on `providerCallSid`
      // having been overwritten with the callee SID.
      if (!call) {
        call =
          (await ctx.db
            .query("calls")
            .withIndex("by_bridge_callee_call_sid", (q) =>
              q.eq("bridgeCalleeCallSid", args.providerCallSid)
            )
            .first()) ?? null;
      }
    }

    if (!call && args.parentCallSid) {
      call =
        (await ctx.db
          .query("calls")
          .withIndex("by_provider_call_sid", (q) =>
            q.eq("providerCallSid", args.parentCallSid)
          )
          .first()) ??
        (await ctx.db
          .query("calls")
          .withIndex("by_parent_call_sid", (q) =>
            q.eq("parentCallSid", args.parentCallSid)
          )
          .first()) ?? null;
    }

    if (!call || call.provider !== "twilio") {
      // Log orphan event instead of throwing, so Twilio doesn't retry
      // and we can debug which identifiers are missing
      console.error("recordStatusCallback: Twilio call not found", {
        hasCallId: Boolean(args.callId),
        hasProviderCallSid: Boolean(args.providerCallSid),
        hasParentCallSid: Boolean(args.parentCallSid),
        providerStatus: args.providerStatus,
        eventType: args.eventType,
      });
      return { found: false, callId: null };
    }

    const now = Date.now();
    const normalized = normalizeTwilioStatus(args.providerStatus);
    const aiCaptureEnabled = call.aiCaptureEnabled !== false;
    const processingStatus =
      normalized.processingStatus === "transcript_needed" && !aiCaptureEnabled
        ? "completed"
        : normalized.processingStatus;
    const completed =
      args.eventType === "completed" ||
      ["completed", "busy", "failed", "no-answer", "canceled"].includes(
        args.providerStatus ?? ""
      );

    await ctx.db.insert("providerEvents", {
      workspaceId: call.workspaceId,
      callId: call._id,
      provider: "twilio",
      eventType: args.eventType,
      providerCallSid: args.providerCallSid,
      parentCallSid: args.parentCallSid,
      providerStatus: args.providerStatus,
      durationSeconds: args.durationSeconds,
      receivedAt: now,
      payloadSummary: args.payloadSummary,
    });

    if (call.callDirection === "inbound" && !args.callId) {
      return { callId: call._id };
    }

    const isBridgeCall = call.bridgeModeRequested === true;
    const bridgeLeg = classifyBridgeLeg({
      bridgeModeRequested: isBridgeCall,
      labeledLeg: args.bridgeLeg,
      providerCallSid: args.providerCallSid,
      bridgeCalleeCallSid: call.bridgeCalleeCallSid,
      parentCallSid: call.parentCallSid,
    });

    // Twilio does not guarantee callback ordering, and a bridge call has two
    // independent callback streams. A late non-terminal event must never drag a
    // finished call back to a live status, which would strand it outside the
    // post-call pipeline permanently.
    const applyLifecyclePatch = shouldApplyProviderStatusPatch({
      existingStatus: call.status,
      existingEndedAt: call.endedAt,
      incomingIsTerminal: completed,
    });
    if (!applyLifecyclePatch) {
      console.warn("[Twilio Provider] Ignored out-of-order provider callback", {
        callId: call._id,
        bridgeLeg,
        providerStatus: args.providerStatus,
        sequenceNumber: args.payloadSummary.sequenceNumber,
      });
    }

    // Schedules the surviving leg's termination inside this transaction rather
    // than returning it for the caller to act on. The pre-existing design
    // carried the instruction in an HTTP response body and executed it with a
    // single un-retried REST call from inside the webhook request: if the
    // response was lost, or Twilio rejected the verb because the leg's state
    // had changed, the sibling stayed alive and kept billing.
    const scheduleSiblingTermination = async (callSid: string | undefined, leg: string) => {
      if (!callSid) return;
      await ctx.scheduler.runAfter(0, internal.twilioLifecycle.terminateProviderCall, {
        callSid,
        reason: `bridge_sibling_${leg}`,
      });
    };

    if (isBridgeCall && bridgeLeg === "parent") {
      // Bridge-GA Phase 1b: this leg's own duration was previously
      // discarded entirely — this branch patched lifecycle fields and
      // returned before ever reaching settlement below. Persisted here for
      // internal cost visibility only; customer-facing settlement still
      // deliberately uses the callee leg's own duration (see the
      // settleCallReservation call site further down), since that's when
      // the actual translated conversation was happening.
      const calleeAlreadyTerminal = Boolean(
        call.bridgeCalleeStatus && TERMINAL_CALL_STATUSES.has(call.bridgeCalleeStatus)
      );
      const bridgeInternalCostCents = completed
        ? computeBridgeInternalCostCents({
            parentDurationSeconds: args.durationSeconds,
            calleeDurationSeconds: calleeAlreadyTerminal ? call.durationSeconds : undefined,
            calleeProviderCostCentsPerMinute: call.providerCostCentsPerMinute,
          })
        : undefined;
      await ctx.db.patch(call._id, {
        parentCallSid: args.providerCallSid ?? args.parentCallSid ?? call.parentCallSid,
        bridgeParentStatus: args.providerStatus,
        ...(completed ? { bridgeParentDurationSeconds: args.durationSeconds ?? 0 } : {}),
        ...(bridgeInternalCostCents !== undefined ? { bridgeInternalCostCents } : {}),
        ...(completed || !applyLifecyclePatch
          ? {}
          : {
              status: normalized.status,
              processingStatus,
            }),
      });
      if (completed) {
        await scheduleSiblingTermination(call.bridgeCalleeCallSid, "callee");
      }
      return {
        callId: call._id,
        terminateCallSid: completed ? call.bridgeCalleeCallSid : undefined,
      };
    }

    await ctx.db.patch(call._id, {
      providerCallSid: args.providerCallSid ?? call.providerCallSid,
      ...(isBridgeCall && bridgeLeg === "callee"
        ? {
            bridgeCalleeCallSid:
              args.providerCallSid ?? call.bridgeCalleeCallSid,
            bridgeCalleeStatus: args.providerStatus,
          }
        : {
            parentCallSid: args.parentCallSid ?? call.parentCallSid,
          }),
      ...(applyLifecyclePatch
        ? {
            status: normalized.status,
            processingStatus,
            durationSeconds:
              args.durationSeconds !== undefined
                ? args.durationSeconds
                : call.durationSeconds,
            endedAt: completed ? new Date(now).toISOString() : call.endedAt,
          }
        : {}),
    });

    if (!applyLifecyclePatch) {
      return { callId: call._id, terminateCallSid: undefined };
    }

    if (isBridgeCall && aiCaptureEnabled && normalized.processingStatus === "transcript_needed") {
      await ctx.scheduler.runAfter(90_000, internal.bridgeRecordings.finalizeBridgeRecordingSet, {
        callId: call._id,
      });
    }

    if (!isBridgeCall && aiCaptureEnabled && normalized.processingStatus === "transcript_needed") {
      await ctx.scheduler.runAfter(
        RECORDING_CALLBACK_GRACE_MS,
        internal.twilioProvider.markRecordingCallbackMissing,
        { callId: call._id }
      );
    }

    if (completed && call.creditReservationId && call.callDirection !== "inbound") {
      const settlement = await settleCallReservation(ctx, {
        callId: call._id,
        durationSeconds: args.durationSeconds ?? 0,
        now,
      });
      if (settlement.settled) {
        await ctx.db.patch(call._id, {
          settledCreditCents: settlement.settledCents,
        });
      }
    }

    // Bridge-GA Phase 1b: mirror of the parent-branch calculation above, for
    // whichever leg's terminal callback happens to land second (ordering
    // between the two legs isn't guaranteed). Internal-only cost visibility,
    // never a customer charge — see computeBridgeInternalCostCents.
    if (isBridgeCall && bridgeLeg === "callee" && completed) {
      const parentAlreadyTerminal = Boolean(
        call.bridgeParentStatus && TERMINAL_CALL_STATUSES.has(call.bridgeParentStatus)
      );
      const bridgeInternalCostCents = computeBridgeInternalCostCents({
        parentDurationSeconds: parentAlreadyTerminal
          ? call.bridgeParentDurationSeconds
          : undefined,
        calleeDurationSeconds: args.durationSeconds ?? 0,
        calleeProviderCostCentsPerMinute: call.providerCostCentsPerMinute,
      });
      if (bridgeInternalCostCents !== undefined) {
        await ctx.db.patch(call._id, { bridgeInternalCostCents });
      }
    }

    if (
      completed &&
      (call.realtimeCopilotRequested || call.translatedCaptionsRequested)
    ) {
      await settleOutstandingRealtimeCharges(ctx, {
        workspaceId: call.workspaceId,
        callId: call._id,
        now,
      });
    }

    // Keep older unclaimed free-call records from remaining eligible if a legacy
    // session reaches completion without the TwiML-time claim.
    if (call.isFreeCall && completed) {
      const wallet = await ctx.db
        .query("walletSummaries")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", call.workspaceId))
        .first();
      if (wallet && !wallet.freeCallUsed) {
        await ctx.db.patch(wallet._id, {
          freeCallUsed: true,
          freeCallUsedAt: now,
          freeCallUsedCallId: call._id,
        });
      }
      if (!call.freeCallClaimedAt) {
        await ctx.db.patch(call._id, {
          freeCallClaimedAt: now,
          freeCallMaxSeconds: call.freeCallMaxSeconds ?? getFreeCallMaxSeconds(),
        });
      }
    }

    if (isBridgeCall && bridgeLeg === "callee" && completed) {
      await scheduleSiblingTermination(call.parentCallSid, "parent");
    }

    return {
      callId: call._id,
      terminateCallSid:
        isBridgeCall && bridgeLeg === "callee" && completed
          ? call.parentCallSid
          : undefined,
    };
  },
});

export const recordRecordingCallback = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    recordingUrl: v.string(),
    recordingDuration: v.optional(v.number()),
    recordingSid: v.optional(v.string()),
    recordingChannels: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.secret);

    const call = await ctx.db.get(args.callId);
    if (!call || call.provider !== "twilio") {
      throw new Error("Twilio call not found");
    }

    if (call.aiCaptureEnabled === false) {
      await ctx.db.patch(args.callId, {
        recordingSid: args.recordingSid,
        recordingChannels: args.recordingChannels,
        recordingDeleteStatus: args.recordingSid ? "pending" : "failed",
        recordingDeleteError: args.recordingSid ? undefined : "Twilio recording SID missing",
        processingStatus: "completed",
      });
      if (args.recordingSid) {
        await ctx.scheduler.runAfter(0, internal.transcription.deleteTwilioRecording, {
          callId: args.callId,
          recordingSid: args.recordingSid,
          attempt: 1,
        });
      }
      return { callId: call._id };
    }

    const voicemailEndedAt =
      call.inboundVoicemail && !call.endedAt ? new Date(Date.now()).toISOString() : undefined;
    await ctx.db.patch(args.callId, {
      recordingDuration: args.recordingDuration,
      recordingSid: args.recordingSid,
      recordingChannels: args.recordingChannels,
      recordingDeleteStatus: args.recordingSid ? "pending" : "failed",
      recordingDeleteError: args.recordingSid ? undefined : "Twilio recording SID missing",
      processingStatus: "transcribing",
      ...(voicemailEndedAt ? { endedAt: voicemailEndedAt } : {}),
    });

    await ctx.scheduler.runAfter(0, internal.transcription.transcribeRecording, {
      callId: args.callId,
      recordingUrl: args.recordingUrl,
      recordingDuration: args.recordingDuration,
      recordingSid: args.recordingSid,
      recordingChannels: args.recordingChannels,
    });

    return { callId: call._id };
  },
});

export const markRecordingCallbackMissing = internalMutation({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (
      !call ||
      call.provider !== "twilio" ||
      call.callMode === "human_twilio_bridge" ||
      call.aiCaptureEnabled === false ||
      call.processingStatus !== "transcript_needed" ||
      call.recordingSid ||
      call.transcriptId
    ) {
      return { updated: false };
    }

    await ctx.db.patch(args.callId, {
      processingStatus: "recording_callback_missing",
      highlights: [
        "Recording callback was not received from the calling provider. Contact support if this keeps happening.",
      ],
    });

    return { updated: true };
  },
});

export const getProviderEventsByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];

    const events = await ctx.db
      .query("providerEvents")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();

    return events.sort((a, b) => a.receivedAt - b.receivedAt);
  },
});
