import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  CALL_BILLING_INCREMENT_SECONDS,
  MINIMUM_BILLABLE_CALL_SECONDS,
  estimateBillableCallCostCents,
  getAffordableBillableCallSeconds,
  getBillableCallSeconds,
} from "../src/lib/call-pricing";

export async function getWalletForWorkspace(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
) {
  return await ctx.db
    .query("walletSummaries")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

export function walletIncludedBalance(wallet: { includedCreditBalanceCents?: number }) {
  return wallet.includedCreditBalanceCents ?? 0;
}

export function walletTopUpBalance(wallet: { topUpCreditBalanceCents?: number }) {
  return wallet.topUpCreditBalanceCents ?? 0;
}

export function legacyBalanceDollars(includedCents: number, topUpCents: number) {
  return (includedCents + topUpCents) / 100;
}

export async function createCreditLedgerEntry(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    walletSummaryId?: Id<"walletSummaries">;
    callId?: Id<"calls">;
    reservationId?: Id<"creditReservations">;
    realtimeUsageEventId?: Id<"realtimeUsageEvents">;
    externalId?: string;
    type:
      | "grant_included"
      | "grant_top_up"
      | "reserve"
      | "settle"
      | "release"
      | "expire"
      | "realtime_charge"
      | "adjustment";
    bucket: "included" | "top_up" | "mixed" | "none";
    amountCents: number;
    remainingCents?: number;
    description: string;
    expiresAt?: number;
    createdAt: number;
  }
) {
  if (args.externalId) {
    const existing = await ctx.db
      .query("creditLedgerEntries")
      .withIndex("by_external", (q) => q.eq("externalId", args.externalId))
      .first();
    if (existing) return existing._id;
  }

  return await ctx.db.insert("creditLedgerEntries", args);
}

export async function grantTopUpCredits(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    walletSummaryId: Id<"walletSummaries">;
    amountCents: number;
    externalId: string;
    description: string;
    now: number;
  }
) {
  const wallet = await ctx.db.get(args.walletSummaryId);
  if (!wallet || wallet.workspaceId !== args.workspaceId) {
    throw new Error("Wallet not found");
  }

  const existing = await ctx.db
    .query("creditLedgerEntries")
    .withIndex("by_external", (q) => q.eq("externalId", args.externalId))
    .first();
  if (existing) {
    return { granted: false as const, reason: "already_granted" };
  }

  const walletAfterExpiry = await clearLegacyTopUpExpiry(ctx, wallet);
  const includedBalance = walletIncludedBalance(walletAfterExpiry);
  const nextTopUpBalance =
    walletTopUpBalance(walletAfterExpiry) + args.amountCents;
  const hasActiveSubscription = ["active", "trialing"].includes(
    walletAfterExpiry.subscriptionStatus
  );

  await ctx.db.patch(wallet._id, {
    planId: hasActiveSubscription ? walletAfterExpiry.planId : "calls_only",
    subscriptionStatus: hasActiveSubscription
      ? walletAfterExpiry.subscriptionStatus
      : "calls_only",
    aiFeaturesEnabled: hasActiveSubscription
      ? walletAfterExpiry.aiFeaturesEnabled
      : false,
    topUpCreditBalanceCents: nextTopUpBalance,
    topUpCreditExpiresAt: undefined,
    creditBalance: legacyBalanceDollars(includedBalance, nextTopUpBalance),
  });

  // No expiresAt: purchased credits never expire.
  await createCreditLedgerEntry(ctx, {
    workspaceId: args.workspaceId,
    walletSummaryId: wallet._id,
    externalId: args.externalId,
    type: "grant_top_up",
    bucket: "top_up",
    amountCents: args.amountCents,
    remainingCents: args.amountCents,
    description: args.description,
    createdAt: args.now,
  });

  return { granted: true as const };
}

async function getTopUpGrantEntries(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
) {
  const entries = await ctx.db
    .query("creditLedgerEntries")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  return entries
    .filter(
      (entry) =>
        entry.type === "grant_top_up" &&
        entry.bucket === "top_up" &&
        (entry.remainingCents ?? 0) > 0
    )
    // Oldest lot first. Expiry no longer participates in ordering because
    // purchased credits never expire.
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Purchased credits never expire. This runs on the same wallet paths the old
// expiry sweep did, but instead of burning expired lots it strips any stamped
// expiry left over from the previous 12-month policy, so credits bought before
// the change become permanent too. It only writes when there is something to
// clear, so it is a no-op for wallets created after the change.
export async function clearLegacyTopUpExpiry(
  ctx: MutationCtx,
  wallet: NonNullable<Awaited<ReturnType<typeof getWalletForWorkspace>>>
) {
  const datedGrants = (await getTopUpGrantEntries(ctx, wallet.workspaceId)).filter(
    (entry) => entry.expiresAt !== undefined
  );

  for (const entry of datedGrants) {
    await ctx.db.patch(entry._id, { expiresAt: undefined });
  }

  if (wallet.topUpCreditExpiresAt === undefined) return wallet;

  await ctx.db.patch(wallet._id, { topUpCreditExpiresAt: undefined });

  return { ...wallet, topUpCreditExpiresAt: undefined };
}

export async function consumeTopUpCredits(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    amountCents: number;
    now: number;
  }
) {
  let remainingToConsume = args.amountCents;
  if (remainingToConsume <= 0) {
    return {
      consumed: true as const,
      consumedCents: 0,
      nextTopUpExpiry: undefined,
    };
  }

  const grants = await getTopUpGrantEntries(ctx, args.workspaceId);
  const availableCents = grants.reduce(
    (sum, entry) => sum + (entry.remainingCents ?? 0),
    0
  );

  if (availableCents < remainingToConsume) {
    return {
      consumed: false as const,
      consumedCents: 0,
      availableCents,
      nextTopUpExpiry: undefined,
    };
  }

  for (const grant of grants) {
    if (remainingToConsume <= 0) break;

    const grantRemaining = grant.remainingCents ?? 0;
    const consumedCents = Math.min(grantRemaining, remainingToConsume);
    if (consumedCents <= 0) continue;

    await ctx.db.patch(grant._id, {
      remainingCents: grantRemaining - consumedCents,
    });

    remainingToConsume -= consumedCents;
  }

  return {
    consumed: true as const,
    consumedCents: args.amountCents,
    nextTopUpExpiry: undefined,
  };
}

async function allocateTopUpReservation(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    reservationId: Id<"creditReservations">;
    amountCents: number;
    now: number;
  }
) {
  let remainingToReserve = args.amountCents;
  if (remainingToReserve <= 0) return;

  const grants = await getTopUpGrantEntries(ctx, args.workspaceId);
  const availableCents = grants.reduce(
    (sum, entry) => sum + (entry.remainingCents ?? 0),
    0
  );

  if (availableCents < remainingToReserve) {
    throw new Error("Top-up credits expired before this call could be reserved.");
  }

  for (const grant of grants) {
    if (remainingToReserve <= 0) break;

    const grantRemaining = grant.remainingCents ?? 0;
    const allocationCents = Math.min(grantRemaining, remainingToReserve);
    if (allocationCents <= 0) continue;

    await ctx.db.patch(grant._id, {
      remainingCents: grantRemaining - allocationCents,
    });
    await ctx.db.insert("creditReservationAllocations", {
      workspaceId: args.workspaceId,
      reservationId: args.reservationId,
      sourceLedgerEntryId: grant._id,
      amountCents: allocationCents,
      expiresAt: grant.expiresAt,
      createdAt: args.now,
    });

    remainingToReserve -= allocationCents;
  }
}

async function releaseUnusedTopUpAllocation(
  ctx: MutationCtx,
  args: {
    reservationId: Id<"creditReservations">;
    topUpSettledCents: number;
    now: number;
  }
) {
  const allocations = await ctx.db
    .query("creditReservationAllocations")
    .withIndex("by_reservation", (q) => q.eq("reservationId", args.reservationId))
    .collect();

  let remainingToSettle = args.topUpSettledCents;
  let restoredCents = 0;
  let expiredCents = 0;

  for (const allocation of allocations.sort((a, b) => a.createdAt - b.createdAt)) {
    const settledCents = Math.min(allocation.amountCents, remainingToSettle);
    const releaseCents = allocation.amountCents - settledCents;
    remainingToSettle -= settledCents;

    if (releaseCents > 0) {
      const source = await ctx.db.get(allocation.sourceLedgerEntryId);
      if (source && (!source.expiresAt || source.expiresAt > args.now)) {
        await ctx.db.patch(source._id, {
          remainingCents: (source.remainingCents ?? 0) + releaseCents,
        });
        restoredCents += releaseCents;
      } else {
        expiredCents += releaseCents;
      }
    }

    await ctx.db.patch(allocation._id, {
      settledCents,
      releasedCents: releaseCents > 0 ? releaseCents : undefined,
      expiredCents: releaseCents > 0 && allocation.expiresAt && allocation.expiresAt <= args.now
        ? releaseCents
        : undefined,
    });
  }

  return { restoredCents, expiredCents };
}

export async function reserveCallCredits(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    callId: Id<"calls">;
    rateCentsPerMinute: number;
    maxCallSeconds: number;
    now: number;
    providerCostCentsPerMinute?: number | null;
    aiCaptureCostCentsPerMinute?: number;
    totalVariableCostCentsPerMinute?: number | null;
    marginMultiple?: number | null;
    billingIncrementSeconds?: number;
    minimumBillableSeconds?: number;
    pricingCatalogVersion?: string;
    quoteBlockReason?: string | null;
    description?: string;
  }
) {
  const walletBeforeExpiry = await getWalletForWorkspace(ctx, args.workspaceId);
  if (!walletBeforeExpiry) {
    throw new Error("Add calling credits before placing calls.");
  }
  const wallet = await clearLegacyTopUpExpiry(ctx, walletBeforeExpiry);

  const includedBalance = walletIncludedBalance(wallet);
  const topUpBalance = walletTopUpBalance(wallet);
  const availableCreditCents = includedBalance + topUpBalance;
  const reservedSeconds = getAffordableBillableCallSeconds({
    availableCreditCents,
    maxCallSeconds: args.maxCallSeconds,
    rateCentsPerMinute: args.rateCentsPerMinute,
  });

  if (reservedSeconds < MINIMUM_BILLABLE_CALL_SECONDS) {
    throw new Error(
      "Insufficient calling credits for this destination. Add credits or choose a lower-cost route."
    );
  }

  const reservedCents = estimateBillableCallCostCents(args.rateCentsPerMinute, reservedSeconds);
  const includedReservedCents = Math.min(includedBalance, reservedCents);
  const topUpReservedCents = reservedCents - includedReservedCents;
  const nextIncludedBalance = includedBalance - includedReservedCents;
  const nextTopUpBalance = topUpBalance - topUpReservedCents;

  if (topUpReservedCents > 0) {
    const topUpGrants = await getTopUpGrantEntries(ctx, args.workspaceId);
    const availableTopUpCents = topUpGrants.reduce(
      (sum, entry) => sum + (entry.remainingCents ?? 0),
      0
    );
    if (availableTopUpCents < topUpReservedCents) {
      throw new Error("Purchased top-up credits have expired. Add credits before placing this call.");
    }
  }

  await ctx.db.patch(wallet._id, {
    includedCreditBalanceCents: nextIncludedBalance,
    topUpCreditBalanceCents: nextTopUpBalance,
    reservedCreditCents: (wallet.reservedCreditCents ?? 0) + reservedCents,
    creditBalance: legacyBalanceDollars(nextIncludedBalance, nextTopUpBalance),
  });

  const reservationId = await ctx.db.insert("creditReservations", {
    workspaceId: args.workspaceId,
    walletSummaryId: wallet._id,
    callId: args.callId,
    status: "reserved",
    includedReservedCents,
    topUpReservedCents,
    reservedCents,
    rateCentsPerMinute: args.rateCentsPerMinute,
    reservedSeconds,
    billingIncrementSeconds: args.billingIncrementSeconds ?? CALL_BILLING_INCREMENT_SECONDS,
    minimumBillableSeconds: args.minimumBillableSeconds ?? MINIMUM_BILLABLE_CALL_SECONDS,
    providerCostCentsPerMinute: args.providerCostCentsPerMinute ?? undefined,
    aiCaptureCostCentsPerMinute: args.aiCaptureCostCentsPerMinute,
    totalVariableCostCentsPerMinute: args.totalVariableCostCentsPerMinute ?? undefined,
    marginMultiple: args.marginMultiple ?? undefined,
    pricingCatalogVersion: args.pricingCatalogVersion,
    quoteBlockReason: args.quoteBlockReason ?? undefined,
    createdAt: args.now,
  });

  await createCreditLedgerEntry(ctx, {
    workspaceId: args.workspaceId,
    walletSummaryId: wallet._id,
    callId: args.callId,
    reservationId,
    type: "reserve",
    bucket:
      includedReservedCents > 0 && topUpReservedCents > 0
        ? "mixed"
        : includedReservedCents > 0
          ? "included"
          : "top_up",
    amountCents: -reservedCents,
    description: args.description ?? "Reserved credits for outbound call",
    createdAt: args.now,
  });

  await allocateTopUpReservation(ctx, {
    workspaceId: args.workspaceId,
    reservationId,
    amountCents: topUpReservedCents,
    now: args.now,
  });

  return {
    reservationId,
    reservedCents,
    reservedSeconds,
    includedReservedCents,
    topUpReservedCents,
  };
}

export async function settleCallReservation(
  ctx: MutationCtx,
  args: {
    callId: Id<"calls">;
    durationSeconds: number;
    now: number;
  }
) {
  const reservation = await ctx.db
    .query("creditReservations")
    .withIndex("by_call", (q) => q.eq("callId", args.callId))
    .first();

  if (!reservation || reservation.status !== "reserved") {
    return { settled: false };
  }

  const wallet = await ctx.db.get(reservation.walletSummaryId);
  if (!wallet) return { settled: false };

  const settledBillableSeconds = getBillableCallSeconds(args.durationSeconds);
  const settledCents = Math.min(
    reservation.reservedCents,
    estimateBillableCallCostCents(reservation.rateCentsPerMinute, args.durationSeconds)
  );
  const includedSettledCents = Math.min(reservation.includedReservedCents, settledCents);
  const topUpSettledCents = settledCents - includedSettledCents;
  const includedReleaseCents = reservation.includedReservedCents - includedSettledCents;
  const topUpRelease = await releaseUnusedTopUpAllocation(ctx, {
    reservationId: reservation._id,
    topUpSettledCents,
    now: args.now,
  });
  const releasedCents = includedReleaseCents + topUpRelease.restoredCents;

  const nextIncludedBalance = (wallet.includedCreditBalanceCents ?? 0) + includedReleaseCents;
  const nextTopUpBalance = (wallet.topUpCreditBalanceCents ?? 0) + topUpRelease.restoredCents;

  await ctx.db.patch(wallet._id, {
    includedCreditBalanceCents: nextIncludedBalance,
    topUpCreditBalanceCents: nextTopUpBalance,
    reservedCreditCents: Math.max(0, (wallet.reservedCreditCents ?? 0) - reservation.reservedCents),
    lifetimeCreditSpendCents: (wallet.lifetimeCreditSpendCents ?? 0) + settledCents,
    usageThisMonth: wallet.usageThisMonth + args.durationSeconds / 60,
    creditBalance: legacyBalanceDollars(nextIncludedBalance, nextTopUpBalance),
  });

  await ctx.db.patch(reservation._id, {
    status: "settled",
    settledCents,
    releasedCents,
    settledBillableSeconds,
    settledAt: args.now,
  });

  await createCreditLedgerEntry(ctx, {
    workspaceId: reservation.workspaceId,
    walletSummaryId: wallet._id,
    callId: args.callId,
    reservationId: reservation._id,
    type: "settle",
    bucket:
      includedSettledCents > 0 && topUpSettledCents > 0
        ? "mixed"
        : includedSettledCents > 0
          ? "included"
          : settledCents > 0
            ? "top_up"
            : "none",
    amountCents: -settledCents,
    description: "Settled credits for completed outbound call with started-minute billing",
    createdAt: args.now,
  });

  if (releasedCents > 0) {
    await createCreditLedgerEntry(ctx, {
      workspaceId: reservation.workspaceId,
      walletSummaryId: wallet._id,
      callId: args.callId,
      reservationId: reservation._id,
      type: "release",
      bucket:
        includedReleaseCents > 0 && topUpRelease.restoredCents > 0
          ? "mixed"
          : includedReleaseCents > 0
            ? "included"
            : "top_up",
      amountCents: releasedCents,
      description: "Released unused reserved call credits",
      createdAt: args.now,
    });
  }

  if (topUpRelease.expiredCents > 0) {
    await createCreditLedgerEntry(ctx, {
      workspaceId: reservation.workspaceId,
      walletSummaryId: wallet._id,
      callId: args.callId,
      reservationId: reservation._id,
      type: "expire",
      bucket: "top_up",
      amountCents: -topUpRelease.expiredCents,
      description: "Expired unused top-up reservation after the source credits expired",
      createdAt: args.now,
    });
  }

  return { settled: true, settledCents, releasedCents, settledBillableSeconds };
}

export async function releaseCallReservation(
  ctx: MutationCtx,
  args: {
    callId: Id<"calls">;
    now: number;
    description?: string;
  }
) {
  const reservation = await ctx.db
    .query("creditReservations")
    .withIndex("by_call", (q) => q.eq("callId", args.callId))
    .first();

  if (!reservation || reservation.status !== "reserved") {
    return { released: false };
  }

  const wallet = await ctx.db.get(reservation.walletSummaryId);
  if (!wallet) return { released: false };

  const topUpRelease = await releaseUnusedTopUpAllocation(ctx, {
    reservationId: reservation._id,
    topUpSettledCents: 0,
    now: args.now,
  });
  const releasedCents =
    reservation.includedReservedCents + topUpRelease.restoredCents;
  const nextIncludedBalance =
    (wallet.includedCreditBalanceCents ?? 0) + reservation.includedReservedCents;
  const nextTopUpBalance =
    (wallet.topUpCreditBalanceCents ?? 0) + topUpRelease.restoredCents;

  await ctx.db.patch(wallet._id, {
    includedCreditBalanceCents: nextIncludedBalance,
    topUpCreditBalanceCents: nextTopUpBalance,
    reservedCreditCents: Math.max(
      0,
      (wallet.reservedCreditCents ?? 0) - reservation.reservedCents
    ),
    creditBalance: legacyBalanceDollars(nextIncludedBalance, nextTopUpBalance),
  });

  await ctx.db.patch(reservation._id, {
    status: "released",
    releasedCents,
  });

  if (releasedCents > 0) {
    await createCreditLedgerEntry(ctx, {
      workspaceId: reservation.workspaceId,
      walletSummaryId: wallet._id,
      callId: args.callId,
      reservationId: reservation._id,
      type: "release",
      bucket:
        reservation.includedReservedCents > 0 && topUpRelease.restoredCents > 0
          ? "mixed"
          : reservation.includedReservedCents > 0
            ? "included"
            : "top_up",
      amountCents: releasedCents,
      description:
        args.description ?? "Released credits for call that did not connect",
      createdAt: args.now,
    });
  }

  if (topUpRelease.expiredCents > 0) {
    await createCreditLedgerEntry(ctx, {
      workspaceId: reservation.workspaceId,
      walletSummaryId: wallet._id,
      callId: args.callId,
      reservationId: reservation._id,
      type: "expire",
      bucket: "top_up",
      amountCents: -topUpRelease.expiredCents,
      description: "Expired unused top-up reservation after the source credits expired",
      createdAt: args.now,
    });
  }

  return {
    released: true,
    releasedCents,
    expiredCents: topUpRelease.expiredCents,
  };
}
