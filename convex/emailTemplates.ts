// Every transactional email body lives here, with ZERO imports, so the templates
// can be rendered and asserted outside a Convex deployment — that is what
// scripts/test-email-templates.mjs relies on, and why escapeHtml lives here
// rather than being imported from ./emailSender (which re-exports it, so existing
// call sites are unaffected). Keep this file import-free: a single import of a
// Convex module would make every template untestable again.
// They previously lived inside the sendEmailAction closure in convex/emails.ts,
// which made them unreachable from a test: the credit-request email shipped
// without its HTML ever having been looked at, and nothing would have caught it.
//
// EMAIL_TEMPLATES is also the single source of truth for subjects. The subject
// strings used to be written twice — once here and once in getSubjectForTemplate
// — which is the same duplicate-copy drift that made four plan cards advertise a
// stale "$0.40/min".

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type EmailTemplateData = Record<string, string>;

export type EmailTemplate = {
  subject: string;
  html: (data: EmailTemplateData) => string;
};

// The unsubscribe line appears ONLY when an unsubscribe URL is supplied, which in
// practice means only the ten win-back emails. It used to appear on everything,
// pointing at a route that did not exist — and offering it on "your call record is
// ready" implies an opt-out that cannot exist, because that email answers
// something the person just did.
function unsubscribeFooter(unsubscribeUrl?: string): string {
  if (!unsubscribeUrl) return "";
  return `
      <p><a href="${unsubscribeUrl}">Unsubscribe from these emails</a></p>`;
}

function baseTemplate(content: string, unsubscribeUrl?: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voxandra</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1c1917; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 24px; font-weight: 700; color: #3b1676; }
    .content { background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .button { display: inline-block; background: #3b1676; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0; }
    .button:hover { background: #4a2080; }
    .footer { text-align: center; margin-top: 32px; font-size: 12px; color: #78716c; }
    .highlight { background: #f5f3ff; border-left: 4px solid #3b1676; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Voxandra</div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>Voxandra — AI that remembers every call</p>${unsubscribeFooter(unsubscribeUrl)}
    </div>
  </div>
</body>
</html>`;
}

function welcomeTemplate(name: string, dialerUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0; color: #1c1917;">Welcome to Voxandra, ${name}</h1>
    <p>Your workspace is ready. Start with one 90-second browser call and Voxandra will turn it into a reviewed call record: transcript, AI note, extracted details, and follow-up reminders.</p>
    ${process.env.TRANSLATED_TRIAL_ENABLED === "true" ? "<p>Sign in and choose both languages to try two-way spoken translation on your workspace's one free call. No card or subscription is required. The trial limit includes setup and the introduction; Live Guidance stays off.</p>" : ""}
    <div class="highlight">
      <strong>Your trial includes:</strong>
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li>One 90-second browser call</li>
        <li>Transcript and AI note after the call</li>
        <li>Suggested details, reminders, contacts, and work-thread context</li>
      </ul>
    </div>
    <p style="text-align: center;">
      <a href="${dialerUrl || "https://voxandra.com/app/dialer"}" class="button">Start the trial call</a>
    </p>
    <p style="font-size: 14px; color: #78716c;">Questions? Reply to this email and we will help.</p>
  `);
}

function winbackUnusedOneTemplate(dialerUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Still want to try Voxandra?</h1>
    <p>You created a Voxandra workspace, but the trial call has not been used yet. The fastest way to evaluate the product is to use it on one real operational call.</p>
    <div class="highlight">
      <p style="margin: 0;"><strong>After the call, review:</strong></p>
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li>The transcript</li>
        <li>The AI note and outcome</li>
        <li>Suggested reminders and extracted details</li>
      </ul>
    </div>
    <p style="text-align: center;">
      <a href="${dialerUrl || "https://voxandra.com/app/dialer"}" class="button">Use the 90-second trial</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUnusedTwoTemplate(dialerUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">What Voxandra saves from a phone call</h1>
    <p>Voxandra is built for teams whose phone calls create operational records: payment releases, supplier updates, customer escalations, service requests, and next-step commitments.</p>
    <div class="highlight">
      <p style="margin: 0;">Instead of manually reconstructing the conversation, review the AI note, accept useful suggestions, and keep moving.</p>
    </div>
    <p style="text-align: center;">
      <a href="${dialerUrl || "https://voxandra.com/app/dialer"}" class="button">Try it on one call</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUnusedThreeTemplate(dialerUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">From one call to follow-through</h1>
    <p>Voxandra is useful because it does not stop at a transcript. It organizes the conversation into practical follow-through surfaces.</p>
    <div class="highlight">
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li>Action items and reminders</li>
        <li>Contact cleanup suggestions</li>
        <li>Work-thread context for related calls</li>
      </ul>
    </div>
    <p style="text-align: center;">
      <a href="${dialerUrl || "https://voxandra.com/app/dialer"}" class="button">Start the trial call</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUnusedFourTemplate(dialerUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Use the trial before the next important call</h1>
    <p>The trial is intentionally short. Pick a call where the outcome, owner, blocker, or follow-up date matters, then compare Voxandra's call record with the notes you would normally write by hand.</p>
    <p style="text-align: center;">
      <a href="${dialerUrl || "https://voxandra.com/app/dialer"}" class="button">Open the dialer</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUnusedFiveTemplate(dialerUrl?: string, settingsUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Should Voxandra stay on your radar?</h1>
    <p>If your team works through phone calls, Voxandra can be a lightweight way to keep transcripts, AI notes, reminders, contacts, and work threads together.</p>
    <div class="highlight">
      <p style="margin: 0;">Use the trial call if you still want to test it. If you already know you need more call time, add credits or choose a paid plan.</p>
    </div>
    <p style="text-align: center;">
      <a href="${dialerUrl || "https://voxandra.com/app/dialer"}" class="button">Use trial</a>
      <a href="${settingsUrl || "https://voxandra.com/app/wallet"}" class="button" style="margin-left: 8px; background: #0f766e;">View plans</a>
    </p>
  `, unsubscribeUrl);
}

function freeCallUsedTemplate(reviewUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Your call record is ready</h1>
    <p>Your trial call has been transcribed and turned into a reviewed call record. Open it to check the AI note, transcript, extracted details, and suggested follow-up.</p>
    <div class="highlight">
      <p style="margin: 0;"><strong>Review before it updates team records:</strong></p>
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li>AI note and outcome</li>
        <li>Transcript</li>
        <li>Reminders, contacts, and extracted details</li>
      </ul>
    </div>
    <p style="text-align: center;">
      <a href="${reviewUrl || "https://voxandra.com/app"}" class="button">Review Call Record</a>
    </p>
  `);
}

// The requester's name is customer-supplied text arriving from a workspace member,
// so it goes through escapeHtml before it reaches the owner's inbox.
function creditRequestTemplate(requestedByName?: string, settingsUrl?: string): string {
  const who = requestedByName?.trim() ? escapeHtml(requestedByName.trim()) : "A teammate";
  return baseTemplate(`
    <h1 style="margin-top: 0;">${who} needs credits</h1>
    <p>${who} tried to use something in your Voxandra workspace that needs credits, and could not. One balance covers call minutes plus Live Guidance and Live Translation past your plan's included minutes.</p>
    <div class="highlight">
      <p style="margin: 0;"><strong>Owners and admins can add credits.</strong> Purchased top-up credits roll over and never expire.</p>
    </div>
    <p style="text-align: center;">
      <a href="${settingsUrl || "https://voxandra.com/app/wallet"}" class="button">Add credits</a>
    </p>
  `);
}

function winbackUsedOneTemplate(reviewUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Review the call record from your trial call</h1>
    <p>You used the trial call, but the workspace has not added credits or started a paid plan yet. Start by reviewing the saved Call Record and checking whether the AI note matches what you need after real calls.</p>
    <p style="text-align: center;">
      <a href="${reviewUrl || "https://voxandra.com/app"}" class="button">Review Call Record</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUsedTwoTemplate(reviewUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Turn call records into next steps</h1>
    <p>The value comes after the call: accept useful reminders, clean up contact details, and keep the conversation tied to the right work thread.</p>
    <div class="highlight">
      <p style="margin: 0;">Reviewing one call is the best way to decide whether Voxandra should become part of your team's phone workflow.</p>
    </div>
    <p style="text-align: center;">
      <a href="${reviewUrl || "https://voxandra.com/app"}" class="button">Open your workspace</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUsedThreeTemplate(dialerUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Make the next call easier to review</h1>
    <p>Before dialing, add a short objective and, if it helps, your own call checklist. Voxandra uses that context to shape the post-call review around what matters.</p>
    <p style="text-align: center;">
      <a href="${dialerUrl || "https://voxandra.com/app/dialer"}" class="button">Open the dialer</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUsedFourTemplate(settingsUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">When Voxandra helps most</h1>
    <p>Voxandra is strongest for calls where teams need a durable record: supplier updates, finance blockers, customer escalations, partner handoffs, and recurring operational follow-up.</p>
    <div class="highlight">
      <p style="margin: 0;">Add credits for occasional browser calls, or choose a paid plan when this workflow becomes recurring.</p>
    </div>
    <p style="text-align: center;">
      <a href="${settingsUrl || "https://voxandra.com/app/wallet"}" class="button">View plans and credits</a>
    </p>
  `, unsubscribeUrl);
}

function winbackUsedFiveTemplate(settingsUrl?: string, unsubscribeUrl?: string): string {
  return baseTemplate(`
    <h1 style="margin-top: 0;">Keep Voxandra available for your next call</h1>
    <p>If the trial Call Record was useful, the next step is simple: add calling credits for occasional use or start a paid plan for recurring work.</p>
    <p style="text-align: center;">
      <a href="${settingsUrl || "https://voxandra.com/app/wallet"}" class="button">Choose the next step</a>
    </p>
    <p style="font-size: 14px; color: #78716c;">You can also reply to this email if you want help choosing the right setup.</p>
  `, unsubscribeUrl);
}

export const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  welcome: {
    subject: "Your 90-second Voxandra trial is ready",
    html: (d) => welcomeTemplate(d.name || "there", d.dialerUrl),
  },
  winback_unused_1: {
    subject: "Still want to try Voxandra?",
    html: (d) => winbackUnusedOneTemplate(d.dialerUrl, d.unsubscribeUrl),
  },
  winback_unused_2: {
    subject: "What Voxandra saves from a phone call",
    html: (d) => winbackUnusedTwoTemplate(d.dialerUrl, d.unsubscribeUrl),
  },
  winback_unused_3: {
    subject: "From one call to follow-through",
    html: (d) => winbackUnusedThreeTemplate(d.dialerUrl, d.unsubscribeUrl),
  },
  winback_unused_4: {
    subject: "Use the trial before the next important call",
    html: (d) => winbackUnusedFourTemplate(d.dialerUrl, d.unsubscribeUrl),
  },
  winback_unused_5: {
    subject: "Should Voxandra stay on your radar?",
    html: (d) => winbackUnusedFiveTemplate(d.dialerUrl, d.settingsUrl, d.unsubscribeUrl),
  },
  winback_used_1: {
    subject: "Review the call record from your trial call",
    html: (d) => winbackUsedOneTemplate(d.reviewUrl, d.unsubscribeUrl),
  },
  winback_used_2: {
    subject: "Turn call records into next steps",
    html: (d) => winbackUsedTwoTemplate(d.reviewUrl, d.unsubscribeUrl),
  },
  winback_used_3: {
    subject: "Make the next call easier to review",
    html: (d) => winbackUsedThreeTemplate(d.dialerUrl, d.unsubscribeUrl),
  },
  winback_used_4: {
    subject: "When Voxandra helps most",
    html: (d) => winbackUsedFourTemplate(d.settingsUrl, d.unsubscribeUrl),
  },
  winback_used_5: {
    subject: "Keep Voxandra available for your next call",
    html: (d) => winbackUsedFiveTemplate(d.settingsUrl, d.unsubscribeUrl),
  },
  free_call_used: {
    subject: "Your call record is ready",
    html: (d) => freeCallUsedTemplate(d.reviewUrl),
  },
  credit_request: {
    subject: "A teammate needs Voxandra credits",
    html: (d) => creditRequestTemplate(d.requestedByName, d.settingsUrl),
  },
};

export function getSubjectForTemplate(templateName: string): string {
  return EMAIL_TEMPLATES[templateName]?.subject || "Voxandra Update";
}
