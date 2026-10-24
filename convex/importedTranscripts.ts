import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";

const entityValidator = v.object({
  type: v.string(),
  label: v.string(),
  value: v.string(),
  confidence: v.number(),
});

const actionItemValidator = v.object({
  title: v.string(),
  description: v.string(),
  dueAt: v.union(v.string(), v.null()),
});

const reminderValidator = v.union(
  v.object({
    title: v.string(),
    remindAt: v.string(),
  }),
  v.null()
);

const participantCallerValidator = v.object({
  name: v.union(v.string(), v.null()),
  roleLabel: v.string(),
  confidence: v.number(),
  evidence: v.union(v.string(), v.null()),
});

const participantRepresentativeValidator = v.object({
  name: v.union(v.string(), v.null()),
  roleLabel: v.string(),
  confidence: v.number(),
  institutionName: v.union(v.string(), v.null()),
  evidence: v.union(v.string(), v.null()),
});

const participantInstitutionValidator = v.object({
  name: v.union(v.string(), v.null()),
  type: v.string(),
  confidence: v.number(),
  evidence: v.union(v.string(), v.null()),
});

const participantSubjectValidator = v.object({
  name: v.union(v.string(), v.null()),
  subjectType: v.string(),
  confidence: v.number(),
  evidence: v.union(v.string(), v.null()),
});

const participantsValidator = v.object({
  caller: participantCallerValidator,
  representative: participantRepresentativeValidator,
  institution: participantInstitutionValidator,
  subject: participantSubjectValidator,
});

function uniqueSpeakerLabels(segments: { speaker: string }[]) {
  return Array.from(new Set(
    segments
      .map((segment) => segment.speaker.trim())
      .filter((speaker) => speaker && speaker !== "combined")
  ));
}

function inferSpeakerMappings(
  labels: string[],
  participants: {
    caller: { name: string | null; confidence: number };
    representative: { name: string | null; institutionName: string | null; confidence: number };
    institution: { name: string | null; confidence: number };
    subject: { name: string | null; confidence: number };
  }
) {
  const candidates = [
    {
      role: "caller" as const,
      name: participants.caller.name ?? "Caller",
      confidence: participants.caller.confidence,
    },
    {
      role: "representative" as const,
      name: participants.representative.name ?? participants.institution.name ?? "Representative",
      confidence: participants.representative.confidence,
    },
    {
      role: participants.subject.name ? "subject" as const : "institution" as const,
      name: participants.subject.name ?? participants.institution.name ?? "Other speaker",
      confidence: participants.subject.name ? participants.subject.confidence : participants.institution.confidence,
    },
  ];

  return labels.map((label, index) => {
    const candidate = candidates[index] ?? {
      role: "other" as const,
      name: `Speaker ${label}`,
      confidence: 0.5,
    };
    return {
      label,
      name: candidate.name,
      role: candidate.role,
      source: "ai_inferred" as const,
      confidence: Math.max(0, Math.min(candidate.confidence, 1)),
    };
  });
}

export const getAIExtractionStatus = query({
  args: {},
  handler: async () => {
    const configured = Boolean(process.env.OPENAI_API_KEY);
    return {
      configured,
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    };
  },
});

export const getTranscriptionStatus = query({
  args: {},
  handler: async () => {
    const configured = Boolean(process.env.OPENAI_API_KEY);
    return {
      configured,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
      fallbackModels: process.env.OPENAI_TRANSCRIPTION_FALLBACK_MODELS || "gpt-4o-transcribe,gpt-transcribe",
    };
  },
});

export const createImportedCallDraft = internalMutation({
  args: {
    transcriptText: v.string(),
    phoneNumber: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    existingCaseId: v.optional(v.id("cases")),
    context: v.optional(v.string()),
    language: v.optional(v.string()),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const startedAt = new Date().toISOString();
    const callId = await ctx.db.insert("calls", {
      workspaceId,
      contactId: args.contactId,
      caseId: args.existingCaseId,
      dialedNumber: args.phoneNumber?.trim() || "Imported transcript",
      startedAt,
      durationSeconds: 0,
      status: "completed",
      processingStatus: "analyzing",
      aiMemoryReady: false,
      reviewPending: false,
      highlights: args.context ? [args.context] : ["Imported transcript"],
      userNotes: args.context ?? "",
      simulated: false,
      callMode: "imported",
      importContext: args.context,
      language: args.language,
    });

    const transcriptId = await ctx.db.insert("transcripts", {
      workspaceId,
      callId,
      source: "pasted",
      text: args.transcriptText,
      language: args.language?.trim() || "Unknown",
      confidence: 1,
      segments: [],
    });

    await ctx.db.patch(callId, { transcriptId });

    return callId;
  },
});

export const completeImportedAnalysis = internalMutation({
  args: {
    callId: v.id("calls"),
    detectedCallType: v.string(),
    summary: v.string(),
    outcome: v.string(),
    confidence: v.number(),
    keyPoints: v.array(v.string()),
    requiredDocuments: v.array(v.string()),
    language: v.union(v.string(), v.null()),
    entities: v.array(entityValidator),
    actionItems: v.array(actionItemValidator),
    reminder: reminderValidator,
    suggestedExistingCaseId: v.union(v.id("cases"), v.null()),
    suggestedNewCaseTitle: v.union(v.string(), v.null()),
    suggestedExistingContactId: v.union(v.id("contacts"), v.null()),
    suggestedContactName: v.union(v.string(), v.null()),
    suggestedContactType: v.union(v.string(), v.null()),
    suggestedContactCountry: v.union(v.string(), v.null()),
    suggestedContactPhone: v.union(v.string(), v.null()),
    riskFlags: v.array(v.string()),
    promptVersion: v.optional(v.string()),
    model: v.optional(v.string()),
    participants: v.optional(participantsValidator),
    workspaceId: v.optional(v.id("workspaces")),
    replacePendingDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");

    if (args.replacePendingDraft) {
      if (!call.reviewPending) {
        throw new Error("Only a review-pending draft can be regenerated.");
      }
      const draftTables = [
        "reviewSuggestions",
        "aiMemories",
        "actionItems",
        "reminders",
        "extractedEntities",
      ] as const;
      for (const table of draftTables) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_call", (q) => q.eq("callId", args.callId))
          .collect();
        for (const row of rows) await ctx.db.delete(row._id);
      }
    }

    const highlights = args.keyPoints.length > 0
      ? args.keyPoints.slice(0, 3)
      : args.entities.slice(0, 3).map((entity) => entity.value);

    const memoryId = await ctx.db.insert("aiMemories", {
      workspaceId,
      callId: args.callId,
      caseId: call.caseId,
      detectedCallType: args.detectedCallType,
      summary: args.summary,
      outcome: args.outcome,
      confidence: args.confidence,
      requiredDocuments: args.requiredDocuments,
      highlights,
      reviewStatus: "review_pending",
      promptVersion: args.promptVersion,
      model: args.model,
      participants: args.participants,
    });

    const reviewSuggestionId = await ctx.db.insert("reviewSuggestions", {
      workspaceId,
      callId: args.callId,
      detectedCallType: args.detectedCallType,
      summary: args.summary,
      confidence: args.confidence,
      status: "pending",
      suggestedExistingCaseId: args.suggestedExistingCaseId ?? undefined,
      suggestedNewCaseTitle: args.suggestedNewCaseTitle ?? undefined,
      suggestedExistingContactId: args.suggestedExistingContactId ?? undefined,
      suggestedNewContactName: args.suggestedContactName ?? undefined,
      suggestedNewContactType: args.suggestedContactType ?? undefined,
      suggestedNewContactCountry: args.suggestedContactCountry ?? undefined,
      suggestedNewContactPhone: args.suggestedContactPhone ?? undefined,
      reminderTitle: args.reminder?.title,
      reminderDueAt: args.reminder?.remindAt,
      entitySuggestions: args.entities,
      actionItemSuggestions: args.actionItems
        .filter((item) => item.title.trim())
        .map((item) => ({
          title: item.title,
          description: item.description,
          dueAt: item.dueAt ?? undefined,
        })),
      promptVersion: args.promptVersion,
      model: args.model,
      participants: args.participants,
    });

    if (args.participants) {
      const transcript = await ctx.db
        .query("transcripts")
        .withIndex("by_call", (q) => q.eq("callId", args.callId))
        .first();
      const labels = transcript ? uniqueSpeakerLabels(transcript.segments) : [];
      if (transcript && labels.length > 1 && !transcript.speakerMappings?.some((mapping) => mapping.source === "user_edited")) {
        const mappings = inferSpeakerMappings(labels, args.participants);
        await ctx.db.patch(transcript._id, {
          speakerMappings: mappings,
          originalSpeakerMappings: transcript.originalSpeakerMappings ?? mappings,
        });
      }
    }

    await ctx.db.patch(args.callId, {
      processingStatus: "memory_ready",
      aiMemoryReady: true,
      reviewPending: true,
      memoryId,
      highlights,
      language: args.language ?? call.language,
      callRecordLanguage: args.language ?? call.callRecordLanguage,
      callRecordLanguageSource:
        args.replacePendingDraft
          ? "explicit"
          : call.callRecordLanguageSource ?? (args.language ? "legacy_transcript" : undefined),
      callRecordLanguagePreference: args.replacePendingDraft
        ? args.language ?? call.callRecordLanguagePreference
        : call.callRecordLanguagePreference,
    });

    if (call.isFreeCall) {
      await ctx.scheduler.runAfter(0, internal.emails.scheduleFreeCallMemoryReadyEmail, {
        callId: args.callId,
      });
    }

    return reviewSuggestionId;
  },
});

export const markImportedAnalysisFailed = internalMutation({
  args: {
    callId: v.id("calls"),
    errorMessage: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    await ctx.db.patch(args.callId, {
      processingStatus: "failed",
      reviewPending: false,
      aiMemoryReady: false,
      highlights: ["Extraction failed"],
    });
  },
});

export const cleanupFailedAnalysis = internalMutation({
  args: {
    callId: v.id("calls"),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const workspaceId = args.workspaceId ?? await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return;

    // Delete any existing review suggestion for this call
    const existingSuggestion = await ctx.db
      .query("reviewSuggestions")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    if (existingSuggestion) {
      await ctx.db.delete(existingSuggestion._id);
    }

    // Delete any existing AI memory for this call
    const existingMemory = await ctx.db
      .query("aiMemories")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    if (existingMemory) {
      await ctx.db.delete(existingMemory._id);
    }

    // Delete action items for this call
    const actionItems = await ctx.db
      .query("actionItems")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const item of actionItems) {
      await ctx.db.delete(item._id);
    }

    // Delete reminders for this call
    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const reminder of reminders) {
      await ctx.db.delete(reminder._id);
    }

    // Delete extracted entities for this call
    const entities = await ctx.db
      .query("extractedEntities")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const entity of entities) {
      await ctx.db.delete(entity._id);
    }

    // Reset call to analyzing state so retry can proceed cleanly
    await ctx.db.patch(args.callId, {
      processingStatus: "analyzing",
      aiMemoryReady: false,
      reviewPending: false,
      highlights: call.importContext ? [call.importContext] : ["Imported transcript"],
    });
  },
});
