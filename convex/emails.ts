import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { escapeHtml, sendTransactionalEmail } from "./emailSender";
import { EMAIL_TEMPLATES, getSubjectForTemplate } from "./emailTemplates";

const WIN_BACK_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const LEGACY_POST_CALL_SEQUENCE = ["post", "call"].join("_");

const unusedFreeCallWinBackSequence = [
  { template: "winback_unused_1", delayHours: 0, step: 1 },
  { template: "winback_unused_2", delayHours: 48, step: 2 },
  { template: "winback_unused_3", delayHours: 120, step: 3 },
  { template: "winback_unused_4", delayHours: 216, step: 4 },
  { template: "winback_unused_5", delayHours: 336, step: 5 },
];

const usedFreeCallWinBackSequence = [
  { template: "winback_used_1", delayHours: 0, step: 1 },
  { template: "winback_used_2", delayHours: 48, step: 2 },
  { template: "winback_used_3", delayHours: 120, step: 3 },
  { template: "winback_used_4", delayHours: 216, step: 4 },
  { template: "winback_used_5", delayHours: 336, step: 5 },
];

type DbCtx = MutationCtx | QueryCtx;

async function workspaceHasTopUpPurchase(ctx: DbCtx, workspaceId: Id<"workspaces">) {
  const entries = await ctx.db
    .query("creditLedgerEntries")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  return entries.some((entry) => entry.type === "grant_top_up" && entry.amountCents > 0);
}

async function workspaceHasConverted(ctx: DbCtx, workspaceId: Id<"workspaces">) {
  const wallet = await ctx.db
    .query("walletSummaries")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  const hasPaidSubscription = Boolean(
    wallet && ACTIVE_SUBSCRIPTION_STATUSES.has(wallet.subscriptionStatus)
  );
  const hasTopUpPurchase = await workspaceHasTopUpPurchase(ctx, workspaceId);

  return {
    converted: hasPaidSubscription || hasTopUpPurchase,
    wallet,
    reason: hasPaidSubscription
      ? "paid_subscription"
      : hasTopUpPurchase
        ? "credit_purchase"
        : null,
  };
}

// Marketing opt-out applies to these two sequences and nothing else. Kept as a
// prefix test rather than a list so a new winback_* sequence is suppressed by
// default instead of quietly shipping without an unsubscribe.
export function isWinBackSequence(sequenceName: string | undefined) {
  return sequenceName?.startsWith("winback_") ?? false;
}

async function getProfileByUserId(ctx: DbCtx, userId: string) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

function createUnsubscribeToken() {
  // Same shape as convex/team.ts createInviteToken: three UUIDs, far beyond
  // guessable, and it has to stay stable because it is baked into ten emails that
  // may sit in an inbox for months.
  if (typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Called from scheduleWinBackIfUnconverted — the one mutation that always runs
// before any win-back is queued — so existing profiles get a token without a
// backfill migration and no marketing email can be sent without one.
async function ensureUnsubscribeToken(ctx: MutationCtx, userId: string) {
  const profile = await getProfileByUserId(ctx, userId);
  if (!profile) return null;
  if (profile.unsubscribeToken) return profile.unsubscribeToken;
  const token = createUnsubscribeToken();
  await ctx.db.patch(profile._id, { unsubscribeToken: token });
  return token;
}

async function getProfileEmail(ctx: MutationCtx, userId: string) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return profile?.email?.trim() ?? "";
}

async function getWorkspaceOwnerUserId(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const ownerMembership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .filter((q) => q.eq(q.field("role"), "owner"))
    .first();
  return ownerMembership?.userId ?? null;
}

export const CREDIT_REQUEST_TEMPLATE = "credit_request";
export const CREDIT_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Owners AND admins: since getTopUpBillingContext both roles can buy credits, so
// mailing only the owner would route the nudge past people who could act on it now.
async function getCreditBuyerUserIds(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const memberships = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return memberships
    .filter((membership) => membership.role === "owner" || membership.role === "admin")
    .map((membership) => membership.userId);
}

export async function enqueueCreditRequestEmail(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    requestedByUserId: string;
    requestedByName: string;
  }
): Promise<{ queued: number; reason?: string }> {
  const now = Date.now();
  const jobs = await ctx.db
    .query("emailJobs")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .collect();

  // One nudge per WORKSPACE per window, not per requester. Five reps hitting the
  // same wall at 2pm must not put five emails in the owner's inbox — that trains
  // people to ignore the nudge, which is the only failure mode that matters here.
  const alreadyNudged = jobs.some(
    (job) =>
      job.templateName === CREDIT_REQUEST_TEMPLATE &&
      (job.status === "pending" ||
        (job.sentAt !== undefined && now - job.sentAt < CREDIT_REQUEST_COOLDOWN_MS))
  );
  if (alreadyNudged) return { queued: 0, reason: "cooldown" };

  const recipients = await getCreditBuyerUserIds(ctx, args.workspaceId);
  let queued = 0;
  for (const userId of recipients) {
    // Never mail the requester their own nudge (an admin can ask the owner).
    if (userId === args.requestedByUserId) continue;
    const email = await getProfileEmail(ctx, userId);
    if (!email) continue;
    await ctx.db.insert("emailJobs", {
      workspaceId: args.workspaceId,
      userId,
      email,
      templateName: CREDIT_REQUEST_TEMPLATE,
      scheduledAt: now,
      status: "pending",
      metadata: { requestedByName: args.requestedByName },
    });
    queued += 1;
  }

  return { queued, reason: queued === 0 ? "no_recipients" : undefined };
}

async function hasSequenceJob(
  ctx: MutationCtx,
  userId: string,
  workspaceId: Id<"workspaces">,
  sequenceName: string
) {
  const jobs = await ctx.db
    .query("emailJobs")
    .withIndex("by_sequence", (q) =>
      q.eq("userId", userId).eq("sequenceName", sequenceName)
    )
    .collect();

  return jobs.some((job) => job.workspaceId === workspaceId && job.status !== "cancelled");
}

// Schedule the default nurture sequence for a new user
export const scheduleNurtureSequence = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    workspaceId: v.id("workspaces"),
    freeCallMade: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const alreadyWelcomed = await hasSequenceJob(
      ctx,
      args.userId,
      args.workspaceId,
      "account_onboarding"
    );

    if (!alreadyWelcomed) {
      await ctx.db.insert("emailJobs", {
        workspaceId: args.workspaceId,
        userId: args.userId,
        email: args.email,
        templateName: "welcome",
        scheduledAt: now,
        status: "pending",
        sequenceName: "account_onboarding",
        sequenceStep: 1,
        metadata: {
          freeCallMade: args.freeCallMade || false,
        },
      });
    }

    await ctx.scheduler.runAfter(WIN_BACK_DELAY_MS, internal.emails.scheduleWinBackIfUnconverted, {
      userId: args.userId,
      workspaceId: args.workspaceId,
    });

    return { scheduled: alreadyWelcomed ? 0 : 1, winBackCheckScheduledAt: now + WIN_BACK_DELAY_MS };
  },
});

// Legacy scheduled callbacks may still reference this function after deploys.
// Memory-ready email is now scheduled only after AI extraction succeeds.
export const markFreeCallMade = internalMutation({
  args: {
    userId: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async () => {
    return { scheduled: 0, reason: "memory_ready_email_waits_for_extraction" };
  },
});

export const scheduleWinBackIfUnconverted = internalMutation({
  args: {
    userId: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const { converted, wallet, reason } = await workspaceHasConverted(ctx, args.workspaceId);
    if (converted) {
      return { scheduled: 0, reason };
    }

    const email = await getProfileEmail(ctx, args.userId);
    if (!email) {
      return { scheduled: 0, reason: "missing_email" };
    }

    const profile = await getProfileByUserId(ctx, args.userId);
    if (profile?.marketingEmailOptOut) {
      return { scheduled: 0, reason: "opted_out" };
    }
    // No marketing email may be queued without a working way out of it.
    const unsubscribeToken = await ensureUnsubscribeToken(ctx, args.userId);
    if (!unsubscribeToken) {
      return { scheduled: 0, reason: "missing_unsubscribe_token" };
    }

    const freeCallMade = wallet?.freeCallUsed ?? false;
    const sequenceName = freeCallMade ? "winback_free_call_used" : "winback_free_call_unused";
    const existing = await hasSequenceJob(ctx, args.userId, args.workspaceId, sequenceName);
    if (existing) {
      return { scheduled: 0, reason: "already_scheduled" };
    }

    const now = Date.now();
    const sequence = freeCallMade ? usedFreeCallWinBackSequence : unusedFreeCallWinBackSequence;
    for (const item of sequence) {
      await ctx.db.insert("emailJobs", {
        workspaceId: args.workspaceId,
        userId: args.userId,
        email,
        templateName: item.template,
        scheduledAt: now + item.delayHours * 60 * 60 * 1000,
        status: "pending",
        sequenceName,
        sequenceStep: item.step,
        metadata: {
          freeCallMade,
        },
      });
    }

    return { scheduled: sequence.length, reason: freeCallMade ? "free_call_used" : "free_call_unused" };
  },
});

export const scheduleFreeCallMemoryReadyEmail = internalMutation({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || !call.isFreeCall || !call.aiMemoryReady) {
      return { scheduled: 0, reason: "not_ready_free_call" };
    }

    const ownerUserId = await getWorkspaceOwnerUserId(ctx, call.workspaceId);
    if (!ownerUserId) {
      return { scheduled: 0, reason: "missing_owner" };
    }
    const email = await getProfileEmail(ctx, ownerUserId);
    if (!email) {
      return { scheduled: 0, reason: "missing_email" };
    }

    const sequenceName = "free_call_memory_ready";
    const existing = await hasSequenceJob(ctx, ownerUserId, call.workspaceId, sequenceName);
    if (existing) {
      return { scheduled: 0, reason: "already_scheduled" };
    }

    const now = Date.now();
    const parsedEndedAt = call.endedAt ? Date.parse(call.endedAt) : NaN;
    await ctx.db.insert("emailJobs", {
      workspaceId: call.workspaceId,
      userId: ownerUserId,
      email,
      templateName: "free_call_used",
      scheduledAt: now,
      status: "pending",
      sequenceName,
      sequenceStep: 1,
      metadata: {
        freeCallMade: true,
        firstCallAt: Number.isFinite(parsedEndedAt) ? parsedEndedAt : now,
        memoryReviewed: false,
      },
    });

    return { scheduled: 1, reason: "memory_ready" };
  },
});

// Get pending emails that should be sent
export const getPendingEmails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const jobs = await ctx.db
      .query("emailJobs")
      .withIndex("by_status_scheduled", (q) =>
        q.eq("status", "pending").lte("scheduledAt", now)
      )
      .take(100);

    // The token rides along on win-back jobs so convex/emailCron.ts can build the
    // unsubscribe URL without a second round trip per job. Transactional jobs get
    // undefined, which is what keeps the link off their footer.
    return await Promise.all(
      jobs.map(async (job) => {
        if (!isWinBackSequence(job.sequenceName)) {
          return { ...job, unsubscribeToken: undefined as string | undefined };
        }
        const profile = await getProfileByUserId(ctx, job.userId);
        return { ...job, unsubscribeToken: profile?.unsubscribeToken };
      })
    );
  },
});

// Public but secret-guarded, and takes NO userId: the profile is derived entirely
// from the token, so a caller cannot unsubscribe anyone but the token's owner.
// Same pattern as the other non-Convex-Auth data paths in this repo.
export const unsubscribeByToken = mutation({
  args: {
    secret: v.string(),
    token: v.string(),
    optOut: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.UNSUBSCRIBE_CONVEX_SECRET;
    // Fails closed: an unset secret must not turn this into an open endpoint.
    if (!expected || args.secret !== expected) {
      throw new Error("Unauthorized");
    }

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", args.token))
      .first();
    // Deliberately generic: the response must not reveal whether a token exists.
    if (!profile) return { ok: false as const };

    const optOut = args.optOut ?? true;
    await ctx.db.patch(profile._id, { marketingEmailOptOut: optOut });

    // Empty the queue rather than leaving five rows to be re-evaluated every five
    // minutes. shouldSendEmailJob still re-checks as the backstop.
    let cancelled = 0;
    if (optOut) {
      const jobs = await ctx.db
        .query("emailJobs")
        .withIndex("by_user", (q) => q.eq("userId", profile.userId))
        .collect();
      for (const job of jobs) {
        if (job.status !== "pending" || !isWinBackSequence(job.sequenceName)) continue;
        await ctx.db.patch(job._id, { status: "cancelled" });
        cancelled += 1;
      }
    }

    return { ok: true as const, optOut, cancelled };
  },
});

export const shouldSendEmailJob = internalQuery({
  args: {
    jobId: v.id("emailJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "pending") {
      return { send: false, reason: "not_pending" };
    }

    if (job.sequenceName === "nurture" || job.sequenceName === LEGACY_POST_CALL_SEQUENCE) {
      return { send: false, reason: "legacy_sequence" };
    }

    const isWinBack = isWinBackSequence(job.sequenceName);
    if (!isWinBack) {
      return { send: true, reason: "transactional_or_non_winback" };
    }

    // Backstop. unsubscribeByToken already cancels this user's pending win-backs,
    // so this should rarely fire — but a job queued between the opt-out and the
    // next cron tick would otherwise slip through, and an opt-out that leaks even
    // one email is the one that produces a spam complaint.
    const profile = await getProfileByUserId(ctx, job.userId);
    if (profile?.marketingEmailOptOut) {
      return { send: false, reason: "opted_out" };
    }

    const { converted, reason } = await workspaceHasConverted(ctx, job.workspaceId);
    if (converted) {
      return { send: false, reason: reason ?? "converted" };
    }

    return { send: true, reason: "unconverted" };
  },
});

// Action to send a single email via Resend
export const sendEmailAction: ReturnType<typeof internalAction> = internalAction({
  args: {
    jobId: v.id("emailJobs"),
    to: v.string(),
    templateName: v.string(),
    userId: v.string(),
    workspaceId: v.id("workspaces"),
    metadata: v.optional(v.object({
      name: v.optional(v.string()),
      dialerUrl: v.optional(v.string()),
      reviewUrl: v.optional(v.string()),
      settingsUrl: v.optional(v.string()),
      requestedByName: v.optional(v.string()),
      unsubscribeUrl: v.optional(v.string()),
      unsubscribeOneClickUrl: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    try {
      const deliveryCheck = await ctx.runQuery(internal.emails.shouldSendEmailJob, {
        jobId: args.jobId,
      });
      if (!deliveryCheck.send) {
        await ctx.runMutation(internal.emails.cancelEmailJob, {
          jobId: args.jobId,
          reason: deliveryCheck.reason,
        });
        return { success: true, skipped: true, reason: deliveryCheck.reason };
      }

      const template = EMAIL_TEMPLATES[args.templateName];
      if (!template) {
        throw new Error(`Template ${args.templateName} not found`);
      }

      // Only marketing mail gets these. Putting List-Unsubscribe on a transactional
      // receipt tells the mail client it is bulk, which is both untrue and worse
      // for delivery of the messages people actually want.
      const oneClickUrl = args.metadata?.unsubscribeOneClickUrl;
      const headers = oneClickUrl
        ? {
            "List-Unsubscribe": `<${oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined;

      const result = await sendTransactionalEmail({
        to: args.to,
        subject: template.subject,
        html: template.html(args.metadata || {}),
        headers,
      });

      if (!result) {
        console.log("Resend not configured, marking as sent for dev");
        await ctx.runMutation(internal.emails.markEmailSent, {
          jobId: args.jobId,
          resendId: "dev-mock",
        });
        return { success: true, mock: true };
      }

      await ctx.runMutation(internal.emails.markEmailSent, {
        jobId: args.jobId,
        resendId: result.id || undefined,
      });

      return { success: true, id: result.id };
    } catch (error) {
      console.error("Failed to send email:", error);
      await ctx.runMutation(internal.emails.markEmailFailed, {
        jobId: args.jobId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

export const sendWorkspaceInviteEmail = internalAction({
  args: {
    invitationId: v.id("workspaceInvitations"),
    to: v.string(),
    inviteUrl: v.string(),
    inviterName: v.string(),
    workspaceName: v.string(),
    roleLabel: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const inviterName = escapeHtml(args.inviterName);
      const workspaceName = escapeHtml(args.workspaceName);
      const roleLabel = escapeHtml(args.roleLabel);
      const escapedInviteUrl = escapeHtml(args.inviteUrl);
      const subject = `${args.inviterName} invited you to ${args.workspaceName} on Voxandra`;
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join ${workspaceName}</title>
</head>
<body style="margin:0;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="margin-bottom:24px;font-size:24px;font-weight:700;color:#3b1676;">Voxandra</div>
    <div style="border:1px solid #e7e5e4;background:#ffffff;border-radius:12px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#1c1917;">Join ${workspaceName}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#57534e;">
        ${inviterName} invited you to work in ${workspaceName} as a ${roleLabel.toLowerCase()}.
      </p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#57534e;">
        You will be able to share call records, contacts, reminders, and work threads with the team.
      </p>
      <a href="${escapedInviteUrl}" style="display:inline-block;border-radius:8px;background:#3b1676;color:#ffffff;padding:12px 18px;text-decoration:none;font-weight:700;font-size:14px;">
        Accept invite
      </a>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#78716c;">
        This invite expires in 7 days. If the button does not work, open this link:<br>
        <a href="${escapedInviteUrl}" style="color:#3b1676;">${escapedInviteUrl}</a>
      </p>
    </div>
  </div>
</body>
</html>`;

      const result = await sendTransactionalEmail({
        to: args.to,
        subject,
        html,
      });

      if (!result) {
        console.log("Resend not configured, skipping workspace invite email", {
          to: args.to,
          workspaceName: args.workspaceName,
        });
        await ctx.runMutation(internal.team.markInvitationEmailDelivery, {
          invitationId: args.invitationId,
          status: "skipped",
        });
        return { success: true, skipped: true };
      }

      await ctx.runMutation(internal.team.markInvitationEmailDelivery, {
        invitationId: args.invitationId,
        status: "sent",
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email error";
      console.error("Failed to send workspace invite email:", error);
      await ctx.runMutation(internal.team.markInvitationEmailDelivery, {
        invitationId: args.invitationId,
        status: "failed",
        error: message,
      });
      return { success: false, error: message };
    }
  },
});

// Mark email as sent
export const markEmailSent = internalMutation({
  args: {
    jobId: v.id("emailJobs"),
    resendId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    // Update job status
    await ctx.db.patch(args.jobId, {
      status: "sent",
      sentAt: Date.now(),
      resendId: args.resendId,
    });

    // Log the send
    await ctx.db.insert("emailLogs", {
      workspaceId: job.workspaceId,
      userId: job.userId,
      email: job.email,
      templateName: job.templateName,
      subject: getSubjectForTemplate(job.templateName),
      sentAt: Date.now(),
      resendId: args.resendId,
      status: "delivered",
      metadata: {
        sequenceName: job.sequenceName,
        sequenceStep: job.sequenceStep,
      },
    });
  },
});

// Mark email as failed
export const markEmailFailed = internalMutation({
  args: {
    jobId: v.id("emailJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, { status: "failed" });
  },
});

export const cancelEmailJob = internalMutation({
  args: {
    jobId: v.id("emailJobs"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    void args.reason;
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "pending") return;

    await ctx.db.patch(args.jobId, { status: "cancelled" });
  },
});
