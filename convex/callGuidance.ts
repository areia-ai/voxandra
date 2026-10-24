import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";
import { buildPreCallBrief } from "./callPreparation";

type GuidanceStatus = "suggested" | "done" | "dismissed";
type RealtimeGuidanceType = "copilot" | "caption" | "translation_caption";
type RealtimeGuidanceSource = "live_copilot" | "translated_captions";
const LIVE_GUIDANCE_CONTEXT_VERSION = "live-guidance-context-v1";
const LIVE_GUIDANCE_CONTEXT_LIMITS = {
  maxGuidanceItems: 8,
  maxRecentCalls: 3,
  maxOpenItems: 4,
  maxKeyFacts: 6,
  maxSimilarReviewedCalls: 3,
};

function assertRealtimeWorkerSecret(secret: string) {
  const expectedSecret = process.env.REALTIME_CONVEX_WORKER_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    throw new Error("Realtime worker access denied");
  }
}

function assertRealtimeGuidanceTypeMatchesSource(args: {
  type: RealtimeGuidanceType;
  source: RealtimeGuidanceSource;
}) {
  if (args.source === "live_copilot" && args.type !== "copilot") {
    throw new Error("Live Guidance worker items must use copilot type.");
  }
  if (args.source === "translated_captions" && args.type === "copilot") {
    throw new Error("Live Translation worker items must use caption types.");
  }
}

async function assertRealtimeGuidanceSession(
  ctx: MutationCtx,
  args: {
    call: Doc<"calls">;
    realtimeSessionId?: Id<"realtimeSessions">;
    source: RealtimeGuidanceSource;
  }
) {
  if (!args.realtimeSessionId) return undefined;

  const session = await ctx.db.get(args.realtimeSessionId);
  if (
    !session ||
    session.workspaceId !== args.call.workspaceId ||
    session.callId !== args.call._id
  ) {
    throw new Error("Realtime guidance session not found for this call.");
  }

  const expectedMode =
    args.source === "live_copilot" ? "human_copilot" : "translated_captions";
  if (session.mode !== expectedMode) {
    throw new Error("Realtime guidance session mode does not match guidance source.");
  }

  return session._id;
}

export async function seedDeterministicGuidanceItems(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    callId: Id<"calls">;
    checklistItems?: string[];
  }
) {
  // The call checklist is user-authored in the dialer's Call prep section —
  // the manual companion to Live Guidance, available on every plan. No
  // template boilerplate is seeded; a call without a user checklist simply has
  // no checklist panel. (The workflow template's checklist still feeds the
  // Live Guidance AI context separately as deterministicChecklist.)
  const userItems = (args.checklistItems ?? [])
    .map((item) => item.trim().replace(/\.$/, "").slice(0, 180))
    .filter(Boolean)
    .slice(0, 12);
  if (userItems.length === 0) return;

  const now = Date.now();
  const existingItems = await ctx.db
    .query("callGuidanceItems")
    .withIndex("by_call", (q) => q.eq("callId", args.callId))
    .collect();
  const existingLabels = new Set(existingItems.map((item) => item.label));

  for (const label of userItems) {
    if (existingLabels.has(label)) continue;
    existingLabels.add(label);
    await ctx.db.insert("callGuidanceItems", {
      workspaceId: args.workspaceId,
      callId: args.callId,
      type: "checklist",
      label,
      status: "suggested",
      source: "user",
      createdAt: now,
      updatedAt: now,
    });
  }
}

export const listCallGuidanceItems = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];

    const items = await ctx.db
      .query("callGuidanceItems")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();

    return items.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const updateCallGuidanceItemStatus = mutation({
  args: {
    itemId: v.id("callGuidanceItems"),
    status: v.union(v.literal("suggested"), v.literal("done"), v.literal("dismissed")),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.workspaceId !== workspaceId) {
      throw new Error("Guidance item not found");
    }

    await ctx.db.patch(args.itemId, {
      status: args.status as GuidanceStatus,
      updatedAt: Date.now(),
    });
  },
});

export const addRealtimeGuidanceItemFromWorker = mutation({
  args: {
    secret: v.string(),
    callId: v.id("calls"),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    type: v.union(v.literal("copilot"), v.literal("caption"), v.literal("translation_caption")),
    label: v.string(),
    detail: v.optional(v.string()),
    source: v.union(v.literal("live_copilot"), v.literal("translated_captions")),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    const call = await ctx.db.get(args.callId);
    if (!call) {
      throw new Error("Call not found");
    }

    assertRealtimeGuidanceTypeMatchesSource({
      type: args.type,
      source: args.source,
    });
    const realtimeSessionId = await assertRealtimeGuidanceSession(ctx, {
      call,
      realtimeSessionId: args.realtimeSessionId,
      source: args.source,
    });

    const now = Date.now();
    return await ctx.db.insert("callGuidanceItems", {
      workspaceId: call.workspaceId,
      callId: args.callId,
      realtimeSessionId,
      type: args.type,
      label: args.label,
      detail: args.detail,
      status: "suggested",
      source: args.source,
      evidence: args.evidence,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getLiveGuidanceContextForWorker = mutation({
  args: {
    secret: v.string(),
    realtimeSessionId: v.id("realtimeSessions"),
  },
  handler: async (ctx, args) => {
    assertRealtimeWorkerSecret(args.secret);

    const session = await ctx.db.get(args.realtimeSessionId);
    if (
      !session ||
      !["human_copilot", "translated_captions"].includes(session.mode) ||
      !session.callId
    ) {
      throw new Error("Realtime call context session not found");
    }

    const call = await ctx.db.get(session.callId);
    if (!call || call.workspaceId !== session.workspaceId) {
      throw new Error("Call not found");
    }

    const preCallBrief = await buildPreCallBrief(ctx, call.workspaceId, {
      phoneNumber: call.dialedNumber,
      contactId: call.contactId,
      caseId: call.caseId,
      workflowTemplateKey: call.workflowTemplateKey,
      objective: call.objective,
    });
    const checklistItems = (
      await ctx.db
        .query("callGuidanceItems")
        .withIndex("by_call", (q) => q.eq("callId", call._id))
        .collect()
    )
      .filter((item) => item.type === "checklist" && item.status !== "dismissed")
      .slice(0, LIVE_GUIDANCE_CONTEXT_LIMITS.maxGuidanceItems);

    const reviewedCallMemories = preCallBrief.recentCalls
      .filter(
        (recentCall) =>
          recentCall.reviewPending !== true &&
          recentCall.summary !== "No reviewed memory yet."
      )
      .map((recentCall) => ({
        callId: recentCall.callId,
        summary: recentCall.summary,
        outcome: recentCall.outcome,
      }));

    const now = Date.now();
    const context = {
      version: LIVE_GUIDANCE_CONTEXT_VERSION,
      generatedAt: now,
      call: {
        callId: call._id,
        workspaceId: call.workspaceId,
        objective: call.objective,
        workflowTemplateKey: call.workflowTemplateKey,
        startedAt: call.startedAt,
      },
      template: {
        key: preCallBrief.template.key,
        label: preCallBrief.template.label,
        shortLabel: preCallBrief.template.shortLabel,
        objectivePrompt: preCallBrief.template.objectivePrompt,
        checklist: preCallBrief.template.checklist,
        extractionFocus: preCallBrief.template.extractionFocus,
      },
      prep: {
        suggestedObjective: preCallBrief.suggestedObjective,
        contactName: preCallBrief.contact?.name,
        contactType: preCallBrief.contact?.type,
        threadTitle: preCallBrief.thread?.title,
        recentCalls: preCallBrief.recentCalls.slice(0, LIVE_GUIDANCE_CONTEXT_LIMITS.maxRecentCalls),
        reviewedCallMemories,
        openActionItems: preCallBrief.openActionItems
          .slice(0, LIVE_GUIDANCE_CONTEXT_LIMITS.maxOpenItems)
          .map((item) => ({
            title: item.title,
            status: item.status,
          })),
        openReminders: preCallBrief.openReminders
          .slice(0, LIVE_GUIDANCE_CONTEXT_LIMITS.maxOpenItems)
          .map((item) => ({
            title: item.title,
            remindAt: item.remindAt,
            status: item.status,
          })),
        keyFacts: preCallBrief.keyFacts
          .slice(0, LIVE_GUIDANCE_CONTEXT_LIMITS.maxKeyFacts)
          .map((fact) => ({
            type: fact.type,
            label: fact.label,
            value: fact.value,
          })),
        similarReviewedCalls: preCallBrief.similarReviewedCalls
          .slice(0, LIVE_GUIDANCE_CONTEXT_LIMITS.maxSimilarReviewedCalls)
          .map((example) => ({
            summary: example.summary,
            outcome: example.outcome,
            realizedOutcomes: example.realizedOutcomes,
            playbookHint: example.playbookHint,
          })),
      },
      deterministicChecklist: checklistItems.map((item) => ({
        label: item.label,
        detail: item.detail,
        status: item.status,
      })),
      limits: LIVE_GUIDANCE_CONTEXT_LIMITS,
    };

    await ctx.db.patch(session._id, {
      liveGuidanceContextSnapshot: context,
      liveGuidanceContextSnapshotCreatedAt: now,
      liveGuidanceContextSnapshotVersion: LIVE_GUIDANCE_CONTEXT_VERSION,
      updatedAt: now,
    });

    return context;
  },
});
