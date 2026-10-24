import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";
import { normalizePhoneE164, phoneNumbersMatch } from "../src/lib/phone";

type DbCtx = QueryCtx | MutationCtx;

type LearningSourceEvent =
  | "review_accepted"
  | "review_dismissed"
  | "speaker_mapping_corrected"
  | "memory_updated";

type ReviewedMeaningForRetrieval = {
  reviewedObjective?: string;
  outcomeStatus?: string;
  acceptedFollowUps: string[];
  correctedDetails: string[];
  unresolvedQuestions: string[];
  escalationTriggers: string[];
  humanCorrectionSummary?: string;
  playbookHint?: string;
  completeness: "complete" | "partial" | "needs_follow_up" | "uncertain";
  confidence: number;
  source: "review_accept" | "review_dismiss" | "memory_update" | "speaker_mapping_update";
  reviewedAt: number;
};

type DraftSnapshotForRetrieval = {
  detectedCallType?: string;
  summary?: string;
  confidence?: number;
  entities: string[];
  actions: string[];
  reminder?: string;
  participants: string[];
  capturedAt: number;
};

const learningSourceEventValidator = v.union(
  v.literal("review_accepted"),
  v.literal("review_dismissed"),
  v.literal("speaker_mapping_corrected"),
  v.literal("memory_updated")
);

const learningStatusValidator = v.union(
  v.literal("active"),
  v.literal("excluded")
);

function compact(value: string | null | undefined, limit = 800) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function compactList(values: Array<string | null | undefined>, limit: number) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const item = compact(value, 500);
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function sourceEventLabel(sourceEvent: LearningSourceEvent) {
  return sourceEvent.replace(/_/g, " ");
}

export function tokenize(value: string | undefined) {
  return compact(value, 1000)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

export function matchesAnyToken(haystack: string, tokens: string[]) {
  const lower = haystack.toLowerCase();
  return tokens.reduce((count, token) => count + (lower.includes(token) ? 1 : 0), 0);
}

async function getTranscriptForCall(ctx: DbCtx, call: Doc<"calls">) {
  if (call.transcriptId) {
    const transcript = await ctx.db.get(call.transcriptId);
    if (transcript?.workspaceId === call.workspaceId) return transcript;
  }
  return await ctx.db
    .query("transcripts")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .first();
}

async function getMemoryForCall(ctx: DbCtx, call: Doc<"calls">) {
  if (call.memoryId) {
    const memory = await ctx.db.get(call.memoryId);
    if (memory?.workspaceId === call.workspaceId) return memory;
  }
  return await ctx.db
    .query("aiMemories")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .first();
}

async function getSuggestionForCall(ctx: DbCtx, call: Doc<"calls">) {
  return await ctx.db
    .query("reviewSuggestions")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .first();
}

function buildSpeakerCorrections(transcript: Doc<"transcripts"> | null) {
  if (!transcript?.speakerMappings?.length) return [];
  const originalByLabel = new Map(
    (transcript.originalSpeakerMappings ?? []).map((mapping) => [
      mapping.label,
      mapping,
    ])
  );

  return compactList(
    transcript.speakerMappings
      .filter((mapping) => mapping.source === "user_edited")
      .map((mapping) => {
        const original = originalByLabel.get(mapping.label);
        const previous = original
          ? `${original.name} (${original.role})`
          : "AI inferred speaker";
        return `${mapping.label}: ${previous} -> ${mapping.name} (${mapping.role})`;
      }),
    8
  );
}

function buildRetrievalText(input: {
  sourceEvent: LearningSourceEvent;
  callType: string;
  language?: string;
  objective?: string;
  contact?: Doc<"contacts"> | null;
  thread?: Doc<"cases"> | null;
  summary: string;
  outcome?: string;
  keyFacts: string[];
  acceptedActions: string[];
  dismissedSuggestions: string[];
  speakerCorrections: string[];
  reviewedMeaning?: ReviewedMeaningForRetrieval;
  draftSnapshot?: DraftSnapshotForRetrieval;
  manualNotes?: string;
  realizedOutcomes: string[];
  openFollowUpCount: number;
  resolvedFollowUpCount: number;
}) {
  const reviewedMeaningLines = input.reviewedMeaning
    ? [
        "Reviewed meaning:",
        input.reviewedMeaning.reviewedObjective
          ? `Reviewed objective: ${input.reviewedMeaning.reviewedObjective}`
          : undefined,
        input.reviewedMeaning.outcomeStatus
          ? `Outcome/status: ${input.reviewedMeaning.outcomeStatus}`
          : undefined,
        input.reviewedMeaning.acceptedFollowUps.length
          ? `Accepted follow-ups: ${input.reviewedMeaning.acceptedFollowUps.join("; ")}`
          : undefined,
        input.reviewedMeaning.correctedDetails.length
          ? `Corrected details: ${input.reviewedMeaning.correctedDetails.join("; ")}`
          : undefined,
        input.reviewedMeaning.unresolvedQuestions.length
          ? `Open questions: ${input.reviewedMeaning.unresolvedQuestions.join("; ")}`
          : undefined,
        input.reviewedMeaning.escalationTriggers.length
          ? `Escalation triggers: ${input.reviewedMeaning.escalationTriggers.join("; ")}`
          : undefined,
        input.reviewedMeaning.humanCorrectionSummary
          ? `Human correction summary: ${input.reviewedMeaning.humanCorrectionSummary}`
          : undefined,
        input.reviewedMeaning.playbookHint
          ? `Playbook hint: ${input.reviewedMeaning.playbookHint}`
          : undefined,
        `Completeness: ${input.reviewedMeaning.completeness}`,
        `Reviewed meaning confidence: ${input.reviewedMeaning.confidence}`,
      ]
    : [];
  const draftLines = input.draftSnapshot
    ? [
        input.draftSnapshot.summary
          ? `AI draft snapshot summary: ${input.draftSnapshot.summary}`
          : undefined,
        input.draftSnapshot.entities.length
          ? `AI draft facts: ${input.draftSnapshot.entities.join("; ")}`
          : undefined,
        input.draftSnapshot.actions.length
          ? `AI draft follow-ups: ${input.draftSnapshot.actions.join("; ")}`
          : undefined,
        input.draftSnapshot.reminder
          ? `AI draft reminder: ${input.draftSnapshot.reminder}`
          : undefined,
      ]
    : [];
  const lines = [
    `Source event: ${sourceEventLabel(input.sourceEvent)}`,
    `Call type: ${input.callType}`,
    input.language ? `Language: ${input.language}` : undefined,
    input.objective ? `Objective: ${input.objective}` : undefined,
    input.contact ? `Contact: ${input.contact.name} (${input.contact.type})` : undefined,
    input.thread ? `Work thread: ${input.thread.title}` : undefined,
    `Reviewed summary: ${input.summary}`,
    input.outcome ? `Outcome: ${input.outcome}` : undefined,
    input.keyFacts.length ? `Key facts: ${input.keyFacts.join("; ")}` : undefined,
    input.acceptedActions.length
      ? `Accepted actions: ${input.acceptedActions.join("; ")}`
      : undefined,
    input.dismissedSuggestions.length
      ? `Dismissed suggestions: ${input.dismissedSuggestions.join("; ")}`
      : undefined,
    input.speakerCorrections.length
      ? `Speaker corrections: ${input.speakerCorrections.join("; ")}`
      : undefined,
    input.realizedOutcomes.length
      ? `Realized outcomes: ${input.realizedOutcomes.join("; ")}`
      : undefined,
    input.openFollowUpCount + input.resolvedFollowUpCount > 0
      ? `Follow-up status: ${input.resolvedFollowUpCount} resolved, ${input.openFollowUpCount} open`
      : undefined,
    input.manualNotes ? `Manual notes: ${input.manualNotes}` : undefined,
    ...reviewedMeaningLines,
    ...draftLines,
  ].filter(Boolean);

  return compact(lines.join("\n"), 6000);
}

async function buildLearningExample(
  ctx: DbCtx,
  call: Doc<"calls">,
  sourceEvent: LearningSourceEvent
) {
  const [
    transcript,
    memory,
    suggestion,
    entities,
    actionItems,
    reminders,
    contact,
    thread,
  ] = await Promise.all([
    getTranscriptForCall(ctx, call),
    getMemoryForCall(ctx, call),
    getSuggestionForCall(ctx, call),
    ctx.db
      .query("extractedEntities")
      .withIndex("by_call", (q) => q.eq("callId", call._id))
      .collect(),
    ctx.db
      .query("actionItems")
      .withIndex("by_call", (q) => q.eq("callId", call._id))
      .collect(),
    ctx.db
      .query("reminders")
      .withIndex("by_call", (q) => q.eq("callId", call._id))
      .collect(),
    call.contactId ? ctx.db.get(call.contactId) : Promise.resolve(null),
    call.caseId ? ctx.db.get(call.caseId) : Promise.resolve(null),
  ]);

  const safeContact = contact?.workspaceId === call.workspaceId ? contact : null;
  const safeThread = thread?.workspaceId === call.workspaceId ? thread : null;
  const reviewedMeaning =
    sourceEvent === "review_dismissed"
      ? suggestion?.reviewedMeaning ?? memory?.reviewedMeaning
      : memory?.reviewedMeaning ?? suggestion?.reviewedMeaning;
  const draftSnapshot = suggestion?.draftSnapshot;
  const manualNotes = compact(call.userNotes, 1000) || undefined;
  const callType = compact(
    memory?.detectedCallType ??
      suggestion?.detectedCallType ??
      call.workflowTemplateKey ??
      call.callMode,
    120
  );
  const summary = compact(
    sourceEvent === "review_dismissed"
      ? `Dismissed AI draft: ${
          suggestion?.summary ?? memory?.summary ?? "The workspace rejected this draft."
        }`
      : memory?.summary ??
          suggestion?.summary ??
          call.highlights.join("; ") ??
          "Reviewed call record",
    1200
  );
  const outcome = compact(reviewedMeaning?.outcomeStatus ?? memory?.outcome, 800) || undefined;
  const language = compact(transcript?.language ?? call.language, 80) || undefined;
  const objective =
    compact(reviewedMeaning?.reviewedObjective ?? call.objective ?? safeThread?.title, 500) ||
    undefined;

  const keyFacts =
    sourceEvent === "review_dismissed"
      ? []
      : compactList(
          [
            ...entities
              .filter((entity) => entity.workspaceId === call.workspaceId)
              .map((entity) => `${entity.label}: ${entity.value} (${entity.type})`),
            ...call.highlights.map((highlight) => `Highlight: ${highlight}`),
          ],
          12
        );

  const safeActionItems = actionItems.filter(
    (item) => item.workspaceId === call.workspaceId
  );
  const safeReminders = reminders.filter(
    (reminder) => reminder.workspaceId === call.workspaceId
  );

  const acceptedActions =
    sourceEvent === "review_dismissed"
      ? []
      : compactList(
          [
            ...safeActionItems.map(
              (item) =>
                `${item.title} [${item.status}]${item.dueAt ? ` due ${item.dueAt}` : ""}: ${item.description}`
            ),
            ...safeReminders.map(
              (reminder) =>
                `Reminder ${reminder.remindAt} [${reminder.status}]: ${reminder.title}`
            ),
            ...(reviewedMeaning?.acceptedFollowUps ?? []),
          ],
          10
        );

  const realizedOutcomes = compactList(
    [
      ...safeActionItems
        .filter((item) => item.status === "completed")
        .map(
          (item) =>
            `Completed action item: ${item.title}${item.dueAt ? ` (due ${item.dueAt})` : ""}`
        ),
      ...safeReminders
        .filter((reminder) => reminder.status === "completed")
        .map(
          (reminder) =>
            `Completed reminder: ${reminder.title} (due ${reminder.remindAt})`
        ),
    ],
    8
  );
  const resolvedFollowUpCount =
    safeActionItems.filter((item) => item.status === "completed").length +
    safeReminders.filter((reminder) => reminder.status === "completed").length;
  const openFollowUpCount =
    safeActionItems.length + safeReminders.length - resolvedFollowUpCount;

  const dismissedSuggestions =
    sourceEvent === "review_dismissed" && suggestion
      ? compactList(
          [
            `Rejected draft summary: ${suggestion.summary}`,
            suggestion.reminderTitle
              ? `Rejected reminder: ${suggestion.reminderTitle}${
                  suggestion.reminderDueAt ? ` due ${suggestion.reminderDueAt}` : ""
                }`
              : undefined,
            ...suggestion.entitySuggestions.map(
              (entity) => `Rejected fact: ${entity.label}: ${entity.value} (${entity.type})`
            ),
            ...suggestion.actionItemSuggestions.map(
              (item) => `Rejected action: ${item.title}: ${item.description}`
            ),
          ],
          12
        )
      : [];

  const speakerCorrections = buildSpeakerCorrections(transcript);
  const retrievalText = buildRetrievalText({
    sourceEvent,
    callType,
    language,
    objective,
    contact: safeContact,
    thread: safeThread,
    summary,
    outcome,
    keyFacts,
    acceptedActions,
    dismissedSuggestions,
    speakerCorrections,
    reviewedMeaning,
    draftSnapshot,
    manualNotes,
    realizedOutcomes,
    openFollowUpCount,
    resolvedFollowUpCount,
  });

  return {
    workspaceId: call.workspaceId,
    callId: call._id,
    transcriptId: transcript?._id,
    memoryId: memory?._id,
    reviewSuggestionId: suggestion?._id,
    caseId: safeThread?._id,
    contactId: safeContact?._id,
    sourceEvent,
    callType,
    language,
    objective,
    summary,
    outcome,
    keyFacts,
    acceptedActions,
    dismissedSuggestions,
    speakerCorrections,
    reviewedMeaning,
    draftSnapshot,
    manualNotes,
    realizedOutcomes,
    openFollowUpCount,
    resolvedFollowUpCount,
    retrievalText,
  };
}

export async function upsertLearningExampleForCall(
  ctx: MutationCtx,
  callId: Id<"calls">,
  sourceEvent: LearningSourceEvent
) {
  const call = await ctx.db.get(callId);
  if (!call) {
    throw new Error("Call not found");
  }

  const example = await buildLearningExample(ctx, call, sourceEvent);
  const existing = (
    await ctx.db
      .query("agentLearningExamples")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .collect()
  ).find((item) => item.sourceEvent === sourceEvent);

  const now = Date.now();
  const status =
    sourceEvent === "review_dismissed"
      ? "excluded"
      : existing?.status === "excluded"
        ? "excluded"
        : "active";

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...example,
      status,
      updatedAt: now,
    });
    return existing._id;
  }

  return await ctx.db.insert("agentLearningExamples", {
    ...example,
    status,
    createdAt: now,
    updatedAt: now,
  });
}

export async function refreshLearningExamplesForCall(
  ctx: MutationCtx,
  callId: Id<"calls">
) {
  const call = await ctx.db.get(callId);
  if (!call) return;

  const existing = await ctx.db
    .query("agentLearningExamples")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  if (!existing.length) return;

  const now = Date.now();
  const sourceEvents = [...new Set(existing.map((item) => item.sourceEvent))];
  for (const sourceEvent of sourceEvents) {
    const exampleId = await upsertLearningExampleForCall(ctx, callId, sourceEvent);
    const refreshed = await ctx.db.get(exampleId);
    if (refreshed && (refreshed.resolvedFollowUpCount ?? 0) > 0) {
      await ctx.db.patch(exampleId, { lastOutcomeAt: now });
    }
  }
}

export const listLearningExamples = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(learningStatusValidator),
    sourceEvent: v.optional(learningSourceEventValidator),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const examples = args.status
      ? await ctx.db
          .query("agentLearningExamples")
          .withIndex("by_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", args.status!)
          )
          .collect()
      : await ctx.db
          .query("agentLearningExamples")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect();

    return examples
      .filter((example) =>
        args.sourceEvent ? example.sourceEvent === args.sourceEvent : true
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
});

export async function findRelevantLearningExamples(
  ctx: DbCtx,
  args: {
    workspaceId: Id<"workspaces">;
    contact?: Doc<"contacts"> | null;
    thread?: Doc<"cases"> | null;
    phoneNumber?: string;
    objective?: string;
    limit?: number;
  }
) {
  const limit = Math.max(1, Math.min(args.limit ?? 5, 10));
  const contact = args.contact ?? null;
  const thread = args.thread ?? null;

  const examples = await ctx.db
    .query("agentLearningExamples")
    .withIndex("by_status", (q) =>
      q.eq("workspaceId", args.workspaceId).eq("status", "active")
    )
    .collect();

  const callById = new Map<Id<"calls">, Doc<"calls">>();
  if (args.phoneNumber) {
    const calls = await Promise.all(examples.map((example) => ctx.db.get(example.callId)));
    for (const call of calls) {
      if (call && call.workspaceId === args.workspaceId) {
        callById.set(call._id, call);
      }
    }
  }

  const objectiveTokens = tokenize(args.objective);
  const scored = examples.map((example) => {
    const call = callById.get(example.callId);
    let score = 0;
    if (thread && example.caseId === thread._id) score += 80;
    if (contact && example.contactId === contact._id) score += 70;
    if (
      args.phoneNumber &&
      call &&
      phoneNumbersMatch(call.dialedNumber, args.phoneNumber)
    ) {
      score += 40;
    }
    if (objectiveTokens.length) {
      score += matchesAnyToken(example.retrievalText, objectiveTokens) * 5;
      score += matchesAnyToken(example.summary, objectiveTokens) * 3;
    }
    if (!thread && !contact && !args.phoneNumber && !objectiveTokens.length) {
      score += 1;
    }
    return { example, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.example.updatedAt - a.example.updatedAt;
    })
    .slice(0, limit);
}

export const getAgentContextPreview = query({
  args: {
    phoneNumber: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    objective: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const normalizedPhone = normalizePhoneE164(args.phoneNumber);

    let contact: Doc<"contacts"> | null = null;
    if (args.contactId) {
      const contactRecord = await ctx.db.get(args.contactId);
      if (contactRecord?.workspaceId === workspaceId) {
        contact = contactRecord;
      }
    }
    if (!contact && normalizedPhone) {
      contact = await ctx.db
        .query("contacts")
        .withIndex("by_phone_e164", (q) =>
          q.eq("workspaceId", workspaceId).eq("phoneE164", normalizedPhone)
        )
        .first();
    }
    if (!contact && args.phoneNumber) {
      const contacts = await ctx.db
        .query("contacts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      contact =
        contacts.find((item) => phoneNumbersMatch(item.phoneNumber, args.phoneNumber!)) ??
        null;
    }

    let thread: Doc<"cases"> | null = null;
    if (args.caseId) {
      const caseRecord = await ctx.db.get(args.caseId);
      if (caseRecord?.workspaceId === workspaceId) {
        thread = caseRecord;
      }
    }
    if (!thread && contact?.relatedCaseIds.length) {
      const cases = await Promise.all(contact.relatedCaseIds.map((id) => ctx.db.get(id)));
      thread =
        cases
          .filter((caseItem): caseItem is Doc<"cases"> =>
            Boolean(caseItem && caseItem.workspaceId === workspaceId)
          )
          .sort(
            (a, b) =>
              new Date(b.lastCallAt).getTime() - new Date(a.lastCallAt).getTime()
          )[0] ?? null;
    }

    const scored = await findRelevantLearningExamples(ctx, {
      workspaceId,
      contact,
      thread,
      phoneNumber: args.phoneNumber,
      objective: args.objective,
      limit: args.limit,
    });

    return {
      contact,
      thread,
      objective: compact(args.objective, 500) || undefined,
      examples: scored.map(({ example, score }) => ({
          exampleId: example._id,
          callId: example.callId,
          sourceEvent: example.sourceEvent,
          score,
          callType: example.callType,
          summary: example.summary,
          outcome: example.outcome,
          keyFacts: example.keyFacts,
          acceptedActions: example.acceptedActions,
          dismissedSuggestions: example.dismissedSuggestions,
          speakerCorrections: example.speakerCorrections,
          reviewedMeaning: example.reviewedMeaning,
          draftSnapshot: example.draftSnapshot,
          manualNotes: example.manualNotes,
          realizedOutcomes: example.realizedOutcomes,
          openFollowUpCount: example.openFollowUpCount,
          resolvedFollowUpCount: example.resolvedFollowUpCount,
          retrievalText: example.retrievalText,
          updatedAt: example.updatedAt,
        })),
    };
  },
});

export const excludeLearningExample = mutation({
  args: { exampleId: v.id("agentLearningExamples") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const example = await ctx.db.get(args.exampleId);
    if (!example || example.workspaceId !== workspaceId) {
      throw new Error("Learning example not found");
    }
    await ctx.db.patch(args.exampleId, {
      status: "excluded",
      updatedAt: Date.now(),
    });
    return args.exampleId;
  },
});
