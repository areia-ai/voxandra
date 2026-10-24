import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";

const MAX_SEARCH_BODY_CHARS = 6000;
const MAX_TRANSCRIPT_CHUNK_CHARS = 3200;
const MAX_TRANSCRIPT_CHUNKS_PER_CALL = 12;
const DEFAULT_SEARCH_LIMIT = 24;
const MAX_SEARCH_LIMIT = 60;
const DEFAULT_EMBEDDING_BATCH_LIMIT = 16;

const sourceTypeValidator = v.union(
  v.literal("overview"),
  v.literal("transcript"),
  v.literal("details"),
  v.literal("follow_up"),
  v.literal("user_notes")
);

type SourceType = Doc<"callMemorySearchDocs">["sourceType"];

export type SearchFilters = {
  contactId?: Id<"contacts">;
  caseId?: Id<"cases">;
  sourceTypes?: SourceType[];
  dateFrom?: string;
  dateTo?: string;
  hasReminder?: boolean;
  processingStatus?: string;
  reviewStatus?: string;
  limit?: number;
};

type SearchDocDraft = {
  workspaceId: Id<"workspaces">;
  callId: Id<"calls">;
  transcriptId?: Id<"transcripts">;
  memoryId?: Id<"aiMemories">;
  caseId?: Id<"cases">;
  contactId?: Id<"contacts">;
  docKey: string;
  sourceType: SourceType;
  title: string;
  body: string;
  snippet: string;
  anchor: string;
  language?: string;
  callStartedAt: string;
  callStartedAtMs: number;
  processingStatus: string;
  reviewStatus?: string;
  hasReminder: boolean;
  bodyHash: string;
};

const searchArgs = {
  search: v.optional(v.string()),
  contactId: v.optional(v.id("contacts")),
  caseId: v.optional(v.id("cases")),
  sourceTypes: v.optional(v.array(sourceTypeValidator)),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
  hasReminder: v.optional(v.boolean()),
  processingStatus: v.optional(v.string()),
  reviewStatus: v.optional(v.string()),
  limit: v.optional(v.number()),
};

function compact(value: string | null | undefined, limit = MAX_SEARCH_BODY_CHARS) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function compactMultiline(lines: Array<string | null | undefined>, limit = MAX_SEARCH_BODY_CHARS) {
  return lines
    .map((line) => compact(line, 1200))
    .filter(Boolean)
    .join("\n")
    .slice(0, limit)
    .trim();
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeLimit(limit: number | undefined, fallback = DEFAULT_SEARCH_LIMIT) {
  return Math.max(1, Math.min(limit ?? fallback, MAX_SEARCH_LIMIT));
}

function dateMs(value: string | undefined) {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : 0;
}

function speakerName(
  mappings: Doc<"transcripts">["speakerMappings"],
  speaker: string
) {
  if (speaker === "combined") return "Transcript";
  return mappings?.find((mapping) => mapping.label === speaker)?.name ?? `Speaker ${speaker}`;
}

function splitLongLine(line: string, maxChars: number) {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxChars) {
    chunks.push(line.slice(index, index + maxChars));
  }
  return chunks;
}

function buildTranscriptChunks(transcript: Doc<"transcripts">) {
  const lines = transcript.segments.length > 0
    ? transcript.segments.map(
        (segment) =>
          `${speakerName(transcript.speakerMappings, segment.speaker)}: ${segment.text}`
      )
    : splitLongLine(transcript.text, MAX_TRANSCRIPT_CHUNK_CHARS);

  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const normalized = compact(line, MAX_TRANSCRIPT_CHUNK_CHARS);
    if (!normalized) continue;
    if ((current + "\n" + normalized).length > MAX_TRANSCRIPT_CHUNK_CHARS && current) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${normalized}` : normalized;
    if (chunks.length >= MAX_TRANSCRIPT_CHUNKS_PER_CALL) break;
  }
  if (current && chunks.length < MAX_TRANSCRIPT_CHUNKS_PER_CALL) chunks.push(current);
  return chunks;
}

function participantLines(memory: Doc<"aiMemories"> | null) {
  const participants = memory?.participants;
  if (!participants) return [];
  return [
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
  ].filter(Boolean) as string[];
}

function makeSearchDoc(input: {
  call: Doc<"calls">;
  transcript: Doc<"transcripts"> | null;
  memory: Doc<"aiMemories"> | null;
  contact: Doc<"contacts"> | null;
  thread: Doc<"cases"> | null;
  hasReminder: boolean;
  sourceType: SourceType;
  docKeySuffix: string;
  title: string;
  anchor: string;
  lines: Array<string | null | undefined>;
}) {
  const body = compactMultiline(input.lines);
  const snippet = compact(body, 420);
  return {
    workspaceId: input.call.workspaceId,
    callId: input.call._id,
    transcriptId: input.transcript?._id,
    memoryId: input.memory?._id,
    caseId: input.thread?._id ?? input.call.caseId,
    contactId: input.contact?._id ?? input.call.contactId,
    docKey: `${input.call._id}:${input.docKeySuffix}`,
    sourceType: input.sourceType,
    title: input.title,
    body,
    snippet,
    anchor: input.anchor,
    language:
      input.sourceType === "transcript"
        ? input.transcript?.language
        : input.call.callRecordLanguage ?? input.call.language ?? input.transcript?.language,
    callStartedAt: input.call.startedAt,
    callStartedAtMs: dateMs(input.call.startedAt),
    processingStatus: input.call.processingStatus,
    reviewStatus: input.memory?.reviewStatus,
    hasReminder: input.hasReminder,
    bodyHash: stableHash(body),
  } satisfies SearchDocDraft;
}

export async function getCallRecordParts(ctx: QueryCtx | MutationCtx, call: Doc<"calls">) {
  const [transcript, memory, entities, actionItems, reminders, contact, thread] =
    await Promise.all([
      call.transcriptId
        ? ctx.db.get(call.transcriptId)
        : ctx.db
            .query("transcripts")
            .withIndex("by_call", (q) => q.eq("callId", call._id))
            .first(),
      call.memoryId
        ? ctx.db.get(call.memoryId)
        : ctx.db
            .query("aiMemories")
            .withIndex("by_call", (q) => q.eq("callId", call._id))
            .first(),
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

  return {
    transcript: transcript?.workspaceId === call.workspaceId ? transcript : null,
    memory: memory?.workspaceId === call.workspaceId ? memory : null,
    entities: entities.filter((entity) => entity.workspaceId === call.workspaceId),
    actionItems: actionItems.filter((item) => item.workspaceId === call.workspaceId),
    reminders: reminders.filter((reminder) => reminder.workspaceId === call.workspaceId),
    contact: contact?.workspaceId === call.workspaceId ? contact : null,
    thread: thread?.workspaceId === call.workspaceId ? thread : null,
  };
}

async function buildSearchDocsForCall(ctx: QueryCtx | MutationCtx, call: Doc<"calls">) {
  const parts = await getCallRecordParts(ctx, call);
  const { transcript, memory, entities, actionItems, reminders, contact, thread } = parts;
  if (!transcript && !memory && !call.userNotes) return [];
  if (call.processingStatus === "calling") return [];

  const titleBase = contact?.name ?? memory?.participants?.institution.name ?? call.dialedNumber;
  const hasReminder = reminders.length > 0;
  const commonLines = [
    `Call date: ${call.startedAt}`,
    `Contact: ${contact?.name ?? call.dialedNumber}`,
    thread ? `Work thread: ${thread.title}` : undefined,
    call.objective ? `Objective: ${call.objective}` : undefined,
    memory?.detectedCallType ? `Call type: ${memory.detectedCallType}` : undefined,
    ...participantLines(memory),
  ];

  const docs: SearchDocDraft[] = [];
  docs.push(
    makeSearchDoc({
      call,
      transcript,
      memory,
      contact,
      thread,
      hasReminder,
      sourceType: "overview",
      docKeySuffix: "overview",
      title: `${titleBase} call record`,
      anchor: "#note",
      lines: [
        "Call Record Overview",
        ...commonLines,
        memory?.summary ? `Summary: ${memory.summary}` : undefined,
        memory?.outcome ? `Outcome: ${memory.outcome}` : undefined,
        memory?.highlights.length ? `Highlights: ${memory.highlights.join("; ")}` : undefined,
        memory?.requiredDocuments.length
          ? `Required documents: ${memory.requiredDocuments.join("; ")}`
          : undefined,
        call.highlights.length ? `Call highlights: ${call.highlights.join("; ")}` : undefined,
      ],
    })
  );

  if (entities.length > 0) {
    docs.push(
      makeSearchDoc({
        call,
        transcript,
        memory,
        contact,
        thread,
        hasReminder,
        sourceType: "details",
        docKeySuffix: "details",
        title: `${titleBase} extracted details`,
        anchor: "#extracted-details",
        lines: [
          "Extracted details",
          ...commonLines,
          ...entities.map(
            (entity) => `${entity.label}: ${entity.value} (${entity.type})`
          ),
        ],
      })
    );
  }

  if (actionItems.length > 0 || reminders.length > 0) {
    docs.push(
      makeSearchDoc({
        call,
        transcript,
        memory,
        contact,
        thread,
        hasReminder,
        sourceType: "follow_up",
        docKeySuffix: "follow-up",
        title: `${titleBase} follow-ups`,
        anchor: reminders.length > 0 ? "#reminders" : "#note",
        lines: [
          "Follow-ups and commitments",
          ...commonLines,
          ...actionItems.map(
            (item) =>
              `Action item: ${item.title}${item.dueAt ? ` due ${item.dueAt}` : ""}. ${item.description} Status: ${item.status}`
          ),
          ...reminders.map(
            (reminder) =>
              `Reminder: ${reminder.title} at ${reminder.remindAt}. Status: ${reminder.status}`
          ),
        ],
      })
    );
  }

  if (call.userNotes?.trim()) {
    docs.push(
      makeSearchDoc({
        call,
        transcript,
        memory,
        contact,
        thread,
        hasReminder,
        sourceType: "user_notes",
        docKeySuffix: "user-notes",
        title: `${titleBase} user notes`,
        anchor: "#user-notes",
        lines: ["User notes", ...commonLines, call.userNotes],
      })
    );
  }

  if (transcript) {
    buildTranscriptChunks(transcript).forEach((chunk, index) => {
      docs.push(
        makeSearchDoc({
          call,
          transcript,
          memory,
          contact,
          thread,
          hasReminder,
          sourceType: "transcript",
          docKeySuffix: `transcript-${index + 1}`,
          title: `${titleBase} transcript excerpt ${index + 1}`,
          anchor: "#transcript",
          lines: ["Transcript excerpt", ...commonLines, chunk],
        })
      );
    });
  }

  return docs.filter((doc) => doc.body.length > 0);
}

async function deleteEmbeddingsForSearchDoc(
  ctx: MutationCtx,
  searchDocId: Id<"callMemorySearchDocs">
) {
  const embeddings = await ctx.db
    .query("callMemoryEmbeddings")
    .withIndex("by_search_doc", (q) => q.eq("searchDocId", searchDocId))
    .collect();
  for (const embedding of embeddings) {
    await ctx.db.delete(embedding._id);
  }
}

function searchDocNeedsPatch(
  existing: Doc<"callMemorySearchDocs">,
  next: SearchDocDraft
) {
  return (
    existing.bodyHash !== next.bodyHash ||
    existing.title !== next.title ||
    existing.snippet !== next.snippet ||
    existing.anchor !== next.anchor ||
    existing.sourceType !== next.sourceType ||
    existing.caseId !== next.caseId ||
    existing.contactId !== next.contactId ||
    existing.transcriptId !== next.transcriptId ||
    existing.memoryId !== next.memoryId ||
    existing.callStartedAt !== next.callStartedAt ||
    existing.processingStatus !== next.processingStatus ||
    existing.reviewStatus !== next.reviewStatus ||
    existing.hasReminder !== next.hasReminder ||
    existing.language !== next.language
  );
}

export async function deleteCallMemorySearchForCall(
  ctx: MutationCtx,
  callId: Id<"calls">
) {
  const docs = await ctx.db
    .query("callMemorySearchDocs")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  for (const doc of docs) {
    await deleteEmbeddingsForSearchDoc(ctx, doc._id);
    await ctx.db.delete(doc._id);
  }

  // Belt-and-suspenders: embeddings keyed by call may outlive a doc delete race.
  const orphanEmbeddings = await ctx.db
    .query("callMemoryEmbeddings")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  for (const embedding of orphanEmbeddings) {
    await ctx.db.delete(embedding._id);
  }

  return { deletedDocs: docs.length, deletedEmbeddings: orphanEmbeddings.length };
}

export async function refreshCallMemorySearchDocsForCall(
  ctx: MutationCtx,
  callId: Id<"calls">
) {
  const call = await ctx.db.get(callId);
  if (!call) return { changed: false, docCount: 0 };

  const nextDocs = await buildSearchDocsForCall(ctx, call);
  const existingDocs = await ctx.db
    .query("callMemorySearchDocs")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  const existingByKey = new Map(existingDocs.map((doc) => [doc.docKey, doc]));
  const nextKeys = new Set(nextDocs.map((doc) => doc.docKey));
  const now = Date.now();
  let changed = false;
  let needsEmbedding = false;

  for (const doc of nextDocs) {
    const existing = existingByKey.get(doc.docKey);
    if (!existing) {
      await ctx.db.insert("callMemorySearchDocs", {
        ...doc,
        embeddingStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
      needsEmbedding = true;
      continue;
    }

    if (!searchDocNeedsPatch(existing, doc)) continue;
    const bodyChanged = existing.bodyHash !== doc.bodyHash;
    if (bodyChanged) {
      await deleteEmbeddingsForSearchDoc(ctx, existing._id);
    }
    await ctx.db.patch(existing._id, {
      ...doc,
      embeddingStatus: bodyChanged ? "pending" : existing.embeddingStatus,
      embeddingError: bodyChanged ? undefined : existing.embeddingError,
      updatedAt: now,
    });
    changed = true;
    needsEmbedding = needsEmbedding || bodyChanged;
  }

  for (const existing of existingDocs) {
    if (nextKeys.has(existing.docKey)) continue;
    await deleteEmbeddingsForSearchDoc(ctx, existing._id);
    await ctx.db.delete(existing._id);
    changed = true;
  }

  if (needsEmbedding && nextDocs.length > 0) {
    await ctx.scheduler.runAfter(0, internal.callMemorySearchActions.embedPendingCallMemoryDocs, {
      callId,
    });
  }

  return { changed, docCount: nextDocs.length };
}

function matchesFilters(doc: Doc<"callMemorySearchDocs">, filters: SearchFilters) {
  if (filters.contactId && doc.contactId !== filters.contactId) return false;
  if (filters.caseId && doc.caseId !== filters.caseId) return false;
  if (filters.sourceTypes?.length && !filters.sourceTypes.includes(doc.sourceType)) return false;
  if (filters.hasReminder !== undefined && doc.hasReminder !== filters.hasReminder) return false;
  if (filters.processingStatus && doc.processingStatus !== filters.processingStatus) return false;
  if (filters.reviewStatus && doc.reviewStatus !== filters.reviewStatus) return false;
  const fromMs = filters.dateFrom ? dateMs(filters.dateFrom) : 0;
  const toMs = filters.dateTo ? dateMs(filters.dateTo) : 0;
  if (fromMs && doc.callStartedAtMs < fromMs) return false;
  if (toMs && doc.callStartedAtMs > toMs) return false;
  return true;
}

export function toSearchResult(doc: Doc<"callMemorySearchDocs">, score?: number) {
  return {
    id: doc._id,
    callId: doc.callId,
    title: doc.title,
    snippet: doc.snippet,
    sourceType: doc.sourceType,
    anchor: doc.anchor,
    href: `/app/calls/${doc.callId}${doc.anchor}`,
    callStartedAt: doc.callStartedAt,
    processingStatus: doc.processingStatus,
    contactId: doc.contactId,
    caseId: doc.caseId,
    reviewStatus: doc.reviewStatus,
    hasReminder: doc.hasReminder,
    score,
  };
}

export async function runIndexedSearch(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  args: SearchFilters & { search?: string }
) {
  const limit = normalizeLimit(args.limit);
  const search = args.search?.trim();
  const candidateLimit = Math.min(limit * 4, 120);
  const docs = search
    ? await ctx.db
        .query("callMemorySearchDocs")
        .withSearchIndex("search_body", (q) =>
          q.search("body", search).eq("workspaceId", workspaceId)
        )
        .take(candidateLimit)
    : await ctx.db
        .query("callMemorySearchDocs")
        .withIndex("by_workspace_started", (q) => q.eq("workspaceId", workspaceId))
        .order("desc")
        .take(candidateLimit);

  return docs.filter((doc) => matchesFilters(doc, args)).slice(0, limit);
}

export const searchCallRecords = query({
  args: searchArgs,
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const docs = await runIndexedSearch(ctx, workspaceId, args);
    return docs.map((doc) => toSearchResult(doc));
  },
});

export const getCurrentWorkspaceForSearchAction = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await requireWorkspace(ctx);
  },
});

export const searchCallMemoryDocsInternal = internalQuery({
  args: searchArgs,
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const docs = await runIndexedSearch(ctx, workspaceId, args);
    return docs.map((doc, index) => ({
      ...doc,
      keywordRank: index + 1,
    }));
  },
});

export const getSearchDocsForVectorResults = internalQuery({
  args: {
    results: v.array(
      v.object({
        embeddingId: v.id("callMemoryEmbeddings"),
        score: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const rows = await Promise.all(
      args.results.map(async (result) => {
        const embedding = await ctx.db.get(result.embeddingId);
        if (!embedding || embedding.workspaceId !== workspaceId) return null;
        const doc = await ctx.db.get(embedding.searchDocId);
        if (!doc || doc.workspaceId !== workspaceId) return null;
        if (doc.bodyHash !== embedding.contentHash) return null;
        return { ...doc, vectorScore: result.score };
      })
    );
    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  },
});

export const listPendingEmbeddingDocs = internalQuery({
  args: {
    callId: v.optional(v.id("calls")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_EMBEDDING_BATCH_LIMIT, 32));
    const docs = args.callId
      ? await ctx.db
          .query("callMemorySearchDocs")
          .withIndex("by_call", (q) => q.eq("callId", args.callId!))
          .collect()
      : await ctx.db
          .query("callMemorySearchDocs")
          .withIndex("by_embedding_status", (q) => q.eq("embeddingStatus", "pending"))
          .take(limit);

    return docs
      .filter((doc) => doc.embeddingStatus === "pending")
      .filter((doc) => doc.body.trim().length > 0)
      .slice(0, limit);
  },
});

export const upsertCallMemoryEmbedding = internalMutation({
  args: {
    searchDocId: v.id("callMemorySearchDocs"),
    model: v.string(),
    dimensions: v.number(),
    embedding: v.array(v.float64()),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.searchDocId);
    if (!doc) return null;
    if (doc.bodyHash !== args.contentHash) return null;

    const existing = await ctx.db
      .query("callMemoryEmbeddings")
      .withIndex("by_search_doc", (q) => q.eq("searchDocId", args.searchDocId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        workspaceId: doc.workspaceId,
        callId: doc.callId,
        model: args.model,
        dimensions: args.dimensions,
        embedding: args.embedding,
        contentHash: args.contentHash,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("callMemoryEmbeddings", {
        workspaceId: doc.workspaceId,
        searchDocId: args.searchDocId,
        callId: doc.callId,
        model: args.model,
        dimensions: args.dimensions,
        embedding: args.embedding,
        contentHash: args.contentHash,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.searchDocId, {
      embeddingStatus: "embedded",
      embeddingError: undefined,
      updatedAt: now,
    });
    return args.searchDocId;
  },
});

export const markCallMemoryEmbeddingFailed = internalMutation({
  args: {
    searchDocIds: v.array(v.id("callMemorySearchDocs")),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const searchDocId of args.searchDocIds) {
      await ctx.db.patch(searchDocId, {
        embeddingStatus: "failed",
        embeddingError: args.errorMessage.slice(0, 500),
        updatedAt: now,
      });
    }
  },
});

export const refreshCallMemorySearchDocsForCallInternal = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    return await refreshCallMemorySearchDocsForCall(ctx, args.callId);
  },
});

export const listSearchableCallIdsForCurrentWorkspace = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    return calls
      .filter((call) => call.processingStatus !== "calling")
      .filter(
        (call) =>
          call.processingStatus === "memory_ready" ||
          Boolean(call.transcriptId || call.memoryId || call.userNotes)
      )
      .sort((a, b) => dateMs(b.startedAt) - dateMs(a.startedAt))
      .slice(0, limit)
      .map((call) => call._id);
  },
});
