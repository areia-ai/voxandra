import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  findProfileForStableUserId,
  findWorkspaceMembershipForStableUserId,
  requireWorkspaceAdmin,
  requireWorkspaceMembership,
  requireWorkspaceOwner,
  resolveCurrentProfileIdentity,
} from "./authHelpers";
import { SUBSCRIPTION_PLANS, getSubscriptionPlan } from "../src/lib/billing/config";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A seat ceiling with no named way past it is a dead end: the old message said
// only "reached its N-seat plan limit". Point at the cheapest plan that actually
// has more seats, or at Enterprise once no published plan does.
function seatLimitMessage(seatLimit: number) {
  const nextPlan = Object.values(SUBSCRIPTION_PLANS)
    .filter((plan) => plan.includedSeats > seatLimit)
    .sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents)[0];

  if (!nextPlan) {
    return `This workspace has reached its ${seatLimit}-seat plan limit. Talk to us about Enterprise for more than ${seatLimit} seats.`;
  }

  const price = `$${Math.round(nextPlan.monthlyPriceCents / 100)}/mo`;
  return `This workspace has reached its ${seatLimit}-seat plan limit. ${nextPlan.name} includes ${nextPlan.includedSeats} seats for ${price}.`;
}

type InviteRole = "admin" | "member";
type MembershipRole = Doc<"workspaceMemberships">["role"];
type DbCtx = QueryCtx | MutationCtx;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertValidEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createInviteToken() {
  if (typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function appUrl() {
  return (
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://voxandra.com"
  ).replace(/\/$/, "");
}

function inviteUrl(token: string) {
  return `${appUrl()}/join/${encodeURIComponent(token)}`;
}

function roleLabel(role: MembershipRole | InviteRole) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

function profileLabel(profile: Doc<"profiles"> | null | undefined) {
  return profile?.displayName || profile?.email?.split("@")[0] || "Teammate";
}

async function getSeatPlan(ctx: DbCtx, workspaceId: Id<"workspaces">) {
  const [workspace, wallet] = await Promise.all([
    ctx.db.get(workspaceId),
    ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first(),
  ]);
  const planId = wallet?.planId ?? workspace?.plan ?? "free";
  const plan = getSubscriptionPlan(planId);

  return {
    planId,
    planName:
      plan?.name ??
      (planId === "calls_only" ? "Calls only" : planId === "free" ? "Free" : "Current plan"),
    seatLimit: plan?.includedSeats ?? 1,
  };
}

async function getWorkspaceMembers(ctx: DbCtx, workspaceId: Id<"workspaces">) {
  return await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
}

async function getPendingInvites(ctx: DbCtx, workspaceId: Id<"workspaces">, now = Date.now()) {
  const invitations = await ctx.db
    .query("workspaceInvitations")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return invitations.filter(
    (invite: Doc<"workspaceInvitations">) =>
      invite.status === "pending" && invite.expiresAt > now
  );
}

async function getSeatUsage(ctx: DbCtx, workspaceId: Id<"workspaces">, now = Date.now()) {
  const [members, pendingInvites] = await Promise.all([
    getWorkspaceMembers(ctx, workspaceId),
    getPendingInvites(ctx, workspaceId, now),
  ]);
  return {
    members,
    pendingInvites,
    usedSeats: members.length + pendingInvites.length,
  };
}

async function findProfileByEmail(ctx: DbCtx, email: string) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
}

export const getMyWorkspaceRole = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireWorkspaceMembership(ctx);
    return membership.role;
  },
});

export const getTeamSummary = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId, membership: currentMembership } =
      await requireWorkspaceMembership(ctx);
    const now = Date.now();
    const [workspace, seatPlan, usage] = await Promise.all([
      ctx.db.get(workspaceId),
      getSeatPlan(ctx, workspaceId),
      getSeatUsage(ctx, workspaceId, now),
    ]);

    const profileIds = usage.members.map((member) => member.profileId);
    const profiles = await Promise.all(profileIds.map((profileId) => ctx.db.get(profileId)));
    const profileById = new Map(profiles.filter(Boolean).map((profile) => [profile!._id, profile!]));
    const pendingInvites = usage.pendingInvites.sort((a, b) => b.createdAt - a.createdAt);
    const canInvite = currentMembership.role === "owner" || currentMembership.role === "admin";

    return {
      workspaceName: workspace?.name ?? "Workspace",
      currentUserRole: currentMembership.role,
      canInvite,
      canManageAdmins: currentMembership.role === "owner",
      planId: seatPlan.planId,
      planName: seatPlan.planName,
      seatLimit: seatPlan.seatLimit,
      usedSeats: usage.usedSeats,
      activeMemberCount: usage.members.length,
      pendingInviteCount: pendingInvites.length,
      members: usage.members
        .map((member) => {
          const profile = profileById.get(member.profileId) ?? null;
          return {
            membershipId: member._id,
            profileId: member.profileId,
            userId: member.userId,
            email: profile?.email ?? "",
            displayName: profile?.displayName ?? null,
            label: profileLabel(profile),
            role: member.role,
            roleLabel: roleLabel(member.role),
            joinedAt: member.createdAt,
            isCurrentUser: member._id === currentMembership._id,
          };
        })
        .sort((a, b) => {
          const order: Record<MembershipRole, number> = {
            owner: 0,
            admin: 1,
            member: 2,
            viewer: 3,
          };
          if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
          return a.label.localeCompare(b.label);
        }),
      pendingInvites: pendingInvites.map((invite) => ({
        invitationId: invite._id,
        email: invite.email,
        role: invite.role,
        roleLabel: roleLabel(invite.role),
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        emailDeliveryStatus: invite.emailDeliveryStatus,
        emailError: invite.emailError ?? null,
      })),
    };
  },
});

export const createInvitation = mutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { workspaceId, membership, profile, userId } = await requireWorkspaceAdmin(ctx);
    const email = normalizeEmail(args.email);
    assertValidEmail(email);
    if (args.role === "admin" && membership.role !== "owner") {
      throw new Error("Only the owner can invite admins.");
    }

    const now = Date.now();
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const existingProfile = await findProfileByEmail(ctx, email);
    if (existingProfile) {
      const existingMembership = await ctx.db
        .query("workspaceMemberships")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", existingProfile.userId)
        )
        .first();
      if (existingMembership) {
        throw new Error("That person is already a member of this workspace.");
      }
    }

    const pendingForEmail = (
      await ctx.db
        .query("workspaceInvitations")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", workspaceId).eq("email", email)
        )
        .collect()
    ).find((invite) => invite.status === "pending" && invite.expiresAt > now);
    if (pendingForEmail?.role === "admin" && membership.role !== "owner") {
      throw new Error("Only the owner can modify admin invites.");
    }

    const { seatLimit } = await getSeatPlan(ctx, workspaceId);
    const { usedSeats } = await getSeatUsage(ctx, workspaceId, now);
    if (!pendingForEmail && usedSeats >= seatLimit) {
      throw new Error(seatLimitMessage(seatLimit));
    }

    const token = createInviteToken();
    const tokenHash = await sha256(token);
    const expiresAt = now + INVITE_TTL_MS;
    let invitationId: Id<"workspaceInvitations">;
    if (pendingForEmail) {
      invitationId = pendingForEmail._id;
      await ctx.db.patch(pendingForEmail._id, {
        role: args.role,
        tokenHash,
        invitedByUserId: userId,
        invitedByProfileId: profile._id,
        updatedAt: now,
        expiresAt,
        emailDeliveryStatus: "pending",
        emailError: undefined,
      });
    } else {
      invitationId = await ctx.db.insert("workspaceInvitations", {
        workspaceId,
        email,
        role: args.role,
        tokenHash,
        status: "pending",
        invitedByUserId: userId,
        invitedByProfileId: profile._id,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        emailDeliveryStatus: "pending",
      });
    }

    const url = inviteUrl(token);

    await ctx.scheduler.runAfter(0, internal.emails.sendWorkspaceInviteEmail, {
      invitationId,
      to: email,
      inviteUrl: url,
      inviterName: profileLabel(profile),
      workspaceName: workspace.name,
      roleLabel: roleLabel(args.role),
    });

    return {
      invitationId,
      email,
      role: args.role,
      roleLabel: roleLabel(args.role),
      workspaceName: workspace.name,
      inviterName: profileLabel(profile),
      expiresAt,
      inviteUrl: url,
    };
  },
});

export const resendInvitation = mutation({
  args: {
    invitationId: v.id("workspaceInvitations"),
  },
  handler: async (ctx, args) => {
    const { workspaceId, membership, profile, userId } = await requireWorkspaceAdmin(ctx);
    const invite = await ctx.db.get(args.invitationId);
    if (!invite || invite.workspaceId !== workspaceId || invite.status !== "pending") {
      throw new Error("Invite not found.");
    }
    if (invite.expiresAt <= Date.now()) {
      await ctx.db.patch(invite._id, { status: "expired", updatedAt: Date.now() });
      throw new Error("This invite has expired.");
    }
    if (invite.role === "admin" && membership.role !== "owner") {
      throw new Error("Only the owner can resend admin invites.");
    }

    const token = createInviteToken();
    const tokenHash = await sha256(token);
    const now = Date.now();
    const workspace = await ctx.db.get(workspaceId);
    const expiresAt = now + INVITE_TTL_MS;
    await ctx.db.patch(invite._id, {
      tokenHash,
      invitedByUserId: userId,
      invitedByProfileId: profile._id,
      updatedAt: now,
      expiresAt,
      emailDeliveryStatus: "pending",
      emailError: undefined,
    });
    const url = inviteUrl(token);

    await ctx.scheduler.runAfter(0, internal.emails.sendWorkspaceInviteEmail, {
      invitationId: invite._id,
      to: invite.email,
      inviteUrl: url,
      inviterName: profileLabel(profile),
      workspaceName: workspace?.name ?? "Workspace",
      roleLabel: roleLabel(invite.role),
    });

    return {
      invitationId: invite._id,
      email: invite.email,
      role: invite.role,
      roleLabel: roleLabel(invite.role),
      workspaceName: workspace?.name ?? "Workspace",
      inviterName: profileLabel(profile),
      expiresAt,
      inviteUrl: url,
    };
  },
});

export const markInvitationEmailDelivery = internalMutation({
  args: {
    invitationId: v.id("workspaceInvitations"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) return;
    await ctx.db.patch(args.invitationId, {
      emailDeliveryStatus: args.status,
      emailSentAt: args.status === "sent" || args.status === "skipped" ? Date.now() : invitation.emailSentAt,
      emailError: args.error,
      updatedAt: Date.now(),
    });
  },
});

export const acceptInvitation = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await resolveCurrentProfileIdentity(ctx);
    if (!identity) throw new Error("Not authenticated");

    const email = normalizeEmail(identity.email);
    if (!email) throw new Error("Your account needs an email address to accept this invite.");
    const userId = identity.userId;

    const tokenHash = await sha256(args.token);
    const invite = await ctx.db
      .query("workspaceInvitations")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!invite || invite.status !== "pending") {
      throw new Error("This invite is no longer valid.");
    }

    const now = Date.now();
    if (invite.expiresAt <= now) {
      await ctx.db.patch(invite._id, { status: "expired", updatedAt: now });
      throw new Error("This invite has expired.");
    }

    if (invite.email !== email) {
      throw new Error(`This invite was sent to ${invite.email}. Sign in with that email to join.`);
    }

    const workspace = await ctx.db.get(invite.workspaceId);
    if (!workspace) throw new Error("Workspace not found.");

    let profile = await findProfileForStableUserId(ctx, userId);

    const existingMembership = await findWorkspaceMembershipForStableUserId(
      ctx,
      invite.workspaceId,
      userId
    );

    if (!existingMembership) {
      const { seatLimit } = await getSeatPlan(ctx, invite.workspaceId);
      const activeMembers = await getWorkspaceMembers(ctx, invite.workspaceId);
      if (activeMembers.length >= seatLimit) {
        throw new Error(seatLimitMessage(seatLimit));
      }
    }

    if (!profile) {
      const profileId = await ctx.db.insert("profiles", {
        userId,
        email,
        displayName: identity.displayName,
        defaultWorkspaceId: invite.workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      profile = (await ctx.db.get(profileId))!;
    } else {
      await ctx.db.patch(profile._id, {
        userId,
        email,
        displayName: profile.displayName ?? identity.displayName,
        defaultWorkspaceId: invite.workspaceId,
        updatedAt: now,
      });
    }

    if (!existingMembership) {
      await ctx.db.insert("workspaceMemberships", {
        workspaceId: invite.workspaceId,
        userId,
        profileId: profile._id,
        role: invite.role,
        createdAt: now,
      });
    } else if (existingMembership.userId !== userId) {
      await ctx.db.patch(existingMembership._id, { userId });
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: now,
      acceptedByProfileId: profile._id,
      updatedAt: now,
    });

    return {
      workspaceId: invite.workspaceId,
      workspaceName: workspace.name,
      role: existingMembership?.role ?? invite.role,
      roleLabel: roleLabel(existingMembership?.role ?? invite.role),
    };
  },
});

export const revokeInvitation = mutation({
  args: {
    invitationId: v.id("workspaceInvitations"),
  },
  handler: async (ctx, args) => {
    const { workspaceId, membership, profile } = await requireWorkspaceAdmin(ctx);
    const invite = await ctx.db.get(args.invitationId);
    if (!invite || invite.workspaceId !== workspaceId || invite.status !== "pending") {
      throw new Error("Invite not found.");
    }
    if (invite.role === "admin" && membership.role !== "owner") {
      throw new Error("Only the owner can revoke admin invites.");
    }
    await ctx.db.patch(invite._id, {
      status: "revoked",
      revokedAt: Date.now(),
      revokedByProfileId: profile._id,
      updatedAt: Date.now(),
    });
    return { revoked: true };
  },
});

export const updateMemberRole = mutation({
  args: {
    membershipId: v.id("workspaceMemberships"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceOwner(ctx);
    const member = await ctx.db.get(args.membershipId);
    if (!member || member.workspaceId !== workspaceId) throw new Error("Member not found.");
    if (member.role === "owner") throw new Error("Owner role cannot be changed in v1.");
    await ctx.db.patch(member._id, { role: args.role });
    return { updated: true };
  },
});

export const removeMember = mutation({
  args: {
    membershipId: v.id("workspaceMemberships"),
  },
  handler: async (ctx, args) => {
    const { workspaceId, membership: requester } = await requireWorkspaceAdmin(ctx);
    const member = await ctx.db.get(args.membershipId);
    if (!member || member.workspaceId !== workspaceId) throw new Error("Member not found.");
    if (member._id === requester._id) throw new Error("You cannot remove yourself.");
    if (member.role === "owner") throw new Error("The owner cannot be removed in v1.");
    if (requester.role === "admin" && member.role !== "member") {
      throw new Error("Admins can only remove members.");
    }

    await ctx.db.delete(member._id);

    const profile = await ctx.db.get(member.profileId);
    if (profile?.defaultWorkspaceId === workspaceId) {
      const nextMembership = await ctx.db
        .query("workspaceMemberships")
        .withIndex("by_user", (q) => q.eq("userId", member.userId))
        .first();
      await ctx.db.patch(profile._id, {
        defaultWorkspaceId: nextMembership?.workspaceId,
        updatedAt: Date.now(),
      });
    }

    return { removed: true };
  },
});
