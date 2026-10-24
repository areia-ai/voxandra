import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace, requireWorkspaceMembership } from "./authHelpers";
import { getWorkflowTemplate } from "../src/lib/workflow-templates";
import { seedDeterministicGuidanceItems } from "./callGuidance";
import {
  deleteCallMemorySearchForCall,
  refreshCallMemorySearchDocsForCall,
} from "./callMemorySearch";
import { releaseCallReservation } from "./billingHelpers";
import { syncThreadRollup } from "./threads";
import type { Id } from "./_generated/dataModel";

async function deleteAllByCallIndex(
  ctx: MutationCtx,
  table:
    | "agentLearningExamples"
    | "reviewSuggestions"
    | "extractedEntities"
    | "actionItems"
    | "reminders"
    | "callGuidanceItems"
    | "callKeypadEvents"
    | "translationSegments"
    | "callUtterances"
    | "aiMemories"
    | "transcripts"
    | "aiExtractionRuns"
    | "audioTranscriptionRuns"
    | "shadowAgentRuns"
    | "providerEvents"
    | "twilioCallSessions"
    | "realtimeSessions"
    | "agentRunEvents"
    | "approvalRequests",
  callId: Id<"calls">
) {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

export const getCallById = query({
  args: { id: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.id);
    if (!call || call.workspaceId !== workspaceId) return null;
    return call;
  },
});

export const getCallsByCaseId = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const caseItem = await ctx.db.get(args.caseId);
    if (!caseItem || caseItem.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("calls")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
  },
});

export const createSimulatedCall = mutation({
  args: {
    phoneNumber: v.string(),
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    objective: v.optional(v.string()),
    checklistItems: v.optional(v.array(v.string())),
    workflowTemplateKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId, profile } = await requireWorkspaceMembership(ctx);
    if (args.contactId) {
      const contact = await ctx.db.get(args.contactId);
      if (!contact || contact.workspaceId !== workspaceId) throw new Error("Contact not found");
    }
    if (args.caseId) {
      const caseItem = await ctx.db.get(args.caseId);
      if (!caseItem || caseItem.workspaceId !== workspaceId) throw new Error("Thread not found");
    }
    const startedAt = new Date().toISOString();
    const workflowTemplate = getWorkflowTemplate(args.workflowTemplateKey);
    const callId = await ctx.db.insert("calls", {
      workspaceId,
      createdByUserId: userId,
      createdByProfileId: profile._id,
      contactId: args.contactId,
      caseId: args.caseId,
      dialedNumber: args.phoneNumber.trim(),
      objective: args.objective,
      workflowTemplateKey: workflowTemplate.key,
      startedAt,
      durationSeconds: 0,
      status: "in_progress",
      processingStatus: "processing",
      aiMemoryReady: false,
      reviewPending: false,
      highlights: args.objective ? [args.objective] : ["Simulated call in progress"],
      userNotes: args.objective ?? "",
      simulated: true,
      callMode: "simulated",
    });
    await seedDeterministicGuidanceItems(ctx, {
      workspaceId,
      callId,
      checklistItems: args.checklistItems,
    });
    return callId;
  },
});

export const completeSimulatedCall = mutation({
  args: {
    callId: v.id("calls"),
    durationSeconds: v.number(),
    transcriptText: v.string(),
    transcriptLanguage: v.string(),
    transcriptConfidence: v.number(),
    transcriptSegments: v.array(
      v.object({ speaker: v.string(), text: v.string() })
    ),
    memoryDetectedCallType: v.string(),
    memorySummary: v.string(),
    memoryOutcome: v.string(),
    memoryConfidence: v.number(),
    memoryRequiredDocuments: v.array(v.string()),
    memoryHighlights: v.array(v.string()),
    reviewDetectedCallType: v.string(),
    reviewSummary: v.string(),
    reviewConfidence: v.number(),
    suggestedExistingCaseId: v.optional(v.id("cases")),
    suggestedNewCaseTitle: v.optional(v.string()),
    suggestedExistingContactId: v.optional(v.id("contacts")),
    suggestedNewContactName: v.optional(v.string()),
    suggestedNewContactType: v.optional(v.string()),
    suggestedNewContactCountry: v.optional(v.string()),
    suggestedNewContactPhone: v.optional(v.string()),
    reminderTitle: v.string(),
    reminderDueAt: v.string(),
    actionItemTitle: v.string(),
    actionItemDescription: v.string(),
    actionItemDueAt: v.optional(v.string()),
    entities: v.array(
      v.object({
        type: v.string(),
        label: v.string(),
        value: v.string(),
        confidence: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");

    // Create transcript
    const transcriptId = await ctx.db.insert("transcripts", {
      workspaceId,
      callId: args.callId,
      source: "simulated",
      text: args.transcriptText,
      language: args.transcriptLanguage,
      confidence: args.transcriptConfidence,
      segments: args.transcriptSegments,
    });

    // Create AI memory
    const memoryId = await ctx.db.insert("aiMemories", {
      workspaceId,
      callId: args.callId,
      caseId: call.caseId,
      detectedCallType: args.memoryDetectedCallType,
      summary: args.memorySummary,
      outcome: args.memoryOutcome,
      confidence: args.memoryConfidence,
      requiredDocuments: args.memoryRequiredDocuments,
      highlights: args.memoryHighlights,
      reviewStatus: "review_pending",
    });

    // Create review suggestion
    await ctx.db.insert("reviewSuggestions", {
      workspaceId,
      callId: args.callId,
      detectedCallType: args.reviewDetectedCallType,
      summary: args.reviewSummary,
      confidence: args.reviewConfidence,
      status: "pending",
      suggestedExistingCaseId: args.suggestedExistingCaseId,
      suggestedNewCaseTitle: args.suggestedNewCaseTitle,
      suggestedExistingContactId: args.suggestedExistingContactId,
      suggestedNewContactName: args.suggestedNewContactName,
      suggestedNewContactType: args.suggestedNewContactType,
      suggestedNewContactCountry: args.suggestedNewContactCountry,
      suggestedNewContactPhone: args.suggestedNewContactPhone,
      reminderTitle: args.reminderTitle,
      reminderDueAt: args.reminderDueAt,
      entitySuggestions: args.entities,
      actionItemSuggestions: [
        {
          title: args.actionItemTitle,
          description: args.actionItemDescription,
          dueAt: args.actionItemDueAt,
        },
      ],
    });

    // Update call
    await ctx.db.patch(args.callId, {
      durationSeconds: args.durationSeconds,
      status: "completed",
      processingStatus: "memory_ready",
      aiMemoryReady: true,
      reviewPending: true,
      transcriptId,
      memoryId,
      highlights: args.memoryHighlights,
      language: args.transcriptLanguage,
      callRecordLanguage: args.transcriptLanguage,
      callRecordLanguageSource: "legacy_transcript",
    });

    // Update wallet usage
    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (wallet) {
      await ctx.db.patch(wallet._id, {
        usageThisMonth:
          wallet.usageThisMonth + Math.max(1, Math.ceil(args.durationSeconds / 60)),
      });
    }

    await refreshCallMemorySearchDocsForCall(ctx, args.callId);

    return args.callId;
  },
});

export const updateCallUserNotes = mutation({
  args: {
    callId: v.id("calls"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    await ctx.db.patch(args.callId, { userNotes: args.notes });
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);
  },
});

export const linkCallToCase = mutation({
  args: {
    callId: v.id("calls"),
    caseId: v.id("cases"),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    await ctx.db.patch(args.callId, { caseId: args.caseId });
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);
  },
});

/**
 * Hard-delete a Call Record and its call-owned content.
 * Preserves billing ledger/reservations/usage charges and free-call claims.
 * Contacts and work threads are unlinked, not deleted.
 */
export const deleteCallRecord = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) {
      throw new Error("Call not found");
    }
    if (call.processingStatus === "calling") {
      throw new Error("Cannot delete a call that is still in progress. End the call first.");
    }

    const now = Date.now();
    await releaseCallReservation(ctx, {
      callId: args.callId,
      now,
      description: "Released reserved credits because the call record was deleted",
    });

    // Search index first so Ask/search cannot cite a half-deleted record.
    await deleteCallMemorySearchForCall(ctx, args.callId);

    await deleteAllByCallIndex(ctx, "agentLearningExamples", args.callId);
    await deleteAllByCallIndex(ctx, "reviewSuggestions", args.callId);
    await deleteAllByCallIndex(ctx, "extractedEntities", args.callId);
    await deleteAllByCallIndex(ctx, "actionItems", args.callId);
    await deleteAllByCallIndex(ctx, "reminders", args.callId);
    await deleteAllByCallIndex(ctx, "callGuidanceItems", args.callId);
    await deleteAllByCallIndex(ctx, "callKeypadEvents", args.callId);
    await deleteAllByCallIndex(ctx, "translationSegments", args.callId);
    await deleteAllByCallIndex(ctx, "callUtterances", args.callId);
    await deleteAllByCallIndex(ctx, "aiMemories", args.callId);
    await deleteAllByCallIndex(ctx, "transcripts", args.callId);
    await deleteAllByCallIndex(ctx, "aiExtractionRuns", args.callId);
    await deleteAllByCallIndex(ctx, "audioTranscriptionRuns", args.callId);
    await deleteAllByCallIndex(ctx, "shadowAgentRuns", args.callId);
    await deleteAllByCallIndex(ctx, "providerEvents", args.callId);
    await deleteAllByCallIndex(ctx, "twilioCallSessions", args.callId);
    await deleteAllByCallIndex(ctx, "approvalRequests", args.callId);
    await deleteAllByCallIndex(ctx, "agentRunEvents", args.callId);
    await deleteAllByCallIndex(ctx, "realtimeSessions", args.callId);

    // Billing / usage: preserve rows, clear optional callId links only.
    const ledgerEntries = await ctx.db
      .query("creditLedgerEntries")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const entry of ledgerEntries) {
      await ctx.db.patch(entry._id, { callId: undefined });
    }

    const usageEvents = await ctx.db
      .query("realtimeUsageEvents")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const event of usageEvents) {
      await ctx.db.patch(event._id, { callId: undefined });
    }

    const wallet = await ctx.db
      .query("walletSummaries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (wallet?.freeCallUsedCallId === args.callId) {
      await ctx.db.patch(wallet._id, { freeCallUsedCallId: undefined });
    }

    // Unlink from work threads / insights without deleting the thread.
    const threadId = call.caseId;
    if (threadId) {
      const thread = await ctx.db.get(threadId);
      if (thread && thread.workspaceId === workspaceId) {
        if (thread.callIds.includes(args.callId)) {
          await ctx.db.patch(threadId, {
            callIds: thread.callIds.filter((id) => id !== args.callId),
          });
        }

        const insights = await ctx.db
          .query("threadInsights")
          .withIndex("by_case", (q) => q.eq("caseId", threadId))
          .collect();
        for (const insight of insights) {
          if (!insight.evidenceCallIds.includes(args.callId)) continue;
          await ctx.db.patch(insight._id, {
            evidenceCallIds: insight.evidenceCallIds.filter((id) => id !== args.callId),
          });
        }
      }
    }

    // Delete the call before rollup so by_case queries no longer see it.
    await ctx.db.delete(args.callId);

    if (threadId) {
      await syncThreadRollup(ctx, threadId);
    }

    if (call.contactId) {
      const remaining = await ctx.db
        .query("calls")
        .withIndex("by_contact", (q) => q.eq("contactId", call.contactId!))
        .collect();
      const latest = remaining
        .slice()
        .sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        )[0];
      const contact = await ctx.db.get(call.contactId);
      if (contact && contact.workspaceId === workspaceId) {
        await ctx.db.patch(call.contactId, {
          lastCallAt: latest?.startedAt,
        });
      }
    }

    return { deleted: true as const };
  },
});
