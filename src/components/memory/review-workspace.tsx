"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  ChevronDown,
  Compass,
  ContactRound,
  ListChecks,
  Loader2,
  Plus,
  Tags,
  X,
} from "lucide-react";
import type {
  ActionItem,
  Case,
  Contact,
  ExtractedEntity,
  Reminder,
  Participants,
  ReviewedMeaning,
  ReviewedMeaningCompleteness,
} from "@/lib/types";
import { confidenceLabel, titleCase } from "@/lib/format";
import { EntityBadge } from "./entity-badge";
import { AINotesCard } from "./ai-notes-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { mapDoc, mapDocs } from "@/lib/convex-helpers";
import { captureProductEvent } from "@/lib/analytics";
import type { Id } from "@convex/_generated/dataModel";

function toInputDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 16);
}

function fromInputDateTime(value: string) {
  return new Date(value).toISOString();
}

function defaultParticipants(): Participants {
  return {
    caller: { name: null, roleLabel: "unknown", confidence: 0, evidence: null },
    representative: { name: null, roleLabel: "unknown", confidence: 0, evidence: null, institutionName: null },
    institution: { name: null, type: "unknown", confidence: 0, evidence: null },
    subject: { name: null, subjectType: "unknown", confidence: 0, evidence: null },
  };
}

type ReviewedMeaningFormState = {
  reviewedObjective: string;
  outcomeStatus: string;
  unresolvedQuestions: string;
  escalationTriggers: string;
  humanCorrectionSummary: string;
  playbookHint: string;
  completeness: ReviewedMeaningCompleteness;
};

function linesFromList(values: string[] | undefined) {
  return (values ?? []).join("\n");
}

function listFromLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function defaultReviewedMeaningState(reviewedMeaning?: ReviewedMeaning): ReviewedMeaningFormState {
  return {
    reviewedObjective: reviewedMeaning?.reviewedObjective ?? "",
    outcomeStatus: reviewedMeaning?.outcomeStatus ?? "",
    unresolvedQuestions: linesFromList(reviewedMeaning?.unresolvedQuestions),
    escalationTriggers: linesFromList(reviewedMeaning?.escalationTriggers),
    humanCorrectionSummary: reviewedMeaning?.humanCorrectionSummary ?? "",
    playbookHint: reviewedMeaning?.playbookHint ?? "",
    completeness: reviewedMeaning?.completeness ?? "partial",
  };
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

type ReviewWorkspaceSuggestion = {
  id: string;
  callId: string;
  detectedCallType: string;
  summary: string;
  confidence: number;
  suggestedExistingCaseId?: string;
  suggestedExistingContactId?: string;
  suggestedNewCaseTitle?: string;
  extractedEntities: ExtractedEntity[];
  suggestedActionItems: ActionItem[];
  suggestedReminder?: Reminder;
  suggestedContactCreation?: {
    name: string;
    type: string;
    country: string;
    phoneNumber: string;
  };
  participants?: Participants;
  reviewedMeaning?: ReviewedMeaning;
};

const cardClass =
  "rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900";
const sectionTitleClass = "text-sm font-semibold text-stone-900 dark:text-stone-100";
const sectionHintClass = "mt-1 text-sm text-stone-500 dark:text-stone-400";
const fieldLabelClass = "text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500";
const inputClass =
  "h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus:ring-violet-950/60";
const textareaClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm leading-6 text-stone-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus:ring-violet-950/60";
const ghostButtonClass =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40";
const removeButtonClass =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200";

function SectionHeader({
  icon,
  title,
  hint,
  count,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-stone-500 dark:text-stone-400">{icon}</span>
          <h2 className={sectionTitleClass}>{title}</h2>
          {typeof count === "number" ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {count}
            </span>
          ) : null}
        </div>
        {hint ? <p className={sectionHintClass}>{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ReviewWorkspace({
  callId,
  onAccept,
  onDismiss,
  children,
}: {
  callId: string;
  onAccept?: () => void;
  onDismiss?: () => void;
  /** Read-only reference content (transcript, personal notes) rendered above the sticky action bar. */
  children?: ReactNode;
}) {
  const suggestionDoc = useQuery(api.reviewSuggestions.getReviewSuggestionByCallId, { callId: callId as Id<"calls"> });
  const cases = useQuery(api.cases.getCases);
  const contacts = useQuery(api.contacts.getContacts);

  const mappedCases = useMemo(() => (cases ? mapDocs(cases) : []), [cases]);
  const mappedContacts = useMemo(() => (contacts ? mapDocs(contacts) : []), [contacts]);

  const suggestion = useMemo(() => {
    if (!suggestionDoc) return null;
    const doc = mapDoc(suggestionDoc);
    return {
      ...doc,
      callId: doc.callId as string,
      suggestedExistingCaseId: doc.suggestedExistingCaseId as string | undefined,
      suggestedExistingContactId: doc.suggestedExistingContactId as string | undefined,
      extractedEntities: (doc.entitySuggestions ?? []).map((e, index: number) => ({
        id: `entity-${callId}-${index}`,
        type: e.type,
        label: e.label,
        value: e.value,
        confidence: e.confidence,
      })) as ExtractedEntity[],
      suggestedActionItems: (doc.actionItemSuggestions ?? []).map((a, index: number) => ({
        id: `action-${callId}-${index}`,
        title: a.title,
        description: a.description,
        dueAt: a.dueAt,
        status: "open" as const,
        source: "simulated" as const,
      })) as ActionItem[],
      suggestedReminder: doc.reminderTitle
        ? ({
            id: `reminder-${callId}`,
            title: doc.reminderTitle,
            remindAt: doc.reminderDueAt ?? new Date().toISOString(),
            status: "upcoming" as const,
            source: "simulated" as const,
          } as Reminder)
        : undefined,
      suggestedContactCreation: doc.suggestedNewContactName
        ? {
            name: doc.suggestedNewContactName,
            type: (doc.suggestedNewContactType as string) ?? "other",
            country: doc.suggestedNewContactCountry ?? "Unknown",
            phoneNumber: doc.suggestedNewContactPhone ?? "",
          }
        : undefined,
      participants: (doc.participants as Participants | undefined) ?? defaultParticipants(),
      reviewedMeaning: doc.reviewedMeaning as ReviewedMeaning | undefined,
    } satisfies ReviewWorkspaceSuggestion;
  }, [suggestionDoc, callId]);

  if (!suggestion) {
    return (
      <EmptyState
        title="No review suggestion found"
        description="This call does not have pending AI review data in Convex."
        href={`/app/calls/${callId}`}
        action="Open call detail"
      />
    );
  }

  return (
    <ReviewWorkspaceForm
      key={suggestion.id}
      callId={callId}
      suggestion={suggestion}
      cases={mappedCases}
      contacts={mappedContacts}
      onAccept={onAccept}
      onDismiss={onDismiss}
    >
      {children}
    </ReviewWorkspaceForm>
  );
}

function ReviewWorkspaceForm({
  callId,
  suggestion,
  cases,
  contacts,
  onAccept,
  onDismiss,
  children,
}: {
  callId: string;
  suggestion: ReviewWorkspaceSuggestion;
  cases: Case[];
  contacts: Contact[];
  onAccept?: () => void;
  onDismiss?: () => void;
  children?: ReactNode;
}) {
  const router = useRouter();
  const acceptReviewSuggestion = useMutation(api.reviewSuggestions.acceptReviewSuggestion);
  const dismissReviewSuggestion = useMutation(api.reviewSuggestions.dismissReviewSuggestion);

  const [summary, setSummary] = useState(suggestion.summary ?? "");
  const [entities, setEntities] = useState<ExtractedEntity[]>(suggestion.extractedEntities ?? []);
  const [actionItems, setActionItems] = useState<ActionItem[]>(suggestion.suggestedActionItems ?? []);
  const [reminder, setReminder] = useState<Reminder | undefined>(suggestion.suggestedReminder);
  const [caseChoice, setCaseChoice] = useState(suggestion.suggestedExistingCaseId ?? (suggestion.suggestedNewCaseTitle ? "__new__" : ""));
  const [newCaseTitle, setNewCaseTitle] = useState(suggestion.suggestedNewCaseTitle ?? "");
  const [contactChoice, setContactChoice] = useState(suggestion.suggestedExistingContactId ?? "");
  const [contactCreation, setContactCreation] = useState(suggestion.suggestedContactCreation);
  const [participants, setParticipants] = useState<Participants>(suggestion.participants ?? defaultParticipants());
  const [reviewedMeaning, setReviewedMeaning] = useState<ReviewedMeaningFormState>(
    defaultReviewedMeaningState(suggestion.reviewedMeaning)
  );
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [error, setError] = useState("");
  const reviewedMeaningHasContent = Boolean(
    suggestion.reviewedMeaning?.reviewedObjective ||
      suggestion.reviewedMeaning?.outcomeStatus ||
      (suggestion.reviewedMeaning?.unresolvedQuestions?.length ?? 0) > 0 ||
      (suggestion.reviewedMeaning?.escalationTriggers?.length ?? 0) > 0 ||
      suggestion.reviewedMeaning?.humanCorrectionSummary ||
      suggestion.reviewedMeaning?.playbookHint
  );
  const [reviewedMeaningOpen, setReviewedMeaningOpen] = useState(reviewedMeaningHasContent);
  // The happy path is scan-and-accept; linking details stay one click away so
  // the review form doesn't read as mandatory admin work.
  const [participantsOpen, setParticipantsOpen] = useState(false);

  const suggestedCase = useMemo(
    () => cases.find((caseItem) => caseItem.id === suggestion.suggestedExistingCaseId),
    [cases, suggestion.suggestedExistingCaseId]
  );

  const linkedCase = useMemo(
    () => (caseChoice && caseChoice !== "__new__" ? cases.find((caseItem) => caseItem.id === caseChoice) : undefined),
    [caseChoice, cases]
  );
  const linkedContact = useMemo(
    () => (contactChoice ? contacts.find((contact) => contact.id === contactChoice) : undefined),
    [contactChoice, contacts]
  );

  const linkingSummary = useMemo(() => {
    const parts: string[] = [];
    if (caseChoice === "__new__" && newCaseTitle.trim()) {
      parts.push(`new thread "${newCaseTitle.trim()}"`);
    } else if (linkedCase) {
      parts.push(`thread "${linkedCase.title}"`);
    }
    if (linkedContact) {
      parts.push(`contact ${linkedContact.name}`);
    } else if (contactCreation?.name) {
      parts.push(`new contact ${contactCreation.name}`);
    }
    return parts.length > 0 ? `Links to ${parts.join(" and ")}.` : "Not linked to a thread or contact.";
  }, [caseChoice, newCaseTitle, linkedCase, linkedContact, contactCreation]);

  const displayedEntities = useMemo(
    () => entities.filter((entity) => !["person", "organization"].includes(entity.type.toLowerCase())),
    [entities]
  );
  const suggestedEntityCount = useMemo(
    () =>
      (suggestion.extractedEntities ?? []).filter(
        (entity) => !["person", "organization"].includes(entity.type.toLowerCase())
      ).length,
    [suggestion.extractedEntities]
  );
  const riskEntityTypes = new Set(["risk_flag", "discrepancy"]);

  const savedActionItems = actionItems.filter((item) => item.title.trim());
  const savedReminder = reminder?.title.trim() ? reminder : undefined;
  const saveSummary = [
    `${displayedEntities.length} detail${displayedEntities.length === 1 ? "" : "s"}`,
    `${savedActionItems.length} action item${savedActionItems.length === 1 ? "" : "s"}`,
    savedReminder ? "1 reminder" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function markEdited() {
    setEdited(true);
    setError("");
  }

  function updateActionItem(index: number, patch: Partial<ActionItem>) {
    markEdited();
    setActionItems((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addActionItem() {
    markEdited();
    setActionItems((items) => [
      ...items,
      {
        id: `action-${callId}-new-${Date.now()}`,
        title: "",
        description: "",
        status: "open",
        source: "simulated",
      } as ActionItem,
    ]);
  }

  function addReminder() {
    markEdited();
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(9, 0, 0, 0);
    setReminder({
      id: `reminder-${callId}`,
      title: "",
      remindAt: nextWeek.toISOString(),
      status: "upcoming",
      source: "simulated",
    } as Reminder);
  }

  async function accept() {
    if (busy) return;
    setBusy("accept");
    setError("");
    const reviewedMeaningPayload = {
      unresolvedQuestions: listFromLines(reviewedMeaning.unresolvedQuestions),
      escalationTriggers: listFromLines(reviewedMeaning.escalationTriggers),
      completeness: reviewedMeaning.completeness,
      ...(optionalText(reviewedMeaning.reviewedObjective)
        ? { reviewedObjective: optionalText(reviewedMeaning.reviewedObjective) }
        : {}),
      ...(optionalText(reviewedMeaning.outcomeStatus)
        ? { outcomeStatus: optionalText(reviewedMeaning.outcomeStatus) }
        : {}),
      ...(optionalText(reviewedMeaning.humanCorrectionSummary)
        ? { humanCorrectionSummary: optionalText(reviewedMeaning.humanCorrectionSummary) }
        : {}),
      ...(optionalText(reviewedMeaning.playbookHint)
        ? { playbookHint: optionalText(reviewedMeaning.playbookHint) }
        : {}),
    };
    try {
      await acceptReviewSuggestion({
        callId: callId as Id<"calls">,
        summary,
        extractedEntities: entities.map((e) => ({ type: e.type, label: e.label, value: e.value, confidence: e.confidence })),
        actionItems: savedActionItems.map((a) => ({
          id: a.id,
          title: a.title.trim(),
          description: a.description,
          dueAt: a.dueAt,
          status: a.status,
        })),
        reminder: savedReminder
          ? { id: savedReminder.id, title: savedReminder.title.trim(), remindAt: savedReminder.remindAt, status: savedReminder.status }
          : undefined,
        caseId: caseChoice && caseChoice !== "__new__" ? (caseChoice as Id<"cases">) : undefined,
        newCaseTitle: caseChoice === "__new__" ? newCaseTitle : undefined,
        contactId: (contactChoice || undefined) as Id<"contacts"> | undefined,
        contactCreation: !contactChoice ? contactCreation : undefined,
        participants,
        reviewedMeaning: reviewedMeaningPayload,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this call record.");
      setBusy(null);
      return;
    }
    captureProductEvent("call_memory_reviewed", {
      route: "/app/calls/[id]",
      result: "accepted",
    });
    if (onAccept) {
      onAccept();
    } else {
      router.push(`/app/calls/${callId}`);
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy("dismiss");
    setError("");
    try {
      await dismissReviewSuggestion({ callId: callId as Id<"calls"> });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not discard this draft.");
      setBusy(null);
      setConfirmDismiss(false);
      return;
    }
    captureProductEvent("call_memory_reviewed", {
      route: "/app/calls/[id]",
      result: "dismissed",
    });
    if (onDismiss) {
      onDismiss();
    } else {
      router.push(`/app/calls/${callId}`);
    }
  }

  const callerName = participants.caller.name || "Unknown";
  const subjectName = participants.subject.name || callerName;

  return (
    <div className="space-y-5">
      {/* AI note — primary focus; detected call type + editable summary live here */}
      <div id="note" className="scroll-mt-24">
        <AINotesCard
          summary={summary}
          participants={participants}
          reviewStatus="pending"
          detectedCallType={suggestion.detectedCallType}
          callTypeConfidenceLabel={edited ? "Edited" : confidenceLabel(suggestion.confidence)}
          editableSummary
          onSummaryChange={(value) => {
            markEdited();
            setSummary(value);
          }}
          onUpdateParticipants={(next) => {
            markEdited();
            setParticipants(next);
          }}
        />
      </div>

      {suggestedEntityCount > 0 ? (
        <section id="extracted-details" className={`${cardClass} scroll-mt-24`}>
          <SectionHeader
            icon={<Tags aria-hidden="true" className="h-4 w-4" />}
            title="Extracted details"
            count={displayedEntities.length}
            hint="Facts pulled from the conversation. Remove anything that is wrong or not worth keeping."
          />
          {displayedEntities.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {displayedEntities.map((entity) => (
                <div
                  key={entity.id}
                  className={
                    riskEntityTypes.has(entity.type.toLowerCase())
                      ? "rounded-lg border-l-4 border-amber-400 dark:border-amber-500"
                      : ""
                  }
                >
                  <EntityBadge
                    entity={entity}
                    onRemove={() => {
                      markEdited();
                      setEntities((items) => items.filter((item) => item.id !== entity.id));
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-stone-300 px-4 py-3 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
              All suggested details were removed. None will be saved with this record.
            </p>
          )}
        </section>
      ) : null}

      <section id="follow-ups" className={`${cardClass} scroll-mt-24`}>
        <SectionHeader
          icon={<ListChecks aria-hidden="true" className="h-4 w-4" />}
          title="Follow-ups"
          count={savedActionItems.length + (savedReminder ? 1 : 0)}
          hint="Action items and the reminder created for the team when you accept."
        />

        <div className="mt-4 space-y-3">
          {actionItems.map((item, index) => (
            <div
              key={item.id}
              className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-700 dark:bg-stone-800/40"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-stone-500 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-700">
                  {index + 1}
                </span>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Action item title</span>
                  <input
                    value={item.title}
                    placeholder="What needs to happen"
                    onChange={(event) => updateActionItem(index, { title: event.target.value })}
                    className={`${inputClass} h-9 font-semibold`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    markEdited();
                    setActionItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
                  }}
                  aria-label={`Remove action item ${index + 1}`}
                  title="Remove action item"
                  className={removeButtonClass}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <label className="mt-2 block pl-8">
                <span className="sr-only">Action item details</span>
                <textarea
                  value={item.description}
                  placeholder="Context, owner, or deadline (optional)"
                  rows={2}
                  onChange={(event) => updateActionItem(index, { description: event.target.value })}
                  className={`${textareaClass} min-h-[3.25rem]`}
                />
              </label>
            </div>
          ))}
          {actionItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 px-4 py-3 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
              No action items suggested for this call.
            </p>
          ) : null}
          <button type="button" onClick={addActionItem} className={ghostButtonClass}>
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Add action item
          </button>
        </div>

        <div className="mt-5 border-t border-stone-200/80 pt-4 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <Bell aria-hidden="true" className="h-4 w-4 text-stone-500 dark:text-stone-400" />
            <h3 className={sectionTitleClass}>Reminder</h3>
          </div>
          {reminder ? (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1">
                <span className={fieldLabelClass}>Remind the team to</span>
                <input
                  value={reminder.title}
                  placeholder="Follow up on…"
                  onChange={(event) => {
                    markEdited();
                    setReminder({ ...reminder, title: event.target.value });
                  }}
                  className={`${inputClass} mt-1 font-semibold`}
                />
              </label>
              <label className="sm:w-60">
                <span className={fieldLabelClass}>When</span>
                <input
                  type="datetime-local"
                  value={toInputDateTime(reminder.remindAt)}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    markEdited();
                    setReminder({ ...reminder, remindAt: fromInputDateTime(event.target.value) });
                  }}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  markEdited();
                  setReminder(undefined);
                }}
                aria-label="Remove reminder"
                title="Remove reminder"
                className={`${removeButtonClass} h-10 w-10 sm:mb-0`}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-stone-500 dark:text-stone-400">No reminder will be created.</p>
              <button type="button" onClick={addReminder} className={ghostButtonClass}>
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Add reminder
              </button>
            </div>
          )}
        </div>
      </section>

      <section id="contact" className={`${cardClass} scroll-mt-24`}>
        <button
          type="button"
          onClick={() => setParticipantsOpen((value) => !value)}
          aria-expanded={participantsOpen}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ContactRound aria-hidden="true" className="h-4 w-4 text-stone-500 dark:text-stone-400" />
              <h2 className={sectionTitleClass}>People, thread &amp; contact</h2>
            </div>
            <p className={sectionHintClass}>
              {participantsOpen
                ? "Caller, representative, and institution names are edited on the AI note above."
                : linkingSummary}
            </p>
          </div>
          <ChevronDown
            aria-hidden="true"
            className={`mt-1 h-4 w-4 shrink-0 text-stone-400 transition ${participantsOpen ? "rotate-180" : ""}`}
          />
        </button>

        <div className={participantsOpen ? "mt-4 grid gap-5 lg:grid-cols-2" : "hidden"}>
          <div className="space-y-4">
            <label className="block">
              <span className={fieldLabelClass}>Subject / customer</span>
              <input
                value={subjectName}
                onChange={(event) => {
                  markEdited();
                  setParticipants((prev) => ({
                    ...prev,
                    subject: { ...prev.subject, name: event.target.value || null },
                  }));
                }}
                className={`${inputClass} mt-1 font-semibold`}
              />
              <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
                {titleCase(participants.subject.subjectType)} · {confidenceLabel(participants.subject.confidence)}
              </span>
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Contact / institution</span>
              <select
                value={contactChoice}
                onChange={(event) => {
                  markEdited();
                  setContactChoice(event.target.value);
                }}
                className={`${inputClass} mt-1`}
              >
                <option value="">
                  {contactCreation ? `Create new contact: ${contactCreation.name || "unnamed"}` : "Leave unlinked"}
                </option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            {contactCreation && !contactChoice ? (
              <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-700 dark:bg-stone-800/40">
                <label className="block">
                  <span className={fieldLabelClass}>New contact name</span>
                  <input
                    value={contactCreation.name}
                    onChange={(event) => {
                      markEdited();
                      setContactCreation({ ...contactCreation, name: event.target.value });
                    }}
                    className={`${inputClass} mt-1 font-semibold`}
                  />
                </label>
                {contactCreation.phoneNumber ? (
                  <p className="mt-2 font-mono text-sm text-stone-600 dark:text-stone-400">{contactCreation.phoneNumber}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className={fieldLabelClass}>Work thread</span>
              <select
                value={caseChoice}
                onChange={(event) => {
                  markEdited();
                  setCaseChoice(event.target.value);
                }}
                className={`${inputClass} mt-1`}
              >
                <option value="">Leave unlinked</option>
                {suggestedCase ? <option value={suggestedCase.id}>Suggested: {suggestedCase.title}</option> : null}
                <option value="__new__">Create new thread</option>
                {cases
                  .filter((caseItem) => caseItem.id !== suggestedCase?.id)
                  .map((caseItem) => (
                    <option key={caseItem.id} value={caseItem.id}>
                      {caseItem.title}
                    </option>
                  ))}
              </select>
            </label>
            {caseChoice === "__new__" ? (
              <label className="block">
                <span className={fieldLabelClass}>New thread title</span>
                <input
                  value={newCaseTitle}
                  onChange={(event) => {
                    markEdited();
                    setNewCaseTitle(event.target.value);
                  }}
                  className={`${inputClass} mt-1`}
                />
              </label>
            ) : null}
          </div>
        </div>
      </section>

      <section className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => setReviewedMeaningOpen((value) => !value)}
            className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
            aria-expanded={reviewedMeaningOpen}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Compass aria-hidden="true" className="h-4 w-4 text-stone-500 dark:text-stone-400" />
                <h2 className={sectionTitleClass}>Next-call context</h2>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  Optional
                </span>
              </div>
              <p className={sectionHintClass}>
                {reviewedMeaningOpen
                  ? "Shown to whoever handles the next call with this contact or thread."
                  : "Objective, outcome, and open questions for whoever picks this up next."}
              </p>
            </div>
            <ChevronDown
              aria-hidden="true"
              className={`mt-1 h-4 w-4 shrink-0 text-stone-400 transition ${reviewedMeaningOpen ? "rotate-180" : ""}`}
            />
          </button>
          <label className="block sm:w-48">
            <span className={fieldLabelClass}>Record quality</span>
            <select
              value={reviewedMeaning.completeness}
              onChange={(event) => {
                markEdited();
                setReviewedMeaning((prev) => ({
                  ...prev,
                  completeness: event.target.value as ReviewedMeaningCompleteness,
                }));
              }}
              className={`${inputClass} mt-1 h-9 font-medium`}
            >
              <option value="complete">Complete</option>
              <option value="partial">Partial</option>
              <option value="needs_follow_up">Needs follow-up</option>
              <option value="uncertain">Uncertain</option>
            </select>
          </label>
        </div>
        {reviewedMeaningOpen ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className={fieldLabelClass}>Reviewed objective</span>
              <input
                value={reviewedMeaning.reviewedObjective}
                onChange={(event) => {
                  markEdited();
                  setReviewedMeaning((prev) => ({ ...prev, reviewedObjective: event.target.value }));
                }}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Outcome / status</span>
              <input
                value={reviewedMeaning.outcomeStatus}
                onChange={(event) => {
                  markEdited();
                  setReviewedMeaning((prev) => ({ ...prev, outcomeStatus: event.target.value }));
                }}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Open questions</span>
              <textarea
                value={reviewedMeaning.unresolvedQuestions}
                placeholder="One per line"
                onChange={(event) => {
                  markEdited();
                  setReviewedMeaning((prev) => ({ ...prev, unresolvedQuestions: event.target.value }));
                }}
                className={`${textareaClass} mt-1 min-h-20`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Escalation cues</span>
              <textarea
                value={reviewedMeaning.escalationTriggers}
                placeholder="One per line"
                onChange={(event) => {
                  markEdited();
                  setReviewedMeaning((prev) => ({ ...prev, escalationTriggers: event.target.value }));
                }}
                className={`${textareaClass} mt-1 min-h-20`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Human correction summary</span>
              <textarea
                value={reviewedMeaning.humanCorrectionSummary}
                onChange={(event) => {
                  markEdited();
                  setReviewedMeaning((prev) => ({ ...prev, humanCorrectionSummary: event.target.value }));
                }}
                className={`${textareaClass} mt-1 min-h-20`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Playbook note</span>
              <textarea
                value={reviewedMeaning.playbookHint}
                onChange={(event) => {
                  markEdited();
                  setReviewedMeaning((prev) => ({ ...prev, playbookHint: event.target.value }));
                }}
                className={`${textareaClass} mt-1 min-h-20`}
              />
            </label>
          </div>
        ) : null}
      </section>

      {children}

      {/* Sticky decision bar: always reachable while reviewing, settles at the end of the page. */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4">
        <div className="rounded-xl border border-stone-200 bg-white/95 p-3 shadow-lg shadow-stone-950/10 backdrop-blur dark:border-stone-700 dark:bg-stone-900/95 sm:px-4">
          {error ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {edited ? "Edited draft" : "AI draft"}
                <span className="font-normal text-stone-500 dark:text-stone-400"> · {saveSummary}</span>
              </p>
              <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{linkingSummary}</p>
            </div>
            {confirmDismiss ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                <span className="text-sm text-stone-600 dark:text-stone-300 sm:mr-1">Discard this draft?</span>
                <button
                  type="button"
                  onClick={() => setConfirmDismiss(false)}
                  disabled={busy !== null}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  Keep reviewing
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  disabled={busy !== null}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
                >
                  {busy === "dismiss" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <X aria-hidden="true" className="h-4 w-4" />}
                  {busy === "dismiss" ? "Discarding…" : "Discard draft"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => setConfirmDismiss(true)}
                  disabled={busy !== null}
                  className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={accept}
                  disabled={busy !== null}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy === "accept" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
                  {busy === "accept" ? "Saving…" : "Accept & save record"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
