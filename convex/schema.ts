import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

const speakerMapping = v.object({
  label: v.string(),
  name: v.string(),
  role: v.union(
    v.literal("caller"),
    v.literal("representative"),
    v.literal("institution"),
    v.literal("subject"),
    v.literal("other")
  ),
  source: v.union(v.literal("ai_inferred"), v.literal("user_edited")),
  confidence: v.optional(v.number()),
});

const reviewedMeaning = v.object({
  reviewedObjective: v.optional(v.string()),
  outcomeStatus: v.optional(v.string()),
  acceptedFollowUps: v.array(v.string()),
  correctedDetails: v.array(v.string()),
  unresolvedQuestions: v.array(v.string()),
  escalationTriggers: v.array(v.string()),
  humanCorrectionSummary: v.optional(v.string()),
  playbookHint: v.optional(v.string()),
  completeness: v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("needs_follow_up"),
    v.literal("uncertain")
  ),
  confidence: v.number(),
  source: v.union(
    v.literal("review_accept"),
    v.literal("review_dismiss"),
    v.literal("memory_update"),
    v.literal("speaker_mapping_update")
  ),
  reviewedAt: v.number(),
});

const aiDraftSnapshot = v.object({
  detectedCallType: v.optional(v.string()),
  summary: v.optional(v.string()),
  confidence: v.optional(v.number()),
  entities: v.array(v.string()),
  actions: v.array(v.string()),
  reminder: v.optional(v.string()),
  participants: v.array(v.string()),
  capturedAt: v.number(),
});

const liveGuidanceContextSnapshot = v.object({
  version: v.string(),
  generatedAt: v.number(),
  call: v.object({
    callId: v.id("calls"),
    workspaceId: v.id("workspaces"),
    objective: v.optional(v.string()),
    workflowTemplateKey: v.optional(v.string()),
    startedAt: v.optional(v.string()),
  }),
  template: v.object({
    key: v.string(),
    label: v.string(),
    shortLabel: v.string(),
    objectivePrompt: v.string(),
    checklist: v.array(v.string()),
    extractionFocus: v.array(v.string()),
  }),
  prep: v.object({
    suggestedObjective: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactType: v.optional(v.string()),
    threadTitle: v.optional(v.string()),
    recentCalls: v.array(
      v.object({
        callId: v.id("calls"),
        startedAt: v.string(),
        durationSeconds: v.number(),
        status: v.string(),
        reviewPending: v.optional(v.boolean()),
        summary: v.string(),
        outcome: v.optional(v.string()),
      })
    ),
    reviewedCallMemories: v.array(
      v.object({
        callId: v.id("calls"),
        summary: v.string(),
        outcome: v.optional(v.string()),
      })
    ),
    openActionItems: v.array(
      v.object({
        title: v.string(),
        status: v.string(),
      })
    ),
    openReminders: v.array(
      v.object({
        title: v.string(),
        remindAt: v.string(),
        status: v.string(),
      })
    ),
    keyFacts: v.array(
      v.object({
        type: v.string(),
        label: v.string(),
        value: v.string(),
      })
    ),
    // Optional for the same reason as limits.maxSimilarReviewedCalls: snapshots
    // written before 2026-07-26 have no similarReviewedCalls, and Convex checks
    // existing documents when a schema is deployed.
    similarReviewedCalls: v.optional(
      v.array(
        v.object({
          summary: v.string(),
          outcome: v.optional(v.string()),
          realizedOutcomes: v.optional(v.array(v.string())),
          playbookHint: v.optional(v.string()),
        })
      )
    ),
  }),
  deterministicChecklist: v.array(
    v.object({
      label: v.string(),
      detail: v.optional(v.string()),
      status: v.string(),
    })
  ),
  // Must stay in sync with LIVE_GUIDANCE_CONTEXT_LIMITS in convex/callGuidance.ts,
  // which is written here wholesale. A field present there but missing here fails
  // the whole realtimeSessions write, which kills Live Guidance and Live
  // Translation for the entire call at session setup. That is exactly what
  // maxSimilarReviewedCalls did between 2026-07-26 and 2026-07-29.
  limits: v.object({
    maxGuidanceItems: v.number(),
    maxRecentCalls: v.number(),
    maxOpenItems: v.number(),
    maxKeyFacts: v.number(),
    // Optional, not required: sessions written before 2026-07-26 carry a
    // four-key limits object, and Convex validates existing documents when a
    // schema is deployed. Requiring this would reject those historical rows and
    // fail the deploy outright.
    maxSimilarReviewedCalls: v.optional(v.number()),
  }),
});

export default defineSchema({
  ...authTables,

  workspaces: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    plan: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    // Owners can turn spoken translation off for the whole workspace. Missing
    // means enabled so existing paid workspaces do not need a migration when
    // the global release switch opens.
    voiceTranslationEnabled: v.optional(v.boolean()),
    voiceTranslationMaxCallMinutes: v.optional(v.union(v.literal(30), v.literal(45), v.literal(60))),
    // Set when an owner requests deletion. Access is revoked immediately by
    // removing every workspaceMembership row (see requestWorkspaceDeletion),
    // so this field is a record of the request for support/cleanup tooling
    // rather than something access checks branch on directly.
    deletionRequestedAt: v.optional(v.number()),
  }),

  trialVerifications: defineTable({
    workspaceId: v.id("workspaces"), userId: v.string(),
    phoneHash: v.string(), deviceHash: v.string(), ipHash: v.string(), phoneNumber: v.string(),
    status: v.union(v.literal("reserved"), v.literal("pending"), v.literal("checking"),
      v.literal("approved"), v.literal("failed"), v.literal("unknown")),
    providerSid: v.optional(v.string()), createdAt: v.number(), expiresAt: v.number(),
    reservedCents: v.number(), checkCount: v.number(),
    checkNonce: v.optional(v.string()), checkLeaseUntil: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]).index("by_user", ["userId"])
    .index("by_phone", ["phoneHash"]).index("by_device", ["deviceHash"]).index("by_ip", ["ipHash"])
    .index("by_created", ["createdAt"]).index("by_status", ["status"]),

  trialGrants: defineTable({
    workspaceId: v.id("workspaces"), userId: v.string(), verificationId: v.id("trialVerifications"),
    phoneHash: v.string(), deviceHash: v.string(), ipHash: v.string(), destination: v.string(),
    status: v.union(v.literal("reserved"), v.literal("approved"), v.literal("bound"),
      v.literal("used"), v.literal("failed"), v.literal("unknown")),
    tokenHash: v.string(), createdAt: v.number(), expiresAt: v.number(), reservedCents: v.number(),
    callId: v.optional(v.id("calls")), usedAt: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]).index("by_user", ["userId"])
    .index("by_phone", ["phoneHash"]).index("by_device", ["deviceHash"]).index("by_ip", ["ipHash"])
    .index("by_created", ["createdAt"]).index("by_status", ["status"])
    .index("by_token", ["tokenHash"]).index("by_call", ["callId"]),

  profiles: defineTable({
    userId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    defaultWorkspaceId: v.optional(v.id("workspaces")),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    // Marketing opt-out is per PERSON, not per workspace: it is an individual
    // choice about their own inbox. Suppresses the two win-back sequences only —
    // transactional mail (welcome, call record ready, credit request) still sends,
    // because those answer something the person actually did.
    marketingEmailOptOut: v.optional(v.boolean()),
    // Deliberately stored in PLAINTEXT, unlike workspaceInvitations.tokenHash.
    // Hashing works for an invite because the raw token is emailed once and never
    // needed again; this one has to be rendered into ten emails across three weeks,
    // so it must be readable at send time — hashing would force storing the raw
    // value anyway and buy nothing. The capability is also far smaller: an invite
    // token grants workspace access, this one only unsubscribes its own owner.
    unsubscribeToken: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_unsubscribe_token", ["unsubscribeToken"])
    .index("by_email", ["email"]),

  workspaceMemberships: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    profileId: v.id("profiles"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  workspaceInvitations: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    tokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired")
    ),
    invitedByUserId: v.string(),
    invitedByProfileId: v.id("profiles"),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedByProfileId: v.optional(v.id("profiles")),
    revokedAt: v.optional(v.number()),
    revokedByProfileId: v.optional(v.id("profiles")),
    emailDeliveryStatus: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    emailSentAt: v.optional(v.number()),
    emailError: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_email", ["workspaceId", "email"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_status_expires", ["status", "expiresAt"]),

  // Personal API keys for the read-only MCP server (/api/mcp). Only the
  // sha256 hash of a key is stored; the plaintext is shown once at creation.
  apiKeys: defineTable({
    workspaceId: v.id("workspaces"),
    profileId: v.id("profiles"),
    userId: v.string(),
    label: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    scopes: v.array(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    rateWindowStart: v.optional(v.number()),
    rateWindowCount: v.optional(v.number()),
  })
    .index("by_key_hash", ["keyHash"])
    .index("by_workspace", ["workspaceId"])
    .index("by_profile", ["profileId"]),

  contacts: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    type: v.string(),
    country: v.string(),
    phoneNumber: v.string(),
    phoneE164: v.optional(v.string()),
    lastCallAt: v.optional(v.string()),
    relatedCaseIds: v.array(v.id("cases")),
    notes: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_name", ["workspaceId", "name"])
    .index("by_phone_e164", ["workspaceId", "phoneE164"]),

  cases: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    type: v.string(),
    clientName: v.string(),
    status: v.string(),
    lastCallAt: v.string(),
    nextFollowUpAt: v.optional(v.string()),
    callIds: v.array(v.id("calls")),
    contactIds: v.array(v.id("contacts")),
    unresolvedActionItemIds: v.array(v.id("actionItems")),
    summary: v.string(),
    workflowTemplateKey: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["workspaceId", "status"]),

  calls: defineTable({
    workspaceId: v.id("workspaces"),
    createdByUserId: v.optional(v.string()),
    createdByProfileId: v.optional(v.id("profiles")),
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    dialedNumber: v.string(),
    objective: v.optional(v.string()),
    workflowTemplateKey: v.optional(v.string()),
    startedAt: v.string(),
    durationSeconds: v.number(),
    status: v.string(),
    processingStatus: v.string(),
    aiMemoryReady: v.boolean(),
    reviewPending: v.boolean(),
    transcriptId: v.optional(v.id("transcripts")),
    memoryId: v.optional(v.id("aiMemories")),
    highlights: v.array(v.string()),
    userNotes: v.optional(v.string()),
    simulated: v.boolean(),
    // Tightened from a bare string (2026-08-13, bridge-GA Phase 1a): six
    // literal values are the only ones ever written anywhere in this
    // codebase. human_twilio_bridge distinguishes the real two-leg
    // translation bridge from an ordinary single-leg call — previously
    // every bridge call was stamped human_twilio identically to a normal
    // call, so nothing downstream (security gates in twilioProvider.ts,
    // display classification in call-detail-client.tsx) could tell them
    // apart. No migration needed: every existing row already holds one of
    // these values.
    callMode: v.union(
      v.literal("human_twilio"),
      v.literal("human_twilio_bridge"),
      v.literal("human_twilio_inbound"),
      v.literal("simulated"),
      v.literal("imported"),
      v.literal("internal_audio_import")
    ),
    importContext: v.optional(v.string()),
    language: v.optional(v.string()),
    callRecordLanguagePreference: v.optional(v.string()),
    callRecordLanguage: v.optional(v.string()),
    callRecordLanguageSource: v.optional(
      v.union(
        v.literal("explicit"),
        v.literal("operator_audio"),
        v.literal("operator_realtime"),
        v.literal("fallback"),
        v.literal("legacy_transcript")
      )
    ),
    provider: v.optional(v.string()),
    providerCallSid: v.optional(v.string()),
    parentCallSid: v.optional(v.string()),
    bridgeCalleeCallSid: v.optional(v.string()),
    bridgeParentStatus: v.optional(v.string()),
    bridgeCalleeStatus: v.optional(v.string()),
    // Where the callee leg's spoken AI-translation disclosure is, reported by
    // the realtime worker so the dialer can tell the caller why they should
    // wait ("playing") and when to start talking ("done"). "skipped" means
    // generation failed and the leg continued without one (internal-only
    // path; the GA gate fails closed instead).
    bridgeDisclosureState: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("playing"),
        v.literal("readying"),
        v.literal("failed"),
        v.literal("done"),
        v.literal("skipped")
      )
    ),
    // Set once by the worker when either translation direction fails
    // mid-call and the bridge degrades to a plain full-volume phone call.
    // The dialer reads it to tell the caller translation has stopped.
    bridgeTranslationDegradedAt: v.optional(v.number()),
    // Bridge-GA Phase 1b (2026-08-13, see LOG.md): the browser (parent)
    // leg's own terminal duration, previously discarded entirely —
    // recordStatusCallback's bridgeLeg === "parent" branch patched
    // lifecycle fields and returned before ever reaching
    // settleCallReservation, so this leg's real duration/cost was never
    // captured anywhere. Customer-facing settlement deliberately still
    // uses the callee leg's own duration (see settleCallReservation call
    // site) — this field exists for internal cost/margin visibility only.
    bridgeParentDurationSeconds: v.optional(v.number()),
    // Internal-only real telephony cost estimate for a completed bridge
    // call: callee-leg-duration x the real destination carrier rate (the
    // same rate catalog every normal call already prices against) plus
    // browser-leg-duration x the fixed browser-leg cost rate. Never
    // exposed via MCP or exportWorkspaceData, matching every other
    // *CostCents*/*CostCentsPerMinute* field on this table.
    bridgeInternalCostCents: v.optional(v.number()),
    twilioDeviceIdentity: v.optional(v.string()),
    callDirection: v.optional(v.string()),
    callerIdId: v.optional(v.id("callingNumbers")),
    callerIdNumber: v.optional(v.string()),
    callerIdSource: v.optional(
      v.union(
        v.literal("twilio_account"),
        v.literal("verified_external"),
        v.literal("rented")
      )
    ),
    callerIdLabel: v.optional(v.string()),
    endedAt: v.optional(v.string()),
    inboundCallingNumberId: v.optional(v.id("callingNumbers")),
    inboundCallerNumber: v.optional(v.string()),
    inboundCalledNumber: v.optional(v.string()),
    inboundForwardingNumber: v.optional(v.string()),
    inboundVoicemail: v.optional(v.boolean()),
    inboundMissedReason: v.optional(v.string()),
    destinationCountry: v.optional(v.string()),
    destinationType: v.optional(v.string()),
    estimatedCostCents: v.optional(v.number()),
    retailRateCentsPerMinute: v.optional(v.number()),
    baselineRetailRateCentsPerMinute: v.optional(v.number()),
    providerCostCentsPerMinute: v.optional(v.number()),
    aiCaptureCostCentsPerMinute: v.optional(v.number()),
    totalVariableCostCentsPerMinute: v.optional(v.number()),
    marginMultiple: v.optional(v.number()),
    marginStatus: v.optional(v.string()),
    pricingCatalogVersion: v.optional(v.string()),
    pricingSource: v.optional(v.string()),
    billingIncrementSeconds: v.optional(v.number()),
    minimumBillableSeconds: v.optional(v.number()),
    aiCaptureEnabled: v.optional(v.boolean()),
    quoteBlockReason: v.optional(v.string()),
    creditReservationId: v.optional(v.id("creditReservations")),
    reservedCreditCents: v.optional(v.number()),
    settledCreditCents: v.optional(v.number()),
    isFreeCall: v.optional(v.boolean()),
    trialGrantId: v.optional(v.id("trialGrants")),
    translatedTrialAuthorized: v.optional(v.boolean()),
    freeCallClaimedAt: v.optional(v.number()),
    freeCallMaxSeconds: v.optional(v.number()),
    realtimeCopilotRequested: v.optional(v.boolean()),
    translatedCaptionsRequested: v.optional(v.boolean()),
    // Live Audio Translation (internal-only, single-workspace test — see
    // AGENTIC_FUTURE.md). Implies translatedCaptionsRequested; carried
    // separately so the worker can pick the Palabra pipeline only when both
    // this per-call flag and the workspace allowlist agree.
    spokenTranslationRequested: v.optional(v.boolean()),
    // Real two-leg translation bridge (internal-only, single-workspace test,
    // sub-phase 5a — see AGENTIC_FUTURE.md). Separate flag/allowlist from
    // spokenTranslationRequested on purpose: placing a real second Twilio
    // call is categorically riskier than the private listen-along mode, and
    // a bug here must never be able to touch the already-proven mode.
    bridgeModeRequested: v.optional(v.boolean()),
    bridgeMaxCallSeconds: v.optional(v.number()),
    bridgeInactivityDeadlineAt: v.optional(v.number()),
    bridgeLastActivityAt: v.optional(v.number()),
    bridgeKeepConnectedAt: v.optional(v.number()),
    bridgeEndReason: v.optional(v.union(v.literal("inactivity"), v.literal("duration_limit"))),
    bridgeRecordCompleteness: v.optional(
      v.union(v.literal("complete"), v.literal("partial"))
    ),
    // Voice used for each participant's translated speech. Optional for
    // backward compatibility; missing values resolve to Palabra default_low.
    callerTranslatedVoice: v.optional(v.union(v.literal("male"), v.literal("female"))),
    calledPersonTranslatedVoice: v.optional(v.union(v.literal("male"), v.literal("female"))),
    translatedCaptionsSourceLanguage: v.optional(v.string()),
    translatedCaptionsTargetLanguage: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    recordingDuration: v.optional(v.number()),
    recordingSid: v.optional(v.string()),
    recordingChannels: v.optional(v.number()),
    recordingDeleteStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("deleted"),
        v.literal("failed")
      )
    ),
    recordingDeletedAt: v.optional(v.number()),
    recordingDeleteError: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_case", ["caseId"])
    .index("by_contact", ["contactId"])
    .index("by_review_pending", ["workspaceId", "reviewPending"])
    .index("by_provider_call_sid", ["providerCallSid"])
    .index("by_parent_call_sid", ["parentCallSid"])
    .index("by_bridge_callee_call_sid", ["bridgeCalleeCallSid"])
    .index("by_workspace_started", ["workspaceId", "startedAt"])
    .index("by_workspace_processing", ["workspaceId", "processingStatus"]),

  twilioCallSessions: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    callId: v.id("calls"),
    destinationE164: v.string(),
    callerIdId: v.optional(v.id("callingNumbers")),
    callerIdNumber: v.optional(v.string()),
    callerIdSource: v.optional(
      v.union(
        v.literal("twilio_account"),
        v.literal("verified_external"),
        v.literal("rented")
      )
    ),
    aiCaptureEnabled: v.optional(v.boolean()),
    connectTokenHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("used"),
      v.literal("expired"),
      v.literal("failed")
    ),
    createdAt: v.number(),
  })
    .index("by_call", ["callId"])
    .index("by_token", ["connectTokenHash"])
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["workspaceId", "status"])
    .index("by_status_expires", ["status", "expiresAt"]),

  // Internal-only, allowlisted-workspace credential for the browser to open a
  // second WebSocket straight to the realtime worker and receive translated
  // speech audio (Spoken Translation Phase 1 — see AGENTIC_FUTURE.md). Unlike
  // twilioCallSessions' connectTokenHash, this is deliberately not single-use:
  // a flaky browser tab must be able to reconnect and re-present the same
  // token for the life of the call, so validation only checks status/expiry.
  browserAudioStreamTokens: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    realtimeSessionId: v.id("realtimeSessions"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    status: v.union(
      v.literal("issued"),
      v.literal("expired"),
      v.literal("revoked")
    ),
    createdAt: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_call", ["callId"])
    .index("by_workspace", ["workspaceId"]),

  callingNumbers: defineTable({
    workspaceId: v.id("workspaces"),
    phoneNumber: v.string(),
    label: v.string(),
    source: v.union(
      v.literal("verified_external"),
      v.literal("rented")
    ),
    status: v.union(
      v.literal("pending_verification"),
      v.literal("verification_failed"),
      v.literal("pending_purchase"),
      v.literal("purchase_failed"),
      v.literal("active"),
      v.literal("pending_release"),
      v.literal("released"),
      v.literal("release_failed")
    ),
    isDefault: v.boolean(),
    twilioOutgoingCallerIdSid: v.optional(v.string()),
    twilioIncomingPhoneNumberSid: v.optional(v.string()),
    twilioValidationCallSid: v.optional(v.string()),
    twilioValidationCode: v.optional(v.string()),
    lastVerificationStatus: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripeSubscriptionItemId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    rentalPriceCents: v.optional(v.number()),
    isoCountry: v.optional(v.string()),
    region: v.optional(v.string()),
    locality: v.optional(v.string()),
    addressRequirements: v.optional(v.string()),
    inboundEnabled: v.optional(v.boolean()),
    inboundForwardingNumber: v.optional(v.string()),
    inboundRingTimeoutSeconds: v.optional(v.number()),
    inboundVoicemailEnabled: v.optional(v.boolean()),
    inboundVoicemailGreeting: v.optional(v.string()),
    inboundAiCaptureEnabled: v.optional(v.boolean()),
    inboundRecordingComplianceAttested: v.optional(v.boolean()),
    inboundRecordingComplianceAttestedAt: v.optional(v.number()),
    inboundRecordingComplianceAttestedByUserId: v.optional(v.string()),
    inboundRecordingComplianceAttestedByProfileId: v.optional(v.id("profiles")),
    inboundSettingsUpdatedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    releasedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_number", ["workspaceId", "phoneNumber"])
    .index("by_phone_number", ["phoneNumber"])
    .index("by_twilio_validation_call_sid", ["twilioValidationCallSid"])
    .index("by_twilio_outgoing_sid", ["twilioOutgoingCallerIdSid"])
    .index("by_twilio_incoming_sid", ["twilioIncomingPhoneNumberSid"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  providerEvents: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    provider: v.string(),
    eventType: v.string(),
    providerCallSid: v.optional(v.string()),
    parentCallSid: v.optional(v.string()),
    providerStatus: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    receivedAt: v.number(),
    payloadSummary: v.object({
      from: v.optional(v.string()),
      to: v.optional(v.string()),
      callStatus: v.optional(v.string()),
      callDuration: v.optional(v.string()),
      direction: v.optional(v.string()),
      sequenceNumber: v.optional(v.string()),
      timestamp: v.optional(v.string()),
      callbackSource: v.optional(v.string()),
    }),
  })
    .index("by_call", ["callId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_provider_call_sid", ["providerCallSid"])
    .index("by_parent_call_sid", ["parentCallSid"])
    .index("by_received_at", ["receivedAt"]),

  callGuidanceItems: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    type: v.union(
      v.literal("checklist"),
      v.literal("copilot"),
      v.literal("caption"),
      v.literal("translation_caption")
    ),
    label: v.string(),
    detail: v.optional(v.string()),
    status: v.union(
      v.literal("suggested"),
      v.literal("done"),
      v.literal("dismissed")
    ),
    source: v.union(
      v.literal("deterministic"),
      v.literal("user"),
      v.literal("live_copilot"),
      v.literal("translated_captions"),
      v.literal("system")
    ),
    evidence: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_call", ["callId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_session", ["realtimeSessionId"])
    .index("by_status", ["workspaceId", "status"]),

  realtimeUsageEvents: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    feature: v.union(
      v.literal("live_copilot"),
      v.literal("translated_captions"),
      // The two-leg spoken bridge, metered apart from captions because it runs
      // one Palabra session per direction (~9c/min all-in vs 4c).
      v.literal("translated_audio")
    ),
    planId: v.optional(v.string()),
    model: v.optional(v.string()),
    durationSeconds: v.number(),
    billedSeconds: v.number(),
    includedSecondsApplied: v.number(),
    isFreeTrial: v.optional(v.boolean()),
    overageSeconds: v.optional(v.number()),
    overageCents: v.number(),
    chargeStatus: v.optional(
      v.union(
        v.literal("not_required"),
        v.literal("charged"),
        v.literal("unpaid")
      )
    ),
    chargedCents: v.optional(v.number()),
    includedChargedCents: v.optional(v.number()),
    topUpChargedCents: v.optional(v.number()),
    unpaidCents: v.optional(v.number()),
    chargedAt: v.optional(v.number()),
    chargeLedgerEntryId: v.optional(v.id("creditLedgerEntries")),
    status: v.union(v.literal("recorded"), v.literal("voided")),
    // Internal margin telemetry. Included minutes are free to the customer, so
    // overageCents/chargedCents say nothing about what a workspace actually
    // costs to serve. These two make real margin queryable, and the rate is
    // stored alongside the amount so historical rows stay interpretable after
    // the cost estimate changes. Never expose either through the MCP surface or
    // exportWorkspaceData.
    estimatedProviderCostCents: v.optional(v.number()),
    estimatedCostCentsPerMinute: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_session", ["realtimeSessionId"])
    .index("by_feature", ["workspaceId", "feature"])
    .index("by_status", ["workspaceId", "status"]),

  realtimeSessions: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    mode: v.union(
      v.literal("human_copilot"),
      v.literal("translated_captions"),
      v.literal("translated_audio_private"),
      v.literal("translated_audio_bridge"),
      v.literal("agent_shadow"),
      v.literal("agent_assisted"),
      v.literal("agent_autonomous")
    ),
    provider: v.string(),
    status: v.union(
      v.literal("requested"),
      v.literal("starting"),
      v.literal("active"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    requestedByUserId: v.optional(v.string()),
    requestedByProfileId: v.optional(v.id("profiles")),
    providerSessionId: v.optional(v.string()),
    providerStreamSid: v.optional(v.string()),
    providerCallSid: v.optional(v.string()),
    model: v.optional(v.string()),
    inputLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()),
    // Privacy-safe operational fingerprints from the media worker: which
    // pipeline served the session and which worker build/config produced it.
    pipeline: v.optional(v.string()),
    workerBuild: v.optional(v.string()),
    configFingerprint: v.optional(v.string()),
    guidanceMetrics: v.optional(
      v.object({
        decisions: v.number(),
        emitted: v.number(),
        noops: v.number(),
        deduplicated: v.number(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        cachedTokens: v.number(),
      })
    ),
    liveGuidanceContextSnapshot: v.optional(liveGuidanceContextSnapshot),
    liveGuidanceContextSnapshotCreatedAt: v.optional(v.number()),
    liveGuidanceContextSnapshotVersion: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_status", ["workspaceId", "status"])
    .index("by_mode", ["workspaceId", "mode"])
    .index("by_provider_session", ["provider", "providerSessionId"]),

  callUtterances: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    speakerLabel: v.string(),
    speakerRole: v.optional(
      v.union(
        v.literal("caller"),
        v.literal("representative"),
        v.literal("voxandra_user"),
        v.literal("agent"),
        v.literal("unknown")
      )
    ),
    track: v.optional(
      v.union(
        v.literal("inbound"),
        v.literal("outbound"),
        v.literal("both"),
        v.literal("browser"),
        v.literal("agent"),
        v.literal("unknown")
      )
    ),
    language: v.optional(v.string()),
    text: v.string(),
    confidence: v.optional(v.number()),
    source: v.union(
      v.literal("realtime_transcription"),
      v.literal("post_call_transcription"),
      v.literal("translation_input"),
      v.literal("agent_generated"),
      v.literal("worker")
    ),
    startSeconds: v.optional(v.number()),
    endSeconds: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    sequence: v.optional(v.number()),
    isFinal: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_session", ["realtimeSessionId"]),

  // DTMF keypad presses during a call, kept as structured per-call telemetry
  // (IVR navigation paths for future agent training). Digits in rapid
  // consecutive runs beyond a short prefix are stored masked because keypads
  // also carry account numbers and PINs. Never sent to product analytics.
  callKeypadEvents: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    digit: v.string(),
    masked: v.boolean(),
    sequence: v.number(),
    pressedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"]),

  translationSegments: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    sourceUtteranceId: v.optional(v.id("callUtterances")),
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.string(),
    sourceText: v.string(),
    translatedText: v.string(),
    direction: v.union(
      v.literal("caller_to_user"),
      v.literal("user_to_caller"),
      v.literal("listen_along"),
      v.literal("unknown")
    ),
    audioMode: v.union(
      v.literal("caption_only"),
      v.literal("private_audio"),
      v.literal("bridged_audio")
    ),
    audioStored: v.optional(v.boolean()),
    latencyMs: v.optional(v.number()),
    firstAudioLatencyMs: v.optional(v.number()),
    model: v.optional(v.string()),
    confidence: v.optional(v.number()),
    // Privacy-safe stage timings and pipeline identity from the media worker;
    // no audio or transcript content beyond the caption texts themselves.
    pipeline: v.optional(v.string()),
    stageTimings: v.optional(
      v.object({
        speechToFirstSourceDeltaMs: v.optional(v.number()),
        commitToFirstSourceDeltaMs: v.optional(v.number()),
        speechToTranslationMs: v.optional(v.number()),
        utteranceEndToTranslationMs: v.optional(v.number()),
        translationRequestMs: v.optional(v.number()),
        providerElapsedMs: v.optional(v.number()),
      })
    ),
    isFinal: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_session", ["realtimeSessionId"])
    .index("by_source_utterance", ["sourceUtteranceId"]),

  agentMissions: defineTable({
    workspaceId: v.id("workspaces"),
    createdByUserId: v.optional(v.string()),
    createdByProfileId: v.optional(v.id("profiles")),
    mode: v.union(
      v.literal("agent_shadow"),
      v.literal("agent_assisted"),
      v.literal("agent_autonomous")
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    objective: v.string(),
    targetPhoneNumber: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    language: v.optional(v.string()),
    allowedTools: v.array(v.string()),
    maxSpendCents: v.optional(v.number()),
    maxDurationSeconds: v.optional(v.number()),
    escalationPolicy: v.optional(v.string()),
    approvalPolicy: v.union(
      v.literal("always_require_external_actions"),
      v.literal("workspace_policy"),
      v.literal("manual_only")
    ),
    finalReport: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["workspaceId", "status"])
    .index("by_mode", ["workspaceId", "mode"])
    .index("by_contact", ["contactId"])
    .index("by_case", ["caseId"]),

  agentRunEvents: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    realtimeSessionId: v.optional(v.id("realtimeSessions")),
    agentMissionId: v.optional(v.id("agentMissions")),
    mode: v.optional(
      v.union(
        v.literal("agent_shadow"),
        v.literal("agent_assisted"),
        v.literal("agent_autonomous")
      )
    ),
    eventType: v.union(
      v.literal("observation"),
      v.literal("prediction"),
      v.literal("tool_call_requested"),
      v.literal("tool_call_result"),
      v.literal("guardrail"),
      v.literal("handoff"),
      v.literal("approval_requested"),
      v.literal("approval_decision"),
      v.literal("summary"),
      v.literal("error")
    ),
    status: v.union(
      v.literal("recorded"),
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("failed")
    ),
    title: v.optional(v.string()),
    detail: v.optional(v.string()),
    toolName: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    riskLevel: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high"))
    ),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_session", ["realtimeSessionId"])
    .index("by_mission", ["agentMissionId"])
    .index("by_event_type", ["workspaceId", "eventType"]),

  approvalRequests: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    agentMissionId: v.optional(v.id("agentMissions")),
    agentRunEventId: v.optional(v.id("agentRunEvents")),
    actionType: v.union(
      v.literal("place_call"),
      v.literal("send_message"),
      v.literal("spend_money"),
      v.literal("update_record"),
      v.literal("share_sensitive_data"),
      v.literal("external_contact"),
      v.literal("tool_call"),
      v.literal("other")
    ),
    title: v.string(),
    summary: v.string(),
    evidence: v.optional(v.string()),
    proposedToolName: v.optional(v.string()),
    proposedArgumentsSummary: v.optional(v.string()),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    estimatedCostCents: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("expired"),
      v.literal("canceled")
    ),
    requestedByUserId: v.optional(v.string()),
    decidedByUserId: v.optional(v.string()),
    decisionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["workspaceId", "status"])
    .index("by_call", ["callId"])
    .index("by_mission", ["agentMissionId"])
    .index("by_agent_run_event", ["agentRunEventId"]),

  agentLearningExamples: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    transcriptId: v.optional(v.id("transcripts")),
    memoryId: v.optional(v.id("aiMemories")),
    reviewSuggestionId: v.optional(v.id("reviewSuggestions")),
    caseId: v.optional(v.id("cases")),
    contactId: v.optional(v.id("contacts")),
    sourceEvent: v.union(
      v.literal("review_accepted"),
      v.literal("review_dismissed"),
      v.literal("speaker_mapping_corrected"),
      v.literal("memory_updated")
    ),
    status: v.union(v.literal("active"), v.literal("excluded")),
    callType: v.string(),
    language: v.optional(v.string()),
    objective: v.optional(v.string()),
    summary: v.string(),
    outcome: v.optional(v.string()),
    keyFacts: v.array(v.string()),
    acceptedActions: v.array(v.string()),
    dismissedSuggestions: v.array(v.string()),
    speakerCorrections: v.array(v.string()),
    reviewedMeaning: v.optional(reviewedMeaning),
    draftSnapshot: v.optional(aiDraftSnapshot),
    manualNotes: v.optional(v.string()),
    realizedOutcomes: v.optional(v.array(v.string())),
    openFollowUpCount: v.optional(v.number()),
    resolvedFollowUpCount: v.optional(v.number()),
    lastOutcomeAt: v.optional(v.number()),
    retrievalText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_case", ["caseId"])
    .index("by_contact", ["contactId"])
    .index("by_source_event", ["workspaceId", "sourceEvent"])
    .index("by_status", ["workspaceId", "status"]),

  callMemorySearchDocs: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    transcriptId: v.optional(v.id("transcripts")),
    memoryId: v.optional(v.id("aiMemories")),
    caseId: v.optional(v.id("cases")),
    contactId: v.optional(v.id("contacts")),
    docKey: v.string(),
    sourceType: v.union(
      v.literal("overview"),
      v.literal("transcript"),
      v.literal("details"),
      v.literal("follow_up"),
      v.literal("user_notes")
    ),
    title: v.string(),
    body: v.string(),
    snippet: v.string(),
    anchor: v.string(),
    language: v.optional(v.string()),
    callStartedAt: v.string(),
    callStartedAtMs: v.number(),
    processingStatus: v.string(),
    reviewStatus: v.optional(v.string()),
    hasReminder: v.boolean(),
    bodyHash: v.string(),
    embeddingStatus: v.union(
      v.literal("pending"),
      v.literal("embedded"),
      v.literal("skipped"),
      v.literal("failed")
    ),
    embeddingError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_started", ["workspaceId", "callStartedAtMs"])
    .index("by_call", ["callId"])
    .index("by_workspace_doc_key", ["workspaceId", "docKey"])
    .index("by_case", ["caseId"])
    .index("by_contact", ["contactId"])
    .index("by_embedding_status", ["embeddingStatus"])
    .searchIndex("search_body", {
      searchField: "body",
      filterFields: ["workspaceId"],
    }),

  callMemoryEmbeddings: defineTable({
    workspaceId: v.id("workspaces"),
    searchDocId: v.id("callMemorySearchDocs"),
    callId: v.id("calls"),
    model: v.string(),
    dimensions: v.number(),
    embedding: v.array(v.float64()),
    contentHash: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_search_doc", ["searchDocId"])
    .index("by_workspace_search_doc", ["workspaceId", "searchDocId"])
    .index("by_call", ["callId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["workspaceId"],
    }),

  feedbackRequests: defineTable({
    title: v.string(),
    description: v.string(),
    category: v.union(
      v.literal("Call Memory"),
      v.literal("Calling"),
      v.literal("Billing & credits"),
      v.literal("Team workflows"),
      v.literal("Live AI"),
      v.literal("Other")
    ),
    status: v.union(
      v.literal("open"),
      v.literal("planned"),
      v.literal("building"),
      v.literal("shipped"),
      v.literal("closed")
    ),
    voteCount: v.number(),
    createdByWorkspaceId: v.id("workspaces"),
    createdByUserId: v.string(),
    createdByProfileId: v.id("profiles"),
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.boolean(),
  })
    .index("by_archived_created", ["archived", "createdAt"])
    .index("by_archived_status", ["archived", "status"])
    .index("by_category", ["archived", "category"])
    .index("by_creator_workspace", ["createdByWorkspaceId"]),

  feedbackVotes: defineTable({
    requestId: v.id("feedbackRequests"),
    workspaceId: v.id("workspaces"),
    voterUserId: v.string(),
    voterProfileId: v.id("profiles"),
    createdAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_request_workspace", ["requestId", "workspaceId"]),

  transcripts: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    source: v.string(),
    text: v.string(),
    language: v.string(),
    confidence: v.number(),
    segments: v.array(
      v.object({
        speaker: v.string(),
        text: v.string(),
        originalText: v.optional(v.string()),
        translatedText: v.optional(v.string()),
        language: v.optional(v.string()),
        start: v.optional(v.number()),
        end: v.optional(v.number()),
      })
    ),
    transcriptionModel: v.optional(v.string()),
    transcriptionFallbackFrom: v.optional(v.string()),
    transcriptionAttemptCount: v.optional(v.number()),
    transcriptionProvider: v.optional(v.literal("openai")),
    // "channel" = speakers attributed from the telephony channel (ground truth);
    // "diarization" = inferred by the model on a single mixed pass. Makes a
    // silently-always-falling-back per-channel path queryable.
    speakerAttribution: v.optional(
      v.union(v.literal("channel"), v.literal("diarization"))
    ),
    speakerMappings: v.optional(v.array(speakerMapping)),
    originalSpeakerMappings: v.optional(v.array(speakerMapping)),
    speakerMappingsEditedAt: v.optional(v.number()),
    speakerMappingsEditedBy: v.optional(v.string()),
    originalFileName: v.optional(v.string()),
    originalMimeType: v.optional(v.string()),
    originalFileSize: v.optional(v.number()),
    audioStored: v.optional(v.boolean()),
  })
    .index("by_call", ["callId"])
    .index("by_workspace", ["workspaceId"]),

  // One transient mono recording per participant in a translated bridge call.
  // The recordings exist only long enough to build the reviewed Call Record;
  // customer-facing playback and download are intentionally absent.
  bridgeCallRecordings: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    leg: v.union(v.literal("parent"), v.literal("callee")),
    providerCallSid: v.string(),
    recordingSid: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    startedAt: v.number(),
    durationSeconds: v.optional(v.number()),
    status: v.union(
      v.literal("requested"),
      v.literal("recording"),
      v.literal("ready"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("failed")
    ),
    deleteStatus: v.union(
      v.literal("not_ready"),
      v.literal("pending"),
      v.literal("deleted"),
      v.literal("failed")
    ),
    deleteError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_call", ["callId"])
    .index("by_call_leg", ["callId", "leg"])
    .index("by_workspace", ["workspaceId"])
    .index("by_recording_sid", ["recordingSid"]),

  aiMemories: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    caseId: v.optional(v.id("cases")),
    detectedCallType: v.string(),
    summary: v.string(),
    outcome: v.string(),
    confidence: v.number(),
    requiredDocuments: v.array(v.string()),
    highlights: v.array(v.string()),
    reviewStatus: v.string(),
    reviewedMeaning: v.optional(reviewedMeaning),
    promptVersion: v.optional(v.string()),
    model: v.optional(v.string()),
    participants: v.optional(
      v.object({
        caller: v.object({
          name: v.union(v.string(), v.null()),
          roleLabel: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
        representative: v.object({
          name: v.union(v.string(), v.null()),
          roleLabel: v.string(),
          confidence: v.number(),
          institutionName: v.union(v.string(), v.null()),
          evidence: v.union(v.string(), v.null()),
        }),
        institution: v.object({
          name: v.union(v.string(), v.null()),
          type: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
        subject: v.object({
          name: v.union(v.string(), v.null()),
          subjectType: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
      })
    ),
  })
    .index("by_call", ["callId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_case", ["caseId"]),

  extractedEntities: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    caseId: v.optional(v.id("cases")),
    type: v.string(),
    label: v.string(),
    value: v.string(),
    confidence: v.number(),
  })
    .index("by_call", ["callId"])
    .index("by_case", ["caseId"])
    .index("by_workspace", ["workspaceId"]),

  actionItems: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    caseId: v.optional(v.id("cases")),
    title: v.string(),
    description: v.string(),
    dueAt: v.optional(v.string()),
    status: v.string(),
    source: v.string(),
  })
    .index("by_call", ["callId"])
    .index("by_case", ["caseId"])
    .index("by_status", ["workspaceId", "status"]),

  reminders: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    caseId: v.optional(v.id("cases")),
    contactId: v.optional(v.id("contacts")),
    title: v.string(),
    remindAt: v.string(),
    status: v.union(
      v.literal("upcoming"),
      v.literal("overdue"),
      v.literal("in_progress"),
      v.literal("completed")
    ),
    kanbanOrder: v.optional(v.number()),
    source: v.string(),
  })
    .index("by_call", ["callId"])
    .index("by_case", ["caseId"])
    .index("by_status", ["workspaceId", "status"]),

  threadInsights: defineTable({
    workspaceId: v.id("workspaces"),
    caseId: v.id("cases"),
    type: v.string(),
    title: v.string(),
    detail: v.string(),
    status: v.union(v.literal("active"), v.literal("dismissed")),
    evidenceCallIds: v.array(v.id("calls")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["workspaceId", "status"]),

  reviewSuggestions: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    detectedCallType: v.string(),
    summary: v.string(),
    confidence: v.number(),
    status: v.string(),
    suggestedExistingCaseId: v.optional(v.id("cases")),
    suggestedNewCaseTitle: v.optional(v.string()),
    suggestedExistingContactId: v.optional(v.id("contacts")),
    suggestedNewContactName: v.optional(v.string()),
    suggestedNewContactType: v.optional(v.string()),
    suggestedNewContactCountry: v.optional(v.string()),
    suggestedNewContactPhone: v.optional(v.string()),
    reminderTitle: v.optional(v.string()),
    reminderDueAt: v.optional(v.string()),
    entitySuggestions: v.array(
      v.object({
        type: v.string(),
        label: v.string(),
        value: v.string(),
        confidence: v.number(),
      })
    ),
    actionItemSuggestions: v.array(
      v.object({
        title: v.string(),
        description: v.string(),
        dueAt: v.optional(v.string()),
      })
    ),
    promptVersion: v.optional(v.string()),
    model: v.optional(v.string()),
    reviewedMeaning: v.optional(reviewedMeaning),
    draftSnapshot: v.optional(aiDraftSnapshot),
    participants: v.optional(
      v.object({
        caller: v.object({
          name: v.union(v.string(), v.null()),
          roleLabel: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
        representative: v.object({
          name: v.union(v.string(), v.null()),
          roleLabel: v.string(),
          confidence: v.number(),
          institutionName: v.union(v.string(), v.null()),
          evidence: v.union(v.string(), v.null()),
        }),
        institution: v.object({
          name: v.union(v.string(), v.null()),
          type: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
        subject: v.object({
          name: v.union(v.string(), v.null()),
          subjectType: v.string(),
          confidence: v.number(),
          evidence: v.union(v.string(), v.null()),
        }),
      })
    ),
  }).index("by_call", ["callId"]),

  aiExtractionRuns: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    transcriptId: v.optional(v.id("transcripts")),
    reviewSuggestionId: v.optional(v.id("reviewSuggestions")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("validation_failed")
    ),
    source: v.union(
      v.literal("imported_transcript"),
      v.literal("simulated_future"),
      v.literal("provider_transcript_future")
    ),
    promptVersion: v.string(),
    model: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    inputCharCount: v.number(),
    transcriptCharCount: v.number(),
    outputCharCount: v.optional(v.number()),
    tokenUsage: v.optional(
      v.object({
        prompt_tokens: v.optional(v.number()),
        completion_tokens: v.optional(v.number()),
        total_tokens: v.optional(v.number()),
      })
    ),
    estimatedCostUsd: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    validationErrors: v.optional(v.array(v.string())),
    retryOfRunId: v.optional(v.id("aiExtractionRuns")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_status", ["workspaceId", "status"])
    .index("by_retry", ["retryOfRunId"]),

  audioTranscriptionRuns: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.optional(v.id("calls")),
    transcriptId: v.optional(v.id("transcripts")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed")
    ),
    model: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    inputFileName: v.optional(v.string()),
    inputMimeType: v.optional(v.string()),
    inputFileSize: v.optional(v.number()),
    transcriptCharCount: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_status", ["workspaceId", "status"]),

  shadowAgentRuns: defineTable({
    workspaceId: v.id("workspaces"),
    callId: v.id("calls"),
    transcriptId: v.optional(v.id("transcripts")),
    agentRunEventId: v.optional(v.id("agentRunEvents")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("validation_failed")
    ),
    promptVersion: v.string(),
    model: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    inputCharCount: v.number(),
    outputCharCount: v.optional(v.number()),
    tokenUsage: v.optional(
      v.object({
        prompt_tokens: v.optional(v.number()),
        completion_tokens: v.optional(v.number()),
        total_tokens: v.optional(v.number()),
      })
    ),
    estimatedCostUsd: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    validationErrors: v.optional(v.array(v.string())),
    outcomeAgreement: v.optional(v.number()),
    followUpPrecision: v.optional(v.number()),
    followUpRecall: v.optional(v.number()),
    scoredAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_status", ["workspaceId", "status"]),

  walletSummaries: defineTable({
    workspaceId: v.id("workspaces"),
    creditBalance: v.number(),
    currency: v.string(),
    usageThisMonth: v.number(),
    includedMinutes: v.number(),
    subscriptionStatus: v.string(),
    planId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeCurrentPeriodStart: v.optional(v.number()),
    stripeCurrentPeriodEnd: v.optional(v.number()),
    stripeCancelAtPeriodEnd: v.optional(v.boolean()),
    billingEmail: v.optional(v.string()),
    billingAddressLine1: v.optional(v.string()),
    billingAddressLine2: v.optional(v.string()),
    billingAddressCity: v.optional(v.string()),
    billingAddressState: v.optional(v.string()),
    billingAddressPostalCode: v.optional(v.string()),
    billingAddressCountry: v.optional(v.string()),
    businessInvoiceRequested: v.optional(v.boolean()),
    autoTopUpEnabled: v.optional(v.boolean()),
    autoTopUpThresholdCents: v.optional(v.number()),
    autoTopUpAmountCents: v.optional(v.number()),
    stripeDefaultPaymentMethodId: v.optional(v.string()),
    includedCreditBalanceCents: v.optional(v.number()),
    includedCreditGrantedCents: v.optional(v.number()),
    topUpCreditBalanceCents: v.optional(v.number()),
    topUpCreditExpiresAt: v.optional(v.number()),
    reservedCreditCents: v.optional(v.number()),
    lifetimeCreditSpendCents: v.optional(v.number()),
    lastCreditResetAt: v.optional(v.number()),
    freeCallUsed: v.optional(v.boolean()),
    freeCallUsedAt: v.optional(v.number()),
    freeCallUsedCallId: v.optional(v.id("calls")),
    aiFeaturesEnabled: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  stripeWebhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    livemode: v.boolean(),
    stripeCreatedAt: v.number(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    status: v.union(
      v.literal("processed"),
      v.literal("skipped"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
  }).index("by_event", ["eventId"]),

  publicStripeCheckouts: defineTable({
    stripeCheckoutSessionId: v.string(),
    checkoutType: v.union(v.literal("subscription"), v.literal("top_up")),
    planId: v.optional(v.string()),
    topUpId: v.optional(v.string()),
    lookupKey: v.string(),
    amountCents: v.number(),
    claimTokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("claimed"),
      v.literal("expired")
    ),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    claimedWorkspaceId: v.optional(v.id("workspaces")),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
  })
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_status_expires", ["status", "expiresAt"])
    .index("by_claimed_workspace", ["claimedWorkspaceId"]),

  creditLedgerEntries: defineTable({
    workspaceId: v.id("workspaces"),
    walletSummaryId: v.optional(v.id("walletSummaries")),
    callId: v.optional(v.id("calls")),
    reservationId: v.optional(v.id("creditReservations")),
    realtimeUsageEventId: v.optional(v.id("realtimeUsageEvents")),
    externalId: v.optional(v.string()),
    type: v.union(
      v.literal("grant_included"),
      v.literal("grant_top_up"),
      v.literal("reserve"),
      v.literal("settle"),
      v.literal("release"),
      v.literal("expire"),
      v.literal("realtime_charge"),
      v.literal("adjustment")
    ),
    bucket: v.union(
      v.literal("included"),
      v.literal("top_up"),
      v.literal("mixed"),
      v.literal("none")
    ),
    amountCents: v.number(),
    remainingCents: v.optional(v.number()),
    description: v.string(),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_createdAt", ["workspaceId", "createdAt"])
    .index("by_external", ["externalId"])
    .index("by_call", ["callId"])
    .index("by_realtime_usage_event", ["realtimeUsageEventId"]),

  creditReservationAllocations: defineTable({
    workspaceId: v.id("workspaces"),
    reservationId: v.id("creditReservations"),
    sourceLedgerEntryId: v.id("creditLedgerEntries"),
    amountCents: v.number(),
    settledCents: v.optional(v.number()),
    releasedCents: v.optional(v.number()),
    expiredCents: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_reservation", ["reservationId"])
    .index("by_source_ledger", ["sourceLedgerEntryId"])
    .index("by_workspace", ["workspaceId"]),

  creditReservations: defineTable({
    workspaceId: v.id("workspaces"),
    walletSummaryId: v.id("walletSummaries"),
    callId: v.id("calls"),
    status: v.union(
      v.literal("reserved"),
      v.literal("settled"),
      v.literal("released")
    ),
    includedReservedCents: v.number(),
    topUpReservedCents: v.number(),
    reservedCents: v.number(),
    settledCents: v.optional(v.number()),
    releasedCents: v.optional(v.number()),
    rateCentsPerMinute: v.number(),
    reservedSeconds: v.number(),
    settledBillableSeconds: v.optional(v.number()),
    billingIncrementSeconds: v.optional(v.number()),
    minimumBillableSeconds: v.optional(v.number()),
    providerCostCentsPerMinute: v.optional(v.number()),
    aiCaptureCostCentsPerMinute: v.optional(v.number()),
    totalVariableCostCentsPerMinute: v.optional(v.number()),
    marginMultiple: v.optional(v.number()),
    pricingCatalogVersion: v.optional(v.string()),
    quoteBlockReason: v.optional(v.string()),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_call", ["callId"])
    .index("by_status", ["workspaceId", "status"])
    // Global (not workspace-scoped) so the abandoned-reservation sweeper in
    // convex/twilioLifecycle.ts can find stranded credits across every
    // workspace without a full table scan.
    .index("by_status_created", ["status", "createdAt"]),

  demoSettings: defineTable({
    workspaceId: v.id("workspaces"),
    showDemoHints: v.boolean(),
  }).index("by_workspace", ["workspaceId"]),

  launchInterestSignups: defineTable({
    email: v.string(),
    roleSegment: v.optional(v.string()),
    roleSegmentOther: v.optional(v.string()),
    companyType: v.optional(v.string()),
    companyTypeOther: v.optional(v.string()),
    useCase: v.optional(v.string()),
    useCaseOther: v.optional(v.string()),
    source: v.optional(v.string()),
    utmSource: v.optional(v.string()),
    utmMedium: v.optional(v.string()),
    utmCampaign: v.optional(v.string()),
    utmTerm: v.optional(v.string()),
    utmContent: v.optional(v.string()),
    consentTextVersion: v.string(),
    consentedAt: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("unsubscribed"),
      v.literal("blocked")
    ),
    submissionCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_use_case", ["useCase"]),

  emailJobs: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    email: v.string(),
    templateName: v.string(),
    scheduledAt: v.number(),
    sentAt: v.optional(v.number()),
    resendId: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    sequenceName: v.optional(v.string()),
    sequenceStep: v.optional(v.number()),
    metadata: v.optional(v.object({
      freeCallMade: v.optional(v.boolean()),
      firstCallAt: v.optional(v.number()),
      memoryReviewed: v.optional(v.boolean()),
      transcriptImported: v.optional(v.boolean()),
      // Who asked, for the credit-request nudge. This is the first job-specific
      // metadata field that has to survive all the way to the rendered email:
      // convex/emailCron.ts previously built a fresh metadata object per job and
      // dropped `job.metadata` entirely, so it forwards this field explicitly.
      requestedByName: v.optional(v.string()),
    })),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_status_scheduled", ["status", "scheduledAt"])
    .index("by_sequence", ["userId", "sequenceName"]),

  emailLogs: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    email: v.string(),
    templateName: v.string(),
    subject: v.string(),
    sentAt: v.number(),
    resendId: v.optional(v.string()),
    status: v.union(
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("complained"),
      v.literal("opened"),
      v.literal("clicked")
    ),
    openedAt: v.optional(v.number()),
    clickedAt: v.optional(v.number()),
    metadata: v.optional(v.object({
      sequenceName: v.optional(v.string()),
      sequenceStep: v.optional(v.number()),
    })),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_template", ["templateName"])
    .index("by_sent_at", ["sentAt"]),
});
