import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth, requireWorkspace } from "./authHelpers";
import { upsertLearningExampleForCall } from "./agentLearning";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";
import { clampListLimit, contactLookup, listSnippet } from "./notes";

const speakerRoleValidator = v.union(
  v.literal("caller"),
  v.literal("representative"),
  v.literal("institution"),
  v.literal("subject"),
  v.literal("other")
);

const speakerMappingInputValidator = v.object({
  label: v.string(),
  name: v.string(),
  role: speakerRoleValidator,
});

export const getTranscriptByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return null;
    return await ctx.db
      .query("transcripts")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
  },
});

export const updateSpeakerMappings = mutation({
  args: {
    transcriptId: v.id("transcripts"),
    mappings: v.array(speakerMappingInputValidator),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const userId = await requireAuth(ctx);
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || transcript.workspaceId !== workspaceId) {
      throw new Error("Transcript not found");
    }

    const normalized = args.mappings.map((mapping) => ({
      label: mapping.label.trim(),
      name: mapping.name.trim(),
      role: mapping.role,
      source: "user_edited" as const,
    }));

    if (normalized.some((mapping) => !mapping.label || !mapping.name)) {
      throw new Error("Speaker labels and names are required.");
    }

    const uniqueLabels = new Set(normalized.map((mapping) => mapping.label));
    if (uniqueLabels.size !== normalized.length) {
      throw new Error("Speaker labels must be unique.");
    }

    await ctx.db.patch(args.transcriptId, {
      speakerMappings: normalized,
      originalSpeakerMappings: transcript.originalSpeakerMappings ?? transcript.speakerMappings,
      speakerMappingsEditedAt: Date.now(),
      speakerMappingsEditedBy: userId,
    });

    await upsertLearningExampleForCall(ctx, transcript.callId, "speaker_mapping_corrected");
    await refreshCallMemorySearchDocsForCall(ctx, transcript.callId);
  },
});

export const resetSpeakerMappings = mutation({
  args: { transcriptId: v.id("transcripts") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || transcript.workspaceId !== workspaceId) {
      throw new Error("Transcript not found");
    }
    if (!transcript.originalSpeakerMappings) {
      throw new Error("No AI speaker mapping is available to restore.");
    }

    await ctx.db.patch(args.transcriptId, {
      speakerMappings: transcript.originalSpeakerMappings,
      speakerMappingsEditedAt: undefined,
      speakerMappingsEditedBy: undefined,
    });
    await refreshCallMemorySearchDocsForCall(ctx, transcript.callId);
  },
});

export const getRecentTranscriptPreviews = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 3, 10));
    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const rows = await Promise.all(
      transcripts.map(async (transcript) => {
        const call = await ctx.db.get(transcript.callId);
        if (!call || call.workspaceId !== workspaceId) return null;
        const memory = await ctx.db
          .query("aiMemories")
          .withIndex("by_call", (q) => q.eq("callId", call._id))
          .first();
        return { transcript, call, memory };
      })
    );

    return rows
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => new Date(b.call.startedAt).getTime() - new Date(a.call.startedAt).getTime())
      .slice(0, limit);
  },
});

// Transcript list query: a bounded newest-first scan over calls with trimmed
// rows (a short segment preview instead of the full transcript) so the Call
// Records transcript list payload stays small. Each scanned row loads a
// transcript doc, so the scan bound is tighter than the notes list's.
export const listTranscriptRecords = query({
  args: {
    search: v.optional(v.string()),
    filter: v.optional(v.union(
      v.literal("all"),
      v.literal("corrected"),
      v.literal("ai_inferred")
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const search = args.search?.trim().toLowerCase() ?? "";
    const filter = args.filter ?? "all";
    const limit = clampListLimit(args.limit);
    const scanLimit = Math.min(300, Math.max(limit * 3, 90));

    // One row past the bound tells us whether the calls scan reached the end
    // of the workspace's calls; if not, total/hasMore are lower bounds.
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
        if (!call.transcriptId) return null;
        const transcript = await ctx.db.get(call.transcriptId);
        if (!transcript) return null;
        const [memory, contact] = await Promise.all([
          ctx.db
            .query("aiMemories")
            .withIndex("by_call", (q) => q.eq("callId", call._id))
            .first(),
          getContact(call.contactId),
        ]);
        return { transcript, call, memory, contact };
      })
    );

    // No sort: the index scan already yields newest first.
    const matched = joined
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => {
        const mappings = row.transcript.speakerMappings ?? [];
        if (filter === "corrected") {
          return mappings.some((mapping) => mapping.source === "user_edited");
        }
        if (filter === "ai_inferred") {
          return mappings.length > 0 && mappings.every((mapping) => mapping.source === "ai_inferred");
        }
        return true;
      })
      .filter((row) => {
        if (!search) return true;
        const speakerNames = (row.transcript.speakerMappings ?? []).map((mapping) => mapping.name).join(" ");
        const haystack = [
          row.call.dialedNumber,
          row.contact?.name,
          row.memory?.summary,
          speakerNames,
          row.transcript.text,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(search);
      });

    return {
      total: matched.length,
      totalIsLowerBound: !scanExhausted,
      hasMore: matched.length > limit || !scanExhausted,
      rows: matched.slice(0, limit).map((row) => {
        const rawSegments = row.transcript.segments.length > 0
          ? row.transcript.segments
          : [{ speaker: "combined", text: row.transcript.text }];
        return {
          transcriptId: row.transcript._id,
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
          summary: listSnippet(row.memory?.summary, 240),
          speakerMappings: (row.transcript.speakerMappings ?? []).map((mapping) => ({
            label: mapping.label,
            name: mapping.name,
            source: mapping.source,
          })),
          segments: rawSegments.slice(0, 4).map((segment) => ({
            speaker: segment.speaker,
            text: listSnippet(segment.text, 220) ?? "",
          })),
        };
      }),
    };
  },
});
