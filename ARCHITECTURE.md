# Voxandra Architecture

## Document Status

This file is background architecture documentation, not the active coding-agent instruction file. Use `AGENTS.md` for current repo rules and the latest entries in `LOG.md` for recent product decisions. Verify older milestone language here against current source before acting on it.

Voxandra has moved beyond the initial mock-data phase. Convex, Convex Auth, OpenAI extraction/transcription, Twilio browser calling, Stripe billing/credits, Call Records, and the post-call dashboard handoff now exist in the app.

## High-Level Architecture

Voxandra is a TypeScript-first SaaS application for multilingual business calls and reviewed Call Records.

Current stack:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Convex for the backend and long-term agentic backend foundation
- Convex database, queries, mutations, actions, and scheduled functions
- Auth via Convex Auth (email/password)
- OpenAI for extraction and transcription
- Twilio for browser calling
- Stripe for subscriptions, prepaid calling credits, top-ups, and Auto Top-up

## Auth & Workspace Architecture

### Authentication

Voxandra uses **Convex Auth** for email/password authentication:
- Native Convex integration, no external provider required
- Password-based sign-in and sign-up
- JWT-based session management with RS256 keys
- Environment variables required: `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`

### Workspace Model

Each authenticated user gets:
1. **Profile** — links to Convex Auth user, stores email, displayName, defaultWorkspaceId
2. **Default Workspace** — personal workspace created on first sign-in
3. **Workspace Membership** — owner role with access to all workspace data

### Server-Side Workspace Scoping

**Critical Security Rule:** Never trust client-provided workspaceId.

All Convex queries and mutations:
- Derive workspaceId server-side from authenticated user's context
- Use `ctx.auth.getUserIdentity()` to get the current user
- Query profiles to find the user's default workspace
- All data operations scoped to that workspace

Helper functions in `convex/authHelpers.ts`:
- `getCurrentWorkspaceId(ctx)` — returns workspace ID or null
- `requireWorkspace(ctx)` — returns workspace ID or throws
- `verifyWorkspaceAccess(ctx, workspaceId)` — verifies membership

### Route Protection

Next.js middleware (`middleware.ts`) protects routes:
- Public: `/`, `/login`
- Protected: `/app/*` — redirects to `/login` if not authenticated
- Authenticated users on `/login` redirect to `/app`

### Data Boundaries

All product data is workspace-scoped:
- calls, transcripts, aiMemories, extractedEntities
- actionItems, reminders, reviewSuggestions
- contacts, cases
- walletSummaries, demoSettings

Demo data seeding creates sample data in the authenticated user's workspace, not a global demo workspace. Destructive seed/reset helpers should remain internal-only and should not be callable from production customer UI.

## Current AI Extraction Architecture

Voxandra now supports text-only imported transcripts while preserving simulated calls.

Flow:

1. The user opens `/app/import` and pastes transcript text or rough call notes.
2. Optional context can include phone number, contact/institution name, existing contact, existing case, case name, objective, and language.
3. The browser calls the public Convex action `aiExtraction:analyzeImportedTranscript`.
4. The Convex action checks `OPENAI_API_KEY` server-side before creating records. If it is missing, the UI shows a setup message and no partial call is created.
5. The action creates an imported call draft and pasted transcript record in Convex with `callMode: "imported"` and transcript `source: "pasted"`.
6. The action calls OpenAI server-side with structured output requirements and a strict schema.
7. The response is validated with Zod and Convex validators before it is saved.
8. Valid extraction output creates a pending AI call record, extracted entities, action item/reminder suggestions, and a `reviewSuggestions` row.
9. The user lands on `/app/review/[id]` and must accept, edit, or dismiss suggestions before operational case/contact/reminder memory is finalized.

### AI Extraction Run Tracking

Every extraction attempt is recorded in `aiExtractionRuns` with:

- `workspaceId`, `callId`, `transcriptId`, `reviewSuggestionId`
- `status`: pending | running | succeeded | failed | validation_failed
- `source`: imported_transcript | simulated_future | provider_transcript_future
- `promptVersion` and `model`
- `startedAt`, `completedAt`, `latencyMs`
- `inputCharCount`, `transcriptCharCount`, `outputCharCount`
- `tokenUsage` (if available from OpenAI response)
- `estimatedCostUsd` (if a known price map exists)
- `errorCode`, `errorMessage` (sanitized)
- `validationErrors`
- `retryOfRunId` for retry chains

This supports observability, cost tracking, and regression analysis without storing API keys or raw sensitive responses.

### Prompt Versioning

- The canonical prompt lives in `src/lib/ai/extraction-prompt.ts`.
- `AI_EXTRACTION_PROMPT_VERSION` must be bumped on every prompt change.
- Both `aiMemories` and `reviewSuggestions` store `promptVersion` and `model`.
- This allows comparing quality across versions and identifying regressions.

### Retry Support

Failed or validation-failed extractions can be retried:

- `aiExtraction:retryImportedTranscriptExtraction` validates the original run was failed/validation_failed.
- It cleans up partial records from the failed attempt.
- It creates a new `aiExtractionRun` with `retryOfRunId` pointing to the original.
- The UI exposes retry on the call detail page for failed imports.

### Observability and Privacy Tradeoffs

- Do not store API keys or provider secrets in records.
- Do not log full OpenAI raw responses if they might contain sensitive transcript content.
- Store structured telemetry (token counts, latency, status) rather than full response text.
- Sanitize error messages to strip potential API keys and emails.
- Keep error messages concise (max 1000 chars) to avoid accidental data leakage.

### Internal Audio Transcription Test Flow

For developer testing only, Voxandra supports an internal audio upload route:

1. The developer navigates directly to `/app/internal/audio-import` (not linked from public navigation).
2. They upload a small audio file (mp3, m4a, wav, webm, ogg, flac; max 25 MB).
3. The browser sends the file to the Next.js API route `/api/internal/transcribe`.
4. The API route calls OpenAI Whisper server-side and returns the transcript text.
5. The audio file exists only in memory for the duration of the request and is discarded immediately after.
6. The browser calls the Convex action `aiExtraction:analyzeInternalAudioTranscript` with the transcript text and audio metadata.
7. The action creates a call with `callMode: "internal_audio_import"` and a transcript with `source: "audio_upload_internal"`.
8. The existing AI extraction pipeline runs on the transcript, creating `aiExtractionRuns` with `source: "provider_transcript_future"`.
9. The user is routed to `/app/review/[id]` to accept, edit, or dismiss suggestions.

The transcript record stores metadata (`transcriptionModel`, `originalFileName`, `originalMimeType`, `originalFileSize`, `audioStored: false`) but never the raw audio bytes.

Transcription runs are tracked in `audioTranscriptionRuns` for development observability.

### No Raw Audio Storage Policy

Voxandra does not store raw audio recordings by default. The internal test flow is explicitly designed to discard audio after transcription. If future production transcription is added, it should follow the same default: transcript text and structured call records are stored; raw audio is not retained unless explicitly requested with proper consent, retention, access, and deletion controls.

Environment variables:

- `OPENAI_API_KEY`: required for real imported transcript extraction and audio transcription. Set it in the Convex deployment environment (for actions) and in the local Next.js environment (for the transcription API route), not in browser-exposed `NEXT_PUBLIC_*` variables.
- `OPENAI_MODEL`: optional model override for extraction. The current default is `gpt-4o-mini`.
- `OPENAI_TRANSCRIPTION_MODEL`: optional model override for transcription. The current default is `gpt-4o-transcribe-diarize`.

Historical note: this internal audio import milestone was built before the current Twilio, Stripe, and dashboard work. The internal audio upload flow remains developer-only and should not be presented as a public transcript-import product.

## Twilio Browser Calling Architecture

The first real calling milestone adds Twilio outbound browser-to-phone calling behind `NEXT_PUBLIC_TWILIO_CALLING_ENABLED` while preserving simulated calling.

Twilio is integrated as a provider edge adapter through Next.js route handlers:

- `/api/twilio/token` creates short-lived authenticated browser Voice tokens.
- `/api/twilio/voice` receives Twilio's TwiML App request, validates Twilio's signature, validates the one-time Convex call session, and returns TwiML that dials the Convex-stored destination.
- `/api/twilio/status` validates Twilio callbacks and writes normalized provider events and call status updates to Convex.

Convex remains the source of truth for workspace-scoped calls, Twilio call sessions, provider events, duration, estimated cost placeholders, and future transcript-to-AI-memory workflows. Provider webhooks do not use Convex Auth; the Next.js route validates Twilio signatures and calls server-guarded Convex mutations with `TWILIO_CONVEX_WEBHOOK_SECRET`.

Current Twilio work supports browser-to-phone calling and post-call processing without making raw audio retention a product default. Inbound calls, virtual-number management, Convex Agent, and autonomous AI outbound calls remain outside the current product.

See `TWILIO_INTEGRATION_PLAN.md` for setup steps, required environment variables, safety controls, and testing.

## Architecture Principle

The backend should be structured and case-aware. The UX should be low-friction and assistant-like.

Users should not need to create a case, select a template, or fill out a complex form before making a call. Voxandra can infer and suggest structure after the call:

- Possible existing case match
- Possible new case title
- Possible institution or contact
- Extracted reference numbers
- Action items and reminders

The user should review, accept, edit, or dismiss suggestions.

## Convex-First Backend Decision

Convex is the preferred backend direction for the MVP because Voxandra is a realtime AI workflow app, not only a relational CRUD app.

Convex should help with:

- Realtime call and processing states
- AI workflow status
- Reminders and scheduled functions
- Webhooks
- TypeScript-first backend logic
- Rapid indie-hacker iteration
- End-to-end app logic without heavy backend boilerplate

Convex is now integrated and is the source of truth for workspace-scoped application data.

Long-term, Voxandra should use Convex through clean data-access functions rather than scattering direct backend calls across the application. This keeps the product easier to move between Convex Cloud, self-hosted Convex, or a different backend if cost, control, compliance, or data-sovereignty needs change.

Self-hosted Convex is possible using the open-source Convex backend, but it is a later infrastructure decision. It should not be treated as part of the MVP.

## Agentic Convex Architecture

Convex should be treated as Voxandra's long-term agentic backend foundation, not merely as a database. Voxandra starts as a call-memory assistant, but the architecture should prepare for post-call agents, case-aware assistant threads, call prep, live guidance behavior, human-approved call missions, and eventually feature-flagged AI phone agents.

Convex is a strong fit for this roadmap because its backend model supports realtime state, server-side TypeScript functions, durable workflows, scheduled work, and agent-oriented components. Convex Agent is specifically designed around persistent threads and messages, LLM calls, tool use, streaming, RAG, and multi-step agentic workflows. Convex Workflow can support longer-running processing with retries, observable status, and cancellation. Convex RAG can organize retrievable memory by namespace with filters and metadata.

Autonomous AI outbound calling is explicitly not part of the MVP. Convex Agent should not be implemented in the current milestone. The purpose of this section is to shape data boundaries so future agent features fit naturally later.

### Post-Call AI Memory As An Agentic Workflow

Post-call processing can later be modeled as an agentic workflow:

1. A call ends or a transcript is added.
2. A processing workflow starts.
3. An agent thread is created or updated for the call.
4. The agent analyzes the transcript.
5. Tools search related case history and institution memory.
6. The agent proposes a summary, extracted entities, action items, reminders, and case matches.
7. The user reviews, edits, accepts, or dismisses suggestions.
8. Accepted suggestions update operational records.

Earlier milestones simulated this with mock data. The current app uses Convex-backed call records and processing state; Convex Agent and Convex Workflow remain future options for making the same flow more durable, inspectable, and reactive.

### Participant Role Extraction

A critical part of post-call AI records is correctly distinguishing who played which role in the conversation. Without this, the system confuses callers with institutions and generates bad case/contact suggestions.

The extraction pipeline now infers four participant roles:

- **caller**: The person who initiated the call or is seeking help. Often the customer, client, or candidate.
- **representative**: The person answering or assisting. Often the agent, officer, or support rep.
- **institution**: The organization, company, or office being contacted. This should usually become the contact/institution record.
- **subject**: The person or account the call is about. Often the same as the caller, but may differ (e.g., a parent calling about a child's application).

Each role includes:
- `name` (optional)
- `roleLabel` / `type` / `subjectType` enum
- `confidence` (0–1)
- `evidence` (optional short string explaining the inference)

This supports:
- Correct contact/institution creation (institution name, not caller name)
- Correct case client assignment (subject name)
- Representative tracking (stored in call notes)
- Better action item phrasing (operational next steps, not generic person references)

Participant roles are stored in `aiMemories` and `reviewSuggestions` so they can be reviewed, edited, and compared across prompt versions.

### Suggested Future Agent Thread Model

Future agent state can be organized around:

- One agent thread per call for post-call analysis.
- One agent thread per case for accumulated case memory.
- One agent thread per future call mission.

Call threads should focus on what happened in a single conversation. Case threads should accumulate the operational records across calls, documents, notes, and reminders. Mission threads should preserve instructions, approvals, tool calls, escalations, and final reports.

### Future Tools

Future agents should use narrow, auditable tools such as:

- Search case history
- Search institution memory
- Create action item
- Suggest reminder
- Match institution or contact
- Prepare call brief
- Draft mission report
- Estimate call cost

Tools that only read or draft can be lower risk. Tools that mutate important data or interact with the outside world require stronger controls.

### Tool Approval And Human-In-The-Loop Safety

Tool approval should be required for any future action that:

- Spends money
- Places a call
- Sends a message
- Updates important case records
- Contacts an external party
- Shares sensitive data

Human approval should include the proposed action, relevant context, expected cost or risk, and a clear approve or deny decision. Denied tools should produce an auditable record and should not be silently retried.

This approval model is especially important for call missions and future AI phone agents.

### RAG For Case And Institution Memory

RAG should be scoped to avoid cross-workspace leakage and irrelevant retrieval.

Suggested future namespaces:

- Workspace-level memory
- Case-level memory
- Institution-level memory
- User-level preferences, if needed

Suggested metadata and filters:

- workspaceId
- caseId
- institutionId
- contactId
- callId
- documentType
- country
- createdAt
- sensitivity

Case memory can include accepted call summaries, extracted entities, user notes, and relevant transcript chunks. Institution memory can include recurring instructions, phone trees, department details, known requirements, and prior outcomes.

### Rate Limits And Usage Tracking

Rate limits and usage tracking should be planned from the beginning, even before billing is implemented.

Track usage events for:

- LLM tokens
- Embedding tokens
- Transcription minutes
- Telephony minutes
- Tool calls
- Agent runs
- Workflow retries

This protects OpenAI and telephony costs, supports future prepaid credits, and helps identify abusive or accidental usage. Usage records should be scoped by workspace, user, call, case, provider, model, and billing period where applicable.

### Convex MCP And AI Helper Files

Convex AI helper files can improve coding-agent guidance if we decide to add them:

```bash
npx convex ai-files install
```

Convex MCP can help AI coding agents inspect and interact with the Convex deployment during development:

```bash
npx -y convex@latest mcp start
```

These are development workflow aids, not product features.

## Convex vs Supabase Tradeoffs

### Why Convex Is Preferred For The MVP

- Realtime data subscriptions are central to call processing states.
- TypeScript-first functions fit the intended Next.js app.
- Mutations, actions, and scheduled functions map well to AI workflows.
- It reduces backend setup and operational boilerplate.
- It should make early product iteration faster.

### Where Supabase/Postgres Would Be Stronger

- SQL reporting and analytics
- Complex relational joins
- Mature Postgres ecosystem
- Row-level security policies
- Easier access for BI tools
- Data portability for traditional enterprise buyers
- Advanced relational constraints and migrations

### Risks Convex Introduces

- Less conventional than Postgres for some enterprise customers.
- Long-term reporting may require extra modeling or export paths.
- Migration to SQL may be non-trivial if the data model becomes deeply Convex-specific.
- Some team members or future hires may know Postgres better.
- Vendor-specific backend logic can create switching costs.

### Portability Guidelines

To keep future backend options open, including self-hosted Convex or a Supabase/Postgres migration:

- Keep domain object boundaries clear.
- Avoid hiding critical business meaning in unstructured blobs.
- Use stable IDs and explicit relationship fields.
- Keep AI extraction outputs versioned.
- Keep call, case, contact, action item, reminder, and wallet concepts separable.
- Store transcript and memory data in shapes that can map to relational tables.
- Keep Convex access behind clean data-access functions and service modules.
- Avoid coupling UI components directly to backend-specific implementation details.
- Export data regularly once real customer data exists.
- Treat self-hosted Convex as a possible later deployment target, not an MVP requirement.

## Proposed Data Model

### User

Represents an authenticated person.

Key fields:

- name
- email
- defaultWorkspaceId
- createdAt

### Workspace

Represents a team, agency, company, or solo workspace.

Relationships:

- Has many users through memberships
- Has many cases
- Has many contacts and institutions
- Has many calls
- Has one wallet or billing account

### Workspace Membership

Represents a user's role inside a workspace.

Key fields:

- workspaceId
- userId
- role
- status

### Client / Candidate / Account

Represents the person or organization whose issue is being handled.

Key fields:

- workspaceId
- displayName
- type
- notes

Relationships:

- Has many cases
- May be linked to calls, contacts, reminders, and action items

### Case

Represents a matter, process, claim, application, verification, relocation task, or administrative thread.

Key fields:

- workspaceId
- clientId
- title
- status
- category
- externalReference
- createdAt
- updatedAt

Relationships:

- Has many calls
- Has many extracted entities
- Has many action items
- Has many reminders
- Has many notes or AI call record entries

### Contact / Institution

Represents a person, department, company, government office, insurer, supplier, or support line.

Key fields:

- workspaceId
- name
- type
- phoneNumbers
- email
- website
- country
- notes

Relationships:

- Can be linked to calls
- Can be linked to cases

### Call

Represents a call attempt or completed call.

Key fields:

- workspaceId
- caseId
- contactId
- dialedNumber
- direction
- status
- startedAt
- endedAt
- durationSeconds
- simulated
- processingStatus
- transcriptId
- memoryId
- userNotes

Important: raw audio should not be stored by default.

### Transcript

Represents transcript text associated with a call.

Key fields:

- workspaceId
- callId
- source
- text
- language
- confidence
- createdAt

### AI Memory

Represents the structured post-call output.

Key fields:

- workspaceId
- callId
- caseId
- summary
- outcome
- extractedEntities
- suggestedActionItems
- suggestedReminders
- suggestedCaseMatch
- suggestedNewCaseTitle
- confidence
- extractionVersion
- userReviewStatus

### Extracted Entity

Represents a specific extracted detail.

Types may include:

- case_number
- reference_number
- claim_number
- invoice_number
- appointment_date
- due_date
- person_name
- institution_name
- amount
- required_document
- next_step

Key fields:

- workspaceId
- callId
- caseId
- memoryId
- type
- label
- value
- confidence
- accepted

### Action Item

Represents a task that should be completed.

Key fields:

- workspaceId
- caseId
- callId
- title
- description
- assigneeUserId
- dueAt
- status
- source

### Reminder

Represents a follow-up reminder.

Key fields:

- workspaceId
- caseId
- callId
- title
- remindAt
- status
- channel
- source

### Wallet / Credits

Represents prepaid call credits and future billing state.

Key fields:

- workspaceId
- balance
- currency
- billingStatus
- stripeCustomerId

The wallet is now backed by Stripe billing and Convex credit state; do not treat it as a placeholder.

### Future: Call Mission

Represents an approved instruction set for a future AI call.

Key fields:

- workspaceId
- caseId
- targetInstitutionId
- approvedQuestions
- prohibitedActions
- disclosureScript
- sensitiveDataPolicy
- escalationRules
- status

This should remain a later phase.

### Future: AI Agent

Represents a constrained calling agent that can execute approved call missions.

This should be feature-flagged and experimental only.

### Future: Agent Thread

Represents a persistent agent conversation or reasoning context.

Possible thread scopes:

- call
- case
- call_mission

Key fields:

- workspaceId
- scope
- callId
- caseId
- callMissionId
- status
- createdAt
- updatedAt

Later-phase concept only. Not required for the current customer product.

### Future: Agent Message

Represents a message, tool result, or system event inside an agent thread.

Key fields:

- workspaceId
- agentThreadId
- role
- content
- toolName
- toolCallId
- createdAt

Later-phase concept only.

### Future: Tool Approval

Represents a human approval request for a tool call.

Key fields:

- workspaceId
- agentThreadId
- agentRunId
- toolName
- proposedAction
- riskLevel
- status
- approvedByUserId
- decidedAt
- denialReason

Required before future tools spend money, place calls, send messages, update important case records, contact external parties, or share sensitive data.

### Future: Agent Run

Represents a single execution of an agent or workflow.

Key fields:

- workspaceId
- agentThreadId
- type
- status
- startedAt
- completedAt
- error
- usageSummary

Useful for observability, retries, audits, and cost tracking.

### Future: Usage Event

Represents metered usage from AI, transcription, telephony, or agent workflows.

Key fields:

- workspaceId
- userId
- caseId
- callId
- agentRunId
- provider
- model
- usageType
- quantity
- unit
- billingPeriod
- createdAt

This should support future limits, prepaid credits, billing analysis, and abuse prevention.

### Future: RAG Document / Memory Chunk

Represents retrievable memory for case-aware and institution-aware agents.

Key fields:

- workspaceId
- namespace
- caseId
- institutionId
- contactId
- callId
- sourceType
- text
- metadata
- sensitivity
- createdAt

This should be scoped carefully by workspace and case to avoid leaking context between customers or matters.

## AI Processing Pipeline

Current AI extraction path:

1. Transcript is created from pasted text or a transcription provider.
2. AI extraction action runs.
3. AI returns summary, entities, action items, reminders, and case suggestions.
4. Output is stored with an extraction version.
5. User reviews and edits suggestions.
6. Accepted suggestions update cases, contacts, action items, reminders, and memory.

The extraction pipeline should be auditable and versioned so future improvements do not erase what was originally generated.

## Twilio Integration

Twilio provides browser-based calling in the current implementation.

Likely responsibilities:

- Browser dialer
- International call routing
- Caller ID or virtual number features
- Call status webhooks
- Duration and cost events
- Optional transcription provider handoff

The UI should keep simulated call mode available even after real calling exists. Simulated mode is useful for demos, testing, and development.

## Stripe Integration

Stripe supports:

- SaaS subscriptions
- Team billing
- Prepaid calling credits
- Credit top-ups
- Invoices and payment methods

Credits should be modeled separately from subscription entitlement because real calls may have variable telecom costs.

## OpenAI Integration

OpenAI supports:

- Transcript summarization
- Entity extraction
- Action item generation
- Reminder suggestion
- Case matching
- Call prep
- Live copilot suggestions
- Future mission report generation

AI outputs should include confidence, source transcript references where practical, and extraction version metadata.

## Future AI Call Missions

Call missions are a later phase and should not be implemented in the MVP.

The system should eventually allow users to approve a constrained mission:

- Who to call
- What to ask
- What not to do
- What can be disclosed
- When to stop and escalate
- What structured report to return

Safety rules:

- Always disclose that the caller is an AI assistant.
- Only ask approved questions.
- Do not pretend to be human.
- Do not make commitments.
- Do not negotiate.
- Do not provide legal, medical, or financial advice.
- Do not share sensitive data unless explicitly approved.
- Stop or escalate when identity verification is required.
- Stop or escalate when the institution refuses to speak with AI.
- Return a structured report with confidence and transcript.

## Data Retention And Privacy

Voxandra will handle sensitive operational information. The architecture should minimize unnecessary storage and make deletion straightforward.

MVP policy:

- Store call metadata, transcript text, summary, extracted details, action items, reminders, and user notes.
- Do not store raw audio recordings by default.
- Keep simulated call data clearly marked.
- Avoid storing secrets or credentials in user notes.
- Design for workspace-level deletion.
- Design for call-level transcript and memory deletion.

Future optional audio retention should require:

- Explicit consent
- Clear retention settings
- Access controls
- Audit events
- Deletion controls
- Jurisdiction-aware compliance review
