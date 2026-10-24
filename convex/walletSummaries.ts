import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace, requireWorkspaceMembership } from "./authHelpers";
import { enqueueCreditRequestEmail } from "./emails";
import type { Id } from "./_generated/dataModel";

const WALLET_ACTIVITY_LIMIT = 20;

function currentMonthStartUtc(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function creditActivityLabel(args: {
  type: string;
  reservationStatus?: string;
}) {
  if (args.type === "reserve") {
    return args.reservationStatus === "reserved"
      ? "Reserved for active call"
      : "Reserved for outbound call";
  }
  if (args.type === "settle") return "Charged for completed call (started-minute billing)";
  if (args.type === "release") return "Unused reservation released";
  if (args.type === "grant_included") return "Included credits granted";
  if (args.type === "grant_top_up") return "Top-up credits added";
  if (args.type === "expire") return "Credits expired";
  if (args.type === "realtime_charge") return "Live feature overage charged";
  return "Wallet adjustment";
}

function creditActivityTone(args: { type: string; amountCents: number }) {
  if (args.type === "reserve") return "pending";
  if (args.amountCents < 0) return "charge";
  if (args.amountCents > 0) return "credit";
  return "neutral";
}

export const getWalletSummary = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    return await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
  },
});

export const checkFreeCallEligibility = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    return Boolean(
      wallet &&
        !wallet.freeCallUsed &&
        wallet.planId === "free" &&
        wallet.subscriptionStatus === "free"
    );
  },
});

export const getCreditActivity = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    const now = Date.now();
    const periodStart = wallet?.stripeCurrentPeriodStart ?? currentMonthStartUtc(now);
    const periodEnd = wallet?.stripeCurrentPeriodEnd;

    const cycleEntries = await ctx.db
      .query("creditLedgerEntries")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", workspaceId).gte("createdAt", periodStart)
      )
      .collect();
    const currentCycleSpentCents = Math.max(0, cycleEntries.reduce((sum, entry) => {
      if (
        (entry.type === "settle" || entry.type === "realtime_charge") &&
        entry.amountCents < 0
      ) {
        return sum + Math.abs(entry.amountCents);
      }
      // Net refunds back out of the displayed cycle spend, but only refunds:
      // a positive `adjustment` tied to a specific call is a reversal of a
      // charge on that call. A promotional or goodwill credit grant carries no
      // callId and must not make the customer's spend look smaller than it was.
      if (entry.type === "adjustment" && entry.amountCents > 0 && entry.callId) {
        return sum - entry.amountCents;
      }
      return sum;
    }, 0));

    const entries = await ctx.db
      .query("creditLedgerEntries")
      .withIndex("by_workspace_createdAt", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(WALLET_ACTIVITY_LIMIT);

    const recentEntries = await Promise.all(
      entries.map(async (entry) => {
        const [call, reservation] = await Promise.all([
          entry.callId ? ctx.db.get(entry.callId) : Promise.resolve(null),
          entry.reservationId ? ctx.db.get(entry.reservationId) : Promise.resolve(null),
        ]);
        const reservationStatus = reservation?.status;
        const callId = entry.callId as Id<"calls"> | undefined;
        const label = creditActivityLabel({ type: entry.type, reservationStatus });

        return {
          id: entry._id,
          createdAt: entry.createdAt,
          type: entry.type,
          bucket: entry.bucket,
          label,
          description: entry.description,
          amountCents: entry.amountCents,
          remainingCents: entry.remainingCents,
          expiresAt: entry.expiresAt,
          tone: creditActivityTone({
            type: entry.type,
            amountCents: entry.amountCents,
          }),
          callId,
          callHref: callId ? `/app/calls/${callId}` : undefined,
          callStartedAt: call?.startedAt,
          callDurationSeconds: call?.durationSeconds,
          rateCentsPerMinute: call?.retailRateCentsPerMinute,
          reservationStatus,
          isPendingReservation: entry.type === "reserve" && reservationStatus === "reserved",
        };
      })
    );

    const includedBalanceCents = wallet?.includedCreditBalanceCents ?? 0;
    const topUpBalanceCents = wallet?.topUpCreditBalanceCents ?? 0;
    const reservedCents = wallet?.reservedCreditCents ?? 0;

    return {
      summary: {
        availableCents: includedBalanceCents + topUpBalanceCents,
        includedBalanceCents,
        topUpBalanceCents,
        reservedCents,
        currentCycleSpentCents,
        currentCycleMinutes: wallet?.usageThisMonth ?? 0,
        lifetimeSpentCents: wallet?.lifetimeCreditSpendCents ?? 0,
        periodStart,
        periodEnd,
      },
      recentEntries,
    };
  },
});

export const markFreeCallUsed = mutation({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (!wallet) return;
    await ctx.db.patch(wallet._id, {
      freeCallUsed: true,
      freeCallUsedAt: Date.now(),
    });
  },
});

export const checkUpsellEligibility = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    
    // Show upsell if free call was used and still on free plan
    return wallet?.freeCallUsed === true;
  },
});

export const checkAIFeaturesEnabled = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    
    return wallet?.aiFeaturesEnabled !== false;
  },
});

// A member who hits a credits wall can ask the people who can fix it, instead of
// staring at a disabled button until someone notices. Any member may call this —
// it spends no money and takes no billing action, it only sends a nudge to the
// workspace's owner and admins. The cooldown lives in enqueueCreditRequestEmail.
export const requestWorkspaceCredits = mutation({
  args: {},
  handler: async (ctx) => {
    const { workspaceId, userId, profile } = await requireWorkspaceMembership(ctx);
    const requestedByName = profile.displayName?.trim() || profile.email?.trim() || "A teammate";
    const result = await enqueueCreditRequestEmail(ctx, {
      workspaceId,
      requestedByUserId: userId,
      requestedByName,
    });
    // "cooldown" is reported as success to the caller: from the member's point of
    // view someone has already been asked, which is the outcome they wanted.
    return {
      sent: result.queued > 0,
      alreadyRequested: result.reason === "cooldown",
      noRecipients: result.reason === "no_recipients",
    };
  },
});

export const incrementUsage = mutation({
  args: {
    walletSummaryId: v.id("walletSummaries"),
    minutes: v.number(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const wallet = await ctx.db.get(args.walletSummaryId);
    if (!wallet || wallet.workspaceId !== workspaceId) return;
    await ctx.db.patch(args.walletSummaryId, {
      usageThisMonth: wallet.usageThisMonth + args.minutes,
    });
  },
});
