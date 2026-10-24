import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";

function sortByStartedAtDesc<T extends { startedAt: string }>(items: T[]) {
  return items.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

async function getOpenActionItems(ctx: QueryCtx | MutationCtx, threadId: Id<"cases">) {
  const items = await ctx.db
    .query("actionItems")
    .withIndex("by_case", (q) => q.eq("caseId", threadId))
    .collect();
  return items.filter((item) => item.status !== "completed");
}

async function getUpcomingReminders(ctx: QueryCtx | MutationCtx, threadId: Id<"cases">) {
  const reminders = await ctx.db
    .query("reminders")
    .withIndex("by_case", (q) => q.eq("caseId", threadId))
    .collect();
  return reminders
    .filter((reminder) => reminder.status !== "completed")
    .sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
}

export async function syncThreadRollup(
  ctx: MutationCtx,
  threadId: Id<"cases">
) {
  const thread = await ctx.db.get(threadId);
  if (!thread) return;

  const calls = await ctx.db
    .query("calls")
    .withIndex("by_case", (q) => q.eq("caseId", threadId))
    .collect();
  const actionItems = await ctx.db
    .query("actionItems")
    .withIndex("by_case", (q) => q.eq("caseId", threadId))
    .collect();

  const callIds = sortByStartedAtDesc(calls).map((call) => call._id);
  const contactIds = Array.from(
    new Set(calls.map((call) => call.contactId).filter(Boolean) as Id<"contacts">[])
  );
  const unresolvedActionItemIds = actionItems
    .filter((item) => item.status !== "completed")
    .map((item) => item._id);

  await ctx.db.patch(threadId, {
    callIds,
    contactIds,
    unresolvedActionItemIds,
    lastCallAt: calls[0]?.startedAt ?? thread.lastCallAt,
    nextFollowUpAt: thread.nextFollowUpAt,
  });
}

async function addThreadToContact(
  ctx: MutationCtx,
  contactId: Id<"contacts"> | undefined,
  threadId: Id<"cases">
) {
  if (!contactId) return;
  const contact = await ctx.db.get(contactId);
  if (!contact) return;
  if (contact.relatedCaseIds.includes(threadId)) return;
  await ctx.db.patch(contactId, {
    relatedCaseIds: [...contact.relatedCaseIds, threadId],
  });
}

async function removeThreadFromContactIfUnused(
  ctx: MutationCtx,
  contactId: Id<"contacts"> | undefined,
  threadId: Id<"cases">
) {
  if (!contactId) return;
  const contact = await ctx.db.get(contactId);
  if (!contact || !contact.relatedCaseIds.includes(threadId)) return;

  const calls = await ctx.db
    .query("calls")
    .withIndex("by_case", (q) => q.eq("caseId", threadId))
    .collect();
  if (calls.some((call) => call.contactId === contactId)) return;

  await ctx.db.patch(contactId, {
    relatedCaseIds: contact.relatedCaseIds.filter((id) => id !== threadId),
  });
}

async function applyThreadLink(
  ctx: MutationCtx,
  call: Doc<"calls">,
  threadId: Id<"cases">,
  contactId: Id<"contacts"> | undefined = call.contactId
) {
  const oldThreadId = call.caseId;
  if (oldThreadId === threadId && call.contactId === contactId) return;

  await ctx.db.patch(call._id, {
    caseId: threadId,
    ...(contactId ? { contactId } : {}),
  });

  const memory = await ctx.db
    .query("aiMemories")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .first();
  if (memory) {
    await ctx.db.patch(memory._id, { caseId: threadId });
  }

  const entities = await ctx.db
    .query("extractedEntities")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .collect();
  for (const entity of entities) {
    await ctx.db.patch(entity._id, { caseId: threadId });
  }

  const actionItems = await ctx.db
    .query("actionItems")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .collect();
  for (const item of actionItems) {
    await ctx.db.patch(item._id, { caseId: threadId });
  }

  const reminders = await ctx.db
    .query("reminders")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .collect();
  for (const reminder of reminders) {
    await ctx.db.patch(reminder._id, {
      caseId: threadId,
      ...(contactId ? { contactId } : {}),
    });
  }

  await addThreadToContact(ctx, contactId, threadId);
  if (oldThreadId) {
    await syncThreadRollup(ctx, oldThreadId);
    await removeThreadFromContactIfUnused(ctx, call.contactId, oldThreadId);
  }
  await syncThreadRollup(ctx, threadId);
  await refreshCallMemorySearchDocsForCall(ctx, call._id);
}

async function resolveSuggestedContact(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  call: Doc<"calls">,
  suggestion: Doc<"reviewSuggestions">
) {
  if (call.contactId) return call.contactId;

  if (suggestion.suggestedExistingContactId) {
    const existing = await ctx.db.get(suggestion.suggestedExistingContactId);
    if (existing?.workspaceId === workspaceId) return existing._id;
  }

  const institutionName = suggestion.participants?.institution.name;
  const contactName = suggestion.suggestedNewContactName?.trim() || institutionName;
  if (!contactName) return undefined;
  return undefined;
}

function selectKeyEntities(entities: Doc<"extractedEntities">[]) {
  const ignoredTypes = new Set(["risk_flag", "discrepancy"]);
  const preferredTypes = new Set([
    "case_number",
    "reference_number",
    "claim_number",
    "invoice_number",
    "required_document",
    "appointment_date",
    "due_date",
    "service_plan",
    "delivery_time",
    "address",
    "email",
    "organization",
  ]);
  const usefulEntities = entities.filter((entity) => !ignoredTypes.has(entity.type));
  const preferredEntities = usefulEntities.filter((entity) => preferredTypes.has(entity.type));
  return (preferredEntities.length ? preferredEntities : usefulEntities).slice(0, 6);
}

export async function listActiveThreadsForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  limit: number
) {
  const threads = await ctx.db
    .query("cases")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  const activeThreads = threads
    .filter((thread) => thread.status !== "closed")
    .sort((a, b) => new Date(b.lastCallAt).getTime() - new Date(a.lastCallAt).getTime())
    .slice(0, limit);

  return await Promise.all(
    activeThreads.map(async (thread) => {
      const openActionItems = await getOpenActionItems(ctx, thread._id);
      const upcomingReminders = await getUpcomingReminders(ctx, thread._id);
      return {
        thread,
        openFollowUpCount: openActionItems.length + upcomingReminders.length,
        callCount: thread.callIds.length,
        nextFollowUpAt: upcomingReminders[0]?.remindAt ?? thread.nextFollowUpAt,
      };
    })
  );
}

export const listActiveThreads = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 4, 8));
    return await listActiveThreadsForWorkspace(ctx, workspaceId, limit);
  },
});

export const getThreadContextForCall = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId || !call.caseId) return null;

    const thread = await ctx.db.get(call.caseId);
    if (!thread || thread.workspaceId !== workspaceId) return null;

    const [relatedCalls, openActionItems, upcomingReminders, entities, contacts] =
      await Promise.all([
        ctx.db
          .query("calls")
          .withIndex("by_case", (q) => q.eq("caseId", thread._id))
          .collect(),
        getOpenActionItems(ctx, thread._id),
        getUpcomingReminders(ctx, thread._id),
        ctx.db
          .query("extractedEntities")
          .withIndex("by_case", (q) => q.eq("caseId", thread._id))
          .collect(),
        Promise.all(thread.contactIds.map((contactId) => ctx.db.get(contactId))),
      ]);

    return {
      thread,
      relatedCalls: sortByStartedAtDesc(relatedCalls).slice(0, 4),
      openActionItems: openActionItems.slice(0, 4),
      upcomingReminders: upcomingReminders.slice(0, 3),
      keyEntities: selectKeyEntities(entities),
      contacts: contacts.filter((contact): contact is NonNullable<typeof contact> => Boolean(contact)),
    };
  },
});

export const getThreadSuggestionForCall = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId || call.caseId) return null;

    const suggestion = await ctx.db
      .query("reviewSuggestions")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    if (!suggestion || suggestion.workspaceId !== workspaceId) return null;

    const suggestedExistingThread = suggestion.suggestedExistingCaseId
      ? await ctx.db.get(suggestion.suggestedExistingCaseId)
      : null;

    if (!suggestedExistingThread && !suggestion.suggestedNewCaseTitle) return null;

    return {
      suggestion,
      suggestedExistingThread:
        suggestedExistingThread?.workspaceId === workspaceId ? suggestedExistingThread : null,
      suggestedNewThreadTitle: suggestion.suggestedNewCaseTitle ?? null,
    };
  },
});

export const listThreadPillsForNotes = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const threadIds = Array.from(new Set(calls.map((call) => call.caseId).filter(Boolean) as Id<"cases">[]));
    const threads = await Promise.all(threadIds.slice(0, limit).map((threadId) => ctx.db.get(threadId)));
    const threadsById = new Map(
      threads
        .filter((thread): thread is NonNullable<typeof thread> => thread !== null && thread.workspaceId === workspaceId)
        .map((thread) => [thread._id, thread])
    );

    return calls
      .filter((call) => call.caseId && threadsById.has(call.caseId))
      .map((call) => ({
        callId: call._id,
        thread: threadsById.get(call.caseId!)!,
      }));
  },
});

export const listThreadPillsForContacts = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const threadIds = Array.from(new Set(contacts.flatMap((contact) => contact.relatedCaseIds)));
    const threads = await Promise.all(threadIds.map((threadId) => ctx.db.get(threadId)));
    const threadsById = new Map(
      threads
        .filter((thread): thread is NonNullable<typeof thread> => thread !== null && thread.workspaceId === workspaceId)
        .map((thread) => [thread._id, thread])
    );

    return contacts.map((contact) => ({
      contactId: contact._id,
      threads: contact.relatedCaseIds
        .map((threadId) => threadsById.get(threadId))
        .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
        .slice(0, 3),
    }));
  },
});

export const linkCallToThread = mutation({
  args: {
    callId: v.id("calls"),
    threadId: v.id("cases"),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const [call, thread] = await Promise.all([
      ctx.db.get(args.callId),
      ctx.db.get(args.threadId),
    ]);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    if (!thread || thread.workspaceId !== workspaceId) throw new Error("Thread not found");

    await applyThreadLink(ctx, call, args.threadId);
    return args.callId;
  },
});

export const createThreadFromSuggestion = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");

    const suggestion = await ctx.db
      .query("reviewSuggestions")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .first();
    if (!suggestion || suggestion.workspaceId !== workspaceId) {
      throw new Error("Thread suggestion not found");
    }

    if (suggestion.suggestedExistingCaseId) {
      const existing = await ctx.db.get(suggestion.suggestedExistingCaseId);
      if (!existing || existing.workspaceId !== workspaceId) {
        throw new Error("Suggested thread not found");
      }
      const contactId = await resolveSuggestedContact(ctx, workspaceId, call, suggestion);
      await applyThreadLink(ctx, call, existing._id, contactId);
      return existing._id;
    }

    const title = suggestion.suggestedNewCaseTitle?.trim();
    if (!title) throw new Error("No suggested thread title is available");

    const subjectName =
      suggestion.participants?.subject.name ??
      suggestion.participants?.caller.name ??
      "Unassigned";
    const contactId = await resolveSuggestedContact(ctx, workspaceId, call, suggestion);
    const threadId = await ctx.db.insert("cases", {
      workspaceId,
      title,
      type: suggestion.detectedCallType || "Call thread",
      clientName: subjectName,
      status: "active",
      lastCallAt: call.startedAt,
      nextFollowUpAt: suggestion.reminderDueAt,
      callIds: [],
      contactIds: contactId ? [contactId] : [],
      unresolvedActionItemIds: [],
      summary: suggestion.summary,
    });

    await applyThreadLink(ctx, call, threadId, contactId);
    await ctx.db.patch(suggestion._id, { suggestedExistingCaseId: threadId });
    return threadId;
  },
});
