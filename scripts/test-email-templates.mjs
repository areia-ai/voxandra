// Renders every transactional email template and asserts what a customer receives.
//
// These exist because convex/emails.ts used to define its templates inside the
// sendEmailAction closure, where nothing could reach them: the credit-request email
// was written, reviewed, committed and deployed without its HTML ever being
// rendered once. Templates now live in convex/emailTemplates.ts, which has no
// imports precisely so this file can load it outside a Convex deployment.

import assert from "node:assert/strict";
import {
  EMAIL_TEMPLATES,
  escapeHtml,
  getSubjectForTemplate,
} from "../convex/emailTemplates.ts";

// Every template the queue can name. A template that exists but is never listed
// here is exactly the gap this file was written to close.
const EXPECTED_TEMPLATES = [
  "welcome",
  "winback_unused_1",
  "winback_unused_2",
  "winback_unused_3",
  "winback_unused_4",
  "winback_unused_5",
  "winback_used_1",
  "winback_used_2",
  "winback_used_3",
  "winback_used_4",
  "winback_used_5",
  "free_call_used",
  "credit_request",
];

const UNSUBSCRIBE_URL = "https://voxandra.com/unsubscribe?token=tok_123";

// Every key the cron can supply is passed to every template on purpose: a
// transactional template that quietly started rendering unsubscribeUrl would then
// fail the assertions below rather than shipping an opt-out it cannot honour.
const SAMPLE = {
  name: "Sam",
  dialerUrl: "https://voxandra.com/app/dialer",
  reviewUrl: "https://voxandra.com/app",
  settingsUrl: "https://voxandra.com/app/wallet",
  requestedByName: "Sam Rivera",
  unsubscribeUrl: UNSUBSCRIBE_URL,
};

assert.deepEqual(
  Object.keys(EMAIL_TEMPLATES).sort(),
  [...EXPECTED_TEMPLATES].sort(),
  "template registry drifted from the expected set"
);

for (const name of EXPECTED_TEMPLATES) {
  const template = EMAIL_TEMPLATES[name];
  assert.ok(template, `${name}: missing from EMAIL_TEMPLATES`);
  assert.ok(template.subject.trim().length > 0, `${name}: empty subject`);

  const html = template.html(SAMPLE);
  assert.ok(html.startsWith("<!DOCTYPE html>"), `${name}: not wrapped in baseTemplate`);
  assert.ok(html.includes("</html>"), `${name}: unterminated document`);
  assert.ok(html.includes('class="button"'), `${name}: no call to action`);

  // The footer link is now driven entirely by whether an unsubscribe URL was
  // supplied. Marketing must carry one; transactional must not, because there is
  // nothing to opt out of on an email that answers something you just did — and
  // offering the link there implies otherwise. Asserted in BOTH directions: the
  // dead https://voxandra.com/settings link survived for months because nothing
  // rendered a template, and a one-directional check would not have caught it.
  const isMarketing = name.startsWith("winback_");
  if (isMarketing) {
    assert.ok(
      html.includes(UNSUBSCRIBE_URL),
      `${name}: marketing email must carry an unsubscribe link`
    );
  } else {
    assert.ok(
      !html.includes(UNSUBSCRIBE_URL) && !/>\s*Unsubscribe/i.test(html),
      `${name}: transactional email must not offer an unsubscribe`
    );
  }
  // The route that never existed.
  assert.ok(
    !html.includes('href="https://voxandra.com/settings"'),
    `${name}: /settings is not a route`
  );

  // An unsubstituted `${...}` or a literal "undefined" in a customer's inbox is
  // the visible symptom of a template rendered with the wrong metadata keys.
  assert.ok(!html.includes("undefined"), `${name}: rendered a literal "undefined"`);
  assert.ok(!/\$\{/.test(html), `${name}: unsubstituted template expression`);

  // Subjects had been written twice — in the registry and in a parallel lookup —
  // which is the duplicate-copy drift that once left four plan cards advertising a
  // stale "$0.40/min". One source of truth now, asserted.
  assert.equal(
    getSubjectForTemplate(name),
    template.subject,
    `${name}: subject lookup disagrees with the registry`
  );
}

assert.equal(
  getSubjectForTemplate("no_such_template"),
  "Voxandra Update",
  "unknown template should fall back to a generic subject"
);

// --- credit_request specifics -----------------------------------------------

const creditRequest = EMAIL_TEMPLATES.credit_request;
const rendered = creditRequest.html(SAMPLE);
assert.ok(rendered.includes("Sam Rivera"), "credit request should name the requester");
assert.ok(
  rendered.includes("https://voxandra.com/app/wallet"),
  "credit request should link to the wallet"
);

// The requester's display name is customer-supplied text rendered into someone
// else's inbox, so it must not be able to inject markup.
const injected = creditRequest.html({
  ...SAMPLE,
  requestedByName: '<img src=x onerror="alert(1)">',
});
assert.ok(!injected.includes("<img"), "credit request must escape requester markup");
assert.ok(!injected.includes('onerror="'), "credit request must escape event handlers");
assert.ok(injected.includes("&lt;img"), "credit request should show the escaped text");

// Falls back rather than rendering "undefined needs credits" when a job predates
// the requestedByName metadata field.
const anonymous = creditRequest.html({ settingsUrl: SAMPLE.settingsUrl });
assert.ok(anonymous.includes("A teammate"), "credit request needs an anonymous fallback");
assert.ok(
  anonymous.includes("https://voxandra.com/app/wallet"),
  "anonymous credit request still links to the wallet"
);

assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");

// --- win-back footer is driven by the URL, not by the template ----------------

// A win-back rendered WITHOUT a token (e.g. a job queued before the token existed)
// must not render a broken or empty unsubscribe link. It falls back to no link,
// which is the safe direction: a dead "Unsubscribe" is worse than none, because a
// reader who clicks it and nothing happens goes straight to the spam button.
const winbackNoToken = EMAIL_TEMPLATES.winback_unused_1.html({
  dialerUrl: SAMPLE.dialerUrl,
});
assert.ok(
  !/>\s*Unsubscribe/i.test(winbackNoToken),
  "win-back without a token must not render an empty unsubscribe link"
);
assert.ok(
  !winbackNoToken.includes('href=""') && !winbackNoToken.includes("undefined"),
  "win-back without a token must not render a broken href"
);

const marketingCount = Object.keys(EMAIL_TEMPLATES).filter((n) =>
  n.startsWith("winback_")
).length;
assert.equal(marketingCount, 10, "expected exactly ten marketing templates");

console.log(`Email template tests passed (${EXPECTED_TEMPLATES.length} templates).`);
