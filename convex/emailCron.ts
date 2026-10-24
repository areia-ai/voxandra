import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";

function appOrigin() {
  return (process.env.SITE_URL || "https://voxandra.com").replace(/\/$/, "");
}

// The visible footer link: a page a human lands on, with an undo.
function unsubscribeUrl(token: string) {
  return `${appOrigin()}/unsubscribe?token=${encodeURIComponent(token)}`;
}

// The RFC 8058 List-Unsubscribe target, which mail clients POST to without ever
// showing the user a page. Deliberately a different URL from the footer link: this
// one must accept POST and do the opt-out with no confirmation step.
function unsubscribeOneClickUrl(token: string) {
  return `${appOrigin()}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function processPendingEmailsHandler(ctx: ActionCtx): Promise<{ processed: number }> {
  const jobs = await ctx.runQuery(internal.emails.getPendingEmails);

  console.log(`Processing ${jobs.length} pending emails`);

  for (const job of jobs) {
    await ctx.runAction(internal.emails.sendEmailAction, {
      jobId: job._id,
      to: job.email,
      templateName: job.templateName,
      userId: job.userId,
      workspaceId: job.workspaceId,
      metadata: {
        name: job.email.split("@")[0],
        dialerUrl: `${process.env.SITE_URL || "https://voxandra.com"}/app/dialer`,
        reviewUrl: `${process.env.SITE_URL || "https://voxandra.com"}/app`,
        settingsUrl: `${process.env.SITE_URL || "https://voxandra.com"}/app/wallet`,
        // Only win-back jobs carry a token (see getPendingEmails), so this is what
        // keeps the unsubscribe line off transactional mail: no URL, no footer link.
        ...(job.unsubscribeToken
          ? {
              unsubscribeUrl: unsubscribeUrl(job.unsubscribeToken),
              unsubscribeOneClickUrl: unsubscribeOneClickUrl(job.unsubscribeToken),
            }
          : {}),
        // Forwarded field by field, never spread. `job.metadata` also carries
        // booleans and timestamps that sendEmailAction's validator rejects, so a
        // blind `...job.metadata` would fail every job that has any metadata.
        ...(job.metadata?.requestedByName
          ? { requestedByName: job.metadata.requestedByName }
          : {}),
      },
    });
  }

  return { processed: jobs.length };
}

// Cron job that runs every 5 minutes to send pending emails
export const processPendingEmails = internalAction({
  args: {},
  handler: processPendingEmailsHandler,
});
