"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CheckCircle2,
  ContactRound,
  Clock,
  Delete,
  Grid3X3,
  Headphones,
  Languages,
  ListChecks,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { formatDuration } from "@/lib/format";
import { BridgeInactivityNotice } from "@/components/dialer/bridge-inactivity-notice";
import { useQuery, useMutation } from "convex/react";
import { TranslatedTrialNotice } from "@/components/dialer/trial-verification";
import { api } from "@convex/_generated/api";
import {
  destinationRouteLabel,
  formatRateCentsPerMinute,
  getDialerRoutePricing,
} from "@/lib/calling-rates";
import { mapDocs } from "@/lib/convex-helpers";
import { describeResolvedRoute } from "@/lib/rate-prefix-lookup";
import {
  compactDialerCountryLabel,
  dialerCountries,
  dialerCountryLabel,
  inferDialCodeFromLocale,
} from "@/lib/countries";
import { normalizePhoneE164, phoneNumbersMatch } from "@/lib/phone";
import { formatRealtimeMinutes } from "@/lib/realtime-entitlements";
import {
  describeLiveBridgePhase,
  isLiveBridgeStillConnecting,
  liveBridgeEndReason,
} from "@/lib/live-bridge-state";
import {
  DEFAULT_LIVE_TRANSLATION_TARGET_LANGUAGE,
  LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE,
  LIVE_TRANSLATION_LANGUAGES,
  LIVE_TRANSLATION_TARGET_LANGUAGES,
  getPublicVoiceTranslationLanguages,
  getLiveTranslationLanguageLabel,
} from "@/lib/live-translation-languages";
import {
  DEFAULT_TRANSLATED_VOICE_GENDER,
  type TranslatedVoiceGender,
} from "@/lib/live-translation-voices";
import {
  CALL_RECORD_LANGUAGE_AUTO,
  CALL_RECORD_LANGUAGES,
  getCallRecordLanguageLabel,
} from "@/lib/call-record-languages";
import {
  DEFAULT_WORKFLOW_TEMPLATE_KEY,
  workflowTemplates,
  type WorkflowTemplateKey,
} from "@/lib/workflow-templates";
import { useGlobalCall } from "@/components/providers/call-provider";
import { DialerKeypadPopover } from "@/components/dialer/dtmf-keypad";
import { AudioDevicePopover } from "@/components/dialer/audio-device-picker";
import { NetworkQualityDot } from "@/components/dialer/network-quality-dot";
import type { Id } from "@convex/_generated/dataModel";
import type { CallingNumber } from "@/lib/types";

type DashboardDialerPanel = "prep" | "contact" | "callerId" | "live";
type CallType = "standard" | "voice_translation";

// Live Translation caption display: captions below this stored confidence are
// visually flagged (the worker-side authoritative gate is calibrated
// separately), and a pending source line without a translation is marked
// delayed after this long.
const TRANSLATION_LOW_CONFIDENCE_THRESHOLD = 0.5;
const TRANSLATION_DELAYED_AFTER_MS = 5000;
const TRANSLATION_MAX_RENDERED_SEGMENTS = 8;

const SERVER_FAILURE_STATUSES = new Set([
  "call_failed",
  "recording_callback_missing",
  "transcription_failed",
  "failed",
]);

function serverStageForCall(call: { processingStatus: string; aiMemoryReady: boolean }) {
  if (SERVER_FAILURE_STATUSES.has(call.processingStatus)) return "failed";
  if (call.aiMemoryReady) return "ready";
  return "processing";
}

function serverStatusLabel(processingStatus: string) {
  if (processingStatus === "calling") return "Call in progress";
  if (processingStatus === "processing") return "Processing call";
  if (processingStatus === "completed") return "Waiting for AI call record";
  if (processingStatus === "transcript_needed") return "Waiting for recording";
  if (processingStatus === "transcribing") return "Transcribing recording";
  if (processingStatus === "extracting" || processingStatus === "analyzing") return "Creating AI call record";
  if (processingStatus === "memory_ready") return "AI call record ready";
  if (processingStatus === "call_failed") return "Call didn't connect";
  if (processingStatus === "recording_callback_missing") return "Recording missing";
  if (processingStatus === "transcription_failed") return "Transcription failed";
  if (processingStatus === "failed") return "AI extraction failed";
  return processingStatus.replaceAll("_", " ");
}

function processingStepLabel(processingStatus: string) {
  if (processingStatus === "transcript_needed") return "Waiting for recording";
  if (processingStatus === "transcribing") return "Transcribing";
  if (processingStatus === "extracting" || processingStatus === "analyzing") return "Creating AI record";
  return "Processing";
}

// No "+" sublabel on 0: the keypad appends digits after the selected country
// code and has no long-press, so advertising "+" there would be a lie. The
// country selector (and typing/pasting a full +… number) covers international
// entry.
const keypad = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "" },
  { digit: "#", letters: "" },
];

const CONTACT_TYPES = [
  "government",
  "university",
  "employer",
  "insurance",
  "supplier",
  "finance",
  "customer_support",
  "other",
];

function emptyContactForm(phoneNumber = "", countryCode = "+1") {
  return {
    name: "",
    type: "other",
    country: countryCode,
    phoneNumber,
    notes: "",
  };
}

function digitsForCountry(phoneNumber: string, countryCode: string) {
  const compact = phoneNumber.replace(/\s+/g, "");
  if (compact.startsWith(countryCode)) {
    return compact.slice(countryCode.length).replace(/[^0-9*#]/g, "");
  }
  return compact.replace(/^\+\d{1,4}/, "").replace(/[^0-9*#]/g, "");
}

function countryCodeForPhone(phoneNumber: string): string {
  const normalized = normalizePhoneE164(phoneNumber);
  return (
    [...dialerCountries]
      .map(([code]) => code)
      .sort((a, b) => b.length - a.length)
      .find((code) => normalized.startsWith(code)) ?? "+1"
  );
}

const DIALER_COUNTRY_STORAGE_KEY = "voxandra:lastDialerCountryCode";
const RECORDING_CONSENT_STORAGE_KEY = "voxandra:recordingConsentAck";

function hasStoredRecordingConsent(workspaceId: string) {
  try {
    return window.localStorage.getItem(`${RECORDING_CONSENT_STORAGE_KEY}:${workspaceId}`) === "1";
  } catch {
    return false;
  }
}

function storeRecordingConsent(workspaceId: string) {
  try {
    window.localStorage.setItem(`${RECORDING_CONSENT_STORAGE_KEY}:${workspaceId}`, "1");
  } catch {
    // Remembering consent is a convenience; the modal simply shows again.
  }
}

export type PostCallHandoffAction = {
  label: string;
  href: string;
  style: "primary" | "secondary";
};

export type PostCallHandoff = {
  stage: "calling" | "processing" | "ready" | "failed" | "completed";
  title: string;
  phoneNumber: string;
  durationSeconds: number;
  statusLabel: string;
  description: string;
  summary: string | null;
  actions: PostCallHandoffAction[];
};

export function DialerMock({
  variant = "full",
  initialPhoneNumber = "",
  initialContactId = "",
  onCallEnd,
  postCallHandoff = null,
  onDismissPostCall,
}: {
  variant?: "full" | "dashboard";
  initialPhoneNumber?: string;
  initialContactId?: string;
  onCallEnd?: (callId: string) => void;
  postCallHandoff?: PostCallHandoff | null;
  onDismissPostCall?: () => void;
}) {
  const workspace = useQuery(api.profiles.getMyWorkspace);
  const convexContacts = useQuery(api.contacts.getContacts);
  const callingNumbers = useQuery(api.callingNumbers.getCallingNumbers) as
    | CallingNumber[]
    | undefined;
  const twilioSetup = useQuery(api.twilioCalls.getTwilioSetupStatus);
  const freeCallStatus = useQuery(api.twilioCalls.getFreeCallStatus);
  const realtimeUsage = useQuery(api.realtimeUsage.getRealtimeUsageSummary);
  // Real two-leg translation bridge (internal-only, single-workspace test,
  // sub-phase 5b — see AGENTIC_FUTURE.md).
  const bridgeModeAvailability = useQuery(api.translationBridge.getBridgeModeAvailability);
  const spokenTranslationAvailability = useQuery(
    api.browserAudioStream.getSpokenTranslationAvailability
  );
  const updateGuidanceItemStatus = useMutation(api.callGuidance.updateCallGuidanceItemStatus);
  const createContact = useMutation(api.contacts.createContact);
  const {
    call: globalCall,
    startCall: startGlobalCall,
    endCall: endGlobalCall,
    toggleMute,
    setInputDevice,
    setOutputDevice,
    resetCallState,
  } = useGlobalCall();
  const {
    phase,
    muted,
    elapsedSeconds: elapsed,
    remainingSeconds,
    currentCallMaxSeconds,
    currentCallId,
    isFreeCall: currentCallIsFree,
    twilioError,
    micPermission,
    networkQuality,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
  } = globalCall;
  const canStartCall = phase === "idle" || phase === "failed" || phase === "completed";

  function prepareNextCall() {
    resetCallState();
    onDismissPostCall?.();
  }

  const normalizedInitialPhone = normalizePhoneE164(initialPhoneNumber);
  const initialCountryCode = countryCodeForPhone(normalizedInitialPhone || initialPhoneNumber);
  const [countryCode, setCountryCode] = useState<string>(initialCountryCode);
  const [phoneNumber, setPhoneNumber] = useState(normalizedInitialPhone || initialPhoneNumber || initialCountryCode);

  useEffect(() => {
    // Only correct the default when nobody handed us an explicit number to
    // dial (e.g. "Call again" from a contact) — otherwise that number's own
    // country code must win. The +1 fallback above is fixed and SSR-safe;
    // this effect runs post-mount to apply a better guess (remembered choice,
    // then browser locale) without risking the hydration mismatch that
    // reading localStorage/navigator during the initial render would cause.
    if (normalizedInitialPhone || initialPhoneNumber) return;
    let nextCode: string | null = null;
    try {
      nextCode = window.localStorage.getItem(DIALER_COUNTRY_STORAGE_KEY);
    } catch {
      nextCode = null;
    }
    nextCode ??= inferDialCodeFromLocale();
    if (nextCode && nextCode !== countryCode) {
      /* eslint-disable react-hooks/set-state-in-effect -- syncing from
         localStorage/navigator.language, which only exist post-mount. */
      setCountryCode(nextCode);
      setPhoneNumber(nextCode);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // Only ever run once, right after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [objective, setObjective] = useState("");
  const [plannedChecklist, setPlannedChecklist] = useState<string[]>([]);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [workflowTemplateKey, setWorkflowTemplateKey] = useState<WorkflowTemplateKey>(DEFAULT_WORKFLOW_TEMPLATE_KEY);
  const [callRecordLanguagePreference, setCallRecordLanguagePreference] = useState(
    CALL_RECORD_LANGUAGE_AUTO
  );
  const [enableLiveCopilot, setEnableLiveCopilot] = useState(false);
  const [callType, setCallType] = useState<CallType>("standard");
  const [enableTranslatedCaptions, setEnableTranslatedCaptions] = useState(false);
  // Live Audio Translation (internal-only, single-workspace test — see
  // AGENTIC_FUTURE.md).
  const [enableSpokenTranslation, setEnableSpokenTranslation] = useState(false);
  // Real two-leg translation bridge (internal-only, single-workspace test,
  // sub-phase 5b — see AGENTIC_FUTURE.md). Deliberately not styled like the
  // real toggles above it — placeholder wiring for the internal bridge test,
  // replaced by a proper toggle in sub-phase 5c.
  const [callerTranslatedVoice, setCallerTranslatedVoice] =
    useState<TranslatedVoiceGender>(DEFAULT_TRANSLATED_VOICE_GENDER);
  const [calledPersonTranslatedVoice, setCalledPersonTranslatedVoice] =
    useState<TranslatedVoiceGender>(DEFAULT_TRANSLATED_VOICE_GENDER);
  const [translatedCaptionsSourceLanguage, setTranslatedCaptionsSourceLanguage] = useState(
    "es"
  );
  const [translatedCaptionsTargetLanguage, setTranslatedCaptionsTargetLanguage] = useState(
    DEFAULT_LIVE_TRANSLATION_TARGET_LANGUAGE
  );
  const [translationTargetManuallyChanged, setTranslationTargetManuallyChanged] = useState(false);
  const [contactId, setContactId] = useState(initialContactId);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [showSaveContact, setShowSaveContact] = useState(false);
  const [contactForm, setContactForm] = useState(emptyContactForm(normalizedInitialPhone || initialPhoneNumber, initialCountryCode));
  const [savingContact, setSavingContact] = useState(false);
  const [contactError, setContactError] = useState("");
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);
  const [callPrepOpen, setCallPrepOpen] = useState(variant === "full");
  const [dashboardPanel, setDashboardPanel] = useState<DashboardDialerPanel>("prep");
  const [prepChecklistOpen, setPrepChecklistOpen] = useState(false);
  const [prepBriefOpen, setPrepBriefOpen] = useState(false);
  const [showRecordingConsent, setShowRecordingConsent] = useState(false);
  const [rememberRecordingConsent, setRememberRecordingConsent] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const translationScrollRef = useRef<HTMLDivElement | null>(null);

  const contacts = useMemo(() => (convexContacts ? mapDocs(convexContacts) : []), [convexContacts]);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === contactId),
    [contactId, contacts]
  );
  const matchedContact = useMemo(
    () =>
      contacts.find((contact) =>
        phoneNumbersMatch(contact.phoneE164 || contact.phoneNumber, phoneNumber)
      ),
    [contacts, phoneNumber]
  );
  const activeContact = selectedContact &&
    phoneNumbersMatch(selectedContact.phoneE164 || selectedContact.phoneNumber, phoneNumber)
      ? selectedContact
      : matchedContact;
  const activeCallingNumbers = useMemo(
    () => (callingNumbers ?? []).filter((number) => number.status === "active"),
    [callingNumbers]
  );
  const hasManagedCallerId = useMemo(
    () =>
      activeCallingNumbers.some(
        (number) => number.source === "verified_external" || number.source === "rented"
      ),
    [activeCallingNumbers]
  );
  const showCallerIdUpsell =
    variant === "dashboard" &&
    activeCallingNumbers.length === 1 &&
    activeCallingNumbers[0]?.source === "twilio_account";
  const defaultCallingNumber = useMemo(
    () => activeCallingNumbers.find((number) => number.isDefault),
    [activeCallingNumbers]
  );
  const effectiveSelectedCallerId = selectedCallerId ?? defaultCallingNumber?.id ?? "";
  const selectedCallingNumber = useMemo(
    () =>
      activeCallingNumbers.find((number) =>
        number.id ? number.id === effectiveSelectedCallerId : effectiveSelectedCallerId === ""
      ) ?? activeCallingNumbers.find((number) => number.isDefault),
    [activeCallingNumbers, effectiveSelectedCallerId]
  );
  const phoneDigits = digitsForCountry(phoneNumber, countryCode);
  const selectedCountryLabel = dialerCountryLabel(countryCode);
  const selectedCountryCompactLabel = compactDialerCountryLabel(countryCode, selectedCountryLabel);
  const routePricing = getDialerRoutePricing(countryCode);
  const normalizedPhoneNumber = normalizePhoneE164(phoneNumber);
  const freeCallEligible = freeCallStatus?.eligible === true;
  const freeCallUsed = freeCallStatus?.used === true;
  const freeCallMaxSeconds = freeCallStatus?.maxSeconds ?? 90;
  const callsOnlyMode = realtimeUsage?.planId === "calls_only";
  const liveTranslationCanStart = Boolean(
    !freeCallEligible && realtimeUsage?.translatedCaptions.canStart
  );
  const voiceTranslationFeature = realtimeUsage?.translatedAudio;
  const translatedTrial = freeCallEligible && freeCallStatus?.translatedTrialEnabled === true;
  const voiceTranslationSelected = translatedTrial || callType === "voice_translation";
  const translationSourceChoices = voiceTranslationSelected ? getPublicVoiceTranslationLanguages(true) : LIVE_TRANSLATION_LANGUAGES;
  const translationTargetChoices = voiceTranslationSelected ? getPublicVoiceTranslationLanguages() : LIVE_TRANSLATION_TARGET_LANGUAGES;
  const voiceTranslationCanStart = Boolean(
    bridgeModeAvailability?.available && (translatedTrial || voiceTranslationFeature?.canStart)
  );
  const liveTranslationEnabledForNextCall = Boolean(
    translatedTrial || (liveTranslationCanStart && enableTranslatedCaptions)
  );
  const liveTranslationLanguageError =
    liveTranslationEnabledForNextCall && (
      (translatedTrial && translatedCaptionsSourceLanguage === LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE) ||
      translatedCaptionsSourceLanguage === translatedCaptionsTargetLanguage)
      ? "Choose two different languages for Live Translation."
      : "";
  const trialBlocked = translatedTrial && !voiceTranslationCanStart;
  const liveTranslationSourceLabel = getLiveTranslationLanguageLabel(
    translatedCaptionsSourceLanguage
  );
  const liveTranslationTargetLabel = getLiveTranslationLanguageLabel(
    translatedCaptionsTargetLanguage
  );
  const liveTranslationDirectionLabel = `${liveTranslationSourceLabel} -> ${liveTranslationTargetLabel}`;
  const hasEnoughDigitsForRateEstimate = phoneDigits.replace(/[^0-9]/g, "").length >= 4;
  const rateEstimate = useQuery(
    api.twilioCalls.estimateDestinationRate,
    normalizedPhoneNumber && hasEnoughDigitsForRateEstimate
      ? {
          phoneNumber: normalizedPhoneNumber,
          callerIdId: effectiveSelectedCallerId
            ? (effectiveSelectedCallerId as Id<"callingNumbers">)
            : undefined,
        }
      : "skip"
  );
  const preCallBrief = useQuery(
    api.callPreparation.getPreCallBrief,
    canStartCall
      ? {
          phoneNumber: normalizedPhoneNumber || phoneNumber.trim() || undefined,
          contactId: activeContact?.id
            ? (activeContact.id as Id<"contacts">)
            : undefined,
          workflowTemplateKey,
        }
      : "skip"
  );
  const guidanceItems = useQuery(
    api.callGuidance.listCallGuidanceItems,
    currentCallId ? { callId: currentCallId } : "skip"
  );
  const translationSegments = useQuery(
    api.realtimeRuntime.listTranslationSegments,
    currentCallId && enableTranslatedCaptions ? { callId: currentCallId } : "skip"
  );
  const realtimeSessions = useQuery(
    api.realtimeRuntime.listRealtimeSessionsForCall,
    currentCallId && enableTranslatedCaptions ? { callId: currentCallId } : "skip"
  );
  const translationSession = realtimeSessions
    ?.filter((session) => session.mode === "translated_captions")
    .at(-1);
  // Voice Translation only: what the OTHER person's leg is doing. Kept
  // subscribed through the completed phase so a busy / no-answer outcome can
  // be named on the post-call card instead of a generic "Call completed".
  const liveBridgeState = useQuery(
    api.translationBridge.getLiveBridgeState,
    currentCallId && phase !== "idle" ? { callId: currentCallId } : "skip"
  );
  const liveBridgePhase = liveBridgeState?.calleePhase;

  // Once a call moves into the provider teardown / processing phase, subscribe
  // to the server-side call record so the card can reflect real backend status
  // even if the local Twilio state machine is slow to fire the disconnect event.
  const currentCall = useQuery(
    api.calls.getCallById,
    currentCallId && (phase === "processing" || phase === "completed")
      ? { id: currentCallId }
      : "skip"
  );
  const currentCallMemory = useQuery(
    api.aiMemories.getAIMemoryByCallId,
    currentCallId && currentCall?.aiMemoryReady ? { callId: currentCallId } : "skip"
  );

  // Ticks once per second while Live Translation is active so pending
  // captions can surface a "delayed" state without extra Convex writes.
  const [translationNowTick, setTranslationNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!enableTranslatedCaptions || translationSession?.status !== "active") return;
    const interval = setInterval(() => setTranslationNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [enableTranslatedCaptions, translationSession?.status]);

  useEffect(() => {
    const node = translationScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [translationSegments]);

  const contactOptions = useMemo(() => {
    const needle = contactSearch.trim().toLowerCase();
    return [...contacts]
      .filter((contact) => {
        if (!needle) return true;
        return [contact.name, contact.phoneNumber, contact.country, contact.type, contact.notes]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        const aTime = a.lastCallAt ? new Date(a.lastCallAt).getTime() : 0;
        const bTime = b.lastCallAt ? new Date(b.lastCallAt).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [contactSearch, contacts]);

  function setDialerPhoneNumber(nextPhoneNumber: string) {
    setPhoneNumber(nextPhoneNumber);
    const nextCountryCode = countryCodeForPhone(nextPhoneNumber);
    if (nextCountryCode !== countryCode) {
      setCountryCode(nextCountryCode);
    }
  }

  function changeCountry(nextCountryCode: string) {
    setCountryCode(nextCountryCode);
    setPhoneNumber(`${nextCountryCode}${phoneDigits}`);
    try {
      window.localStorage.setItem(DIALER_COUNTRY_STORAGE_KEY, nextCountryCode);
    } catch {
      // Remembering the country is a convenience, not a requirement.
    }
  }

  function changePhoneDigits(value: string) {
    const cleaned = value.replace(/[^0-9*#+]/g, "");
    if (cleaned.startsWith("+")) {
      setDialerPhoneNumber(cleaned);
      return;
    }
    setPhoneNumber(`${countryCode}${cleaned.replace(/[^0-9*#]/g, "")}`);
  }

  function appendDigit(value: string) {
    const nextDigits = `${phoneDigits}${value}`;
    setPhoneNumber(`${countryCode}${nextDigits}`);
  }

  function removeLastDigit() {
    setPhoneNumber(`${countryCode}${phoneDigits.slice(0, -1)}`);
  }

  function clearDigits() {
    setPhoneNumber(countryCode);
  }

  function selectContact(contact: {
    id: string;
    name: string;
    phoneNumber: string;
    phoneE164?: string;
  }) {
    const nextPhoneNumber = contact.phoneE164 || normalizePhoneE164(contact.phoneNumber) || contact.phoneNumber;
    setContactId(contact.id);
    setDialerPhoneNumber(nextPhoneNumber);
    setShowContactPicker(false);
    setShowSaveContact(false);
    setContactError("");
  }

  function openSaveContact() {
    const phoneForContact = normalizedPhoneNumber || phoneNumber.trim();
    setContactForm(emptyContactForm(phoneForContact, countryCode));
    setShowSaveContact(true);
    setShowContactPicker(false);
    setContactError("");
  }

  async function saveDialerContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingContact(true);
    setContactError("");
    try {
      const newContactId = await createContact(contactForm);
      setContactId(String(newContactId));
      setDialerPhoneNumber(contactForm.phoneNumber);
      setShowSaveContact(false);
      setContactSearch("");
    } catch (caught) {
      setContactError(caught instanceof Error ? caught.message : "Could not save contact.");
    } finally {
      setSavingContact(false);
    }
  }

  async function startCall() {
    if (!phoneNumber.trim() || !workspace || !canStartCall || freeCallStatus === undefined) {
      return;
    }
    if (trialBlocked) return;
    if (liveTranslationLanguageError) {
      return;
    }
    if (hasStoredRecordingConsent(String(workspace._id))) {
      await confirmRecordingConsent();
      return;
    }
    setShowRecordingConsent(true);
  }

  async function confirmRecordingConsent() {
    setShowRecordingConsent(false);
    const outboundPhoneNumber = normalizedPhoneNumber || phoneNumber.trim();
    if (!outboundPhoneNumber || !workspace || !canStartCall) {
      return;
    }
    if (rememberRecordingConsent) {
      storeRecordingConsent(String(workspace._id));
    }
    const startAsFreeCall = freeCallEligible;
    if (translatedTrial) {
      if (!voiceTranslationCanStart || liveTranslationLanguageError) return;
      setCallType("voice_translation");
      setEnableTranslatedCaptions(true);
    }
    const startWithTranslatedCaptions = Boolean(
      (translatedTrial || !startAsFreeCall) &&
        ((voiceTranslationSelected && voiceTranslationCanStart) ||
          (realtimeUsage?.translatedCaptions.canStart && enableTranslatedCaptions))
    );
    const startWithSpokenTranslation = Boolean(
      !startAsFreeCall && startWithTranslatedCaptions &&
        spokenTranslationAvailability?.available &&
        enableSpokenTranslation
    );
    // Real two-leg translation bridge (internal-only, single-workspace test,
    // sub-phase 5b — see AGENTIC_FUTURE.md).
    const startWithBridgeMode = Boolean(
      startWithTranslatedCaptions &&
        bridgeModeAvailability?.available &&
        voiceTranslationSelected &&
        translatedCaptionsSourceLanguage !== LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE
    );
    await startGlobalCall({
      phoneNumber: outboundPhoneNumber,
      displayName: activeContact?.name ?? outboundPhoneNumber,
      contactId: (activeContact?.id || undefined) as Id<"contacts"> | undefined,
      objective: objective || undefined,
      checklistItems: plannedChecklist.length > 0 ? plannedChecklist : undefined,
      workflowTemplateKey,
      callRecordLanguagePreference,
      enableLiveCopilot: Boolean(
        !startAsFreeCall &&
          realtimeUsage?.liveCopilot.canStart &&
          (enableLiveCopilot || voiceTranslationSelected)
      ),
      enableTranslatedCaptions: startWithTranslatedCaptions,
      enableSpokenTranslation: startWithSpokenTranslation,
      enableBridgeMode: startWithBridgeMode,
      callerTranslatedVoice,
      calledPersonTranslatedVoice,
      translatedCaptionsSourceLanguage: startWithTranslatedCaptions
        ? translatedCaptionsSourceLanguage
        : undefined,
      translatedCaptionsTargetLanguage: startWithTranslatedCaptions
        ? translatedCaptionsTargetLanguage
        : undefined,
      callerIdId: selectedCallingNumber?.id ? (selectedCallingNumber.id as Id<"callingNumbers">) : undefined,
      isFreeCall: startAsFreeCall ? true : undefined,
      onCallEnd,
    });
  }

  const phaseCopy = {
    idle: "Ready to call",
    connecting: "Connecting...",
    ringing: "Ringing destination...",
    in_call: "In call",
    processing: "Ending call...",
    completed: "Call completed",
    failed: "Call failed",
  }[phase];

  const startLabel = freeCallEligible ? "Start free trial call" : "Start call";
  const showTwilioSetupWarning =
    twilioSetup &&
    (!twilioSetup.enabled || !twilioSetup.configured || !twilioSetup.hasDestinationAllowlist);
  const routeQuoteBlocksCall =
    !freeCallEligible &&
    hasEnoughDigitsForRateEstimate &&
    (rateEstimate === undefined || rateEstimate.available === false);
  const canSaveCurrentNumber = Boolean((normalizedPhoneNumber || phoneNumber.trim()) && !activeContact && phoneDigits.length >= 4);
  // Why the start button is disabled, stated right next to it — a dead button
  // with the explanation in a distant banner reads as broken.
  const startDisabledReason = trialBlocked
    ? "Live Voice Translation is not available for this workspace right now."
    : showTwilioSetupWarning
    ? "Browser calling setup is incomplete — see the notice above."
    : freeCallStatus === undefined
      ? "Checking your trial status…"
      : rateEstimate === undefined && routeQuoteBlocksCall
        ? "Checking the calling rate for this number…"
        : routeQuoteBlocksCall
          ? "Calls to this number aren't available right now — see the rate notice above."
          : liveTranslationLanguageError
            ? liveTranslationLanguageError
            : "";

  function renderStartDisabledReason(compact = false) {
    if (!startDisabledReason) return null;
    return (
      <p
        className={
          compact
            ? "mx-auto mt-3 w-full max-w-[18rem] text-center text-xs leading-5 text-stone-500 dark:text-stone-400"
            : "text-xs leading-5 text-stone-500 dark:text-stone-400"
        }
      >
        {startDisabledReason}
      </p>
    );
  }

  function renderContactTools(compact = false, flush = false) {
    // Dashboard Contacts tab (flush): always show the list — no extra "Contacts" toggle.
    const showContactButton = !compact && !flush;
    const showSaveButton = canSaveCurrentNumber;
    const pickerOpen = flush || showContactPicker;
    const hasContactTools =
      activeContact || showContactButton || showSaveButton || pickerOpen || showSaveContact;

    if (!hasContactTools) return null;

    return (
      <div className={compact ? "mx-auto mt-3 w-full max-w-[28rem]" : flush ? "" : "mt-5"}>
        {activeContact ? (
          <div
            className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-violet-950 dark:text-violet-100 ${
              flush ? "bg-violet-50/70 dark:bg-violet-950/30" : "border border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30"
            }`}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <ContactRound aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-400" />
              <span className="truncate font-semibold">{activeContact.name}</span>
              <span className="hidden font-mono text-xs text-violet-700 dark:text-violet-400 sm:inline">
                {activeContact.phoneNumber}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setContactId("");
                setShowContactPicker(true);
              }}
              className="rounded-full px-2 py-1 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40"
            >
              Clear
            </button>
          </div>
        ) : null}

        {showContactButton || showSaveButton ? (
          <div className="flex flex-wrap gap-2">
            {showContactButton ? (
              <button
                type="button"
                onClick={() => {
                  setShowContactPicker((value) => !value);
                  setShowSaveContact(false);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
              >
                <Search aria-hidden="true" className="h-4 w-4" />
                {activeContact ? "Change contact" : "Contacts"}
              </button>
            ) : null}
            {showSaveButton ? (
              <button
                type="button"
                onClick={openSaveContact}
                className="inline-flex items-center gap-2 rounded-md bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-800 transition hover:bg-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/60"
              >
                <UserPlus aria-hidden="true" className="h-4 w-4" />
                Save contact
              </button>
            ) : null}
          </div>
        ) : null}

        {pickerOpen ? (
          <div className={`${showContactButton || showSaveButton || activeContact ? "mt-3" : ""} rounded-lg border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900`}>
            <label className="flex h-10 items-center gap-2 rounded-md border border-stone-300 px-3 dark:border-stone-700">
              <Search aria-hidden="true" className="h-4 w-4 text-stone-400" />
              <input
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Search saved contacts"
                className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none dark:text-stone-100"
                autoFocus={flush}
              />
            </label>
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {contactOptions.length > 0 ? (
                contactOptions.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => selectContact(contact)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition hover:bg-violet-50 dark:hover:bg-violet-950/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-stone-950 dark:text-stone-50">{contact.name}</span>
                      <span className="block truncate font-mono text-xs text-stone-500 dark:text-stone-400">{contact.phoneNumber}</span>
                    </span>
                    <ContactRound aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-sm text-stone-500 dark:text-stone-400">No saved contacts found.</p>
              )}
            </div>
          </div>
        ) : null}

        {showSaveContact ? (
          <form onSubmit={saveDialerContact} className="mt-3 grid gap-3 rounded-lg border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900 dark:bg-violet-950/20">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Name</span>
                <input
                  value={contactForm.name}
                  onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })}
                  className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="Office or person"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Phone</span>
                <input
                  value={contactForm.phoneNumber}
                  onChange={(event) => setContactForm({ ...contactForm, phoneNumber: event.target.value })}
                  className="h-10 rounded-md border border-stone-300 bg-white px-3 font-mono text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Type</span>
                <select
                  value={contactForm.type}
                  onChange={(event) => setContactForm({ ...contactForm, type: event.target.value })}
                  className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                >
                  {CONTACT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Country</span>
                <input
                  value={contactForm.country}
                  onChange={(event) => setContactForm({ ...contactForm, country: event.target.value })}
                  className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                />
              </label>
            </div>
            {contactError ? <p className="text-sm text-rose-700 dark:text-rose-400">{contactError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={savingContact}
                className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
              >
                {savingContact ? "Saving..." : "Save contact"}
              </button>
              <button
                type="button"
                onClick={() => setShowSaveContact(false)}
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    );
  }

  function renderPhoneNumberInput(compact = false) {
    const gridClass = compact
      ? "mx-auto mt-2 grid w-full max-w-[28rem] grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 sm:grid-cols-[6.75rem_minmax(6rem,1fr)_2.5rem]"
      : "grid w-full grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 sm:grid-cols-[7rem_minmax(6rem,1fr)_2.5rem]";
    const countryClass = compact
      ? "relative flex h-12 items-center rounded-full border border-stone-200 bg-white px-4 pr-9 text-sm font-semibold text-stone-800 shadow-sm shadow-stone-950/5 transition focus-within:border-violet-300 focus-within:ring-4 focus-within:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
      : "relative flex h-12 items-center rounded-lg border border-stone-300 bg-surface-muted px-4 pr-9 text-sm font-semibold text-stone-800 transition focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-100 dark:border-stone-700 dark:text-stone-200";
    const inputClass = compact
      ? "h-12 w-full rounded-full border border-stone-200 bg-white px-4 font-mono text-lg text-stone-950 shadow-sm shadow-stone-950/5 outline-none transition placeholder:text-sm placeholder:text-stone-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
      : "h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-4 font-mono text-base text-stone-950 outline-none transition placeholder:text-sm placeholder:text-stone-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50";

    const controls = (
      <div className={gridClass}>
        <label className="col-start-1 row-start-1 min-w-0">
          <span className="sr-only">Country code</span>
          <span className={countryClass}>
            <span aria-hidden="true" className="truncate">
              {selectedCountryCompactLabel}
            </span>
            <select
              value={countryCode}
              onChange={(event) => changeCountry(event.target.value)}
              title={selectedCountryLabel}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {dialerCountries.map(([code, label]) => (
                <option key={`${label}-${code}`} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600 dark:text-stone-400"
            />
          </span>
        </label>

        <label className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <span className="sr-only">Phone number</span>
          <input
            value={phoneDigits}
            onChange={(event) => changePhoneDigits(event.target.value)}
            className={inputClass}
            placeholder="Enter number"
            inputMode="tel"
            autoComplete="off"
          />
        </label>

        <button
          type="button"
          onClick={clearDigits}
          className="col-start-2 row-start-1 flex h-10 w-10 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200 sm:col-start-3"
          aria-label="Clear phone number"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    );

    if (compact) return controls;

    return (
      <div className="grid gap-2">
        <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Phone number</span>
        {controls}
      </div>
    );
  }

  function renderRateEstimate(compact = false) {
    const countryRouteCopy = `${routePricing.routeLabel} route · ${formatRateCentsPerMinute(routePricing.rateCentsPerMinute)} from calling credits`;

    const baseClass = compact
      ? "mx-auto mt-2 w-full max-w-[28rem] rounded-full px-4 py-2 text-center text-xs"
      : "rounded-lg border px-3 py-2 text-sm";

    if (freeCallEligible) {
      const routeLabel = rateEstimate?.available
        ? `${destinationRouteLabel(rateEstimate.destinationCountry)} route`
        : routePricing.routeLabel;
      return (
        <p className={`${baseClass} border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300`}>
          {freeCallMaxSeconds}-second trial · used when call starts · {routeLabel} · no credits charged
        </p>
      );
    }

    if (!hasEnoughDigitsForRateEstimate) {
      return (
        <p className={`${baseClass} border border-teal-100 bg-teal-50 text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-300`}>
          {countryRouteCopy}
        </p>
      );
    }

    if (rateEstimate === undefined) {
      return (
        <p className={`${baseClass} border border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400`}>
          Checking Voxandra calling rate...
        </p>
      );
    }

    if (!rateEstimate.available) {
      return (
        <p className={`${baseClass} border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300`}>
          {rateEstimate.reason}
        </p>
      );
    }

    const minimumChargeCents =
      rateEstimate.minimumChargeCents ?? rateEstimate.rateCentsPerMinute ?? 0;
    const minimumCharge = `$${(minimumChargeCents / 100).toFixed(2)}`;

    return (
      <p className={`${baseClass} border border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-300`}>
        {freeCallUsed ? "Free trial used · " : ""}
        {/* Name the tier once the number identifies one. A country label alone
            cannot explain why two numbers in the same country differ by 16x. */}
        {rateEstimate.rateTier
          ? describeResolvedRoute(
              destinationRouteLabel(rateEstimate.destinationCountry),
              rateEstimate.rateTier
            )
          : `${destinationRouteLabel(rateEstimate.destinationCountry)} route`}{" "}
        · {formatRateCentsPerMinute(rateEstimate.rateCentsPerMinute)}
        {/* Until the route is settled, more digits can still change the price. */}
        {rateEstimate.rateSettled ? "" : " so far"} · 60-second minimum ({minimumCharge}) ·
        started-minute billing
      </p>
    );
  }

  function renderCallerIdSelector(compact = false) {
    if (!activeCallingNumbers.length) return null;

    return (
      <div className={compact ? "mx-auto mt-3 grid w-full max-w-[28rem] gap-1.5" : "grid gap-2"}>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
            <PhoneForwarded aria-hidden="true" className="h-4 w-4 text-violet-600" />
            From
          </span>
          {hasManagedCallerId ? (
            <Link
              href="/app/wallet#calling-numbers"
              className="text-xs font-semibold text-violet-700 transition hover:text-violet-900"
            >
              Manage
            </Link>
          ) : null}
        </div>
        <select
          aria-label="Caller ID"
          value={effectiveSelectedCallerId}
          onChange={(event) => setSelectedCallerId(event.target.value)}
          className={
            compact
              ? "h-11 rounded-full border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              : "h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
          }
        >
          {activeCallingNumbers.map((number) => (
            <option key={number.id ?? "twilio-account"} value={number.id ?? ""}>
              {number.label} · {number.phoneNumber}
            </option>
          ))}
        </select>
        {showCallerIdUpsell ? (
          <div className="rounded-lg border border-violet-100 bg-violet-50/80 px-3 py-2 text-left dark:border-violet-900 dark:bg-violet-950/20">
            <p className="text-xs font-semibold text-violet-950 dark:text-violet-200">
              Want recipients to see your own number?
            </p>
            <p className="mt-1 text-xs leading-5 text-violet-800 dark:text-violet-300">
              Verify a number or rent a US/Canada Voxandra number for $3/mo.
            </p>
            <Link
              href="/app/wallet#calling-numbers"
              className="mt-2 inline-flex text-xs font-semibold text-violet-950 underline-offset-4 transition hover:underline dark:text-violet-200"
            >
              Manage caller ID
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  function renderWorkflowTemplateSelector(compact = false) {
    return (
      <label className={compact ? "mx-auto mt-3 grid w-full max-w-[28rem] gap-1.5" : "grid gap-2"}>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
          <ListChecks aria-hidden="true" className="h-4 w-4 text-violet-600" />
          Call type
        </span>
        <select
          value={workflowTemplateKey}
          onChange={(event) => setWorkflowTemplateKey(event.target.value as WorkflowTemplateKey)}
          className={
            compact
              ? "h-11 rounded-full border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              : "h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
          }
        >
          {workflowTemplates.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </select>
        <span className="text-xs leading-5 text-stone-500 dark:text-stone-400">
          Shapes the call record structure and suggests checklist items.
        </span>
      </label>
    );
  }

  function renderObjectiveInput(compact = false) {
    return (
      <label className={compact ? "mx-auto mt-3 grid w-full max-w-[28rem] gap-1.5" : "grid gap-2"}>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-violet-600" />
          What do you need from this call?
        </span>
        <textarea
          value={objective}
          onChange={(event) => {
            setObjective(event.target.value);
          }}
          className={
            compact
              ? "min-h-20 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              : "min-h-24 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-800 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
          }
          placeholder="Confirm status, owner, blocker, and next follow-up date."
        />
        <span className="text-xs leading-5 text-stone-500 dark:text-stone-400">
          Optional context for Live Guidance and the post-call review.
        </span>
      </label>
    );
  }

  function renderCallRecordLanguageSelector(compact = false) {
    function changeCallRecordLanguage(nextLanguage: string) {
      setCallRecordLanguagePreference(nextLanguage);
      if (
        nextLanguage !== CALL_RECORD_LANGUAGE_AUTO &&
        !translationTargetManuallyChanged &&
        translationTargetChoices.some((language) => language.code === nextLanguage)
      ) {
        setTranslatedCaptionsTargetLanguage(nextLanguage);
      }
    }

    return (
      <label className={compact ? "mx-auto mt-3 grid w-full max-w-[28rem] gap-1.5" : "grid gap-2"}>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
          <Languages aria-hidden="true" className="h-4 w-4 text-violet-600" />
          Call record language
        </span>
        <select
          value={callRecordLanguagePreference}
          onChange={(event) => changeCallRecordLanguage(event.target.value)}
          className={
            compact
              ? "h-11 rounded-full border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              : "h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
          }
        >
          <option value={CALL_RECORD_LANGUAGE_AUTO}>
            {getCallRecordLanguageLabel(CALL_RECORD_LANGUAGE_AUTO)}
          </option>
          {CALL_RECORD_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
        <span className="text-xs leading-5 text-stone-500 dark:text-stone-400">
          Auto uses your speech, not the other person&apos;s language or Live Translation.
        </span>
      </label>
    );
  }

  function addChecklistItem(raw: string) {
    const label = raw.trim().replace(/\.$/, "").slice(0, 180);
    if (!label) return;
    setPlannedChecklist((items) =>
      items.includes(label) || items.length >= 12 ? items : [...items, label]
    );
    setChecklistDraft("");
    setPrepChecklistOpen(true);
  }

  function renderPrepCollapsible({
    title,
    icon,
    open,
    onToggle,
    summary,
    children,
  }: {
    title: string;
    icon: ReactNode;
    open: boolean;
    onToggle: () => void;
    summary?: string;
    children: ReactNode;
  }) {
    return (
      <div className="rounded-xl border border-stone-200 bg-surface p-3 dark:border-stone-800">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
            {icon}
            <span className="truncate">{title}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
            {summary ? <span className="max-w-[8rem] truncate">{summary}</span> : null}
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>
        {open ? <div className="mt-3">{children}</div> : null}
      </div>
    );
  }

  function renderChecklistEditor(compact = false, options?: { hideHeader?: boolean }) {
    const template = workflowTemplates.find((item) => item.key === workflowTemplateKey);
    const suggestions = (template?.checklist ?? [])
      .map((item) => item.replace(/\.$/, ""))
      .filter((item) => !plannedChecklist.includes(item))
      .slice(0, 4);
    const inputClass = compact
      ? "h-11 min-w-0 flex-1 rounded-full border border-stone-300 bg-white px-4 text-sm text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
      : "h-11 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200";

    return (
      <div className={compact ? "mx-auto mt-3 grid w-full max-w-[28rem] gap-1.5" : "grid gap-2"}>
        {!options?.hideHeader ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
            <ListChecks aria-hidden="true" className="h-4 w-4 text-violet-600" />
            Call checklist
          </span>
        ) : null}
        {plannedChecklist.length > 0 ? (
          <ul className="grid gap-1.5">
            {plannedChecklist.map((item) => (
              <li
                key={item}
                className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              >
                <span className="min-w-0 break-words">{item}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPlannedChecklist((items) => items.filter((value) => value !== item))
                  }
                  aria-label={`Remove checklist item: ${item}`}
                  className="shrink-0 rounded p-1 text-stone-400 transition hover:text-rose-600 dark:hover:text-rose-400"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={checklistDraft}
            onChange={(event) => setChecklistDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addChecklistItem(checklistDraft);
              }
            }}
            placeholder="Add something to check off during the call"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => addChecklistItem(checklistDraft)}
            disabled={!checklistDraft.trim()}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add
          </button>
        </div>
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => addChecklistItem(suggestion)}
                className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-600 transition hover:border-violet-300 hover:text-violet-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-violet-500/50 dark:hover:text-violet-300"
              >
                + {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <span className="text-xs leading-5 text-stone-500 dark:text-stone-400">
          Optional. Your own list to check off while you talk — the manual companion to Live
          Guidance. Leave it empty and the panel stays out of the way.
        </span>
      </div>
    );
  }

  function renderPreCallBrief(compact = false, options?: { hideHeader?: boolean }) {
    if (!preCallBrief) return null;

    const latestCall = preCallBrief.recentCalls[0];
    const openItems = [...preCallBrief.openActionItems, ...preCallBrief.openReminders].slice(0, 3);
    const title =
      preCallBrief.thread?.title ?? preCallBrief.contact?.name ?? preCallBrief.template.label;
    const baseClass = compact
      ? "mx-auto mt-3 w-full max-w-[28rem] rounded-2xl border border-violet-100 bg-violet-50/60 p-3 text-left dark:border-violet-900 dark:bg-violet-950/15"
      : "rounded-lg border border-violet-100 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/15";

    return (
      <div className={baseClass}>
        {!options?.hideHeader ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">
                Pre-call brief
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
                {title}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-semibold text-violet-700 dark:bg-stone-900 dark:text-violet-300">
              {preCallBrief.template.shortLabel}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
              {title}
            </p>
            <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-semibold text-violet-700 dark:bg-stone-900 dark:text-violet-300">
              {preCallBrief.template.shortLabel}
            </span>
          </div>
        )}
        {latestCall ? (
          <p className="mt-3 line-clamp-2 text-xs leading-5 text-stone-700 dark:text-stone-300">
            Last call: {latestCall.summary}
          </p>
        ) : null}
        {preCallBrief.suggestedObjective ? (
          <div className="mt-3 rounded-lg border border-white bg-white/80 p-2 dark:border-stone-800 dark:bg-stone-900/60">
            <p className="line-clamp-2 text-xs leading-5 text-stone-700 dark:text-stone-300">
              {preCallBrief.suggestedObjective}
            </p>
            <button
              type="button"
              onClick={() => {
                setObjective(preCallBrief.suggestedObjective);
              }}
              className="mt-2 rounded-md bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800 transition hover:bg-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/60"
            >
              Use objective
            </button>
          </div>
        ) : null}
        {openItems.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {openItems.map((item) => (
              <p key={item._id} className="line-clamp-1 text-xs text-stone-700 dark:text-stone-300">
                {item.title}
              </p>
            ))}
          </div>
        ) : null}
        {preCallBrief.keyFacts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {preCallBrief.keyFacts.slice(0, 3).map((fact) => (
              <span
                key={`${fact.callId}-${fact.label}-${fact.value}`}
                className="rounded-full bg-white px-2 py-1 text-[0.7rem] font-medium text-stone-700 dark:bg-stone-900 dark:text-stone-300"
              >
                {fact.label}: {fact.value}
              </span>
            ))}
          </div>
        ) : null}
        {preCallBrief.similarReviewedCalls.length > 0 ? (
          <div className="mt-3">
            <p className="text-[0.7rem] font-semibold uppercase text-violet-700 dark:text-violet-400">
              From similar past calls
            </p>
            <div className="mt-1.5 space-y-1.5">
              {preCallBrief.similarReviewedCalls
                .slice(0, compact ? 2 : 3)
                .map((example) => (
                  <p
                    key={`${example.callId}-${example.sourceEvent}`}
                    className="line-clamp-2 text-xs leading-5 text-stone-700 dark:text-stone-300"
                  >
                    {example.playbookHint ??
                      example.realizedOutcomes[0] ??
                      example.outcome ??
                      example.summary}
                  </p>
                ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderTrialSetup() {
    if (!translatedTrial || !workspace) return null;
    return <div className="my-4 space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <TranslatedTrialNotice />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">You speak
          <select value={translatedCaptionsTargetLanguage} disabled={!canStartCall}
            onChange={(event) => { setTranslatedCaptionsTargetLanguage(event.target.value); setTranslationTargetManuallyChanged(true); }}
            className="min-w-0 rounded-md border border-stone-300 bg-white px-2 py-2">
            {translationTargetChoices.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">They speak
          <select value={translatedCaptionsSourceLanguage} disabled={!canStartCall}
            onChange={(event) => setTranslatedCaptionsSourceLanguage(event.target.value)}
            className="min-w-0 rounded-md border border-stone-300 bg-white px-2 py-2">
            {translationSourceChoices.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-stone-600">Both sides hear spoken translation after the introduction. The 90-second limit includes setup and the introduction; no credits are charged. Live Guidance stays off for the trial.</p>
    </div>;
  }

  function renderRealtimeControls(compact = false) {
    const baseClass = compact
      ? "mx-auto mt-3 w-full max-w-[28rem] rounded-2xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
      : "rounded-lg border border-stone-200 bg-surface p-4 dark:border-stone-800";

    if (freeCallEligible) {
      return (
        <div className={baseClass}>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-stone-500 dark:text-stone-400" />
            Live Guidance
          </p>
          <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
            {translatedTrial ? "Two-way Voice Translation is included in this trial. Live Guidance is available on paid plans." : `Live Guidance and Live Translation are off for the ${freeCallMaxSeconds}-second trial call.`} The trial is used when the provider call starts, and still creates a transcript and call record after the call.
          </p>
        </div>
      );
    }

    if (!realtimeUsage) return null;

    const liveFeature = realtimeUsage.liveCopilot;
    const captionFeature = realtimeUsage.translatedCaptions;
    const audioFeature = realtimeUsage.translatedAudio;

    if (!liveFeature.enabled && !captionFeature.enabled) {
      return (
        <div className={baseClass}>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-stone-500 dark:text-stone-400" />
            Live Guidance
          </p>
          <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
            Live Guidance and Voice Translation are included on every paid plan, starting with Solo.
          </p>
        </div>
      );
    }

    const liveRemaining = formatRealtimeMinutes(liveFeature.remainingIncludedSeconds);
    const liveBadge = `${liveRemaining} included`;
    const liveRate = `$${(liveFeature.overageCentsPerMinute / 100).toFixed(2)}/min`;
    const captionRemaining = formatRealtimeMinutes(captionFeature.remainingIncludedSeconds);
    const captionRate = `$${(captionFeature.overageCentsPerMinute / 100).toFixed(2)}/min`;
    const audioRemaining = formatRealtimeMinutes(audioFeature.remainingIncludedSeconds);
    const audioRate = `$${(audioFeature.overageCentsPerMinute / 100).toFixed(2)}/min`;

    return (
      <div className={baseClass}>
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Call type
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={`rounded-lg border p-3 ${!voiceTranslationSelected ? "border-violet-400 bg-violet-50/60 dark:border-violet-600 dark:bg-violet-950/20" : "border-stone-200 dark:border-stone-700"}`}>
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="call-type"
                  value="standard"
                  checked={!voiceTranslationSelected}
                  onChange={() => {
                    setCallType("standard");
                    // A Palabra-only selection cannot carry into legacy captions.
                    if (!LIVE_TRANSLATION_LANGUAGES.some(({ code }) => code === translatedCaptionsSourceLanguage)) {
                      setTranslatedCaptionsSourceLanguage("es");
                    }
                    if (!LIVE_TRANSLATION_TARGET_LANGUAGES.some(({ code }) => code === translatedCaptionsTargetLanguage)) {
                      setTranslatedCaptionsTargetLanguage(DEFAULT_LIVE_TRANSLATION_TARGET_LANGUAGE);
                    }
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">Standard Call</span>
                  <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">Call normally, with optional Guidance and translated captions.</span>
                </span>
              </span>
            </label>
            <label className={`rounded-lg border p-3 ${voiceTranslationSelected ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/20" : "border-stone-200 dark:border-stone-700"}`}>
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="call-type"
                  value="voice_translation"
                  checked={voiceTranslationSelected}
                  disabled={!voiceTranslationCanStart}
                  onChange={() => {
                    setCallType("voice_translation");
                    setEnableTranslatedCaptions(true);
                    setEnableLiveCopilot(true);
                    if (translatedCaptionsSourceLanguage === LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE) {
                      setTranslatedCaptionsSourceLanguage("es");
                    }
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
                    <Languages aria-hidden="true" className="h-4 w-4 text-emerald-700" />
                    Voice Translation
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">You speak your language. They hear theirs, and reply in their own language.</span>
                </span>
              </span>
            </label>
          </div>
          {!voiceTranslationCanStart && bridgeModeAvailability?.blockedReason ? (
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">{bridgeModeAvailability.blockedReason}</p>
          ) : null}
        </fieldset>
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Live Guidance
          </p>
          <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
            {liveBadge}
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
          Both live features are included monthly on your plan. After included minutes, they keep working and are charged to credits.
        </p>
        <div className="mt-3 grid gap-2">
          <label className="flex items-start gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
            <input
              type="checkbox"
              checked={(enableLiveCopilot || voiceTranslationSelected) && liveFeature.canStart}
              disabled={!liveFeature.canStart || voiceTranslationSelected}
              onChange={(event) => setEnableLiveCopilot(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 text-violet-700 focus:ring-violet-200 dark:border-stone-600 dark:bg-stone-800"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">Live Guidance</span>
              <span className="block text-xs leading-5 text-stone-500 dark:text-stone-400">
                {`Private prompts while you talk. The other person will not hear AI guidance. Overage ${liveRate} from credits.`}
              </span>
              {!liveFeature.canStart && liveFeature.blockedReason ? (
                <span className="mt-1 block text-xs font-medium text-rose-700 dark:text-rose-400">
                  {liveFeature.blockedReason}
                </span>
              ) : null}
            </span>
          </label>
          <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={(enableTranslatedCaptions || voiceTranslationSelected) && captionFeature.canStart}
                disabled={!captionFeature.canStart || enableSpokenTranslation || voiceTranslationSelected}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setEnableTranslatedCaptions(checked);
                  if (!checked) setEnableSpokenTranslation(false);
                }}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-violet-700 focus:ring-violet-200 dark:border-stone-600 dark:bg-stone-800"
              />
              <span className="min-w-0">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
                  <Languages aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  {voiceTranslationSelected ? "Translated captions" : "Translated captions"}
                </span>
                <span className="block text-xs leading-5 text-stone-500 dark:text-stone-400">
                  {voiceTranslationSelected
                    ? "Original and translated text stay visible while spoken translation runs. Captions are included with Voice Translation."
                    : captionFeature.enabled
                      ? `Translated captions. ${captionRemaining} included, then ${captionRate} from credits.`
                      : "Translated captions are included on every paid plan."}
                </span>
                {!captionFeature.canStart && captionFeature.blockedReason ? (
                  <span className="mt-1 block text-xs font-medium text-rose-700 dark:text-rose-400">
                    {captionFeature.blockedReason}
                  </span>
                ) : null}
              </span>
            </label>
            {captionFeature.enabled ? (
              <div className="mt-3 rounded-lg bg-stone-50 p-3 dark:bg-stone-950/40">
                <p className="text-xs leading-5 text-stone-500 dark:text-stone-400">
                  {voiceTranslationSelected
                    ? `Choose the language you speak and the language the other person speaks. Voice Translation includes ${audioRemaining}, then ${audioRate} from credits.`
                    : "Choose the language the other person speaks and the language you want to read."}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                    <span>{voiceTranslationSelected ? "They speak" : "Their spoken language"}</span>
                    <select
                      value={translatedCaptionsSourceLanguage}
                      disabled={!captionFeature.canStart || !enableTranslatedCaptions}
                      onChange={(event) => setTranslatedCaptionsSourceLanguage(event.target.value)}
                      className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-900 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-violet-950"
                    >
                      {!voiceTranslationSelected ? <option value={LIVE_TRANSLATION_AUTO_SOURCE_LANGUAGE}>Detect language</option> : null}
                      {translationSourceChoices.map((language) => (
                        <option key={language.code} value={language.code}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                    <span>{voiceTranslationSelected ? "You speak" : "Translate into"}</span>
                    <select
                      value={translatedCaptionsTargetLanguage}
                      disabled={!captionFeature.canStart || !enableTranslatedCaptions}
                      onChange={(event) => {
                        setTranslatedCaptionsTargetLanguage(event.target.value);
                        setTranslationTargetManuallyChanged(true);
                      }}
                      className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-900 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-violet-950"
                    >
                      {translationTargetChoices.map((language) => (
                        <option key={language.code} value={language.code}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-2 text-xs font-medium text-stone-600 dark:text-stone-300">
                  {liveTranslationDirectionLabel}
                </p>
                {liveTranslationLanguageError ? (
                  <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-400">
                    {liveTranslationLanguageError}
                  </p>
                ) : null}
                {voiceTranslationSelected ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                      <span>Your translated voice</span>
                      <select value={callerTranslatedVoice} onChange={(event) => setCallerTranslatedVoice(event.target.value as TranslatedVoiceGender)} className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-900">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                      <span>Their translated voice</span>
                      <select value={calledPersonTranslatedVoice} onChange={(event) => setCalledPersonTranslatedVoice(event.target.value as TranslatedVoiceGender)} className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-900">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {spokenTranslationAvailability?.available ? (
            <label className="flex items-start gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <input
                type="checkbox"
                checked={enableSpokenTranslation && captionFeature.canStart}
                disabled={!captionFeature.canStart}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setEnableSpokenTranslation(checked);
                  if (checked) setEnableTranslatedCaptions(true);
                }}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-violet-700 focus:ring-violet-200 dark:border-stone-600 dark:bg-stone-800"
              />
              <span className="min-w-0">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
                  <Headphones aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  Live Audio Translation
                </span>
                <span className="block text-xs leading-5 text-stone-500 dark:text-stone-400">
                  Internal test only, visible to your workspace alone. Plays the translated speech in your
                  browser alongside the normal call audio — you&apos;ll hear both at once, there&apos;s no
                  mixing yet. Turns on Live Translation automatically.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      </div>
    );
  }

  function renderCallPrepSection(compact = false) {
    const baseClass = compact
      ? "mx-auto mt-3 w-full max-w-[28rem] rounded-2xl border border-stone-200 bg-white p-3 text-left dark:border-stone-700 dark:bg-stone-900"
      : "rounded-lg border border-stone-200 bg-surface p-4 dark:border-stone-800";

    return (
      <div className={baseClass}>
        <button
          type="button"
          onClick={() => setCallPrepOpen((open) => !open)}
          aria-expanded={callPrepOpen}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <ListChecks aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
            <span>Call prep</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
            {callPrepOpen ? "Hide" : "Optional"}
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 transition ${callPrepOpen ? "rotate-180" : ""}`}
            />
          </span>
        </button>
        {!callPrepOpen ? (
          <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
            Add a call type, objective, checklist, pre-call brief, or Live Guidance options when the call needs more structure.
          </p>
        ) : (
          <div className={compact ? "space-y-3" : "mt-4 grid gap-4"}>
            {renderWorkflowTemplateSelector(compact)}
            {renderObjectiveInput(compact)}
            {renderCallRecordLanguageSelector(compact)}
            {renderChecklistEditor(compact)}
            {renderPreCallBrief(compact)}
            {renderRealtimeControls(compact)}
          </div>
        )}
      </div>
    );
  }

  function renderDashboardContactSummary() {
    return (
      <div className="mt-4 rounded-2xl border border-stone-200 bg-surface-muted p-3 dark:border-stone-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Contact</p>
            {activeContact ? (
              <>
                <p className="mt-1 truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
                  {activeContact.name}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                  {activeContact.phoneNumber}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm font-semibold text-stone-950 dark:text-stone-50">No contact linked</p>
                <p className="mt-1 truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                  {normalizedPhoneNumber || phoneNumber}
                </p>
              </>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => {
                setDashboardPanel("contact");
                setShowContactPicker(true);
                setShowSaveContact(false);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-stone-100 px-3 text-xs font-semibold text-stone-800 transition hover:bg-violet-50 hover:text-violet-800 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
            >
              <ContactRound aria-hidden="true" className="h-4 w-4" />
              {activeContact ? "Change" : "Contacts"}
            </button>
            {canSaveCurrentNumber ? (
              <button
                type="button"
                onClick={() => {
                  setDashboardPanel("contact");
                  openSaveContact();
                }}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-violet-100 px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-200"
              >
                <UserPlus aria-hidden="true" className="h-4 w-4" />
                Save
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderDashboardPanelContent() {
    if (dashboardPanel === "prep") {
      const checklistSummary =
        plannedChecklist.length > 0
          ? `${plannedChecklist.length} item${plannedChecklist.length === 1 ? "" : "s"}`
          : "Optional";
      const briefSummary = preCallBrief?.template.shortLabel ?? "Available";

      return (
        <div className="grid gap-3">
          {renderWorkflowTemplateSelector()}
          {renderObjectiveInput()}
          {renderCallRecordLanguageSelector()}
          {renderPrepCollapsible({
            title: "Call checklist",
            icon: <ListChecks aria-hidden="true" className="h-4 w-4 text-violet-600" />,
            open: prepChecklistOpen,
            onToggle: () => setPrepChecklistOpen((open) => !open),
            summary: checklistSummary,
            children: renderChecklistEditor(false, { hideHeader: true }),
          })}
          {preCallBrief
            ? renderPrepCollapsible({
                title: "Pre-call brief",
                icon: <Sparkles aria-hidden="true" className="h-4 w-4 text-violet-600" />,
                open: prepBriefOpen,
                onToggle: () => setPrepBriefOpen((open) => !open),
                summary: briefSummary,
                children: renderPreCallBrief(false, { hideHeader: true }),
              })
            : null}
        </div>
      );
    }

    if (dashboardPanel === "contact") {
      return <div>{renderContactTools(false, true)}</div>;
    }

    if (dashboardPanel === "callerId") {
      if (activeCallingNumbers.length) {
        return <div>{renderCallerIdSelector()}</div>;
      }

      return (
        <div className="rounded-lg border border-stone-200 bg-surface p-4 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:text-stone-400">
          {callingNumbers === undefined
            ? "Loading caller IDs..."
            : "No active caller IDs are available for this workspace."}
        </div>
      );
    }

    return (
      <div>
        {renderRealtimeControls() ?? (
          <div className="rounded-lg border border-stone-200 bg-surface p-4 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:text-stone-400">
            Loading Live Guidance options...
          </div>
        )}
      </div>
    );
  }

  function renderRecordingConsentModal() {
    if (!showRecordingConsent) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recording-consent-title"
      >
        <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">Recording consent</p>
              <h2 id="recording-consent-title" className="mt-2 text-xl font-semibold text-stone-950 dark:text-stone-50">
                Confirm permission before calling
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowRecordingConsent(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              aria-label="Close recording consent"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-4 text-sm leading-6 text-stone-700 dark:text-stone-300">
            Voxandra will record and transcribe this call to create notes, transcripts, and an AI call record. Continue only if you have permission to record and transcribe the call.
          </p>
          <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
            You are responsible for following the recording consent rules that apply to this call.
          </p>

          <label className="mt-4 flex items-start gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
            <input
              type="checkbox"
              checked={rememberRecordingConsent}
              onChange={(event) => setRememberRecordingConsent(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 text-violet-700 focus:ring-violet-200 dark:border-stone-600 dark:bg-stone-800"
            />
            <span className="text-sm leading-6 text-stone-700 dark:text-stone-300">
              Don&apos;t ask again on this device for this workspace. You remain responsible for
              recording consent on every call.
            </span>
          </label>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowRecordingConsent(false)}
              className="inline-flex h-11 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmRecordingConsent}
              className="inline-flex h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark focus:outline-none focus:ring-4 focus:ring-violet-200"
            >
              I have permission
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderActiveCallPanel() {
    // The server call record is the source of truth for the number that was
    // actually dialed and any linked contact. The dialer's local state can
    // drift back to a bare country code after teardown, so prefer the server
    // value whenever we are in the processing/completed phase.
    const serverDialedNumber = currentCall?.dialedNumber;
    const serverContact = currentCall
      ? (currentCall.contactId
          ? contacts.find((contact) => contact.id === currentCall.contactId)
          : contacts.find((contact) =>
              phoneNumbersMatch(contact.phoneE164 || contact.phoneNumber, currentCall.dialedNumber)
            )) ?? null
      : null;
    const displayPhoneNumber = serverDialedNumber ?? phoneNumber;
    const displayContactName = serverContact?.name;

    const checklistItems = (guidanceItems ?? []).filter(
      (item) => item.type === "checklist" && item.status !== "dismissed"
    );
    const copilotItems = (guidanceItems ?? []).filter(
      (item) => item.type === "copilot" && item.status !== "dismissed"
    );
    const captionItems = (guidanceItems ?? []).filter(
      (item) => (item.type === "caption" || item.type === "translation_caption") && item.status !== "dismissed"
    );
    // A "final" without aligned source text is never rendered as
    // authoritative; it falls back to the pending (unverified) styling.
    const renderedSegments = (translationSegments ?? [])
      .slice(-TRANSLATION_MAX_RENDERED_SEGMENTS)
      .map((segment) => ({
        segment,
        authoritative: segment.isFinal && segment.sourceText.trim().length > 0,
        lowConfidence:
          segment.confidence !== undefined &&
          segment.confidence < TRANSLATION_LOW_CONFIDENCE_THRESHOLD,
        delayed:
          !segment.isFinal &&
          segment.translatedText.trim().length === 0 &&
          translationNowTick - segment.createdAt >= TRANSLATION_DELAYED_AFTER_MS,
      }));
    const segments = translationSegments ?? [];
    const translationSpeakerLabel = displayContactName ?? displayPhoneNumber;
    const translationSessionFailed =
      translationSession?.status === "failed" || liveBridgeState?.translationDegraded === true;
    const translationStatusMessage = liveBridgeState?.translationDegraded
      ? "Voice Translation stopped for this call. You now hear each other's real voices at full volume — the call itself continues normally."
      : translationSession?.status === "active"
        ? `Listening and translating into ${liveTranslationTargetLabel}…`
        : translationSession?.status === "completed"
          ? "Live Translation finished for this call."
          : translationSessionFailed
            ? "Live Translation became unavailable for this call. The phone call can continue normally."
            : "Connecting Live Translation…";
    const fallbackCaptionEntries =
      segments.length === 0
        ? captionItems.slice(-4).map((item) => ({ id: item._id, text: item.label }))
        : [];

    const livePanels: Array<{ key: string; node: ReactNode }> = [];

    // The checklist is user-authored in Call prep and optional; calls without
    // one give the whole row to the live panels.
    const hasChecklistPanel = checklistItems.length > 0;
    if (hasChecklistPanel) {
      livePanels.push({
        key: "checklist",
        node: (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-white">
              <ListChecks aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              Checklist
            </div>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {checklistItems.slice(0, 12).map((item) => (
                <button
                  key={item._id}
                  type="button"
                  onClick={() =>
                    void updateGuidanceItemStatus({
                      itemId: item._id,
                      status: item.status === "done" ? "suggested" : "done",
                    })
                  }
                  className="flex w-full items-start gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-xs leading-5 text-stone-700 transition hover:border-violet-300 dark:border-stone-800 dark:bg-stone-950/60 dark:text-stone-200 dark:hover:border-violet-500/40"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      item.status === "done" ? "text-violet-600 dark:text-violet-300" : "text-stone-300 dark:text-stone-600"
                    }`}
                  />
                  <span className={item.status === "done" ? "text-stone-400 line-through dark:text-stone-500" : ""}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ),
      });
    }

    if (enableLiveCopilot) {
      livePanels.push({
        key: "guidance",
        node: (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-white">
              <Sparkles aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              Live Guidance
            </div>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {copilotItems.length > 0 ? (
                copilotItems.slice(-4).map((item) => (
                  <p key={item._id} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs leading-5 text-stone-700 dark:border-stone-800 dark:bg-stone-950/60 dark:text-stone-200">
                    {item.label}
                  </p>
                ))
              ) : (
                <p className="text-xs leading-5 text-stone-500 dark:text-stone-500">
                  Private prompts while you talk will appear here when realtime media is connected.
                </p>
              )}
            </div>
          </div>
        ),
      });
    }

    if (enableTranslatedCaptions) {
      livePanels.push({
        key: "translation",
        node: (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-white">
              <Languages aria-hidden="true" className="h-4 w-4 text-amber-600 dark:text-amber-300" />
              Live Translation
            </div>
            <div ref={translationScrollRef} className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 scroll-smooth">
              {translationSessionFailed ? (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{translationStatusMessage}</span>
                </div>
              ) : null}
              {segments.length > 0 || fallbackCaptionEntries.length > 0 ? (
                <>
                  {renderedSegments.map(({ segment, authoritative, lowConfidence, delayed }) =>
                    authoritative ? (
                      <div
                        key={segment._id}
                        className="rounded-md border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-950/60"
                      >
                        <div className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300/80">
                          {translationSpeakerLabel}
                          {lowConfidence ? (
                            <span className="rounded-sm bg-amber-100 px-1 py-0.5 text-[0.6rem] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                              Low confidence
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-sm leading-5 text-stone-800 dark:text-stone-200">
                          {segment.translatedText}
                        </p>
                        <p className="mt-1 text-xs leading-4 text-stone-400 italic dark:text-stone-500">
                          {segment.sourceText}
                        </p>
                      </div>
                    ) : (
                      // Source-first pending caption: the recognized words
                      // lead; the translation joins when it exists and is
                      // styled as unverified until it finalizes with source.
                      <div
                        key={segment._id}
                        className="rounded-md border border-dashed border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-950/60"
                      >
                        <div className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300/80">
                          {translationSpeakerLabel}
                          {lowConfidence ? (
                            <span className="rounded-sm bg-amber-100 px-1 py-0.5 text-[0.6rem] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                              Low confidence
                            </span>
                          ) : null}
                        </div>
                        {segment.sourceText.trim() ? (
                          <p className="mt-0.5 text-sm leading-5 text-stone-700 dark:text-stone-300">
                            {segment.sourceText}
                          </p>
                        ) : null}
                        {segment.translatedText.trim() ? (
                          <p className="mt-1 text-xs leading-4 italic text-stone-500 dark:text-stone-400">
                            {segment.translatedText}
                            {segment.isFinal ? null : <span className="animate-pulse">…</span>}
                          </p>
                        ) : (
                          <p className="mt-1 flex items-center gap-1 text-xs leading-4 text-stone-400 dark:text-stone-500">
                            {delayed ? (
                              <>
                                <Clock aria-hidden="true" className="h-3 w-3 shrink-0" />
                                Translation delayed…
                              </>
                            ) : (
                              <span className="animate-pulse">Translating…</span>
                            )}
                          </p>
                        )}
                      </div>
                    )
                  )}
                  {fallbackCaptionEntries.map((caption) => (
                    <p
                      key={caption.id}
                      className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-stone-800 dark:border-stone-800 dark:bg-stone-950/60 dark:text-stone-200"
                    >
                      {caption.text}
                    </p>
                  ))}
                </>
              ) : translationSessionFailed ? null : (
                <p className="text-xs leading-5 text-stone-500 dark:text-stone-500">
                  {translationStatusMessage}
                </p>
              )}
            </div>
          </div>
        ),
      });
    }

    // The checklist is reference material; Live Guidance and Live Translation
    // are the live content, so they get the wider columns when present.
    const panelGridClass =
      livePanels.length >= 3
        ? "mt-6 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1.75fr)]"
        : livePanels.length === 2
          ? hasChecklistPanel
            ? "mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
            : "mt-6 grid gap-3 sm:grid-cols-2"
          : "mt-6 grid gap-3";

    // Server-aware state for the processing / completed phase. The local
    // provider phase can lag behind the backend, so we drive the post-call
    // surface from the server call record whenever it is available.
    const serverAware = (phase === "processing" || phase === "completed") && Boolean(currentCall);
    const serverStage = serverAware ? serverStageForCall(currentCall!) : null;
    const serverReady = serverStage === "ready";
    const serverFailed = serverStage === "failed";
    const serverProcessing = serverStage === "processing";
    const serverLabel = serverAware ? serverStatusLabel(currentCall!.processingStatus) : null;
    const serverReviewPending = serverReady && currentCall?.reviewPending === true;
    const callSummaryPreview = currentCallMemory?.summary ?? currentCallMemory?.outcome ?? null;

    // Voice Translation: the browser leg connects before the other person's
    // phone even rings, so while the local phase says "in_call" the caller may
    // be hearing ringback or waiting out the spoken disclosure. Name that.
    const otherPersonLabel = displayContactName ?? "the other person";
    const bridgeDescription =
      phase === "in_call" && liveBridgePhase
        ? describeLiveBridgePhase(liveBridgePhase, otherPersonLabel)
        : null;
    const bridgeEndReason = liveBridgeEndReason(liveBridgePhase);
    const bridgeEndDescription =
      bridgeEndReason && (phase === "completed" || phase === "failed" || serverAware)
        ? describeLiveBridgePhase(bridgeEndReason, otherPersonLabel)
        : null;
    const stepPhase =
      phase === "in_call" && isLiveBridgeStillConnecting(liveBridgePhase) ? "ringing" : phase;
    const bridgeToneClass =
      bridgeDescription?.tone === "live"
        ? "text-emerald-700 dark:text-emerald-300"
        : bridgeDescription?.tone === "hold"
          ? "text-amber-700 dark:text-amber-300"
          : bridgeDescription?.tone === "degraded"
            ? "text-rose-700 dark:text-rose-300"
            : "";
    const bridgeHintClass =
      bridgeDescription?.tone === "degraded"
        ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-100"
        : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100";

    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 dark:text-stone-400">
              {serverReady ? (
                <>
                  Call ended
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {serverReviewPending ? "Review pending" : "Record ready"}
                  </span>
                </>
              ) : serverFailed ? (
                <>
                  Call ended
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    {serverLabel}
                  </span>
                </>
              ) : serverProcessing ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex gap-0.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500" />
                  </span>
                  {serverLabel ?? "Ending call…"}
                </span>
              ) : bridgeDescription ? (
                <>
                  <span className={bridgeToneClass}>{bridgeDescription.label}</span>
                  {bridgeDescription.tone === "live" ? (
                    <NetworkQualityDot quality={networkQuality} />
                  ) : null}
                </>
              ) : (
                <>
                  {phaseCopy}
                  {phase === "in_call" ? <NetworkQualityDot quality={networkQuality} /> : null}
                </>
              )}
            </p>
            <h3 className="mt-2 truncate text-2xl font-semibold text-stone-950 dark:text-white">{displayContactName ?? displayPhoneNumber}</h3>
            <p className="mt-1 font-mono text-sm text-stone-500 dark:text-stone-300">{displayPhoneNumber}</p>
            {bridgeDescription?.hint ? (
              <p className={`mt-3 max-w-md rounded-md border px-3 py-2 text-xs leading-5 ${bridgeHintClass}`}>
                {bridgeDescription.hint}
              </p>
            ) : null}
            {liveBridgeState?.endReason ? (
              <p className="mt-3 text-sm leading-5 text-stone-600 dark:text-stone-300">
                {liveBridgeState.endReason === "inactivity" ? "Call ended due to inactivity." : "Call ended at its duration or credit limit."}
              </p>
            ) : null}
            {phase === "in_call" && currentCallId && liveBridgeState?.inactivityDeadlineAt ? (
              <div className="mt-3">
                <BridgeInactivityNotice callId={currentCallId as Id<"calls">} deadlineAt={liveBridgeState.inactivityDeadlineAt} />
              </div>
            ) : null}
            {bridgeEndDescription ? (
              <p className="mt-3 text-sm leading-5 text-stone-600 dark:text-stone-300">
                {bridgeEndDescription.label}. No conversation took place.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 dark:bg-white/10 dark:text-white">
              <Clock aria-hidden="true" className="mr-2 inline h-4 w-4" />
              {formatDuration(elapsed)}
            </div>
            {/* Only the free trial shows a countdown. The paid "Reserved time left"
                readout was removed: the reservation is a billing-side credit hold,
                not a limit the caller is working against, so surfacing it made a
                normal call look like it was running out of time. */}
            {currentCallIsFree && remainingSeconds !== null && !serverReady && !serverFailed && !serverProcessing ? (
              <div className={`rounded-md px-3 py-2 text-right text-xs font-semibold ${
                remainingSeconds <= 15
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-300/15 dark:text-amber-100"
                  : "bg-stone-100 text-stone-700 dark:bg-white/10 dark:text-stone-200"
              }`}>
                <span className="block text-[0.68rem] uppercase text-stone-400 dark:text-stone-400">
                  Trial time left
                </span>
                <span className="text-sm">{formatDuration(remainingSeconds)}</span>
                {currentCallMaxSeconds !== null ? (
                  <span className="sr-only"> of {formatDuration(currentCallMaxSeconds)}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {serverProcessing ? (
            <>
              {(["calling", "processing", "ready"] as const).map((step, index) => {
                const stepDone = step === "calling";
                const stepActive = step === "processing";
                const stepLabel =
                  step === "processing" ? processingStepLabel(currentCall!.processingStatus) : step;
                return (
                  <div key={step} className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                        stepActive
                          ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                          : stepDone
                            ? "text-violet-700 dark:text-violet-400"
                            : "text-stone-400 dark:text-stone-500"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          stepActive
                            ? "animate-pulse bg-violet-500"
                            : stepDone
                              ? "bg-violet-500"
                              : "bg-stone-300 dark:bg-stone-700"
                        }`}
                      />
                      {stepLabel}
                    </span>
                    {index < 2 ? <span className="h-px w-4 bg-stone-200 dark:bg-stone-800" /> : null}
                  </div>
                );
              })}
            </>
          ) : serverReady || serverFailed ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                serverReady
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${serverReady ? "bg-emerald-500" : "bg-rose-500"}`} />
              {serverReady ? (serverReviewPending ? "Review pending" : "Record ready") : serverLabel}
            </span>
          ) : (
            (["connecting", "ringing", "in_call", "processing"] as const).map((step, index) => (
              <div key={step} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                    stepPhase === step
                      ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                      : "text-stone-400 dark:text-stone-500"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      stepPhase === step ? "animate-pulse bg-violet-500" : "bg-stone-300 dark:bg-stone-700"
                    }`}
                  />
                  {step.replace("_", " ")}
                </span>
                {index < 3 ? <span className="h-px w-4 bg-stone-200 dark:bg-stone-800" /> : null}
              </div>
            ))
          )}
        </div>

        {livePanels.length > 0 && !serverReady && !serverFailed && !serverProcessing ? (
          <div className={panelGridClass}>{livePanels.map((panel) => (
            <div key={panel.key}>{panel.node}</div>
          ))}</div>
        ) : null}

        <div className="relative mt-8 flex flex-wrap gap-3">
          {serverReady ? (
            <>
              <Link
                href={`/app/calls/${currentCall!._id}${serverReviewPending ? "#review" : "#note"}`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
              >
                {serverReviewPending ? "Review call record" : "Open call record"}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              {currentCall?.transcriptId ? (
                <Link
                  href={`/app/calls/${currentCall!._id}#transcript`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:text-stone-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
                >
                  View transcript
                </Link>
              ) : null}
              <button
                type="button"
                onClick={prepareNextCall}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 px-4 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
              >
                <PhoneCall aria-hidden="true" className="h-4 w-4" />
                Start another call
              </button>
            </>
          ) : serverFailed ? (
            <>
              {currentCall?.processingStatus === "call_failed" ? (
                <Link
                  href={`/app?number=${encodeURIComponent(displayPhoneNumber)}#dialer`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
                >
                  <PhoneCall aria-hidden="true" className="h-4 w-4" />
                  Call again
                </Link>
              ) : (
                <Link
                  href={`/app/calls/${currentCall!._id}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
                >
                  Open call
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              )}
              <button
                type="button"
                onClick={prepareNextCall}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 px-4 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
              >
                <PhoneCall aria-hidden="true" className="h-4 w-4" />
                Start another call
              </button>
            </>
          ) : serverProcessing ? (
            <div className="flex w-full items-center gap-3 rounded-lg border border-violet-100 bg-violet-50/70 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
              <Loader2 aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin text-violet-600 dark:text-violet-400" />
              <p className="text-sm leading-6 text-stone-700 dark:text-stone-300">
                {serverLabel ? `${serverLabel}. ` : ""}
                Voxandra is creating the transcript, AI note, extracted details, and follow-ups.
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={toggleMute}
                disabled={phase !== "in_call"}
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 disabled:opacity-50 dark:border-stone-700 dark:text-white"
              >
                {muted ? <MicOff aria-hidden="true" className="h-4 w-4" /> : <Mic aria-hidden="true" className="h-4 w-4" />}
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                onClick={() => {
                  setShowKeypad((value) => !value);
                  setShowDevices(false);
                }}
                disabled={phase !== "in_call"}
                aria-expanded={showKeypad}
                className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                  showKeypad
                    ? "border-violet-400 bg-violet-50 text-violet-800 dark:border-violet-500/60 dark:bg-violet-950/40 dark:text-violet-200"
                    : "border-stone-300 text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:text-white dark:hover:bg-white/5"
                }`}
              >
                <Grid3X3 aria-hidden="true" className="h-4 w-4" />
                Keypad
              </button>
              <button
                onClick={() => {
                  setShowDevices((value) => !value);
                  setShowKeypad(false);
                }}
                aria-expanded={showDevices}
                className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition ${
                  showDevices
                    ? "border-violet-400 bg-violet-50 text-violet-800 dark:border-violet-500/60 dark:bg-violet-950/40 dark:text-violet-200"
                    : "border-stone-300 text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:text-white dark:hover:bg-white/5"
                }`}
              >
                <Headphones aria-hidden="true" className="h-4 w-4" />
                Devices
              </button>
              <button
                onClick={endGlobalCall}
                disabled={phase === "processing" || phase === "connecting"}
                className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <PhoneOff aria-hidden="true" className="h-4 w-4" />
                End call
              </button>

              {showKeypad ? (
                <DialerKeypadPopover onClose={() => setShowKeypad(false)} />
              ) : null}
              {showDevices ? (
                <AudioDevicePopover
                  inputDevices={inputDevices}
                  outputDevices={outputDevices}
                  selectedInputDeviceId={selectedInputDeviceId}
                  selectedOutputDeviceId={selectedOutputDeviceId}
                  onSelectInput={(deviceId) => void setInputDevice(deviceId)}
                  onSelectOutput={(deviceId) => void setOutputDevice(deviceId)}
                  onClose={() => setShowDevices(false)}
                />
              ) : null}
            </>
          )}
        </div>

        {phase === "processing" && !serverProcessing ? (
          <p className="mt-5 text-sm leading-6 text-stone-500 dark:text-stone-300">
            Voxandra is creating the transcript, AI note, extracted details, and follow-ups. This usually takes a few seconds.
          </p>
        ) : null}

        {serverReady && callSummaryPreview ? (
          <p className="mt-5 line-clamp-3 text-sm leading-6 text-stone-700 dark:text-stone-300">
            {callSummaryPreview}
          </p>
        ) : null}
      </div>
    );
  }

  function renderPostCallTracker(handoff: PostCallHandoff) {
    const steps = ["calling", "processing", "ready"] as const;
    const failed = handoff.stage === "failed";
    const completed = handoff.stage === "completed";
    const duration = handoff.durationSeconds
      ? formatDuration(handoff.durationSeconds)
      : null;

    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Call ended</p>
            <h3 className="mt-2 truncate text-2xl font-semibold text-stone-950 dark:text-white">{handoff.title}</h3>
            <p className="mt-1 font-mono text-sm text-stone-500 dark:text-stone-300">{handoff.phoneNumber}</p>
          </div>
          {duration ? (
            <div className="rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 dark:bg-white/10 dark:text-white">
              <Clock aria-hidden="true" className="mr-2 inline h-4 w-4" />
              {duration}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {failed || completed ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                failed
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                  : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${failed ? "bg-rose-500" : "bg-stone-400"}`}
              />
              {handoff.statusLabel}
            </span>
          ) : (
            steps.map((step, index) => {
              const stepDone =
                (step === "calling") ||
                (step === "processing" && (handoff.stage === "processing" || handoff.stage === "ready")) ||
                (step === "ready" && handoff.stage === "ready");
              const stepActive = handoff.stage === step;
              return (
                <div key={step} className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                      stepActive
                        ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                        : stepDone
                          ? "text-violet-700 dark:text-violet-400"
                          : "text-stone-400 dark:text-stone-500"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        stepActive
                          ? "animate-pulse bg-violet-500"
                          : stepDone
                            ? "bg-violet-500"
                            : "bg-stone-300 dark:bg-stone-700"
                      }`}
                    />
                    {step}
                  </span>
                  {index < steps.length - 1 ? <span className="h-px w-4 bg-stone-200 dark:bg-stone-800" /> : null}
                </div>
              );
            })
          )}
        </div>

        <div
          className={`mt-5 rounded-lg border p-4 ${
            failed
              ? "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20"
              : "border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900"
          }`}
        >
          {!failed ? (
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {handoff.statusLabel}
            </p>
          ) : null}
          <p
            className={`text-sm leading-6 ${
              failed ? "text-rose-800 dark:text-rose-300" : "mt-1.5 text-stone-600 dark:text-stone-400"
            }`}
          >
            {handoff.description}
          </p>
          {handoff.summary ? (
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-700 dark:text-stone-300">
              {handoff.summary}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {failed ? (
            <button
              type="button"
              onClick={prepareNextCall}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              <PhoneCall aria-hidden="true" className="h-4 w-4" />
              Call again
            </button>
          ) : null}
          {handoff.actions
            .filter((action) => !action.href.startsWith("/app?"))
            .map((action) => (
              <Link
                key={`${action.href}-${action.label}`}
                href={action.href}
                className={
                  action.style === "primary" && !failed
                    ? "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
                    : "inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:text-stone-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
                }
              >
                {action.label}
              </Link>
            ))}
          {!failed ? (
            <button
              type="button"
              onClick={prepareNextCall}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 px-4 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
            >
              <PhoneCall aria-hidden="true" className="h-4 w-4" />
              Start another call
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-stone-500">
        Loading dialer...
      </div>
    );
  }

  if (variant === "dashboard") {
    const showPostCallTracker = canStartCall && phase !== "failed" && Boolean(postCallHandoff);
    const showIdleDialpad = canStartCall && !showPostCallTracker;
    const dashboardPanels = [
      {
        key: "prep",
        label: "Prep",
        icon: <ListChecks aria-hidden="true" className="h-4 w-4" />,
      },
      {
        key: "contact",
        label: "Contacts",
        icon: <ContactRound aria-hidden="true" className="h-4 w-4" />,
      },
      {
        key: "live",
        label: "Guidance",
        icon: <Sparkles aria-hidden="true" className="h-4 w-4" />,
      },
      {
        key: "callerId",
        label: "Caller ID",
        icon: <PhoneForwarded aria-hidden="true" className="h-4 w-4" />,
      },
    ] as const;

    return (
      <section id="dialer" className="w-full scroll-mt-36 lg:scroll-mt-24">
        {renderRecordingConsentModal()}
        <div className={`rounded-[2rem] bg-surface p-4 shadow-[0_30px_90px_rgba(46,16,101,0.10)] sm:p-5 dark:shadow-none dark:ring-1 dark:ring-stone-800 ${
          showIdleDialpad ? "w-full lg:mx-auto lg:w-fit lg:max-w-full" : "w-full"
        }`}>
          <div>
            {showPostCallTracker && postCallHandoff ? (
              renderPostCallTracker(postCallHandoff)
            ) : showIdleDialpad ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">
                    Browser call
                  </p>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                    {phaseCopy}
                  </span>
                </div>

                {showTwilioSetupWarning ? (
                  <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                    <div className="flex gap-2">
                      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        Browser calling setup is incomplete. Contact support before testing live calls.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(22rem,28rem)_minmax(20rem,34rem)]">
                  <div className="rounded-[1.5rem] border border-stone-200 bg-surface p-4 shadow-sm sm:p-5 dark:border-stone-800">
                    {renderPhoneNumberInput(true)}

                    {renderRateEstimate(true)}
                    {renderTrialSetup()}

                    {renderDashboardContactSummary()}

                    <div className="mx-auto mt-6 grid w-full max-w-[18rem] grid-cols-3 justify-items-center gap-x-4 gap-y-4">
                      {keypad.map((key) => (
                        <button
                          key={key.digit}
                          type="button"
                          onClick={() => appendDigit(key.digit)}
                          className="flex h-[4.25rem] w-[4.25rem] flex-col items-center justify-center rounded-full border border-stone-200 bg-surface-sunken text-stone-950 dark:border-stone-700 dark:text-stone-50 shadow-sm shadow-stone-950/5 transition hover:border-violet-300 hover:bg-violet-100 hover:text-stone-950 dark:hover:border-violet-700 dark:hover:bg-violet-950/50 dark:hover:text-stone-50 focus:outline-none focus:ring-4 focus:ring-violet-100 dark:focus:ring-violet-900 active:scale-95"
                        >
                          <span className="text-xl font-semibold leading-none">{key.digit}</span>
                          {key.letters ? (
                            <span className="mt-1 text-[0.58rem] font-bold leading-none tracking-[0.08em] text-stone-400">
                              {key.letters}
                            </span>
                          ) : (
                            <span className="mt-1 h-[0.58rem]" />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="relative mx-auto mt-6 flex w-full max-w-[18rem] items-center justify-center">
                      <button
                        type="button"
                        onClick={startCall}
                        disabled={
                          Boolean(showTwilioSetupWarning) ||
                          freeCallStatus === undefined ||
                          routeQuoteBlocksCall ||
                          Boolean(liveTranslationLanguageError) || trialBlocked
                        }
                        className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-brand text-white shadow-xl shadow-violet-950/20 transition hover:bg-brand-dark focus:outline-none focus:ring-4 focus:ring-violet-200 disabled:opacity-50"
                        aria-label={startLabel}
                        title={startLabel}
                      >
                        <PhoneCall aria-hidden="true" className="h-7 w-7" />
                      </button>
                      {phoneDigits.length > 0 ? (
                        <button
                          type="button"
                          onClick={removeLastDigit}
                          aria-label="Delete last digit"
                          className="absolute right-0 flex h-11 w-11 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                        >
                          <Delete aria-hidden="true" className="h-5 w-5" />
                        </button>
                      ) : null}
                    </div>
                    {renderStartDisabledReason(true)}

                    {twilioError ? (
                      <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                        {twilioError}
                      </div>
                    ) : null}

                    {micPermission === "denied" ? (
                      <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">
                        Microphone permission is required before a browser call can start.
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-0 rounded-[1.5rem] border border-stone-200 bg-surface p-4 shadow-sm sm:p-5 dark:border-stone-800">
                    <div
                      role="tablist"
                      aria-label="Call setup sections"
                      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-stone-100/70 p-1 dark:bg-stone-800/70"
                    >
                      {dashboardPanels.map((panel) => {
                        const active = dashboardPanel === panel.key;
                        return (
                          <button
                            key={panel.key}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setDashboardPanel(panel.key)}
                            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-semibold transition ${
                              active
                                ? "bg-white text-brand shadow-[0_8px_20px_rgba(28,25,23,0.08)] dark:bg-stone-800 dark:text-violet-300"
                                : "text-stone-600 hover:bg-white/70 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100"
                            }`}
                          >
                            {panel.icon}
                            {panel.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4 max-h-[min(40rem,calc(100vh-12rem))] overflow-y-auto pr-0.5">
                      {renderDashboardPanelContent()}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div>{renderActiveCallPanel()}</div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-surface p-6 shadow-sm dark:border-stone-800">
      {renderRecordingConsentModal()}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">Browser call</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Start with a phone number</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Voxandra can organize the call after it ends. Contact and call prep are optional.
            </p>
          </div>
        </div>
      </div>

      {showTwilioSetupWarning ? (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <div className="flex gap-2">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Browser calling setup is incomplete. Contact support before testing live calls.
            </p>
          </div>
        </div>
      ) : null}

      <div className={`mt-5 rounded-lg border p-4 text-sm leading-6 ${
        freeCallEligible
          ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
          : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
      }`}>
        <div className="flex gap-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {freeCallEligible ? (
            <p>
              Your workspace has one {freeCallMaxSeconds}-second {translatedTrial ? "translated-call" : "standard-call"} trial. The trial is used once Voxandra starts the provider call, even if the destination is busy or does not answer. Completed calls are recorded, transcribed, and turned into a Call Record automatically.
            </p>
          ) : callsOnlyMode ? (
            <p>
              Browser calls use Voxandra calling credits. Calls-only keeps basic call history without transcripts, AI notes, extracted details, or reminders.
            </p>
          ) : (
            <p>
              Browser calls use Voxandra calling credits. Voxandra records completed calls, transcribes them,
              and creates an AI call record automatically when call updates arrive.
            </p>
          )}
        </div>
      </div>

      {canStartCall ? (
        <>
          <div className="mt-6 grid gap-4">
            {renderPhoneNumberInput()}

            {renderRateEstimate()}
            {renderTrialSetup()}

            {renderCallerIdSelector()}

            {renderContactTools()}

            {renderCallPrepSection()}
          </div>

          {twilioError ? (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              {twilioError}
            </div>
          ) : null}

          {micPermission === "denied" ? (
            <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">
              Microphone permission is required before a browser call can start.
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={startCall}
              disabled={
                Boolean(showTwilioSetupWarning) ||
                freeCallStatus === undefined ||
                routeQuoteBlocksCall ||
                Boolean(liveTranslationLanguageError) || trialBlocked
              }
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white shadow-xl shadow-violet-950/20 transition hover:bg-brand-dark focus:outline-none focus:ring-4 focus:ring-violet-200 disabled:opacity-50"
            >
              <PhoneCall aria-hidden="true" className="h-5 w-5" />
              {startLabel}
            </button>
            {renderStartDisabledReason()}
          </div>
        </>
      ) : (
        <div className="mt-6">{renderActiveCallPanel()}</div>
      )}
    </div>
  );
}
