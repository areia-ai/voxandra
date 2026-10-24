import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";
import { normalizePhoneE164 } from "../src/lib/phone";
import { upsertLearningExampleForCall } from "./agentLearning";
import { scoreShadowPredictionForCall } from "./shadowAgentScoring";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";

const reviewedMeaningInputValidator = v.object({
  reviewedObjective: v.optional(v.string()),
  outcomeStatus: v.optional(v.string()),
  unresolvedQuestions: v.optional(v.array(v.string())),
  escalationTriggers: v.optional(v.array(v.string())),
  humanCorrectionSummary: v.optional(v.string()),
  playbookHint: v.optional(v.string()),
  completeness: v.optional(
    v.union(
      v.literal("complete"),
      v.literal("partial"),
      v.literal("needs_follow_up"),
      v.literal("uncertain")
    )
  ),
});

type ReviewMeaningInput = {
  reviewedObjective?: string;
  outcomeStatus?: string;
  unresolvedQuestions?: string[];
  escalationTriggers?: string[];
  humanCorrectionSummary?: string;
  playbookHint?: string;
  completeness?: "complete" | "partial" | "needs_follow_up" | "uncertain";
};

type AcceptedActionInput = {
  title: string;
  description: string;
  dueAt?: string;
  status: string;
};

type AcceptedReminderInput = {
  title: string;
  remindAt: string;
  status: string;
} | undefined;

function compact(value: string | null | undefined, limit = 500) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function compactList(values: Array<string | null | undefined>, limit: number) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const item = compact(value);
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function sameMeaning(left: string | null | undefined, right: string | null | undefined) {
  return compact(left).toLowerCase() === compact(right).toLowerCase();
}

function actionLabel(item: { title: string; description?: string; dueAt?: string | null }) {
  return compact(`${item.title}${item.dueAt ? ` due ${item.dueAt}` : ""}: ${item.description ?? ""}`);
}

function reminderLabel(reminder: AcceptedReminderInput) {
  if (!reminder?.title.trim()) return undefined;
  return compact(`Reminder ${reminder.remindAt}: ${reminder.title}`);
}

function suggestionReminderLabel(suggestion: Doc<"reviewSuggestions"> | null) {
  if (!suggestion?.reminderTitle) return undefined;
  return compact(`Reminder ${suggestion.reminderDueAt ?? "unscheduled"}: ${suggestion.reminderTitle}`);
}

function participantLines(participants: Doc<"reviewSuggestions">["participants"]) {
  if (!participants) return [];
  return compactList(
    [
      participants.caller.name
        ? `Caller: ${participants.caller.name} (${participants.caller.roleLabel})`
        : undefined,
      participants.representative.name
        ? `Representative: ${participants.representative.name} (${participants.representative.roleLabel})`
        : undefined,
      participants.institution.name
        ? `Institution: ${participants.institution.name} (${participants.institution.type})`
        : undefined,
      participants.subject.name
        ? `Subject: ${participants.subject.name} (${participants.subject.subjectType})`
        : undefined,
    ],
    8
  );
}

function draftSnapshotFromSuggestion(suggestion: Doc<"reviewSuggestions"> | null, capturedAt: number) {
  if (!suggestion) return undefined;
  return {
    detectedCallType: compact(suggestion.detectedCallType, 120) || undefined,
    summary: compact(suggestion.summary, 1200) || undefined,
    confidence: suggestion.confidence,
    entities: compactList(
      suggestion.entitySuggestions.map((entity) =>
        `${entity.label}: ${entity.value} (${entity.type})`
      ),
      16
    ),
    actions: compactList(suggestion.actionItemSuggestions.map(actionLabel), 12),
    reminder: suggestionReminderLabel(suggestion),
    participants: participantLines(suggestion.participants),
    capturedAt,
  };
}

function diffLists(
  before: string[],
  after: string[],
  labels: { added: string; removed: string }
) {
  const beforeSet = new Set(before.map((item) => item.toLowerCase()));
  const afterSet = new Set(after.map((item) => item.toLowerCase()));
  return [
    ...after.filter((item) => !beforeSet.has(item.toLowerCase())).map((item) => `${labels.added}: ${item}`),
    ...before.filter((item) => !afterSet.has(item.toLowerCase())).map((item) => `${labels.removed}: ${item}`),
  ];
}

function buildAcceptedFollowUps(actionItems: AcceptedActionInput[], reminder: AcceptedReminderInput) {
  return compactList(
    [
      ...actionItems
        .filter((item) => item.title.trim())
        .map((item) => actionLabel(item)),
      reminderLabel(reminder),
    ],
    12
  );
}

function buildCorrectionDetails(input: {
  suggestion: Doc<"reviewSuggestions"> | null;
  summary: string;
  entities: Array<{ type: string; label: string; value: string }>;
  actionItems: AcceptedActionInput[];
  reminder: AcceptedReminderInput;
  participants: Doc<"reviewSuggestions">["participants"] | undefined;
}) {
  const suggestion = input.suggestion;
  const corrections: string[] = [];
  if (suggestion && !sameMeaning(suggestion.summary, input.summary)) {
    corrections.push(
      `Summary corrected from "${compact(suggestion.summary, 180)}" to "${compact(input.summary, 180)}"`
    );
  }

  const beforeEntities = compactList(
    (suggestion?.entitySuggestions ?? []).map((entity) =>
      `${entity.label}: ${entity.value} (${entity.type})`
    ),
    24
  );
  const afterEntities = compactList(
    input.entities.map((entity) => `${entity.label}: ${entity.value} (${entity.type})`),
    24
  );
  corrections.push(...diffLists(beforeEntities, afterEntities, {
    added: "Detail accepted or added",
    removed: "Draft detail removed",
  }));

  const beforeActions = compactList((suggestion?.actionItemSuggestions ?? []).map(actionLabel), 16);
  const afterActions = compactList(input.actionItems.map(actionLabel), 16);
  corrections.push(...diffLists(beforeActions, afterActions, {
    added: "Follow-up accepted or added",
    removed: "Draft follow-up removed",
  }));

  const beforeReminder = suggestionReminderLabel(suggestion);
  const afterReminder = reminderLabel(input.reminder);
  if (!sameMeaning(beforeReminder, afterReminder)) {
    if (afterReminder) corrections.push(`Reminder accepted or changed: ${afterReminder}`);
    if (beforeReminder && !afterReminder) corrections.push(`Draft reminder removed: ${beforeReminder}`);
  }

  const beforeParticipants = participantLines(suggestion?.participants);
  const afterParticipants = participantLines(input.participants);
  corrections.push(...diffLists(beforeParticipants, afterParticipants, {
    added: "Participant detail accepted or corrected",
    removed: "Draft participant detail removed",
  }));

  return compactList(corrections, 18);
}

function confidenceForCompleteness(completeness: ReviewMeaningInput["completeness"]) {
  if (completeness === "complete") return 0.95;
  if (completeness === "partial") return 0.7;
  if (completeness === "needs_follow_up") return 0.55;
  return 0.4;
}

function buildReviewedMeaning(input: {
  reviewedMeaning?: ReviewMeaningInput;
  call: Doc<"calls">;
  threadTitle?: string;
  acceptedFollowUps: string[];
  correctedDetails: string[];
  source: "review_accept" | "review_dismiss";
  reviewedAt: number;
}) {
  const completeness =
    input.reviewedMeaning?.completeness ??
    (input.source === "review_dismiss" ? "uncertain" : "partial");
  return {
    reviewedObjective:
      compact(input.reviewedMeaning?.reviewedObjective ?? input.call.objective ?? input.threadTitle, 700) ||
      undefined,
    outcomeStatus: compact(input.reviewedMeaning?.outcomeStatus, 700) || undefined,
    acceptedFollowUps: input.acceptedFollowUps,
    correctedDetails: input.correctedDetails,
    unresolvedQuestions: compactList(input.reviewedMeaning?.unresolvedQuestions ?? [], 12),
    escalationTriggers: compactList(input.reviewedMeaning?.escalationTriggers ?? [], 12),
    humanCorrectionSummary: compact(input.reviewedMeaning?.humanCorrectionSummary, 1000) || undefined,
    playbookHint: compact(input.reviewedMeaning?.playbookHint, 1000) || undefined,
    completeness,
    confidence: confidenceForCompleteness(completeness),
    source: input.source,
    reviewedAt: input.reviewedAt,
  };
}

export const getReviewSuggestionByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return null;
    return await ctx.db
      .query("reviewSuggestions")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
  },
});

export const acceptReviewSuggestion = mutation({
  args: {
    callId: v.id("calls"),
    summary: v.string(),
    extractedEntities: v.array(
      v.object({
        type: v.string(),
        label: v.string(),
        value: v.string(),
        confidence: v.number(),
      })
    ),
    actionItems: v.array(
      v.object({
        id: v.optional(v.string()),
        title: v.string(),
        description: v.string(),
        dueAt: v.optional(v.string()),
        status: v.string(),
      })
    ),
    reminder: v.optional(
      v.object({
        id: v.optional(v.string()),
        title: v.string(),
        remindAt: v.string(),
        status: v.string(),
      })
    ),
    caseId: v.optional(v.id("cases")),
    newCaseTitle: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    contactCreation: v.optional(
      v.object({
        name: v.string(),
        type: v.string(),
        country: v.string(),
        phoneNumber: v.string(),
      })
    ),
    participants: v.optional(
      v.object({
        caller: v.object({
          name: v.union(v.string(), v.null()),
          roleLabel: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
        representative: v.object({
          name: v.union(v.string(), v.null()),
          roleLabel: v.string(),
          confidence: v.number(),
          institutionName: v.union(v.string(), v.null()),
          evidence: v.union(v.string(), v.null()),
        }),
        institution: v.object({
          name: v.union(v.string(), v.null()),
          type: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
        subject: v.object({
          name: v.union(v.string(), v.null()),
          subjectType: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
      })
    ),
    reviewedMeaning: v.optional(reviewedMeaningInputValidator),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    const acceptedSource = call.simulated ? "simulated" : "openai";
    const reviewedAt = Date.now();
    const suggestion = await ctx.db
      .query("reviewSuggestions")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    const draftSnapshot = draftSnapshotFromSuggestion(suggestion, reviewedAt);

    // Determine final contactId first (case creation may need it)
    // Use participant-aware logic: institution becomes the contact, not the caller
    let finalContactId = args.contactId;
    const institutionName = args.participants?.institution?.name ?? null;
    const institutionType = args.participants?.institution?.type ?? "other";

    if (!finalContactId) {
      if (args.contactCreation) {
        // If user edited contact creation, use that; otherwise derive from institution
        const contactName = args.contactCreation.name || institutionName || "Unknown";
        const phoneE164 = normalizePhoneE164(args.contactCreation.phoneNumber);
        const newContactId = await ctx.db.insert("contacts", {
          workspaceId,
          name: contactName,
          type: args.contactCreation.type || institutionType,
          country: args.contactCreation.country,
          phoneNumber: args.contactCreation.phoneNumber,
          phoneE164: phoneE164 || undefined,
          lastCallAt: call.startedAt,
          relatedCaseIds: [],
          notes: `Created from a Voxandra post-call review suggestion. Institution inferred from transcript.`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        finalContactId = newContactId;
      } else if (institutionName) {
        // Auto-create contact from institution if no explicit contact creation provided
        const phoneE164 = normalizePhoneE164(call.dialedNumber);
        const newContactId = await ctx.db.insert("contacts", {
          workspaceId,
          name: institutionName,
          type: institutionType,
          country: "Unknown",
          phoneNumber: call.dialedNumber || "",
          phoneE164: phoneE164 || undefined,
          lastCallAt: call.startedAt,
          relatedCaseIds: [],
          notes: "Inferred institution from call transcript.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        finalContactId = newContactId;
      }
    }

    // Determine final caseId
    let finalCaseId = args.caseId;
    const subjectName = args.participants?.subject?.name ?? args.participants?.caller?.name ?? null;
    if (!finalCaseId && args.newCaseTitle) {
      const newCaseId = await ctx.db.insert("cases", {
        workspaceId,
        title: args.newCaseTitle,
        type: "AI-organized call follow-up",
        clientName: subjectName || "Unassigned",
        status: "active",
        lastCallAt: call.startedAt,
        callIds: [args.callId],
        contactIds: finalContactId ? [finalContactId] : [],
        unresolvedActionItemIds: [],
        summary: args.summary,
        workflowTemplateKey: call.workflowTemplateKey,
      });
      finalCaseId = newCaseId;
    }

    // Build representative note if available
    const repName = args.participants?.representative?.name;
    const repRole = args.participants?.representative?.roleLabel;
    const repInstitution = args.participants?.representative?.institutionName;
    let representativeNote = "";
    if (repName || repRole) {
      representativeNote = `Representative spoken to: ${repName || "Unknown"}${repRole ? ` (${repRole})` : ""}${repInstitution ? ` @ ${repInstitution}` : ""}. `;
    }

    // Update call
    await ctx.db.patch(args.callId, {
      caseId: finalCaseId,
      contactId: finalContactId,
      reviewPending: false,
      processingStatus: "memory_ready",
      highlights: args.extractedEntities.slice(0, 3).map((e) => e.value),
      userNotes: representativeNote + (call.userNotes || ""),
    });

    // Update contact
    if (finalContactId) {
      const existingContact = await ctx.db.get(finalContactId);
      if (existingContact) {
        const newCaseIds = [...existingContact.relatedCaseIds];
        if (finalCaseId && !newCaseIds.includes(finalCaseId)) newCaseIds.push(finalCaseId);

        await ctx.db.patch(finalContactId, {
          lastCallAt: call.startedAt,
          relatedCaseIds: newCaseIds,
          notes: existingContact.notes.includes("Recent call")
            ? existingContact.notes
            : `${existingContact.notes} Recent call record accepted on ${new Date().toLocaleDateString()}.`,
        });
      }
    }

    const finalThread = finalCaseId ? await ctx.db.get(finalCaseId) : null;
    const acceptedFollowUps = buildAcceptedFollowUps(args.actionItems, args.reminder);
    const correctedDetails = buildCorrectionDetails({
      suggestion,
      summary: args.summary,
      entities: args.extractedEntities,
      actionItems: args.actionItems,
      reminder: args.reminder,
      participants: args.participants,
    });
    const acceptedReviewedMeaning = buildReviewedMeaning({
      reviewedMeaning: args.reviewedMeaning,
      call,
      threadTitle: finalThread?.workspaceId === workspaceId ? finalThread.title : undefined,
      acceptedFollowUps,
      correctedDetails,
      source: "review_accept",
      reviewedAt,
    });

    // Update the extracted call record.
    const memory = await ctx.db
      .query("aiMemories")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    if (memory) {
      await ctx.db.patch(memory._id, {
        caseId: finalCaseId,
        summary: args.summary,
        requiredDocuments: args.extractedEntities
          .filter((e) => e.type === "required_document")
          .map((e) => e.value),
        highlights: args.extractedEntities.slice(0, 3).map((e) => e.value),
        reviewStatus: "accepted",
        reviewedMeaning: acceptedReviewedMeaning,
        participants: args.participants,
      });
    }

    // Replace extracted entities
    const existingEntities = await ctx.db
      .query("extractedEntities")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const entity of existingEntities) {
      await ctx.db.delete(entity._id);
    }
    for (const entity of args.extractedEntities) {
      await ctx.db.insert("extractedEntities", {
        workspaceId,
        callId: args.callId,
        caseId: finalCaseId,
        ...entity,
      });
    }

    // Replace generated action items with the edited accepted list.
    const existingActionItems = await ctx.db
      .query("actionItems")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    const previousActionItemIds = existingActionItems.map((item) => item._id);
    for (const item of existingActionItems) {
      await ctx.db.delete(item._id);
    }

    const acceptedActionItemIds: typeof previousActionItemIds = [];
    for (const item of args.actionItems) {
      if (!item.title.trim()) {
        continue;
      }
      const actionItemId = await ctx.db.insert("actionItems", {
        workspaceId,
        callId: args.callId,
        caseId: finalCaseId,
        title: item.title,
        description: item.description,
        dueAt: item.dueAt,
        status: item.status,
        source: acceptedSource,
      });
      if (item.status !== "completed") {
        acceptedActionItemIds.push(actionItemId);
      }
    }

    // Replace generated reminders with the edited accepted reminder.
    const existingReminders = await ctx.db
      .query("reminders")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const item of existingReminders) {
      await ctx.db.delete(item._id);
    }

    if (args.reminder) {
      await ctx.db.insert("reminders", {
        workspaceId,
        callId: args.callId,
        caseId: finalCaseId,
        contactId: finalContactId,
        title: args.reminder.title,
        remindAt: args.reminder.remindAt,
        status: args.reminder.status as "upcoming" | "overdue" | "in_progress" | "completed",
        source: acceptedSource,
      });
    }

    // Update or create case after accepted action item IDs exist.
    if (finalCaseId) {
      const existingCase = await ctx.db.get(finalCaseId);
      if (existingCase) {
        const newCallIds = [...existingCase.callIds];
        if (!newCallIds.includes(args.callId)) newCallIds.push(args.callId);

        const newContactIds = [...existingCase.contactIds];
        if (finalContactId && !newContactIds.includes(finalContactId)) newContactIds.push(finalContactId);

        const priorIds = new Set(previousActionItemIds);
        const retainedUnresolved = existingCase.unresolvedActionItemIds.filter((id) => !priorIds.has(id));
        const newUnresolved = [...retainedUnresolved];
        for (const actionItemId of acceptedActionItemIds) {
          if (!newUnresolved.includes(actionItemId)) newUnresolved.push(actionItemId);
        }

        await ctx.db.patch(finalCaseId, {
          lastCallAt: call.startedAt,
          callIds: newCallIds,
          contactIds: newContactIds,
          unresolvedActionItemIds: newUnresolved,
          summary: args.summary,
          workflowTemplateKey: existingCase.workflowTemplateKey ?? call.workflowTemplateKey,
        });
      }
    }

    // Update review suggestion
    if (suggestion) {
      await ctx.db.patch(suggestion._id, {
        status: "accepted",
        summary: args.summary,
        entitySuggestions: args.extractedEntities,
        actionItemSuggestions: args.actionItems.map((item) => ({
          title: item.title,
          description: item.description,
          dueAt: item.dueAt,
        })),
        suggestedExistingCaseId: finalCaseId,
        participants: args.participants,
        reviewedMeaning: acceptedReviewedMeaning,
        draftSnapshot,
      });
    }

    await upsertLearningExampleForCall(ctx, args.callId, "review_accepted");
    await scoreShadowPredictionForCall(ctx, {
      call,
      outcomeStatus: acceptedReviewedMeaning.outcomeStatus,
      acceptedFollowUps,
    });
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);

    return args.callId;
  },
});

export const dismissReviewSuggestion = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    const reviewedAt = Date.now();
    const suggestion = await ctx.db
      .query("reviewSuggestions")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    const draftSnapshot = draftSnapshotFromSuggestion(suggestion, reviewedAt);
    const thread = call.caseId ? await ctx.db.get(call.caseId) : null;
    const dismissedReviewedMeaning = buildReviewedMeaning({
      reviewedMeaning: {
        outcomeStatus: "AI draft dismissed before becoming a trusted Call Record.",
        completeness: "uncertain",
      },
      call,
      threadTitle: thread?.workspaceId === workspaceId ? thread.title : undefined,
      acceptedFollowUps: [],
      correctedDetails: compactList(
        [
          draftSnapshot?.summary
            ? `Dismissed draft summary: ${draftSnapshot.summary}`
            : "AI draft dismissed before review acceptance.",
        ],
        4
      ),
      source: "review_dismiss",
      reviewedAt,
    });

    await ctx.db.patch(args.callId, {
      reviewPending: false,
      processingStatus: "memory_ready",
    });

    const memory = await ctx.db
      .query("aiMemories")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    if (memory) {
      await ctx.db.patch(memory._id, {
        reviewStatus: "dismissed",
        reviewedMeaning: dismissedReviewedMeaning,
      });
    }

    if (suggestion) {
      await ctx.db.patch(suggestion._id, {
        status: "dismissed",
        reviewedMeaning: dismissedReviewedMeaning,
        draftSnapshot,
      });
    }

    const actionItems = await ctx.db
      .query("actionItems")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const item of actionItems) {
      await ctx.db.delete(item._id);
    }

    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const reminder of reminders) {
      await ctx.db.delete(reminder._id);
    }

    const entities = await ctx.db
      .query("extractedEntities")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const entity of entities) {
      await ctx.db.delete(entity._id);
    }

    await upsertLearningExampleForCall(ctx, args.callId, "review_dismissed");
    await scoreShadowPredictionForCall(ctx, {
      call,
      outcomeStatus: dismissedReviewedMeaning.outcomeStatus,
      acceptedFollowUps: [],
    });
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);

    return args.callId;
  },
});
