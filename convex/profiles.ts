import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { deriveWorkspaceName, validateWorkspaceName } from "../src/lib/workspace-name";
import {
  findProfileForStableUserId,
  findWorkspaceMembershipForStableUserId,
  getCurrentProfile,
  listWorkspaceMembershipsForStableUserId,
  normalizeAuthDisplayName,
  normalizeProfileEmail,
  requireWorkspaceAdmin,
  resolveCurrentProfileIdentity,
  stableUserIdFromSubject,
} from "./authHelpers";

const MAX_PROFILE_DISPLAY_NAME_LENGTH = 80;

function normalizeManualDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function identityProfilePatch(
  existing: NonNullable<Awaited<ReturnType<typeof findProfileForStableUserId>>>,
  identity: NonNullable<Awaited<ReturnType<typeof resolveCurrentProfileIdentity>>>,
  now: number
) {
  const patch: {
    userId?: string;
    email?: string;
    displayName?: string;
    updatedAt?: number;
  } = {};
  const existingDisplayName = normalizeAuthDisplayName(
    existing.displayName,
    existing.email
  );

  if (existing.userId !== identity.userId) {
    patch.userId = identity.userId;
  }
  if (identity.email && existing.email !== identity.email) {
    patch.email = identity.email;
  }
  if (!existingDisplayName && identity.displayName) {
    patch.displayName = identity.displayName;
  }

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = now;
  }

  return patch;
}

export const getProfileById = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await findProfileForStableUserId(ctx, stableUserIdFromSubject(args.userId));
  },
});

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentProfile(ctx);
    return current?.profile ?? null;
  },
});

export const getMyWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentProfile(ctx);
    if (!current) return null;

    const profile = current.profile;
    if (!profile.defaultWorkspaceId) return null;

    const membership = await findWorkspaceMembershipForStableUserId(
      ctx,
      profile.defaultWorkspaceId,
      current.userId
    );

    if (!membership) return null;

    const workspace = await ctx.db.get(profile.defaultWorkspaceId);
    return workspace ?? null;
  },
});

export const getMyMemberships = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await listWorkspaceMembershipsForStableUserId(
      ctx,
      stableUserIdFromSubject(identity.subject)
    );
  },
});

export const createProfileAndWorkspace = mutation({
  args: {
    displayName: v.optional(v.string()),
    paidCheckoutPending: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveCurrentProfileIdentity(ctx);
    if (!identity) return { authPending: true as const };

    const userId = identity.userId;
    const requestedDisplayName = args.displayName
      ? normalizeManualDisplayName(args.displayName).slice(0, MAX_PROFILE_DISPLAY_NAME_LENGTH)
      : undefined;

    const existing = await findProfileForStableUserId(ctx, userId);

    if (existing?.defaultWorkspaceId) {
      const existingMembership = await findWorkspaceMembershipForStableUserId(
        ctx,
        existing.defaultWorkspaceId,
        userId
      );
      if (existingMembership) {
        const now = Date.now();
        const patch = identityProfilePatch(existing, identity, now);
        if (requestedDisplayName && existing.displayName !== requestedDisplayName) {
          patch.displayName = requestedDisplayName;
          patch.updatedAt = now;
        }

        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, patch);
        }
        if (existingMembership.userId !== userId) {
          await ctx.db.patch(existingMembership._id, { userId });
        }
        return {
          authPending: false as const,
          profileId: existing._id,
          workspaceId: existing.defaultWorkspaceId,
        };
      }
    }

    const now = Date.now();
    const email = identity.email || normalizeProfileEmail(existing?.email);
    const displayName =
      requestedDisplayName ||
      normalizeAuthDisplayName(existing?.displayName, email) ||
      identity.displayName;
    const workspaceName = deriveWorkspaceName({ displayName, email });

    const workspaceId = await ctx.db.insert("workspaces", {
      name: workspaceName,
      plan: "free",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("walletSummaries", {
      workspaceId,
      creditBalance: 0,
      currency: "USD",
      usageThisMonth: 0,
      includedMinutes: 0,
      subscriptionStatus: "free",
      planId: "free",
      includedCreditBalanceCents: 0,
      includedCreditGrantedCents: 0,
      topUpCreditBalanceCents: 0,
      reservedCreditCents: 0,
      lifetimeCreditSpendCents: 0,
      businessInvoiceRequested: false,
      autoTopUpEnabled: false,
      autoTopUpThresholdCents: 1000,
      autoTopUpAmountCents: 2500,
      freeCallUsed: false,
      aiFeaturesEnabled: true,
    });

    const profileId = existing
      ? existing._id
      : await ctx.db.insert("profiles", {
          userId,
          email,
          displayName,
          defaultWorkspaceId: workspaceId,
          createdAt: now,
          updatedAt: now,
        });

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        email: email || existing.email,
        displayName: displayName ?? normalizeAuthDisplayName(existing.displayName, email),
        defaultWorkspaceId: workspaceId,
        updatedAt: now,
      });
    }

    await ctx.db.insert("workspaceMemberships", {
      workspaceId,
      userId,
      profileId,
      role: "owner",
      createdAt: now,
    });

    if (!args.paidCheckoutPending) {
      await ctx.scheduler.runAfter(0, internal.emails.scheduleNurtureSequence, {
        userId,
        email,
        workspaceId,
      });
    }

    return { authPending: false as const, profileId, workspaceId };
  },
});

export const syncMyProfileIdentity = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await resolveCurrentProfileIdentity(ctx);
    if (!identity) return { authPending: true as const, updated: false };

    const existing = await findProfileForStableUserId(ctx, identity.userId);
    if (!existing) {
      return { authPending: false as const, updated: false };
    }

    const patch = identityProfilePatch(existing, identity, Date.now());
    if (Object.keys(patch).length === 0) {
      return { authPending: false as const, updated: false };
    }

    await ctx.db.patch(existing._id, patch);
    return { authPending: false as const, updated: true };
  },
});

export const updateMyProfileDisplayName = mutation({
  args: {
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const current = await getCurrentProfile(ctx);
    if (!current) throw new Error("No profile found");

    const displayName = normalizeManualDisplayName(args.displayName);
    if (!displayName) {
      throw new Error("Enter a display name.");
    }
    if (displayName.length > MAX_PROFILE_DISPLAY_NAME_LENGTH) {
      throw new Error("Display name must be 80 characters or fewer.");
    }
    if (displayName.includes("@")) {
      throw new Error("Use a name, not an email address.");
    }

    await ctx.db.patch(current.profile._id, {
      displayName,
      updatedAt: Date.now(),
    });

    return { profileId: current.profile._id, displayName };
  },
});

// The signed-in equivalent of the tokenized /unsubscribe link. Both write the same
// per-person flag, which convex/emails.ts checks before sending any winback_*
// sequence. Transactional mail is unaffected — there is nothing to opt out of when
// the email is answering something you just did.
export const setMyMarketingEmailOptOut = mutation({
  args: {
    optOut: v.boolean(),
  },
  handler: async (ctx, args) => {
    const current = await getCurrentProfile(ctx);
    if (!current) throw new Error("No profile found");

    await ctx.db.patch(current.profile._id, {
      marketingEmailOptOut: args.optOut,
      updatedAt: Date.now(),
    });

    return { optOut: args.optOut };
  },
});

export const renameMyWorkspace = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAdmin(ctx);

    const result = validateWorkspaceName(args.name);
    if (!result.ok) {
      throw new Error(result.error);
    }

    await ctx.db.patch(workspaceId, {
      name: result.value,
      updatedAt: Date.now(),
    });

    return { workspaceId, name: result.value };
  },
});
