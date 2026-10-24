// Read-only data surface for the Voxandra MCP server (/api/mcp).
//
// These are public Convex functions, but they are NOT callable with user auth:
// every function requires the shared MCP_CONVEX_SECRET (known only to the
// Next.js server) plus the sha256 hash of a live API key. The workspace is
// always derived server-side from the key row — callers never supply a
// workspaceId. Responses are field-projected: no billing/margin fields, no
// recording fields, no provider internals, no model or prompt names.
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  getCallRecordParts,
  runIndexedSearch,
  type SearchFilters,
} from "./callMemorySearch";
import { listCallRecordsForWorkspace } from "./notes";
import { listActiveThreadsForWorkspace } from "./threads";
import { buildThreadIntelligence } from "./threadIntelligence";
import { buildPreCallBrief } from "./callPreparation";
import { normalizePhoneE164 } from "../src/lib/phone";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 120;

const sourceTypeValidator = v.union(
  v.literal("overview"),
  v.literal("transcript"),
  v.literal("details"),
  v.literal("follow_up"),
  v.literal("user_notes")
);

const guardArgs = {
  secret: v.string(),
  keyHash: v.string(),
};

function assertMcpSecret(secret: string) {
  const expected = process.env.MCP_CONVEX_SECRET;
  if (!expected || secret !== expected) {
    throw new ConvexError({ code: "unauthorized" });
  }
}

async function requireMcpWorkspace(
  ctx: QueryCtx | MutationCtx,
  args: { secret: string; keyHash: string }
) {
  assertMcpSecret(args.secret);
  const key = await ctx.db
    .query("apiKeys")
    .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
    .first();
  if (!key || key.revokedAt) {
    throw new ConvexError({ code: "invalid_key" });
  }
  return { workspaceId: key.workspaceId, keyId: key._id, key };
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(limit ?? fallback, max));
}

// ---------------------------------------------------------------------------
// Projections. Keep aligned with workspaces.exportWorkspaceData discipline:
// no cost/margin/billing fields, no recording fields, no provider identifiers,
// no model/prompt names, no confidence/evidence internals.
// ---------------------------------------------------------------------------

function projectCall(call: Doc<"calls">) {
  return {
    id: call._id,
    startedAt: call.startedAt,
    endedAt: call.endedAt ?? null,
    durationSeconds: call.durationSeconds ?? null,
    status: call.status,
    processingStatus: call.processingStatus,
    callDirection: call.callDirection ?? null,
    dialedNumber: call.dialedNumber,
    inboundCallerNumber: call.inboundCallerNumber ?? null,
    inboundVoicemail: call.inboundVoicemail ?? null,
    objective: call.objective ?? null,
    highlights: call.highlights,
    userNotes: call.userNotes ?? null,
    reviewPending: call.reviewPending,
    aiMemoryReady: call.aiMemoryReady,
    language: call.callRecordLanguage ?? call.language ?? null,
    contactId: call.contactId ?? null,
    threadId: call.caseId ?? null,
    workflowTemplateKey: call.workflowTemplateKey ?? null,
    simulated: call.simulated,
  };
}

function projectTranscript(transcript: Doc<"transcripts"> | null) {
  if (!transcript) return null;
  const mappings = transcript.speakerMappings ?? [];
  const nameForLabel = new Map(
    mappings.map((mapping) => [mapping.label, mapping.name])
  );
  return {
    text: transcript.text,
    language: transcript.language,
    segments: transcript.segments.map((segment) => ({
      speaker: nameForLabel.get(segment.speaker) || segment.speaker,
      text: segment.text,
      start: segment.start ?? null,
      end: segment.end ?? null,
    })),
    speakerMappings: mappings.map((mapping) => ({
      label: mapping.label,
      name: mapping.name,
      role: mapping.role,
    })),
  };
}

function projectMemory(memory: Doc<"aiMemories"> | null) {
  if (!memory) return null;
  const participants = memory.participants
    ? {
        caller: {
          name: memory.participants.caller.name,
          roleLabel: memory.participants.caller.roleLabel,
        },
        representative: {
          name: memory.participants.representative.name,
          roleLabel: memory.participants.representative.roleLabel,
          institutionName: memory.participants.representative.institutionName,
        },
        institution: {
          name: memory.participants.institution.name,
          type: memory.participants.institution.type,
        },
        subject: {
          name: memory.participants.subject.name,
          subjectType: memory.participants.subject.subjectType,
        },
      }
    : null;
  return {
    detectedCallType: memory.detectedCallType,
    summary: memory.summary,
    outcome: memory.outcome,
    highlights: memory.highlights,
    requiredDocuments: memory.requiredDocuments,
    reviewStatus: memory.reviewStatus,
    participants,
  };
}

function projectEntity(entity: Doc<"extractedEntities">) {
  return {
    type: entity.type,
    label: entity.label,
    value: entity.value,
  };
}

function projectActionItem(item: Doc<"actionItems">) {
  return {
    id: item._id,
    title: item.title,
    description: item.description,
    dueAt: item.dueAt ?? null,
    status: item.status,
    source: item.source,
    callId: item.callId ?? null,
    threadId: item.caseId ?? null,
  };
}

function projectReminder(reminder: Doc<"reminders">) {
  return {
    id: reminder._id,
    title: reminder.title,
    remindAt: reminder.remindAt,
    status: reminder.status,
    source: reminder.source,
    callId: reminder.callId ?? null,
    threadId: reminder.caseId ?? null,
    contactId: reminder.contactId ?? null,
  };
}

function projectContact(contact: Doc<"contacts"> | null) {
  if (!contact) return null;
  return {
    id: contact._id,
    name: contact.name,
    type: contact.type,
    country: contact.country,
    phoneNumber: contact.phoneNumber,
    notes: contact.notes,
    lastCallAt: contact.lastCallAt ?? null,
    threadIds: contact.relatedCaseIds,
  };
}

function projectThread(thread: Doc<"cases"> | null) {
  if (!thread) return null;
  return {
    id: thread._id,
    title: thread.title,
    type: thread.type,
    clientName: thread.clientName,
    status: thread.status,
    summary: thread.summary,
    lastCallAt: thread.lastCallAt,
    nextFollowUpAt: thread.nextFollowUpAt ?? null,
    callCount: thread.callIds.length,
    contactIds: thread.contactIds,
    openActionItemCount: thread.unresolvedActionItemIds.length,
  };
}

// ---------------------------------------------------------------------------
// Per-request usage tracking + rate limiting, called once per HTTP request by
// the /api/mcp route before any read runs.
// ---------------------------------------------------------------------------

export const touchApiKeyUsage = mutation({
  args: guardArgs,
  handler: async (ctx, args) => {
    const { keyId, key } = await requireMcpWorkspace(ctx, args);
    const now = Date.now();
    const windowStart = key.rateWindowStart ?? 0;
    const inWindow = now - windowStart < RATE_LIMIT_WINDOW_MS;
    const count = inWindow ? (key.rateWindowCount ?? 0) : 0;
    if (count >= RATE_LIMIT_PER_WINDOW) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
      );
      return { ok: false as const, code: "rate_limited" as const, retryAfterSeconds };
    }
    await ctx.db.patch(keyId, {
      lastUsedAt: now,
      rateWindowStart: inWindow ? windowStart : now,
      rateWindowCount: count + 1,
    });
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// Read tools.
// ---------------------------------------------------------------------------

export const mcpSearchCallRecords = query({
  args: {
    ...guardArgs,
    search: v.optional(v.string()),
    contactId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    sourceTypes: v.optional(v.array(sourceTypeValidator)),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    hasReminder: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    const filters: SearchFilters & { search?: string } = {
      search: args.search,
      contactId: args.contactId
        ? ctx.db.normalizeId("contacts", args.contactId) ?? undefined
        : undefined,
      caseId: args.threadId
        ? ctx.db.normalizeId("cases", args.threadId) ?? undefined
        : undefined,
      sourceTypes: args.sourceTypes,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      hasReminder: args.hasReminder,
      limit: args.limit,
    };
    // A provided-but-unresolvable id can never match anything.
    if ((args.contactId && !filters.contactId) || (args.threadId && !filters.caseId)) {
      return [];
    }
    const docs = await runIndexedSearch(ctx, workspaceId, filters);
    return docs.map((doc) => ({
      callId: doc.callId,
      title: doc.title,
      snippet: doc.snippet,
      sourceType: doc.sourceType,
      href: `/app/calls/${doc.callId}${doc.anchor}`,
      callStartedAt: doc.callStartedAt,
      processingStatus: doc.processingStatus,
      contactId: doc.contactId ?? null,
      threadId: doc.caseId ?? null,
      reviewStatus: doc.reviewStatus ?? null,
      hasReminder: doc.hasReminder,
    }));
  },
});

export const mcpGetCallRecord = query({
  args: {
    ...guardArgs,
    callId: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    const callId = ctx.db.normalizeId("calls", args.callId);
    const call = callId ? await ctx.db.get(callId) : null;
    if (!call || call.workspaceId !== workspaceId) {
      throw new ConvexError({ code: "not_found" });
    }
    const parts = await getCallRecordParts(ctx, call);
    return {
      call: projectCall(call),
      note: projectMemory(parts.memory),
      transcript: projectTranscript(parts.transcript),
      extractedDetails: parts.entities.map(projectEntity),
      actionItems: parts.actionItems.map(projectActionItem),
      reminders: parts.reminders.map(projectReminder),
      contact: projectContact(parts.contact),
      thread: projectThread(parts.thread),
    };
  },
});

export const mcpListCallRecords = query({
  args: {
    ...guardArgs,
    search: v.optional(v.string()),
    filter: v.optional(
      v.union(
        v.literal("all"),
        v.literal("with_reminders"),
        v.literal("processing")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    return await listCallRecordsForWorkspace(ctx, workspaceId, {
      search: args.search,
      filter: args.filter,
      limit: args.limit,
    });
  },
});

export const mcpListReminders = query({
  args: {
    ...guardArgs,
    status: v.optional(
      v.union(
        v.literal("upcoming"),
        v.literal("overdue"),
        v.literal("in_progress"),
        v.literal("completed")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    const limit = clampLimit(args.limit, 50, 200);
    const status = args.status;
    const reminders = status
      ? await ctx.db
          .query("reminders")
          .withIndex("by_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", status)
          )
          .collect()
      : await ctx.db
          .query("reminders")
          .withIndex("by_status", (q) => q.eq("workspaceId", workspaceId))
          .collect();
    return reminders
      .sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime())
      .slice(0, limit)
      .map(projectReminder);
  },
});

export const mcpListContacts = query({
  args: {
    ...guardArgs,
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    const limit = clampLimit(args.limit, 50, 200);
    const search = args.search?.trim().toLowerCase() ?? "";

    const normalizedPhone = normalizePhoneE164(args.search);
    if (normalizedPhone) {
      const byPhone = await ctx.db
        .query("contacts")
        .withIndex("by_phone_e164", (q) =>
          q.eq("workspaceId", workspaceId).eq("phoneE164", normalizedPhone)
        )
        .collect();
      if (byPhone.length > 0) {
        return byPhone.slice(0, limit).map((contact) => projectContact(contact));
      }
    }

    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return contacts
      .filter((contact) => {
        if (!search) return true;
        return (
          contact.name.toLowerCase().includes(search) ||
          contact.phoneNumber.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((contact) => projectContact(contact));
  },
});

export const mcpListThreads = query({
  args: {
    ...guardArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    const limit = clampLimit(args.limit, 8, 20);
    const rows = await listActiveThreadsForWorkspace(ctx, workspaceId, limit);
    return rows.map((row) => ({
      thread: projectThread(row.thread),
      openFollowUpCount: row.openFollowUpCount,
      callCount: row.callCount,
      nextFollowUpAt: row.nextFollowUpAt ?? null,
    }));
  },
});

export const mcpGetThread = query({
  args: {
    ...guardArgs,
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    const caseId = ctx.db.normalizeId("cases", args.threadId);
    const intelligence = caseId
      ? await buildThreadIntelligence(ctx, workspaceId, caseId)
      : null;
    if (!intelligence) {
      throw new ConvexError({ code: "not_found" });
    }
    return {
      thread: projectThread(intelligence.thread),
      callCount: intelligence.callCount,
      latestCallAt: intelligence.latestCallAt,
      openActionItems: intelligence.openActionItems.map(projectActionItem),
      overdueActionItems: intelligence.overdueActionItems.map(projectActionItem),
      openReminders: intelligence.openReminders.map(projectReminder),
      overdueReminders: intelligence.overdueReminders.map(projectReminder),
      latestKnownFacts: intelligence.latestKnownFacts,
      repeatedBlockers: intelligence.repeatedBlockers,
      suggestedNextObjective: intelligence.suggestedNextObjective,
      insights: [
        ...intelligence.deterministicInsights.map((insight) => ({
          type: insight.type,
          title: insight.title,
          detail: insight.detail,
          evidenceCallIds: insight.evidenceCallIds,
        })),
        ...intelligence.persistedInsights.map((insight) => ({
          type: insight.type,
          title: insight.title,
          detail: insight.detail,
          evidenceCallIds: insight.evidenceCallIds,
        })),
      ],
    };
  },
});

export const mcpPreCallBrief = query({
  args: {
    ...guardArgs,
    phoneNumber: v.optional(v.string()),
    contactId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    objective: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireMcpWorkspace(ctx, args);
    const brief = await buildPreCallBrief(ctx, workspaceId, {
      phoneNumber: args.phoneNumber,
      contactId: args.contactId
        ? ctx.db.normalizeId("contacts", args.contactId) ?? undefined
        : undefined,
      caseId: args.threadId
        ? ctx.db.normalizeId("cases", args.threadId) ?? undefined
        : undefined,
      objective: args.objective,
    });
    return {
      contact: projectContact(brief.contact),
      thread: projectThread(brief.thread),
      recentCalls: brief.recentCalls,
      openActionItems: brief.openActionItems.map(projectActionItem),
      openReminders: brief.openReminders.map(projectReminder),
      keyFacts: brief.keyFacts,
      suggestedObjective: brief.suggestedObjective,
      similarReviewedCalls: brief.similarReviewedCalls,
      checklist: brief.checklist,
    };
  },
});
