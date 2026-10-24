import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";

function isOpenStatus(status: string) {
  return !["completed", "done", "dismissed", "accepted"].includes(status.toLowerCase());
}

function dateHasPassed(value: string | undefined) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

export async function buildThreadIntelligence(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  caseId: Id<"cases">
) {
  const thread = await ctx.db.get(caseId);
  if (!thread || thread.workspaceId !== workspaceId) return null;

  const [calls, actionItems, reminders, persistedInsights] = await Promise.all([
    ctx.db
      .query("calls")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect(),
    ctx.db
      .query("actionItems")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect(),
    ctx.db
      .query("reminders")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect(),
    ctx.db
      .query("threadInsights")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect(),
  ]);

  const sortedCalls = calls
    .slice()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const recentCallIds = sortedCalls.slice(0, 6).map((call) => call._id);
  const latestCall = sortedCalls[0] ?? null;

  const entities: Doc<"extractedEntities">[] = [];
  for (const callId of recentCallIds) {
    const callEntities = await ctx.db
      .query("extractedEntities")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .collect();
    entities.push(...callEntities);
  }

  const openActionItems = actionItems.filter((item) => isOpenStatus(item.status));
  const overdueActionItems = openActionItems.filter((item) => dateHasPassed(item.dueAt));
  const openReminders = reminders.filter((item) => item.status !== "completed");
  const overdueReminders = openReminders.filter(
    (item) => item.status === "overdue" || dateHasPassed(item.remindAt)
  );
  const blockers = entities.filter((entity) =>
    ["risk_flag", "discrepancy", "blocker"].some((type) =>
      `${entity.type} ${entity.label}`.toLowerCase().includes(type)
    )
  );

  const blockerCounts = new Map<string, { count: number; value: string }>();
  for (const blocker of blockers) {
    const key = blocker.value.trim().toLowerCase();
    if (!key) continue;
    const existing = blockerCounts.get(key);
    blockerCounts.set(key, {
      count: (existing?.count ?? 0) + 1,
      value: blocker.value,
    });
  }

  const repeatedBlockers = Array.from(blockerCounts.values())
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const latestKnownFacts = entities
    .filter((entity) =>
      ["reference", "case", "claim", "invoice", "date", "amount", "document", "status"].some(
        (needle) => `${entity.type} ${entity.label}`.toLowerCase().includes(needle)
      )
    )
    .slice(0, 6)
    .map((entity) => ({
      label: entity.label,
      value: entity.value,
      type: entity.type,
      callId: entity.callId,
    }));

  const deterministicInsights = [
    ...overdueActionItems.slice(0, 3).map((item) => ({
      type: "overdue_commitment",
      title: "Overdue commitment",
      detail: item.dueAt ? `${item.title} was due ${item.dueAt}.` : item.title,
      evidenceCallIds: item.callId ? [item.callId] : [],
    })),
    ...overdueReminders.slice(0, 3).map((item) => ({
      type: "overdue_follow_up",
      title: "Overdue follow-up",
      detail: `${item.title} was scheduled for ${item.remindAt}.`,
      evidenceCallIds: item.callId ? [item.callId] : [],
    })),
    ...repeatedBlockers.map((item) => ({
      type: "repeated_blocker",
      title: "Repeated blocker",
      detail: `${item.value} has appeared across ${item.count} calls.`,
      evidenceCallIds: recentCallIds,
    })),
  ];

  const suggestedNextObjective =
    overdueActionItems[0]?.title ??
    overdueReminders[0]?.title ??
    openActionItems[0]?.title ??
    openReminders[0]?.title ??
    (latestCall
      ? `Confirm what changed since the ${new Date(latestCall.startedAt).toLocaleDateString()} call.`
      : "Confirm status, owner, blocker, and next follow-up date.");

  return {
    thread,
    callCount: calls.length,
    latestCallAt: latestCall?.startedAt ?? null,
    openActionItems: openActionItems.slice(0, 5),
    overdueActionItems: overdueActionItems.slice(0, 5),
    openReminders: openReminders.slice(0, 5),
    overdueReminders: overdueReminders.slice(0, 5),
    latestKnownFacts,
    repeatedBlockers,
    suggestedNextObjective,
    deterministicInsights,
    persistedInsights: persistedInsights.filter((insight) => insight.status === "active"),
  };
}

export const getThreadIntelligence = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    return await buildThreadIntelligence(ctx, workspaceId, args.caseId);
  },
});

export const dismissThreadInsight = mutation({
  args: { insightId: v.id("threadInsights") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const insight = await ctx.db.get(args.insightId);
    if (!insight || insight.workspaceId !== workspaceId) {
      throw new Error("Thread insight not found");
    }
    await ctx.db.patch(args.insightId, {
      status: "dismissed",
      updatedAt: Date.now(),
    });
  },
});
