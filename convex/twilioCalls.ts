import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireWorkspace, requireWorkspaceMembership } from "./authHelpers";
import {
  TWILIO_SESSION_TTL_MS,
  destinationAllowed,
  freeCallDestinationAllowed,
  getAllowedCountries,
  getAllowedNumbers,
  getFreeCallAllowedCountries,
  getFreeCallAllowedNumbers,
  getFreeCallMaxSeconds,
  getBridgeMaxCallSeconds,
  getMaxCallSeconds,
  getTwilioDeviceIdentity,
  isTwilioCallingEnabled,
  isE164,
} from "./twilioShared";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { quoteOutboundCall, resolveDestinationRateDetail } from "../src/lib/call-pricing";
import { translatedTrialEnabled } from "../src/lib/translated-trial";
import { trialRequire } from "./trialAccess";
import {
  LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE,
  assertLiveTranslationLanguageDirection,
} from "../src/lib/live-translation-languages";
import {
  CALL_RECORD_LANGUAGE_AUTO,
  assertCallRecordLanguagePreference,
} from "../src/lib/call-record-languages";
import { normalizePhoneE164 } from "../src/lib/phone";
import { getWorkflowTemplate } from "../src/lib/workflow-templates";
import { releaseCallReservation, reserveCallCredits } from "./billingHelpers";
import { seedDeterministicGuidanceItems } from "./callGuidance";
import { assertRealtimeFeatureCanStart } from "./realtimeBilling";
import { createRequestedRealtimeSession } from "./realtimeRuntime";
import {
  isWorkspaceOnAudioForwardAllowlist,
  mintBrowserAudioStreamTokenForCall,
} from "./browserAudioStream";
import { isWorkspaceOnBridgeAllowlist } from "./translationBridge";
import { normalizeTranslatedVoiceGender } from "../src/lib/live-translation-voices";

function isFreeCallEligibleWallet(
  wallet: {
    planId?: string;
    subscriptionStatus?: string;
    freeCallUsed?: boolean;
  } | null
) {
  return Boolean(
    wallet &&
      !wallet.freeCallUsed &&
      wallet.planId === "free" &&
      wallet.subscriptionStatus === "free"
  );
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createSessionToken() {
  if (typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

async function expireStalePendingTwilioSessions(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  now: number
) {
  const pendingSessions = await ctx.db
    .query("twilioCallSessions")
    .withIndex("by_status", (q) =>
      q.eq("workspaceId", workspaceId).eq("status", "pending")
    )
    .collect();

  let activePendingFreeSession = false;

  for (const session of pendingSessions) {
    const call = await ctx.db.get(session.callId);

    if (session.expiresAt <= now) {
      await ctx.db.patch(session._id, { status: "expired" });
      if (call && !call.isFreeCall && call.creditReservationId) {
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
      continue;
    }

    if (call?.isFreeCall) {
      activePendingFreeSession = true;
    }
  }

  return { activePendingFreeSession };
}

async function expirePendingTwilioSession(
  ctx: MutationCtx,
  sessionId: Id<"twilioCallSessions">,
  now: number
) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.status !== "pending") {
    return { expired: false, rescheduled: false };
  }
  // Never silently give up: this job is the only thing that frees a
  // never-connected call's reservation, and it runs exactly once. If it somehow
  // fires before the TTL boundary, reschedule instead of returning quietly —
  // the original version returned `{ expired: false }` here and the credits
  // stayed reserved forever.
  if (session.expiresAt > now) {
    await ctx.scheduler.runAfter(
      Math.max(1000, session.expiresAt - now + 1000),
      internal.twilioCalls.expirePendingSession,
      { sessionId: session._id }
    );
    return { expired: false, rescheduled: true };
  }

  const call = await ctx.db.get(session.callId);
  await ctx.db.patch(session._id, { status: "expired" });
  if (call && !call.isFreeCall && call.creditReservationId) {
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
  return { expired: true, rescheduled: false };
}

export const expirePendingSession = internalMutation({
  args: {
    sessionId: v.id("twilioCallSessions"),
  },
  handler: async (ctx, args) =>
    await expirePendingTwilioSession(ctx, args.sessionId, Date.now()),
});

export const cancelOutboundSession = mutation({
  args: {
    callId: v.id("calls"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId } = await requireWorkspaceMembership(ctx);
    const call = await ctx.db.get(args.callId);
    if (
      !call ||
      call.workspaceId !== workspaceId ||
      call.createdByUserId !== userId ||
      call.provider !== "twilio"
    ) {
      throw new Error("Call not found");
    }

    const connectTokenHash = await sha256(args.sessionToken);
    const session = await ctx.db
      .query("twilioCallSessions")
      .withIndex("by_token", (q) => q.eq("connectTokenHash", connectTokenHash))
      .first();
    if (
      !session ||
      session.callId !== call._id ||
      session.workspaceId !== workspaceId ||
      session.status !== "pending"
    ) {
      return { canceled: false };
    }

    const now = Date.now();
    await ctx.db.patch(session._id, { status: "failed" });
    if (!call.isFreeCall && call.creditReservationId) {
      await releaseCallReservation(ctx, {
        callId: call._id,
        now,
        description: "Released credits for browser call that failed before connecting",
      });
    }
    await ctx.db.patch(call._id, {
      status: "failed",
      processingStatus: "failed",
      endedAt: new Date(now).toISOString(),
    });
    return { canceled: true };
  },
});

export const createOutboundSession = mutation({
  args: {
    phoneNumber: v.string(),
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    objective: v.optional(v.string()),
    checklistItems: v.optional(v.array(v.string())),
    workflowTemplateKey: v.optional(v.string()),
    callRecordLanguagePreference: v.optional(v.string()),
    enableLiveCopilot: v.optional(v.boolean()),
    enableTranslatedCaptions: v.optional(v.boolean()),
    enableSpokenTranslation: v.optional(v.boolean()),
    enableBridgeMode: v.optional(v.boolean()),
    callerTranslatedVoice: v.optional(v.union(v.literal("male"), v.literal("female"))),
    calledPersonTranslatedVoice: v.optional(v.union(v.literal("male"), v.literal("female"))),
    translatedCaptionsSourceLanguage: v.optional(v.string()),
    translatedCaptionsTargetLanguage: v.optional(v.string()),
    callerIdId: v.optional(v.id("callingNumbers")),
    isFreeCall: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId, profile } = await requireWorkspaceMembership(ctx);

    if (!isTwilioCallingEnabled()) {
      throw new Error("Browser calling is not enabled for this workspace yet.");
    }

    const destinationE164 = normalizePhoneE164(args.phoneNumber);
    if (!isE164(destinationE164)) {
      throw new Error("Enter the destination in E.164 format, for example +351912345678.");
    }

    const allowed = destinationAllowed(destinationE164);
    if (!allowed.allowed) {
      throw new Error(allowed.reason);
    }

    const isFreeCall = args.isFreeCall ?? false;
    const translatedTrial = isFreeCall && translatedTrialEnabled();
    if (isFreeCall) {
      trialRequire(profile.email.trim().length > 0, "trial_email_required");
      trialRequire(!args.enableLiveCopilot && !args.enableSpokenTranslation, "trial_translation_required");
      trialRequire(translatedTrial
        ? args.enableBridgeMode === true && args.enableTranslatedCaptions === true
        : !args.enableBridgeMode && !args.enableTranslatedCaptions && !args.enableSpokenTranslation,
      "trial_translation_required");
    }
    const now = Date.now();
    const configuredMaxCallSeconds = getMaxCallSeconds();
    const freeCallMaxSeconds = getFreeCallMaxSeconds();
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    const aiCaptureEnabled =
      isFreeCall || (wallet?.aiFeaturesEnabled !== false && wallet?.planId !== "calls_only");

    if (isFreeCall) {
      const freeAllowed = translatedTrial ? destinationAllowed(destinationE164) : freeCallDestinationAllowed(destinationE164);
      if (!freeAllowed.allowed) {
        throw new Error(freeAllowed.reason);
      }

      const { activePendingFreeSession } = await expireStalePendingTwilioSessions(
        ctx,
        workspaceId,
        now
      );
      if (activePendingFreeSession) {
        throw new Error("A free trial call is already starting. Wait a moment before trying again.");
      }

      if (wallet?.freeCallUsed) {
        throw new Error("Your free call has already been used. Please add credits to continue calling.");
      }
      if (!isFreeCallEligibleWallet(wallet)) {
        throw new Error("The free call trial is only available before adding credits or starting a plan.");
      }
    }

    let contact = null;
    if (args.contactId) {
      contact = await ctx.db.get(args.contactId);
      if (!contact || contact.workspaceId !== workspaceId) {
        throw new Error("Contact not found");
      }
    }

    let caseItem = null;
    if (args.caseId) {
      caseItem = await ctx.db.get(args.caseId);
      if (!caseItem || caseItem.workspaceId !== workspaceId) {
        throw new Error("Case not found");
      }
    }

    const workflowTemplate = getWorkflowTemplate(
      args.workflowTemplateKey ?? caseItem?.workflowTemplateKey
    );
    const callRecordLanguagePreference = assertCallRecordLanguagePreference(
      args.callRecordLanguagePreference
    );
    const explicitCallRecordLanguage =
      callRecordLanguagePreference === CALL_RECORD_LANGUAGE_AUTO
        ? undefined
        : callRecordLanguagePreference;
    const requestedLiveCopilot = args.enableLiveCopilot ?? false;
    const enableTranslatedCaptions = args.enableTranslatedCaptions ?? false;
    // Live Audio Translation (internal-only, single-workspace test — see
    // AGENTIC_FUTURE.md): never trust the client's flag alone. Downgrades to
    // false (rather than throwing) for any workspace not on the allowlist or
    // any call without captions on, so a stale UI can never start a real
    // vendor session outside the test workspace.
    const enableSpokenTranslation =
      enableTranslatedCaptions &&
      Boolean(args.enableSpokenTranslation) &&
      isWorkspaceOnAudioForwardAllowlist(workspaceId);
    // Real two-leg translation bridge (internal-only, single-workspace test,
    // sub-phase 5a — see AGENTIC_FUTURE.md). Same never-trust-the-client
    // discipline as enableSpokenTranslation, on its own separate allowlist.
    // The reverse (user's voice -> callee's language) direction reuses the
    // SAME language pair the UI already collects, swapped: the callee's
    // "expected spoken language" becomes the synthesis target, and the
    // user's own "translate into" language becomes the synthesis source —
    // so it needs a concrete (non-auto-detect) expected-language pick.
    const workspace = await ctx.db.get(workspaceId);
    const bridgePlanEligible = Boolean(
      wallet &&
        wallet.aiFeaturesEnabled !== false &&
        wallet.planId !== "free" &&
        wallet.planId !== "calls_only"
    );
    if (args.enableBridgeMode && (!args.translatedCaptionsSourceLanguage ||
        args.translatedCaptionsSourceLanguage === LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE)) {
      throw new Error("Choose two supported languages for Voice Translation.");
    }
    const enableBridgeMode =
      enableTranslatedCaptions &&
      Boolean(args.enableBridgeMode) &&
      isWorkspaceOnBridgeAllowlist(workspaceId) &&
      workspace?.voiceTranslationEnabled !== false &&
      (bridgePlanEligible || isFreeCall) &&
      args.translatedCaptionsSourceLanguage !== undefined &&
      args.translatedCaptionsSourceLanguage !== LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE;
    const callerTranslatedVoice = normalizeTranslatedVoiceGender(args.callerTranslatedVoice);
    const calledPersonTranslatedVoice = normalizeTranslatedVoiceGender(
      args.calledPersonTranslatedVoice
    );
    const enableLiveCopilot = requestedLiveCopilot;
    const maxCallSeconds = enableBridgeMode
      ? getBridgeMaxCallSeconds(workspace?.voiceTranslationMaxCallMinutes)
      : configuredMaxCallSeconds;
    const liveTranslationDirection = enableTranslatedCaptions
      ? assertLiveTranslationLanguageDirection({
          sourceLanguage: args.translatedCaptionsSourceLanguage,
          targetLanguage: args.translatedCaptionsTargetLanguage,
          mode: enableBridgeMode ? "voice" : "legacy",
          expandedLanguages: process.env.PALABRA_EXPANDED_LANGUAGES_ENABLED === "true",
        })
      : { sourceLanguage: undefined, targetLanguage: undefined };

    if (translatedTrial) {
      trialRequire(enableBridgeMode && liveTranslationDirection.sourceLanguage && liveTranslationDirection.targetLanguage &&
        liveTranslationDirection.sourceLanguage !== liveTranslationDirection.targetLanguage, "trial_translation_required");
    }

    if (enableLiveCopilot) {
      await assertRealtimeFeatureCanStart(ctx, {
        workspaceId,
        feature: "live_copilot",
        now,
      });
    }
    if (enableTranslatedCaptions) {
      // A bridged call is billed as Live Audio Translation, never as captions:
      // it runs one Palabra session PER DIRECTION (~9c/min all-in against the
      // 4c captions cost), and the caption rows it produces are a byproduct of
      // those same two sessions. Gating on captions instead would check the
      // 10c/4c margin for a 9c feature — a false pass on every bridged minute —
      // and billing both features would charge the customer twice for one call.
      if (!translatedTrial) {
        await assertRealtimeFeatureCanStart(ctx, {
          workspaceId,
          feature: enableBridgeMode ? "translated_audio" : "translated_captions",
          now,
        });
      }
    }

    const startedAt = new Date(now).toISOString();
    const twilioIdentity = getTwilioDeviceIdentity(String(userId));
    let callerIdId = args.callerIdId;
    let callerIdNumber: string | undefined;
    let callerIdSource: "twilio_account" | "verified_external" | "rented" = "twilio_account";
    let callerIdLabel: string | undefined;

    if (callerIdId) {
      const callingNumber = await ctx.db.get(callerIdId);
      if (
        !callingNumber ||
        callingNumber.workspaceId !== workspaceId ||
        callingNumber.status !== "active"
      ) {
        throw new Error("Choose an active calling number before placing this call.");
      }
      callerIdNumber = callingNumber.phoneNumber;
      callerIdSource = callingNumber.source;
      callerIdLabel = callingNumber.label;
    } else {
      const workspaceNumbers = await ctx.db
        .query("callingNumbers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      const defaultNumber = workspaceNumbers.find(
        (number) => number.status === "active" && number.isDefault
      );
      if (defaultNumber) {
        callerIdId = defaultNumber._id;
        callerIdNumber = defaultNumber.phoneNumber;
        callerIdSource = defaultNumber.source;
        callerIdLabel = defaultNumber.label;
      } else {
        callerIdNumber = normalizePhoneE164(process.env.TWILIO_CALLER_ID ?? "");
        callerIdLabel = "Voxandra default";
      }
    }

    const quote = quoteOutboundCall({
      destinationE164,
      originE164: callerIdNumber,
      originCountry: process.env.TWILIO_PRICING_ORIGIN_COUNTRY,
      aiCaptureEnabled,
    });
    if (!quote.available || !quote.rateCentsPerMinute) {
      throw new Error(quote.blockReason ?? "This route is not available for self-serve calling.");
    }
    const destinationCountry = quote.destinationCountry;
    const retailRateCentsPerMinute = quote.rateCentsPerMinute;

    const callId = await ctx.db.insert("calls", {
      workspaceId,
      createdByUserId: userId,
      createdByProfileId: profile._id,
      contactId: args.contactId,
      caseId: args.caseId,
      dialedNumber: destinationE164,
      objective: args.objective,
      workflowTemplateKey: workflowTemplate.key,
      startedAt,
      durationSeconds: 0,
      status: "created",
      processingStatus: "calling",
      aiMemoryReady: false,
      reviewPending: false,
      highlights: args.objective ? [args.objective] : [isFreeCall ? "Free translated trial call created" : "Twilio call created"],
      userNotes: args.objective ?? "",
      simulated: false,
      callMode: enableBridgeMode ? "human_twilio_bridge" : "human_twilio",
      bridgeMaxCallSeconds: enableBridgeMode ? (translatedTrial ? Math.min(maxCallSeconds, freeCallMaxSeconds) : maxCallSeconds) : undefined,
      translatedTrialAuthorized: translatedTrial || undefined,
      callRecordLanguagePreference,
      callRecordLanguage: explicitCallRecordLanguage,
      callRecordLanguageSource: explicitCallRecordLanguage ? "explicit" : undefined,
      provider: "twilio",
      twilioDeviceIdentity: twilioIdentity,
      callDirection: "outbound",
      callerIdId,
      callerIdNumber,
      callerIdSource,
      callerIdLabel,
      destinationCountry,
      destinationType: quote.routeType,
      retailRateCentsPerMinute,
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
      isFreeCall,
      freeCallMaxSeconds: isFreeCall ? freeCallMaxSeconds : undefined,
      realtimeCopilotRequested: enableLiveCopilot,
      translatedCaptionsRequested: enableTranslatedCaptions,
      spokenTranslationRequested: enableSpokenTranslation,
      bridgeModeRequested: enableBridgeMode,
      ...(enableBridgeMode ? { callerTranslatedVoice, calledPersonTranslatedVoice } : {}),
      translatedCaptionsSourceLanguage: liveTranslationDirection.sourceLanguage,
      translatedCaptionsTargetLanguage: liveTranslationDirection.targetLanguage,
    });

    await seedDeterministicGuidanceItems(ctx, {
      workspaceId,
      callId,
      checklistItems: args.checklistItems,
    });

    let reservedMaxCallSeconds = maxCallSeconds;

    if (isFreeCall) {
      reservedMaxCallSeconds = freeCallMaxSeconds;
    } else {
      try {
        const reservation = await reserveCallCredits(ctx, {
          workspaceId,
          callId,
          rateCentsPerMinute: retailRateCentsPerMinute,
          maxCallSeconds,
          now,
          providerCostCentsPerMinute: quote.providerCostCentsPerMinute,
          aiCaptureCostCentsPerMinute: quote.aiCaptureCostCentsPerMinute,
          totalVariableCostCentsPerMinute: quote.totalVariableCostCentsPerMinute,
          marginMultiple: quote.marginMultiple,
          billingIncrementSeconds: quote.billingIncrementSeconds,
          minimumBillableSeconds: quote.minimumBillableSeconds,
          pricingCatalogVersion: quote.pricingCatalogVersion,
          quoteBlockReason: quote.blockReason,
        });
        reservedMaxCallSeconds = reservation.reservedSeconds;
        await ctx.db.patch(callId, {
          creditReservationId: reservation.reservationId,
          reservedCreditCents: reservation.reservedCents,
          estimatedCostCents: reservation.reservedCents,
        });
      } catch (error) {
        await ctx.db.delete(callId);
        throw error;
      }
    }

    const sessionToken = createSessionToken();
    const connectTokenHash = await sha256(sessionToken);

    const twilioCallSessionId = await ctx.db.insert("twilioCallSessions", {
      workspaceId,
      userId,
      callId,
      destinationE164,
      callerIdId,
      callerIdNumber,
      callerIdSource,
      aiCaptureEnabled,
      connectTokenHash,
      expiresAt: now + TWILIO_SESSION_TTL_MS,
      status: "pending",
      createdAt: now,
    });
    // +2s so the job never lands on the wrong side of its own TTL boundary and
    // no-ops. It reschedules itself if it still fires early, but not needing to
    // is cheaper and easier to reason about.
    await ctx.scheduler.runAfter(
      TWILIO_SESSION_TTL_MS + 2_000,
      internal.twilioCalls.expirePendingSession,
      { sessionId: twilioCallSessionId }
    );

    if (contact) {
      await ctx.db.patch(contact._id, {
        lastCallAt: startedAt,
        updatedAt: now,
      });
    }

    const realtimeSessionIds: {
      humanCopilot?: Id<"realtimeSessions">;
      translatedCaptions?: Id<"realtimeSessions">;
    } = {};

    if (enableLiveCopilot) {
      realtimeSessionIds.humanCopilot = await createRequestedRealtimeSession(ctx, {
        workspaceId,
        callId,
        mode: "human_copilot",
        provider: "twilio_media_stream",
        requestedByUserId: userId,
        requestedByProfileId: profile._id,
        model: process.env.OPENAI_REALTIME_MODEL,
        now,
      });
    }

    let browserAudioStreamToken: string | undefined;
    if (enableTranslatedCaptions) {
      realtimeSessionIds.translatedCaptions = await createRequestedRealtimeSession(ctx, {
        workspaceId,
        callId,
        mode: "translated_captions",
        provider: "twilio_media_stream",
        requestedByUserId: userId,
        requestedByProfileId: profile._id,
        model: process.env.OPENAI_REALTIME_TRANSLATION_MODEL,
        inputLanguage: liveTranslationDirection.sourceLanguage,
        targetLanguage: liveTranslationDirection.targetLanguage,
        now,
      });
      // Spoken Translation Phase 1 (internal-only, see AGENTIC_FUTURE.md):
      // undefined for every workspace not on the audio-forward allowlist, so
      // this stays a no-op for production traffic by default.
      browserAudioStreamToken = await mintBrowserAudioStreamTokenForCall(ctx, {
        workspaceId,
        callId,
        realtimeSessionId: realtimeSessionIds.translatedCaptions,
        now,
      });
    }

    return {
      callId,
      sessionToken,
      twilioDeviceIdentity: twilioIdentity,
      maxCallSeconds: reservedMaxCallSeconds,
      retailRateCentsPerMinute,
      minimumBillableSeconds: quote.minimumBillableSeconds,
      billingIncrementSeconds: quote.billingIncrementSeconds,
      minimumChargeCents: quote.minimumChargeCents,
      marginMultiple: quote.marginMultiple,
      aiCaptureEnabled,
      workflowTemplateKey: workflowTemplate.key,
      isFreeCall,
      realtimeCopilotRequested: enableLiveCopilot,
      translatedCaptionsRequested: enableTranslatedCaptions,
      spokenTranslationRequested: enableSpokenTranslation,
      bridgeModeRequested: enableBridgeMode,
      callerTranslatedVoice,
      calledPersonTranslatedVoice,
      translatedCaptionsSourceLanguage: liveTranslationDirection.sourceLanguage,
      translatedCaptionsTargetLanguage: liveTranslationDirection.targetLanguage,
      realtimeSessionIds,
      browserAudioStreamToken,
    };
  },
});

export const estimateDestinationRate = query({
  args: {
    phoneNumber: v.string(),
    callerIdId: v.optional(v.id("callingNumbers")),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);

    const destinationE164 = normalizePhoneE164(args.phoneNumber);
    if (!isE164(destinationE164)) {
      return {
        available: false,
        destinationE164,
        destinationCountry: "unknown",
        rateCentsPerMinute: null,
        reason: "Enter a full international number.",
      };
    }

    let callerIdNumber: string | undefined;
    if (args.callerIdId) {
      const callingNumber = await ctx.db.get(args.callerIdId);
      if (callingNumber?.workspaceId === workspaceId && callingNumber.status === "active") {
        callerIdNumber = callingNumber.phoneNumber;
      }
    }
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    const aiCaptureEnabled =
      wallet?.planId === "free" ||
      (wallet?.aiFeaturesEnabled !== false && wallet?.planId !== "calls_only");
    const quote = quoteOutboundCall({
      destinationE164,
      originE164: callerIdNumber ?? process.env.TWILIO_CALLER_ID,
      originCountry: process.env.TWILIO_PRICING_ORIGIN_COUNTRY,
      aiCaptureEnabled,
    });
    const allowed = destinationAllowed(destinationE164);
    // Which tier the typed number actually falls in, and whether that is settled.
    // A country-wide figure cannot describe a destination whose landline and
    // mobile differ by an order of magnitude, and showing the longest-prefix match
    // before it is settled makes the price jump as digits are typed.
    const resolution = resolveDestinationRateDetail({
      destinationE164,
      originE164: callerIdNumber ?? process.env.TWILIO_CALLER_ID,
      originCountry: process.env.TWILIO_PRICING_ORIGIN_COUNTRY,
    });
    const rateTier = resolution.status === "resolved" ? resolution.tier : null;
    const rateSettled = resolution.status === "resolved";

    if (!allowed.allowed) {
      return {
        available: false,
        destinationE164,
        destinationCountry: quote.destinationCountry,
        routeType: quote.routeType,
        rateCentsPerMinute: quote.rateCentsPerMinute,
        minimumChargeCents: quote.minimumChargeCents,
        minimumBillableSeconds: quote.minimumBillableSeconds,
        billingIncrementSeconds: quote.billingIncrementSeconds,
        marginMultiple: quote.marginMultiple,
        aiCaptureEnabled: quote.aiCaptureEnabled,
        rateTier,
        rateSettled,
        reason: allowed.reason,
      };
    }

    if (!quote.available || !quote.rateCentsPerMinute) {
      return {
        available: false,
        destinationE164,
        destinationCountry: quote.destinationCountry,
        routeType: quote.routeType,
        rateCentsPerMinute: null,
        minimumChargeCents: null,
        minimumBillableSeconds: quote.minimumBillableSeconds,
        billingIncrementSeconds: quote.billingIncrementSeconds,
        marginMultiple: quote.marginMultiple,
        aiCaptureEnabled: quote.aiCaptureEnabled,
        rateTier,
        rateSettled,
        reason: quote.blockReason ?? "This route is not available for self-serve calling.",
      };
    }

    return {
      available: true,
      destinationE164,
      destinationCountry: quote.destinationCountry,
      routeType: quote.routeType,
      rateCentsPerMinute: quote.rateCentsPerMinute,
      minimumChargeCents: quote.minimumChargeCents,
      minimumBillableSeconds: quote.minimumBillableSeconds,
      billingIncrementSeconds: quote.billingIncrementSeconds,
      marginMultiple: quote.marginMultiple,
      aiCaptureEnabled: quote.aiCaptureEnabled,
      rateTier,
      rateSettled,
      reason: null,
    };
  },
});

export const getFreeCallStatus = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    const eligible = isFreeCallEligibleWallet(wallet);
    return {
      eligible,
      translatedTrialEnabled: translatedTrialEnabled(),
      used: wallet?.freeCallUsed ?? false,
      maxSeconds: getFreeCallMaxSeconds(),
      planEligible: wallet?.planId === "free" && wallet?.subscriptionStatus === "free",
    };
  },
});

export const getTwilioSetupStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkspace(ctx);

    const requiredServerVars = ["TWILIO_CONVEX_WEBHOOK_SECRET"];

    const missingServerVars = requiredServerVars.filter((name) => !process.env[name]);
    const allowedNumbers = getAllowedNumbers();
    const allowedCountries = getAllowedCountries();
    const freeAllowedNumbers = getFreeCallAllowedNumbers();
    const freeAllowedCountries = getFreeCallAllowedCountries();
    const maxCallSeconds = getMaxCallSeconds();

    return {
      enabled: isTwilioCallingEnabled(),
      configured: missingServerVars.length === 0,
      missingServerVars,
      allowedNumbersCount: allowedNumbers.length,
      allowedCountries,
      freeAllowedNumbersCount: freeAllowedNumbers.length,
      freeAllowedCountries,
      hasDestinationAllowlist: allowedNumbers.length > 0 || allowedCountries.length > 0,
      maxCallSeconds,
      freeCallMaxSeconds: getFreeCallMaxSeconds(),
      webhookUrl:
        process.env.TWILIO_WEBHOOK_URL ||
        `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/twilio/voice`,
      statusCallbackUrl:
        process.env.TWILIO_STATUS_CALLBACK_URL ||
        `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/twilio/status`,
    };
  },
});
