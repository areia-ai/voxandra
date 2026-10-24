const DEFAULT_EMAIL_FROM = "Voxandra <hello@mail.voxandra.com>";
const DEFAULT_EMAIL_REPLY_TO = "contact@voxandra.com";

export function emailSenderConfig() {
  return {
    from: process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || DEFAULT_EMAIL_REPLY_TO,
  };
}

// Lives in ./emailTemplates so that module can stay import-free and therefore
// renderable outside a deployment. Re-exported here because convex/auth.ts and
// convex/emails.ts already import it from this module.
export { escapeHtml } from "./emailTemplates";

export interface SendTransactionalEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  // Used for RFC 8058 one-click unsubscribe on marketing sequences. Gmail and
  // Yahoo's bulk-sender rules expect List-Unsubscribe plus List-Unsubscribe-Post
  // on marketing mail, and a sender without them accumulates spam complaints
  // instead of unsubscribes — which then degrades delivery of the transactional
  // mail on the same domain.
  headers?: Record<string, string>;
}

export interface SendTransactionalEmailResult {
  id?: string;
}

// Shared Resend client + send call. Every Resend-sending code path in convex/
// should go through this instead of constructing its own client, so there is
// one place that knows how to talk to Resend.
//
// Returns null when RESEND_API_KEY isn't configured (dev default) so each
// call site can keep its own "not configured" handling. Send failures throw,
// same as calling resend.emails.send directly, so existing try/catch blocks
// at call sites keep working unchanged.
export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput
): Promise<SendTransactionalEmailResult | null> {
  const { Resend } = await import("resend");
  const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

  if (!resend) {
    return null;
  }

  const sender = emailSenderConfig();
  const result = await resend.emails.send({
    from: input.from || sender.from,
    to: input.to,
    replyTo: input.replyTo || sender.replyTo,
    subject: input.subject,
    html: input.html,
    ...(input.headers && Object.keys(input.headers).length > 0
      ? { headers: input.headers }
      : {}),
  });

  return { id: result.data?.id };
}
