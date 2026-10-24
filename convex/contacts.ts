import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { normalizePhoneE164 } from "../src/lib/phone";
import { refreshCallMemorySearchDocsForCall } from "./callMemorySearch";

const contactInput = {
  name: v.string(),
  type: v.string(),
  country: v.string(),
  phoneNumber: v.string(),
  notes: v.string(),
};

function trimContact(input: {
  name: string;
  type: string;
  country: string;
  phoneNumber: string;
  notes: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Contact name is required.");
  const phoneNumber = input.phoneNumber.trim();
  const phoneE164 = normalizePhoneE164(phoneNumber);
  return {
    name,
    type: input.type.trim() || "other",
    country: input.country.trim() || "Unknown",
    phoneNumber,
    phoneE164: phoneE164 || undefined,
    notes: input.notes.trim(),
  };
}

async function assertNoDuplicatePhone(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  phoneE164: string | undefined,
  excludeContactId?: Id<"contacts">
) {
  if (!phoneE164) return;

  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const duplicate = contacts.find((contact) => {
    if (excludeContactId && contact._id === excludeContactId) return false;
    return (
      contact.phoneE164 === phoneE164 ||
      normalizePhoneE164(contact.phoneNumber) === phoneE164
    );
  });

  if (duplicate) {
    throw new Error(`A contact with this phone number already exists: ${duplicate.name}.`);
  }
}

async function addThreadToContact(
  ctx: MutationCtx,
  contactId: Id<"contacts">,
  threadId: Id<"cases">
) {
  const contact = await ctx.db.get(contactId);
  if (!contact || contact.relatedCaseIds.includes(threadId)) return;
  await ctx.db.patch(contactId, {
    relatedCaseIds: [...contact.relatedCaseIds, threadId],
    updatedAt: Date.now(),
  });
}

async function removeThreadFromContactIfUnused(
  ctx: MutationCtx,
  contactId: Id<"contacts"> | undefined,
  threadId: Id<"cases">,
  exceptCallId: Id<"calls">
) {
  if (!contactId) return;
  const contact = await ctx.db.get(contactId);
  if (!contact || !contact.relatedCaseIds.includes(threadId)) return;

  const calls = await ctx.db
    .query("calls")
    .withIndex("by_case", (q) => q.eq("caseId", threadId))
    .collect();
  if (calls.some((call) => call._id !== exceptCallId && call.contactId === contactId)) return;

  await ctx.db.patch(contactId, {
    relatedCaseIds: contact.relatedCaseIds.filter((id) => id !== threadId),
    updatedAt: Date.now(),
  });
}

async function syncCallContact(
  ctx: MutationCtx,
  call: Doc<"calls">,
  contactId: Id<"contacts">
) {
  const now = Date.now();
  const oldContactId = call.contactId;

  await ctx.db.patch(call._id, { contactId });

  const reminders = await ctx.db
    .query("reminders")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .collect();
  for (const reminder of reminders) {
    await ctx.db.patch(reminder._id, { contactId });
  }

  const contact = await ctx.db.get(contactId);
  if (contact) {
    await ctx.db.patch(contactId, {
      lastCallAt: call.startedAt,
      updatedAt: now,
    });
  }

  if (!call.caseId) {
    await refreshCallMemorySearchDocsForCall(ctx, call._id);
    return;
  }

  const thread = await ctx.db.get(call.caseId);
  if (thread) {
    let oldContactStillUsed = false;
    if (oldContactId && oldContactId !== contactId) {
      const calls = await ctx.db
        .query("calls")
        .withIndex("by_case", (q) => q.eq("caseId", call.caseId!))
        .collect();
      oldContactStillUsed = calls.some(
        (caseCall) => caseCall._id !== call._id && caseCall.contactId === oldContactId
      );
    }

    const nextContactIds = thread.contactIds.includes(contactId)
      ? thread.contactIds
      : [...thread.contactIds, contactId];
    const filteredContactIds = oldContactId && oldContactId !== contactId && !oldContactStillUsed
      ? nextContactIds.filter((id) => id !== oldContactId)
      : nextContactIds;

    await ctx.db.patch(thread._id, { contactIds: filteredContactIds });
  }

  await addThreadToContact(ctx, contactId, call.caseId);
  if (oldContactId && oldContactId !== contactId) {
    await removeThreadFromContactIfUnused(ctx, oldContactId, call.caseId, call._id);
  }
  await refreshCallMemorySearchDocsForCall(ctx, call._id);
}

export const getContacts = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return contacts.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getContactById = query({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const contact = await ctx.db.get(args.id);
    if (!contact || contact.workspaceId !== workspaceId) return null;
    return contact;
  },
});

export const createContact = mutation({
  args: contactInput,
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const now = Date.now();
    const contact = trimContact(args);
    await assertNoDuplicatePhone(ctx, workspaceId, contact.phoneE164);

    return await ctx.db.insert("contacts", {
      workspaceId,
      ...contact,
      relatedCaseIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateContact = mutation({
  args: {
    contactId: v.id("contacts"),
    ...contactInput,
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const contact = await ctx.db.get(args.contactId);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error("Contact not found");
    }

    const { contactId, ...input } = args;
    const nextContact = trimContact(input);
    await assertNoDuplicatePhone(ctx, workspaceId, nextContact.phoneE164, contactId);

    await ctx.db.patch(contactId, {
      ...nextContact,
      updatedAt: Date.now(),
    });
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .collect();
    for (const call of calls.filter((item) => item.workspaceId === workspaceId)) {
      await refreshCallMemorySearchDocsForCall(ctx, call._id);
    }
    return contactId;
  },
});

export const createContactForCall = mutation({
  args: {
    callId: v.id("calls"),
    name: v.string(),
    type: v.string(),
    country: v.string(),
    phoneNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");

    const now = Date.now();
    const contact = trimContact({
      name: args.name,
      type: args.type,
      country: args.country,
      phoneNumber: args.phoneNumber ?? call.dialedNumber,
      notes: args.notes ?? "Created from a Voxandra call note.",
    });
    await assertNoDuplicatePhone(ctx, workspaceId, contact.phoneE164);

    const contactId = await ctx.db.insert("contacts", {
      workspaceId,
      ...contact,
      lastCallAt: call.startedAt,
      relatedCaseIds: call.caseId ? [call.caseId] : [],
      createdAt: now,
      updatedAt: now,
    });

    await syncCallContact(ctx, call, contactId);
    return contactId;
  },
});

export const deleteContact = mutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const contact = await ctx.db.get(args.contactId);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error("Contact not found");
    }

    // Calls, reminders, and search docs only ever hold an optional contact
    // reference, so deleting a contact unlinks it from that history instead
    // of blocking the delete or cascading into deleting calls/reminders too.
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();
    for (const call of calls) {
      await ctx.db.patch(call._id, { contactId: undefined });
    }

    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_status", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const reminder of reminders) {
      if (reminder.contactId === args.contactId) {
        await ctx.db.patch(reminder._id, { contactId: undefined });
      }
    }

    const searchDocs = await ctx.db
      .query("callMemorySearchDocs")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();
    for (const doc of searchDocs) {
      await ctx.db.patch(doc._id, { contactId: undefined });
    }

    for (const caseId of contact.relatedCaseIds) {
      const thread = await ctx.db.get(caseId);
      if (thread && thread.contactIds.includes(args.contactId)) {
        await ctx.db.patch(caseId, {
          contactIds: thread.contactIds.filter((id) => id !== args.contactId),
        });
      }
    }

    await ctx.db.delete(args.contactId);
    return args.contactId;
  },
});

export const linkCallToContact = mutation({
  args: {
    callId: v.id("calls"),
    contactId: v.id("contacts"),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const [call, contact] = await Promise.all([
      ctx.db.get(args.callId),
      ctx.db.get(args.contactId),
    ]);
    if (!call || call.workspaceId !== workspaceId) throw new Error("Call not found");
    if (!contact || contact.workspaceId !== workspaceId) throw new Error("Contact not found");

    await syncCallContact(ctx, call, args.contactId);
    return args.callId;
  },
});
