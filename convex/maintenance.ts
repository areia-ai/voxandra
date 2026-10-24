import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertMaintenanceSecret,
  normalizeMaintenanceLimit,
  sanitizeMaintenanceError,
} from "./maintenanceShared";
import { estimateCallCostCents } from "../src/lib/billing/config";
import {
  createCreditLedgerEntry,
  legacyBalanceDollars,
  releaseCallReservation,
} from "./billingHelpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPERATIONAL_RETENTION_MS = 180 * DAY_MS;
const FAILED_EMAIL_JOB_RETENTION_MS = 30 * DAY_MS;
const TWILIO_SESSION_RETENTION_AFTER_EXPIRY_MS = 7 * DAY_MS;
const EXPIRED_CHECKOUT_RETENTION_AFTER_EXPIRY_MS = 30 * DAY_MS;

const REPORT_TABLES = [
  "workspaces",
  "profiles",
  "workspaceMemberships",
  "workspaceInvitations",
  "contacts",
  "cases",
  "calls",
  "twilioCallSessions",
  "callingNumbers",
  "providerEvents",
  "callGuidanceItems",
  "callKeypadEvents",
  "realtimeUsageEvents",
  "realtimeSessions",
  "callUtterances",
  "translationSegments",
  "agentMissions",
  "agentRunEvents",
  "approvalRequests",
  "agentLearningExamples",
  "callMemorySearchDocs",
  "callMemoryEmbeddings",
  "feedbackRequests",
  "feedbackVotes",
  "transcripts",
  "aiMemories",
  "extractedEntities",
  "actionItems",
  "reminders",
  "threadInsights",
  "reviewSuggestions",
  "aiExtractionRuns",
  "audioTranscriptionRuns",
  "shadowAgentRuns",
  "walletSummaries",
  "stripeWebhookEvents",
  "publicStripeCheckouts",
  "creditLedgerEntries",
  "creditReservationAllocations",
  "creditReservations",
  "demoSettings",
  "launchInterestSignups",
  "emailJobs",
  "emailLogs",
] as const;

type ReportTable = (typeof REPORT_TABLES)[number];
type CleanupDocId =
  | Id<"providerEvents">
  | Id<"emailLogs">
  | Id<"emailJobs">
  | Id<"twilioCallSessions">
  | Id<"publicStripeCheckouts">;
type OrphanWorkspaceCleanupCounts = Record<string, number>;
type WorkspaceScopedCleanupTable =
  | "workspaceInvitations"
  | "contacts"
  | "cases"
  | "calls"
  | "twilioCallSessions"
  | "callingNumbers"
  | "providerEvents"
  | "callGuidanceItems"
  | "callKeypadEvents"
  | "realtimeUsageEvents"
  | "realtimeSessions"
  | "callUtterances"
  | "translationSegments"
  | "agentMissions"
  | "agentRunEvents"
  | "approvalRequests"
  | "agentLearningExamples"
  | "callMemoryEmbeddings"
  | "callMemorySearchDocs"
  | "feedbackVotes"
  | "transcripts"
  | "aiMemories"
  | "extractedEntities"
  | "actionItems"
  | "reminders"
  | "threadInsights"
  | "reviewSuggestions"
  | "aiExtractionRuns"
  | "audioTranscriptionRuns"
  | "shadowAgentRuns"
  | "walletSummaries"
  | "creditReservationAllocations"
  | "creditReservations"
  | "creditLedgerEntries"
  | "demoSettings"
  | "emailJobs"
  | "emailLogs";
type OrphanWorkspaceCleanupTable =
  | WorkspaceScopedCleanupTable
  | "publicStripeCheckouts"
  | "feedbackRequests";

function approximateJsonBytes(value: unknown) {
  return JSON.stringify(value).length;
}

async function getTableStats(ctx: QueryCtx, table: ReportTable) {
  const docs = await ctx.db.query(table).collect();
  const approxJsonBytes = docs.reduce((sum, doc) => sum + approximateJsonBytes(doc), 0);
  return {
    table,
    count: docs.length,
    approxJsonBytes,
    approxKb: Math.round((approxJsonBytes / 1024) * 10) / 10,
  };
}

async function deleteDocs(ctx: MutationCtx, docs: { _id: CleanupDocId }[]) {
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
  return docs.length;
}

async function cleanupWorkspaceScopedTable<TableName extends WorkspaceScopedCleanupTable>(
  ctx: MutationCtx,
  table: TableName,
  workspaceId: Id<"workspaces">,
  counts: OrphanWorkspaceCleanupCounts,
  dryRun: boolean
) {
  const docs = (await ctx.db.query(table).collect()).filter(
    (doc) => doc.workspaceId === workspaceId
  );
  counts[table] = docs.length;

  if (dryRun) return;
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
}

async function cleanupFeedbackRequests(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  counts: OrphanWorkspaceCleanupCounts,
  dryRun: boolean
) {
  const docs = (await ctx.db.query("feedbackRequests").collect()).filter(
    (doc) => doc.createdByWorkspaceId === workspaceId
  );
  counts.feedbackRequests = docs.length;

  if (dryRun) return;
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
}

export const repairTranslationBridgeIncident = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    staleCallIds: v.array(v.id("calls")),
    orphanCallId: v.id("calls"),
    correctedTranslationSeconds: v.number(),
    refundCents: v.number(),
    confirmation: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertMaintenanceSecret(args.secret);
    if (args.confirmation !== "repair-2026-07-30-translation-bridge") {
      throw new Error("Incident repair confirmation does not match.");
    }
    const dryRun = args.dryRun !== false;
    const now = Date.now();
    const staleResults = [];

    for (const callId of args.staleCallIds) {
      const call = await ctx.db.get(callId);
      if (!call || call.workspaceId !== args.workspaceId) {
        throw new Error("Stale call does not belong to the confirmed workspace.");
      }
      const reservation = await ctx.db
        .query("creditReservations")
        .withIndex("by_call", (q) => q.eq("callId", callId))
        .first();
      const sessions = await ctx.db
        .query("twilioCallSessions")
        .withIndex("by_call", (q) => q.eq("callId", callId))
        .collect();
      const realtimeSessions = await ctx.db
        .query("realtimeSessions")
        .withIndex("by_call", (q) => q.eq("callId", callId))
        .collect();
      staleResults.push({
        callId,
        reservationStatus: reservation?.status,
        reservedCents: reservation?.reservedCents ?? 0,
        sessionStatuses: sessions.map((session) => session.status),
      });

      if (!dryRun) {
        await releaseCallReservation(ctx, {
          callId,
          now,
          description: "Released stale reservation from translation bridge incident",
        });
        for (const session of sessions) {
          if (session.status === "pending") {
            await ctx.db.patch(session._id, { status: "failed" });
          }
        }
        for (const session of realtimeSessions) {
          if (["requested", "starting"].includes(session.status)) {
            await ctx.db.patch(session._id, {
              status: "failed",
              endedAt: now,
              updatedAt: now,
              errorCode: "bridge_setup_abandoned",
              errorMessage: "Translated call did not connect.",
            });
          }
        }
        await ctx.db.patch(callId, {
          status: "failed",
          processingStatus: "failed",
          endedAt: new Date(now).toISOString(),
        });
      }
    }

    const orphanCall = await ctx.db.get(args.orphanCallId);
    if (!orphanCall || orphanCall.workspaceId !== args.workspaceId) {
      throw new Error("Orphan bridge call does not belong to the confirmed workspace.");
    }
    const refundExternalId = `incident:2026-07-30:translation-bridge:${args.orphanCallId}`;
    const existingRefund = await ctx.db
      .query("creditLedgerEntries")
      .withIndex("by_external", (q) => q.eq("externalId", refundExternalId))
      .first();
    const usageEvents = await ctx.db
      .query("realtimeUsageEvents")
      .withIndex("by_call", (q) => q.eq("callId", args.orphanCallId))
      .collect();
    const translationEvent = usageEvents.find(
      (event) => event.feature === "translated_captions"
    );
    if (!translationEvent) {
      throw new Error("Expected translation event was not found.");
    }
    if (
      !existingRefund &&
      (translationEvent.chargedCents ?? 0) !== args.refundCents
    ) {
      throw new Error("Translation charge does not match the confirmed refund.");
    }
    if ((translationEvent.topUpChargedCents ?? 0) !== 0) {
      throw new Error("Incident refund expected an included-credit-only charge.");
    }

    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
    if (!wallet) throw new Error("Wallet not found.");

    if (!dryRun && !existingRefund) {
      const nextIncludedBalance =
        (wallet.includedCreditBalanceCents ?? 0) + args.refundCents;
      const topUpBalance = wallet.topUpCreditBalanceCents ?? 0;
      await ctx.db.patch(wallet._id, {
        includedCreditBalanceCents: nextIncludedBalance,
        lifetimeCreditSpendCents: Math.max(
          0,
          (wallet.lifetimeCreditSpendCents ?? 0) - args.refundCents
        ),
        creditBalance: legacyBalanceDollars(nextIncludedBalance, topUpBalance),
      });
      await createCreditLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        walletSummaryId: wallet._id,
        callId: args.orphanCallId,
        realtimeUsageEventId: translationEvent._id,
        externalId: refundExternalId,
        type: "adjustment",
        bucket: "included",
        amountCents: args.refundCents,
        description: "Refunded Live Translation overage from orphaned bridge leg",
        createdAt: now,
      });
      const correctedSeconds = Math.max(
        0,
        Math.floor(args.correctedTranslationSeconds)
      );
      await ctx.db.patch(translationEvent._id, {
        durationSeconds: correctedSeconds,
        billedSeconds: correctedSeconds,
        includedSecondsApplied: correctedSeconds,
        overageSeconds: 0,
        overageCents: 0,
        chargeStatus: "not_required",
        chargedCents: 0,
        includedChargedCents: 0,
        topUpChargedCents: 0,
        unpaidCents: 0,
      });
    }

    return {
      dryRun,
      staleResults,
      orphanCallId: args.orphanCallId,
      translationEventId: translationEvent._id,
      originalTranslationSeconds: translationEvent.durationSeconds,
      correctedTranslationSeconds: args.correctedTranslationSeconds,
      refundCents: args.refundCents,
      refundAlreadyApplied: Boolean(existingRefund),
    };
  },
});

export const deleteFeedbackRequest = mutation({
  args: {
    secret: v.string(),
    requestId: v.id("feedbackRequests"),
    confirmationTitle: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertMaintenanceSecret(args.secret);

    const dryRun = args.dryRun !== false;
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      return {
        dryRun,
        requestId: args.requestId,
        matched: false,
        deleted: false,
        voteRows: 0,
      };
    }

    const confirmationTitle = args.confirmationTitle.trim();
    if (request.title !== confirmationTitle) {
      throw new Error("Confirmation title does not match feedback request title.");
    }

    const votes = await ctx.db
      .query("feedbackVotes")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();

    if (!dryRun) {
      for (const vote of votes) {
        await ctx.db.delete(vote._id);
      }
      await ctx.db.delete(request._id);
    }

    return {
      dryRun,
      requestId: request._id,
      matched: true,
      deleted: !dryRun,
      title: request.title,
      category: request.category,
      status: request.status,
      storedVoteCount: request.voteCount,
      voteRows: votes.length,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  },
});

async function cleanupClaimedPublicStripeCheckouts(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  counts: OrphanWorkspaceCleanupCounts,
  dryRun: boolean
) {
  const docs = (await ctx.db.query("publicStripeCheckouts").collect()).filter(
    (doc) => doc.claimedWorkspaceId === workspaceId
  );
  counts.publicStripeCheckouts = docs.length;

  if (dryRun) return;
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
}

function getFreeCallReport(calls: Doc<"calls">[]) {
  const freeCalls = calls.filter((call) => call.isFreeCall === true);
  const statusCounts: Record<string, number> = {};
  let claimedCount = 0;
  let completedCount = 0;
  let transcribedCount = 0;
  let memoryReadyCount = 0;
  let totalDurationSeconds = 0;
  let estimatedRetailValueCents = 0;

  for (const call of freeCalls) {
    const status = call.status || "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (call.freeCallClaimedAt) claimedCount += 1;
    if (status === "completed") completedCount += 1;
    if (call.transcriptId) transcribedCount += 1;
    if (call.aiMemoryReady) memoryReadyCount += 1;
    totalDurationSeconds += call.durationSeconds;
    if (call.retailRateCentsPerMinute) {
      estimatedRetailValueCents += estimateCallCostCents(
        call.retailRateCentsPerMinute,
        call.durationSeconds
      );
    }
  }

  return {
    count: freeCalls.length,
    statusCounts,
    claimedCount,
    completedCount,
    transcribedCount,
    memoryReadyCount,
    totalDurationSeconds,
    totalDurationMinutes: Math.round((totalDurationSeconds / 60) * 100) / 100,
    estimatedRetailValueCents,
  };
}

export const getStorageFootprintReport = query({
  args: {
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    assertMaintenanceSecret(args.secret);

    const tableStats = await Promise.all(REPORT_TABLES.map((table) => getTableStats(ctx, table)));
    tableStats.sort((a, b) => b.approxJsonBytes - a.approxJsonBytes);

    const calls = await ctx.db.query("calls").collect();
    const transcripts = await ctx.db.query("transcripts").collect();
    const recordingDeleteStatusCounts: Record<string, number> = {};
    let callsWithRecordingUrl = 0;
    let callsWithRecordingSid = 0;
    for (const call of calls) {
      const status = call.recordingDeleteStatus ?? "unset";
      recordingDeleteStatusCounts[status] = (recordingDeleteStatusCounts[status] ?? 0) + 1;
      if (call.recordingUrl) callsWithRecordingUrl += 1;
      if (call.recordingSid) callsWithRecordingSid += 1;
    }

    let audioStoredTrue = 0;
    let totalTranscriptTextChars = 0;
    let totalSegmentTextChars = 0;
    let totalSegments = 0;
    for (const transcript of transcripts) {
      totalTranscriptTextChars += transcript.text.length;
      if (transcript.audioStored === true) audioStoredTrue += 1;
      for (const segment of transcript.segments) {
        totalSegments += 1;
        totalSegmentTextChars += segment.text.length;
      }
    }

    const totalDocs = tableStats.reduce((sum, row) => sum + row.count, 0);
    const totalApproxJsonBytes = tableStats.reduce((sum, row) => sum + row.approxJsonBytes, 0);

    return {
      generatedAt: new Date().toISOString(),
      totalDocs,
      totalApproxJsonBytes,
      totalApproxMb: Math.round((totalApproxJsonBytes / 1024 / 1024) * 1000) / 1000,
      largestTables: tableStats.filter((row) => row.count > 0).slice(0, 10),
      nonEmptyTables: tableStats.filter((row) => row.count > 0),
      calls: {
        count: calls.length,
        callsWithRecordingUrl,
        callsWithRecordingSid,
        recordingDeleteStatusCounts,
      },
      freeCalls: getFreeCallReport(calls),
      transcripts: {
        count: transcripts.length,
        audioStoredTrue,
        totalTranscriptTextChars,
        totalSegmentTextChars,
        totalStoredTextCharsApprox: totalTranscriptTextChars + totalSegmentTextChars,
        totalSegments,
        avgTranscriptTextChars: transcripts.length
          ? Math.round(totalTranscriptTextChars / transcripts.length)
          : 0,
        avgSegmentTextCharsPerTranscript: transcripts.length
          ? Math.round(totalSegmentTextChars / transcripts.length)
          : 0,
      },
    };
  },
});

export const listLegacyRecordingUrlCalls = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = normalizeMaintenanceLimit(args.limit);
    const calls = await ctx.db.query("calls").collect();
    return calls
      .filter((call) => Boolean(call.recordingUrl))
      .slice(0, limit)
      .map((call) => ({
        callId: call._id,
        recordingSid: call.recordingSid,
      }));
  },
});

export const clearLegacyRecordingUrl = internalMutation({
  args: {
    callId: v.id("calls"),
    deleteStatus: v.union(v.literal("deleted"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return { cleared: false };

    const patch: Partial<Doc<"calls">> = {
      recordingUrl: undefined,
      recordingDeleteStatus: args.deleteStatus,
      recordingDeleteError:
        args.deleteStatus === "failed" && args.errorMessage
          ? sanitizeMaintenanceError(args.errorMessage)
          : undefined,
    };
    if (args.deleteStatus === "deleted") {
      patch.recordingDeletedAt = Date.now();
    }

    await ctx.db.patch(args.callId, patch);
    return { cleared: true };
  },
});

export const cleanupOrphanWorkspaceRecords = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id("workspaces"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertMaintenanceSecret(args.secret);

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return {
        dryRun: args.dryRun !== false,
        workspaceId: args.workspaceId,
        deletedWorkspace: false,
        counts: {},
        totalMatched: 0,
      };
    }

    const [memberships, profiles] = await Promise.all([
      ctx.db
        .query("workspaceMemberships")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
      ctx.db.query("profiles").collect(),
    ]);
    const profileDefaults = profiles.filter(
      (profile) => profile.defaultWorkspaceId === args.workspaceId
    );

    if (memberships.length > 0 || profileDefaults.length > 0) {
      throw new Error("Refusing to clean workspace with profiles or memberships.");
    }

    const dryRun = args.dryRun !== false;
    const counts: OrphanWorkspaceCleanupCounts = {};
    const workspaceScopedTables: OrphanWorkspaceCleanupTable[] = [
      "callMemoryEmbeddings",
      "callMemorySearchDocs",
      "agentLearningExamples",
      "reviewSuggestions",
      "threadInsights",
      "reminders",
      "actionItems",
      "extractedEntities",
      "aiMemories",
      "transcripts",
      "aiExtractionRuns",
      "audioTranscriptionRuns",
      "shadowAgentRuns",
      "callGuidanceItems",
      "callKeypadEvents",
      "callUtterances",
      "translationSegments",
      "realtimeUsageEvents",
      "realtimeSessions",
      "approvalRequests",
      "agentRunEvents",
      "agentMissions",
      "providerEvents",
      "twilioCallSessions",
      "creditReservationAllocations",
      "creditReservations",
      "creditLedgerEntries",
      "emailLogs",
      "emailJobs",
      "demoSettings",
      "walletSummaries",
      "feedbackVotes",
      "publicStripeCheckouts",
      "feedbackRequests",
      "workspaceInvitations",
      "callingNumbers",
      "calls",
      "cases",
      "contacts",
    ];

    for (const table of workspaceScopedTables) {
      if (table === "publicStripeCheckouts") {
        await cleanupClaimedPublicStripeCheckouts(ctx, args.workspaceId, counts, dryRun);
        continue;
      }
      if (table === "feedbackRequests") {
        await cleanupFeedbackRequests(ctx, args.workspaceId, counts, dryRun);
        continue;
      }
      await cleanupWorkspaceScopedTable(ctx, table, args.workspaceId, counts, dryRun);
    }

    counts.workspaces = 1;
    if (!dryRun) {
      await ctx.db.delete(workspace._id);
    }

    const totalMatched = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return {
      dryRun,
      workspaceId: args.workspaceId,
      deletedWorkspace: !dryRun,
      counts,
      totalMatched,
    };
  },
});

export const cleanupOperationalRecords = internalMutation({
  args: {
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = normalizeMaintenanceLimit(args.limit);
    const now = args.now ?? Date.now();
    const operationalCutoff = now - OPERATIONAL_RETENTION_MS;
    const failedEmailJobCutoff = now - FAILED_EMAIL_JOB_RETENTION_MS;
    const twilioSessionCutoff = now - TWILIO_SESSION_RETENTION_AFTER_EXPIRY_MS;
    const expiredCheckoutCutoff = now - EXPIRED_CHECKOUT_RETENTION_AFTER_EXPIRY_MS;

    const providerEvents = await ctx.db
      .query("providerEvents")
      .withIndex("by_received_at", (q) => q.lt("receivedAt", operationalCutoff))
      .take(limit);
    const emailLogs = await ctx.db
      .query("emailLogs")
      .withIndex("by_sent_at", (q) => q.lt("sentAt", operationalCutoff))
      .take(limit);
    const expiredCheckouts = await ctx.db
      .query("publicStripeCheckouts")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "expired").lt("expiresAt", expiredCheckoutCutoff)
      )
      .take(limit);

    const emailJobsSent = await ctx.db
      .query("emailJobs")
      .withIndex("by_status_scheduled", (q) =>
        q.eq("status", "sent").lt("scheduledAt", operationalCutoff)
      )
      .take(limit);
    const emailJobsCancelled = await ctx.db
      .query("emailJobs")
      .withIndex("by_status_scheduled", (q) =>
        q.eq("status", "cancelled").lt("scheduledAt", operationalCutoff)
      )
      .take(limit);
    const emailJobsFailed = await ctx.db
      .query("emailJobs")
      .withIndex("by_status_scheduled", (q) =>
        q.eq("status", "failed").lt("scheduledAt", failedEmailJobCutoff)
      )
      .take(limit);

    const twilioSessionsExpired = await ctx.db
      .query("twilioCallSessions")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "expired").lt("expiresAt", twilioSessionCutoff)
      )
      .take(limit);
    const twilioSessionsUsed = await ctx.db
      .query("twilioCallSessions")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "used").lt("expiresAt", twilioSessionCutoff)
      )
      .take(limit);
    const twilioSessionsFailed = await ctx.db
      .query("twilioCallSessions")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "failed").lt("expiresAt", twilioSessionCutoff)
      )
      .take(limit);
    const twilioSessionsPendingExpired = await ctx.db
      .query("twilioCallSessions")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "pending").lt("expiresAt", twilioSessionCutoff)
      )
      .take(limit);

    return {
      providerEvents: await deleteDocs(ctx, providerEvents),
      emailLogs: await deleteDocs(ctx, emailLogs),
      emailJobsSent: await deleteDocs(ctx, emailJobsSent),
      emailJobsCancelled: await deleteDocs(ctx, emailJobsCancelled),
      emailJobsFailed: await deleteDocs(ctx, emailJobsFailed),
      twilioSessionsExpired: await deleteDocs(ctx, twilioSessionsExpired),
      twilioSessionsUsed: await deleteDocs(ctx, twilioSessionsUsed),
      twilioSessionsFailed: await deleteDocs(ctx, twilioSessionsFailed),
      twilioSessionsPendingExpired: await deleteDocs(ctx, twilioSessionsPendingExpired),
      expiredPublicStripeCheckouts: await deleteDocs(ctx, expiredCheckouts),
    };
  },
});
