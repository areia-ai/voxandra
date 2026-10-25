import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(source, unexpected, label) {
  if (source.includes(unexpected)) {
    throw new Error(`${label}: should not include ${JSON.stringify(unexpected)}`);
  }
}

function assertNotMatches(source, unexpected, label) {
  if (unexpected.test(source)) {
    throw new Error(`${label}: should not match ${unexpected}`);
  }
}

function assertOccurrences(source, expected, count, label) {
  const actual = source.split(expected).length - 1;
  if (actual !== count) {
    throw new Error(
      `${label}: expected ${count} occurrence(s) of ${JSON.stringify(expected)}, found ${actual}`
    );
  }
}

function assertPathMissing(path, label) {
  if (existsSync(join(root, path))) {
    throw new Error(`${label}: ${path} should not exist`);
  }
}

const extractionPrompt = read("src/lib/ai/extraction-prompt.ts");
assertIncludes(
  extractionPrompt,
  'AI_EXTRACTION_PROMPT_VERSION = "call-memory-v9-operator-language-authority"',
  "prompt version"
);
assertIncludes(extractionPrompt, "Language handling (critical):", "language instructions");
assertIncludes(
  extractionPrompt,
  "Write all human-reviewable generated content in callRecordLanguage.",
  "operator-language review content"
);
assertIncludes(
  extractionPrompt,
  "Keep app UI chrome outside this JSON in English",
  "english UI chrome boundary"
);
assertIncludes(
  extractionPrompt,
  "Treat callRecordLanguage as authoritative for generated operational content",
  "operator language overrides transcript and contextual record language"
);
assertIncludes(
  extractionPrompt,
  "Required generated-content language:",
  "extraction repeats authoritative language beside transcript"
);
assertIncludes(
  extractionPrompt,
  "Treat cases as lightweight work threads",
  "work-thread extraction framing"
);
assertIncludes(
  extractionPrompt,
  "Keep representative and institution separate",
  "representative institution separation"
);

const transcription = read("src/lib/server/openai-transcription.ts");
assertIncludes(
  transcription,
  'DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize"',
  "default transcription model"
);
assertIncludes(transcription, 'request.response_format = "diarized_json"', "diarized response format");
assertIncludes(transcription, 'request.chunking_strategy = "auto"', "diarized chunking strategy");
assertIncludes(transcription, "inferTranscriptLanguage", "transcription has an English-Spanish language fallback");
assertIncludes(transcription, "resolveTranscriptLanguage", "transcription resolves missing provider language");

const transcriptionAction = read("convex/transcription.ts");
assertIncludes(
  transcriptionAction,
  "resolveTranscriptLanguage(transcription.language, transcription.text)",
  "post-call transcription persists a resolved language"
);
assertIncludes(transcriptionAction, "extractWavChannel", "operator language detection isolates one WAV channel");
assertIncludes(transcriptionAction, 'operatorChannel = args.context.callDirection === "inbound" ? 1 : 0', "operator channel maps outbound parent and inbound child legs");
assertIncludes(transcriptionAction, 'models: ["gpt-transcribe"]', "operator audio language detection uses gpt-transcribe, not legacy whisper-1");
// Dual-channel transcription: speaker attribution comes from the telephony
// channel, so the direction mapping and the operator/other-party argument order
// are the two things that must not drift. Swapping either would attribute every
// commitment to the wrong party while still producing a plausible transcript.
assertIncludes(transcriptionAction, "transcribeDualChannel", "post-call transcription prefers per-channel attribution");
assertIncludes(
  transcriptionAction,
  'operatorLanguageContext.callDirection === "inbound" ? 1 : 0',
  "dual-channel operator mapping matches the outbound-parent/inbound-child leg convention"
);
assertIncludes(
  transcriptionAction,
  "operatorAudio: extractWavChannel(audioBuffer, operatorChannel)",
  "operator channel is passed as operatorAudio, not swapped with the other party"
);
assertIncludes(
  transcriptionAction,
  "otherPartyAudio: extractWavChannel(audioBuffer, operatorChannel === 0 ? 1 : 0)",
  "other-party audio is the complement of the operator channel"
);
assertIncludes(transcriptionAction, "!operatorLanguageContext.inboundVoicemail", "voicemail skips per-channel attribution");
const dualChannelTranscription = read("src/lib/server/openai-transcription.ts");
assertIncludes(dualChannelTranscription, "Promise.allSettled", "dual-channel transcription cannot leave an unhandled channel rejection");
assertIncludes(dualChannelTranscription, 'models: ["gpt-4o-transcribe-diarize"]', "per-channel passes use the only model returning timestamps");
const aiExtraction = read("convex/aiExtraction.ts");
assertIncludes(
  aiExtraction,
  "resolveTranscriptLanguage(args.language, args.transcriptText)",
  "extraction repairs unknown transcript language on retries and imports"
);

const envExample = read(".env.example");
for (const expected of [
  "AUTH_GOOGLE_ID=",
  "AUTH_GOOGLE_SECRET=",
  "JWT_PRIVATE_KEY=",
  "JWKS=",
  "SITE_URL=http://localhost:3000",
  "CUSTOM_AUTH_SITE_URL=",
]) {
  assertIncludes(envExample, expected, `env example Convex Auth ${expected}`);
}

const convexProvider = read("src/components/providers/convex-provider.tsx");
assertIncludes(
  convexProvider,
  "ConvexAuthNextjsProvider",
  "Convex provider uses Next.js auth integration"
);

const authProxyRoute = read("src/app/api/auth/[...path]/route.ts");
assertIncludes(
  authProxyRoute,
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "app-domain Convex Auth route proxies to Convex site"
);
assertIncludes(
  authProxyRoute,
  'redirect: "manual"',
  "app-domain Convex Auth route preserves OAuth redirects"
);

const authMiddleware = read("src/proxy.ts");
assertIncludes(
  authMiddleware,
  '!request.nextUrl.pathname.startsWith("/api/auth/")',
  "middleware leaves app-domain auth proxy codes alone"
);
assertIncludes(envExample, "OPENAI_CALL_MEMORY_ASK_MODEL=gpt-4o-mini", "env example Ask records model default");
assertIncludes(envExample, "OPENAI_EMBEDDING_MODEL=text-embedding-3-small", "env example call memory embedding model default");
assertIncludes(envExample, "OPENAI_EMBEDDING_DIMENSIONS=1536", "env example call memory embedding dimensions");
assertIncludes(
  envExample,
  "OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize",
  "env example transcription default"
);
assertIncludes(envExample, "REALTIME_WORKER_PORT=8787", "env example realtime worker port");
assertIncludes(
  envExample,
  "OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-live-transcribe",
  "env example realtime transcription model"
);
assertIncludes(
  envExample,
  "OPENAI_REALTIME_TRANSLATION_MODEL=gpt-realtime-translate",
  "env example realtime translation model"
);
assertIncludes(
  envExample,
  "OPENAI_LIVE_GUIDANCE_MODEL=gpt-realtime-2.1",
  "env example live guidance text model"
);
assertIncludes(
  envExample,
  "REALTIME_TRANSLATION_DRAIN_MS=5000",
  "env example realtime translation drain window"
);
assertIncludes(
  envExample,
  "REALTIME_TRANSLATION_CAPTION_INTERVAL_MS=200",
  "env example realtime translation caption flush interval"
);
assertIncludes(envExample, "NEXT_PUBLIC_POSTHOG_KEY=", "env example PostHog key placeholder");
assertIncludes(
  envExample,
  "NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com",
  "env example PostHog EU host"
);
for (const country of ["GB", "MX", "SG", "ZA", "US/CA"]) {
  assertIncludes(envExample, country, `env example Twilio country ${country}`);
}
assertIncludes(
  envExample,
  "NEXT_PUBLIC_TWILIO_CALLING_ENABLED, TWILIO_CALLER_ID,",
  "env example documents Convex-side Twilio enable flag"
);
assertIncludes(
  envExample,
  "must also be set in Convex env because Convex",
  "env example documents Twilio Convex env requirement"
);

const dialerMock = read("src/components/dialer/dialer-mock.tsx");
assertIncludes(dialerMock, "Call record language", "Prep exposes call record language");
assertIncludes(dialerMock, "Auto uses your speech", "Prep explains operator-language authority");
assertIncludes(dialerMock, "translationTargetManuallyChanged", "explicit record language never overwrites a manually chosen translation target");
assertIncludes(dialerMock, "Your translated voice", "bridge setup exposes the caller voice control");
assertIncludes(dialerMock, "Their translated voice", "bridge setup exposes the called-person voice control");
assertIncludes(dialerMock, "DEFAULT_TRANSLATED_VOICE_GENDER", "bridge voice controls use the backward-compatible default");
assertIncludes(
  dialerMock,
  "!twilioSetup.enabled || !twilioSetup.configured || !twilioSetup.hasDestinationAllowlist",
  "dialer blocks calls when backend calling flag is disabled"
);

const posthogClient = read("src/lib/posthog-client.ts");
for (const expected of [
  "https://eu.i.posthog.com",
  "https://eu.posthog.com",
  'capture_pageview: "history_change"',
  "autocapture: false",
  "disable_session_recording: true",
  "capture_exceptions: false",
  "capture_heatmaps: false",
  "capture_dead_clicks: false",
]) {
  assertIncludes(posthogClient, expected, `PostHog client ${expected}`);
}
assertNotIncludes(posthogClient, "posthog-node", "PostHog v1 avoids server-side analytics");

const posthogInstrumentation = read("src/instrumentation-client.ts");
assertIncludes(posthogInstrumentation, "loadPostHog()", "instrumentation client loads PostHog lazily");

const analyticsHelper = read("src/lib/analytics.ts");
for (const expected of [
  "signup_completed",
  "checkout_started",
  "call_started",
  "call_completed",
  "free_call_trial_started",
  "call_memory_opened",
  "call_memory_reviewed",
  "feedback_request_created",
  "feedback_workspace_vote_toggled",
  "seat_limit_reached",
  "seatLimit",
  "companyType",
  "isFreeCall",
  "maxSeconds",
  "roleSegment",
  "useCase",
  "SAFE_PROPERTY_KEYS",
]) {
  assertIncludes(analyticsHelper, expected, `analytics helper ${expected}`);
}
for (const forbidden of [
  "email",
  "displayName",
  "workspaceName",
  "phoneNumber",
  "transcript",
  "summary",
  "notes",
  "billingId",
  "stripe",
  "providerCallSid",
]) {
  assertNotIncludes(analyticsHelper, forbidden, `analytics helper avoids ${forbidden}`);
}

const posthogIdentityBridge = read("src/components/providers/posthog-identity-bridge.tsx");
assertIncludes(posthogIdentityBridge, "posthog.identify(profile._id", "PostHog identifies with internal profile id");
assertIncludes(posthogIdentityBridge, "workspaceId: workspace._id", "PostHog identity includes internal workspace id");
assertIncludes(posthogIdentityBridge, "planId", "PostHog identity includes plan id");
assertIncludes(posthogIdentityBridge, "subscriptionStatus", "PostHog identity includes subscription status");
assertNotIncludes(posthogIdentityBridge, "email", "PostHog identity avoids email");
assertNotIncludes(posthogIdentityBridge, "displayName", "PostHog identity avoids display name");
assertNotIncludes(posthogIdentityBridge, "workspace.name", "PostHog identity avoids workspace name");

const sessionRoute = read("src/app/api/session/route.ts").toLowerCase();
for (const forbidden of ["email", "displayname", "phone", "stripe"]) {
  assertNotIncludes(sessionRoute, forbidden, `session route avoids ${forbidden}`);
}
const sessionRouteSource = read("src/app/api/session/route.ts");
assertIncludes(sessionRouteSource, "profileId: profile._id", "session route identifies with internal profile id");
assertIncludes(sessionRouteSource, "workspaceId: workspace._id", "session route includes internal workspace id");

const sessionIdentityBridge = read("src/components/providers/session-identity-bridge.tsx");
assertNotIncludes(sessionIdentityBridge, "posthog.reset", "public identity bridge never resets anonymous sessions");
assertIncludes(sessionIdentityBridge, "posthog.identify(session.identity.profileId", "public identity bridge identifies with internal profile id");

const twilioShared = read("convex/twilioShared.ts");
const callingRates = read("src/lib/calling-rates.ts");
assertIncludes(twilioShared, "FREE_CALL_MAX_SECONDS = 90", "free call hard cap constant");
assertIncludes(twilioShared, "getFreeCallMaxSeconds", "free call uses actual global Twilio cap");
assertIncludes(twilioShared, "TWILIO_FREE_CALL_ALLOWED_COUNTRIES", "free call supports stricter country allowlist");
assertIncludes(twilioShared, "TWILIO_FREE_CALL_ALLOWED_NUMBERS", "free call supports stricter number allowlist");
assertIncludes(twilioShared, "freeCallDestinationAllowed", "free call has route control helper");
for (const expected of [
  '["+1787", "PR"]',
  '["+1809", "DO"]',
  '["+52", "MX"]',
  '["+65", "SG"]',
  '["+27", "ZA"]',
  '["+1", "US/CA"]',
]) {
  assertIncludes(callingRates, expected, `Twilio destination prefix ${expected}`);
}
assertIncludes(
  twilioShared,
  "This destination is not enabled for Voxandra calling.",
  "Twilio customer-facing destination block reason"
);

const importedTranscripts = read("convex/importedTranscripts.ts");
assertIncludes(importedTranscripts, 'reviewStatus: "review_pending"', "pending AI note status");
assertIncludes(importedTranscripts, 'status: "pending"', "pending review suggestion status");
assertIncludes(importedTranscripts, 'processingStatus: "memory_ready"', "pending review call processing status");
assertIncludes(importedTranscripts, "reviewPending: true", "imported memory requires review");
assertIncludes(importedTranscripts, "scheduleFreeCallMemoryReadyEmail", "free AI Phone Copilot email waits for extraction");
assertNotIncludes(importedTranscripts, 'processingStatus: "review_pending"', "no imported review-pending completion");

// Includes convex/emailTemplates.ts: the bodies and subjects moved there so they
// could be rendered outside a deployment (scripts/test-email-templates.mjs).
const activeEmails =
  read("convex/emails.ts") + read("convex/emailSender.ts") + read("convex/emailTemplates.ts");
for (const expected of [
  "WIN_BACK_DELAY_MS = 7 * 24 * 60 * 60 * 1000",
  "scheduleWinBackIfUnconverted",
  "workspaceHasConverted",
  "grant_top_up",
  "ACTIVE_SUBSCRIPTION_STATUSES",
  "scheduleFreeCallMemoryReadyEmail",
  "shouldSendEmailJob",
  "winback_free_call_unused",
  "winback_free_call_used",
  "Your 90-second Voxandra trial is ready",
  'DEFAULT_EMAIL_FROM = "Voxandra <hello@mail.voxandra.com>"',
  'DEFAULT_EMAIL_REPLY_TO = "contact@voxandra.com"',
  "emailSenderConfig",
  "replyTo: input.replyTo || sender.replyTo",
]) {
  assertIncludes(activeEmails, expected, `free trial email lifecycle ${expected}`);
}
for (const forbidden of [
  "2-minute",
  "Voxandra Pro",
  "20% OFF",
  "VOXANDRA20",
  "Immigration",
  "USCIS",
  "day14_discount",
  "post_call",
  "Voxandra <hello@voxandra.com>",
  "\u{1F381}",
  "\u{2728}",
  "\u{23F0}",
  "\u{1F4CB}",
  "\u{1F64F}",
]) {
  assertNotIncludes(activeEmails, forbidden, `active email copy avoids ${forbidden}`);
}

const profiles = read("convex/profiles.ts");
assertIncludes(profiles, "paidCheckoutPending", "paid-first workspace creation can suppress free-trial email");
assertIncludes(profiles, "if (!args.paidCheckoutPending)", "paid-first signup skips free-workspace nurture");
assertIncludes(
  profiles,
  "resolveCurrentProfileIdentity",
  "profile setup keys workspace creation by stable auth user id"
);
assertIncludes(
  profiles,
  "findProfileForStableUserId",
  "profile setup can find legacy session-scoped profile rows"
);

const authHook = read("src/lib/auth.ts");
assertIncludes(authHook, "claimCheckout", "auth setup detects public checkout claim signup");
assertIncludes(authHook, "paidCheckoutPending", "auth setup passes paid checkout hint to workspace creation");

const sidebar = read("src/components/layout/sidebar.tsx");
assertIncludes(sidebar, 'label: "Call Records"', "call records navigation");
assertIncludes(sidebar, 'label: "Contacts"', "contacts navigation");
assertIncludes(sidebar, 'label: "Feedback"', "feedback navigation");
assertNotIncludes(sidebar, 'label: "Notes"', "notes removed from primary navigation");
assertNotIncludes(sidebar, 'label: "Transcripts"', "transcripts removed from primary navigation");
assertNotIncludes(sidebar, 'label: "Matters"', "matters removed from sidebar");
assertNotIncludes(sidebar, 'label: "Import"', "import removed from sidebar");
assertIncludes(sidebar, 'label: "Threads"', "threads navigation");

const topBar = read("src/components/layout/top-bar.tsx");
assertIncludes(topBar, 'label: "Call Records"', "call records mobile navigation");
assertIncludes(topBar, 'label: "Feedback"', "feedback mobile navigation");
assertNotIncludes(topBar, 'label: "Transcripts"', "transcripts removed from mobile nav");
assertIncludes(topBar, 'label: "Threads"', "threads mobile navigation");

const feedbackPage = read("src/app/app/feedback/page.tsx");
assertIncludes(feedbackPage, "api.feedback.listRequests", "feedback page list query");
assertIncludes(feedbackPage, "api.feedback.createRequest", "feedback page create mutation");
assertIncludes(feedbackPage, "api.feedback.toggleWorkspaceVote", "feedback page vote mutation");
assertIncludes(feedbackPage, "anonymous customer", "feedback cards keep customer identity anonymous");
assertIncludes(feedbackPage, "Upgrade to a paid plan", "feedback read-only upgrade copy");
assertIncludes(feedbackPage, "feedbackCategoryLabel", "feedback page maps stored category values to customer-facing labels");
assertIncludes(feedbackPage, "feedbackCustomerMessage", "feedback page normalizes server-provided copy");
assertNotIncludes(feedbackPage, "downvote", "feedback v1 has no downvotes");
assertNotIncludes(feedbackPage, "comment", "feedback v1 has no comments");

const reminderFunctions = read("convex/reminders.ts");
assertIncludes(reminderFunctions, "deleteCompletedReminder", "reminders can delete a completed task");
assertIncludes(reminderFunctions, "deleteCompletedReminders", "reminders can clear completed tasks");
assertIncludes(
  reminderFunctions,
  'reminder.status !== "completed"',
  "single reminder delete is limited to completed reminders"
);
assertIncludes(
  reminderFunctions,
  "refreshCallMemorySearchDocsForCall",
  "reminder deletion refreshes call memory search docs"
);

const reminderKanban = read("src/components/reminders/reminder-kanban.tsx");
assertIncludes(reminderKanban, "Clear completed", "reminder kanban exposes completed cleanup");
assertIncludes(reminderKanban, "Confirm clear", "reminder kanban confirms bulk completed cleanup");
assertIncludes(reminderKanban, "Delete", "reminder kanban exposes per-card completed delete");
assertIncludes(reminderKanban, "xl:max-h-[calc(100vh-18rem)]", "reminder kanban columns are scrollable for larger workflows");

const threads = read("convex/threads.ts");
for (const fnName of [
  "listActiveThreads",
  "getThreadContextForCall",
  "getThreadSuggestionForCall",
  "linkCallToThread",
  "createThreadFromSuggestion",
]) {
  assertIncludes(threads, `export const ${fnName}`, `threads facade ${fnName}`);
}
for (const linkedField of [
  "aiMemories",
  "extractedEntities",
  "actionItems",
  "reminders",
]) {
  assertIncludes(threads, linkedField, `thread relink updates ${linkedField}`);
}
assertIncludes(threads, "syncThreadRollup", "thread relink rollup sync");
assertIncludes(threads, "removeThreadFromContactIfUnused", "thread relink old contact cleanup");
assertIncludes(threads, "resolveSuggestedContact", "thread suggestion contact linking");
assertIncludes(threads, "service_plan", "thread practical key entities");

const callDetail = read("src/components/calls/call-detail-client.tsx");
assertIncludes(callDetail, "ThreadContextCard", "note detail thread context card");
assertIncludes(callDetail, "Related thread", "linked thread copy");
assertIncludes(callDetail, "Suggested thread", "suggested thread copy");
assertIncludes(callDetail, "ReviewWorkspace", "call detail pending review workspace");
assertIncludes(callDetail, "Thread context", "call detail thread context");
assertIncludes(callDetail, "Extracted details", "call detail extracted details label");
assertIncludes(callDetail, "Call delivery details", "call detail customer delivery label");
assertIncludes(callDetail, "Draft ready for review", "call detail review primary prompt");
assertIncludes(callDetail, "Nothing is shared with the team until you accept", "call detail review explains accept gate");
assertNotIncludes(callDetail, 'href="#review"', "call detail no longer deep-links to a separate review block");
assertIncludes(callDetail, "detected from your audio", "call detail explains operator language source");
assertIncludes(callDetail, "regeneratePendingCallRecordLanguage", "pending call records can be regenerated in another language");
assertNotIncludes(callDetail, "Thread intelligence", "call detail avoids internal thread intelligence label");
assertNotIncludes(callDetail, "Technical details", "call detail avoids internal technical details label");
assertNotIncludes(callDetail, "Twilio real call", "call detail avoids customer-facing Twilio call label");

const memoryPage = read("src/app/app/memory/page.tsx");
assertIncludes(memoryPage, "listThreadPillsForNotes", "memory thread pills");
assertIncludes(memoryPage, "/app/calls/${row.callId}#note", "memory note deep link");
assertIncludes(memoryPage, "/app/calls/${row.callId}#transcript", "memory transcript deep link");
assertIncludes(memoryPage, "api.callMemorySearch.searchCallRecords", "memory page uses indexed Call Records search");
assertIncludes(memoryPage, "api.callMemorySearchActions.askCallRecords", "memory page exposes Ask records action");
assertIncludes(memoryPage, "Ask AI", "memory page labels natural-language Call Records query");
assertNotIncludes(memoryPage, "captureProductEvent", "memory page does not send search or Ask content to product analytics");

const notesPage = read("src/app/app/notes/page.tsx");
assertIncludes(notesPage, 'redirect("/app/memory")', "legacy notes redirect");

const transcriptsPage = read("src/app/app/transcripts/page.tsx");
assertIncludes(transcriptsPage, 'redirect("/app/memory?view=transcript")', "legacy transcripts redirect");

const nextConfig = read("next.config.ts");
assertNotIncludes(nextConfig, 'source: "/app/dialer"', "full app dialer route is reachable");

const middleware = read("src/proxy.ts");
assertNotIncludes(middleware, "/api/auth-debug", "middleware does not expose auth debug route");
assertNotIncludes(middleware, "console.log", "middleware avoids request/auth debug logging");

const twilioServer = read("src/lib/twilio/server.ts");
assertIncludes(twilioServer, "TWILIO_DEBUG_LOGS", "Twilio debug logs require explicit env flag");
assertIncludes(twilioServer, "logTwilioDebug", "Twilio debug logging helper");

const twilioVoiceRoute = read("src/app/api/twilio/voice/route.ts");
assertIncludes(twilioVoiceRoute, "logTwilioDebug", "Twilio voice route uses gated debug logs");
assertNotIncludes(twilioVoiceRoute, "Generated TwiML", "Twilio voice route does not log generated TwiML");
assertNotIncludes(
  twilioVoiceRoute,
  "callerIdNumber: result.callerIdNumber",
  "Twilio voice route does not log caller phone numbers"
);

const twilioRecordingRoute = read("src/app/api/twilio/recording/route.ts");
assertIncludes(twilioRecordingRoute, "logTwilioDebug", "Twilio recording route uses gated debug logs");
assertNotIncludes(
  twilioRecordingRoute,
  "Object.fromEntries(request.headers.entries())",
  "Twilio recording route does not log callback headers"
);
assertNotIncludes(
  twilioRecordingRoute,
  "...params",
  "Twilio recording route does not log raw callback payloads"
);

const twilioStatusRoute = read("src/app/api/twilio/status/route.ts");
assertIncludes(twilioStatusRoute, "logTwilioDebug", "Twilio status route uses gated debug logs");
assertNotIncludes(
  twilioStatusRoute,
  'console.log("[Status Webhook]',
  "Twilio status route does not log callbacks by default"
);

const twilioInboundRoute = read("src/app/api/twilio/inbound/route.ts");
assertIncludes(twilioInboundRoute, "validateTwilioRequest", "inbound route validates Twilio signature");
assertIncludes(twilioInboundRoute, "prepareInboundCall", "inbound route resolves and quotes call server-side");
assertIncludes(twilioInboundRoute, "response.dial", "inbound route dials configured human forwarding number");
assertIncludes(twilioInboundRoute, "record-from-answer-dual", "inbound route records directional dual-channel audio");
assertIncludes(twilioInboundRoute, "result.aiCaptureEnabled", "inbound recording is gated by AI capture");
assertIncludes(twilioInboundRoute, "unavailableTwiML", "disabled inbound returns polite unavailable TwiML");

const twilioInboundAfterDialRoute = read("src/app/api/twilio/inbound/after-dial/route.ts");
assertIncludes(twilioInboundAfterDialRoute, "validateTwilioRequest", "inbound after-dial validates Twilio signature");
assertIncludes(twilioInboundAfterDialRoute, "recordInboundDialOutcome", "inbound after-dial records forwarded-leg outcome");
assertIncludes(twilioInboundAfterDialRoute, "response.record", "inbound after-dial routes missed calls to voicemail");
assertIncludes(twilioInboundAfterDialRoute, "voxandraCallId", "inbound after-dial pins callbacks to call id");

const twilioProviderInbound = read("convex/twilioProvider.ts");
for (const expected of [
  "TWILIO_INBOUND_CALLING_ENABLED",
  "quoteInboundForwardingCall",
  "prepareInboundCall",
  "recordInboundDialOutcome",
  "Inbound calls are not enabled for this number yet.",
  "Reserved credits for inbound forwarded call",
  "Released credits for inbound call that was not answered",
  "call.aiCaptureEnabled !== false",
]) {
  assertIncludes(twilioProviderInbound, expected, `inbound provider flow ${expected}`);
}

const inboundCallingNumbers = read("convex/callingNumbers.ts");
for (const expected of [
  "updateInboundSettings",
  "requireWorkspaceAdmin",
  'number.source !== "rented"',
  "Inbound calls are only available on rented Voxandra numbers.",
  "Confirm recording and transcription compliance before enabling AI capture.",
  "inboundRecordingComplianceAttestedByProfileId",
]) {
  assertIncludes(inboundCallingNumbers, expected, `inbound number settings ${expected}`);
}

const inboundCallPricing = read("src/lib/call-pricing.ts");
assertIncludes(inboundCallPricing, "quoteInboundForwardingCall", "inbound forwarding quote helper");
assertIncludes(inboundCallPricing, "TWILIO_INBOUND_LEG_COST_CENTS_PER_MINUTE", "inbound quote includes inbound leg");
assertIncludes(inboundCallPricing, "MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE", "inbound quote reuses launch cap");

const dashboardContent = read("src/app/app/dashboard-content.tsx");
for (const expected of [
  "ReceiveCallsPanel",
  "api.callingNumbers.getCallingNumbers",
  "api.team.getMyWorkspaceRole",
  "Receive calls requires a rented Voxandra number.",
  "Calls to that number ring your forwarding phone and can become Call Records.",
  "/app/wallet#receive-calls",
  "Forwarding on",
  "Forwarding not set",
]) {
  assertIncludes(dashboardContent, expected, `dashboard receive calls setup ${expected}`);
}

const inboundWalletPage = read("src/app/app/wallet/page.tsx");
for (const expected of [
  'id="receive-calls"',
  "#receive-calls",
  "window.location.hash.slice(1)",
  "Receive calls",
  "Receive calls requires a rented Voxandra number.",
  "Calls to that number",
  "ring your forwarding phone",
  "The Voxandra default number and verified external numbers are outbound caller ID only.",
  "Verified external numbers and the Voxandra default number stay outbound-only.",
  'number.source === "rented" && number.id && number.status === "active"',
  "updateInboundSettings",
  "recording/transcription compliance attestation",
  "AI capture",
  "Human forwarding number",
  "Voicemail",
  "Save receive setup",
]) {
  assertIncludes(inboundWalletPage, expected, `wallet inbound UI ${expected}`);
}

const twilioProviderCleanup = read("convex/twilioProvider.ts");
assertIncludes(twilioProviderCleanup, "recordingDeleteStatus", "Twilio callback records audio deletion status");
assertNotMatches(
  twilioProviderCleanup,
  /ctx\.db\.patch\(args\.callId,\s*\{\s*recordingUrl:\s*args\.recordingUrl/s,
  "Twilio callback does not persist provider recording URLs"
);

const transcriptionCleanupAction = read("convex/transcription.ts");
assertIncludes(transcriptionCleanupAction, "RECORDING_DELETE_MAX_ATTEMPTS = 3", "Twilio recording deletion retry cap");
assertIncludes(transcriptionCleanupAction, "deleteTwilioRecording", "Twilio recording deletion action");
assertIncludes(transcriptionCleanupAction, "markRecordingDeleteFailed", "Twilio recording deletion failure tracking");

const transcriptionCleanupMutations = read("convex/transcriptionMutations.ts");
assertIncludes(transcriptionCleanupMutations, "markRecordingDeleted", "Twilio recording deleted mutation");
assertIncludes(transcriptionCleanupMutations, "recordingUrl: undefined", "Twilio recording cleanup clears legacy URL field");

const schemaCleanup = read("convex/schema.ts");
assertIncludes(schemaCleanup, "recordingDeleteStatus", "schema tracks recording deletion status");
assertIncludes(schemaCleanup, 'aiMemories: defineTable', "schema keeps AI memories table");
assertIncludes(schemaCleanup, '.index("by_workspace", ["workspaceId"])', "schema has workspace indexes");
assertIncludes(schemaCleanup, '.index("by_received_at", ["receivedAt"])', "schema has provider event retention index");
assertIncludes(schemaCleanup, '.index("by_status_expires", ["status", "expiresAt"])', "schema has status expiry retention index");

const maintenance = read("convex/maintenance.ts");
assertIncludes(maintenance, "getStorageFootprintReport", "maintenance exposes aggregate storage report");
assertIncludes(maintenance, "cleanupOperationalRecords", "maintenance has operational retention cleanup");
assertIncludes(maintenance, "callsWithRecordingUrl", "storage report tracks legacy recording URL count");
assertIncludes(maintenance, "audioStoredTrue", "storage report tracks raw audio storage count");
assertIncludes(maintenance, "OPERATIONAL_RETENTION_MS", "maintenance has bounded operational retention");
assertIncludes(maintenance, "getFreeCallReport", "maintenance builds aggregate free-call report");
assertIncludes(maintenance, "freeCalls", "storage report exposes aggregate free-call metrics");
assertIncludes(maintenance, "estimatedRetailValueCents", "free-call report estimates retail value");
assertIncludes(maintenance, "twilioSessionsPendingExpired", "maintenance removes expired pending Twilio sessions");
assertIncludes(maintenance, "deleteFeedbackRequest", "maintenance can remove a feedback request");
assertIncludes(maintenance, "confirmationTitle", "feedback maintenance delete requires title confirmation");
assertIncludes(maintenance, "storedVoteCount", "feedback maintenance delete reports stored vote count");
assertNotIncludes(maintenance, "recordingUrl: call.recordingUrl", "maintenance does not return raw recording URLs");
assertNotIncludes(maintenance, "dialedNumber", "free-call report does not expose phone numbers");
assertNotIncludes(maintenance, "providerCallSid", "free-call report does not expose provider call ids");

const maintenanceActions = read("convex/maintenanceActions.ts");
assertIncludes(maintenanceActions, "cleanupLegacyRecordingUrls", "maintenance has legacy recording URL cleanup action");
assertIncludes(maintenanceActions, "deleteRecordingFromTwilio", "legacy cleanup attempts provider recording deletion");
assertIncludes(maintenanceActions, "clearLegacyRecordingUrl", "legacy cleanup clears Convex recording URL pointers");
assertNotIncludes(maintenanceActions, "recordingUrl:", "legacy cleanup does not return raw recording URLs");

const crons = read("convex/crons.ts");
assertIncludes(crons, "cleanup operational records", "maintenance cleanup is scheduled");

for (const removedPath of [
  "src/app/api/auth-debug/route.ts",
  "src/app/api/twilio/debug/route.ts",
  "src/app/api/internal/transcribe/route.ts",
  "src/app/app/internal/audio-import/page.tsx",
]) {
  assertPathMissing(removedPath, `launch hardening removed ${removedPath}`);
}

const dashboardPage = read("src/app/app/dashboard-content.tsx");
assertIncludes(dashboardPage, "HandoffCard", "dashboard post-call handoff card");
assertIncludes(dashboardPage, "Next up", "dashboard next-up queue");
assertIncludes(dashboardPage, "Recent activity", "dashboard recent activity card");
assertNotIncludes(dashboardPage, "dashboardLabel", "dashboard uses server-provided customer labels directly");
assertIncludes(dashboardPage, "View all records", "dashboard uses Call Records wording");
assertNotIncludes(dashboardPage, "/app/transcripts", "dashboard no transcript route link");
assertNotIncludes(dashboardPage, "Recent notes", "dashboard no recent notes card");
assertNotIncludes(dashboardPage, "Recent transcripts", "dashboard no recent transcripts card");

const dashboardQuery = read("convex/dashboard.ts");
assertIncludes(dashboardQuery, 'detailHref(callId, "contact")', "dashboard contact deep link");
assertIncludes(dashboardQuery, 'detailHref(callId, "review")', "dashboard review deep link");

const contactsPage = read("src/app/app/contacts/page.tsx");
assertIncludes(contactsPage, "listThreadPillsForContacts", "contacts thread pills");
assertIncludes(contactsPage, "contactId", "contacts call deep-link preserves contact id");

const phone = read("src/lib/phone.ts");
assertIncludes(phone, "normalizePhoneE164", "shared phone normalization");
assertIncludes(phone, "phoneNumbersMatch", "shared phone matching");

const countries = read("src/lib/countries.ts");
for (const expected of [
  "United States/Canada +1",
  "Portugal +351",
  "Mexico +52",
  "Singapore +65",
  "Puerto Rico +1787",
  "South Africa +27",
]) {
  assertIncludes(countries, expected, `dialer country option ${expected}`);
}
for (const disabled of ["China +86", "Nigeria +234", "Kenya +254"]) {
  assertNotIncludes(countries, disabled, `disabled dialer country option ${disabled}`);
}

const schema = read("convex/schema.ts");
assertIncludes(schema, "phoneE164", "contacts normalized phone field");
assertIncludes(schema, "by_phone_e164", "contacts normalized phone index");
assertIncludes(schema, "feedbackRequests", "feedback requests table");
assertIncludes(schema, "feedbackVotes", "feedback votes table");
assertIncludes(schema, "createdByWorkspaceId", "feedback request creator workspace field");
assertIncludes(schema, "by_request_workspace", "feedback vote workspace uniqueness lookup");
assertIncludes(schema, "remainingCents", "top-up credit ledger remaining balance");
assertIncludes(schema, "freeCallClaimedAt", "schema tracks when a free call is claimed");
assertIncludes(schema, "freeCallMaxSeconds", "schema tracks actual free-call cap");
assertIncludes(schema, "freeCallUsedCallId", "wallet records which call consumed the free trial");
assertIncludes(schema, "creditReservationAllocations", "top-up reservation lot allocations");
assertIncludes(schema, "workspaceInvitations", "workspace invite table");
assertIncludes(schema, "tokenHash", "workspace invite token hash");
assertIncludes(schema, "by_workspace_email", "workspace invite email index");
assertIncludes(schema, "createdByProfileId", "call attribution profile field");

const authHelpers = read("convex/authHelpers.ts");
assertIncludes(authHelpers, "stableUserIdFromSubject", "auth helpers normalize session-scoped subjects");
assertIncludes(authHelpers, "findProfileForStableUserId", "auth helpers resolve stable user profiles");
assertIncludes(authHelpers, "resolveCurrentProfileIdentity", "auth helpers resolve profile identity");
assertIncludes(authHelpers, 'ctx.db.get(userId as Id<"users">)', "auth helpers read Convex Auth user");
assertIncludes(authHelpers, "normalizeAuthDisplayName", "auth helpers avoid email-as-display-name");
assertIncludes(
  authHelpers,
  'userId.startsWith(`${stableUserId}|`)',
  "auth helpers support legacy session-scoped user ids"
);
for (const expected of [
  "requireWorkspaceMembership",
  "requireWorkspaceAdmin",
  "requireWorkspaceOwner",
]) {
  assertIncludes(authHelpers, expected, `workspace role helper ${expected}`);
}

const profileFunctions = read("convex/profiles.ts");
assertIncludes(profileFunctions, "syncMyProfileIdentity", "profiles can sync missing auth identity");
assertIncludes(profileFunctions, "updateMyProfileDisplayName", "profiles support display-name editing");
assertIncludes(profileFunctions, "identityProfilePatch", "profiles preserve synced identity patching");
assertIncludes(profileFunctions, "Use a name, not an email address.", "display name rejects email input");

const accountTopBar = read("src/components/layout/top-bar.tsx");
assertIncludes(accountTopBar, "getAccountDisplay", "top bar centralizes account display");
assertIncludes(
  accountTopBar,
  'emailLabel !== displayName ? emailLabel : ""',
  "account pill uses email local part, not full email"
);
assertIncludes(
  accountTopBar,
  'dropdownSecondary: email || workspaceName?.trim() || "Signed in"',
  "account dropdown shows full email"
);
assertIncludes(accountTopBar, "emailLocalPart", "account pill can fall back to email local part");

const team = read("convex/team.ts");
for (const expected of [
  "getTeamSummary",
  "createInvitation",
  "resendInvitation",
  "acceptInvitation",
  "removeMember",
  "updateMemberRole",
  "Only the owner can invite admins.",
  "seat plan limit",
]) {
  assertIncludes(team, expected, `team seats implementation ${expected}`);
}

const settingsPage = read("src/app/app/settings/page.tsx");
assertIncludes(settingsPage, "TeamMembersPanel", "settings team management panel");
assertIncludes(settingsPage, "DisplayNameEditor", "settings includes display-name editor");

const displayNameEditor = read("src/components/profile/display-name-editor.tsx");
assertIncludes(displayNameEditor, "updateMyProfileDisplayName", "display-name editor saves profile name");
assertIncludes(displayNameEditor, "Display name must be 80 characters or fewer.", "display-name editor enforces length");

const teamMembersPanel = read("src/components/team/team-members-panel.tsx");
assertIncludes(teamMembersPanel, "shared calls, Call Records, contacts", "team members copy uses Call Records");
assertNotIncludes(teamMembersPanel, "shared calls, memory", "team members copy avoids old memory label");

const joinInvitePage = read("src/app/join/[token]/page.tsx");
assertIncludes(joinInvitePage, "acceptInvitation", "invite acceptance route");
assertIncludes(joinInvitePage, "/login?redirect=", "signed-out invite redirects through login");

const billingServer = read("src/lib/billing/server.ts");
assertIncludes(billingServer, "getOwnerBillingContext", "owner-only billing context");
// Buying credits is intentionally a wider gate than the rest of billing: admins may
// add money, only the owner may change what the workspace is committed to. If these
// two contexts ever collapse into one, that distinction is gone.
assertIncludes(billingServer, "getTopUpBillingContext", "owner-or-admin credit-buying context");
assertIncludes(
  billingServer,
  'role !== "owner" && role !== "admin"',
  "credit-buying context admits admins as well as the owner"
);
assertIncludes(billingServer, "StripePriceExpectation", "Stripe price expectation type");
assertIncludes(billingServer, "validateResolvedStripePrice", "Stripe checkout price validation");
assertIncludes(billingServer, "unitAmountCents", "Stripe price amount guard");
assertIncludes(billingServer, 'kind: "one_time" | "monthly_recurring"', "Stripe price shape guard");
assertIncludes(billingServer, "price.recurring?.interval !== \"month\"", "Stripe monthly interval guard");
assertIncludes(billingServer, "interval_count", "Stripe monthly interval count guard");

const subscriptionCheckoutRoute = read("src/app/api/stripe/checkout/subscription/route.ts");
assertIncludes(subscriptionCheckoutRoute, "plan.monthlyPriceCents", "subscription checkout guards configured plan amount");
assertIncludes(subscriptionCheckoutRoute, 'kind: "monthly_recurring"', "subscription checkout requires monthly recurring price");

const callingNumberCheckoutRoute = read("src/app/api/stripe/checkout/calling-number/route.ts");
assertIncludes(callingNumberCheckoutRoute, "CALLING_NUMBER_RENTAL_PRICE_CENTS", "number checkout guards configured rental amount");
assertIncludes(callingNumberCheckoutRoute, 'kind: "monthly_recurring"', "number checkout requires monthly recurring price");

const stripeSyncScript = read("scripts/stripe-sync-prices.mjs");
assertIncludes(stripeSyncScript, "transfer_lookup_key", "Stripe sync transfers lookup keys");
assertIncludes(stripeSyncScript, "default_price", "Stripe sync updates product default price");
assertIncludes(stripeSyncScript, "--apply", "Stripe sync has explicit apply mode");
assertIncludes(stripeSyncScript, "--dry-run", "Stripe sync has dry-run mode");
assertIncludes(stripeSyncScript, "--product-names-only", "Stripe sync can safely apply Product name-only changes");
assertIncludes(stripeSyncScript, "syncable: true", "Stripe sync only auto-applies subscription prices");
assertIncludes(stripeSyncScript, "expectedProductName", "Stripe sync reports subscription Product name mismatches");
assertIncludes(stripeSyncScript, "updateSubscriptionProductName", "Stripe sync updates subscription Product names separately from Prices");

const contacts = read("convex/contacts.ts");
assertIncludes(contacts, "createContactForCall", "call detail contact creation mutation");
assertIncludes(contacts, "linkCallToContact", "call detail contact linking mutation");
assertIncludes(contacts, "assertNoDuplicatePhone", "contact duplicate phone guard");

const landingDialer = read("src/components/landing/landing-dialer.tsx");
assertIncludes(landingDialer, "publicTranslatedTrialEnabled()", "hero dialer gates trial copy");
assertIncludes(landingDialer, "One free 90-second translated call", "hero dialer describes enabled trial");
assertIncludes(landingDialer, "choose a paid plan for translation", "hero dialer preserves paid translation when trial off");
assertIncludes(landingDialer, "getDialerRoutePricing", "hero uses shared route pricing");
assertIncludes(landingDialer, "formatRateRangeCentsPerMinute", "hero formats route range");
assertIncludes(landingDialer, "routePricing.routeLabel", "hero names route");
assertIncludes(landingDialer, "from Voxandra calling credits", "hero retains accurate calling rate label");
assertIncludes(landingDialer, "aria-label={routeRateLabel}", "hero accessible pricing");
assertIncludes(landingDialer, "aria-live=\"polite\"", "hero announces rate changes");
assertIncludes(landingDialer, "phoneNumber={normalizedNumber}", "hero passes entered number to sign-in");
assertIncludes(landingDialer, "SignupCallModal", "hero retains sign-in handoff");
assertIncludes(landingDialer, "Product example", "hero distinguishes example from live call");
assertIncludes(landingDialer, "Private Guidance \u00b7 paid plans", "hero distinguishes paid guidance from trial");
assertIncludes(landingDialer, "PO-8842", "hero keeps operational scenario");
assertIncludes(landingDialer, "tax certificate", "hero shows payment blocker");
assertIncludes(landingDialer, "Ready for review", "hero shows draft review");
assertIncludes(landingDialer, "They reply in German", "hero explains two-way spoken translation");
assertIncludes(landingDialer, "inputMode=\"tel\"", "hero retains mobile phone input");
assertNotIncludes(landingDialer, "Team+ Live Guidance", "hero mock avoids redundant Team+ live guidance label");
assertNotIncludes(landingDialer, "AI COPILOT", "hero mock drops the retired AI Copilot label");
assertNotIncludes(landingDialer, "Northstar Finance will release the invoice once AP uploads it today", "hero reviewed note removes longer release sentence");
assertNotIncludes(landingDialer, "setShowLetters", "hero mock removes extra dialer controls");
assertNotIncludes(landingDialer, "Residence permit", "hero call record avoids individual immigration example");
assertNotIncludes(landingDialer, "gpt-realtime", "hero mock hides raw realtime model names");
assertNotIncludes(landingDialer, "AI Call Memory", "hero mock avoids old AI Call Memory term");
assertNotIncludes(landingDialer, "AI CALL MEMORY", "hero mock avoids old AI CALL MEMORY label");
assertNotIncludes(landingDialer, "Voxandra AI turns a messy conversation", "hero mock removes old explanatory paragraph");
assertNotIncludes(landingDialer, "Translated caption:", "hero mock avoids old translated caption label");
assertNotIncludes(landingDialer, "Live Copilot", "hero mock avoids old Live Copilot term");
assertNotIncludes(landingDialer, "Raul", "hero call record avoids old finance representative name");
assertNotIncludes(landingDialer, "from Spanish", "hero mock uses German source language");

const howItWorks = read("src/components/landing/how-it-works-section.tsx");
assertIncludes(howItWorks, "Northstar Finance", "how it works uses B2B finance call");
assertIncludes(howItWorks, "Sofia -> Matthias @ Northstar Finance", "how it works separates caller representative and institution");
assertIncludes(howItWorks, 'const fullNumber = "3012345678"', "how it works animation uses German Berlin number");
assertIncludes(howItWorks, "DE +49", "how it works animation uses German country code");
assertIncludes(howItWorks, "supplier payment thread", "how it works uses B2B operational thread");
assertIncludes(howItWorks, "Talk naturally", "how it works promotes spoken translation");
assertIncludes(howItWorks, "private Guidance helps", "how it works keeps guidance alongside translation");
assertNotIncludes(howItWorks, "Text-only", "how it works avoids the text-only claim");
assertNotIncludes(howItWorks, "text-only", "how it works avoids the text-only claim");
assertIncludes(howItWorks, "Confirm the PO number before ending", "how it works live guidance example");
assertNotIncludes(howItWorks, "Aminah Clarke", "how it works avoids individual candidate example");
assertNotIncludes(howItWorks, "gpt-realtime", "how it works hides raw realtime model names");
assertNotIncludes(howItWorks, "Sofia -> Raul", "how it works avoids old participant name");
assertNotIncludes(howItWorks, "GB +44", "how it works avoids old UK calling animation label");

const pricing = read("src/lib/pricing.ts");
for (const expected of [
  "soloMemoryPlan",
  "stripeLookupKey",
  "includedCreditCents",
  'name: "Solo"',
  "formatMonthlyPlanPrice",
  'seats: "1 seat included"',
  'credits: formatIncludedCallingAllowance("solo")',
  "For one person who makes important calls abroad",
  "Contacts, reminders, and work threads",
  "Pre-call briefs and workflow templates",
  'seats: "5 seats included"',
  "liveFeatureCallouts",
  // Usage strings and the tier comparison are DERIVED from the entitlements as of
  // 2026-07-31. They used to be hand-written and every one said "$0.40/min", which
  // became false for all four plans the moment the Live Guidance overage was tiered;
  // "4x the Live Guidance minutes of Starter" became false when Team went 250 -> 180.
  'formatLiveFeatureUsage("solo", "live_copilot")',
  'formatLiveFeatureUsage("starter", "live_copilot")',
  'formatLiveFeatureUsage("team", "live_copilot")',
  'formatLiveFeatureUsage("operations", "live_copilot")',
  'formatLiveFeatureUsage("team", "translated_audio")',
  "formatLiveGuidanceMultipleVsStarter",
  "overageCentsPerMinuteForFeature",
  'price: "$149"',
  'seats: "8 seats included"',
  'title: "Live Guidance"',
  'description: "Private in-call guidance"',
  'title: "Live Voice Translation"',
  'description: "Two-way spoken translation for business calls"',
  "Highest reviewed Call Record usage",
  'badge: "Most popular"',
  "featured: true",
  'price: "$449"',
  'seats: "12 seats included"',
  "Custom Live Guidance and Live Translation caps",
  'seats: "13+ seats"',
  "Custom calling credits and usage limits",
  "Custom Live Guidance limits",
  'description: "Browser calling without AI Call Records or realtime AI features."',
  "Affordable international browser calls",
  "No AI call records or transcripts",
  "No Live Guidance or Live Translation",
  "publicCheckout",
  '{ type: "subscription", planId: "solo" }',
  '{ type: "subscription", planId: "starter" }',
  '{ type: "subscription", planId: "team" }',
  '{ type: "subscription", planId: "operations" }',
  '{ type: "top_up", topUpId: "topup_25" }',
]) {
  assertIncludes(pricing, expected, `pricing config ${expected}`);
}
assertNotIncludes(pricing, "checkoutPlan", "public pricing avoids auth-first checkout plan redirects");
assertNotIncludes(pricing, "%3FtopUp%3D", "public pricing avoids auth-first top-up redirects");
assertNotIncludes(pricing, "caption trial", "pricing avoids lower-plan caption trial copy");
assertNotIncludes(pricing, "realtimePricingProofPoints", "pricing removes redundant realtime proof chips");
assertNotIncludes(pricing, "Copilot guidance and captions", "pricing removes combined live feature callout title");
assertNotIncludes(pricing, "Live features included", "pricing removes combined Team live callout eyebrow");
assertNotIncludes(pricing, "Higher live allowance", "pricing removes combined Operations live callout eyebrow");

const pricingCard = read("src/components/landing/pricing-card.tsx");
assertIncludes(pricingCard, "callout.usage", "pricing card preserves included minutes and overage rates");
assertIncludes(pricingCard, "liveFeatureCallouts?.map", "pricing card renders both live feature allowances");
assertIncludes(pricingCard, "mt-auto", "pricing card aligns checkout controls");
assertIncludes(pricingCard, "PricingCheckoutButton", "pricing card uses Stripe-first checkout button");

const pricingCheckoutButton = read("src/components/landing/pricing-checkout-button.tsx");
assertIncludes(pricingCheckoutButton, "/api/stripe/public-checkout/subscription", "pricing button opens public subscription checkout");
assertIncludes(pricingCheckoutButton, "/api/stripe/public-checkout/top-up", "pricing button opens public top-up checkout");
assertIncludes(pricingCheckoutButton, "Opening checkout...", "pricing button shows checkout loading state");

const pricingSection = read("src/components/landing/pricing-section.tsx");
assertIncludes(pricingSection, "publicMemoryPlans", "pricing section uses shared public plan ladder");
assertIncludes(pricingSection, "xl:grid-cols-4", "pricing section shows four memory plans on wide desktop");
assertIncludes(pricingSection, "Every feature.", "pricing section leads with feature parity, not calling volume");
assertIncludes(pricingSection, "Need more minutes? Buy credits", "pricing section keeps the one-credit-balance answer");
assertIncludes(pricingSection, "free 90-second standard call", "pricing section labels the free call as a standard call");
assertIncludes(pricingSection, "Every paid plan includes Live Voice Translation", "pricing section keeps the on-every-plan banner");
assertNotIncludes(pricingSection, "AI Phone Copilot plans with affordable browser calling included", "pricing section avoids old calling-heavy heading");
assertNotIncludes(pricingSection, "Every plan includes reviewed call records for Voxandra calls", "pricing section avoids old call-record intro copy");
assertNotIncludes(pricingSection, "Included calling credits, rates before dialing, and top-ups anytime", "pricing section removes compact calling one-liner");
assertNotIncludes(pricingSection, "Affordable international browser calls, built in", "pricing section removes noisy calling banner title");
assertNotIncludes(pricingSection, "Try one free 90-second AI Phone Copilot call before choosing a plan", "pricing section removes redundant free-trial sentence");
assertNotIncludes(pricingSection, "callingProofPoints", "pricing section removes calling proof chip row");
assertNotIncludes(pricingSection, "Live Guidance trials on Solo and Starter. Captions on Team+.", "pricing section removes redundant realtime banner");
assertNotIncludes(pricingSection, "Live Guidance is private call guidance", "pricing section removes redundant live guidance positioning block");
assertNotIncludes(pricingSection, "realtimePricingProofPoints", "pricing section removes redundant realtime proof chips");
assertNotIncludes(pricingSection, "caption trial", "pricing section avoids lower-plan caption trial copy");
assertNotIncludes(pricingSection, "Working solo?", "pricing section removes separate Solo block");
assertIncludes(pricingSection, "enterprisePlan", "pricing section includes enterprise contact path");
assertIncludes(pricingSection, "purchased top-up credits never expire", "pricing top-up never-expires copy");
assertIncludes(pricingSection, "Calling rates appear before you dial", "pricing leads with the cut US/CA rate");
assertIncludes(pricingSection, "One balance covers", "pricing explains one shared credit balance");
assertIncludes(pricingSection, "Fair-use applies to live AI feature usage", "pricing fair-use copy");
assertNotIncludes(pricingSection, "Low-cost browser calls are built in", "pricing removes verbose low-cost banner");
assertNotIncludes(pricingSection, "Just need browser calls?", "pricing removes noisy calls-only heading");
assertNotIncludes(pricingSection, "cheap calls", "pricing avoids cheap-calling positioning");
assertNotIncludes(pricingSection, "AI Call Memory", "pricing section avoids old AI Call Memory term");

const pricingFaq =
  read("src/components/landing/pricing-faq.tsx") +
  read("src/components/landing/faq-data.ts");
assertIncludes(pricingFaq, "faqItems", "FAQ and JSON-LD share data");
assertIncludes(pricingFaq, "Frequently asked questions", "FAQ heading");
assertIncludes(pricingFaq, "What is Voxandra?", "canonical definition");
assertIncludes(pricingFaq, "Does the other person need an app?", "recipient setup");
assertIncludes(pricingFaq, "How does the free trial work?", "trial expectations");
assertIncludes(pricingFaq, "Live Guidance is not included", "trial excludes guidance");
assertIncludes(pricingFaq, "Setup and the spoken introduction count", "trial timing");
assertIncludes(pricingFaq, "busy or unanswered calls", "trial consumption");
assertIncludes(pricingFaq, "free 90-second standard call", "trial-off fallback");
assertIncludes(pricingFaq, "Both sides hear spoken translation", "voice output");
assertIncludes(pricingFaq, "getPublicVoiceTranslationLanguageNames", "FAQ uses enabled catalog");
assertIncludes(pricingFaq, "spoken notice", "disclosure");
assertIncludes(pricingFaq, "Can I correct", "human review");
assertIncludes(pricingFaq, "before accepting the Call Record", "review controls acceptance");
assertIncludes(pricingFaq, "deleted after processing", "audio retention");
assertIncludes(pricingFaq, "How are translated calls billed?", "billing");
assertIncludes(pricingFaq, "60-second minimum", "billing increment");
assertIncludes(pricingFaq, "reset each billing cycle", "monthly resets");
assertIncludes(pricingFaq, "Purchased top-up credits never expire", "top-up expiration");
assertIncludes(pricingFaq, "One credit balance covers", "shared balance");
assertIncludes(pricingFaq, "Need more? Buy credits", "overage solution");
assertIncludes(pricingFaq, "Every paid plan includes monthly", "feature parity");
assertIncludes(pricingFaq, "require a paid plan", "paid AI features");
assertIncludes(pricingFaq, "Can I cancel?", "cancellation");
assertIncludes(pricingFaq, "Is Voxandra open source?", "FAQ answers the open-source question");
assertIncludes(pricingFaq, "Can I run Voxandra myself?", "FAQ answers the self-host question");
assertIncludes(pricingFaq, "offer its users the source code", "FAQ states the AGPL network-service obligation");
assertIncludes(pricingFaq, "brand assets in public/brand", "FAQ excludes the name and brand assets");
assertIncludes(pricingFaq, "Ask a question", "support path");
assertNotIncludes(pricingFaq, "transcript import", "pricing FAQ avoids transcript import positioning");
assertNotIncludes(pricingFaq, "Do unused credits roll over?", "credit FAQ question no longer implies a rollover window");
assertNotIncludes(pricingFaq, "send us the workflow you want to", "pricing FAQ avoids workflow-contact CTA copy");
assertNotIncludes(pricingFaq, "faqGroups", "pricing FAQ avoids grouped help-center layout");
assertNotIncludes(pricingFaq, "Questions teams ask before trying Voxandra", "pricing FAQ avoids prior complex section heading");
assertNotIncludes(pricingFaq, "Do we need consent to record or transcribe calls?", "pricing FAQ omits consent FAQ");
assertNotIncludes(pricingFaq, "strict security, procurement, or regulated-data requirements", "pricing FAQ omits regulated-workflow sales caveat");
assertNotIncludes(pricingFaq, "Twilio-owned", "pricing FAQ avoids customer-facing provider detail");
assertNotIncludes(pricingFaq, "AI call memory", "pricing FAQ avoids old AI call memory term");

const walletPage = read("src/app/app/wallet/page.tsx");
assertIncludes(walletPage, "soloMemoryPlan", "wallet includes Solo placeholder plan");
assertIncludes(walletPage, "subscriptionPlans = [soloMemoryPlan, ...memoryPlans]", "wallet reuses shared Copilot plan ladder");
assertIncludes(walletPage, "Monthly included credits reset each billing cycle", "wallet reset policy");
assertIncludes(walletPage, "Purchased top-up credits", "wallet top-up policy");
assertIncludes(walletPage, "api.walletSummaries.getCreditActivity", "wallet uses credit activity query");
assertIncludes(walletPage, "Available now", "wallet shows current available credits");
assertIncludes(walletPage, "Credits spent this cycle", "wallet shows settled cycle spend");
assertIncludes(walletPage, "Recent credit activity", "wallet shows recent credit activity");
assertIncludes(walletPage, "Pending final cost", "wallet labels active call reservations");
assertIncludes(walletPage, "/api/stripe/checkout/subscription", "wallet subscription checkout route");
assertIncludes(walletPage, "WalletPlanCard", "wallet uses an internal subscription plan card");
assertIncludes(walletPage, "paid plans", "wallet subscription section heading");
assertIncludes(walletPage, "Choose the multilingual calling plan for this workspace", "wallet plan section explanatory heading");
assertIncludes(walletPage, "Current plan", "wallet shows current plan state");
assertIncludes(walletPage, "Checking billing", "wallet handles billing role loading state");
assertIncludes(walletPage, "plan.badge", "wallet displays plan badges such as Most popular");
assertIncludes(walletPage, "plan.featured", "wallet highlights featured plans");
assertIncludes(walletPage, "plan.liveFeatureCallouts", "wallet preserves Live Guidance and Live Translation plan callouts");
assertIncludes(walletPage, "plan.features.slice", "wallet shows a compact set of plan features");
assertIncludes(walletPage, "claimCheckout", "wallet detects public checkout claim");
assertIncludes(walletPage, "/api/stripe/public-checkout/claim", "wallet claims public Stripe checkout after signup");
assertIncludes(walletPage, "Connecting your paid Stripe checkout", "wallet shows public checkout claim loading state");
assertIncludes(walletPage, "/api/stripe/checkout/top-up", "wallet top-up checkout route");
assertIncludes(
  walletPage,
  'currentRole === "owner" || currentRole === "admin"',
  "wallet lets admins buy credits, not just the owner"
);
assertIncludes(walletPage, '"buy_credits"', "wallet top-up actions use the credit-buying permission");
// The default must stay the stricter gate, so a future billing action added without
// a permission argument is owner-only rather than silently open to admins.
assertIncludes(
  walletPage,
  'permission: "manage_billing" | "buy_credits" = "manage_billing"',
  "wallet billing actions default to the owner-only gate"
);
assertIncludes(walletPage, "Or enter custom amount", "wallet custom top-up input");
// The top-up cards say what the money actually buys, because the same dollar is
// ~166 US/Canada call minutes or 14 Live Guidance minutes on Solo, and a customer
// who does not know that turns the feature off instead of buying more. Every
// figure must come from the live rate: four hard-coded "$0.40/min" strings in
// src/lib/pricing.ts became false advertising the moment Live Guidance overage was
// tiered, and this display would fail the same way.
assertIncludes(walletPage, "describeTopUpBuyingPower", "wallet shows what a top-up buys");
assertIncludes(
  walletPage,
  "featureRatesCentsPerMinute: topUpFeatureRates",
  "wallet feeds top-up breakdown the workspace's own tiered overage rates"
);
// Voice Translation is the primary translated-call meter; the wallet must use
// its independent pool and rate rather than the cheaper captions meter.
assertIncludes(
  walletPage,
  "translatedAudio.overageCentsPerMinute",
  "wallet shows Voice Translation minutes from the correct meter"
);
assertIncludes(
  walletPage,
  "One balance, spent on whichever of these you actually use.",
  "wallet keeps the one-credit-balance framing beside the per-feature rows"
);

const buyingPower = read("src/lib/billing/buying-power.ts");
assertIncludes(
  buyingPower,
  "getRetailRateCentsPerMinute(INCLUDED_MINUTES_REFERENCE_COUNTRY)",
  "buying power derives the calling rate instead of hard-coding it"
);
assertIncludes(
  buyingPower,
  "Math.floor(amountCents / centsPerMinute)",
  "buying power rounds minutes down so a top-up never advertises a minute it cannot cover"
);
assertIncludes(
  buyingPower,
  "US/Canada calls",
  "buying power names the reference destination, since other destinations buy fewer minutes"
);
assertIncludes(walletPage, "Issue business invoice (billing address required)", "wallet business invoice checkbox");
assertIncludes(walletPage, "Enable Auto Top-up", "wallet auto top-up control");
assertIncludes(walletPage, "/api/stripe/auto-top-up/setup", "wallet auto top-up setup route");
assertIncludes(walletPage, "/api/stripe/portal", "wallet portal route");
assertIncludes(walletPage, "Live Guidance and Live Translation usage", "wallet realtime usage section");
assertIncludes(walletPage, "Every paid plan includes monthly Live Guidance and Live Translation minutes", "wallet realtime inclusion copy");
assertIncludes(walletPage, "the same\n              credit balance your calls use", "wallet says live overage uses the same credit balance as calls");
assertIncludes(walletPage, "There is no separate live-feature add-on to buy", "wallet rules out a separate live-feature purchase");
assertIncludes(walletPage, "Buy more credits", "wallet realtime section links to buying credits");
assertIncludes(walletPage, "Purchased top-up credits never\n          expire", "wallet says purchased credits never expire");
assertNotIncludes(walletPage, "TOP_UP_CREDIT_EXPIRY_DAYS", "wallet no longer references a top-up expiry window");
assertIncludes(walletPage, "Start any paid plan for monthly Live Guidance and Live Translation minutes", "wallet live guidance subscribe copy");
assertNotIncludes(walletPage, 'billingMode === "trial"', "wallet realtime UI no longer branches on lifetime trials");
assertNotIncludes(walletPage, "trialRemainingSeconds", "wallet realtime UI no longer reads lifetime trial balance");
assertIncludes(walletPage, 'id="calling-numbers"', "wallet caller ID anchor targets calling numbers");
assertIncludes(walletPage, "Cancel rented number?", "wallet rented number cancellation confirmation");
assertIncludes(walletPage, "Credit policy", "wallet credit policy info panel");
assertNotIncludes(walletPage, "ComingSoonCard", "wallet credit policy is not coming soon");
assertNotIncludes(walletPage, "Live AI", "wallet uses Live Guidance instead of Live AI");

const walletSummaries = read("convex/walletSummaries.ts");
assertIncludes(walletSummaries, "getCreditActivity", "wallet summaries expose credit activity query");
assertIncludes(walletSummaries, "by_workspace_createdAt", "wallet activity uses workspace timestamp index");
assertIncludes(walletSummaries, 'entry.type === "settle" || entry.type === "realtime_charge"', "wallet cycle spend includes only settled call and realtime charges");
assertIncludes(walletSummaries, 'entry.type === "adjustment" && entry.amountCents > 0 && entry.callId', "wallet cycle spend nets call-linked refunds only, never promotional grants");
assertIncludes(walletSummaries, "Reserved for active call", "wallet activity labels active reservations");
// A member who cannot buy can at least ask the people who can. This spends no money
// and takes no billing action, so it is open to any member by design.
assertIncludes(walletSummaries, "requestWorkspaceCredits", "wallet exposes the credit-request nudge");
assertIncludes(walletSummaries, "enqueueCreditRequestEmail", "credit request goes through the shared email queue");

// The Convex function is the authoritative surface — a role check in a Next route
// is bypassable, because these mutations are public and callable straight from the
// browser. setBillingPreferencesForCurrentWorkspace was guarded by bare
// requireWorkspace, so any member could enable auto top-up against the owner's card.
const stripeBillingAuth = read("convex/stripeBilling.ts");
assertIncludes(
  stripeBillingAuth,
  "const touchesAutoTopUp =",
  "billing preferences split the auto top-up fields from the rest"
);
assertIncludes(
  stripeBillingAuth,
  "? await requireWorkspaceOwner(ctx)\n      : await requireWorkspaceAdmin(ctx)",
  "auto top-up is owner-only, other billing preferences admit admins"
);
assertNotMatches(
  stripeBillingAuth,
  /setBillingPreferencesForCurrentWorkspace[\s\S]{0,400}?await requireWorkspace\(ctx\)/,
  "billing preferences no longer accept any workspace member"
);
assertNotMatches(
  stripeBillingAuth,
  /setStripeCustomerForCurrentWorkspace[\s\S]{0,400}?await requireWorkspace\(ctx\)/,
  "Stripe customer mutation no longer accepts any workspace member"
);

const emailsModule = read("convex/emails.ts");
assertIncludes(emailsModule, "CREDIT_REQUEST_COOLDOWN_MS", "credit-request nudge is rate limited");
assertIncludes(
  emailsModule,
  'membership.role === "owner" || membership.role === "admin"',
  "credit-request nudge reaches admins as well as the owner"
);
assertIncludes(
  emailsModule,
  "if (userId === args.requestedByUserId) continue;",
  "credit-request nudge never mails the requester their own request"
);
assertIncludes(emailsModule, "credit_request", "credit-request queueing names its template");

// Bodies and subjects live in convex/emailTemplates.ts, which is deliberately
// import-free so scripts/test-email-templates.mjs can render every template
// outside a deployment. That file asserts the rendered HTML; these assert that the
// module keeps the properties that make it renderable at all.
const emailTemplatesModule = read("convex/emailTemplates.ts");
assertIncludes(emailTemplatesModule, "credit_request", "credit-request email template is registered");
// The requester's display name is customer-supplied text rendered into an email.
assertIncludes(
  emailTemplatesModule,
  "escapeHtml(requestedByName.trim())",
  "credit-request nudge escapes the requester name"
);
// One import here would make every template untestable again, which is exactly how
// the credit-request email reached production without its HTML ever being rendered.
assertNotMatches(
  emailTemplatesModule,
  /^import\s/m,
  "email templates module must stay import-free so it can be rendered in tests"
);
assertIncludes(
  emailTemplatesModule,
  "EMAIL_TEMPLATES[templateName]?.subject",
  "subjects have one source of truth rather than a parallel lookup table"
);

// --- marketing opt-out -------------------------------------------------------
// The opt-out covers the two winback_* sequences and nothing else. Transactional
// mail answers something the recipient just did, so there is nothing to opt out of
// and offering the link would imply otherwise.
assertIncludes(emailsModule, "isWinBackSequence", "win-back detection is shared, not re-derived");
assertIncludes(
  emailsModule,
  'if (profile?.marketingEmailOptOut) {\n      return { send: false, reason: "opted_out" };',
  "queued win-backs are suppressed for opted-out recipients"
);
assertIncludes(
  emailsModule,
  "if (!expected || args.secret !== expected)",
  "unsubscribeByToken fails closed when its secret is unset"
);
// The mutation must derive the profile from the token alone — accepting a userId
// would let any caller unsubscribe anyone.
assertNotIncludes(
  emailsModule,
  "unsubscribeByToken = mutation({\n  args: {\n    secret: v.string(),\n    userId",
  "unsubscribeByToken must not accept a caller-supplied user"
);
assertIncludes(
  emailsModule,
  "ensureUnsubscribeToken",
  "no marketing email is queued without an unsubscribe token"
);

const unsubscribeRoute = read("src/app/api/unsubscribe/route.ts");
// GET must stay side-effect free. Mail clients, link scanners and corporate
// security proxies fetch URLs found in email; opting out on GET would unsubscribe
// people who never clicked. That is the whole reason RFC 8058 uses POST.
assertIncludes(unsubscribeRoute, "export async function POST", "one-click unsubscribe accepts POST");
assertIncludes(unsubscribeRoute, "NextResponse.redirect", "GET redirects instead of opting out");
assertNotMatches(
  unsubscribeRoute,
  /export async function GET[\s\S]*?optOut\(/,
  "GET must not perform the opt-out"
);

const unsubscribePage = read("src/app/unsubscribe/page.tsx");
assertIncludes(unsubscribePage, '"use client"', "unsubscribe page opts out from JS a scanner will not run");
assertIncludes(unsubscribePage, "resubscribe", "unsubscribe page offers an undo");

const emailSenderHeaders = read("convex/emailSender.ts");
assertIncludes(emailSenderHeaders, "headers?: Record<string, string>", "sender can set headers");
assertIncludes(emailsModule, '"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"', "RFC 8058 one-click header");
// Marketing only: List-Unsubscribe on a transactional receipt tells the client it
// is bulk, which is untrue and hurts delivery of mail people actually want.
assertIncludes(
  emailsModule,
  "const oneClickUrl = args.metadata?.unsubscribeOneClickUrl;",
  "unsubscribe headers are driven by the marketing-only metadata field"
);

const emailCron = read("convex/emailCron.ts");
// job.metadata carries booleans and timestamps that sendEmailAction's validator
// rejects, so per-job fields must be forwarded one at a time, never spread.
assertIncludes(emailCron, "job.metadata?.requestedByName", "email cron forwards the requester name");
assertNotIncludes(emailCron, "...job.metadata,", "email cron does not blind-spread job metadata");
assertIncludes(walletSummaries, "Charged for completed call", "wallet activity labels settled call charges");

const billingConfig = read("src/lib/billing/config.ts");
const feedbackConfig = read("src/lib/feedback.ts");
for (const expected of [
  'FEEDBACK_PAID_PLAN_IDS = ["solo", "starter", "team", "operations"]',
  'FEEDBACK_ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"]',
  '"Call Memory"',
  '"Billing & credits"',
  '"Live AI"',
  "feedbackCustomerMessage",
  '"my_votes"',
]) {
  assertIncludes(feedbackConfig, expected, `feedback config ${expected}`);
}

const feedbackFunctions = read("convex/feedback.ts");
assertIncludes(feedbackFunctions, "requireWorkspaceMembership", "feedback requires workspace membership");
assertIncludes(feedbackFunctions, "canParticipateInFeedback", "feedback uses paid-plan access helper");
assertIncludes(feedbackFunctions, "subscriptionStatus", "feedback checks subscription status");
assertIncludes(feedbackFunctions, "by_request_workspace", "feedback vote one workspace lookup");
assertIncludes(feedbackFunctions, "createdByWorkspaceId", "feedback stores creator workspace for audit");
assertNotIncludes(feedbackFunctions, "displayName", "feedback functions do not expose display names");
assertNotIncludes(feedbackFunctions, "email", "feedback functions do not expose emails");

for (const expected of [
  'STRIPE_API_VERSION = "2026-02-25.clover"',
  'stripeLookupKey: "voxandra_solo_monthly"',
  "monthlyPriceCents: 2900",
  "includedCreditCents: 250",
  'stripeLookupKey: "voxandra_starter_monthly"',
  "monthlyPriceCents: 4900",
  "monthlyPriceCents: 44900",
  "includedCreditCents: 500",
  'stripeLookupKey: "voxandra_topup_25"',
  'TOP_UP_CREDIT_EXPIRY_LABEL = "never"',
  "CUSTOM_TOP_UP_MIN_CENTS = 500",
  "CUSTOM_TOP_UP_MAX_CENTS = 100000",
  "AUTO_TOP_UP_THRESHOLD_CENTS = 1000",
  "AUTO_TOP_UP_AMOUNT_CENTS = 2500",
  "MIN_CALL_RESERVATION_SECONDS",
]) {
  assertIncludes(billingConfig, expected, `billing config ${expected}`);
}

const stripeWebhookRoute = read("src/app/api/stripe/webhook/route.ts");
assertIncludes(stripeWebhookRoute, "stripe-signature", "Stripe signature verification");
assertIncludes(stripeWebhookRoute, "processStripeWebhookEvent", "Stripe webhook Convex processor");

const stripeBilling = read("convex/stripeBilling.ts");
assertIncludes(stripeBilling, "stripeWebhookEvents", "Stripe webhook idempotency table usage");
assertIncludes(stripeBilling, "grant_included", "Stripe grants monthly included credits");
assertIncludes(stripeBilling, "grantTopUpCredits", "Stripe delegates top-up credit grants");
assertIncludes(stripeBilling, "topUpId\")", "Stripe fixed/custom top-up metadata support");
assertIncludes(stripeBilling, "numberMetadataField(data, \"amountCents\")", "Stripe custom top-ups grant metadata amount");
assertIncludes(stripeBilling, "saveAutoTopUpFromStripe", "Stripe auto top-up setup persistence");
assertIncludes(stripeBilling, "grantAutoTopUpCreditsByCustomer", "Stripe auto top-up credit grant mutation");
assertIncludes(stripeBilling, "clearLegacyTopUpExpiry", "Stripe billing clears legacy top-up expiry instead of burning credits");
assertNotIncludes(stripeBilling, "expireExpiredTopUpCredits", "Stripe billing no longer expires top-up credits");
assertIncludes(stripeBilling, "payment_status", "Stripe top-up credits wait for paid checkout status");
assertIncludes(stripeBilling, "recordPublicStripeCheckoutStarted", "Stripe records pending public checkouts");
assertIncludes(stripeBilling, "claimPublicStripeCheckout", "Stripe claims paid public checkouts after signup");
assertIncludes(stripeBilling, "public_checkout_waiting_for_claim", "Stripe webhook keeps paid-first checkouts claimable");
assertIncludes(stripeBilling, "stripe_top_up:${args.stripeCheckoutSessionId}", "public top-up claim grants credits idempotently");
assertIncludes(stripeBilling, "paid public checkout", "public subscription claim grants paid-first included credits");

assertIncludes(schema, "publicStripeCheckouts", "schema stores public Stripe checkout claims");
assertIncludes(schema, "by_stripe_checkout_session", "public checkout lookup by Stripe session");
assertIncludes(schema, "by_status_expires", "public checkout status expiry index");
assertIncludes(schema, "launchInterestSignups", "schema stores archived launch-interest signups");
assertIncludes(schema, "useCaseOther", "launch interest schema stores other use-case detail");
assertIncludes(schema, "roleSegmentOther", "launch interest schema stores other role detail");
assertIncludes(schema, "companyTypeOther", "launch interest schema stores other team-type detail");
assertIncludes(schema, "consentTextVersion", "launch interest schema stores consent text version");
assertIncludes(schema, "consentedAt", "launch interest schema stores consent timestamp");
assertIncludes(schema, "submissionCount", "launch interest schema tracks duplicate submissions");
assertIncludes(schema, '.index("by_email", ["email"])', "launch interest schema supports email dedupe");
assertIncludes(schema, '.index("by_status_created", ["status", "createdAt"])', "launch interest schema supports export ordering");
assertIncludes(schema, '.index("by_use_case", ["useCase"])', "launch interest schema supports use-case reporting");

const publicSubscriptionCheckoutRoute = read("src/app/api/stripe/public-checkout/subscription/route.ts");
assertIncludes(publicSubscriptionCheckoutRoute, 'mode: "subscription"', "public subscription checkout uses Stripe Checkout subscription mode");
assertIncludes(publicSubscriptionCheckoutRoute, "publicCheckoutSuccessUrl", "public subscription checkout returns signup claim URL");
assertIncludes(publicSubscriptionCheckoutRoute, "recordPublicStripeCheckoutStarted", "public subscription checkout stores pending claim");
assertIncludes(publicSubscriptionCheckoutRoute, "claimTokenHash", "public subscription checkout stores token hash only");

const publicTopUpCheckoutRoute = read("src/app/api/stripe/public-checkout/top-up/route.ts");
assertIncludes(publicTopUpCheckoutRoute, 'mode: "payment"', "public top-up checkout uses Stripe Checkout payment mode");
assertIncludes(publicTopUpCheckoutRoute, 'customer_creation: "always"', "public top-up checkout creates a Stripe customer");
assertIncludes(publicTopUpCheckoutRoute, "recordPublicStripeCheckoutStarted", "public top-up checkout stores pending claim");

const publicCheckoutClaimRoute = read("src/app/api/stripe/public-checkout/claim/route.ts");
assertIncludes(publicCheckoutClaimRoute, "getOwnerBillingContext", "public checkout claim requires owner auth");
assertIncludes(publicCheckoutClaimRoute, "checkout.sessions.retrieve", "public checkout claim verifies Stripe session server-side");
assertIncludes(publicCheckoutClaimRoute, "claimPublicStripeCheckout", "public checkout claim delegates guarded Convex mutation");

assertPathMissing("src/app/api/launch-interest/route.ts", "public launch-interest submission route is retired");

const launchInterestFunctions = read("convex/launchInterest.ts");
assertIncludes(launchInterestFunctions, "assertLaunchInterestSecret", "launch interest Convex functions validate secret");
assertIncludes(launchInterestFunctions, "withIndex(\"by_email\"", "launch interest mutation dedupes by email index");
assertIncludes(launchInterestFunctions, "useCaseOther", "launch interest mutation stores other use-case detail");
assertIncludes(launchInterestFunctions, "roleSegmentOther", "launch interest mutation stores other role detail");
assertIncludes(launchInterestFunctions, "companyTypeOther", "launch interest mutation stores other team-type detail");
assertIncludes(launchInterestFunctions, "submissionCount: existing.submissionCount + 1", "launch interest mutation increments duplicate submissions");
assertIncludes(launchInterestFunctions, "exportCsv", "launch interest Convex functions expose guarded CSV export");

const launchInterestExportRoute = read("src/app/api/launch-interest/export/route.ts");
assertIncludes(launchInterestExportRoute, "Authorization", "launch interest export route checks bearer token");
assertIncludes(launchInterestExportRoute, "LAUNCH_INTEREST_CONVEX_SECRET", "launch interest export route uses launch secret");
assertIncludes(launchInterestExportRoute, "text/csv", "launch interest export route returns CSV");
assertIncludes(launchInterestExportRoute, "no-store", "launch interest export route disables caching");

const envExampleFull = read(".env.example");
assertNotIncludes(envExampleFull, "VOXANDRA_HOMEPAGE_MODE", "env example does not expose retired homepage mode switch");
assertIncludes(envExampleFull, "LAUNCH_INTEREST_CONVEX_SECRET=", "env example documents archived launch interest export secret");
assertNotIncludes(envExampleFull, "LAUNCH_INTEREST_AGENTMAIL_INBOX_ID", "env example removes retired launch notification inbox");
assertNotIncludes(envExampleFull, "LAUNCH_INTEREST_NOTIFY_EMAIL", "env example removes retired launch notification recipient");
assertIncludes(envExampleFull, "RESEND_API_KEY=", "env example documents Resend key");
assertIncludes(envExampleFull, 'EMAIL_FROM="Voxandra <hello@mail.voxandra.com>"', "env example documents subdomain sender");
assertIncludes(envExampleFull, "EMAIL_REPLY_TO=contact@voxandra.com", "env example documents reply-to sender");

const topUpRoute = read("src/app/api/stripe/checkout/top-up/route.ts");
assertIncludes(topUpRoute, "getTopUpBillingContext", "Stripe top-up route admits owners and admins");
assertNotIncludes(topUpRoute, "getOwnerBillingContext", "Stripe top-up route is not owner-only");
// The wider gate must stay confined to buying credits. Subscriptions, the billing
// portal, auto top-up (a standing charge authorization) and number rentals all create
// or cancel recurring commitments and stay owner-only.
for (const [ownerOnlyRoute, label] of [
  ["src/app/api/stripe/checkout/subscription/route.ts", "subscription checkout"],
  ["src/app/api/stripe/portal/route.ts", "billing portal"],
  ["src/app/api/stripe/auto-top-up/setup/route.ts", "auto top-up setup"],
  ["src/app/api/stripe/auto-top-up/charge/route.ts", "auto top-up charge"],
  ["src/app/api/stripe/checkout/calling-number/route.ts", "number rental"],
  ["src/app/api/stripe/calling-number/cancel/route.ts", "number cancellation"],
]) {
  assertIncludes(read(ownerOnlyRoute), "getOwnerBillingContext", `${label} stays owner-only`);
  assertNotIncludes(read(ownerOnlyRoute), "getTopUpBillingContext", `${label} does not admit admins`);
}
assertIncludes(topUpRoute, "customAmountCents", "Stripe top-up route accepts custom amounts");
assertIncludes(topUpRoute, "price_data", "Stripe top-up route uses dynamic price data for custom amounts");
assertIncludes(topUpRoute, "billing_address_collection", "Stripe top-up route can require billing address");
assertIncludes(topUpRoute, "topUp.amountCents", "Stripe top-up route guards configured fixed amount");
assertIncludes(topUpRoute, 'kind: "one_time"', "Stripe top-up route requires one-time fixed price");

const autoTopUpSetupRoute = read("src/app/api/stripe/auto-top-up/setup/route.ts");
assertIncludes(autoTopUpSetupRoute, 'mode: "setup"', "Stripe auto top-up uses setup checkout");
assertIncludes(autoTopUpSetupRoute, "default_payment_method", "Stripe auto top-up stores default payment method");

const autoTopUpChargeRoute = read("src/app/api/stripe/auto-top-up/charge/route.ts");
assertIncludes(autoTopUpChargeRoute, "paymentIntents.create", "Stripe auto top-up charges off-session payment intent");
assertIncludes(autoTopUpChargeRoute, "off_session: true", "Stripe auto top-up payment is off-session");
assertIncludes(autoTopUpChargeRoute, "body.force", "Stripe auto top-up can be forced after call reservation failure");

const callPricing = read("src/lib/call-pricing.ts");
assertIncludes(callPricing, "quoteOutboundCall", "call pricing exposes provider-aware quote engine");
assertIncludes(callPricing, "MINIMUM_MARGIN_MULTIPLE = 2", "call pricing enforces 2x minimum margin");
assertIncludes(callPricing, "MINIMUM_RETAIL_RATE_CENTS_PER_MINUTE = 6", "call pricing enforces retail floor");
// 99 -> 150 -> 240 on 2026-07-31 so every standard route in the catalog is
// quotable at its real US-origin cost (the priciest is Kosovo mobile, needing
// 236c). 150 had left five countries able to call landlines but not mobiles.
// Blocked classifications still fail closed on classification, not price. The
// per-route exception map is empty: with the global cap above every reviewed
// route, an entry would only ever make a route stricter.
assertIncludes(callPricing, "MAX_SELF_SERVE_RETAIL_RATE_CENTS_PER_MINUTE = 240", "call pricing enforces launch cap");
assertIncludes(callPricing, "OUTBOUND_SELF_SERVE_RATE_CAP_EXCEPTIONS_CENTS_PER_MINUTE", "call pricing keeps the per-route cap exception mechanism");
assertIncludes(callPricing, "selfServeRateCapCentsPerMinute", "outbound quotes apply route-specific caps without widening the global cap");
assertIncludes(callPricing, "BLOCKED_DESTINATION_PREFIXES", "call pricing blocks premium and special prefixes");
assertIncludes(callPricing, "BLOCKED_EMERGENCY_SERVICE_CODES", "call pricing blocks emergency service codes");
assertIncludes(callPricing, "getBillableCallSeconds", "call pricing centralizes started-minute billing");
assertIncludes(callPricing, "MINIMUM_BILLABLE_CALL_SECONDS", "call pricing has 60-second minimum billing");
assertIncludes(callPricing, "estimateBillableCallCostCents", "call pricing estimates rounded billable call costs");
assertIncludes(callPricing, "This destination needs a provider-rate quote before launch", "unknown routes fail closed");
assertIncludes(callPricing, "+1900", "premium NANP routes are blocked");

const twilioRateCatalog = read("src/lib/twilio-rate-catalog.ts");
assertIncludes(twilioRateCatalog, "TWILIO_PROVIDER_RATES", "Twilio provider rate catalog is checked in");
// The catalog became generated output (JSON.stringify, so keys are quoted) when
// it was resynced from Twilio's Pricing API on 2026-07-31, replacing the
// hand-seeded rows whose Portugal figure had drifted to a third of the real
// price. These guards therefore match the generated shape.
assertIncludes(twilioRateCatalog, '"destinationCountry": "US/CA"', "catalog covers US/CA launch route");
assertIncludes(twilioRateCatalog, '"destinationCountry": "PT"', "catalog covers Portugal launch route");
assertIncludes(twilioRateCatalog, '"destinationCountry": "GB"', "catalog covers UK launch route");
assertIncludes(twilioRateCatalog, '"destinationCountry": "ES"', "catalog covers Spain launch route");
assertOccurrences(twilioRateCatalog, '"destinationCountry": "LT"', 4, "catalog covers Lithuania mobile and landline rates for EEA and other origins");
assertIncludes(twilioRateCatalog, '"routeType": "lithuania_mobile_from_eea"', "catalog distinguishes Lithuanian mobile calls from EEA origins");
assertIncludes(twilioRateCatalog, '"providerCostCentsPerMinute": 35.48', "catalog pins the current Lithuanian mobile EEA carrier cost");
assertIncludes(twilioRateCatalog, '"+3706"', "catalog matches Lithuanian mobile prefixes before the country fallback");
// Mobile is priced separately from the country fallback, which the hand-seeded
// catalog never did: it billed a 1.71c Portuguese landline as a 17.2c mobile.
assertIncludes(twilioRateCatalog, '"routeType": "portugal_mobile"', "catalog prices Portuguese mobile apart from landline");
assertIncludes(twilioRateCatalog, '"providerCostCentsPerMinute": 49.5', "catalog pins the verified US-origin Portugal mobile cost");
assertIncludes(twilioRateCatalog, '"originGroup": "eea"', "catalog supports EEA-origin pricing");
assertIncludes(twilioRateCatalog, '"originGroup": "non_eea"', "catalog supports non-EEA-origin pricing");
assertIncludes(twilioRateCatalog, '"destinationCountry": "ZA"', "catalog covers South Africa launch route");
// South Africa's domestic-origin discount tiers are omitted rather than mapped:
// Voxandra owns no ZA caller ID, and every ZA row now carries the worldwide-origin
// price we actually pay (37.49c mobile, which is what the old non_za row encoded).
assertIncludes(twilioRateCatalog, '"routeType": "south_africa_mobile"', "catalog prices South African mobile at the worldwide-origin rate we pay");
assertIncludes(twilioRateCatalog, '"classification": "blocked_special_service"', "catalog blocks special-service routes such as Spain 34901-34909");
assertIncludes(twilioRateCatalog, '"classification": "blocked_premium"', "catalog blocks premium routes such as UK +449");
assertIncludes(twilioRateCatalog, "TWILIO_BROWSER_LEG_COST_CENTS_PER_MINUTE", "catalog includes browser leg cost allowance");
assertIncludes(twilioRateCatalog, "OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE", "catalog includes transcription cost allowance");

const twilioRateSync = read("scripts/sync-twilio-voice-rates.mjs");
assertIncludes(twilioRateSync, "pricing.twilio.com/v2/Voice/Countries", "Twilio rate sync uses Voice Pricing API");
assertIncludes(twilioRateSync, "TWILIO_ALLOWED_COUNTRIES", "Twilio rate sync follows allowed launch countries");
assertIncludes(twilioRateSync, "outbound_prefix_prices", "Twilio rate sync reads outbound prefix prices");
assertIncludes(twilioRateSync, "TWILIO_ACCOUNT_SID", "Twilio rate sync requires authenticated account pricing");
assertIncludes(twilioRateSync, "blocked_unclassified", "Twilio rate sync blocks unclassified route rows");
assertIncludes(twilioRateSync, "--write", "Twilio rate sync can update checked-in catalog");

const twilioCalls = read("convex/twilioCalls.ts");
assertIncludes(twilioCalls, "reserveCallCredits", "Twilio calls reserve credits before calling");
assertIncludes(twilioCalls, "releaseCallReservation", "Twilio calls release expired pending reservations");
assertIncludes(twilioCalls, "Released credits for call session that expired before connecting", "Twilio calls records expired-session release reason");
assertIncludes(twilioCalls, "estimateDestinationRate", "Twilio calls expose pre-call destination rates");
assertIncludes(twilioCalls, "quoteOutboundCall", "Twilio calls quote provider-aware rates before call creation");
assertIncludes(twilioCalls, "!quote.available", "Twilio calls fail closed without profitable quote");
assertIncludes(twilioCalls, "providerCostCentsPerMinute", "Twilio calls persist provider cost quote");
assertIncludes(twilioCalls, "totalVariableCostCentsPerMinute", "Twilio calls persist total variable cost quote");
assertIncludes(twilioCalls, "marginMultiple", "Twilio calls persist margin multiple");
assertIncludes(twilioCalls, "quoteBlockReason", "Twilio calls persist quote block reason field");
assertIncludes(twilioCalls, "aiCaptureEnabled", "Twilio calls persist AI capture entitlement");
assertIncludes(twilioCalls, "retailRateCentsPerMinute", "Twilio calls store retail rates for estimates");
assertNotIncludes(twilioCalls, "getRetailRateCentsPerMinute", "Twilio calls do not use flat country-only rates as source of truth");
assertIncludes(twilioCalls, "assertRealtimeFeatureCanStart", "Twilio calls enforce realtime entitlement");
assertIncludes(twilioCalls, "createRequestedRealtimeSession", "Twilio calls create provider-neutral realtime session records");
assertIncludes(twilioCalls, "assertLiveTranslationLanguageDirection", "Twilio calls validate Live Translation language direction");
assertIncludes(twilioCalls, "translatedCaptionsSourceLanguage", "Twilio calls accept Live Translation source language");
assertIncludes(twilioCalls, "translatedCaptionsTargetLanguage", "Twilio calls accept Live Translation target language");
assertIncludes(twilioCalls, "inputLanguage: liveTranslationDirection.sourceLanguage", "Twilio calls pass Live Translation source to realtime session");
assertIncludes(twilioCalls, "targetLanguage: liveTranslationDirection.targetLanguage", "Twilio calls pass Live Translation target to realtime session");
assertIncludes(twilioCalls, "seedDeterministicGuidanceItems", "Twilio calls seed deterministic guidance");
assertIncludes(twilioCalls, "checklistItems: args.checklistItems", "Twilio calls seed the user-authored call checklist");
assertIncludes(twilioCalls, "isFreeCallEligibleWallet", "Twilio calls centralize free-call eligibility");
assertIncludes(twilioCalls, 'wallet.planId === "free"', "free call requires free plan");
assertIncludes(twilioCalls, 'wallet.subscriptionStatus === "free"', "free call requires free subscription status");
assertIncludes(twilioCalls, "isTwilioCallingEnabled", "Twilio calls enforce backend calling-enabled guard");
assertIncludes(twilioCalls, "freeCallDestinationAllowed", "free calls enforce optional free route controls");
assertIncludes(twilioCalls, "expireStalePendingTwilioSessions", "free calls expire stale pending sessions");
assertIncludes(twilioCalls, "activePendingFreeSession", "free calls reject duplicate pending trial sessions");
assertIncludes(twilioCalls, "getFreeCallMaxSeconds", "free calls use actual capped max seconds");

const billingHelpers = read("convex/billingHelpers.ts");
assertIncludes(billingHelpers, "clearLegacyTopUpExpiry", "billing helpers clear legacy top-up expiry");
assertNotIncludes(billingHelpers, "expireExpiredTopUpCredits", "billing helpers no longer expire top-up credits");
// Purchased credits must never expire: no grant may be stamped with an expiry,
// and no read path may filter a lot out for being past one.
assertNotIncludes(billingHelpers, "TOP_UP_CREDIT_EXPIRY_MS", "top-up grants are not stamped with an expiry");
assertNotIncludes(billingHelpers, "entry.expiresAt > args.now", "no credit read path treats a purchased lot as expired");
assertNotIncludes(billingHelpers, "getNextTopUpExpiry", "no next-expiry computation remains");
assertIncludes(billingHelpers, "grant_top_up", "billing helpers grant top-up credits");
assertIncludes(billingHelpers, "allocateTopUpReservation", "billing helpers allocate top-up lots to reservations");
assertIncludes(billingHelpers, "releaseUnusedTopUpAllocation", "billing helpers release unused top-up lots");
assertIncludes(billingHelpers, "releaseCallReservation", "billing helpers release stale call reservations");
assertIncludes(billingHelpers, "Released credits for call that did not connect", "billing helpers ledger stale call releases");
assertIncludes(billingHelpers, "getAffordableBillableCallSeconds", "billing helpers reserve with billable started-minute model");
assertIncludes(billingHelpers, "estimateBillableCallCostCents", "billing helpers settle with billable started-minute model");
assertIncludes(billingHelpers, "settledBillableSeconds", "billing helpers persist settled billable seconds");
assertIncludes(billingHelpers, "started-minute billing", "billing ledger explains started-minute settlement");

const twilioProvider = read("convex/twilioProvider.ts");
assertIncludes(twilioProvider, "settleCallReservation", "Twilio status callback settles credits");
assertIncludes(twilioProvider, "releaseCallReservation", "Twilio provider releases expired pending reservations");
assertIncludes(twilioProvider, "realtimeCopilotRequested", "Twilio TwiML validates realtime request flags");
assertIncludes(twilioProvider, "markRealtimeSessionsStarting", "Twilio TwiML marks realtime runtime sessions as starting");
assertIncludes(twilioProvider, "realtimeSessionIds", "Twilio TwiML returns realtime session ids for media workers");
assertIncludes(twilioProvider, "translatedCaptionsSourceLanguage", "Twilio TwiML returns Live Translation source language");
assertIncludes(twilioProvider, "translatedCaptionsTargetLanguage", "Twilio TwiML returns Live Translation target language");
assertIncludes(twilioProvider, "markFreeCallClaimed", "Twilio TwiML marks free call claimed");
assertIncludes(twilioProvider, "getFreeCallMaxSeconds", "Twilio TwiML enforces actual free-call cap");
assertIncludes(twilioProvider, "freeCallUsedCallId", "Twilio TwiML records the free-call wallet claim call id");
assertIncludes(twilioProvider, "freeCallClaimedAt", "Twilio TwiML records claim time on call");
assertIncludes(twilioProvider, "TERMINAL_CALL_STATUSES", "Twilio access-token validation rejects terminal sessions");
assertIncludes(twilioProvider, "aiCaptureEnabled", "Twilio provider returns AI capture decision to TwiML route");
assertIncludes(twilioProvider, "call.aiCaptureEnabled !== false", "Twilio provider skips recording wait for calls-only");
assertIncludes(twilioProvider, "internal.transcription.deleteTwilioRecording", "Twilio provider deletes stray calls-only recordings");
assertNotIncludes(twilioProvider, "internal.emails.markFreeCallMade", "Twilio completion does not send memory-ready email");

const twilioServerRuntime = read("src/lib/twilio/server.ts");
assertIncludes(twilioServerRuntime, "aiCaptureEnabled", "Twilio TwiML generation accepts AI capture flag");
assertIncludes(twilioServerRuntime, "record: \"record-from-answer-dual\"", "Twilio TwiML records directional dual-channel Copilot calls");
assertIncludes(twilioServerRuntime, "Recording callback URL is required when AI capture is enabled", "Twilio TwiML requires recording callback only for capture");
assertIncludes(twilioServerRuntime, "mediaStreamTrack", "Twilio TwiML accepts explicit media stream track");
assertIncludes(twilioServerRuntime, 'track: args.mediaStreamTrack ?? "outbound_track"', "Twilio media stream defaults to the other-party track on the caller leg");

const twilioVoiceRouteRuntime = read("src/app/api/twilio/voice/route.ts");
assertIncludes(twilioVoiceRouteRuntime, "result.aiCaptureEnabled", "Twilio voice route passes AI capture to TwiML generation");
assertIncludes(twilioVoiceRouteRuntime, "recordingStatusCallbackUrl", "Twilio voice route builds recording callback conditionally");
assertIncludes(twilioVoiceRouteRuntime, "translationSourceLanguage", "Twilio voice route passes Live Translation source language to media stream");
assertIncludes(twilioVoiceRouteRuntime, "translationTargetLanguage", "Twilio voice route passes Live Translation target language to media stream");
assertIncludes(twilioVoiceRouteRuntime, 'translationDirection: "caller_to_user"', "Twilio voice route keeps Live Translation one-way text direction explicit");
assertIncludes(twilioVoiceRouteRuntime, 'translationDirection: "user_to_callee"', "Twilio bridge reverses the browser-leg translation direction");
assertIncludes(twilioVoiceRouteRuntime, 'legTwimlUrl.searchParams.set("bridgeTranslationEnabled", "true")', "Twilio bridge authorizes real translation on the signed callee-leg URL");
assertIncludes(twilioVoiceRouteRuntime, "translatedCaptionsRealtimeSessionId", "Twilio bridge assigns the tracked translation session to the callee leg");
assertIncludes(twilioVoiceRouteRuntime, 'calleeStatusUrl.searchParams.set("bridgeLeg", "callee")', "Twilio bridge labels callee callbacks separately");
assertIncludes(twilioVoiceRouteRuntime, "recordBridgeCalleeCallSid", "Twilio bridge persists the separately placed callee call SID");
assertIncludes(twilioVoiceRouteRuntime, "terminateTwilioCall", "Twilio bridge cleans up a callee leg when setup fails");
assertIncludes(twilioVoiceRouteRuntime, 'result.realtimeCopilotRequested ? "both_tracks" : "outbound_track"', "Twilio voice route streams both labeled call tracks for Live Guidance and only the called party for Translation-only calls");

// Bridge-leg lifecycle containment after the 2026-07-30 orphaned-leg incident.
// The behavioural coverage lives in scripts/test-twilio-bridge-lifecycle.mjs and
// the bridge tests in scripts/test-realtime-media-worker.mjs; these guards only
// protect the wiring those tests cannot see, and each one names the specific
// failure it prevents.
const twilioStatusRouteRuntime = read("src/app/api/twilio/status/route.ts");
assertIncludes(twilioStatusRouteRuntime, "{ status: 500 }", "Twilio status callback surfaces failures instead of silently dropping terminal events");
assertNotIncludes(twilioStatusRouteRuntime, "terminateSiblingCall", "sibling termination is not driven from the status webhook response body");
assertNotIncludes(twilioStatusRouteRuntime, "getTwilioClient", "the status route no longer needs Twilio calling credentials");
assertIncludes(twilioProvider, 'bridgeLeg === "parent"', "Twilio provider does not settle a bridge on the parent callback");
assertIncludes(twilioProvider, "internal.twilioLifecycle.terminateProviderCall", "sibling termination is scheduled inside the mutation that observed the hangup");
assertIncludes(twilioProvider, "internal.twilioLifecycle.enforceBridgeCallDeadline", "every bridge call arms an independent termination deadline");
assertIncludes(twilioProvider, "shouldApplyProviderStatusPatch", "out-of-order provider callbacks cannot regress a terminal call");
assertIncludes(twilioProvider, 'withIndex("by_bridge_callee_call_sid"', "callee-leg callbacks resolve through their own index");
assertIncludes(twilioProvider, "call.bridgeModeRequested\n      ? Math.min(quotedMaxCallSeconds, call.bridgeMaxCallSeconds ?? getBridgeMaxCallSeconds(), getBridgeMaxCallSeconds(60))", "the snapshotted bridge duration and operator ceiling do not depend on billing state");

const twilioLifecycle = read("convex/twilioLifecycle.ts");
assertIncludes(twilioLifecycle, "resolveTwilioTerminationStatus", "provider-leg termination picks the verb Twilio accepts for the leg's state");
assertIncludes(twilioLifecycle, "plan.fallback", "a rejected termination verb is retried with the other accepted verb");
assertIncludes(twilioLifecycle, "TERMINATION_BACKOFF_MS", "transient termination failures retry with backoff instead of being swallowed");
assertIncludes(twilioLifecycle, "sweepAbandonedCallReservations", "reservations survive a lost terminal callback via a sweeper");
assertIncludes(twilioLifecycle, "by_status_created", "the sweeper finds stranded reservations without a table scan");

const convexCrons = read("convex/crons.ts");
assertIncludes(convexCrons, "internal.twilioLifecycle.sweepAbandonedCallReservations", "the abandoned-reservation sweeper is actually scheduled");

const twilioCallsRuntime = read("convex/twilioCalls.ts");
assertIncludes(twilioCallsRuntime, "getBridgeMaxCallSeconds", "translated bridge calls have an independent hard duration cap");
assertIncludes(twilioCallsRuntime, "internal.twilioCalls.expirePendingSession", "pending call reservations have scheduled expiry");
assertIncludes(twilioCallsRuntime, "rescheduled: true", "pending-session expiry reschedules itself rather than giving up silently");
assertIncludes(twilioCallsRuntime, "cancelOutboundSession", "browser failures can release pending call reservations");
assertNotIncludes(twilioCallsRuntime, "enableBridgeMode ? false : requestedLiveCopilot", "bridge calls keep independently billed Live Guidance");
assertIncludes(twilioCallsRuntime, "callerTranslatedVoice", "bridge calls persist the caller translated voice");
assertIncludes(twilioCallsRuntime, "calledPersonTranslatedVoice", "bridge calls persist the called-person translated voice");

const twilioBridgeLegRouteRuntime = read("src/app/api/twilio/internal/bridge/leg-twiml/route.ts");
assertIncludes(twilioBridgeLegRouteRuntime, 'translatedCaptions: "true"', "Twilio bridge callee leg runs the tracked translation direction");
assertIncludes(twilioBridgeLegRouteRuntime, 'bridgeTranslationEnabled: "true"', "Twilio bridge callee leg explicitly enables Palabra injection");
assertIncludes(twilioBridgeLegRouteRuntime, "translatedCaptionsRealtimeSessionId", "Twilio bridge callee leg carries the tracked realtime session id");
assertIncludes(twilioBridgeLegRouteRuntime, "maxSessionSeconds", "Twilio bridge callee leg carries a signed worker-side session deadline");
assertIncludes(twilioVoiceRouteRuntime, 'maxSessionSeconds: String(result.maxCallSeconds)', "the browser bridge leg carries a worker-side session deadline it otherwise lacks");
assertIncludes(twilioVoiceRouteRuntime, "translationVoice: result.callerTranslatedVoice", "the browser microphone direction uses the caller voice");
assertIncludes(twilioVoiceRouteRuntime, 'set("translationVoice", result.calledPersonTranslatedVoice)', "the callee microphone direction uses the called-person voice");

const workerCore = read("scripts/realtime-media-worker-core.mjs");
assertIncludes(workerCore, "export function createBridgeLegRegistry", "the bridge leg registry is exported so tests exercise the shipping implementation");
assertIncludes(workerCore, "sibling.terminateForLifecycleEvent", "losing one bridge leg tears down the other instead of only unlinking it");
assertIncludes(workerCore, "bridgeMaxSessionSeconds", "the worker clamps every bridge session with its own ceiling");
assertIncludes(workerCore, "startBridgeSessionDeadline", "each bridge leg arms a self-enforced session deadline");
assertIncludes(workerCore, 'voice_id: palabraVoiceIdForGender(translatedVoice, config)', "Palabra tasks carry the selected built-in voice id, with the cloned-voice override available");
assertIncludes(workerCore, 'voice_cloning: false', "Palabra voice cloning (the separate, still-gated auto-clone-the-live-speaker behavior) stays disabled");
assertIncludes(workerCore, "this.legRole === \"browser\" && this.bridgeTranslationRequested ? this.config : {}", "a configured cloned voice is only ever passed to the browser leg's own Palabra session, never the callee's");

const convexSchema = read("convex/schema.ts");
assertIncludes(convexSchema, "callerTranslatedVoice", "call schema stores caller translated voice");
assertIncludes(convexSchema, "calledPersonTranslatedVoice", "call schema stores called-person translated voice");
assertIncludes(convexSchema, "callRecordLanguagePreference", "calls store call record language preference");
assertIncludes(convexSchema, "callRecordLanguageSource", "calls store call record language source");
assertIncludes(convexSchema, "recordingChannels", "calls store recording channel count");
assertIncludes(convexSchema, 'index("by_workspace_createdAt", ["workspaceId", "createdAt"])', "credit ledger has workspace timestamp index");
for (const tableName of [
  "realtimeSessions",
  "callUtterances",
  "translationSegments",
  "agentMissions",
  "agentRunEvents",
  "approvalRequests",
  "agentLearningExamples",
  "callMemorySearchDocs",
  "callMemoryEmbeddings",
]) {
  assertIncludes(convexSchema, `${tableName}: defineTable`, `schema defines ${tableName}`);
}
assertIncludes(convexSchema, 'searchIndex("search_body"', "schema defines full-text index for Call Records");
assertIncludes(convexSchema, 'vectorIndex("by_embedding"', "schema defines vector index for Call Records");
assertIncludes(convexSchema, 'filterFields: ["workspaceId"]', "Call Records indexes filter by workspace");
assertIncludes(convexSchema, 'v.literal("translated_audio_private")', "schema models private translated audio runtime mode");
assertIncludes(convexSchema, 'v.literal("translated_audio_bridge")', "schema models bridged translated audio runtime mode");
assertIncludes(convexSchema, 'v.literal("agent_shadow")', "schema models shadow agent runtime mode");
assertIncludes(convexSchema, 'v.literal("agent_autonomous")', "schema models autonomous agent runtime mode");
assertIncludes(convexSchema, 'v.literal("always_require_external_actions")', "agent missions default to external-action approvals");
assertIncludes(convexSchema, "audioStored", "translation segments record audio retention state");
assertIncludes(convexSchema, "stageTimings", "translation segments persist privacy-safe stage timings");
assertIncludes(convexSchema, "workerBuild", "realtime sessions persist the worker build fingerprint");
assertIncludes(convexSchema, "configFingerprint", "realtime sessions persist the worker config fingerprint");
assertIncludes(convexSchema, "translatedCaptionsSourceLanguage", "schema stores Live Translation source language on calls");
assertIncludes(convexSchema, "translatedCaptionsTargetLanguage", "schema stores Live Translation target language on calls");
assertIncludes(convexSchema, "callGuidanceItems: defineTable", "schema stores call guidance items");
assertIncludes(convexSchema, "realtimeUsageEvents: defineTable", "schema stores realtime usage events");
assertIncludes(convexSchema, "realtimeSessionId: v.optional(v.id(\"realtimeSessions\"))", "schema stores realtime session ids on realtime records");
assertIncludes(convexSchema, '.index("by_session", ["realtimeSessionId"])', "schema indexes realtime records by session");
assertIncludes(convexSchema, "const reviewedMeaning", "schema defines reviewed meaning object");
assertIncludes(convexSchema, "const aiDraftSnapshot", "schema defines AI draft snapshots");
assertIncludes(convexSchema, "reviewedMeaning: v.optional(reviewedMeaning)", "schema stores optional reviewed meaning");
assertIncludes(convexSchema, "draftSnapshot: v.optional(aiDraftSnapshot)", "schema stores optional draft snapshots");

const realtimeRuntime = read("convex/realtimeRuntime.ts");
assertIncludes(realtimeRuntime, "REALTIME_CONVEX_WORKER_SECRET", "realtime runtime worker mutations validate worker secret");
assertIncludes(realtimeRuntime, "createRealtimeSessionFromWorker", "realtime runtime lets media workers create provider-neutral sessions");
assertIncludes(realtimeRuntime, "recordCallUtteranceFromWorker", "realtime runtime stores worker utterances");
assertIncludes(realtimeRuntime, "recordTranslationSegmentFromWorker", "realtime runtime stores translation segments");
assertIncludes(realtimeRuntime, "recordAgentRunEventFromWorker", "realtime runtime stores agent run events");
assertIncludes(realtimeRuntime, "createApprovalRequestFromWorker", "realtime runtime creates approval requests from worker");

// Media Stream authentication (2026-09-09). Twilio does not authenticate Media
// Stream sockets, so the worker must: (1) verify the TwiML routes' HMAC over the
// stream parameters before trusting any of them, (2) bind the Twilio-reported
// CallSid to the Convex call row, and (3) every <Stream> the app emits must be
// signed — an unsigned TwiML path would be rejected by the worker on every call.
assertIncludes(realtimeRuntime, "export const validateWorkerStreamStart = query(", "worker stream start binds the Twilio CallSid to the Convex call");
{
  const streamAuthWorker = read("scripts/realtime-media-worker-core.mjs");
  assertIncludes(streamAuthWorker, "verifyMediaStreamSignature(params, this.config.streamSigningSecret)", "worker verifies stream parameter signature in handleStart");
  assertIncludes(streamAuthWorker, "api.realtimeRuntime.validateWorkerStreamStart", "worker binds the stream to its Twilio CallSid through Convex");
  assertIncludes(streamAuthWorker, 'missing.push("REALTIME_STREAM_SIGNING_SECRET', "worker refuses to start without a stream signing secret");
  assertIncludes(streamAuthWorker, 'key === "streamSigningSecret"', "config fingerprint excludes the stream signing secret");
  assertIncludes(streamAuthWorker, "maxPendingStreamsPerIp", "worker bounds unauthenticated sockets per client address");
  assertIncludes(streamAuthWorker, "streamStartTimeoutMs", "worker evicts sockets that never send a valid start");
  const twilioServer = read("src/lib/twilio/server.ts");
  assertIncludes(twilioServer, "export function appendSignedStreamParameters(", "one signed path for every <Stream> parameter set");
  assertOccurrences(
    twilioServer,
    "stream.parameter(",
    1,
    "src/lib/twilio/server.ts emits <Parameter> only inside appendSignedStreamParameters"
  );
  const echoRoute = read("src/app/api/twilio/internal/echo-test/route.ts");
  assertIncludes(echoRoute, "appendSignedStreamParameters(", "echo test TwiML signs its stream parameters");
  assertNotIncludes(echoRoute, "stream.parameter(", "echo test route emits no unsigned <Parameter>");
  const workerEnv = read(".env.example");
  assertIncludes(workerEnv, "REALTIME_STREAM_SIGNING_SECRET=", "env example documents the stream signing secret");
  assertIncludes(workerEnv, "REALTIME_WORKER_MAX_STREAMS=40", "env example carries the raised stream cap");
  const runbook = read("REALTIME_WORKER_RUNBOOK.md");
  assertIncludes(runbook, "## Media Stream Authentication", "runbook documents stream authentication");
  assertIncludes(runbook, "Vercel first,\nthen the worker", "runbook records the signing-secret deploy order");
}

// Voice Translation caller experience (2026-09-09): ringback until the callee
// connects, mic withheld from Palabra during ringing and the callee's
// disclosure, go-ahead chime, and a dialer that names the callee's phase
// instead of saying "In call" over silence.
{
  const bridgeWorker = read("scripts/realtime-media-worker-core.mjs");
  assertIncludes(bridgeWorker, "export function generateRingbackFrame(", "worker synthesizes ringback for the bridge browser leg");
  assertIncludes(bridgeWorker, "const micGated = this.isDisclosurePlaying()", "both microphones are gated during the shared introduction");
  assertIncludes(bridgeWorker, "micGated ? silencePcm24Base64(frameSamples) : pcm24", "gated mic sends silence to Palabra, not nothing");
  assertIncludes(bridgeWorker, "api.realtimeRuntime.updateBridgeDisclosureStateFromWorker", "worker reports the disclosure lifecycle to Convex");
  assertIncludes(bridgeWorker, "introduction?.acknowledge(this, event)", "Twilio playback acknowledgements control startup");
  assertIncludes(read("scripts/realtime-media-worker-disclosures.mjs"), "BRIDGE_GO_AHEAD_ENGLISH_TEXT", "both people hear localized spoken cues");
  assertIncludes(read("scripts/realtime-media-worker-disclosures.mjs"), 'beginPlayback("playing", this.legs.map(() => this.disclosure))', "both people receive the same announcement clip");
  const liveBridgeState = read("src/lib/live-bridge-state.ts");
  assertIncludes(liveBridgeState, "export function resolveLiveBridgeCalleePhase(", "one shared callee-phase resolver for Convex and the UI");
  assertIncludes(read("convex/translationBridge.ts"), "export const getLiveBridgeState = query(", "dialer can read the callee leg's live phase");
  assertIncludes(read("convex/schema.ts"), "bridgeDisclosureState: v.optional(", "schema stores the disclosure lifecycle");
  const dialer = read("src/components/dialer/dialer-mock.tsx");
  assertIncludes(dialer, "api.translationBridge.getLiveBridgeState", "dialer subscribes to the callee leg's live phase");
  assertIncludes(dialer, "describeLiveBridgePhase(", "dialer renders callee-phase copy");
  assertIncludes(read("src/components/layout/call-bar.tsx"), "describeLiveBridgePhase(", "mini call bar renders callee-phase copy");
  assertIncludes(read("package.json"), "scripts/test-live-bridge-state.mjs", "live bridge state tests run in npm test");

  // Bridge failure degrades to a plain full-volume call and the reverse
  // direction is observable (2026-09-09).
  assertIncludes(bridgeWorker, "degradeBridgeToPlainCall(sanitizedError)", "translation failure degrades the bridge");
  assertIncludes(bridgeWorker, "const gain = this.bridgeDegraded\n      ? 1", "degraded bridge mixes full-volume passthrough");
  assertIncludes(bridgeWorker, "api.realtimeRuntime.markBridgeTranslationDegradedFromWorker", "worker records the degrade for the dialer");
  assertIncludes(bridgeWorker, 'mode: "translated_audio_bridge"', "browser leg creates an observability session for the reverse direction");
  assertIncludes(bridgeWorker, "this.bridgeReverseRealtimeSessionId && !this.translationSessionFinished", "reverse session is finished on close");
  assertIncludes(read("convex/schema.ts"), "bridgeTranslationDegradedAt: v.optional(v.number())", "schema stores the degrade timestamp");
  assertIncludes(liveBridgeState, 'if (args.translationDegraded) return "degraded";', "degraded phase resolves for an in-progress callee");
}
assertIncludes(realtimeRuntime, "decideApprovalRequest", "realtime runtime requires authenticated decisions for approvals");
assertIncludes(realtimeRuntime, 'approvalPolicy: "always_require_external_actions"', "agent mission drafts require external-action approvals by default");

const agentLearning = read("convex/agentLearning.ts");
assertIncludes(agentLearning, "upsertLearningExampleForCall", "agent learning exposes reviewed-call example upsert helper");
assertIncludes(agentLearning, "listLearningExamples", "agent learning exposes workspace example listing");
assertIncludes(agentLearning, "getAgentContextPreview", "agent learning exposes deterministic context preview retrieval");
assertIncludes(agentLearning, "excludeLearningExample", "agent learning supports excluding examples from retrieval");
assertIncludes(agentLearning, "retrievalText", "agent learning builds compact retrieval text");
assertIncludes(agentLearning, "review_accepted", "agent learning models accepted review examples");
assertIncludes(agentLearning, "review_dismissed", "agent learning models dismissed review examples");
assertIncludes(agentLearning, "speaker_mapping_corrected", "agent learning models speaker correction examples");
assertIncludes(agentLearning, "memory_updated", "agent learning models memory edit examples");
assertIncludes(agentLearning, "Reviewed meaning:", "agent learning writes reviewed meaning into retrieval text");
assertIncludes(agentLearning, "Open questions:", "agent learning writes unresolved questions into retrieval text");
assertIncludes(agentLearning, "Escalation triggers:", "agent learning writes escalation triggers into retrieval text");
assertIncludes(agentLearning, "Human correction summary:", "agent learning writes human correction summaries into retrieval text");
assertIncludes(agentLearning, "Playbook hint:", "agent learning writes playbook hints into retrieval text");
assertIncludes(agentLearning, 'sourceEvent === "review_dismissed"', "dismissed learning examples are handled separately");
assertIncludes(agentLearning, '? "excluded"', "dismissed learning examples are excluded from active retrieval");
assertNotIncludes(agentLearning, "OpenAI", "agent learning does not call OpenAI directly");
assertNotIncludes(agentLearning, "embeddings", "agent learning does not create embeddings yet");
assertNotIncludes(agentLearning, "vectorIndex", "agent learning does not add vector retrieval yet");

const aiMemories = read("convex/aiMemories.ts");
const transcripts = read("convex/transcripts.ts");
const reviewSuggestions = read("convex/reviewSuggestions.ts");
assertIncludes(aiMemories, 'upsertLearningExampleForCall(ctx, memory.callId, "memory_updated")', "AI memory edits update learning examples");
assertIncludes(transcripts, 'upsertLearningExampleForCall(ctx, transcript.callId, "speaker_mapping_corrected")', "speaker mapping edits update learning examples");
assertIncludes(reviewSuggestions, 'upsertLearningExampleForCall(ctx, args.callId, "review_accepted")', "accepted reviews update learning examples");
assertIncludes(reviewSuggestions, 'upsertLearningExampleForCall(ctx, args.callId, "review_dismissed")', "dismissed reviews update learning examples");
assertIncludes(reviewSuggestions, "draftSnapshotFromSuggestion(suggestion, reviewedAt)", "review decisions preserve the AI draft snapshot");
assertIncludes(reviewSuggestions, "buildCorrectionDetails", "review decisions derive correction details server-side");
assertIncludes(reviewSuggestions, "reviewedMeaning: acceptedReviewedMeaning", "accepted reviews persist reviewed meaning");
assertIncludes(reviewSuggestions, "source: \"review_dismiss\"", "dismissed reviews mark reviewed meaning as dismissed");
for (const forbidden of ["recordingUrl", "RecordingUrl", "audioStored"]) {
  assertNotIncludes(agentLearning, forbidden, `agent learning avoids raw media field ${forbidden}`);
  assertNotIncludes(reviewSuggestions, forbidden, `review suggestions avoid raw media field ${forbidden}`);
}

const publicCustomerCopy = [
  "src/app/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
  "src/components/landing/calls-only-credit-card.tsx",
  "src/components/landing/full-landing-page.tsx",
  "src/components/landing/how-it-works-section.tsx",
  "src/components/landing/landing-dialer.tsx",
  "src/components/landing/landing-footer.tsx",
  "src/components/landing/landing-header.tsx",
  "src/components/landing/landing-hero.tsx",
  "src/components/landing/open-source-section.tsx",
  "src/components/landing/pricing-card.tsx",
  "src/components/landing/pricing-checkout-button.tsx",
  "src/components/landing/pricing-faq.tsx",
  "src/components/landing/pricing-section.tsx",
  "src/components/landing/signup-call-modal.tsx",
].map(read).join("\n");
for (const forbidden of [
  "autonomous agent",
  "autonomous-agent",
  "voice-agent",
  "voice agent",
  "voice cloning",
  "agent-first",
]) {
  assertNotIncludes(publicCustomerCopy.toLowerCase(), forbidden, `public copy avoids ${forbidden}`);
}
for (const stale of [
  "AI Phone Copilot",
  "Solo Copilot",
  "Starter Copilot",
  "Team Copilot",
  "Operations Copilot",
  "text-only Live Translation",
]) {
  assertNotIncludes(publicCustomerCopy, stale, `public copy avoids stale identity ${stale}`);
}
// Marketing-slop vocabulary guard: these words read as generic AI hype and are
// banned from customer-facing copy (AGENTS.md "Product And Copy Rules").
for (const banned of [
  "streamline",
  "seamless",
  "empower",
  "unlock",
  "revolutioni",
  "cutting-edge",
  "best-in-class",
  "world-class",
  "leverage",
  "supercharge",
  "game-chang",
]) {
  assertNotIncludes(publicCustomerCopy.toLowerCase(), banned, `public copy avoids banned word ${banned}`);
}
// Voice Translation is two-way spoken translation; "text-only" is a prohibited
// claim anywhere in the landing components.
const landingComponentCopy = [
  "src/components/landing/full-landing-page.tsx",
  "src/components/landing/how-it-works-section.tsx",
  "src/components/landing/landing-dialer.tsx",
  "src/components/landing/landing-footer.tsx",
  "src/components/landing/landing-header.tsx",
  "src/components/landing/landing-hero.tsx",
  "src/components/landing/mcp-section.tsx",
  "src/components/landing/open-source-section.tsx",
  "src/components/landing/pricing-faq.tsx",
  "src/components/landing/pricing-section.tsx",
  "src/components/landing/signup-call-modal.tsx",
].map(read).join("\n");
assertNotIncludes(landingComponentCopy, "Text-only", "landing copy avoids Text-only claim");
assertNotIncludes(landingComponentCopy, "text-only", "landing copy avoids text-only claim");

const callMemorySearch = read("convex/callMemorySearch.ts");
const callMemorySearchActions = read("convex/callMemorySearchActions.ts");
for (const expected of [
  "searchCallRecords",
  "withSearchIndex(\"search_body\"",
  "refreshCallMemorySearchDocsForCall",
  "getCurrentWorkspaceForSearchAction",
  "requireWorkspace(ctx)",
  "processingStatus: v.optional(v.string())",
  "embeddingStatus: \"pending\"",
  "internal.callMemorySearchActions.embedPendingCallMemoryDocs",
]) {
  assertIncludes(callMemorySearch, expected, `call memory search ${expected}`);
}
for (const expected of [
  "askCallRecords",
  "backfillCurrentWorkspaceCallMemorySearch",
  "openai.embeddings.create",
  "openai.responses.create",
  "ctx.vectorSearch(\"callMemoryEmbeddings\", \"by_embedding\"",
  "Use only the provided evidence",
  "Cite every factual claim",
]) {
  assertIncludes(callMemorySearchActions, expected, `call memory Ask action ${expected}`);
}
assertNotIncludes(callMemorySearch, "workspaceId: v.id(\"workspaces\")", "Call Records search APIs do not accept client workspaceId");
assertNotIncludes(callMemorySearchActions, "workspaceId: v.id(\"workspaces\")", "Call Records Ask APIs do not accept client workspaceId");
for (const forbidden of ["posthog", "datafast", "captureProductEvent", "recordingUrl", "RecordingUrl"]) {
  assertNotIncludes(callMemorySearch, forbidden, `call memory search avoids ${forbidden}`);
  assertNotIncludes(callMemorySearchActions, forbidden, `call memory Ask action avoids ${forbidden}`);
}
assertIncludes(reviewSuggestions, "refreshCallMemorySearchDocsForCall(ctx, args.callId)", "review decisions refresh searchable Call Records");
assertIncludes(aiMemories, "refreshCallMemorySearchDocsForCall(ctx, memory.callId)", "memory edits refresh searchable Call Records");
assertIncludes(transcripts, "refreshCallMemorySearchDocsForCall(ctx, transcript.callId)", "speaker edits refresh searchable Call Records");

const landingHero = read("src/components/landing/landing-hero.tsx");
assertIncludes(landingHero, "AI translation for business calls", "hero states product");
assertIncludes(landingHero, "Speak your language.", "hero promise");
assertIncludes(landingHero.replace(/<br[^>]*\/>/g, ""), "Do business in theirs.", "hero business outcome");
assertIncludes(landingHero, "privately suggests", "hero explains guidance");
assertIncludes(landingHero, "important details for you to review", "hero explains review");
assertIncludes(landingHero, "Start a translated call", "single CTA");
assertIncludes(landingHero, "The person you call needs no app.", "recipient setup");
assertIncludes(landingHero, "publicTranslatedTrialEnabled()", "conditional trial offer");
assertIncludes(landingHero, "href=\"/login?redirect=/app/dialer\"", "auth handoff");
assertIncludes(landingHero, "LandingDialer", "compact interactive dialer");
assertNotIncludes(landingHero, "Voxandra turns important browser calls", "landing hero avoids old output-list subheading");
// Open source is a trust signal next to the hosted product, not a replacement
// for it: badge in the hero, link in the nav and footer, one section, FAQ.
assertIncludes(landingHero, "OPEN_SOURCE_REPO_URL", "hero badge links to the public repo");
assertIncludes(read("src/components/landing/landing-header.tsx"), "OPEN_SOURCE_REPO_URL", "nav links to the public repo");
const landingFooterSource = read("src/components/landing/landing-footer.tsx");
for (const expected of ["OPEN_SOURCE_REPO_URL", "OPEN_SOURCE_LICENSE_URL", "OPEN_SOURCE_CONTRIBUTING_URL"]) {
  assertIncludes(landingFooterSource, expected, `footer links ${expected}`);
}
const openSourceSection = read("src/components/landing/open-source-section.tsx");
assertIncludes(openSourceSection, "OPEN_SOURCE_README_URL", "open-source section points self-hosting at the README");
assertIncludes(openSourceSection, "Self-host it", "open-source section has the secondary self-host action");
assertIncludes(openSourceSection, "hosted version at voxandra.com", "open-source section keeps the hosted product first");
assertIncludes(read("src/components/landing/full-landing-page.tsx"), "<OpenSourceSection />", "landing renders the open-source section");
assertIncludes(read("src/lib/open-source.ts"), "https://github.com/areia-ai/voxandra", "open-source links point at areia-ai/voxandra");
assertNotIncludes(landingHero, "Free 90-second trial call", "landing hero proof row avoids duration");
assertNotIncludes(landingHero, "90 enabled destinations", "landing hero proof row avoids excess destination proof");
assertNotIncludes(landingHero, "AI Phone Copilot ready for review", "landing hero proof row avoids redundant product proof");
assertNotIncludes(landingHero, "Work threads", "landing hero proof row avoids less immediate thread proof");
assertNotIncludes(landingHero, "AI Phone Copilot for teams that work by", "landing hero avoids old long H1");
assertNotIncludes(landingHero, "Voxandra AI turns", "landing hero avoids old subheading opener");
assertNotIncludes(landingHero, "AI Call Memory", "landing hero avoids old AI Call Memory term");
assertNotIncludes(landingHero, "Live Copilot", "landing hero avoids old Live Copilot term");

const landingHeader = read("src/components/landing/landing-header.tsx");
assertIncludes(landingHeader, 'href="#pricing"', "landing header pricing anchor");
assertIncludes(landingHeader, 'href="#faq"', "landing header FAQ anchor");
assertIncludes(landingHeader, "Start a translated call", "landing header uses the single primary CTA");

const homePage = read("src/app/page.tsx");
assertIncludes(homePage, "FullLandingPage", "home page can render canonical full landing");
assertNotIncludes(homePage, "VOXANDRA_HOMEPAGE_MODE", "home page no longer uses retired homepage mode flag");
assertNotIncludes(homePage, "PrelaunchHomePage", "home page cannot render retired prelaunch page");

const rootLayout = read("src/app/layout.tsx");
assertNotIncludes(rootLayout, "datafa.st", "root layout loads no DataFast script");
assertNotIncludes(read("src/proxy.ts").toLowerCase(), "datafast", "proxy has no DataFast crawler tracking");

const fullLandingPage = read("src/components/landing/full-landing-page.tsx");
assertIncludes(fullLandingPage, "Be understood", "landing names the dead-call problem");
assertIncludes(fullLandingPage, "Freight forwarding", "landing industries cover moving goods");
assertIncludes(fullLandingPage, "Import, export", "landing industries cover sourcing");
assertIncludes(fullLandingPage, "International sales", "landing industries cover moving deals");
assertIncludes(fullLandingPage, "Your next business call,", "landing final CTA repeats the H1");
assertIncludes(fullLandingPage, "Start a translated call", "landing final CTA starts with translated calling");
assertIncludes(fullLandingPage, "Nothing for them to install", "landing final CTA covers recipient setup");
assertIncludes(fullLandingPage, "reviewed Call Record", "landing keeps the canonical reviewed record claim");
assertIncludes(fullLandingPage, 'href="/login?redirect=/app/dialer"', "landing final CTA signs up into dialer");
assertNotIncludes(fullLandingPage, "Free 90-second call", "landing final CTA avoids duration chip");
assertNotIncludes(fullLandingPage, "Start with one free 90-second browser call", "landing final CTA avoids duration body");
assertNotIncludes(fullLandingPage, "90 enabled destinations", "landing final CTA removes destination chip");
assertNotIncludes(fullLandingPage, "Live Guidance on Team+", "landing final CTA removes realtime chip noise");
assertNotIncludes(fullLandingPage, "After the trial, browser-call rates vary", "landing final CTA removes secondary rate paragraph");
// The MCP developer block moved after Pricing/FAQ so it no longer interrupts
// the buyer story between How it works and Industries.
if (
  fullLandingPage.indexOf("<McpSection") === -1 ||
  fullLandingPage.indexOf("<PricingSection") === -1 ||
  fullLandingPage.indexOf("<McpSection") < fullLandingPage.indexOf("<PricingSection")
) {
  throw new Error("full landing page: <McpSection /> must render after <PricingSection />");
}
assertIncludes(fullLandingPage, "LandingFooter", "landing page includes public footer");
assertNotIncludes(fullLandingPage, "gpt-realtime", "landing page hides raw realtime model names");
assertNotIncludes(fullLandingPage, "AI Call Memory", "landing page avoids old AI Call Memory term");

assertPathMissing("src/components/landing/prelaunch-home-page.tsx", "retired prelaunch homepage component is removed");
assertPathMissing("src/components/landing/prelaunch-hero.tsx", "retired prelaunch hero component is removed");
assertPathMissing("src/components/landing/prelaunch-interest-form.tsx", "retired launch-interest form component is removed");

const analyticsLib = read("src/lib/analytics.ts");
assertNotIncludes(analyticsLib, "datafast", "analytics lib has no DataFast integration");
assertNotIncludes(analyticsLib, "launch_interest_signup", "analytics lib removes retired mailing-list goal");
assertNotIncludes(analyticsLib, "email:", "analytics helpers do not define email goal parameters");

const landingFooter = read("src/components/landing/landing-footer.tsx");
for (const expected of [
  'href: "/privacy"',
  'href: "/terms"',
  'href: "/acceptable-use"',
  'tagline="Multilingual business calls"',
  "Live Voice Translation, private guidance, and reviewed Call Records.",
  "contact@voxandra.com",
  "Made by Areia Labs",
  "https://areialabs.org/",
  'rel="noreferrer"',
]) {
  assertIncludes(landingFooter, expected, `landing footer ${expected}`);
}

const policyPageShell = read("src/components/policies/policy-page.tsx");
assertIncludes(policyPageShell, 'POLICY_UPDATED_DATE = "August 23, 2026"', "policy update date");
assertIncludes(policyPageShell, 'POLICY_CONTACT_EMAIL = "contact@voxandra.com"', "policy contact email");
assertIncludes(policyPageShell, "Back to home", "policy pages link back home");

const privacyPolicy = read("src/app/privacy/page.tsx");
for (const expected of [
  "Areia Labs",
  "contact@voxandra.com",
  "Voxandra does not sell personal information",
  "does not share personal information for cross-context behavioral advertising",
  "Raw audio is not retained by default",
  "recording, transcribing, or processing a call",
  "Product analytics, technical, and security information",
  "product analytics tools",
]) {
  assertIncludes(privacyPolicy, expected, `privacy policy ${expected}`);
}

const termsPolicy = read("src/app/terms/page.tsx");
for (const expected of [
  "Areia Labs",
  "browser calls",
  "calling credits",
  "emergency calling",
  "AI-generated notes",
  "human review",
  "laws of Portugal",
]) {
  assertIncludes(termsPolicy, expected, `terms policy ${expected}`);
}

const acceptableUsePolicy = read("src/app/acceptable-use/page.tsx");
for (const expected of [
  "Areia Labs",
  "contact@voxandra.com",
  "spam",
  "robocalls",
  "without required notices",
  "emergency calls",
  "billing",
  "route controls",
]) {
  assertIncludes(acceptableUsePolicy, expected, `acceptable use policy ${expected}`);
}

assertIncludes(callingRates, "RETAIL_RATE_CENTS_PER_MINUTE", "shared calling rates define retail route prices");
assertIncludes(callingRates, "DEFAULT_RETAIL_RATE_CENTS_PER_MINUTE", "shared calling rates preserve fallback route price");
// 20c -> 52c on 2026-07-31 when the card became derived output: Lithuania's
// landline costs 25.4c/min, whose 2x floor is 52c, so the published 20c was below
// the margin floor the quote engine was already charging.
assertIncludes(callingRates, "LT: 52", "shared calling rates publish Lithuania's landline baseline");
assertIncludes(callingRates, "RETAIL_RATE_MAX_CENTS_PER_MINUTE", "shared calling rates publish the priciest quotable route per country");
assertIncludes(callingRates, "LT: 120", "shared calling rates publish Lithuania's mobile ceiling");
// The card covers every country the catalog prices, so no dialable destination
// falls back to the flat default. It used to cover 39 of 90, leaving 51 that
// advertised 35c — 32 of them below what was actually charged.
assertIncludes(callingRates, "RS: 121", "shared calling rates price Serbia instead of falling back to the default");
assertIncludes(callingRates, "RO: 6", "shared calling rates price Romania at its real cheap rate");
assertIncludes(callingRates, "UNAVAILABLE_DESTINATION_COUNTRIES", "shared calling rates mark wholly unquotable destinations");
assertIncludes(callingRates, "isDestinationCountryUnavailable", "shared calling rates expose an unavailable-destination check");
assertIncludes(landingDialer, "not available for calling", "hero dialer shows unavailable destinations without a price");
// Per-number pricing since 2026-07-31: the exact route is resolved from the typed
// digits, so a Portuguese mobile shows $1.00/min where its landline shows $0.06,
// and a refused range (UK +449 premium) says so instead of quoting the country.
assertIncludes(landingDialer, "loadRatePrefixTable", "hero dialer lazy-loads the selected country's prefix table");
assertIncludes(landingDialer, "resolveRateForDigits", "hero dialer resolves the typed number to its billing route");
assertIncludes(landingDialer, "this number range is not available", "hero dialer distinguishes a refused range from an unavailable country");
const ratePrefixLookup = read("src/lib/rate-prefix-lookup.ts");
assertIncludes(ratePrefixLookup, "status: \"ambiguous\"", "rate resolution reports when more than one price is still reachable");
assertIncludes(ratePrefixLookup, "entry.prefix.startsWith(digits)", "rate resolution considers routes still reachable as digits are typed");
assertIncludes(callPricing, "resolveDestinationRateDetail", "authenticated quotes expose the resolved tier and settledness");
// Read locally: the shared `dialer` binding is declared further down this file.
const dialerRateSource = read("src/components/dialer/dialer-mock.tsx");
assertIncludes(dialerRateSource, "rateEstimate.rateTier", "in-app dialer names the resolved tier");
assertIncludes(dialerRateSource, "rateSettled", "in-app dialer marks a price that can still change");
assertIncludes(read("convex/twilioCalls.ts"), "resolveDestinationRateDetail", "rate estimate query resolves the typed number's tier server-side");
assertIncludes(callingRates, "getDialerRoutePricing", "shared calling rates expose country-code route pricing");

const dialer = read("src/components/dialer/dialer-mock.tsx");
const callProvider = read("src/components/providers/call-provider.tsx");
const reviewWorkspace = read("src/components/memory/review-workspace.tsx");
const liveTranslationLanguages = read("src/lib/live-translation-languages.ts");
assertIncludes(dialer, "api.twilioCalls.getFreeCallStatus", "dialer reads free-call status");
assertIncludes(dialer, "isFreeCall: startAsFreeCall ? true : undefined", "dialer opts into free-call path only when eligible");
assertIncludes(dialer, "Trial time left", "dialer shows session-cap countdown");
assertIncludes(dialer, "currentCallMaxSeconds", "dialer stores actual call cap from session");
assertIncludes(dialer, "used when the provider call starts", "dialer explains free trial claim timing");
assertNotIncludes(dialer, "90-second trial call", "dialer avoids hard-coded free trial duration");
assertIncludes(dialer, "no credits charged", "dialer shows free trial credit copy");
assertIncludes(callProvider, "free_call_trial_started", "call provider captures safe free-trial analytics");
assertIncludes(dialer, "initialContactId", "dialer accepts initial contact id");
assertIncludes(dialer, "Save contact", "dialer save contact affordance");
assertIncludes(dialer, "ContactRound", "dialer contact picker affordance");
assertIncludes(dialer, "estimateDestinationRate", "dialer shows pre-call destination rates");
assertIncludes(dialer, "getDialerRoutePricing", "dialer shows immediate country route pricing");
assertIncludes(dialer, "from calling credits", "dialer separates base call pricing from realtime metering");
assertIncludes(dialer, "60-second minimum", "dialer explains paid call minimum charge");
assertIncludes(dialer, "started-minute billing", "dialer explains paid call rounding");
assertIncludes(dialer, "routeQuoteBlocksCall", "dialer blocks unavailable quoted routes");
assertIncludes(dialer, "Calls-only keeps basic call history", "dialer avoids transcript promise for calls-only");
assertIncludes(callProvider, "attemptAutoTopUpBeforeCall", "call provider attempts auto top-up before low-credit calls");
assertIncludes(callProvider, "force: true", "call provider forces one auto top-up retry after reservation failure");
assertIncludes(
  callProvider,
  "Set the transitional state before disconnecting",
  "call provider prevents disconnect completion from being overwritten"
);
assertIncludes(
  callProvider,
  "TERMINAL_CALL_STATUSES.has(activeServerCall.status)",
  "call provider reconciles stale processing state from the server"
);
assertNotIncludes(
  reviewWorkspace,
  "fixed inset-x-0",
  "review actions do not cover the app shell or sidebar"
);
assertIncludes(
  reviewWorkspace,
  "flex flex-col-reverse gap-2 sm:flex-row",
  "review actions stay responsive in the record flow"
);
assertIncludes(
  reviewWorkspace,
  "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4",
  "review decision bar stays reachable while scrolling and clears the mobile tab bar"
);
assertIncludes(reviewWorkspace, 'id="follow-ups"', "review workspace exposes follow-ups anchor for the section nav");
assertIncludes(reviewWorkspace, "Accept & save record", "review workspace primary accept action");
assertIncludes(reviewWorkspace, "Discard this draft?", "review workspace confirms before discarding");
assertIncludes(dialer, "getPreCallBrief", "dialer uses pre-call brief");
assertIncludes(dialer, "workflowTemplates", "dialer exposes workflow templates");
assertIncludes(dialer, "Call prep", "dialer groups optional prep controls");
assertIncludes(dialer, "Call type", "dialer customer-friendly workflow label");
assertIncludes(dialer, "What do you need from this call?", "dialer customer-friendly objective label");
assertIncludes(dialer, "enableLiveCopilot", "dialer gates Live Guidance");
assertIncludes(dialer, "Live Guidance options", "dialer uses Live Guidance prep label");
assertIncludes(dialer, "Voice Translation", "dialer exposes spoken Voice Translation");
assertIncludes(dialer, "Both live features are included monthly on your plan", "dialer live feature inclusion copy");
assertIncludes(dialer, "Private prompts while you talk", "dialer describes Live Guidance as private prompts");
assertIncludes(dialer, "The other person will not hear AI guidance", "dialer clarifies other person cannot hear Live Guidance");
assertIncludes(dialer, "included on every paid plan, starting with Solo", "dialer off-state points at the entry plan");
assertNotIncludes(dialer, 'billingMode === "trial"', "dialer no longer branches on lifetime trials");
assertIncludes(dialer, '"You speak"', "dialer labels the explicit operator language");
assertIncludes(dialer, '"They speak"', "dialer labels the explicit recipient language");
assertIncludes(dialer, "Your translated voice", "dialer exposes translated voice selection");
assertIncludes(dialer, "listRealtimeSessionsForCall", "dialer subscribes to Live Translation runtime status");
assertIncludes(dialer, "Live Translation became unavailable for this call", "dialer surfaces Live Translation failures in-call");
assertIncludes(dialer, "translationSpeakerLabel", "dialer labels each Live Translation line with the speaker");
assertIncludes(dialer, "renderedSegments.map", "dialer renders Live Translation utterances as separate lines");
assertIncludes(dialer, "authoritative: segment.isFinal && segment.sourceText.trim().length > 0", "dialer treats source-less finals as unverified instead of authoritative");
assertIncludes(dialer, "Low confidence", "dialer flags low-confidence captions");
assertIncludes(dialer, "Translation delayed", "dialer surfaces a delayed state for stalled captions");
assertIncludes(dialer, "TRANSLATION_DELAYED_AFTER_MS", "dialer times the delayed caption state");
assertIncludes(dialer, "liveTranslationDirectionLabel", "dialer shows selected Live Translation direction");
assertIncludes(dialer, "translatedCaptionsSourceLanguage", "dialer passes Live Translation source language");
assertIncludes(dialer, "translatedCaptionsTargetLanguage", "dialer passes Live Translation target language");
assertIncludes(callProvider, "translatedCaptionsSourceLanguage", "call provider forwards Live Translation source language");
assertIncludes(callProvider, "translatedCaptionsTargetLanguage", "call provider forwards Live Translation target language");
assertIncludes(liveTranslationLanguages, "LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE", "Live Translation helper keeps source auto-detect explicit");
assertIncludes(liveTranslationLanguages, "DEFAULT_LIVE_TRANSLATION_TARGET_LANGUAGE", "Live Translation helper defines default target language");
assertIncludes(liveTranslationLanguages, "LIVE_TRANSLATION_TARGET_LANGUAGES", "Live Translation helper restricts provider-supported target languages");
assertIncludes(read("scripts/translation-language-catalog.mjs"), "Korean", "shared catalog includes Korean");
assertIncludes(read("scripts/translation-language-catalog.mjs"), "English", "shared catalog includes English");
assertIncludes(liveTranslationLanguages, "Detect language is only available for the other person's language", "Live Translation helper blocks auto-detect as target");
assertNotIncludes(callProvider, "hasTranslatedCaptionsSourceLanguage", "call provider does not add selected language values to analytics");
assertNotIncludes(callProvider, "hasTranslatedCaptionsTargetLanguage", "call provider does not add selected language values to analytics");
assertNotIncludes(dialer, "Live AI", "dialer uses Live Guidance instead of Live AI");
assertIncludes(dialer, "Browser calls use Voxandra calling credits", "dialer uses customer-facing calling credit copy");
assertNotIncludes(dialer, "Real Twilio call", "dialer avoids internal provider call label");
assertNotIncludes(dialer, "Real calls may incur Twilio charges", "dialer avoids provider charge copy");

const workflowTemplates = read("src/lib/workflow-templates.ts");
for (const expected of [
  "general_follow_up",
  "supplier_payment",
  "support_escalation",
  "claim_status",
  "logistics_delivery",
  "appointment_intake",
]) {
  assertIncludes(workflowTemplates, expected, `workflow template ${expected}`);
}

const realtimeEntitlements = read("src/lib/realtime-entitlements.ts");
assertIncludes(realtimeEntitlements, "SOLO_LIVE_COPILOT_INCLUDED_SECONDS = 30 * 60", "solo live guidance allowance");
assertIncludes(realtimeEntitlements, "SOLO_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 10 * 60", "solo caption allowance");
assertIncludes(realtimeEntitlements, "STARTER_LIVE_COPILOT_INCLUDED_SECONDS = 60 * 60", "starter live guidance allowance");
assertIncludes(realtimeEntitlements, "STARTER_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 20 * 60", "starter caption allowance");
// 250 -> 180 on 2026-07-31: Team was the only plan failing its own marginal
// floor (+$100 price bought +$52.97 cost = 1.89x against a 2x minimum),
// because 250 included Live Guidance minutes is $47.50 of vendor cost given
// away. At 180 the step is 2.41x with no price change.
assertIncludes(realtimeEntitlements, "TEAM_LIVE_COPILOT_INCLUDED_SECONDS = 180 * 60", "team live guidance allowance");
assertIncludes(realtimeEntitlements, "TEAM_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 50 * 60", "team caption allowance");
assertIncludes(realtimeEntitlements, "OPERATIONS_LIVE_COPILOT_INCLUDED_SECONDS = 500 * 60", "operations live guidance allowance");
assertIncludes(realtimeEntitlements, "OPERATIONS_TRANSLATED_CAPTIONS_INCLUDED_SECONDS = 200 * 60", "operations caption allowance");
assertIncludes(realtimeEntitlements, "TRANSLATED_CAPTIONS_OVERAGE_CENTS_PER_MINUTE = 10", "caption overage rate");
// Both live features are included on all four paid plans with metered overage,
// and only EMPTY_ENTITLEMENT (no plan / calls-only) may disable them. These
// counts fail loudly if a plan is ever re-gated instead of re-sized.
assertOccurrences(realtimeEntitlements, "liveCopilotEnabled: true", 4, "live guidance enabled on every paid plan");
assertOccurrences(realtimeEntitlements, "translatedCaptionsEnabled: true", 4, "live translation enabled on every paid plan");
assertOccurrences(realtimeEntitlements, "liveCopilotOverageEnabled: true", 4, "live guidance overage on every paid plan");
assertOccurrences(realtimeEntitlements, "translatedCaptionsOverageEnabled: true", 4, "live translation overage on every paid plan");
assertOccurrences(realtimeEntitlements, "liveCopilotEnabled: false", 1, "only the empty entitlement disables live guidance");
assertOccurrences(realtimeEntitlements, "translatedCaptionsEnabled: false", 1, "only the empty entitlement disables live translation");
assertOccurrences(realtimeEntitlements, "liveCopilotTrialSeconds: 0", 5, "no plan grants lifetime live guidance trial seconds");
assertIncludes(realtimeEntitlements, "REALTIME_MINIMUM_MARGIN_MULTIPLE = 2", "realtime overage has minimum margin guard");
// Live Guidance overage is TIERED since 2026-07-31. A flat rate on every plan
// made the ladder arithmetically dominated by its cheapest rung: out-of-pocket
// was `price + 0.40 x minutes` everywhere, so Team never became cheaper than
// Starter at any volume and only seats justified an upgrade. Tiering creates a
// real crossover (327 Live Guidance min/mo, from
// (14900-4900+65*60-50*180)/(65-50)) because a rate cannot be topped up
// past. 40c survives only as the EMPTY_ENTITLEMENT default.
assertIncludes(realtimeEntitlements, "SOLO_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 70", "solo live guidance overage rate");
assertIncludes(realtimeEntitlements, "STARTER_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 65", "starter live guidance overage rate");
assertIncludes(realtimeEntitlements, "TEAM_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 50", "team live guidance overage rate");
assertIncludes(realtimeEntitlements, "OPERATIONS_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 45", "operations live guidance overage rate");
assertIncludes(realtimeEntitlements, "LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE = 40", "live guidance overage default for unplanned workspaces");
// Live Audio Translation is metered as its own feature because the two-leg
// bridge runs one Palabra session PER DIRECTION. Billing it on the captions
// meter would price an 8c/min feature at 10c while the margin assert checked
// it against the 4c captions cost — a false pass on every bridged minute.
// 8c is AI-only (two 4c Palabra sessions) — real second-leg telephony cost
// is tracked separately, internal-only, via computeBridgeInternalCostCents
// (bridge-GA Phase 1b, 2026-08-13), never folded into this meter.
assertIncludes(realtimeEntitlements, "TRANSLATED_AUDIO_ESTIMATED_COST_CENTS_PER_MINUTE = 8", "live audio translation AI-only cost basis");
assertOccurrences(realtimeEntitlements, "translatedAudioEnabled: true", 4, "live audio translation metered on every paid plan");
assertOccurrences(realtimeEntitlements, "translatedAudioEnabled: false", 1, "only the empty entitlement disables live audio translation");
assertIncludes(read("convex/schema.ts"), 'v.literal("translated_audio")', "usage events accept the live audio translation feature");
assertIncludes(read("convex/realtimeBilling.ts"), "ALLOWED_SESSION_MODES_BY_FEATURE", "session mode is matched to feature by an explicit map");
assertIncludes(read("convex/twilioCalls.ts"), 'enableBridgeMode ? "translated_audio" : "translated_captions"', "bridged calls are gated on the audio translation meter");

// Bridge-GA Phase 1a/1b (2026-08-13): bridge calls must be distinguishable
// from ordinary calls at the callMode level, and the browser (parent) leg's
// own duration/cost must no longer be silently discarded — both gaps that
// contributed to the 2026-07-30 incident (see LOG.md).
assertIncludes(read("convex/twilioCalls.ts"), 'callMode: enableBridgeMode ? "human_twilio_bridge" : "human_twilio"', "bridge calls get their own callMode instead of masquerading as an ordinary call");
assertIncludes(read("convex/schema.ts"), 'v.literal("human_twilio_bridge")', "callMode is a validated union including the bridge value");
const twilioProviderSrc = read("convex/twilioProvider.ts");
assertIncludes(twilioProviderSrc, "OUTBOUND_BROWSER_CALL_MODES.has(call.callMode)", "session-auth gates accept both ordinary and bridge outbound call modes");
assertIncludes(twilioProviderSrc, "bridgeParentDurationSeconds: args.durationSeconds ?? 0", "the bridge parent leg's own duration is captured before its early return");
assertIncludes(twilioProviderSrc, "computeBridgeInternalCostCents", "bridge calls compute an internal-only real telephony cost estimate");
assertIncludes(read("src/lib/call-pricing.ts"), "export function computeBridgeInternalCostCents", "the internal bridge cost calculation is a reusable, testable function");

// Plan-level margin floor. Since 2026-07-29 the per-minute rate covers telephony
// only, so AI capture is funded by the subscription instead - which moved a cost
// line out from under the per-minute floor. This is what covers it: each plan's
// price must clear PLAN_MINIMUM_MARGIN_MULTIPLE against its own worst case, being
// every included credit spent on the cheapest destination with AI capture on plus
// every included realtime minute. Included minutes are free to the customer, so
// they earn nothing and the plan price alone has to carry them.
//
// Live Guidance was modelled at 6.4c and measured at 18.5c, so this reads the real
// constants out of the real files rather than trusting any number twice.
{
  const num = (src, name, label) => {
    const m = src.match(new RegExp(`${name}\\s*[=:]\\s*([\\d.]+)`));
    if (!m) throw new Error(`plan margin guard: cannot read ${name} from ${label}`);
    return Number(m[1]);
  };
  const callPricing = read("src/lib/call-pricing.ts");
  const catalog = read("src/lib/twilio-rate-catalog.ts");
  const callingRates = read("src/lib/calling-rates.ts");
  const billingConfigSrc = read("src/lib/billing/config.ts");

  const planFloor = num(callPricing, "PLAN_MINIMUM_MARGIN_MULTIPLE", "call-pricing");
  const capture =
    num(catalog, "TWILIO_RECORDING_COST_CENTS_PER_MINUTE", "catalog") +
    num(catalog, "OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE", "catalog") +
    num(catalog, "AI_EXTRACTION_ALLOWANCE_CENTS_PER_MINUTE", "catalog");
  const lgCost = num(realtimeEntitlements, "LIVE_COPILOT_ESTIMATED_COST_CENTS_PER_MINUTE", "entitlements");
  const ltCost = num(realtimeEntitlements, "TRANSLATED_CAPTIONS_ESTIMATED_COST_CENTS_PER_MINUTE", "entitlements");
  // Live Audio Translation joined the included pools on 2026-07-31. Omitting it here
  // would under-report every plan's worst case (by 45c on solo up to $10.80 on
  // operations) and, worse, would let a future increase to those pools slip past the
  // only plan-level floor that actually executes.
  const taCost = num(realtimeEntitlements, "TRANSLATED_AUDIO_ESTIMATED_COST_CENTS_PER_MINUTE", "entitlements");

  const usRate = Number((callingRates.match(/"US\/CA":\s*(\d+)/) || [])[1]);
  if (!usRate) throw new Error("plan margin guard: cannot read the US/CA retail rate");

  const minutesOf = (name) => {
    const m = realtimeEntitlements.match(new RegExp(`${name}\\s*=\\s*(\\d+)\\s*\\*\\s*60`));
    if (!m) throw new Error(`plan margin guard: cannot read ${name}`);
    return Number(m[1]);
  };

  const plans = [
    ["solo", "SOLO_LIVE_COPILOT_INCLUDED_SECONDS", "SOLO_TRANSLATED_CAPTIONS_INCLUDED_SECONDS", "SOLO_TRANSLATED_AUDIO_INCLUDED_SECONDS"],
    ["starter", "STARTER_LIVE_COPILOT_INCLUDED_SECONDS", "STARTER_TRANSLATED_CAPTIONS_INCLUDED_SECONDS", "STARTER_TRANSLATED_AUDIO_INCLUDED_SECONDS"],
    ["team", "TEAM_LIVE_COPILOT_INCLUDED_SECONDS", "TEAM_TRANSLATED_CAPTIONS_INCLUDED_SECONDS", "TEAM_TRANSLATED_AUDIO_INCLUDED_SECONDS"],
    ["operations", "OPERATIONS_LIVE_COPILOT_INCLUDED_SECONDS", "OPERATIONS_TRANSLATED_CAPTIONS_INCLUDED_SECONDS", "OPERATIONS_TRANSLATED_AUDIO_INCLUDED_SECONDS"],
  ];

  for (const [id, lgConst, ltConst, taConst] of plans) {
    const block = billingConfigSrc.match(new RegExp(`${id}:\\s*\\{[\\s\\S]*?\\},`));
    if (!block) throw new Error(`plan margin guard: cannot find the ${id} plan block`);
    const price = num(block[0], "monthlyPriceCents", `${id} plan`);
    const credits = num(block[0], "includedCreditCents", `${id} plan`);

    const minutesCreditsBuy = credits / usRate;
    // credits/2, not face value: the 2x per-minute rate floor caps telephony cost at
    // half the credit allowance on every destination.
    const worstCase =
      credits / 2 +
      minutesCreditsBuy * capture +
      minutesOf(lgConst) * lgCost +
      minutesOf(ltConst) * ltCost +
      minutesOf(taConst) * taCost;

    if (price < worstCase * planFloor) {
      throw new Error(
        `plan margin guard: ${id} worst-case cost is ${worstCase.toFixed(0)} cents/month (telephony ${(credits / 2).toFixed(0)}, capture ${(minutesCreditsBuy * capture).toFixed(0)}, guidance ${(minutesOf(lgConst) * lgCost).toFixed(0)}, translation ${(minutesOf(ltConst) * ltCost).toFixed(0)}, audio translation ${(minutesOf(taConst) * taCost).toFixed(0)}) but the plan is ${price} cents, under the ${planFloor}x floor of ${Math.ceil(worstCase * planFloor)}. Raise the price, cut credits, or cut included realtime minutes.`
      );
    }
  }
}

// Seats: Starter carries 5 so a fourth teammate does not force a 3x jump to Team.
// Seats have no direct cost (all cost drivers are workspace-level), so this is a
// reach change, not a margin one.
const billingConfigSeats = read("src/lib/billing/config.ts");
assertIncludes(billingConfigSeats, "includedSeats: 5", "starter includes five seats");
// The pricing cards quote minutes only. A dollar figure beside "~42 minutes" anchors
// the reader on a small number and makes the allowance read as less than it is.
assertIncludes(billingConfigSeats, "US/Canada minutes included", "included allowance is quoted in minutes");
assertNotIncludes(billingConfigSeats, "credits)`", "pricing card allowance carries no dollar figure");
assertIncludes(billingConfigSeats, "`~${minutes.toLocaleString()} US/Canada minutes included`", "allowance keeps the ~ and the US/Canada qualifier");
// A seat ceiling must name the way past it rather than dead-ending.
const teamModule = read("convex/team.ts");
assertIncludes(teamModule, "seatLimitMessage", "seat limit error names the next plan up");
assertIncludes(teamModule, "Talk to us about Enterprise", "top plan points at Enterprise");
assertNotIncludes(
  teamModule,
  "throw new Error(`This workspace has reached its ${seatLimit}-seat plan limit.`)",
  "seat limit no longer throws the dead-end message"
);
// Blocked invites must be countable, or "should we build paid seats?" stays a guess.
const teamPanel = read("src/components/team/team-members-panel.tsx");
assertIncludes(teamPanel, 'captureProductEvent("seat_limit_reached"', "seat ceiling hits are recorded");
assertIncludes(realtimeEntitlements, "LIVE_COPILOT_ESTIMATED_COST_CENTS_PER_MINUTE = 19", "live guidance cost estimate matches the measured standard-model figure");
// Arithmetic, not string matching: every metered feature's overage must clear
// REALTIME_MINIMUM_MARGIN_MULTIPLE against its own cost estimate. Without this,
// editing a cost constant alone silently ships an overage rate that
// assertRealtimeFeatureOverageMargin throws on at call start.
{
  // ANCHORED to `export const`. Unanchored, `LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE`
  // matched inside SOLO_LIVE_COPILOT_OVERAGE_CENTS_PER_MINUTE and returned 70 — so
  // once the rates were tiered on 2026-07-31 this guard silently validated solo
  // alone and stopped checking the 40c default it is captioned as checking.
  const num = (name) => {
    const match = realtimeEntitlements.match(
      new RegExp(`^export const ${name} = (\\d+)`, "m")
    );
    if (!match) throw new Error(`realtime margin guard: cannot read ${name}`);
    return Number(match[1]);
  };
  const multiple = num("REALTIME_MINIMUM_MARGIN_MULTIPLE");
  // Every rate that can reach assertRealtimeFeatureOverageMargin, per plan and per
  // feature, plus the no-plan defaults. Checking only two of the twelve was how a
  // tiered rate could have shipped below its own floor.
  const RATES = [
    ["LIVE_COPILOT", ["SOLO_", "STARTER_", "TEAM_", "OPERATIONS_", ""]],
    ["TRANSLATED_CAPTIONS", [""]],
    ["TRANSLATED_AUDIO", ["SOLO_", "STARTER_", "TEAM_", "OPERATIONS_"]],
  ];
  let checked = 0;
  for (const [feature, prefixes] of RATES) {
    const cost = num(`${feature}_ESTIMATED_COST_CENTS_PER_MINUTE`);
    for (const prefix of prefixes) {
      const overage = num(`${prefix}${feature}_OVERAGE_CENTS_PER_MINUTE`);
      checked += 1;
      if (overage < cost * multiple) {
        throw new Error(
          `realtime margin guard: ${prefix}${feature} overage ${overage}c is below ${multiple}x its ${cost}c cost estimate (needs >= ${cost * multiple}c)`
        );
      }
    }
  }
  if (checked !== 10) {
    throw new Error(
      `realtime margin guard: expected to check 10 overage rates, checked ${checked}. Add new per-plan rates to RATES rather than leaving them unvalidated.`
    );
  }
}
assertIncludes(realtimeEntitlements, "assertRealtimeFeatureOverageMargin", "realtime entitlements expose margin assertion");
// Two regressions found by adversarial review of the 2026-07-31 tiering change,
// both pinned here because each was invisible to tsc and to every other guard.
//
// 1. assertRealtimeFeatureCanStart selected the feature's usage block with a
//    two-way ternary, so translated_audio fell through to the CAPTIONS summary.
//    The gate then checked the 10c captions rate against the 9c audio cost
//    (needing 18c) and threw — every bridged call failed to start, the exact
//    inverse of the false pass the feature literal was added to fix.
assertIncludes(read("convex/realtimeBilling.ts"), "selectFeatureSummary", "call-start gate selects the usage block by feature, not by ternary");
assertNotIncludes(read("convex/realtimeBilling.ts"), '? summary.liveCopilot', "call-start gate no longer uses a two-feature ternary");
// 2. The worker's teardown skip named only translated_captions, so a bridged call
//    whose Palabra session had already been marked failed was finished a second
//    time as "completed" with the errorCode cleared.
assertIncludes(read("scripts/realtime-media-worker-core.mjs"), "if (isTranslationFeature && this.translationSessionFinished) continue;", "worker teardown skips re-finishing any failed translation session");

const realtimeUsage = read("convex/realtimeUsage.ts");
assertIncludes(realtimeUsage, "recordRealtimeUsageFromWorker", "worker realtime usage ledger mutation");
assertIncludes(realtimeUsage, "realtimeSessionId: v.optional(v.id(\"realtimeSessions\"))", "worker realtime usage accepts realtime session id");
const realtimeMediaWorkerCore = read("scripts/realtime-media-worker-core.mjs");
assertIncludes(realtimeMediaWorkerCore, 'liveGuidanceTranscriptionModel: "gpt-live-transcribe"', "realtime worker defaults transcription to gpt-live-transcribe");
assertIncludes(realtimeMediaWorkerCore, "gpt-realtime-translate", "realtime worker defaults Live Translation to realtime translate");
assertIncludes(realtimeMediaWorkerCore, "gpt-realtime-2.1", "realtime worker defaults Live Guidance to the premium audio-native realtime model");
assertIncludes(realtimeMediaWorkerCore, 'name: "emit_guidance"', "audio-native Live Guidance exposes a structured emit tool");
assertIncludes(realtimeMediaWorkerCore, 'name: "wait_for_guidance"', "audio-native Live Guidance exposes an explicit no-op tool");
assertIncludes(realtimeMediaWorkerCore, 'output_modalities: ["text"]', "Live Guidance can never speak into the call");
assertIncludes(realtimeMediaWorkerCore, "decodeMuLawBase64ToPcm24Base64", "realtime worker converts Twilio mu-law audio");
assertIncludes(realtimeMediaWorkerCore, "OPENAI_TRANSLATION_URL", "realtime worker uses dedicated translation endpoint");
assertIncludes(realtimeMediaWorkerCore, "translationDrainMs", "realtime worker drains translation output before close");
assertIncludes(realtimeMediaWorkerCore, "recordCallUtteranceFromWorker", "realtime worker stores final guidance transcripts");
assertIncludes(realtimeMediaWorkerCore, "recordTranslationSegmentFromWorker", "realtime worker stores translation segments");
assertIncludes(realtimeMediaWorkerCore, "recordRealtimeUsageFromWorker", "realtime worker records metered usage");
assertIncludes(realtimeMediaWorkerCore, "finishRealtimeSessionFromWorker", "realtime worker closes runtime sessions");
assertIncludes(realtimeMediaWorkerCore, "audioStored: false", "realtime worker does not store translated audio");
assertIncludes(realtimeMediaWorkerCore, '!["inbound", "outbound"].includes(media.track)', "realtime worker accepts only the two explicitly labeled Twilio call tracks");
assertIncludes(realtimeMediaWorkerCore, 'if (media.track !== "outbound") return', "translation and legacy transcription still process only the other party");
assertIncludes(realtimeMediaWorkerCore, "twilio_stream_started", "realtime worker uses structured operational logs");
assertIncludes(realtimeMediaWorkerCore, "translation_caption_flushed", "realtime worker logs caption flush latency");
assertIncludes(realtimeMediaWorkerCore, "translationCaptionIntervalMs: 200", "realtime worker defaults to fast caption flushes");
assertIncludes(realtimeMediaWorkerCore, "translationSegmentIdleMs: 1600", "realtime worker creates idle-based caption boundaries");
assertIncludes(realtimeMediaWorkerCore, "transcriptionSilenceMs: 900", "realtime worker waits for a longer silence gap before splitting cascade captions");
assertIncludes(realtimeMediaWorkerCore, "transcriptionMaxUtteranceMs: 12000", "realtime worker allows longer cascade utterances before forcing a caption split");
assertIncludes(realtimeMediaWorkerCore, "updateTranslationSegmentFromWorker", "realtime worker updates partial captions in place");
assertNotIncludes(realtimeMediaWorkerCore, "segmentArgs", "realtime worker builds explicit per-mutation args so Convex validators never see extra fields");
assertIncludes(realtimeMediaWorkerCore, "translation_caption_flush_failed", "realtime worker tolerates transient caption write failures instead of failing the session");
assertIncludes(realtimeMediaWorkerCore, "currentTranslationSegmentId", "realtime worker tracks the active caption row");
assertIncludes(realtimeMediaWorkerCore, "session.input_audio_buffer.append", "realtime worker streams translation audio continuously");
assertNotIncludes(realtimeMediaWorkerCore, "session.input_audio_buffer.commit", "realtime worker avoids unsupported translation commit events");
assertIncludes(realtimeMediaWorkerCore, "buildTranslationSessionUpdate", "realtime worker builds translation session config");
assertIncludes(realtimeMediaWorkerCore, "inputTranscriptionConfigured", "realtime worker configures optional source transcripts");
assertIncludes(realtimeMediaWorkerCore, "shouldUseCascadeTranslation", "realtime worker supports a test-gated transcription-first translation pipeline");
assertIncludes(realtimeMediaWorkerCore, "?intent=transcription", "realtime worker uses the transcription-specific websocket intent");
assertIncludes(realtimeMediaWorkerCore, "translation_source_first_delta", "realtime worker measures source transcription latency");
assertIncludes(realtimeMediaWorkerCore, "cascade_translation_flushed", "realtime worker measures cascaded translation latency");
assertIncludes(realtimeMediaWorkerCore, "Do not add, infer, complete, or explain", "cascaded translation forbids invented content");
assertNotIncludes(realtimeMediaWorkerCore, "noise_reduction:", "realtime worker leaves provider noise reduction disabled for PSTN audio");
assertNotIncludes(realtimeMediaWorkerCore, "transcription: { model: transcriptionModel, language", "realtime worker never sends the unsupported transcription language parameter to the translations endpoint");
assertIncludes(realtimeMediaWorkerCore, "translationSourceCutIndex", "realtime worker cuts ahead-running source text at sentence boundaries when pairing captions");
assertNotIncludes(realtimeMediaWorkerCore, "session.instructions", "realtime worker avoids unsupported translation instructions");
assertNotIncludes(realtimeMediaWorkerCore, "session.output_transcript.completed", "realtime worker does not wait for nonexistent completed translation events");
assertIncludes(realtimeMediaWorkerCore, "translation_session_failed", "realtime worker isolates translation failures");
assertIncludes(realtimeMediaWorkerCore, 'reason: this.translationSessionFinished ? "session_failed" : "no_output"', "realtime worker skips billing failed or empty translation sessions");
assertNotIncludes(realtimeMediaWorkerCore, "console.log(transcript", "realtime worker does not log transcripts");
assertNotIncludes(realtimeMediaWorkerCore, "writeFile", "realtime worker does not write raw audio files");
assertIncludes(realtimeMediaWorkerCore, "(((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS", "realtime worker uses the canonical G.711 mu-law expansion");
assertIncludes(realtimeMediaWorkerCore, "pre_ready_audio_flushed", "realtime worker buffers pre-ready audio instead of dropping frames");
assertIncludes(realtimeMediaWorkerCore, "transcriptionNextEmitOrdinal", "realtime worker drains transcription completions in commit order");
assertIncludes(realtimeMediaWorkerCore, "consumeSourceDeltasForWindow", "realtime worker pairs source deltas with the target window by elapsed time");
assertIncludes(realtimeMediaWorkerCore, "translation_final_suppressed", "realtime worker suppresses source-less and low-confidence finals");
assertIncludes(realtimeMediaWorkerCore, "transcriptionConfidenceFromLogprobs", "realtime worker derives caption confidence from transcription logprobs");
assertIncludes(realtimeMediaWorkerCore, 'reasoning: { effort: "none" }', "cascade translation disables GPT-5.6 reasoning for latency");
assertIncludes(realtimeMediaWorkerCore, "translationRequestTimeoutMs", "cascade translation requests time out instead of stalling captions");
assertIncludes(realtimeMediaWorkerCore, "buildCascadeGlossary", "cascade context is narrowed to a names/spelling glossary");
assertIncludes(realtimeMediaWorkerCore, "WORKER_BUILD", "realtime worker exposes a source build fingerprint");
assertIncludes(realtimeMediaWorkerCore, "computeConfigFingerprint", "realtime worker exposes a configuration fingerprint");
assertIncludes(realtimeMediaWorkerCore, "live_guidance_write_failed", "realtime worker tolerates transient guidance write failures instead of failing the session");
assertIncludes(realtimeMediaWorkerCore, "live_guidance_reconnecting", "realtime worker reconnects Live Guidance on a dropped provider socket instead of failing the call's guidance");
assertIncludes(realtimeMediaWorkerCore, "isTerminalGuidanceError", "realtime worker distinguishes terminal from transient guidance provider errors");
assertIncludes(realtimeMediaWorkerCore, "call_utterance_record_failed", "realtime worker catches fire-and-forget utterance write rejections");
const realtimeMediaWorkerEntry = read("scripts/realtime-media-worker.mjs");
assertIncludes(realtimeMediaWorkerEntry, "unhandledRejection", "worker entrypoint logs stray rejections instead of crashing every active call's realtime features");
const realtimeMediaWorkerHealthcheck = read("scripts/realtime-media-worker-healthcheck.mjs");
assertIncludes(realtimeMediaWorkerHealthcheck, "/healthz", "realtime worker has Docker healthcheck helper");
const realtimeTranslationSmoke = read("scripts/smoke-realtime-translation.mjs");
assertIncludes(realtimeTranslationSmoke, "session.input_audio_buffer.append", "translation smoke uses continuous audio append events");
assertIncludes(realtimeTranslationSmoke, "session.closed", "translation smoke waits for provider drain completion");
assertNotIncludes(realtimeTranslationSmoke, "session.input_audio_buffer.commit", "translation smoke forbids turn-based commit events");
const realtimeBilling = read("convex/realtimeBilling.ts");
assertIncludes(realtimeBilling, "realtime_charge", "realtime overage creates ledger charges");
assertIncludes(realtimeBilling, "chargeStatus", "realtime usage stores charge status");
// Margin telemetry: cost must be derived from billedSeconds, because included
// minutes cost the same to serve as overage minutes but bill the customer zero.
assertIncludes(realtimeBilling, "estimatedProviderCostCents", "realtime usage records estimated provider cost");
assertIncludes(realtimeBilling, "estimatedCostCentsPerMinute", "realtime usage records the cost rate used");
assertIncludes(realtimeBilling, "(billedSeconds / 60) * estimatedCostCentsPerMinute", "realtime cost is derived from billed seconds, not overage seconds");
// These fields are internal margin data. They must never reach the read-only MCP
// surface or the customer-facing workspace export.
assertNotIncludes(read("convex/mcp.ts"), "estimatedProviderCostCents", "MCP surface never exposes realtime provider cost");
assertNotIncludes(read("convex/mcp.ts"), "realtimeUsageEvents", "MCP surface never exposes realtime usage events");
assertNotIncludes(read("convex/workspaces.ts"), "realtimeUsageEvents", "workspace export never includes realtime usage events");
// One templated message per feature since 2026-07-31, replacing two hard-coded
// strings that a third feature would have fallen through. FEATURE_LABELS supplies
// the name, so the rendered copy is unchanged for the existing two features and a
// new feature can never inherit another feature's blocked-reason text.
assertIncludes(realtimeBilling, "is included on every paid plan. Start a subscription to use it.", "realtime no-plan gate copy is templated per feature");
// "Text-only" must survive the templating: without it the captions message reads
// as promising the spoken audio bridge, which is a separately metered SKU.
assertIncludes(realtimeBilling, 'translated_captions: "Text-only Live Translation"', "captions inclusion copy stays explicit about being text-only");
assertIncludes(realtimeBilling, 'translated_audio: "Live Audio Translation"', "live audio translation has a customer-facing label");
assertIncludes(realtimeBilling, "assertRealtimeFeatureOverageMargin", "realtime billing checks overage margin before start and charge");
assertIncludes(realtimeBilling, 'withIndex("by_session"', "realtime billing checks existing usage by session");
assertIncludes(realtimeBilling, "existingRecordedEvent", "realtime billing makes session usage idempotent");
assertIncludes(realtimeBilling, "Realtime usage session mode does not match feature", "realtime billing validates session mode against feature");

const callGuidance = read("convex/callGuidance.ts");
// Two separate fields added to the live-guidance context snapshot without being
// added to the realtimeSessions validator (maxSimilarReviewedCalls and
// similarReviewedCalls, both from 143ca2e) each took Live Guidance and Live
// Translation down completely, because the snapshot write fails the whole
// session-setup mutation. The limits check below covers the object passed by
// reference; this one covers every key written as a literal.
{
  const braceBlock = (src, startRe, label) => {
    const m = src.match(startRe);
    if (!m) throw new Error(`snapshot guard: cannot find ${label}`);
    const start = src.indexOf("{", m.index);
    let depth = 0;
    for (let j = start; j < src.length; j += 1) {
      if (src[j] === "{") depth += 1;
      else if (src[j] === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(start, j + 1);
      }
    }
    throw new Error(`snapshot guard: unbalanced braces in ${label}`);
  };

  const literalKeys = (text) => {
    const keys = new Set();
    let inStr = null;
    let token = "";
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (inStr) {
        if (c === inStr && text[i - 1] !== "\\") inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "{" || c === "}" || c === "," || c === "\n") { token = ""; continue; }
      if (c === ":") {
        const key = token.trim().split(/[\s,(){}[\]]+/).pop();
        if (key && /^[A-Za-z_]\w*$/.test(key)) keys.add(key);
        token = "";
        continue;
      }
      token += c;
    }
    return keys;
  };

  const builderKeys = literalKeys(
    braceBlock(callGuidance, /const context(?::\s*\w+)?\s*=\s*\{/, "the context object in convex/callGuidance.ts")
  );
  const schemaKeys = literalKeys(
    braceBlock(
      read("convex/schema.ts"),
      /const liveGuidanceContextSnapshot = v\.object\(/,
      "the liveGuidanceContextSnapshot validator"
    )
  );

  const missing = [...builderKeys].filter((k) => !schemaKeys.has(k)).sort();
  if (missing.length > 0) {
    throw new Error(
      `live guidance snapshot: ${missing.join(", ")} written by callGuidance.ts but absent from the realtimeSessions validator - the snapshot write fails, which fails session setup, which disables Live Guidance AND Live Translation for the whole call`
    );
  }
}
// Every key in LIVE_GUIDANCE_CONTEXT_LIMITS is written wholesale into
// realtimeSessions.liveGuidanceContextSnapshot.limits, so a key missing from the
// schema validator fails the entire write and kills Live Guidance for the whole
// call at session setup. maxSimilarReviewedCalls did exactly that in production
// between 2026-07-26 and 2026-07-29. Keep the two in sync structurally, not by
// remembering to.
{
  const limitsBlock = callGuidance.match(
    /const LIVE_GUIDANCE_CONTEXT_LIMITS = \{([\s\S]*?)\}/
  );
  if (!limitsBlock) throw new Error("live guidance limits: cannot find LIVE_GUIDANCE_CONTEXT_LIMITS");
  const limitKeys = [...limitsBlock[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  if (limitKeys.length === 0) throw new Error("live guidance limits: parsed no keys");

  const schemaSource = read("convex/schema.ts");
  const schemaLimits = schemaSource.match(/limits: v\.object\(\{([\s\S]*?)\}\)/);
  if (!schemaLimits) throw new Error("live guidance limits: cannot find the schema limits validator");
  const schemaKeys = [...schemaLimits[1].matchAll(/(\w+)\s*:\s*v\./g)].map((m) => m[1]);

  for (const key of limitKeys) {
    if (!schemaKeys.includes(key)) {
      throw new Error(
        `live guidance limits: ${key} is in LIVE_GUIDANCE_CONTEXT_LIMITS but not in the realtimeSessions schema validator - this fails the session write and disables Live Guidance for the whole call`
      );
    }
  }
  for (const key of schemaKeys) {
    if (!limitKeys.includes(key)) {
      throw new Error(
        `live guidance limits: schema validator has ${key} but LIVE_GUIDANCE_CONTEXT_LIMITS does not, so it can never be written`
      );
    }
  }
}
const callPreparation = read("convex/callPreparation.ts");
assertIncludes(callGuidance, "addRealtimeGuidanceItemFromWorker", "worker realtime guidance mutation");
assertIncludes(callGuidance, "assertRealtimeGuidanceTypeMatchesSource", "worker guidance validates type/source pairs");
assertIncludes(callGuidance, "assertRealtimeGuidanceSession", "worker guidance validates realtime session access");
assertIncludes(callGuidance, "Live Guidance worker items must use copilot type", "worker guidance keeps Live Guidance item type strict");
assertIncludes(callGuidance, '"human_copilot"', "worker guidance validates Live Guidance against human_copilot sessions");
assertIncludes(callGuidance, "getLiveGuidanceContextForWorker", "worker can fetch Live Guidance context by session");
assertIncludes(callGuidance, "realtimeSessionId: v.id(\"realtimeSessions\")", "worker Live Guidance context is keyed by session");
assertIncludes(callGuidance, "assertRealtimeWorkerSecret(args.secret)", "worker Live Guidance context requires worker secret");
assertIncludes(callGuidance, '!["human_copilot", "translated_captions"].includes(session.mode)', "worker call context is limited to human-copilot and translated-caption sessions");
assertIncludes(callGuidance, "buildPreCallBrief", "worker Live Guidance context uses Prep brief context");
assertIncludes(callGuidance, "call.objective", "worker Live Guidance context includes Prep call objective");
assertIncludes(callGuidance, "preCallBrief.template.checklist", "worker Live Guidance context includes workflow checklist");
assertIncludes(callGuidance, 'source: "user"', "call checklist items are user-authored, not template boilerplate");
assertNotIncludes(callGuidance, "Confirm the call objective", "no auto-seeded boilerplate checklist items");
assertIncludes(callGuidance, "reviewedCallMemories", "worker Live Guidance context includes reviewed call memory");
assertIncludes(callGuidance, "openActionItems", "worker Live Guidance context includes open action items");
assertIncludes(callGuidance, "openReminders", "worker Live Guidance context includes reminder context");
assertIncludes(callGuidance, "keyFacts", "worker Live Guidance context includes key facts");
assertIncludes(callGuidance, "liveGuidanceContextSnapshot", "worker Live Guidance context snapshot is persisted");
assertIncludes(callPreparation, "export async function buildPreCallBrief", "Prep brief builder is shared with worker context");
assertIncludes(convexSchema, "const liveGuidanceContextSnapshot", "schema defines Live Guidance context snapshot");
assertIncludes(convexSchema, "liveGuidanceContextSnapshot: v.optional(liveGuidanceContextSnapshot)", "realtime session stores Live Guidance context snapshot");
assertIncludes(convexSchema, "liveGuidanceContextSnapshotVersion", "realtime session stores Live Guidance context snapshot version");
assertIncludes(convexSchema, "deterministicChecklist", "Live Guidance context schema includes deterministic checklist");
assertIncludes(convexSchema, "reviewedCallMemories", "Live Guidance context schema includes reviewed call memory");
assertIncludes(convexSchema, "openActionItems", "Live Guidance context schema includes open action items");
assertIncludes(convexSchema, "openReminders", "Live Guidance context schema includes reminders");
assertIncludes(convexSchema, "keyFacts", "Live Guidance context schema includes key facts");
assertNotIncludes(callGuidance, "export const addRealtimeGuidanceItem = mutation", "client-callable realtime guidance insertion stays locked down");
assertNotIncludes(dialer, "gpt-realtime", "dialer hides raw realtime model names");
assertNotIncludes(walletPage, "gpt-realtime", "wallet hides raw realtime model names");

const loginForm = read("src/app/login/login-form.tsx");
assertIncludes(loginForm, "Create your Voxandra workspace", "login uses B2B workspace copy");
assertIncludes(loginForm, "Forgot password?", "login offers password reset from sign in");
assertIncludes(loginForm, "voxandra:lastAuthProvider", "login remembers the last auth provider locally");
assertIncludes(loginForm, "Last used", "login marks the last-used Google provider");
assertIncludes(loginForm, "reset-verification", "login verifies reset code before changing password");
assertIncludes(loginForm, "email-verification", "login verifies password signup email codes");
assertIncludes(
  loginForm,
  "An account already exists for this email",
  "login explains duplicate email/password signup"
);
assertNotIncludes(loginForm, "Auth Debug", "login removes auth debug logs");
assertNotIncludes(loginForm, "first call is free!", "login avoids consumer gift headline");

const convexAuth = read("convex/auth.ts");
assertIncludes(convexAuth, "normalizePasswordEmail", "password auth normalizes email before account lookup");
assertIncludes(convexAuth, '"password-reset"', "password auth enables reset codes");
assertIncludes(convexAuth, '"password-verification"', "password auth enables email verification codes");
assertIncludes(convexAuth, "reset: authCodeEmail", "password auth wires reset email provider");
assertIncludes(convexAuth, "verify: authCodeEmail", "password auth wires verification email provider");

const appShell = read("src/components/layout/app-shell.tsx");
assertIncludes(appShell, "This is taking longer than expected", "app shell long-loading fallback");
assertIncludes(appShell, "Sign in", "app shell fallback sign-in action");
assertNotIncludes(appShell, "console.log", "app shell removes customer auth debug log");

const authClient = read("src/lib/auth.ts");
assertNotIncludes(authClient, "console.log", "profile setup removes customer debug logs");

assertIncludes(memoryPage, "Suggested speakers", "memory transcript uses customer-friendly speaker suggestion label");
assertNotIncludes(memoryPage, "AI-inferred", "memory transcript avoids internal AI-inferred label");

assertIncludes(callDetail, "ContactContextCard", "note detail contact context card");
assertIncludes(callDetail, "Contact context", "note detail contact context copy");
assertIncludes(callDetail, "Save this number", "note detail save number action");

const evals = read("docs/evals/transcript-extraction-evals.md");
assertIncludes(evals, "Eval 8: Same Thread vs New Thread", "same-thread eval coverage");
assertIncludes(evals, "Eval 9: New Thread Needed", "new-thread eval coverage");

const bridgeRecordings = read("convex/bridgeRecordings.ts");
const bridgeTranscription = read("convex/bridgeTranscription.ts");
const bridgeTranscriptionMutations = read("convex/bridgeTranscriptionMutations.ts");
const workspaceSettings = read("convex/workspaces.ts");
const translationBridge = read("convex/translationBridge.ts");
const voiceTranslationPillar = read("src/app/live-voice-translation/page.tsx");
assertIncludes(translationBridge, "REALTIME_VOICE_TRANSLATION_ENABLED", "Voice Translation has a global emergency gate");
assertIncludes(workspaceSettings, "setVoiceTranslationEnabled", "workspace owners can disable Voice Translation");
assertIncludes(bridgeRecordings, "finalizeBridgeRecordingSet", "bridge recordings finalize complete and partial sets");
assertIncludes(bridgeTranscription, "deleteBridgeRecording", "bridge transcription deletes transient recordings");
assertIncludes(bridgeTranscriptionMutations, 'bridgeRecordCompleteness: "partial"', "bridge Call Records preserve partial completeness");
assertIncludes(voiceTranslationPillar, "getPublicVoiceTranslationLanguages", "translation pillar uses the enabled language catalog");
assertIncludes(voiceTranslationPillar, "They don't install Voxandra", "translation pillar explains recipient setup");
assertIncludes(analyticsLib, "translation_landing_view", "analytics defines the translation landing event");
assertIncludes(analyticsLib, "translated_call_started", "analytics defines translated call starts");
assertIncludes(analyticsLib, "sourceLanguage", "analytics permits only coarse language codes");

console.log("multilingual and simplified workflow verification passed");
