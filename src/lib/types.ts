export type CallStatus = "completed" | "missed" | "in_progress" | "scheduled";

export type ProcessingStatus = "memory_ready" | "review_pending" | "processing";

export type CaseStatus = "active" | "waiting" | "blocked" | "closed";

export type ContactType =
  | "government"
  | "university"
  | "employer"
  | "insurance"
  | "supplier"
  | "finance"
  | "other";

export type EntityType =
  | "case_number"
  | "reference_number"
  | "claim_number"
  | "invoice_number"
  | "appointment_date"
  | "due_date"
  | "person_name"
  | "institution_name"
  | "amount"
  | "required_document"
  | "next_step"
  | "decision_maker"
  | "verification_outcome"
  | "discrepancy"
  | "interest_level";

export type ReminderStatus = "upcoming" | "overdue" | "in_progress" | "completed";

export type ActionItemStatus = "open" | "in_progress" | "completed";

export type ReviewStatus = "pending" | "accepted" | "dismissed" | "edited";

export type ReviewedMeaningCompleteness =
  | "complete"
  | "partial"
  | "needs_follow_up"
  | "uncertain";

export type ReviewedMeaningSource =
  | "review_accept"
  | "review_dismiss"
  | "memory_update"
  | "speaker_mapping_update";

export interface ReviewedMeaning {
  reviewedObjective?: string;
  outcomeStatus?: string;
  acceptedFollowUps: string[];
  correctedDetails: string[];
  unresolvedQuestions: string[];
  escalationTriggers: string[];
  humanCorrectionSummary?: string;
  playbookHint?: string;
  completeness: ReviewedMeaningCompleteness;
  confidence: number;
  source: ReviewedMeaningSource;
  reviewedAt: number;
}

export interface AiDraftSnapshot {
  detectedCallType?: string;
  summary?: string;
  confidence?: number;
  entities: string[];
  actions: string[];
  reminder?: string;
  participants: string[];
  capturedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  plan: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  workspaceId: string;
}

export interface Contact {
  id: string;
  name: string;
  type: string;
  country: string;
  phoneNumber: string;
  phoneE164?: string;
  lastCallAt?: string;
  relatedCaseIds: string[];
  notes: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Case {
  id: string;
  title: string;
  type: string;
  clientName: string;
  status: string;
  lastCallAt: string;
  nextFollowUpAt?: string;
  callIds: string[];
  contactIds: string[];
  unresolvedActionItemIds: string[];
  summary: string;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  originalText?: string;
  translatedText?: string;
  language?: string;
  start?: number;
  end?: number;
}

export type TranscriptSpeakerRole = "caller" | "representative" | "institution" | "subject" | "other";

export type TranscriptSpeakerMappingSource = "ai_inferred" | "user_edited";

export interface TranscriptSpeakerMapping {
  label: string;
  name: string;
  role: TranscriptSpeakerRole;
  source: TranscriptSpeakerMappingSource;
  confidence?: number;
}

export interface Transcript {
  id: string;
  callId: string;
  source: string;
  text: string;
  language: string;
  confidence: number;
  segments: TranscriptSegment[];
  transcriptionModel?: string;
  transcriptionFallbackFrom?: string;
  transcriptionAttemptCount?: number;
  transcriptionProvider?: "openai";
  speakerMappings?: TranscriptSpeakerMapping[];
  originalSpeakerMappings?: TranscriptSpeakerMapping[];
  speakerMappingsEditedAt?: number;
  speakerMappingsEditedBy?: string;
  originalFileName?: string;
  originalMimeType?: string;
  originalFileSize?: number;
  audioStored?: boolean;
}

export interface ExtractedEntity {
  id: string;
  type: string;
  label: string;
  value: string;
  confidence: number;
  source?: string;
}

export interface ActionItem {
  id: string;
  callId?: string;
  caseId?: string;
  title: string;
  description: string;
  dueAt?: string;
  status: string;
  source: string;
}

export interface Reminder {
  id: string;
  title: string;
  remindAt: string;
  status: ReminderStatus;
  kanbanOrder?: number;
  callId?: string;
  caseId?: string;
  contactId?: string;
  source: string;
}

export interface ParticipantCaller {
  name: string | null;
  roleLabel: string;
  confidence: number;
  evidence: string | null;
}

export interface ParticipantRepresentative {
  name: string | null;
  roleLabel: string;
  confidence: number;
  institutionName: string | null;
  evidence: string | null;
}

export interface ParticipantInstitution {
  name: string | null;
  type: string;
  confidence: number;
  evidence: string | null;
}

export interface ParticipantSubject {
  name: string | null;
  subjectType: string;
  confidence: number;
  evidence: string | null;
}

export interface Participants {
  caller: ParticipantCaller;
  representative: ParticipantRepresentative;
  institution: ParticipantInstitution;
  subject: ParticipantSubject;
}

export interface AIMemory {
  id: string;
  callId: string;
  caseId?: string;
  detectedCallType: string;
  summary: string;
  outcome: string;
  confidence: number;
  requiredDocuments: string[];
  highlights: string[];
  reviewStatus: string;
  reviewedMeaning?: ReviewedMeaning;
  promptVersion?: string;
  model?: string;
  participants?: Participants;
}

export interface Call {
  id: string;
  contactId?: string;
  caseId?: string;
  dialedNumber: string;
  startedAt: string;
  durationSeconds: number;
  status: string;
  processingStatus: string;
  aiMemoryReady: boolean;
  reviewPending: boolean;
  transcriptId?: string;
  memoryId?: string;
  highlights: string[];
  userNotes?: string;
  simulated: boolean;
  callMode?: string;
  bridgeRecordCompleteness?: "complete" | "partial";
  importContext?: string;
  language?: string;
  provider?: string;
  providerCallSid?: string;
  parentCallSid?: string;
  twilioDeviceIdentity?: string;
  callDirection?: string;
  inboundCallingNumberId?: string;
  inboundCallerNumber?: string;
  inboundCalledNumber?: string;
  inboundForwardingNumber?: string;
  inboundVoicemail?: boolean;
  inboundMissedReason?: string;
  callerIdId?: string;
  callerIdNumber?: string;
  callerIdSource?: "twilio_account" | "verified_external" | "rented";
  callerIdLabel?: string;
  endedAt?: string;
  destinationCountry?: string;
  destinationType?: string;
  estimatedCostCents?: number;
  isFreeCall?: boolean;
}

export interface ReviewSuggestion {
  id: string;
  callId: string;
  detectedCallType: string;
  summary: string;
  extractedEntities: ExtractedEntity[];
  suggestedActionItems: ActionItem[];
  suggestedReminder: Reminder;
  suggestedExistingCaseId?: string;
  suggestedNewCaseTitle?: string;
  suggestedContactCreation?: {
    name: string;
    type: ContactType;
    country: string;
    phoneNumber: string;
  };
  confidence: number;
  status?: string;
  reviewedMeaning?: ReviewedMeaning;
  draftSnapshot?: AiDraftSnapshot;
  participants?: Participants;
}

export interface WalletSummary {
  creditBalance: number;
  currency: string;
  usageThisMonth: number;
  includedMinutes: number;
  subscriptionStatus: string;
  planId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  stripeCurrentPeriodStart?: number;
  stripeCurrentPeriodEnd?: number;
  stripeCancelAtPeriodEnd?: boolean;
  billingEmail?: string;
  billingAddressLine1?: string;
  billingAddressLine2?: string;
  billingAddressCity?: string;
  billingAddressState?: string;
  billingAddressPostalCode?: string;
  billingAddressCountry?: string;
  businessInvoiceRequested?: boolean;
  autoTopUpEnabled?: boolean;
  autoTopUpThresholdCents?: number;
  autoTopUpAmountCents?: number;
  stripeDefaultPaymentMethodId?: string;
  includedCreditBalanceCents?: number;
  includedCreditGrantedCents?: number;
  topUpCreditBalanceCents?: number;
  topUpCreditExpiresAt?: number;
  reservedCreditCents?: number;
  lifetimeCreditSpendCents?: number;
  lastCreditResetAt?: number;
  aiFeaturesEnabled?: boolean;
}

export type CallingNumberSource = "twilio_account" | "verified_external" | "rented";
export type CallingNumberStatus =
  | "pending_verification"
  | "verification_failed"
  | "pending_purchase"
  | "purchase_failed"
  | "active"
  | "pending_release"
  | "released"
  | "release_failed";

export interface CallingNumber {
  id: string | null;
  phoneNumber: string;
  label: string;
  source: CallingNumberSource;
  status: CallingNumberStatus;
  isDefault: boolean;
  twilioValidationCode?: string;
  lastVerificationStatus?: string;
  twilioIncomingPhoneNumberSid?: string;
  stripeSubscriptionId?: string;
  isoCountry?: string;
  region?: string;
  locality?: string;
  rentalPriceCents?: number;
  inboundEnabled?: boolean;
  inboundForwardingNumber?: string;
  inboundRingTimeoutSeconds?: number;
  inboundVoicemailEnabled?: boolean;
  inboundVoicemailGreeting?: string;
  inboundAiCaptureEnabled?: boolean;
  inboundRecordingComplianceAttested?: boolean;
  inboundRecordingComplianceAttestedAt?: number;
  inboundSettingsUpdatedAt?: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  releasedAt?: number;
}

export interface DashboardStats {
  totalCalls: number;
  callsNeedingReview: number;
  upcomingReminders: number;
  openActionItems: number;
  activeCases: number;
  walletBalance: string;
  memoryStats: {
    extractedEntities: number;
    remindersSuggested: number;
    documentsDetected: number;
  };
}

export interface PrototypeState {
  workspace: Workspace;
  currentUser: User;
  calls: Call[];
  cases: Case[];
  contacts: Contact[];
  transcripts: Transcript[];
  aiMemories: AIMemory[];
  actionItems: ActionItem[];
  reminders: Reminder[];
  reviewSuggestions: ReviewSuggestion[];
  walletSummary: WalletSummary;
  showDemoHints: boolean;
}
