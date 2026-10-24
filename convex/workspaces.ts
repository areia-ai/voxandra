import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentProfile, requireWorkspace, requireWorkspaceOwner } from "./authHelpers";

export const getMyWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentProfile(ctx);
    const profile = current?.profile;

    if (!profile?.defaultWorkspaceId) return null;

    const workspace = await ctx.db.get(profile.defaultWorkspaceId);
    return workspace ?? null;
  },
});

export const getWorkspaceById = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentProfile(ctx);
    const profile = current?.profile;

    if (!profile?.defaultWorkspaceId) return null;

    const workspace = await ctx.db.get(profile.defaultWorkspaceId);
    return workspace ?? null;
  },
});

// A read-only export of this workspace's operational memory, for GDPR-style
// data portability requests. Deliberately excludes billing/Stripe internals
// and raw audio (Voxandra doesn't store raw audio by default per the product
// brief) — just the human-meaningful records: contacts, calls, transcripts,
// summaries, and reminders.
export const exportWorkspaceData = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);

    const [workspace, contacts, calls, transcripts, aiMemories, reminders] = await Promise.all([
      ctx.db.get(workspaceId),
      ctx.db
        .query("contacts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("calls")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("transcripts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("aiMemories")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("reminders")
        .withIndex("by_status", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      workspace: workspace ? { name: workspace.name, plan: workspace.plan } : null,
      contacts: contacts.map((contact) => ({
        name: contact.name,
        type: contact.type,
        country: contact.country,
        phoneNumber: contact.phoneNumber,
        notes: contact.notes,
        lastCallAt: contact.lastCallAt,
      })),
      calls: calls.map((call) => ({
        dialedNumber: call.dialedNumber,
        callDirection: call.callDirection,
        status: call.status,
        startedAt: call.startedAt,
        durationSeconds: call.durationSeconds,
        processingStatus: call.processingStatus,
      })),
      transcripts: transcripts.map((transcript) => ({
        callId: transcript.callId,
        text: transcript.text,
      })),
      callSummaries: aiMemories.map((memory) => ({
        callId: memory.callId,
        summary: memory.summary,
      })),
      reminders: reminders.map((reminder) => ({
        title: reminder.title,
        remindAt: reminder.remindAt,
        status: reminder.status,
      })),
    };
  },
});

// Immediately revokes access for every member by deleting all workspace
// memberships — every query/mutation in this codebase resolves access
// through requireWorkspace/requireWorkspaceMembership, which look up a
// membership row, so this takes effect on the very next request rather than
// requiring a flag check to be threaded through 40+ tables. The workspace's
// own data rows are left in place (not hard-deleted here) so a support
// request within a grace period can still be honored; deletionRequestedAt
// records when that grace period started.
export const requestWorkspaceDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await requireWorkspaceOwner(ctx);

    await ctx.db.patch(workspaceId, { deletionRequestedAt: Date.now() });

    const memberships = await ctx.db
      .query("workspaceMemberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }

    return { deleted: true };
  },
});

export const setVoiceTranslationMaxCallMinutes = mutation({
  args: { minutes: v.union(v.literal(30), v.literal(45), v.literal(60)) },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceOwner(ctx);
    await ctx.db.patch(workspaceId, {
      voiceTranslationMaxCallMinutes: args.minutes,
      updatedAt: Date.now(),
    });
    return { minutes: args.minutes };
  },
});

export const setVoiceTranslationEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceOwner(ctx);
    await ctx.db.patch(workspaceId, {
      voiceTranslationEnabled: args.enabled,
      updatedAt: Date.now(),
    });
    return { enabled: args.enabled };
  },
});
