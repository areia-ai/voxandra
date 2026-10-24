import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

export type AuthCtx = QueryCtx | MutationCtx;
export type WorkspaceRole = Doc<"workspaceMemberships">["role"];

export type WorkspaceAccess = {
  userId: string;
  profile: Doc<"profiles">;
  workspaceId: Id<"workspaces">;
  membership: Doc<"workspaceMemberships">;
};

export type CurrentProfileIdentity = {
  userId: string;
  email: string;
  displayName?: string;
};

const ADMIN_ROLES = new Set<WorkspaceRole>(["owner", "admin"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const MAX_PROFILE_DISPLAY_NAME_LENGTH = 80;

export function stableUserIdFromSubject(subject: string) {
  return subject.split("|")[0] || subject;
}

export function normalizeProfileEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeAuthDisplayName(value: unknown, email: string) {
  const displayName =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!displayName) return undefined;

  const normalizedEmail = normalizeProfileEmail(email);
  const normalizedDisplayName = displayName.toLowerCase();
  if (normalizedEmail && normalizedDisplayName === normalizedEmail) {
    return undefined;
  }
  if (displayName.includes("@")) {
    return undefined;
  }

  return displayName.slice(0, MAX_PROFILE_DISPLAY_NAME_LENGTH);
}

export async function resolveCurrentProfileIdentity(
  ctx: AuthCtx
): Promise<CurrentProfileIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const userId = stableUserIdFromSubject(identity.subject);
  let authUser: Doc<"users"> | null = null;

  try {
    authUser = await ctx.db.get(userId as Id<"users">);
  } catch {
    authUser = null;
  }

  const email = normalizeProfileEmail(authUser?.email || identity.email);
  const displayName = normalizeAuthDisplayName(authUser?.name || identity.name, email);

  return { userId, email, displayName };
}

function userIdMatchesStableUser(userId: string, stableUserId: string) {
  return userId === stableUserId || userId.startsWith(`${stableUserId}|`);
}

async function getWorkspacePlanScore(ctx: AuthCtx, workspaceId: Id<"workspaces"> | undefined) {
  if (!workspaceId) return 0;

  const [workspace, wallet] = await Promise.all([
    ctx.db.get(workspaceId),
    ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first(),
  ]);

  if (
    wallet?.planId &&
    wallet.planId !== "free" &&
    wallet.planId !== "calls_only" &&
    ACTIVE_SUBSCRIPTION_STATUSES.has(wallet.subscriptionStatus)
  ) {
    return 100;
  }
  if (wallet?.planId && wallet.planId !== "free" && wallet.planId !== "calls_only") {
    return 50;
  }
  if (workspace?.plan && workspace.plan !== "free" && workspace.plan !== "calls_only") {
    return 25;
  }
  return 0;
}

export async function findProfileForStableUserId(
  ctx: AuthCtx,
  stableUserId: string
): Promise<Doc<"profiles"> | null> {
  const profiles = (await ctx.db.query("profiles").collect()).filter((profile) =>
    userIdMatchesStableUser(profile.userId, stableUserId)
  );

  if (profiles.length === 0) return null;
  if (profiles.length === 1) return profiles[0];

  const scoredProfiles = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      score:
        (await getWorkspacePlanScore(ctx, profile.defaultWorkspaceId)) +
        (profile.userId === stableUserId ? 10 : 0),
    }))
  );

  scoredProfiles.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.profile._creationTime - b.profile._creationTime;
  });

  return scoredProfiles[0]?.profile ?? null;
}

export async function findWorkspaceMembershipForStableUserId(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  stableUserId: string
): Promise<Doc<"workspaceMemberships"> | null> {
  const exactMembership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", stableUserId)
    )
    .first();

  if (exactMembership) return exactMembership;

  const memberships = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  return (
    memberships.find((membership) =>
      userIdMatchesStableUser(membership.userId, stableUserId)
    ) ?? null
  );
}

export async function listWorkspaceMembershipsForStableUserId(
  ctx: AuthCtx,
  stableUserId: string
) {
  const memberships = (await ctx.db.query("workspaceMemberships").collect()).filter(
    (membership) => userIdMatchesStableUser(membership.userId, stableUserId)
  );
  const uniqueMemberships = new Map<Id<"workspaceMemberships">, Doc<"workspaceMemberships">>();
  for (const membership of memberships) {
    uniqueMemberships.set(membership._id, membership);
  }
  return [...uniqueMemberships.values()];
}

export async function getCurrentStableUserId(ctx: AuthCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return stableUserIdFromSubject(identity.subject);
}

export async function getCurrentWorkspaceId(ctx: AuthCtx): Promise<Id<"workspaces"> | null> {
  const current = await getCurrentProfile(ctx);
  if (!current?.profile.defaultWorkspaceId) return null;

  const membership = await findWorkspaceMembershipForStableUserId(
    ctx,
    current.profile.defaultWorkspaceId,
    current.userId
  );

  return membership ? current.profile.defaultWorkspaceId : null;
}

export async function getCurrentProfile(
  ctx: AuthCtx
): Promise<{ userId: string; profile: Doc<"profiles"> } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const userId = stableUserIdFromSubject(identity.subject);
  const profile = await findProfileForStableUserId(ctx, userId);

  if (!profile) return null;
  return { userId, profile };
}

export async function requireAuth(ctx: AuthCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return stableUserIdFromSubject(identity.subject);
}

export async function requireWorkspaceMembership(ctx: AuthCtx): Promise<WorkspaceAccess> {
  const current = await getCurrentProfile(ctx);
  if (!current) throw new Error("No profile found");

  const workspaceId = current.profile.defaultWorkspaceId as Id<"workspaces"> | undefined;
  if (!workspaceId) throw new Error("No workspace found");

  const membership = await findWorkspaceMembershipForStableUserId(
    ctx,
    workspaceId,
    current.userId
  );

  if (!membership) throw new Error("Workspace access denied");

  return {
    userId: current.userId,
    profile: current.profile,
    workspaceId,
    membership,
  };
}

export async function requireWorkspace(ctx: AuthCtx): Promise<Id<"workspaces">> {
  const { workspaceId } = await requireWorkspaceMembership(ctx);
  return workspaceId;
}

export async function requireWorkspaceAdmin(ctx: AuthCtx): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceMembership(ctx);
  if (!ADMIN_ROLES.has(access.membership.role)) {
    throw new Error("Workspace admin access required");
  }
  return access;
}

export async function requireWorkspaceOwner(ctx: AuthCtx): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceMembership(ctx);
  if (access.membership.role !== "owner") {
    throw new Error("Workspace owner access required");
  }
  return access;
}

export async function verifyWorkspaceAccess(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">
): Promise<boolean> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return false;
  const userId = stableUserIdFromSubject(identity.subject);

  const membership = await findWorkspaceMembershipForStableUserId(ctx, workspaceId, userId);

  return !!membership;
}
