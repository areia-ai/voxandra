import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";

const LIST_DEFAULT_LIMIT = 30;
const LIST_MAX_LIMIT = 200;
const LIST_SNIPPET_LENGTH = 400;

export function listSnippet(text: string | null | undefined, length = LIST_SNIPPET_LENGTH) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= length) return trimmed;
  return `${trimmed.slice(0, length).trimEnd()}…`;
}

export function clampListLimit(limit: number | undefined) {
  return Math.max(1, Math.min(limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT));
}

// Contacts repeat across calls, so parallel row joins share one fetch per
// contact — the cache holds the promise, which is what actually dedupes
// concurrent misses.
export function contactLookup(ctx: QueryCtx) {
  const cache = new Map<Id<"contacts">, Promise<Doc<"contacts"> | null>>();
  return (contactId: Id<"contacts"> | undefined) => {
    if (!contactId) return Promise.resolve(null);
    let pending = cache.get(contactId);
    if (!pending) {
      pending = ctx.db.get(contactId);
      cache.set(contactId, pending);
    }
    return pending;
  };
}

// Call Records list query: a bounded newest-first scan over calls with trimmed
// rows (snippets instead of full transcript/summary text) so the payload stays
// small as call history grows. Transcript text and entities are only loaded
// when a search needs them; the summary fallback transcript is only loaded for
// rows that actually render.
const LIST_MAX_SCAN = 800;

export async function listCallRecordsForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  args: {
    search?: string;
    filter?: "all" | "with_reminders" | "processing";
    limit?: number;
  }
) {
  const search = args.search?.trim().toLowerCase() ?? "";
  const filter = args.filter ?? "all";
  const limit = clampListLimit(args.limit);
  // Searching loads a transcript doc per matched row, so it gets the tighter
  // bound the transcripts list uses for the same reason.
  const scanLimit = search
    ? Math.min(300, Math.max(limit * 3, 90))
    : Math.min(LIST_MAX_SCAN, Math.max(limit * 4, 120));

  // One row past the bound tells us whether the scan reached the end of the
  // workspace's calls; if not, total/hasMore are lower bounds.
  const scanned = await ctx.db
    .query("calls")
    .withIndex("by_workspace_started", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .take(scanLimit + 1);
  const scanExhausted = scanned.length <= scanLimit;
  const calls = scanned.slice(0, scanLimit);

  const getContact = contactLookup(ctx);

  const joined = await Promise.all(
    calls.map(async (call) => {
      const [memory, callReminders, contact] = await Promise.all([
        ctx.db
          .query("aiMemories")
          .withIndex("by_call", (q) => q.eq("callId", call._id))
          .first(),
        ctx.db
          .query("reminders")
          .withIndex("by_call", (q) => q.eq("callId", call._id))
          .collect(),
        getContact(call.contactId),
      ]);
      return {
        call,
        contact,
        memory,
        transcriptAvailable: Boolean(call.transcriptId),
        reminderCount: callReminders.length,
        transcript: undefined as Doc<"transcripts"> | null | undefined,
        matchesSearch: true,
      };
    })
  );

  let matched = joined.filter((row) => {
    if (filter === "with_reminders") return row.reminderCount > 0;
    if (filter === "processing") {
      return !row.memory || !row.transcriptAvailable || row.call.processingStatus !== "memory_ready";
    }
    return Boolean(row.memory || row.transcriptAvailable || row.call.processingStatus !== "calling");
  });

  if (search) {
    await Promise.all(
      matched.map(async (row) => {
        const [entities, transcript] = await Promise.all([
          ctx.db
            .query("extractedEntities")
            .withIndex("by_call", (q) => q.eq("callId", row.call._id))
            .collect(),
          row.call.transcriptId ? ctx.db.get(row.call.transcriptId) : Promise.resolve(null),
        ]);
        row.transcript = transcript;
        const haystack = [
          row.call.dialedNumber,
          row.contact?.name,
          row.memory?.summary,
          row.memory?.outcome,
          transcript?.text,
          ...row.call.highlights,
          entities.map((entity) => `${entity.label} ${entity.value}`).join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        row.matchesSearch = haystack.includes(search);
      })
    );
    matched = matched.filter((row) => row.matchesSearch);
  }

  // No sort: the index scan already yields newest first.
  const pageRows = matched.slice(0, limit);
  await Promise.all(
    pageRows.map(async (row) => {
      if (row.memory?.summary || row.transcript !== undefined || !row.call.transcriptId) return;
      row.transcript = await ctx.db.get(row.call.transcriptId);
    })
  );

  return {
    total: matched.length,
    totalIsLowerBound: !scanExhausted,
    hasMore: matched.length > limit || !scanExhausted,
    rows: pageRows.map((row) => ({
      callId: row.call._id,
      startedAt: row.call.startedAt,
      dialedNumber: row.call.dialedNumber,
      inboundCallerNumber: row.call.inboundCallerNumber ?? null,
      callDirection: row.call.callDirection ?? null,
      inboundVoicemail: row.call.inboundVoicemail ?? null,
      status: row.call.status,
      processingStatus: row.call.processingStatus,
      durationSeconds: row.call.durationSeconds ?? null,
      contactName: row.contact?.name ?? null,
      summary: listSnippet(row.memory?.summary ?? row.transcript?.text),
      participants: [
        row.memory?.participants?.caller.name,
        row.memory?.participants?.representative.name,
        row.memory?.participants?.institution.name,
      ]
        .filter((name): name is string => Boolean(name))
        .slice(0, 3),
      reminderCount: row.reminderCount,
    })),
  };
}

export const listCallRecords = query({
  args: {
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
    const workspaceId = await requireWorkspace(ctx);
    return await listCallRecordsForWorkspace(ctx, workspaceId, args);
  },
});
