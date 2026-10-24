"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ContactRound,
  PencilLine,
  PhoneCall,
  RefreshCcw,
  Bell,
  GitBranch,
  LinkIcon,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { AINotesCard } from "@/components/memory/ai-notes-card";
import { EntityBadge } from "@/components/memory/entity-badge";
import { ReviewWorkspace } from "@/components/memory/review-workspace";
import { TranscriptViewer } from "@/components/memory/transcript-viewer";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { confidenceLabel, formatDateTime, formatDuration, titleCase } from "@/lib/format";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { mapDoc, mapDocs } from "@/lib/convex-helpers";
import { captureProductEvent } from "@/lib/analytics";
import type { Id } from "@convex/_generated/dataModel";
import type { Contact } from "@/lib/types";
import {
  CALL_RECORD_LANGUAGES,
  getCallRecordLanguageLabel,
} from "@/lib/call-record-languages";

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

type ContactSuggestion = {
  existingContactId?: Id<"contacts">;
  name?: string;
  type?: string;
  country?: string;
  phoneNumber?: string;
};

function contactCallHref(contact: Contact) {
  const params = new URLSearchParams({
    number: contact.phoneE164 || contact.phoneNumber,
    contactId: contact.id,
  });
  return `/app?${params.toString()}#dialer`;
}

function ContactContextCard({
  callId,
  dialedNumber,
  contact,
  contacts,
  relatedThreads,
  suggestion,
}: {
  callId: Id<"calls">;
  dialedNumber: string;
  contact: Contact | null;
  contacts: Contact[];
  relatedThreads: Array<{ _id: Id<"cases">; title: string }>;
  suggestion: ContactSuggestion | null;
}) {
  const createContactForCall = useMutation(api.contacts.createContactForCall);
  const linkCallToContact = useMutation(api.contacts.linkCallToContact);

  const [showCreate, setShowCreate] = useState(false);
  const [showLinkTools, setShowLinkTools] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState(contact?.id ?? suggestion?.existingContactId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: suggestion?.name ?? "",
    type: suggestion?.type ?? "other",
    country: suggestion?.country ?? "Unknown",
    phoneNumber: suggestion?.phoneNumber ?? dialedNumber,
    notes: "",
  });

  const filteredContacts = contacts
    .filter((item) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return [item.name, item.phoneNumber, item.country, item.type, item.notes]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    })
    .slice(0, 20);

  function openCreateFromSuggestion() {
    setForm({
      name: suggestion?.name ?? "",
      type: suggestion?.type ?? "other",
      country: suggestion?.country ?? "Unknown",
      phoneNumber: suggestion?.phoneNumber ?? dialedNumber,
      notes: suggestion?.name ? "Saved from a Voxandra contact suggestion." : "",
    });
    setShowCreate(true);
    setError("");
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createContactForCall({
        callId,
        ...form,
      });
      setShowCreate(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save contact.");
    } finally {
      setBusy(false);
    }
  }

  async function linkSelectedContact() {
    if (!selectedContactId) return;
    setBusy(true);
    setError("");
    try {
      await linkCallToContact({
        callId,
        contactId: selectedContactId as Id<"contacts">,
      });
      setShowLinkTools(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not link contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="contact" className="scroll-mt-24 rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ContactRound aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Contact context</h2>
          </div>
          {contact ? (
            <>
              <p className="mt-2 text-lg font-semibold text-stone-950 dark:text-stone-50">{contact.name}</p>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                {titleCase(contact.type)} · {contact.country || "Unknown country"}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-lg font-semibold text-stone-950 dark:text-stone-50">No contact linked</p>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                Save or link this number so future notes show the right institution or person.
              </p>
            </>
          )}
        </div>
        {contact?.phoneNumber ? (
          <Link
            href={contactCallHref(contact)}
            className="inline-flex items-center gap-2 rounded-md bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-800 transition hover:bg-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/60"
          >
            <PhoneCall aria-hidden="true" className="h-4 w-4" />
            Call
          </Link>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="font-mono text-stone-700 dark:text-stone-300">{contact?.phoneNumber ?? dialedNumber}</span>
        {contact?.lastCallAt ? (
          <span className="text-stone-500 dark:text-stone-400">Last call {formatDateTime(contact.lastCallAt)}</span>
        ) : null}
      </div>

      {relatedThreads.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {relatedThreads.slice(0, 3).map((thread) => (
            <span
              key={thread._id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
            >
              <GitBranch aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="truncate">{thread.title}</span>
            </span>
          ))}
        </div>
      ) : null}

      {!contact && suggestion?.name ? (
        <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900/60 dark:bg-violet-950/30">
          <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">Suggested contact</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">{suggestion.name}</p>
              <p className="mt-1 text-sm text-violet-900 dark:text-violet-300">
                {titleCase(suggestion.type ?? "other")} · {suggestion.country ?? "Unknown"}
              </p>
              {suggestion.phoneNumber ? (
                <p className="mt-1 font-mono text-xs text-violet-800 dark:text-violet-300">{suggestion.phoneNumber}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={openCreateFromSuggestion}
              className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500"
            >
              <UserPlus aria-hidden="true" className="h-4 w-4" />
              Save contact
            </button>
          </div>
        </div>
      ) : null}

      {!showLinkTools && !showCreate ? (
        <button
          type="button"
          onClick={() => setShowLinkTools(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
        >
          <LinkIcon aria-hidden="true" className="h-4 w-4" />
          {contact ? "Change linked contact" : "Link or save contact"}
        </button>
      ) : null}

      {showLinkTools ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <label className="flex h-10 items-center gap-2 rounded-md border border-stone-300 px-3 dark:border-stone-700">
              <Search aria-hidden="true" className="h-4 w-4 text-stone-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search contacts to link"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none dark:text-stone-100"
              />
            </label>
            <select
              value={selectedContactId}
              onChange={(event) => setSelectedContactId(event.target.value)}
              className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            >
              <option value="">Choose existing contact</option>
              {filteredContacts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.phoneNumber}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={linkSelectedContact}
              disabled={busy || !selectedContactId || selectedContactId === contact?.id}
              className="h-10 rounded-md bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {contact ? "Change" : "Link"}
            </button>
            {!contact ? (
              <button
                type="button"
                onClick={openCreateFromSuggestion}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <UserPlus aria-hidden="true" className="h-4 w-4" />
                Save this number
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowLinkTools(false)}
              className="h-10 rounded-md px-3 text-sm font-semibold text-stone-500 transition hover:bg-stone-50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <form onSubmit={saveContact} className="mt-4 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 md:grid-cols-2 dark:border-stone-800 dark:bg-stone-800/60">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Name</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Phone</span>
            <input
              value={form.phoneNumber}
              onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })}
              className="h-10 rounded-md border border-stone-300 bg-white px-3 font-mono text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Type</span>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
              className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            >
              {CONTACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Country</span>
            <input
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
              className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
          </label>
          {error ? <p className="text-sm text-rose-700 md:col-span-2 dark:text-rose-400">{error}</p> : null}
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save contact"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : error ? (
        <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>
      ) : null}
    </section>
  );
}

function ThreadContextCard({
  context,
  suggestion,
  onAttachExisting,
  onCreate,
  busy,
}: {
  context: {
    thread: {
      _id: Id<"cases">;
      title: string;
      status: string;
      summary: string;
    };
    relatedCalls: Array<{ _id: Id<"calls">; startedAt: string }>;
    openActionItems: Array<{ _id: Id<"actionItems">; title: string }>;
    upcomingReminders: Array<{ _id: Id<"reminders">; title: string; remindAt: string }>;
    keyEntities: Array<{ _id: Id<"extractedEntities">; label: string; value: string }>;
  } | null | undefined;
  suggestion: {
    suggestedExistingThread: {
      _id: Id<"cases">;
      title: string;
      summary: string;
    } | null;
    suggestedNewThreadTitle: string | null;
  } | null | undefined;
  onAttachExisting: (threadId: Id<"cases">) => Promise<void>;
  onCreate: () => Promise<void>;
  busy: boolean;
}) {
  if (context) {
    const openFollowUps = context.openActionItems.length + context.upcomingReminders.length;
    return (
      <section className="rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Related thread</h2>
            </div>
            <p className="mt-2 text-base font-semibold text-stone-950 dark:text-stone-50">{context.thread.title}</p>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-stone-600 dark:text-stone-400">{context.thread.summary}</p>
          </div>
          <StatusBadge value={context.thread.status} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
            {context.relatedCalls.length} calls
          </span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {openFollowUps} open follow-ups
          </span>
          {context.upcomingReminders[0] ? (
            <span className="rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              Next: {formatDateTime(context.upcomingReminders[0].remindAt)}
            </span>
          ) : null}
        </div>
        {context.keyEntities.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {context.keyEntities.slice(0, 4).map((entity) => (
              <span
                key={entity._id}
                className="max-w-full truncate rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
              >
                {entity.label}: {entity.value}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  if (!suggestion) return null;

  const existing = suggestion.suggestedExistingThread;
  const title = existing?.title ?? suggestion.suggestedNewThreadTitle;
  if (!title) return null;

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-5 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch aria-hidden="true" className="h-4 w-4 text-violet-700 dark:text-violet-400" />
            <h2 className="text-sm font-semibold text-violet-950 dark:text-violet-200">Suggested thread</h2>
          </div>
          <p className="mt-2 text-base font-semibold text-stone-950 dark:text-stone-50">{title}</p>
          {existing?.summary ? (
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-violet-900 dark:text-violet-300">{existing.summary}</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => existing ? onAttachExisting(existing._id) : onCreate()}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500"
        >
          <LinkIcon aria-hidden="true" className="h-4 w-4" />
          {busy ? "Saving..." : existing ? "Attach thread" : "Create thread"}
        </button>
      </div>
    </section>
  );
}

function processingStateTitle(
  status: string,
  isTwilio: boolean,
  isImported: boolean,
  isInternalAudio: boolean
) {
  if (isTwilio) {
    if (status === "call_failed") return "Call didn't connect";
    if (status === "transcript_needed") return "Waiting for call recording";
    if (status === "transcribing") return "Transcribing the call recording";
    if (status === "extracting") return "AI is analyzing the transcript";
    if (status === "recording_callback_missing") return "Call recording update missing";
    if (status === "transcription_failed") return "Transcription failed";
    if (status === "failed") return "AI extraction failed";
    if (status === "completed") return "Processing complete";
    return "AI call record has not been generated yet";
  }
  if ((isImported || isInternalAudio) && (status === "failed" || status === "transcription_failed")) {
    return "AI extraction failed";
  }
  if (isImported && status === "analyzing") return "AI is analyzing the transcript";
  if (isInternalAudio) return "Audio processing in progress";
  return "AI call record has not been generated yet";
}

function processingStateDesc(
  status: string,
  isTwilio: boolean,
  isImported: boolean,
  isInternalAudio: boolean,
  isFailed: boolean
) {
  if (isTwilio) {
    if (status === "call_failed") return "The other side was busy, rejected the call, or didn't answer, so the call never connected. No recording, transcript, or AI record will be created. You can call this number again from the dialer.";
    if (status === "transcript_needed") return "The call ended. Voxandra is waiting for the call recording update. This usually takes 30–60 seconds.";
    if (status === "transcribing") return "The recording is ready. Voxandra is creating the transcript.";
    if (status === "extracting") return "The transcript is ready. AI is now extracting summary, details, and action items. This takes a few seconds.";
    if (status === "recording_callback_missing") return "The call ended, but Voxandra did not receive the recording update in time. Contact support if this keeps happening.";
    if (status === "transcription_failed") return "The recording could not be transcribed. This is usually temporary — try the call again, and contact support if it keeps happening.";
    if (status === "failed") return "AI extraction failed. The transcript could not be analyzed.";
    if (status === "completed") return "This call completed without an AI call record. This may mean AI features were not enabled for your workspace.";
    return "Transcription and AI summary are processing. Refresh the page in a moment.";
  }
  if ((isImported || isInternalAudio) && isFailed) {
    return "The AI extraction failed for this import. Use the retry button above to try again.";
  }
  if (isInternalAudio && status === "analyzing") {
    return "The audio was transcribed. AI analysis is running — this takes a few seconds.";
  }
  if (isImported && status === "analyzing") {
    return "AI is analyzing the imported transcript. This takes a few seconds. Refresh to check progress.";
  }
  if (isImported) {
    return "Analyze the imported transcript from the import screen to generate summary, extracted details, and suggestions.";
  }
  return "Start a call from the dialer to generate transcript, summary, extracted details, and suggestions.";
}

function callDirectionLabel(call: {
  callDirection?: string;
  inboundVoicemail?: boolean;
  status: string;
}) {
  if (call.callDirection !== "inbound") return "Outbound";
  if (call.inboundVoicemail) return "Inbound voicemail";
  if (call.status === "completed") return "Inbound answered";
  return "Missed inbound";
}

function callRecordLanguageSourceLabel(source?: string) {
  if (source === "explicit") return "chosen by you";
  if (source === "operator_audio") return "detected from your audio";
  if (source === "operator_realtime") return "detected from your Live Guidance speech";
  if (source === "fallback") return "English fallback";
  if (source === "legacy_transcript") return "legacy transcript detection";
  return "language source unavailable";
}

export function CallDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const openedTrackedRef = useRef(false);
  const call = useQuery(api.calls.getCallById, { id: id as Id<"calls"> });
  const transcript = useQuery(api.transcripts.getTranscriptByCallId, { callId: id as Id<"calls"> });
  const memory = useQuery(api.aiMemories.getAIMemoryByCallId, { callId: id as Id<"calls"> });
  const entities = useQuery(api.extractedEntities.getExtractedEntitiesByCallId, { callId: id as Id<"calls"> });
  const reminders = useQuery(api.reminders.getRemindersByCallId, { callId: id as Id<"calls"> });
  const contact = useQuery(api.contacts.getContactById, call?.contactId ? { id: call.contactId } : "skip");
  const contacts = useQuery(api.contacts.getContacts);
  const contactThreads = useQuery(api.threads.listThreadPillsForContacts);
  const reviewSuggestion = useQuery(api.reviewSuggestions.getReviewSuggestionByCallId, { callId: id as Id<"calls"> });
  const latestRun = useQuery(api.aiExtractionRuns.getLatestExtractionRunByCallId, { callId: id as Id<"calls"> });
  const providerEvents = useQuery(api.twilioProvider.getProviderEventsByCallId, { callId: id as Id<"calls"> });
  const threadContext = useQuery(api.threads.getThreadContextForCall, { callId: id as Id<"calls"> });
  const threadSuggestion = useQuery(api.threads.getThreadSuggestionForCall, { callId: id as Id<"calls"> });
  const threadIntelligence = useQuery(
    api.threadIntelligence.getThreadIntelligence,
    call?.caseId ? { caseId: call.caseId } : "skip"
  );

  const updateCallUserNotes = useMutation(api.calls.updateCallUserNotes);
  const updateMemory = useMutation(api.aiMemories.updateAIMemory);
  const updateMemoryParticipants = useMutation(api.aiMemories.updateAIMemoryParticipants);
  const linkCallToThread = useMutation(api.threads.linkCallToThread);
  const createThreadFromSuggestion = useMutation(api.threads.createThreadFromSuggestion);
  const deleteCallRecord = useMutation(api.calls.deleteCallRecord);
  const retryExtraction = useAction(api.aiExtraction.retryImportedTranscriptExtraction);
  const regenerateCallRecordLanguage = useAction(
    api.aiExtraction.regeneratePendingCallRecordLanguage
  );

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [regeneratingLanguage, setRegeneratingLanguage] = useState(false);
  const [selectedRecordLanguage, setSelectedRecordLanguage] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const [threadBusy, setThreadBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  // null means "not edited this session" — the server value renders directly,
  // so reactive updates from elsewhere never clobber in-progress typing.
  const [userNotesDraft, setUserNotesDraft] = useState<string | null>(null);
  const [userNotesSaved, setUserNotesSaved] = useState(false);

  const mappedMemory = memory ? mapDoc(memory) : null;
  const mappedTranscript = transcript ? mapDoc(transcript) : null;
  const mappedEntities = entities ? mapDocs(entities) : [];
  const mappedReminders = reminders ? mapDocs(reminders) : [];

  const callIdForNotes = call?._id;
  useEffect(() => {
    if (userNotesDraft === null || !callIdForNotes) return;
    const timer = window.setTimeout(() => {
      void updateCallUserNotes({ callId: callIdForNotes, notes: userNotesDraft }).then(() => {
        setUserNotesSaved(true);
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [userNotesDraft, callIdForNotes, updateCallUserNotes]);

  // Scrollspy for the sticky section nav.
  const hasMemoryForNav = Boolean(memory);
  const reviewPendingForNav = Boolean(call?.reviewPending);
  const hasTranscriptForNav = Boolean(transcript);
  const reminderCountForNav = reminders?.length ?? 0;
  const entityCountForNav = entities?.length ?? 0;
  useEffect(() => {
    if (!hasMemoryForNav) return;
    const ids = ["note", "reminders", "transcript", "extracted-details", "follow-ups", "contact", "user-notes"];
    const sections = ids
      .map((sectionId) => document.getElementById(sectionId))
      .filter((element): element is HTMLElement => Boolean(element));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (observed) => {
        const visible = observed
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: 0 }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [hasMemoryForNav, reviewPendingForNav, hasTranscriptForNav, reminderCountForNav, entityCountForNav]);

  useEffect(() => {
    if (openedTrackedRef.current || !call) return;
    openedTrackedRef.current = true;
    captureProductEvent("call_memory_opened", {
      route: "/app/calls/[id]",
      status: call.processingStatus,
      callMode: call.callMode,
      hasContact: Boolean(call.contactId),
    });
  }, [call]);
  const mappedContact = contact ? mapDoc(contact) : null;
  const mappedContacts = contacts ? mapDocs(contacts) : [];
  const mappedProviderEvents = providerEvents ? mapDocs(providerEvents) : [];
  const relatedThreadsForContact = mappedContact
    ? contactThreads?.find((row) => row.contactId === mappedContact.id)?.threads ?? []
    : [];
  const suggestedExistingContact = reviewSuggestion?.suggestedExistingContactId
    ? mappedContacts.find((item) => item.id === reviewSuggestion.suggestedExistingContactId)
    : null;
  const suggestedContactName =
    reviewSuggestion?.suggestedNewContactName ??
    reviewSuggestion?.participants?.institution.name ??
    suggestedExistingContact?.name;
  const contactSuggestion: ContactSuggestion | null = reviewSuggestion
    ? {
        existingContactId: reviewSuggestion.suggestedExistingContactId,
        name: suggestedContactName ?? undefined,
        type:
          reviewSuggestion.suggestedNewContactType ??
          reviewSuggestion.participants?.institution.type ??
          suggestedExistingContact?.type ??
          "other",
        country:
          reviewSuggestion.suggestedNewContactCountry ??
          suggestedExistingContact?.country ??
          "Unknown",
        phoneNumber:
          reviewSuggestion.suggestedNewContactPhone ??
          suggestedExistingContact?.phoneNumber ??
          call?.dialedNumber,
      }
    : null;

  if (!call) {
    return (
      <EmptyState
        title="Call not found"
        description="This call is not in the Convex database."
        href="/app"
        action="Back to dashboard"
      />
    );
  }

  const isImported = call.callMode === "imported";
  const isInternalAudio = call.callMode === "internal_audio_import";
  const isInbound = call.callDirection === "inbound";
  const isTwilio =
    call.callMode === "human_twilio" ||
    call.callMode === "human_twilio_bridge" ||
    call.callMode === "human_twilio_inbound";
  const displayNumber = isInbound
    ? call.inboundCallerNumber ?? call.dialedNumber
    : call.dialedNumber;
  const sourceLabel = isInternalAudio
    ? "Internal audio import"
    : isImported
      ? "Imported transcript"
      : isTwilio
        ? isInbound
          ? "Inbound line"
          : "Browser call"
        : "Simulated call";
  const isFailed = call.processingStatus === "failed";
  const canRetry = isFailed && (isImported || isInternalAudio) && latestRun && (latestRun.status === "failed" || latestRun.status === "validation_failed");
  const canDelete = call.processingStatus !== "calling";
  const openReminderCount = mappedReminders.filter((item) => item.status !== "completed").length;

  async function handleRetry() {
    if (!canRetry || !call || !mappedTranscript) return;
    setRetrying(true);
    setRetryError("");
    try {
      const result = await retryExtraction({
        callId: call._id,
        transcriptText: mappedTranscript.text,
        phoneNumber: displayNumber !== "Imported transcript" ? displayNumber : undefined,
        context: call.importContext ?? undefined,
        language: call.language ?? undefined,
        failedRunId: latestRun._id,
      });
      if (result.callId) {
        showToast("Retry started. This page updates as the extraction runs.", "success");
      }
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  async function handleLanguageRegeneration() {
    if (!call?.reviewPending || !selectedRecordLanguage) return;
    setRegeneratingLanguage(true);
    try {
      await regenerateCallRecordLanguage({
        callId: call._id,
        callRecordLanguage: selectedRecordLanguage,
      });
      showToast("Call record is being regenerated in the selected language.", "success");
      setSelectedRecordLanguage("");
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : "Could not regenerate the call record.",
        "error"
      );
    } finally {
      setRegeneratingLanguage(false);
    }
  }

  async function handleAttachThread(threadId: Id<"cases">) {
    if (!call) return;
    setThreadBusy(true);
    try {
      await linkCallToThread({ callId: call._id, threadId });
    } finally {
      setThreadBusy(false);
    }
  }

  async function handleCreateThread() {
    if (!call) return;
    setThreadBusy(true);
    try {
      await createThreadFromSuggestion({ callId: call._id });
    } finally {
      setThreadBusy(false);
    }
  }

  async function confirmDeleteCallRecord() {
    if (!call || call.processingStatus === "calling") return;
    setDeleting(true);
    try {
      await deleteCallRecord({ callId: call._id });
      showToast("Call record deleted.", "success");
      router.push("/app/memory");
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : "Could not delete this call record.",
        "error"
      );
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  // Combine required documents with extracted entities
  const documentEntities = mappedMemory && mappedMemory.requiredDocuments && mappedMemory.requiredDocuments.length > 0
    ? mappedMemory.requiredDocuments.map((doc: string, index: number) => ({
        id: `doc-${index}`,
        type: "required_document",
        label: "Required document",
        value: doc,
        confidence: 1,
      }))
    : [];
  const allStructuredItems = [...documentEntities, ...mappedEntities].filter(
    (entity) => !["person", "organization"].includes(entity.type.toLowerCase())
  );
  const riskEntityTypes = new Set(["risk_flag", "discrepancy"]);

  // While a draft is pending, the review workspace is the single source of truth
  // for the note, details, follow-ups, and contact — the accepted-state cards
  // would only duplicate it. Transcript and personal notes stay as references.
  const reviewMode = Boolean(call.reviewPending && reviewSuggestion);
  const reviewEntityCount = (reviewSuggestion?.entitySuggestions ?? []).filter(
    (entity) => !["person", "organization"].includes(entity.type.toLowerCase())
  ).length;

  const transcriptSection = mappedTranscript ? (
    <div id="transcript" className="scroll-mt-24">
      <TranscriptViewer transcript={mappedTranscript} />
    </div>
  ) : null;

  const userNotesSection = (
    <section id="user-notes" className="scroll-mt-24 rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PencilLine aria-hidden="true" className="h-4 w-4 text-stone-500 dark:text-stone-400" />
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Your notes</h2>
        </div>
        <span className="text-xs text-stone-400 dark:text-stone-500" aria-live="polite">
          {userNotesDraft === null ? "Saves automatically" : userNotesSaved ? "Saved" : "Saving…"}
        </span>
      </div>
      <textarea
        value={userNotesDraft ?? call.userNotes ?? ""}
        onChange={(event) => {
          setUserNotesSaved(false);
          setUserNotesDraft(event.target.value);
        }}
        className="mt-3 min-h-24 w-full rounded-lg border border-stone-300 px-4 py-3 text-sm text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
        placeholder="Add your own notes, corrections, or context."
      />
    </section>
  );

  const navItems = reviewMode
    ? [
        { href: "#note", id: "note", label: "AI note" },
        ...(reviewEntityCount > 0
          ? [{ href: "#extracted-details", id: "extracted-details", label: "Extracted details" }]
          : []),
        { href: "#follow-ups", id: "follow-ups", label: "Follow-ups" },
        { href: "#contact", id: "contact", label: "Contact" },
        ...(mappedTranscript ? [{ href: "#transcript", id: "transcript", label: "Transcript" }] : []),
        { href: "#user-notes", id: "user-notes", label: "Your notes" },
      ]
    : [
        { href: "#note", id: "note", label: "AI note" },
        ...(mappedReminders.length > 0 ? [{ href: "#reminders", id: "reminders", label: "Reminders" }] : []),
        ...(mappedTranscript ? [{ href: "#transcript", id: "transcript", label: "Transcript" }] : []),
        ...(allStructuredItems.length > 0
          ? [{ href: "#extracted-details", id: "extracted-details", label: "Extracted details" }]
          : []),
        { href: "#contact", id: "contact", label: "Contact" },
        { href: "#user-notes", id: "user-notes", label: "Your notes" },
      ];

  const callAgainNumber = !isImported && !isInternalAudio && displayNumber ? displayNumber : null;
  const callAgainHref = callAgainNumber
    ? `/app?${new URLSearchParams({
        number: callAgainNumber,
        ...(call.contactId ? { contactId: String(call.contactId) } : {}),
      }).toString()}#dialer`
    : null;

  return (
    <div className="space-y-5">
      <Link
        href="/app/memory"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-violet-700 dark:text-stone-400 dark:hover:text-violet-300"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Call records
      </Link>

      {/* Metadata header — compact */}
      <section className="rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">Call record</p>
            <h1 className="mt-1 text-2xl font-semibold text-stone-950 dark:text-stone-50">
              {mappedContact?.name ?? displayNumber}
            </h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge value={mappedMemory?.reviewStatus ?? call.processingStatus} />
            {callAgainHref && canDelete ? (
              <Link
                href={callAgainHref}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-100 px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/60"
              >
                <PhoneCall aria-hidden="true" className="h-4 w-4" />
                Call again
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!canDelete}
              title={
                canDelete
                  ? "Delete this call record"
                  : "Finish or end the call before deleting this record"
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-200 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">Call</p>
            <p className="mt-0.5 text-stone-800 dark:text-stone-200">
              {callDirectionLabel(call)} · {sourceLabel}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">Number</p>
            <p className="mt-0.5 font-mono text-stone-800 dark:text-stone-200">{displayNumber}</p>
          </div>
          {isInbound && call.inboundCalledNumber ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">To</p>
              <p className="mt-0.5 font-mono text-stone-800 dark:text-stone-200">{call.inboundCalledNumber}</p>
            </div>
          ) : null}
          {call.callerIdNumber ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">From</p>
              <p className="mt-0.5 font-mono text-stone-800 dark:text-stone-200">{call.callerIdNumber}</p>
            </div>
          ) : null}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">When</p>
            <p className="mt-0.5 text-stone-800 dark:text-stone-200">{formatDateTime(call.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">Duration</p>
            <p className="mt-0.5 text-stone-800 dark:text-stone-200">{formatDuration(call.durationSeconds)}</p>
          </div>
          {mappedMemory ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">AI note</p>
              <p
                className="mt-0.5 cursor-help text-violet-700 underline decoration-dotted underline-offset-4 dark:text-violet-400"
                title="How confident the AI is that the extracted summary and details match the transcript."
              >
                {confidenceLabel(mappedMemory.confidence)}
              </p>
            </div>
          ) : null}
          {call.callRecordLanguage ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">Call record</p>
              <p className="mt-0.5 text-stone-800 dark:text-stone-200">
                {getCallRecordLanguageLabel(call.callRecordLanguage)} ·{" "}
                {callRecordLanguageSourceLabel(call.callRecordLanguageSource)}
              </p>
            </div>
          ) : null}
        </div>

        {call.bridgeRecordCompleteness === "partial" ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            This is a partial translated Call Record. One participant recording was unavailable, so the transcript does not contain both sides of the conversation.
          </div>
        ) : null}

        {reviewMode ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <ClipboardCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-950 dark:text-amber-200">Draft ready for review</p>
                <p className="mt-0.5 text-sm text-amber-900/80 dark:text-amber-200/80">
                  Check the AI note, details, and follow-ups below. Nothing is shared with the team until you accept.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-amber-800/80 dark:text-amber-300/80">
                  Record language
                </span>
                <select
                  value={selectedRecordLanguage || call.callRecordLanguage || "en"}
                  onChange={(event) => setSelectedRecordLanguage(event.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-amber-300 bg-white px-3 text-sm font-medium text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-amber-800 dark:bg-stone-900 dark:text-stone-100 sm:w-44"
                >
                  {CALL_RECORD_LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleLanguageRegeneration}
                disabled={
                  regeneratingLanguage ||
                  !selectedRecordLanguage ||
                  selectedRecordLanguage === call.callRecordLanguage
                }
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-stone-900 dark:text-amber-200"
              >
                <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${regeneratingLanguage ? "animate-spin" : ""}`} />
                Regenerate
              </button>
            </div>
          </div>
        ) : null}

        {isFailed ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-300">AI extraction failed</p>
            <p className="mt-1 text-sm text-rose-800 dark:text-rose-300">
              Voxandra could not extract a structured call record from this transcript.
            </p>
            {retryError ? <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{retryError}</p> : null}
            {canRetry ? (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50 dark:bg-rose-600 dark:hover:bg-rose-500"
              >
                <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
                {retrying ? "Retrying..." : "Retry extraction"}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {mappedMemory ? (
        <nav
          aria-label="Call record sections"
          className="sticky top-[4.25rem] z-10 flex flex-wrap gap-2 rounded-xl border border-stone-200/80 bg-white/95 p-3 text-sm shadow-sm backdrop-blur dark:border-stone-800 dark:bg-stone-900/95"
        >
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={activeSection === item.id ? "true" : undefined}
              className={`rounded-md border px-3 py-2 font-medium transition ${
                activeSection === item.id
                  ? "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                  : "border-stone-200 bg-stone-50 text-stone-700 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}

      {reviewMode ? (
        <ReviewWorkspace
          callId={String(call._id)}
          onAccept={() => showToast("Review accepted. This call record is now shared.", "success")}
          onDismiss={() => showToast("Draft dismissed.", "success")}
        >
          {transcriptSection}
          {userNotesSection}
        </ReviewWorkspace>
      ) : null}

      {!reviewMode && !mappedMemory ? (
        <ContactContextCard
          callId={call._id}
          dialedNumber={displayNumber}
          contact={mappedContact as Contact | null}
          contacts={mappedContacts as Contact[]}
          relatedThreads={relatedThreadsForContact}
          suggestion={contactSuggestion}
        />
      ) : null}

      {reviewMode ? null : !mappedMemory ? (
        <EmptyState
          title={processingStateTitle(call.processingStatus, isTwilio, isImported, isInternalAudio)}
          description={processingStateDesc(call.processingStatus, isTwilio, isImported, isInternalAudio, isFailed)}
          href="/app"
          action="Start call"
        />
      ) : (
        <>
          {/* AI Notes — hero, with inline summary editing */}
          <div id="note" className="scroll-mt-24">
            <AINotesCard
              summary={mappedMemory.summary}
              participants={mappedMemory.participants}
              reviewStatus={mappedMemory.reviewStatus}
              editableSummary
              onSummaryChange={(value) => {
                if (memory && value.trim() && value !== mappedMemory.summary) {
                  void updateMemory({ memoryId: memory._id, summary: value });
                }
              }}
              onUpdateParticipants={(next) => {
                if (memory) {
                  updateMemoryParticipants({
                    memoryId: memory._id,
                    participants: {
                      caller: {
                        name: next.caller.name,
                        roleLabel: next.caller.roleLabel,
                        confidence: next.caller.confidence,
                        evidence: next.caller.evidence,
                      },
                      representative: {
                        name: next.representative.name,
                        roleLabel: next.representative.roleLabel,
                        confidence: next.representative.confidence,
                        institutionName: next.representative.institutionName,
                        evidence: next.representative.evidence,
                      },
                      institution: {
                        name: next.institution.name,
                        type: next.institution.type,
                        confidence: next.institution.confidence,
                        evidence: next.institution.evidence,
                      },
                      subject: {
                        name: next.subject.name,
                        subjectType: next.subject.subjectType,
                        confidence: next.subject.confidence,
                        evidence: next.subject.evidence,
                      },
                    },
                  });
                }
              }}
            />
          </div>

          {mappedReminders.length > 0 ? (
            <section id="reminders" className="scroll-mt-24 rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-center gap-2">
                <Bell aria-hidden="true" className="h-4 w-4 text-stone-500 dark:text-stone-400" />
                <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Suggested reminders</h2>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {mappedReminders.map((reminder) => (
                  <div key={reminder.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-800/60">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">{reminder.title}</p>
                        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{formatDateTime(reminder.remindAt)}</p>
                      </div>
                      <StatusBadge value={reminder.status} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Transcript — ground truth */}
          {transcriptSection}

          {/* Extracted details from the structured call record */}
          {allStructuredItems.length > 0 ? (
            <section id="extracted-details" className="scroll-mt-24 rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Extracted details</h2>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {allStructuredItems.map((entity) => (
                  <div
                    key={entity.id}
                    className={
                      riskEntityTypes.has(entity.type.toLowerCase())
                        ? "rounded-lg border-l-4 border-amber-400 dark:border-amber-500"
                        : ""
                    }
                  >
                    <EntityBadge entity={entity} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <ThreadContextCard
            context={threadContext}
            suggestion={threadSuggestion}
            onAttachExisting={handleAttachThread}
            onCreate={handleCreateThread}
            busy={threadBusy}
          />

          {threadIntelligence ? (
            <section className="rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-center gap-2">
                <GitBranch aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Thread context</h2>
              </div>
              <p className="mt-3 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200">
                Next objective: {threadIntelligence.suggestedNextObjective}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/60">
                  <p className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Open commitments</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">
                    {threadIntelligence.openActionItems.length}
                  </p>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/60">
                  <p className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Overdue follow-ups</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">
                    {threadIntelligence.overdueReminders.length + threadIntelligence.overdueActionItems.length}
                  </p>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/60">
                  <p className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Repeated blockers</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">
                    {threadIntelligence.repeatedBlockers.length}
                  </p>
                </div>
              </div>
              {threadIntelligence.latestKnownFacts.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {threadIntelligence.latestKnownFacts.slice(0, 5).map((fact) => (
                    <span
                      key={`${fact.callId}-${fact.label}-${fact.value}`}
                      className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                    >
                      {fact.label}: {fact.value}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <ContactContextCard
            callId={call._id}
            dialedNumber={displayNumber}
            contact={mappedContact as Contact | null}
            contacts={mappedContacts as Contact[]}
            relatedThreads={relatedThreadsForContact}
            suggestion={contactSuggestion}
          />

          {/* User notes */}
          {userNotesSection}
        </>
      )}

      {/* Call delivery details — collapsed */}
      {isTwilio ? (
        <section className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <button
            onClick={() => setShowTechnical((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-stone-700 dark:text-stone-300"
          >
            Call delivery details
            {showTechnical ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showTechnical ? (
            <div className="border-t border-stone-200 px-5 py-4 dark:border-stone-800">
              <div className="grid gap-3 text-sm md:grid-cols-5">
                <div>
                  <p className="font-medium text-stone-500 dark:text-stone-400">Provider</p>
                  <p className="mt-1 text-stone-950 dark:text-stone-50">{call.provider ?? "twilio"}</p>
                </div>
                <div>
                  <p className="font-medium text-stone-500 dark:text-stone-400">Parent SID</p>
                  <p className="mt-1 font-mono text-xs text-stone-700 dark:text-stone-300">
                    {call.parentCallSid ? `${call.parentCallSid.slice(0, 10)}...` : "Waiting"}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-stone-500 dark:text-stone-400">Call SID</p>
                  <p className="mt-1 font-mono text-xs text-stone-700 dark:text-stone-300">
                    {call.providerCallSid ? `${call.providerCallSid.slice(0, 10)}...` : "Waiting"}
                  </p>
                </div>
                {call.bridgeCalleeCallSid ? (
                  <div>
                    <p className="font-medium text-stone-500 dark:text-stone-400">Bridge callee SID</p>
                    <p className="mt-1 font-mono text-xs text-stone-700 dark:text-stone-300">
                      {`${call.bridgeCalleeCallSid.slice(0, 10)}...`}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="font-medium text-stone-500 dark:text-stone-400">Destination</p>
                  <p className="mt-1 text-stone-700 dark:text-stone-300">{call.destinationCountry ?? "Unknown"}</p>
                </div>
                <div>
                  <p className="font-medium text-stone-500 dark:text-stone-400">Caller ID</p>
                  <p className="mt-1 font-mono text-xs text-stone-700 dark:text-stone-300">
                    {call.callerIdNumber ?? "Default"}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {mappedProviderEvents.length > 0 ? (
                  mappedProviderEvents.map((event) => (
                    <div
                      key={event.id}
                      className="grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm md:grid-cols-[0.8fr_0.8fr_1fr_1fr] dark:border-stone-700 dark:bg-stone-800/60"
                    >
                      <span className="font-semibold text-stone-900 dark:text-stone-100">{event.eventType}</span>
                      <span className="text-stone-600 dark:text-stone-400">{event.providerStatus ?? "unknown"}</span>
                      <span className="font-mono text-xs text-stone-500 dark:text-stone-400">
                        {event.providerCallSid ? `${event.providerCallSid.slice(0, 12)}...` : "no sid"}
                      </span>
                      <span className="text-stone-500 dark:text-stone-400">{formatDateTime(new Date(event.receivedAt).toISOString())}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-stone-600 dark:text-stone-400">No provider callbacks received yet.</p>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {showDeleteConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-call-record-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h2
              id="delete-call-record-title"
              className="text-lg font-semibold text-stone-950 dark:text-stone-50"
            >
              Delete this call record?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              This permanently removes the AI note, transcript, extracted details
              {openReminderCount > 0
                ? `, and ${openReminderCount} open reminder${openReminderCount === 1 ? "" : "s"} from this call`
                : ", and any reminders or action items from this call"}
              . The contact and work thread stay. Billing history is kept. This cannot be undone.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDeleteCallRecord()}
                className="inline-flex h-10 items-center justify-center rounded-md bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete call record"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
