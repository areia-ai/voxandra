import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireWorkspace, requireWorkspaceAdmin } from "./authHelpers";
import { normalizePhoneE164 } from "../src/lib/phone";

function assertSecret(secret: string, envName: string) {
  const expected = process.env[envName];
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized calling-number mutation");
  }
}

function cleanLabel(label: string | undefined, fallback: string) {
  const trimmed = label?.trim();
  return trimmed ? trimmed.slice(0, 64) : fallback;
}

function accountCallerIdNumber() {
  return normalizePhoneE164(process.env.TWILIO_CALLER_ID ?? "");
}

async function clearWorkspaceDefaults(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
) {
  const existing = await ctx.db
    .query("callingNumbers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  for (const item of existing) {
    if (item.isDefault) {
      await ctx.db.patch(item._id, { isDefault: false });
    }
  }
}

async function shouldBecomeDefault(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  exceptId?: Id<"callingNumbers">
) {
  const active = await ctx.db
    .query("callingNumbers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return !active.some(
    (item) => item._id !== exceptId && item.status === "active" && item.isDefault
  );
}

export const getCallingNumbers = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const numbers = await ctx.db
      .query("callingNumbers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const hasWorkspaceDefault = numbers.some(
      (number) => number.status === "active" && number.isDefault
    );
    const accountNumber = accountCallerIdNumber();
    const accountOption = accountNumber
      ? [
          {
            id: null,
            phoneNumber: accountNumber,
            label: "Voxandra default",
            source: "twilio_account" as const,
            status: "active" as const,
            isDefault: !hasWorkspaceDefault,
            createdAt: 0,
            updatedAt: 0,
          },
        ]
      : [];

    const ranked = [...numbers].sort((a, b) => {
      const statusRank = (status: string) =>
        status === "active" ? 0 : status.startsWith("pending") ? 1 : 2;
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      return b.updatedAt - a.updatedAt;
    });

    return [
      ...accountOption,
      ...ranked.map((number) => ({
        id: number._id,
        phoneNumber: number.phoneNumber,
        label: number.label,
        source: number.source,
        status: number.status,
        isDefault: number.isDefault,
        twilioValidationCode: number.twilioValidationCode,
        lastVerificationStatus: number.lastVerificationStatus,
        twilioIncomingPhoneNumberSid: number.twilioIncomingPhoneNumberSid,
        stripeSubscriptionId: number.stripeSubscriptionId,
        isoCountry: number.isoCountry,
        region: number.region,
        locality: number.locality,
        rentalPriceCents: number.rentalPriceCents,
        inboundEnabled: number.inboundEnabled ?? false,
        inboundForwardingNumber: number.inboundForwardingNumber,
        inboundRingTimeoutSeconds: number.inboundRingTimeoutSeconds,
        inboundVoicemailEnabled: number.inboundVoicemailEnabled ?? true,
        inboundVoicemailGreeting: number.inboundVoicemailGreeting,
        inboundAiCaptureEnabled: number.inboundAiCaptureEnabled ?? false,
        inboundRecordingComplianceAttested:
          number.inboundRecordingComplianceAttested ?? false,
        inboundRecordingComplianceAttestedAt: number.inboundRecordingComplianceAttestedAt,
        inboundSettingsUpdatedAt: number.inboundSettingsUpdatedAt,
        errorMessage: number.errorMessage,
        createdAt: number.createdAt,
        updatedAt: number.updatedAt,
        releasedAt: number.releasedAt,
      })),
    ];
  },
});

export const updateInboundSettings = mutation({
  args: {
    callingNumberId: v.id("callingNumbers"),
    inboundEnabled: v.boolean(),
    inboundForwardingNumber: v.optional(v.string()),
    inboundRingTimeoutSeconds: v.optional(v.number()),
    inboundVoicemailEnabled: v.boolean(),
    inboundVoicemailGreeting: v.optional(v.string()),
    inboundAiCaptureEnabled: v.boolean(),
    inboundRecordingComplianceAttested: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId, profile } = await requireWorkspaceAdmin(ctx);
    const number = await ctx.db.get(args.callingNumberId);
    if (!number || number.workspaceId !== workspaceId) {
      throw new Error("Calling number not found");
    }
    if (number.source !== "rented") {
      throw new Error("Inbound calls are only available on rented Voxandra numbers.");
    }
    if (number.status !== "active") {
      throw new Error("Only active rented numbers can receive inbound calls.");
    }

    const forwardingNumber = normalizePhoneE164(args.inboundForwardingNumber ?? "");
    if (args.inboundEnabled && !forwardingNumber) {
      throw new Error("Add a forwarding number before enabling inbound calls.");
    }
    if (args.inboundAiCaptureEnabled && !args.inboundRecordingComplianceAttested) {
      throw new Error(
        "Confirm recording and transcription compliance before enabling AI capture."
      );
    }

    const timeout = Math.min(
      60,
      Math.max(10, Math.floor(args.inboundRingTimeoutSeconds ?? 25))
    );
    const greeting =
      args.inboundVoicemailGreeting?.trim().slice(0, 240) ||
      "Please leave a message after the tone. The team will follow up.";
    const now = Date.now();
    const attestationWasAdded =
      args.inboundRecordingComplianceAttested &&
      !number.inboundRecordingComplianceAttested;

    await ctx.db.patch(number._id, {
      inboundEnabled: args.inboundEnabled,
      inboundForwardingNumber: forwardingNumber || undefined,
      inboundRingTimeoutSeconds: timeout,
      inboundVoicemailEnabled: args.inboundVoicemailEnabled,
      inboundVoicemailGreeting: greeting,
      inboundAiCaptureEnabled: args.inboundAiCaptureEnabled,
      inboundRecordingComplianceAttested: args.inboundRecordingComplianceAttested,
      inboundRecordingComplianceAttestedAt: attestationWasAdded
        ? now
        : number.inboundRecordingComplianceAttestedAt,
      inboundRecordingComplianceAttestedByUserId: attestationWasAdded
        ? userId
        : number.inboundRecordingComplianceAttestedByUserId,
      inboundRecordingComplianceAttestedByProfileId: attestationWasAdded
        ? profile._id
        : number.inboundRecordingComplianceAttestedByProfileId,
      inboundSettingsUpdatedAt: now,
      updatedAt: now,
    });

    return { updated: true };
  },
});

export const setDefaultCallingNumber = mutation({
  args: { callingNumberId: v.optional(v.id("callingNumbers")) },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);

    if (args.callingNumberId) {
      const number = await ctx.db.get(args.callingNumberId);
      if (!number || number.workspaceId !== workspaceId) {
        throw new Error("Calling number not found");
      }
      if (number.status !== "active") {
        throw new Error("Only active calling numbers can be made default.");
      }
      await clearWorkspaceDefaults(ctx, workspaceId);
      await ctx.db.patch(number._id, { isDefault: true, updatedAt: Date.now() });
      return { defaultCallingNumberId: number._id };
    }

    await clearWorkspaceDefaults(ctx, workspaceId);
    return { defaultCallingNumberId: null };
  },
});

export const recordVerificationStarted = mutation({
  args: {
    phoneNumber: v.string(),
    label: v.optional(v.string()),
    twilioValidationCode: v.string(),
    twilioValidationCallSid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const phoneNumber = normalizePhoneE164(args.phoneNumber);
    if (!phoneNumber) throw new Error("Enter a valid phone number.");

    const now = Date.now();
    const existing = await ctx.db
      .query("callingNumbers")
      .withIndex("by_workspace_number", (q) =>
        q.eq("workspaceId", workspaceId).eq("phoneNumber", phoneNumber)
      )
      .first();

    if (existing?.status === "active") {
      await ctx.db.patch(existing._id, {
        label: cleanLabel(args.label, existing.label),
        updatedAt: now,
      });
      return existing._id;
    }

    const patch = {
      label: cleanLabel(args.label, "Verified number"),
      source: "verified_external" as const,
      status: "pending_verification" as const,
      twilioValidationCode: args.twilioValidationCode,
      twilioValidationCallSid: args.twilioValidationCallSid,
      lastVerificationStatus: undefined,
      errorMessage: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("callingNumbers", {
      workspaceId,
      phoneNumber,
      ...patch,
      isDefault: false,
      createdAt: now,
    });
  },
});

export const recordVerificationResult = mutation({
  args: {
    secret: v.string(),
    verificationStatus: v.string(),
    outgoingCallerIdSid: v.optional(v.string()),
    callSid: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertSecret(args.secret, "TWILIO_CONVEX_WEBHOOK_SECRET");

    const normalizedPhone = args.phoneNumber
      ? normalizePhoneE164(args.phoneNumber)
      : "";

    let number =
      args.callSid
        ? await ctx.db
            .query("callingNumbers")
            .withIndex("by_twilio_validation_call_sid", (q) =>
              q.eq("twilioValidationCallSid", args.callSid)
            )
            .first()
        : null;

    if (!number && normalizedPhone) {
      const candidates = await ctx.db.query("callingNumbers").collect();
      number =
        candidates.find(
          (item) =>
            item.phoneNumber === normalizedPhone &&
            item.source === "verified_external" &&
            item.status === "pending_verification"
        ) ?? null;
    }

    if (!number) return { updated: false };

    const now = Date.now();
    if (args.verificationStatus === "success") {
      const makeDefault = await shouldBecomeDefault(ctx, number.workspaceId, number._id);
      if (makeDefault) await clearWorkspaceDefaults(ctx, number.workspaceId);
      await ctx.db.patch(number._id, {
        status: "active",
        twilioOutgoingCallerIdSid: args.outgoingCallerIdSid ?? number.twilioOutgoingCallerIdSid,
        twilioValidationCode: undefined,
        lastVerificationStatus: args.verificationStatus,
        isDefault: makeDefault || number.isDefault,
        errorMessage: undefined,
        updatedAt: now,
      });
      return { updated: true, status: "active" as const };
    }

    await ctx.db.patch(number._id, {
      status: "verification_failed",
      twilioValidationCode: undefined,
      lastVerificationStatus: args.verificationStatus,
      errorMessage: "Twilio could not verify this caller ID.",
      updatedAt: now,
    });
    return { updated: true, status: "verification_failed" as const };
  },
});

export const recordRentedNumberCheckoutStarted = mutation({
  args: {
    phoneNumber: v.string(),
    label: v.optional(v.string()),
    stripeCustomerId: v.string(),
    stripeCheckoutSessionId: v.string(),
    stripePriceId: v.string(),
    rentalPriceCents: v.number(),
    isoCountry: v.string(),
    region: v.optional(v.string()),
    locality: v.optional(v.string()),
    addressRequirements: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const phoneNumber = normalizePhoneE164(args.phoneNumber);
    if (!phoneNumber) throw new Error("Enter a valid phone number.");

    const now = Date.now();
    const existing = await ctx.db
      .query("callingNumbers")
      .withIndex("by_workspace_number", (q) =>
        q.eq("workspaceId", workspaceId).eq("phoneNumber", phoneNumber)
      )
      .first();

    if (existing && existing.status === "active") {
      throw new Error("This number is already active in the workspace.");
    }

    const patch = {
      label: cleanLabel(args.label, "Rented number"),
      source: "rented" as const,
      status: "pending_purchase" as const,
      stripeCustomerId: args.stripeCustomerId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripePriceId: args.stripePriceId,
      rentalPriceCents: args.rentalPriceCents,
      isoCountry: args.isoCountry,
      region: args.region,
      locality: args.locality,
      addressRequirements: args.addressRequirements,
      errorMessage: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("callingNumbers", {
      workspaceId,
      phoneNumber,
      ...patch,
      isDefault: false,
      createdAt: now,
    });
  },
});

export const getCallingNumberProvisioningState = query({
  args: {
    secret: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertSecret(args.secret, "STRIPE_CONVEX_WEBHOOK_SECRET");

    if (args.stripeCheckoutSessionId) {
      const byCheckout = await ctx.db
        .query("callingNumbers")
        .withIndex("by_stripe_checkout_session", (q) =>
          q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId)
        )
        .first();
      if (byCheckout) return byCheckout;
    }

    if (args.stripeSubscriptionId) {
      return await ctx.db
        .query("callingNumbers")
        .withIndex("by_stripe_subscription", (q) =>
          q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
        )
        .first();
    }

    return null;
  },
});

export const recordRentedNumberProvisioned = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    phoneNumber: v.string(),
    label: v.optional(v.string()),
    twilioIncomingPhoneNumberSid: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripeSubscriptionItemId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    rentalPriceCents: v.optional(v.number()),
    isoCountry: v.optional(v.string()),
    region: v.optional(v.string()),
    locality: v.optional(v.string()),
    addressRequirements: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertSecret(args.secret, "STRIPE_CONVEX_WEBHOOK_SECRET");

    const phoneNumber = normalizePhoneE164(args.phoneNumber);
    const now = Date.now();
    let number = args.stripeCheckoutSessionId
      ? await ctx.db
          .query("callingNumbers")
          .withIndex("by_stripe_checkout_session", (q) =>
            q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId)
          )
          .first()
      : null;

    if (!number) {
      number = await ctx.db
        .query("callingNumbers")
        .withIndex("by_workspace_number", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("phoneNumber", phoneNumber)
        )
        .first();
    }

    const makeDefault = await shouldBecomeDefault(ctx, args.workspaceId, number?._id);
    if (makeDefault) await clearWorkspaceDefaults(ctx, args.workspaceId);

    const patch = {
      label: cleanLabel(args.label, number?.label ?? "Rented number"),
      source: "rented" as const,
      status: "active" as const,
      isDefault: makeDefault || number?.isDefault || false,
      twilioIncomingPhoneNumberSid: args.twilioIncomingPhoneNumberSid,
      stripeCheckoutSessionId:
        args.stripeCheckoutSessionId ?? number?.stripeCheckoutSessionId,
      stripeSubscriptionId: args.stripeSubscriptionId ?? number?.stripeSubscriptionId,
      stripeSubscriptionItemId:
        args.stripeSubscriptionItemId ?? number?.stripeSubscriptionItemId,
      stripeCustomerId: args.stripeCustomerId ?? number?.stripeCustomerId,
      stripePriceId: args.stripePriceId ?? number?.stripePriceId,
      rentalPriceCents: args.rentalPriceCents ?? number?.rentalPriceCents,
      isoCountry: args.isoCountry ?? number?.isoCountry,
      region: args.region ?? number?.region,
      locality: args.locality ?? number?.locality,
      addressRequirements: args.addressRequirements ?? number?.addressRequirements,
      errorMessage: undefined,
      updatedAt: now,
    };

    if (number) {
      await ctx.db.patch(number._id, patch);
      return number._id;
    }

    return await ctx.db.insert("callingNumbers", {
      workspaceId: args.workspaceId,
      phoneNumber,
      ...patch,
      createdAt: now,
    });
  },
});

export const recordRentedNumberProvisioningFailed = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    phoneNumber: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    assertSecret(args.secret, "STRIPE_CONVEX_WEBHOOK_SECRET");
    const phoneNumber = normalizePhoneE164(args.phoneNumber);
    const now = Date.now();
    const number = args.stripeCheckoutSessionId
      ? await ctx.db
          .query("callingNumbers")
          .withIndex("by_stripe_checkout_session", (q) =>
            q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId)
          )
          .first()
      : await ctx.db
          .query("callingNumbers")
          .withIndex("by_workspace_number", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("phoneNumber", phoneNumber)
          )
          .first();

    if (number) {
      await ctx.db.patch(number._id, {
        status: "purchase_failed",
        errorMessage: args.errorMessage.slice(0, 500),
        updatedAt: now,
      });
      return { updated: true };
    }

    await ctx.db.insert("callingNumbers", {
      workspaceId: args.workspaceId,
      phoneNumber,
      label: "Rented number",
      source: "rented",
      status: "purchase_failed",
      isDefault: false,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      errorMessage: args.errorMessage.slice(0, 500),
      createdAt: now,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const markRentedNumberCancellationRequested = mutation({
  args: { callingNumberId: v.id("callingNumbers") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const number = await ctx.db.get(args.callingNumberId);
    if (!number || number.workspaceId !== workspaceId) {
      throw new Error("Calling number not found");
    }
    if (number.source !== "rented") {
      throw new Error("Only rented numbers can be canceled.");
    }
    if (!["active", "release_failed"].includes(number.status)) {
      throw new Error("This rented number is not active.");
    }

    await ctx.db.patch(number._id, {
      status: "pending_release",
      isDefault: false,
      updatedAt: Date.now(),
    });

    return {
      stripeSubscriptionId: number.stripeSubscriptionId,
      twilioIncomingPhoneNumberSid: number.twilioIncomingPhoneNumberSid,
      phoneNumber: number.phoneNumber,
    };
  },
});

export const recordRentedNumberReleased = mutation({
  args: {
    secret: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    twilioIncomingPhoneNumberSid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertSecret(args.secret, "STRIPE_CONVEX_WEBHOOK_SECRET");

    let number = args.stripeSubscriptionId
      ? await ctx.db
          .query("callingNumbers")
          .withIndex("by_stripe_subscription", (q) =>
            q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
          )
          .first()
      : null;

    if (!number && args.twilioIncomingPhoneNumberSid) {
      number = await ctx.db
        .query("callingNumbers")
        .withIndex("by_twilio_incoming_sid", (q) =>
          q.eq("twilioIncomingPhoneNumberSid", args.twilioIncomingPhoneNumberSid)
        )
        .first();
    }

    if (!number) return { updated: false };

    const now = Date.now();
    await ctx.db.patch(number._id, {
      status: "released",
      isDefault: false,
      releasedAt: now,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const recordRentedNumberReleaseFailed = mutation({
  args: {
    secret: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    twilioIncomingPhoneNumberSid: v.optional(v.string()),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    assertSecret(args.secret, "STRIPE_CONVEX_WEBHOOK_SECRET");

    let number = args.stripeSubscriptionId
      ? await ctx.db
          .query("callingNumbers")
          .withIndex("by_stripe_subscription", (q) =>
            q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
          )
          .first()
      : null;

    if (!number && args.twilioIncomingPhoneNumberSid) {
      number = await ctx.db
        .query("callingNumbers")
        .withIndex("by_twilio_incoming_sid", (q) =>
          q.eq("twilioIncomingPhoneNumberSid", args.twilioIncomingPhoneNumberSid)
        )
        .first();
    }

    if (!number) return { updated: false };

    await ctx.db.patch(number._id, {
      status: "release_failed",
      errorMessage: args.errorMessage.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});
