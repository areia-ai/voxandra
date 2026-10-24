import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";
import { refreshLearningExamplesForCall } from "./agentLearning";
import type { Id } from "./_generated/dataModel";

const reminderStatus = v.union(
  v.literal("upcoming"),
  v.literal("overdue"),
  v.literal("in_progress"),
  v.literal("completed")
);

export const getReminders = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_status", (q) =>
        q.eq("workspaceId", workspaceId)
      )
      .collect();
    return reminders.sort(
      (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()
    );
  },
});

export const getRemindersByCaseId = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const caseItem = await ctx.db.get(args.caseId);
    if (!caseItem || caseItem.workspaceId !== workspaceId) return [];
    return await ctx.db
      .query("reminders")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
  },
});

export const getRemindersByCallId = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) return [];
    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    return reminders.sort(
      (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()
    );
  },
});

export const markReminderComplete = mutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.workspaceId !== workspaceId) throw new Error("Reminder not found");
    await ctx.db.patch(args.reminderId, { status: "completed" });
    if (reminder.callId) {
      await refreshCallMemorySearchDocsForCall(ctx, reminder.callId);
      await refreshLearningExamplesForCall(ctx, reminder.callId);
    }
  },
});

export const createReminder = mutation({
  args: {
    callId: v.optional(v.id("calls")),
    caseId: v.optional(v.id("cases")),
    contactId: v.optional(v.id("contacts")),
    title: v.string(),
    remindAt: v.string(),
    status: reminderStatus,
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const reminderId = await ctx.db.insert("reminders", {
      workspaceId,
      ...args,
    });
    if (args.callId) {
      await refreshCallMemorySearchDocsForCall(ctx, args.callId);
    }
    return reminderId;
  },
});

export const updateReminder = mutation({
  args: {
    reminderId: v.id("reminders"),
    title: v.optional(v.string()),
    remindAt: v.optional(v.string()),
    status: v.optional(reminderStatus),
    kanbanOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.workspaceId !== workspaceId) throw new Error("Reminder not found");
    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.remindAt !== undefined) updates.remindAt = args.remindAt;
    if (args.status !== undefined) updates.status = args.status;
    if (args.kanbanOrder !== undefined) updates.kanbanOrder = args.kanbanOrder;
    await ctx.db.patch(args.reminderId, updates);
    if (reminder.callId) {
      await refreshCallMemorySearchDocsForCall(ctx, reminder.callId);
      if (args.status !== undefined && args.status !== reminder.status) {
        await refreshLearningExamplesForCall(ctx, reminder.callId);
      }
    }
  },
});

export const updateKanbanOrder = mutation({
  args: {
    updates: v.array(
      v.object({
        reminderId: v.id("reminders"),
        status: reminderStatus,
        kanbanOrder: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const seenReminderIds = new Set<string>();

    for (const update of args.updates) {
      if (seenReminderIds.has(update.reminderId)) {
        throw new Error("Duplicate reminder update");
      }
      seenReminderIds.add(update.reminderId);

      const reminder = await ctx.db.get(update.reminderId);
      if (!reminder || reminder.workspaceId !== workspaceId) {
        throw new Error("Reminder not found");
      }
    }

    const callIds = new Set<Id<"calls">>();
    const statusChangedCallIds = new Set<Id<"calls">>();
    for (const update of args.updates) {
      const reminder = await ctx.db.get(update.reminderId);
      await ctx.db.patch(update.reminderId, {
        status: update.status,
        kanbanOrder: update.kanbanOrder,
      });
      if (reminder?.callId) {
        callIds.add(reminder.callId);
        if (reminder.status !== update.status) {
          statusChangedCallIds.add(reminder.callId);
        }
      }
    }

    for (const callId of callIds) {
      await refreshCallMemorySearchDocsForCall(ctx, callId);
    }
    for (const callId of statusChangedCallIds) {
      await refreshLearningExamplesForCall(ctx, callId);
    }
  },
});

export const deleteCompletedReminder = mutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.workspaceId !== workspaceId) throw new Error("Reminder not found");
    if (reminder.status !== "completed") {
      throw new Error("Only completed reminders can be deleted.");
    }

    await ctx.db.delete(args.reminderId);
    if (reminder.callId) {
      await refreshCallMemorySearchDocsForCall(ctx, reminder.callId);
    }
    return { deleted: true };
  },
});

export const deleteCompletedReminders = mutation({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const completedReminders = await ctx.db
      .query("reminders")
      .withIndex("by_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "completed")
      )
      .collect();

    const callIds = new Set<Id<"calls">>();
    for (const reminder of completedReminders) {
      await ctx.db.delete(reminder._id);
      if (reminder.callId) callIds.add(reminder.callId);
    }

    for (const callId of callIds) {
      await refreshCallMemorySearchDocsForCall(ctx, callId);
    }

    return { deletedCount: completedReminders.length };
  },
});

export const deleteRemindersByCallId = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    const items = await ctx.db
      .query("reminders")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    await refreshCallMemorySearchDocsForCall(ctx, args.callId);
  },
});
