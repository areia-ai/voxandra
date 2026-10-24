import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireWorkspace } from "./authHelpers";
import { contactLookup } from "./notes";
import type { Doc, Id } from "./_generated/dataModel";

type DashboardStage = "calling" | "processing" | "ready" | "failed" | "completed";
type QueueTone = "violet" | "amber" | "rose" | "emerald" | "stone";

type CallRow = {
  call: Doc<"calls">;
  contact: Doc<"contacts"> | null;
  memory: Doc<"aiMemories"> | null;
  transcriptAvailable: boolean;
  reminders: Doc<"reminders">[];
  createdByProfile: Doc<"profiles"> | null;
};

type DashboardAction = {
  label: string;
  href: string;
  style: "primary" | "secondary";
};

type WorkQueueItem = {
  id: string;
  priority: number;
  tone: QueueTone;
  icon?: "phone_missed";
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  dueAt?: string;
};

const CALLING_STATUS = "calling";
const READY_STATUS = "memory_ready";
// Terminal: a call that ended without AI capture enabled gets no transcript or
// call record — counting it as in-flight would pin it "processing" forever.
const COMPLETED_WITHOUT_RECORD_STATUS = "completed";
const PROCESSING_STATUSES = new Set([
  "processing",
  "transcript_needed",
  "transcribing",
  "extracting",
  "analyzing",
]);
const FAILURE_STATUSES = new Set([
  "call_failed",
  "recording_callback_missing",
  "transcription_failed",
  "failed",
]);

/** The provider call never connected (busy, rejected, no answer), so no
 * recording, transcript, or AI record will ever exist for it. */
function callNeverConnected(call: Doc<"calls">) {
  return call.processingStatus === "call_failed";
}

function sortCallsDesc<T extends { startedAt: string }>(items: T[]) {
  return [...items].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

function sortRemindersAsc<T extends { remindAt: string }>(items: T[]) {
  return [...items].sort(
    (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()
  );
}

function stageForCall(call: Doc<"calls">): DashboardStage {
  if (call.processingStatus === CALLING_STATUS) return "calling";
  if (call.processingStatus === COMPLETED_WITHOUT_RECORD_STATUS) return "completed";
  if (FAILURE_STATUSES.has(call.processingStatus)) return "failed";
  if (call.processingStatus === READY_STATUS && call.aiMemoryReady) return "ready";
  if (PROCESSING_STATUSES.has(call.processingStatus)) return "processing";
  return call.aiMemoryReady ? "ready" : "processing";
}

function statusLabel(status: string) {
  if (status === "calling") return "Call in progress";
  if (status === "processing") return "Processing call";
  if (status === "completed") return "Waiting for AI call record";
  if (status === "transcript_needed") return "Waiting for recording";
  if (status === "transcribing") return "Transcribing recording";
  if (status === "extracting" || status === "analyzing") return "Creating AI record";
  if (status === "memory_ready") return "Record ready";
  if (status === "completed") return "Call completed";
  if (status === "call_failed") return "Call didn't connect";
  if (status === "recording_callback_missing") return "Recording missing";
  if (status === "transcription_failed") return "Transcription failed";
  if (status === "failed") return "AI extraction failed";
  return status.replaceAll("_", " ");
}

function callTitle(row: CallRow) {
  return row.contact?.name ?? (row.call.dialedNumber || "Unknown number");
}

function callSummary(row: CallRow) {
  return row.memory?.summary ?? row.memory?.outcome ?? row.call.highlights[0] ?? null;
}

function profileLabel(profile: Doc<"profiles"> | null) {
  return profile?.displayName || profile?.email?.split("@")[0] || null;
}

function detailHref(callId: Id<"calls">, anchor?: string) {
  return `/app/calls/${callId}${anchor ? `#${anchor}` : ""}`;
}

function handoffDescription(stage: DashboardStage) {
  if (stage === "calling") {
    return "Stay here while the call is active. When it ends, this card becomes the review handoff.";
  }
  if (stage === "processing") {
    return "Voxandra is building the transcript, AI note, extracted details, and suggested follow-ups.";
  }
  if (stage === "failed") {
    return "This call needs attention before it can become a reliable call record.";
  }
  if (stage === "completed") {
    return "This call finished without an AI call record. Open the call for its details.";
  }
  return "The AI note, transcript, and follow-up context are ready to review.";
}

function buildActions(row: CallRow, stage: DashboardStage): DashboardAction[] {
  const callId = row.call._id;

  if (stage === "ready") {
    if (row.call.reviewPending) {
      return [
        { label: "Review record", href: detailHref(callId, "review"), style: "primary" },
        ...(row.transcriptAvailable
          ? [{ label: "Check transcript", href: detailHref(callId, "transcript"), style: "secondary" as const }]
          : []),
        { label: "View all records", href: "/app/memory", style: "secondary" },
      ];
    }

    return [
      { label: "Open AI note", href: detailHref(callId, "note"), style: "primary" },
      ...(row.transcriptAvailable
        ? [{ label: "Review transcript", href: detailHref(callId, "transcript"), style: "secondary" as const }]
        : []),
      ...(!row.contact
        ? [{ label: "Link contact", href: detailHref(callId, "contact"), style: "secondary" as const }]
        : []),
      ...(row.reminders.length > 0
        ? [{ label: "View reminders", href: detailHref(callId, "reminders"), style: "secondary" as const }]
        : []),
      { label: "View all records", href: "/app/memory", style: "secondary" },
    ];
  }

  if (stage === "failed") {
    if (callNeverConnected(row.call)) {
      return [
        {
          label: "Call again",
          href: `/app?number=${encodeURIComponent(row.call.dialedNumber)}#dialer`,
          style: "primary",
        },
        { label: "Open call", href: detailHref(callId), style: "secondary" },
        { label: "View all records", href: "/app/memory", style: "secondary" },
      ];
    }
    return [
      { label: "Open call", href: detailHref(callId), style: "primary" },
      ...(row.transcriptAvailable
        ? [{ label: "Review transcript", href: detailHref(callId, "transcript"), style: "secondary" as const }]
        : []),
      { label: "View all records", href: "/app/memory", style: "secondary" },
    ];
  }

  return [
    { label: "Open call", href: detailHref(callId), style: "primary" },
    { label: "View all records", href: "/app/memory", style: "secondary" },
  ];
}

function buildHandoff(row: CallRow | null) {
  if (!row) return null;

  const stage = stageForCall(row.call);
  return {
    callId: row.call._id,
    stage,
    eyebrow:
      stage === "ready"
        ? row.call.reviewPending
          ? "Review pending"
          : "Latest call record"
        : stage === "completed"
          ? "Latest call"
          : stage === "failed"
          ? callNeverConnected(row.call)
            ? "Call didn't connect"
            : "Needs attention"
          : "Current call",
    title: callTitle(row),
    phoneNumber: row.call.dialedNumber,
    startedAt: row.call.startedAt,
    durationSeconds: row.call.durationSeconds,
    statusLabel: row.call.reviewPending ? "Review pending" : statusLabel(row.call.processingStatus),
    description: row.call.reviewPending
      ? "Review the AI draft before Voxandra commits details, action items, reminders, and thread context into team records."
      : callNeverConnected(row.call)
        ? "The other side was busy, rejected the call, or didn't answer. No recording, transcript, or AI record will be created for this call."
        : handoffDescription(stage),
    summary: callSummary(row),
    transcriptAvailable: row.transcriptAvailable,
    reminderCount: row.reminders.length,
    contactLinked: Boolean(row.contact),
    contactName: row.contact?.name ?? null,
    createdByName: profileLabel(row.createdByProfile),
    actions: buildActions(row, stage),
  };
}

function selectHandoffRow(rows: CallRow[], postCallCallId?: Id<"calls">) {
  if (postCallCallId) {
    const requested = rows.find((row) => row.call._id === postCallCallId);
    if (requested) return requested;
  }

  // Prefer live and reviewable work over historical failures so a no-answer
  // or recording-missing call does not permanently own the dashboard handoff.
  const live =
    rows.find((row) => stageForCall(row.call) === "calling") ??
    rows.find((row) => stageForCall(row.call) === "processing");
  if (live) return live;

  const reviewPending = rows.find(
    (row) => stageForCall(row.call) === "ready" && row.call.reviewPending
  );
  if (reviewPending) return reviewPending;

  const ready = rows.find((row) => stageForCall(row.call) === "ready");
  if (ready) return ready;

  // Surface a failure only when it is the newest call overall (just ended /
  // just failed). Older call_failed rows stay in Recent activity only.
  const newest = rows[0] ?? null;
  if (newest && stageForCall(newest.call) === "failed") return newest;

  return newest;
}

function buildWorkQueue(
  rows: CallRow[],
  reminders: Doc<"reminders">[],
  activeThreads: Array<{
    thread: Doc<"cases">;
    openFollowUpCount: number;
    callCount: number;
    nextFollowUpAt?: string;
  }>,
  handoffCallId?: Id<"calls">
) {
  const queue: WorkQueueItem[] = [];
  const skipHandoff = (row: CallRow) => row.call._id === handoffCallId;

  // Never-connected (busy / no-answer) is history, not work — keep it out of
  // Next up. Real pipeline failures stay, but only the most recent one so they
  // cannot crowd out review and follow-ups.
  let includedPipelineFailure = false;
  for (const row of rows) {
    if (skipHandoff(row)) continue;
    const stage = stageForCall(row.call);
    if (stage !== "failed") continue;
    if (callNeverConnected(row.call)) continue;
    if (includedPipelineFailure) continue;
    includedPipelineFailure = true;
    queue.push({
      id: `failed-${row.call._id}`,
      priority: 10,
      tone: "rose",
      title: "Call needs attention",
      description: `${callTitle(row)} · ${statusLabel(row.call.processingStatus)}`,
      href: detailHref(row.call._id),
      actionLabel: "Open call",
    });
  }

  for (const row of rows) {
    if (skipHandoff(row)) continue;
    const stage = stageForCall(row.call);
    if (stage !== "calling" && stage !== "processing") continue;
    queue.push({
      id: `processing-${row.call._id}`,
      priority: stage === "calling" ? 20 : 30,
      tone: "violet",
      title: statusLabel(row.call.processingStatus),
      description: callTitle(row),
      href: detailHref(row.call._id),
      actionLabel: "View status",
    });
  }

  for (const row of rows) {
    if (skipHandoff(row) || stageForCall(row.call) !== "ready") continue;
    if (!row.call.reviewPending) continue;
    queue.push({
      id: `review-${row.call._id}`,
      priority: 35,
      tone: "amber",
      title: "Review call record",
      description: callSummary(row) ?? callTitle(row),
      href: detailHref(row.call._id, "review"),
      actionLabel: "Review record",
    });
  }

  for (const row of rows) {
    if (skipHandoff(row) || row.contact || row.call.reviewPending || stageForCall(row.call) !== "ready") continue;
    queue.push({
      id: `contact-${row.call._id}`,
      priority: 50,
      tone: "amber",
      title: "Link contact context",
      description: callTitle(row),
      href: detailHref(row.call._id, "contact"),
      actionLabel: "Link contact",
    });
  }

  for (const reminder of sortRemindersAsc(
    reminders.filter((reminder) => reminder.status !== "completed")
  ).slice(0, 6)) {
    queue.push({
      id: `reminder-${reminder._id}`,
      priority: reminder.status === "overdue" ? 60 : 70,
      tone: reminder.status === "overdue" ? "rose" : "amber",
      title: reminder.status === "overdue" ? "Overdue follow-up" : "Upcoming follow-up",
      description: reminder.title,
      href: reminder.callId ? detailHref(reminder.callId, "reminders") : "/app/reminders",
      actionLabel: "View reminders",
      dueAt: reminder.remindAt,
    });
  }

  for (const row of activeThreads) {
    if (row.openFollowUpCount <= 0) continue;
    queue.push({
      id: `thread-${row.thread._id}`,
      priority: 80,
      tone: "stone",
      title: "Thread follow-up",
      description: `${row.thread.title} · ${row.openFollowUpCount} open`,
      href: row.thread.callIds[0] ? detailHref(row.thread.callIds[0], "reminders") : "/app/reminders",
      actionLabel: "Open thread",
      dueAt: row.nextFollowUpAt,
    });
  }

  return queue
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      return 0;
    })
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      tone: item.tone,
      title: item.title,
      description: item.description,
      href: item.href,
      actionLabel: item.actionLabel,
      ...(item.icon ? { icon: item.icon } : {}),
      ...(item.dueAt ? { dueAt: item.dueAt } : {}),
    }));
}

// In-flight pipeline statuses queried by processingStatus — one indexed
// collect per status is far cheaper than collecting every call the workspace
// ever made.
async function processingStatusCalls(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const statuses = [CALLING_STATUS, ...PROCESSING_STATUSES];
  const results = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query("calls")
        .withIndex("by_workspace_processing", (q) =>
          q.eq("workspaceId", workspaceId).eq("processingStatus", status)
        )
        .collect()
    )
  );
  return results.flat();
}

export const getProcessingCount = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const calls = await processingStatusCalls(ctx, workspaceId);
    return calls.length;
  },
});

// Only the calls a dashboard can possibly surface: the newest page, everything
// pending review, and everything in flight. Union + dedupe keeps old
// workspaces from reading their entire call history on every paint.
const DASHBOARD_RECENT_CALLS = 40;

export const getDashboardData = query({
  args: {
    postCallCallId: v.optional(v.id("calls")),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);

    const [recentCalls, reviewPendingCalls, processingCalls, cases, upcoming, overdue] =
      await Promise.all([
        ctx.db
          .query("calls")
          .withIndex("by_workspace_started", (q) => q.eq("workspaceId", workspaceId))
          .order("desc")
          .take(DASHBOARD_RECENT_CALLS),
        ctx.db
          .query("calls")
          .withIndex("by_review_pending", (q) =>
            q.eq("workspaceId", workspaceId).eq("reviewPending", true)
          )
          .collect(),
        processingStatusCalls(ctx, workspaceId),
        ctx.db
          .query("cases")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect(),
        ctx.db
          .query("reminders")
          .withIndex("by_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", "upcoming")
          )
          .collect(),
        ctx.db
          .query("reminders")
          .withIndex("by_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", "overdue")
          )
          .collect(),
      ]);

    const callsById = new Map<Id<"calls">, Doc<"calls">>();
    for (const call of [...recentCalls, ...reviewPendingCalls, ...processingCalls]) {
      callsById.set(call._id, call);
    }
    const sortedCalls = sortCallsDesc([...callsById.values()]);

    const getContact = contactLookup(ctx);

    const rows: CallRow[] = await Promise.all(
      sortedCalls.map(async (call) => {
        const [contact, memory, callReminders, createdByProfile] = await Promise.all([
          getContact(call.contactId),
          ctx.db
            .query("aiMemories")
            .withIndex("by_call", (q) => q.eq("callId", call._id))
            .first(),
          ctx.db
            .query("reminders")
            .withIndex("by_call", (q) => q.eq("callId", call._id))
            .collect(),
          call.createdByProfileId
            ? ctx.db.get(call.createdByProfileId)
            : Promise.resolve(null),
        ]);
        return {
          call,
          contact,
          memory,
          transcriptAvailable: Boolean(call.transcriptId),
          reminders: sortRemindersAsc(callReminders),
          createdByProfile,
        };
      })
    );

    const upcomingReminders = sortRemindersAsc([...upcoming, ...overdue]);
    const activeCases = cases
      .filter((item) => item.status !== "closed")
      .sort((a, b) => new Date(b.lastCallAt).getTime() - new Date(a.lastCallAt).getTime());

    const activeThreads = await Promise.all(
      activeCases.slice(0, 4).map(async (thread) => {
        const [threadActionItems, threadReminders] = await Promise.all([
          ctx.db
            .query("actionItems")
            .withIndex("by_case", (q) => q.eq("caseId", thread._id))
            .collect(),
          ctx.db
            .query("reminders")
            .withIndex("by_case", (q) => q.eq("caseId", thread._id))
            .collect(),
        ]);
        const openItems = threadActionItems.filter((item) => item.status !== "completed");
        const openReminders = sortRemindersAsc(
          threadReminders.filter((reminder) => reminder.status !== "completed")
        );
        return {
          thread,
          openFollowUpCount: openItems.length + openReminders.length,
          callCount: thread.callIds.length,
          nextFollowUpAt: openReminders[0]?.remindAt ?? thread.nextFollowUpAt,
        };
      })
    );

    const handoffRow = selectHandoffRow(rows, args.postCallCallId);
    const handoff = buildHandoff(handoffRow);

    return {
      stats: {
        hasCalls: rows.length > 0,
        processingCount: rows.filter((row) => {
          const stage = stageForCall(row.call);
          return stage === "calling" || stage === "processing";
        }).length,
      },
      handoff,
      workQueue: buildWorkQueue(rows, upcomingReminders, activeThreads, handoffRow?.call._id),
      recentActivity: rows.slice(0, 6).map((row) => {
        const stage = stageForCall(row.call);
        return {
          callId: row.call._id,
          title: callTitle(row),
          phoneNumber: row.call.dialedNumber,
          startedAt: row.call.startedAt,
          durationSeconds: row.call.durationSeconds,
          stage,
          statusLabel: row.call.reviewPending ? "Review pending" : statusLabel(row.call.processingStatus),
          summary: callSummary(row),
          href: detailHref(
            row.call._id,
            stage === "ready" ? (row.call.reviewPending ? "review" : "note") : undefined
          ),
          transcriptAvailable: row.transcriptAvailable,
          reminderCount: row.reminders.length,
          createdByName: profileLabel(row.createdByProfile),
        };
      }),
      activeThreads,
    };
  },
});
