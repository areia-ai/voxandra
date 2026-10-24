import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceMembership } from "./authHelpers";
import {
  FEEDBACK_ACTIVE_SUBSCRIPTION_STATUSES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_PAID_PLAN_IDS,
  canParticipateInFeedback,
} from "../src/lib/feedback";

const feedbackCategoryValidator = v.union(
  v.literal("Call Memory"),
  v.literal("Calling"),
  v.literal("Billing & credits"),
  v.literal("Team workflows"),
  v.literal("Live AI"),
  v.literal("Other")
);

const feedbackSortValidator = v.union(
  v.literal("top"),
  v.literal("new"),
  v.literal("my_votes")
);

type FeedbackCtx = QueryCtx | MutationCtx;

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function assertValidTitle(title: string) {
  if (title.length < 6) throw new Error("Use a title with at least 6 characters.");
  if (title.length > 120) throw new Error("Keep the title to 120 characters or fewer.");
}

function assertValidDescription(description: string) {
  if (description.length < 10) throw new Error("Add a little more detail to the request.");
  if (description.length > 1000) {
    throw new Error("Keep the description to 1,000 characters or fewer.");
  }
}

async function getWallet(ctx: FeedbackCtx, workspaceId: Id<"workspaces">) {
  return await ctx.db
    .query("walletSummaries")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

async function buildFeedbackAccess(ctx: FeedbackCtx, workspaceId: Id<"workspaces">) {
  const [workspace, wallet] = await Promise.all([
    ctx.db.get(workspaceId),
    getWallet(ctx, workspaceId),
  ]);
  const planId = wallet?.planId ?? workspace?.plan ?? "free";
  const subscriptionStatus = wallet?.subscriptionStatus ?? "free";
  // Posting is open to any workspace member so trial/free customers can
  // still tell us what they need before they've upgraded. Voting stays
  // gated to paid plans, since vote counts drive prioritization.
  const canVote = canParticipateInFeedback({ planId, subscriptionStatus });

  let voteUpgradeReason: string | null = null;
  if (!canVote) {
    if (planId === "calls_only") {
      voteUpgradeReason = "Voting is reserved for Copilot subscribers.";
    } else if (!FEEDBACK_PAID_PLAN_IDS.includes(planId as (typeof FEEDBACK_PAID_PLAN_IDS)[number])) {
      voteUpgradeReason = "Upgrade to a paid plan to vote on requests.";
    } else if (
      !FEEDBACK_ACTIVE_SUBSCRIPTION_STATUSES.includes(
        subscriptionStatus as (typeof FEEDBACK_ACTIVE_SUBSCRIPTION_STATUSES)[number]
      )
    ) {
      voteUpgradeReason = "Your Copilot subscription must be active to vote.";
    }
  }

  return {
    canRead: true,
    canPost: true,
    canVote,
    planId,
    subscriptionStatus,
    voteUpgradeReason,
  };
}

function anonymizeRequest(
  request: Doc<"feedbackRequests">,
  workspaceVoteIds: Set<Id<"feedbackRequests">>
) {
  return {
    requestId: request._id,
    title: request.title,
    description: request.description,
    category: request.category,
    status: request.status,
    voteCount: request.voteCount,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    hasWorkspaceVoted: workspaceVoteIds.has(request._id),
  };
}

export const getFeedbackAccess = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await requireWorkspaceMembership(ctx);
    return await buildFeedbackAccess(ctx, workspaceId);
  },
});

export const listRequests = query({
  args: {
    sort: v.optional(feedbackSortValidator),
    category: v.optional(feedbackCategoryValidator),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceMembership(ctx);
    const sort = args.sort ?? "top";
    const [access, workspaceVotes, allRequests] = await Promise.all([
      buildFeedbackAccess(ctx, workspaceId),
      ctx.db
        .query("feedbackVotes")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("feedbackRequests")
        .withIndex("by_archived_created", (q) => q.eq("archived", false))
        .collect(),
    ]);

    const workspaceVoteIds = new Set(workspaceVotes.map((vote) => vote.requestId));
    const requests = allRequests
      .filter((request) => !args.category || request.category === args.category)
      .filter((request) => sort !== "my_votes" || workspaceVoteIds.has(request._id))
      .sort((a, b) => {
        if (sort === "new" || sort === "my_votes") return b.createdAt - a.createdAt;
        if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
        return b.createdAt - a.createdAt;
      })
      .slice(0, 100)
      .map((request) => anonymizeRequest(request, workspaceVoteIds));

    return {
      access,
      categories: FEEDBACK_CATEGORIES,
      requests,
    };
  },
});

export const createRequest = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    category: feedbackCategoryValidator,
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId, profile } = await requireWorkspaceMembership(ctx);

    const title = cleanText(args.title);
    const description = args.description.trim();
    assertValidTitle(title);
    assertValidDescription(description);

    const now = Date.now();
    const requestId = await ctx.db.insert("feedbackRequests", {
      title,
      description,
      category: args.category,
      status: "open",
      voteCount: 0,
      createdByWorkspaceId: workspaceId,
      createdByUserId: userId,
      createdByProfileId: profile._id,
      createdAt: now,
      updatedAt: now,
      archived: false,
    });

    return { requestId };
  },
});

export const toggleWorkspaceVote = mutation({
  args: {
    requestId: v.id("feedbackRequests"),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId, profile } = await requireWorkspaceMembership(ctx);
    const access = await buildFeedbackAccess(ctx, workspaceId);
    if (!access.canVote) {
      throw new Error(access.voteUpgradeReason ?? "Upgrade to a paid plan to vote.");
    }

    const request = await ctx.db.get(args.requestId);
    if (!request || request.archived) throw new Error("Feedback request not found.");

    const existingVote = await ctx.db
      .query("feedbackVotes")
      .withIndex("by_request_workspace", (q) =>
        q.eq("requestId", args.requestId).eq("workspaceId", workspaceId)
      )
      .first();

    if (existingVote) {
      await ctx.db.delete(existingVote._id);
      const voteCount = Math.max(0, request.voteCount - 1);
      await ctx.db.patch(request._id, { voteCount, updatedAt: Date.now() });
      return { hasWorkspaceVoted: false, voteCount };
    }

    await ctx.db.insert("feedbackVotes", {
      requestId: args.requestId,
      workspaceId,
      voterUserId: userId,
      voterProfileId: profile._id,
      createdAt: Date.now(),
    });

    const voteCount = request.voteCount + 1;
    await ctx.db.patch(request._id, { voteCount, updatedAt: Date.now() });
    return { hasWorkspaceVoted: true, voteCount };
  },
});
