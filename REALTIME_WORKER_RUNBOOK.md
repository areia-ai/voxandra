# Realtime Media Worker Runbook

Voxandra Live Guidance and Live Translation use a separate Node worker for long-lived Twilio and OpenAI WebSockets. The Next.js app only starts Twilio calls and passes session-scoped parameters to the worker.

## Launch Scope

- Text-only output.
- Live Guidance uses `both_tracks` on the parent browser leg; Translation-only
  calls continue to use `outbound_track`.
- Twilio Media Stream track names are relative to the leg the stream is attached to.
  On the outbound caller leg, `inbound_track` is the Voxandra user's own microphone and
  `outbound_track` is the audio played to them — the called person once `<Dial>` bridges.
  The worker supplies track-switch speaker markers to the audio-native Guidance
  session. Live Translation still drops every `inbound` frame.
- Before the call is answered, `outbound_track` can carry ringback tone; transcription
  models generally ignore tones, but spurious early captions should be triaged against this.
- No raw audio storage, playback, download, or customer-accessible audio injection.
  Three narrow, internal-only exceptions are covered below: Spoken
  Translation Phase 1 relays an allowlisted workspace's direct-pipeline
  `session.output_audio.delta` live to a separate `/browser/audio-stream` WebSocket
  (never persisted, never sent to Twilio); the Bridge Media Path Skeleton lets the
  worker echo audio straight back into a dedicated internal-only `<Connect><Stream>`
  test call that never reaches a real callee; and the separately allowlisted two-leg
  bridge injects Palabra-translated speech into two real Twilio legs for informed
  internal testers. None is generally customer-facing or reachable from an
  unallowlisted workspace.
- Post-call Twilio `<Dial>` recordings use dual channels independently of Media
  Streams. Outbound calls map the Voxandra operator to channel 1; forwarded
  inbound calls map the operator to channel 2. Convex transiently isolates that
  channel to resolve the call-record language, then follows the existing Twilio
  recording deletion lifecycle. The realtime worker does not retain either channel.
- OpenAI-first provider implementation behind the existing provider-neutral Convex tables.

## Runtime

Start locally:

```bash
npm run realtime:worker
```

Health check:

```bash
curl http://localhost:8787/healthz
```

Docker health check command:

```bash
node scripts/realtime-media-worker-healthcheck.mjs
```

Twilio media stream URL:

```text
wss://<worker-host>/twilio/media-stream
```

## Environment

Set in Vercel production:

```text
REALTIME_MEDIA_STREAM_URL=wss://<worker-host>/twilio/media-stream
REALTIME_STREAM_SIGNING_SECRET=<shared-with-worker-only>
```

Set in Convex production and in the worker:

```text
REALTIME_CONVEX_WORKER_SECRET=<shared-secret>
```

Set in the worker:

```text
OPENAI_API_KEY=<openai-key>
CONVEX_URL=<production-convex-url>
REALTIME_STREAM_SIGNING_SECRET=<same value as Vercel>
REALTIME_WORKER_TRUST_PROXY=true
REALTIME_WORKER_PORT=8787
REALTIME_WORKER_MAX_STREAMS=40
REALTIME_WORKER_MAX_PENDING_STREAMS_PER_IP=4
REALTIME_WORKER_STREAM_START_TIMEOUT_MS=5000
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-live-transcribe
OPENAI_REALTIME_TRANSLATION_MODEL=gpt-realtime-translate
OPENAI_LIVE_GUIDANCE_MODEL=gpt-realtime-2.1
REALTIME_LIVE_GUIDANCE_PIPELINE=audio_native
REALTIME_LIVE_GUIDANCE_REASONING_EFFORT=low
REALTIME_LIVE_GUIDANCE_MIN_INTERVAL_MS=1800
REALTIME_LIVE_GUIDANCE_SILENCE_MS=500
REALTIME_LIVE_GUIDANCE_MAX_TURN_MS=12000
# Cheapest GPT-5.6 text model for cascade Live Translation; upgrade to terra/sol
# if live quality review shows Luna is not enough.
OPENAI_LIVE_TRANSLATION_TEXT_MODEL=gpt-5.6-luna
OPENAI_REALTIME_TRANSCRIPTION_DELAY=low
REALTIME_TRANSLATION_PIPELINE=direct
REALTIME_TRANSLATION_CASCADE_WORKSPACE_IDS=
REALTIME_TRANSCRIPTION_SILENCE_MS=900
REALTIME_TRANSCRIPTION_MAX_UTTERANCE_MS=12000
REALTIME_TRANSCRIPTION_SPEECH_THRESHOLD=550
REALTIME_TRANSLATION_DRAIN_MS=5000
REALTIME_TRANSLATION_CAPTION_INTERVAL_MS=200
REALTIME_TRANSLATION_SEGMENT_IDLE_MS=1600
REALTIME_TRANSLATION_SEGMENT_MAX_MS=15000
REALTIME_TRANSLATION_SEGMENT_MAX_CHARS=320
REALTIME_TRANSLATION_SOURCE_LEAD_TOLERANCE_MS=1000
REALTIME_TRANSLATION_REQUEST_TIMEOUT_MS=5000
REALTIME_TRANSLATION_MIN_CONFIDENCE=0
REALTIME_PRE_READY_AUDIO_MAX_FRAMES=150
```

## Media Stream Authentication

Twilio signs its webhooks but does **not** authenticate Media Stream WebSocket
connections: nothing about a socket arriving at `/twilio/media-stream` proves it
is Twilio, and the `start` event's `customParameters` are whatever the client
chose to send. Until 2026-09-09 the worker trusted them verbatim, so any client
that reached `worker.voxandra.com` could name any `voxandraCallId`/`workspaceId`,
open provider sessions on Voxandra's keys, write captions into someone else's
live call, or hold `REALTIME_WORKER_MAX_STREAMS` sockets and silently break Live
Translation for everyone. Two independent checks now gate `handleStart`, and
`twilio_stream_rejected` is logged (reason only, never parameter content) when
either fails:

1. **Parameter signature.** Every `<Stream>` the app emits goes through
   `appendSignedStreamParameters` (`src/lib/twilio/server.ts`), which adds
   `streamSignatureExpiresAt` (10-minute TTL) and `streamSignature`, an HMAC-SHA256
   over every other parameter, keyed by `REALTIME_STREAM_SIGNING_SECRET`. The
   worker verifies it before reading a single parameter. The canonical form covers
   *all* parameters, so anything added later is signed automatically. The signer
   lives in `src/lib/realtime/stream-signature.ts` (Next.js) and is hand-mirrored
   in `scripts/realtime-media-worker-stream-auth.mjs` (the worker cannot import
   TypeScript); `scripts/test-realtime-media-worker.mjs` asserts the two agree
   byte-for-byte, so a drift fails `npm test` rather than every real call.
2. **Call-SID binding.** A valid signature proves the parameters were minted by
   our TwiML routes recently; it does not prove the socket presenting them is that
   call. So the worker asks Convex (`realtimeRuntime.validateWorkerStreamStart`,
   worker-secret guarded) whether the `callSid` Twilio itself reports in `start`
   matches the SID Convex recorded when the call was placed — `parentCallSid` for
   the browser leg, `bridgeCalleeCallSid` for a bridge callee leg — closing replay
   of a captured parameter set. Fails closed if Convex is unreachable. The
   internal echo test has no Convex call row and relies on the signature plus its
   own allowlist alone.

Connection-level rails, independent of the checks above: sockets that have not
yet authenticated are "pending" and are bounded per client address
(`REALTIME_WORKER_MAX_PENDING_STREAMS_PER_IP`, default 4) and by a start deadline
(`REALTIME_WORKER_STREAM_START_TIMEOUT_MS`, default 5 s). Twilio sends `start`
within milliseconds of connecting, so real streams are effectively never
pending; a flood of unauthenticated sockets is. Per-address accounting needs
`X-Forwarded-For` behind Caddy, which is only honored when
`REALTIME_WORKER_TRUST_PROXY=true`. `/healthz` now also reports `activeStreams`
and `maxStreams` (raised from the QA-era 10 to 40 — a bridge call uses two).

**Deploy order when introducing or rotating the signing secret: Vercel first,
then the worker.** An old worker ignores the two extra parameters, but a new
worker rejects unsigned starts, so the reverse order breaks every realtime call
until Vercel catches up. `validateWorkerConfig` refuses to start without the
secret; `REALTIME_ALLOW_UNSIGNED_STREAMS=true` is an explicit local-only escape
hatch for smoke scripts that have no TwiML route in the loop, and the worker logs
`stream_auth_disabled` at error level on every start while it is set — never set
it on a deployed worker.

Still an ops action, not code: restrict `/twilio/media-stream` at the Caddy layer
to Twilio's published Media Stream source IP ranges. The checks above make the
endpoint safe to expose; the allowlist just stops the noise from reaching Node.

## Spoken Translation Phase 1 (Internal-Only)

Prep work for OpenAI's GPT-Live-1: the audio plumbing built now against the current
`wss://api.openai.com/v1/realtime/translations` endpoint, so swapping the model later
is close to a model-constant change. See `AGENTIC_FUTURE.md`. No customer-facing UI
reads this yet — success is proven by the smoke script and the manual harness below,
not by anything in `dialer-mock.tsx`.

The direct pipeline already receives `session.output_audio.delta` (translated speech)
and has always discarded it. For a workspace on the allowlist, the worker now relays
those frames unmodified (no decode/re-encode) over a second WebSocket,
`/browser/audio-stream`, to any browser tab that presents a valid token for that call.

Set the **same** comma-separated workspace list independently on both sides — Convex
and the worker are separate processes with separate env, and both checks must agree
before any audio flows:

```text
# Convex production/dev env
REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS=<workspace-id>

# Worker env
REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS=<workspace-id>
REALTIME_WORKER_BROWSER_AUDIO_STREAM_ORIGINS=<comma-separated allowed Origin headers>
REALTIME_WORKER_MAX_BROWSER_AUDIO_STREAMS=20
```

Token minting happens inside `createOutboundSession` (`convex/twilioCalls.ts`) and is
`undefined` for every non-allowlisted workspace — the `browserAudioStreamToken` field
on that mutation's return value simply won't be present. Unlike the Twilio connect
token, this one is not single-use: it stays valid for the call's max duration so a
flaky browser tab can reconnect.

**Before trusting the browser harness's audio, confirm the real payload format once:**

```bash
OPENAI_API_KEY=<key> npm run probe:translation-audio-format -- <24khz-mono-pcm16-file> [target-language]
```

This has never been inspected in this codebase before — the worker's relay is a pure
byte passthrough and doesn't need the answer, but the harness's `AudioContext` sample
rate does. Never add new `session.update` fields to "ask" for a format; this only
observes what the endpoint already sends today (see the two 2026-07-10 outages in
`LIVE_TRANSLATION_LATENCY_PLAN.md` — protocol changes must be proven against the real
API before being trusted, not assumed).

**End-to-end proof against a real dev/canary Convex deployment:**

```bash
OPENAI_API_KEY=<key> CONVEX_URL=<dev-or-canary-convex-url> REALTIME_CONVEX_WORKER_SECRET=<secret> \
  npm run test:browser-audio-stream-smoke -- <24khz-mono-pcm16-file> <canary-workspace-id> [target-language]
```

Requires `ALLOW_BROWSER_AUDIO_STREAM_SMOKE_SEED=true` on that Convex deployment (never
set this in production) and the canary workspace on
`REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS` there. This starts the worker's real
HTTP/WS server locally, drives a synthetic Twilio leg with real speech audio, and opens
a real `/browser/audio-stream` client — proving the token mint/validate path, the call
registry, and the relay together, not just the OpenAI socket in isolation.

**Manual playback check**: open `scripts/browser-audio-stream-harness.html` directly in
a browser (or serve it locally) and paste in a worker URL, a token, and a call ID —
either from a live `createOutboundSession` call on an allowlisted workspace, or from
the smoke script's seed step. It is a throwaway page outside `src/` on purpose: it can
never be imported by real product code or regress `tsc`/`eslint`/`next build`.

Neither the probe script, the smoke script, nor `npm test` covers this automatically —
`npm test` only runs the unit-level fixture coverage in
`scripts/test-realtime-media-worker.mjs` (`shouldForwardTranslationAudio`,
`isAllowedBrowserAudioStreamOrigin`, and the forward branch in `handleTranslationEvent`
with fake sockets). Run the probe and smoke scripts manually, once, before relying on
this path for a real canary call.

## Bridge Media Path Skeleton (Internal-Only)

Prerequisite for the eventual two-leg "each side hears the other in their own
language" bridge: proof that the worker can encode, pace, and send audio back into a
real Twilio call at all — before Phase 2, the worker had only ever received Twilio
Media Stream audio, never sent any. No new call topology, no second Twilio call, no
billing/recording/post-call-pipeline changes — a full `<Connect><Stream>` two-leg
bridge needs real design work in `convex/billingHelpers.ts` (currently
one-reservation-per-call) and `convex/transcription.ts` (currently hard-requires a
Twilio recording URL as its first step) before it can exist; this phase does not
attempt either.

The mechanism: an allowlisted workspace's call, placed with `<Connect><Stream>`
(bidirectional — unlike every real customer call's `<Start><Stream>`, which is
receive-only by Twilio design) and carrying the `echoTestEnabled` custom parameter,
gets its own caller audio decoded and immediately re-encoded straight back —
`encodePcm24Base64ToMuLawBase64` in `scripts/realtime-media-worker-core.mjs`, the new
production counterpart to the existing `decodeMuLawBase64ToPcm24Base64`. No model
involved. Entirely isolated from the guidance/translation code paths.

Set the workspace allowlist independently on Convex-adjacent config and the worker,
same dual-gate discipline as Phase 1's audio-forward allowlist:

```text
# .env (worker)
REALTIME_ECHO_TEST_WORKSPACE_IDS=<workspace-id>

# .env (wherever the internal TwiML route is deployed — same Next.js app as everything else)
TWILIO_ECHO_TEST_ENABLED=true
TWILIO_ECHO_TEST_WEBHOOK_URL=<canonical URL for src/app/api/twilio/internal/echo-test/route.ts>
TWILIO_ECHO_TEST_WORKSPACE_ID=<workspace-id>
```

**Protocol-level proof, no credentials needed** (unlike every other smoke script in
this runbook — this one verifies pure worker mechanics, not a model call):

```bash
node scripts/smoke-echo-test.mjs
```

Starts the worker's real server locally, plays Twilio's role with a synthetic client,
sends real mu-law-encoded tone audio, and asserts real, correctly re-encoded `media`
frames come back with matching `streamSid`. This proves the worker's half of the
protocol contract — not that Twilio's real infrastructure accepts these frames.

**Live proof** (the only way to confirm Twilio's side): point a spare/test Twilio
number's voice webhook at `src/app/api/twilio/internal/echo-test/route.ts` (with
`TWILIO_ECHO_TEST_ENABLED=true` deployed) and call it — you should hear your own
voice echoed back with the worker's round-trip latency. This is a manual step; nothing
in this codebase can place a real phone call to verify it automatically.

Explicitly deferred, not built this phase: DTMF-in-band tone synthesis, a real jitter
buffer/pacer for asynchronously-generated (as opposed to 1:1-echoed) audio, and of
course the full two-leg bridge itself.

## Real Two-Leg Translation Bridge, Sub-Phase 5b (Real Translation, Internal-Only)

The actual two-leg bridge the previous section's skeleton was building toward: a
genuinely separate, worker-placed second Twilio call for the callee (leg B), so the
worker controls that leg's audio directly instead of relying on `<Dial>` to bridge
real audio between two legs. Sub-phase 5a proved that topology with an unmodified
browser-microphone relay. Sub-phase 5b replaces that relay with two concurrent Palabra
sessions and real translation in both directions. It remains gated independently of
the existing Live Audio Translation listen-along mode: placing a real, billed second
call is categorically riskier than privately listening in, so a bug here must never
be able to regress that already-proven mode.

Leg B is placed inline in `src/app/api/twilio/voice/route.ts` via
`getTwilioClient().calls.create()` — never proxied through a worker-initiated route —
keeping all Twilio calling credentials in the one place that already holds them. Both
legs return `<Connect><Stream>` (bidirectional). The worker's call registry became
`Map<callId, { browserLeg, calleeLeg }>` with each leg holding a `siblingLeg`
reference. Each leg sends its participant's `inbound` microphone track to its own
Palabra session:

- browser leg: the Voxandra user's selected language → the callee's expected language;
- callee leg: the callee's expected language → the Voxandra user's selected language.

Each direction also carries its own translated-voice selection. The name describes
the participant whose speech is being translated, not the listener: `callerTranslatedVoice`
travels on the browser leg (`user_to_callee`) and is heard by the called person;
`calledPersonTranslatedVoice` travels on the callee leg (`caller_to_user`) and is heard
by the Voxandra caller. `male` maps to Palabra `default_low`; `female` maps to
`default_high`. Missing fields from old calls resolve to `male` / `default_low`, matching
Palabra's documented default pipeline. `voice_cloning` stays explicitly `false` — that
flag controls Palabra auto-cloning whoever is *live* on the call in real time, with no
consent surface for that (`AGENTIC_FUTURE.md` gate) — and voice timbre detection is not
enabled.

**Cloned voice (optional, `PALABRA_CLONED_VOICE_ID`)**: a voice already created ahead of
time via Palabra's own Clone Voice API/dashboard (`app.palabra.ai/voices` — explicit
sample upload, explicit consent, the account owner's own voice) is a separate, much
lower-risk action than the auto-clone flag above — it works exactly like referencing a
built-in `voice_id`. When set, it replaces the generic `default_low` ("male" bucket) for
the browser leg only (`palabraVoiceIdForGender` in
`scripts/realtime-media-worker-core.mjs`) — never the callee leg, which translates a
different real person's actual speech and must keep using the generic built-in voice
regardless of this override. The "female" bucket is never affected either. Set only on
the worker (never read by Next.js/Convex, same as `PALABRA_API_KEY`):

```text
PALABRA_CLONED_VOICE_ID=<voice_id from Palabra's voice library>
```

`output_audio_data` arrives as PCM s16le 24 kHz mono, is converted by
`encodePcm24Base64ToMuLawBase64`, and is injected into the sibling leg with Twilio's
bidirectional Media Stream `media` message. The callee-to-user direction owns the
existing `translated_captions` realtime session and continues writing captions and
usage. The reverse browser-to-callee direction is bridge-only in 5b: it opens a real
second Palabra session but intentionally creates no second Convex session, captions,
or usage settlement yet.

Set the workspace allowlist and enablement flags, same dual-gate discipline as every
other feature in this runbook — note the worker itself needs **no new env var**: it
never checks the allowlist, it only trusts the `bridgeLeg` custom parameter it's
handed, and that parameter is only ever set once the allowlist check already passed
upstream in Convex.

```text
# Convex production/dev env
REALTIME_TRANSLATION_BRIDGE_WORKSPACE_IDS=<workspace-id>
# Optional operator ceiling; workspace limits default to 1800s (30 minutes).
TWILIO_BRIDGE_MAX_CALL_SECONDS=<seconds>

# .env (wherever the internal TwiML route is deployed — same Next.js app as everything else)
TWILIO_BRIDGE_MODE_ENABLED=true
TWILIO_BRIDGE_LEG_WEBHOOK_URL=<canonical URL for src/app/api/twilio/internal/bridge/leg-twiml/route.ts>

# Worker env (optional; defaults to 3600s, never raises the per-call limit)
REALTIME_BRIDGE_MAX_SESSION_SECONDS=3600
```

### Translated-call duration and inactivity policy

Workspace owners choose 30 (default), 45, or 60 minutes in Settings → Live Voice Translation. `calls.bridgeMaxCallSeconds` snapshots the chosen effective limit at call creation. Credit affordability and explicit operator ceilings can shorten it; changing the workspace setting or clicking Keep connected never extends an existing call's hard deadline. Free-trial limits remain unchanged.

After both streams connect and the disclosure finishes, the browser leg owns a shared inactivity clock. Either participant's locally detected speech resets it. The worker uses pinned `@ozymandiasthegreat/vad@2.0.7` (WebRTC VAD in WASM), initialized at worker startup, over 8 kHz frames derived from inbound audio. It retains only short frame buffers and timestamps, not raw audio. Known generated audio and a short echo tail are excluded from inactivity detection; speech overlapping those excluded windows may not be detected. VAD is not proof of human engagement: background speech and hold recordings can keep a call active, which is why hard duration and credit limits remain mandatory.

At one minute of inactivity the worker prepares cached system-warning audio in both selected languages; at two minutes it plays the notices and publishes a one-minute countdown. After three minutes it ends both sockets, with durable Twilio termination also scheduled through Convex. Safety socket closure does not wait for backend settlement. The warning uses a separate queue and still plays if translation has degraded to a plain call. System-generated warning clips are cached separately from disclosure clips; neither cache contains customer audio.

Only the originating, authenticated workspace member can acknowledge an active warning using Keep connected. Convex atomically records that acknowledgement and rejects it at/after expiry or after termination has begun. During warnings the worker synchronizes once per second; acknowledgements and speech are monotonic, so a stale worker write cannot undo a newer acknowledgement. Acknowledgement resets only the inactivity window, not the hard deadline or credit reservation. A backend outage during the final check fails closed using the worker's local inactivity deadline; a very late acknowledgement may therefore not reach the worker in time during an outage.

**Coordinated rollout (not completed by the implementation alone):**

1. Deploy Convex and Next.js first with the existing short production cap still in place.
2. In the VPS's standalone worker project, add `@ozymandiasthegreat/vad@2.0.7` with `npm install --save-exact` and retain its lockfile. Do not replace that project's package manifest with the Next.js manifest.
3. Copy `realtime-media-worker-core.mjs`, `realtime-media-worker-disclosures.mjs`, and the new `realtime-media-worker-inactivity.mjs`. Rebuild/recreate per the deployment notes below, with a rollback image. The WASM initialization must succeed before the worker serves calls.
4. Set the worker's `REALTIME_BRIDGE_MAX_SESSION_SECONDS=3600` and verify the running container's value and build fingerprint. Once the new worker is healthy, replace the old Convex acceptance-test override `TWILIO_BRIDGE_MAX_CALL_SECONDS=120` with the operator ceiling `3600`. Any explicit `TWILIO_MAX_CALL_SECONDS` must also permit the selected maximum; the example env file's conservative `600` still caps calls at ten minutes. Workspace defaults remain thirty minutes, not sixty.
5. Verify with informed participants: two-language warning playback, resumed speech on each leg, Keep connected near expiry, inactivity disconnect of both legs, recording completion, degraded translation, quiet speakers, speakerphone echo, hold audio, and warning-generation failure. Also test a call across the browser token-refresh interval and the chosen hard deadline. Desktop/mobile settings and warning UI need a signed-in browser check.

Warning audio generation/playback is best-effort; failure is logged as `bridge_inactivity_warning_audio_failed` and does not remove the timeout or UI warning. Tests use synthetic signals and mocked provider audio; they are not a substitute for this real-call acceptance run. This policy currently covers translated bridges only. Platform-wide spending/concurrency controls are separate work, not supplied by the inactivity detector.

### Bridge leg lifecycle containment

Four independent mechanisms bound a bridge call, deliberately layered so no single
failure can leave a leg connected and billing. Added after the 2026-07-30 incident,
where one leg outlived its sibling by 49 minutes.

1. **Twilio `timeLimit` on the callee leg.** Set from the call's own capped
   `maxCallSeconds`. Proven to work — the incident's orphan ended at its limit to the
   second. Does not exist for the browser leg, which has no `<Dial>`.
2. **Scheduled sibling termination.** `recordStatusCallback` schedules
   `internal.twilioLifecycle.terminateProviderCall` *inside the same Convex
   transaction* that records a leg's hangup, so a lost webhook response cannot lose
   the instruction. That action reads the sibling's state, POSTs the verb Twilio
   accepts for it, retries with the other verb if Twilio rejects it (the state can
   change mid-flight), and reschedules transient failures with backoff.
3. **Per-call deadline.** `internal.twilioLifecycle.enforceBridgeCallDeadline` is armed
   when the callee SID is persisted and fires at `maxCallSeconds + 20s`, terminating
   whichever legs are still live. This is the browser leg's missing `timeLimit`.
4. **Worker self-deadline and sibling teardown.** Each leg is handed a signed
   `maxSessionSeconds` stream parameter (clamped by `REALTIME_BRIDGE_MAX_SESSION_SECONDS`,
   so it can only shorten) and closes its own Twilio socket at that deadline, which
   ends a `<Connect><Stream>` leg with no Twilio API call at all. Losing either leg
   also tears the other down, closing its Palabra session rather than only dropping
   the registry reference.

Money containment is separate: the `sweep abandoned call reservations` cron
(`convex/crons.ts`, every 10 minutes) settles or releases any reservation still
`reserved` past its own `reservedSeconds` plus 10 minutes. Before it existed, a single
lost terminal callback stranded the credits permanently.

**Live proof** (the only way to confirm Twilio's side, same as the skeleton phase):
from an allowlisted workspace, place a real outbound call with the bridge-mode test
checkbox on (dialer, internal-only, requires a concrete expected-language pick, not
"Detect language") to a spare/test number answered by an informed participant. The
callee should now hear the spoken AI-translation disclosure (sub-phase 5c, below)
first, then the Voxandra user's speech in the expected-language selection; the
Voxandra user should hear the callee in the "Translate into" selection. This is a
manual step; nothing in this codebase can place or answer a real phone call to verify
it automatically.

Explicitly deferred, not built this sub-phase: a real outbound audio pacer for
asynchronously-arriving translated speech, billing settlement for the second leg,
`callMode` threading, and the real (non-placeholder) UI toggle — see
`AGENTIC_FUTURE.md` for the remaining scope.

### Protected Shared Introduction (2026-09-10)

This is the current startup contract; the sub-phase 5c and 2026-09-09 descriptions below are historical. Deployed to production on 2026-09-10 from commit `787bc0f` (worker build `3eec30232c01c2ee`), with all 39 system clips prewarmed and included in the image. See `LOG.md` for deployment verification and rollback references. Live listening and signed-in desktop/mobile acceptance remain pending; public release gates are unchanged.

- After both authenticated streams connect, `BridgeIntroduction` in `scripts/realtime-media-worker-disclosures.mjs` sends the same shortened recipient-language announcement to both legs on one 20 ms clock. Startup playback bypasses the conversation mixer entirely. Original microphones, early provider output, and Guidance input remain gated; early speech is discarded, never queued for later playback. The browser's manual mute state is untouched.
- Both legs must acknowledge the final announcement media through their own Twilio `mark` events, and both Palabra tasks must report `running`, before localized “You can speak now” clips play. The shorter cue receives leading silence so the cues finish on the same worker timeline. Conversation opens only after both cue marks return; queue exhaustion alone is not completion. Marks bind to the stream, introduction generation, phase, and leg. Duplicate, unknown, old-phase, and cleared-audio marks cannot open the call.
- Startup has a 60-second deadline beginning at authenticated callee registration, independent of the call's hard duration/credit ceilings. Generation, readiness, transport, or acknowledgement failure keeps both microphones gated. Available cached failure notices play with an eight-second maximum before both sockets close; if notice audio is unavailable, the failure remains visible in the UI and sockets close immediately. No plain-call fallback during startup. The existing mid-conversation translation failure fallback remains unchanged.
- The worker feeds silent keepalive frames during startup if inbound frames pause for a second, so introduction playback and provider readiness do not depend on an unmuted microphone. Known system text enters the existing echo filter. Inactivity monitoring begins only once conversation opens; system audio still cannot count as engagement.
- `bridgeDisclosureState` progresses monotonically through `pending`, `playing`, `readying`, `done`, or terminates at `failed`. `skipped` remains accepted for legacy rows/workers, but the new worker never emits it. The workspace-scoped live-state query drives preparing/notice/go-ahead/ready copy in the dialer and mini bar; startup failure remains visible after hangup. No customer audio enters these status updates or the system-clip cache.

**Rollout, when authorized:** deploy Convex schema/functions and Next.js before the worker so the new states are accepted. Prewarm and listen-check the shortened announcement, go-ahead, and startup-failure clips for the selected language pair (all launch languages before public release). `npm run prewarm:translation-disclosures` now generates all three clip families and WAV previews; it calls paid APIs on cache misses, so it is a deliberate operator action, not part of tests or application startup. Cache keys include language and source-text hash; wording changes invalidate old clips without deleting files. Per-request translation/TTS timeouts are ten seconds.

Copy both changed worker modules (`realtime-media-worker-core.mjs` and `realtime-media-worker-disclosures.mjs`) plus the updated prewarming script if used on the VPS. Preserve the existing deployment manifest, VAD dependency, lockfile, duration ceilings, and public gates. Follow the VPS deployment section: check active streams, preserve the rollback image, rebuild/recreate, then verify the running container's source hashes and worker fingerprint. Do not restart the worker over active calls.

**Acceptance:** use the reported caller/recipient language pair and test loud speech/coughing during the notice in both directions, shared announcement audibility, localized cues, a manually muted caller, speakerphone echo, immediate first speech, and recipient hangup during setup. Repeat with unequal cue lengths and a delayed provider/mark in the mocked suite. Confirm both directions translate normally afterward, manual mute survives startup, the Call Record still completes, and inactivity/hard limits retain their independent behavior. No live test calls or new customer-audio retention are required by the automated suite.

### Historical Spoken AI-Translation Disclosure, Sub-Phase 5c

The last thing every doc named as blocking the bridge from leaving the single
allowlisted test workspace: a spoken message telling the callee, in their own
expected language, that the call is being translated in real time by AI, played
before anything else on the callee leg.

Deliberately built as translate-once-per-language-then-cache rather than a fixed,
pregenerated set of clips or a literal Palabra `tts_task` call (both considered):
Voxandra's positioning is broad multilingual reach, so adding disclosure support for
a language must never require a manual translate/record/deploy cycle, and this
codebase has no existing Convex file-storage usage to build a shared cache on top
of. The first bridge call in a given language pays one OpenAI text-completion call
(translate the fixed English script) plus one OpenAI `POST /v1/audio/speech` call
(`response_format: "pcm"`, which returns raw PCM s16le 24kHz mono directly — no
codec conversion needed before it can be queued). The result is cached to the
worker's own disk (`scripts/cache/bridge-disclosure/<lang>.<hash>.pcm` plus a
`.json` text sidecar per clip, gitignored — the filename hash is of the English
script itself, so any wording change automatically invalidates every cached
language instead of relying on manual deletion) and in-process memory; every later
call in that language is instant. Concurrent first-callers for the same
not-yet-cached language share one in-flight generation rather than triggering it
twice.

The fixed English script explains how the bridge actually works, not just that
translation exists: what the background real voice is, that the AI voice is
translating it, and that the callee's own speech reaches the caller through an AI
voice the same way — first-time callees found two simultaneous voices confusing.
It closes with "brief pauses between sentences help," the one tip that measurably
aids translation quality.

Implementation: `scripts/realtime-media-worker-disclosures.mjs`
(`defaultGetOrGenerateDisclosureAudio`, `translateDisclosureText`,
`synthesizeDisclosureAudio`) plus `primeBridgeDisclosureAudio` in
`scripts/realtime-media-worker-core.mjs`, called from `handleStart` for the callee
leg only, before `startLiveTranslation()` opens the Palabra session — so the
disclosure is always first into `bridgeTranslatedQueue`, the same queue and mixing
path (`mixBridgeFrameFromSibling`) real Palabra output uses. A failure to generate
the disclosure fails that leg's setup entirely rather than silently starting the
call without one. `disclosureAudioProvider` is an injectable constructor override
(same pattern as `translationRequester`/`guidanceRequester`) so fixture tests never
hit the real OpenAI API — see `runBridgeDisclosurePlaybackTest`,
`runBridgeDisclosureFailureAbortsLegTest`, and the standalone
`getOrGenerateDisclosureAudio` cache tests in
`scripts/test-realtime-media-worker.mjs`. Manual listen QA before trusting a
language live: `OPENAI_API_KEY=... node scripts/generate-bridge-disclosure-audio.mjs
<lang> [lang...]`, which writes a playable `.wav` per language.

No schema change, no new Convex mutation, no new workspace allowlist: this rides
entirely inside the existing bridge allowlist gate
(`REALTIME_TRANSLATION_BRIDGE_WORKSPACE_IDS` + per-call `bridgeTranslationEnabled`),
and the callee leg already receives its own expected language as
`translationSourceLanguage` — no new plumbing needed to know which language to use.

**Caller-side experience around the disclosure (2026-09-09).** Three things the
browser leg does that Twilio's `<Dial>` would otherwise have done for a normal
call, all synthesized in-worker with no provider call:

- **Ringback.** A bridge browser leg has no `<Dial>`, so the Twilio Device fires
  `accept` the instant `<Connect><Stream>` starts and the caller heard silence
  while the other phone rang. Until the callee leg registers as the sibling, each
  of the caller's own 20 ms mic frames paces one frame of synthesized 440+480 Hz
  ringback (2 s on / 4 s off — the tone `<Dial>` plays on non-translated calls)
  back into the browser leg (`generateRingbackFrame`).
- **Mic gate.** While the callee leg is absent or its disclosure is still
  draining (`isDisclosurePlaying()`), the caller's mic is withheld from Palabra
  and replaced with silence frames of the same length (Palabra closes a session
  after ~10 s of no input, so silence, not nothing). Before this, anything the
  caller said during the ~18 s disclosure queued behind it, was trimmed to the
  last 4 s by the drift bound, and then played out of context. Logged as
  `bridge_mic_gated` / `bridge_mic_open` with the reason.
- **Go-ahead chime.** The frame the disclosure queue empties, the callee leg
  calls `handleDisclosureFinished()`: it reports `done` to Convex and queues a
  ~0.5 s two-note chime (`generateGoAheadChimePcm`) as a priority clip into the
  caller's ear, so a caller who is not looking at the screen still knows when to
  start talking. Priority clips ride the same unbounded `disclosurePrimingQueue`
  (`enqueuePriorityClip`) and are excluded from Guidance like the disclosure.

The disclosure lifecycle is persisted on the call row as `bridgeDisclosureState`
(`pending` → `playing` → `done`, or `skipped`) via
`realtimeRuntime.updateBridgeDisclosureStateFromWorker`, fire-and-forget. The
dialer and mini call bar read it together with `bridgeCalleeStatus` through
`translationBridge.getLiveBridgeState`, mapped by
`src/lib/live-bridge-state.ts` into "Calling…", "Ringing…", "Connected — playing
the translation notice" (with a wait-for-the-tone hint), "Translating live — go
ahead", and busy / no-answer / couldn't-reach outcomes on the post-call card.

Building this closes the disclosure gate item specifically. It does **not** alone
make the bridge customer-facing: billing settlement for the second leg, `callMode`
threading, and the real (non-placeholder) UI toggle remain open, per the deferred
list above.

## Palabra Speech-to-Speech Pipeline (Internal-Only)

A third `translationPipeline` value, `"palabra"`, alongside `direct` and `cascade` —
routes Live Translation through Palabra's real-time speech-to-speech API
(`platform.palabra.ai`) instead of OpenAI. One vendor session produces both captions
and translated speech audio, relayed over the existing `/browser/audio-stream`
channel from Spoken Translation Phase 1 unchanged. Internal-only, allowlist-gated, no
customer-facing UI, no new billing meter yet — rides the existing `translated_captions`
session. Protocol details below were verified against the real API by
`scripts/probe-palabra-translation.mjs`, not guessed from marketing docs (Palabra's own
docs site is client-rendered and doesn't survive a plain fetch — the ground truth here
is the official Python client's source, `github.com/PalabraAI/palabra-ai-python`).

**Protocol summary**: WebSocket at
`wss://streaming.palabra.ai/streaming-api/{random_hash}/v1/speech-to-speech/stream?token=<API_KEY>`
— a client-generated hash per session, the API key as a `?token=` query param, no
handshake ack (poll `get_task` until a `current_task` event arrives). Audio in/out is
PCM s16le 24kHz mono — exactly what `decodeMuLawBase64ToPcm24Base64` already produces
and the Phase 1 browser channel/harness already expect, so this pipeline needed no new
audio-format conversion. Palabra wants ~320ms input chunks (16 Twilio frames);
`sendPalabraAudioFrame` accumulates and flushes at that cadence. Captions pair by
`transcription_id`: `partial_transcription` patches a pending segment,
`validated_transcription` + `translated_transcription` together finalize it. Voice
cloning is hard-coded off in `buildPalabraTask` — no cloning consent surface exists
(`AGENTIC_FUTURE.md` gate).

**Measured against the real API** (`scripts/probe-palabra-translation.mjs`, ~18s of
synthesized Spanish business-call speech → English): task confirmed ready in ~250ms;
first partial transcript at +2.97s; first validated source text at +3.31s; first
translated text at +3.49s; first translated audio chunk at +3.90s. Palabra emits a
`warning` and closes the socket (code 1000) after roughly 10s with no input audio —
never an issue on a real call (Twilio streams continuously through silence), but any
script driving Palabra directly must keep sending frames (silence is fine) through any
gap, exactly like the drain phase in both the probe and smoke scripts here.

**One REST session per call leg (2026-07-31)**: the worker provisions each Palabra
connection through `POST https://api.palabra.ai/session-storage/session` (Bearer
`PALABRA_API_KEY`) and connects to the returned per-session `ws_url` with the
`publisher` token. Never connect to the streaming endpoint directly with the raw API
key from anything that can run concurrently: direct connections alias onto one
implicit account-level session, and the second connection kills the first one's task
with a code-1000 close. This is exactly how the translation bridge's browser leg
went silent during the 2026-07-31 acceptance tests (the callee could not hear the
user): the browser leg always connects first and the callee leg displaced it seconds
later. Verified both ways with two staggered concurrent probes — direct mode
reproduces the kill; session mode runs both to completion. Sessions are deleted
best-effort on close because unused sessions count against the account's
simultaneously-active-session limit for at least a minute.

Set the workspace allowlist on the worker only (`PALABRA_API_KEY` and this list are
never read by the Next.js app or Convex):

```text
PALABRA_API_KEY=<key, from https://platform.palabra.ai/api-keys>
REALTIME_TRANSLATION_PALABRA_WORKSPACE_IDS=<workspace-id>
```

**Local key handling**: never commit the key. Keep it in a gitignored file
(`palabra.rtf` at repo root is already in `.gitignore`) and export it before running
any script:

```bash
export PALABRA_API_KEY=$(textutil -convert txt -stdout palabra.rtf | tail -1)
```

**Probe** (no worker involved, pure protocol verification against the real API):

```bash
PALABRA_API_KEY=... npm run probe:palabra-translation -- <24khz-mono-pcm16-file> [source-lang] [target-lang]
```

**Smoke** (drives the worker's real server end-to-end; Convex is faked in-process, so
this needs only a real Palabra key — no Convex deployment, no OpenAI key):

```bash
PALABRA_API_KEY=... npm run test:palabra-translation-smoke -- <24khz-mono-pcm16-file> [source-lang] [target-lang]
```

Both scripts accept `PALABRA_PROBE_AUDIO_DUMP` / `PALABRA_SMOKE_AUDIO_DUMP` (a file
path) to save the translated speech as raw PCM for a manual listen:

```bash
ffmpeg -f s16le -ar 24000 -ac 1 -i <dump-file>.pcm <dump-file>.wav && afplay <dump-file>.wav
```

**No automatic reconnect** — by design, per Palabra: a session is tied to one
connection and server-side pipeline state. A mid-call drop fails only the translation
feature via the existing `failTranslation` discipline (captions and audio stop, the
call itself survives), exactly like every other translation pipeline. No mid-call
vendor fallback exists yet (e.g. dropping back to `direct` if Palabra fails) — future
hardening, not built this phase.

**Bridge failure = plain call (2026-09-09).** On a two-leg bridge, `failTranslation`
on either leg calls `degradeBridgeToPlainCall`: both legs set `bridgeDegraded`,
drop their queued translated speech and priority clips, switch
`mixBridgeFrameFromSibling` to full-volume passthrough (gain 1.0, byte-identical to a
normal call), and the surviving direction's Palabra session is shut down too — a
half-translated call where one person hears an AI voice and the other does not is
more confusing than a normal call, and the dialer can explain a normal call in one
line. The first leg to degrade writes `bridgeTranslationDegradedAt` once via
`realtimeRuntime.markBridgeTranslationDegradedFromWorker`; `getLiveBridgeState`
resolves that to the `degraded` phase ("Translation stopped — you're on a regular
call now") in the dialer and call bar. A degraded call bills no `translated_audio`
usage (the existing `translationWasUsable` rule). Logged as
`bridge_degraded_to_plain_call` on each leg with the originating reason.

**Reverse-direction observability.** The browser leg's Palabra session (user →
callee) had no Convex record: only the callee leg has a pre-created, billed
`realtimeSessions` row. The browser leg now creates its own observability-only row
(`createRealtimeSessionFromWorker`, mode `translated_audio_bridge`, provider
`palabra`), marks it active when Palabra confirms the task, finishes it `failed` from
`failTranslation` or with the leg's own status from `close`, and attributes its
`user_to_caller` caption segments to it. It is deliberately **not** in
`activeSessions`, so it never records usage — the callee leg still records the single
`translated_audio` event for the whole bridged call. A failed insert is logged
(`bridge_reverse_session_create_failed`) and the direction runs unrecorded, as before.

**Region note**: the VPS worker runs in Germany (Hetzner); Palabra's speech-to-speech
API is EU-region only (its US region serves TTS only) — same-continent, favorable for
latency, but the probe numbers above were measured from a developer machine, not the
production VPS. Re-measure from the actual worker host before trusting these numbers
for a live call.

**Update**: a UI toggle now exists ("Live Audio Translation" in the dialer's Call prep
panel) but only for the single workspace on `REALTIME_TRANSLATION_AUDIO_FORWARD_WORKSPACE_IDS`
(same allowlist as the browser-audio token mint — `getSpokenTranslationAvailability`
gates whether the toggle even renders) — not a general release. A per-call Twilio
custom parameter, `spokenTranslationEnabled`, is required in addition to the workspace
allowlist before `handleStart` picks the palabra pipeline, so the plain "Live
Translation" checkbox never silently changes behavior for that workspace either. See
`LOG.md`'s "Live Audio Translation Dialer Toggle" entry for the full design.

Still explicitly deferred: opening this to any other workspace, a dedicated
`spoken_translation` billing meter (current caption overage is 8¢/min against an
estimated 4¢/min cost — exactly the 2x margin floor from `PRICING_RATIONALE.md`, so
productizing spoken translation needs its own measured meter, not a reuse of the
caption one), consent/disclosure UX, ducking/`AudioProcessor` work, wiring Palabra's
output through a paced Twilio buffer (the two-leg bridge now injects it directly but
has no outbound pacer), mid-call vendor fallback, and testing `source_language: "auto"`.

## Caption Latency

Target: first partial caption within ~1-2 seconds of the other person speaking.

The worker now has two translation pipelines:

- `direct` is the rollback path using `gpt-realtime-translate`.
- `cascade` uses Spanish-hinted `gpt-live-transcribe` transcription followed by a
  faithful text-only translation call. Keep the global mode `direct` during the
  evaluation period and enable cascade only through
  `REALTIME_TRANSLATION_CASCADE_WORKSPACE_IDS`.

The transcription WebSocket must use `?intent=transcription`; the transcription
model belongs in `audio.input.transcription.model`, not the WebSocket model query.
Phrase boundaries come from telephone-audio energy plus silence/max-duration limits,
not fixed 900 ms commits. Structured logs `translation_source_first_delta` and
`cascade_translation_flushed` separate source-ASR, text-translation, and Convex time.

- `REALTIME_TRANSLATION_CAPTION_INTERVAL_MS` (default 200) throttles partial caption
  flushes. Lower it for snappier captions at the cost of more Convex segment writes;
  raising it above ~1500 makes captions feel delayed.
- Realtime Translation is continuous: send only `session.input_audio_buffer.append`
  while the stream is active, then `session.close` and wait for `session.closed`.
  Do not add turn-based commit events, `response.create`, or custom instructions.
- Do not enable `audio.input.noise_reduction` on the translation session without a
  real PSTN A/B test. Although `near_field` is accepted by the provider, a July 10
  production call produced no source transcript and no translated output for the
  first 32 seconds with it enabled; synthetic speech smoke tests did not reproduce
  that regression.
- `REALTIME_TRANSLATION_SEGMENT_IDLE_MS`, `REALTIME_TRANSLATION_SEGMENT_MAX_MS`,
  and `REALTIME_TRANSLATION_SEGMENT_MAX_CHARS` create UI-only caption boundaries
  because the provider emits transcript deltas rather than completed utterances.
  If live captions fragment one long sentence into too many short lines, raise
  `REALTIME_TRANSLATION_SEGMENT_IDLE_MS` and `REALTIME_TRANSLATION_SEGMENT_MAX_CHARS`
  (direct path) or `REALTIME_TRANSCRIPTION_SILENCE_MS` and
  `REALTIME_TRANSCRIPTION_MAX_UTTERANCE_MS` (cascade path). Each increase trades
  a small amount of end-of-utterance latency for fuller caption lines.
- The worker logs `translation_caption_flushed` with `latencyMs` (first model delta of
  the utterance to flush) and `convexWriteMs` (Convex mutation round trip), and stores
  `latencyMs` on each translation segment. Check these first when captions feel slow:
  high `latencyMs` with low `convexWriteMs` points at the model or the flush interval;
  high `convexWriteMs` points at worker-to-Convex network latency.
- The UI receives segments over Convex's reactive websocket; there is no polling. If
  worker logs show fast flushes but the panel lags, check the browser's network path
  to Convex.
- Convex mutations reject calls with fields outside their validator
  (`ArgumentValidationError`); production redacts these to `Server Error` in worker
  logs, so check the Convex deployment logs for the real message. Each worker
  mutation call must send exactly the validator's fields — the fixture test enforces
  the shapes.
- A failed caption write logs `translation_caption_flush_failed` and is retried or
  dropped; only three consecutive failures mark the translation session failed. One
  transient Convex error must not end captions for the rest of the call.
- Keep the worker geographically close to the Twilio region handling the calls and
  with low latency to `api.openai.com`; every hop sits inside the caption path.

## Verification

Before deploying:

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
git diff --check
```

Smoke test after deploying the worker and env:

1. Generate a short synthetic speech fixture as 24 kHz mono PCM16 and run
   `npm run test:realtime-translation-smoke -- /path/to/fixture.pcm en` inside
   the worker environment. It must acknowledge `session.updated`, receive at
   least one transcript delta, and drain through `session.closed`.
2. Start a Team Copilot call with Live Guidance only.
3. Start a Team Copilot call with Live Translation only.
4. Start a Team Copilot call with both enabled.
5. Confirm active-call panels receive private guidance and caption items.
6. Confirm Wallet usage increments once per successful realtime session and
   does not increment for a failed/no-output translation session.
7. Confirm worker logs contain no raw transcripts, names, phone numbers, or audio payloads.

## Operational Notes

- Worker errors should fail only the realtime feature; the phone call should continue.
  The worker entrypoint also logs `unhandled_rejection` as a last-resort backstop
  instead of letting a stray rejection crash the process and every active call.
- Live Guidance provider errors are classified: auth/permission errors fail the
  session immediately; anything else is logged (`guidance_provider_error`) and only
  three consecutive errors — or a dropped provider socket — trigger recovery. The
  worker reconnects the Guidance session up to twice per call
  (`live_guidance_reconnecting`); the provider-side conversation history is lost on
  reconnect but instructions, context, dedupe, and metrics carry over. Exhausting
  the budget fails only Guidance.
- A transient Convex failure while writing a guidance item logs
  `live_guidance_write_failed` and drops that one prompt (the label is un-deduped so
  the model may re-emit it); it never fails the Guidance session. Failed utterance
  writes log `call_utterance_record_failed`.
- Realtime session errors are redacted before storage.
- Customer-facing UI must not expose raw model names.
- Guidance-enabled calls use `both_tracks` (shipped 2026-07-12 with audio-native
  Guidance); Translation-only calls must stay on `outbound_track`.

## VPS Deployment Notes

Current VPS deployment path:

```text
/home/carlos/voxandra-realtime-worker
```

Current public worker URL:

```text
wss://worker.voxandra.com/twilio/media-stream
```

The VPS runs the worker as a standalone Docker Compose service named
`voxandra-realtime-worker`, bound to `127.0.0.1:8787` and proxied by the existing
Caddy container.

The VPS has its own minimal `package.json` whose `start` command runs
`scripts/realtime-media-worker.mjs`. Do not copy the Next.js app's root
`package.json` over it during worker deploys; copy worker scripts individually.
Since the 2026-09-10 inactivity rollout, the VPS also retains a `package-lock.json`
and its Dockerfile uses `npm ci`; preserve the lockfile when adding dependencies.
The host has no npm on its non-interactive PATH; update the standalone manifest
and lockfile in a staging directory or Node container, then copy them back.
`REALTIME_BRIDGE_MAX_SESSION_SECONDS=3600` is explicitly set in that Compose
service's `environment` block. To change this worker ceiling, edit that block and
recreate the container: it takes precedence over `env/worker.env`.

Deploys that change worker source or `env_file` must tag the current image for
rollback, rebuild with `--no-cache`, and `docker compose up -d --force-recreate`.
Never use `docker restart` for source or env changes: it reuses the old image
and produced the 2026-07-10 stale container running `gpt-5.4-mini` while the
host claimed `gpt-5.6-luna`.

Verify inside the running container, not on the host:

1. `/healthz` (local and public) returns `workerBuild` and `configFingerprint`;
   `workerBuild` must equal the first 16 hex chars of
   `sha256(scripts/realtime-media-worker-core.mjs)` from the deployed commit.
2. `docker compose exec` a shasum of the container's copy of
   `scripts/realtime-media-worker-core.mjs` and compare with the repo file.
3. `docker compose exec` `printenv OPENAI_LIVE_TRANSLATION_TEXT_MODEL` (and any
   other changed env) to confirm the container, not just `env/worker.env`.
4. Confirm the startup log line `realtime_worker_fingerprint` and that the next
   realtime session row in Convex records the same `workerBuild`.
5. `configFingerprint` must **change** whenever env changed. An unchanged
   fingerprint after an env edit is the stale-container signature, even if
   `env/worker.env` on the host reads correctly.

## Host And Public Endpoint

The worker runs as `carlos@49.12.191.152` (`ubuntu-8gb-fsn1-2`) in
`/home/carlos/voxandra-realtime-worker`. The container publishes only
`127.0.0.1:8787`, so the local check is:

```bash
curl -s localhost:8787/healthz
```

The public host is **`worker.voxandra.com`**, so the public check is:

```bash
curl -s https://worker.voxandra.com/healthz
```

It must return the same `workerBuild` and `configFingerprint` as the local check.
A mismatch means the reverse proxy is serving a different container than the one
you just verified.

The origin is not recorded anywhere on the box. Its source of truth is
`REALTIME_MEDIA_STREAM_URL` in Vercel production env (`wss://worker.voxandra.com/twilio/media-stream`),
read in `src/app/api/twilio/voice/route.ts` as the `<Stream>` target Twilio dials.
Do not try to infer the hostname from the box: it also serves unrelated services,
serves no default certificate without SNI, and its reverse-proxy config is not
readable without sudo.

Note that the stored Vercel value currently carries a stray trailing newline. The
route's `.trim()` is the only reason that is harmless — any new consumer of this
variable must trim it too, or fix the stored value.

## 48-language release (implemented locally; activation pending)

The shared catalog in `scripts/translation-language-catalog.mjs` contains 48 documented bidirectional candidates, excluding recognition-only/translation-only languages and duplicate regional variants. See `LANGUAGE_VALIDATION.md` for the per-language matrix and limits of offline evidence. Carlos requested the full supported catalog rather than retaining the old 13-language product ceiling.

Two new flags default off:

- `PALABRA_EXPANDED_LANGUAGES_ENABLED=true` in **both the worker and Convex** enables the full voice-call catalog. The legacy OpenAI path remains restricted. Call Record preference writes also check the server flag.
- `NEXT_PUBLIC_PALABRA_EXPANDED_LANGUAGES_ENABLED=true` in the **Next.js build** enables the same choices in both dialer selectors, Call Record preferences, and public language lists. It must not advertise a release before backend/worker acceptance.

Do not run the following paid or live steps without deliberate operator approval:

1. Deploy the candidate to an isolated acceptance environment. Copy the catalog alongside the worker core, disclosures, and other worker modules; the new import requires this file. Verify the catalog checksum as well as the worker build identity. Do not assume a web deploy updates the VPS files.
2. With the server expansion flag enabled only in that environment, prewarm using `PALABRA_EXPANDED_LANGUAGES_ENABLED=true npm run prewarm:translation-disclosures`. This prepares 192 language/script combinations (announcement, go-ahead, failure, inactivity). Cache hits may avoid calls; misses use paid APIs. Review every clip with a competent speaker for meaning, intelligibility, and correct language. Existing cached clips are not proof of a new review.
3. Verify Palabra accepts each recognition/speech pair and the configured default low/high voice. Check `zh` recognition and `zh-hans` output explicitly; do not rewrite stored Chinese codes. Voice cloning remains disabled. Languages without documented voice-cloning support are still candidates for ordinary translated speech.
4. For every newly available caller or recipient language, test a real conversation in both directions with an informed participant, initially against an existing anchor language. Include non-English pairs, names, numbers, dates and pauses. Confirm spoken disclosure and both go-aheads finish before either microphone opens; confirm intelligible speech, startup failure teardown, mid-call fallback, inactivity warning/acknowledgement and hard limit. A configuration smoke test alone does not satisfy this step.
5. Verify the resulting transcription, speaker attribution, extraction language, saved preference, bilingual display and manual record review. Missing capture must become partial/unavailable status. Confirm trial cap and zero customer charge where applicable, paid-plan entitlements, and transient-audio deletion with no playback surface. Record exact tested directions and reviewer outcomes without copying private call content into this repo.
6. Only after every new language passes, deliberately approve production rollout. Deploy compatible source with flags off; enable the worker first, Convex second, and publish the frontend build with its flag last. Keep global translation/workspace/trial settings unchanged. Read back both server flags, compare deployed catalog hashes, then verify both selectors and public lists agree.

Rollback: remove expanded public choices and stop new expanded sessions in Convex first; let active expanded calls drain before disabling/restarting the worker. Preserve stored codes and records. Label normalization reads the complete catalog even with flags off; new expanded preferences are then rejected until reactivation. Do not delete usage, history or trial claims to repeat tests.

The current gate releases all 48 together; leave it off if any candidate fails. A partial release needs an explicit verified per-language set in the shared catalog. No production activation or paid acceptance was performed as part of the local landing rewrite.
