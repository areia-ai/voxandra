"use client";

import { type ReactNode, type RefObject, useCallback, useRef, useState } from "react";
import { Building2, Check, NotebookPen, Pencil, UserRoundCheck } from "lucide-react";
import type { Participants } from "@/lib/types";
import { titleCase } from "@/lib/format";

interface AINotesCardProps {
  summary: string;
  participants?: Participants;
  reviewStatus?: string;
  onUpdateParticipants?: (participants: Participants) => void;
  className?: string;
  detectedCallType?: string;
  callTypeConfidenceLabel?: string;
  editableSummary?: boolean;
  onSummaryChange?: (value: string) => void;
}

type HighlightTone = "caller" | "representative" | "institution";

function defaultParticipants(): Participants {
  return {
    caller: { name: null, roleLabel: "unknown", confidence: 0, evidence: null },
    representative: { name: null, roleLabel: "unknown", confidence: 0, evidence: null, institutionName: null },
    institution: { name: null, type: "unknown", confidence: 0, evidence: null },
    subject: { name: null, subjectType: "unknown", confidence: 0, evidence: null },
  };
}

function normalizedName(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed && trimmed !== fallback ? trimmed : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightClass(tone: HighlightTone) {
  if (tone === "caller") return "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
  if (tone === "representative") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300";
}

function buttonChipClass(tone: HighlightTone) {
  if (tone === "caller") return "bg-violet-100 text-violet-800 hover:bg-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/60";
  if (tone === "representative") return "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60";
  return "border border-green-100 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300 dark:hover:bg-green-950/50";
}

function inputChipClass(tone: HighlightTone) {
  if (tone === "caller") return "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
  if (tone === "representative") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "border border-green-100 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300";
}

export function AINotesCard({
  summary,
  participants,
  reviewStatus,
  onUpdateParticipants,
  className = "",
  detectedCallType,
  callTypeConfidenceLabel,
  editableSummary = false,
  onSummaryChange,
}: AINotesCardProps) {
  const parts = participants ?? defaultParticipants();
  const [editingSummary, setEditingSummary] = useState(false);
  const [draftSummary, setDraftSummary] = useState(summary);
  const derivedCallerName = parts.caller.name || "Caller";
  const derivedRepresentativeName = parts.representative.name || "Representative";
  const derivedInstitutionName = parts.institution.name || parts.representative.institutionName || "Institution";

  const [editingCaller, setEditingCaller] = useState(false);
  const [editingRepresentative, setEditingRepresentative] = useState(false);
  const [editingInstitution, setEditingInstitution] = useState(false);
  const [draftCallerName, setDraftCallerName] = useState(derivedCallerName);
  const [draftRepresentativeName, setDraftRepresentativeName] = useState(derivedRepresentativeName);
  const [draftInstitutionName, setDraftInstitutionName] = useState(derivedInstitutionName);
  const callerInputRef = useRef<HTMLInputElement>(null);
  const representativeInputRef = useRef<HTMLInputElement>(null);
  const institutionInputRef = useRef<HTMLInputElement>(null);

  const startEditingCaller = useCallback(() => {
    setDraftCallerName(derivedCallerName);
    setEditingCaller(true);
    setTimeout(() => callerInputRef.current?.focus(), 0);
  }, [derivedCallerName]);

  const startEditingRepresentative = useCallback(() => {
    setDraftRepresentativeName(derivedRepresentativeName);
    setEditingRepresentative(true);
    setTimeout(() => representativeInputRef.current?.focus(), 0);
  }, [derivedRepresentativeName]);

  const startEditingInstitution = useCallback(() => {
    setDraftInstitutionName(derivedInstitutionName);
    setEditingInstitution(true);
    setTimeout(() => institutionInputRef.current?.focus(), 0);
  }, [derivedInstitutionName]);

  function commitCallerName() {
    setEditingCaller(false);
    onUpdateParticipants?.({
      ...parts,
      caller: { ...parts.caller, name: normalizedName(draftCallerName, "Caller") },
    });
  }

  function commitRepresentativeName() {
    setEditingRepresentative(false);
    onUpdateParticipants?.({
      ...parts,
      representative: {
        ...parts.representative,
        name: normalizedName(draftRepresentativeName, "Representative"),
      },
    });
  }

  function commitInstitutionName() {
    const name = normalizedName(draftInstitutionName, "Institution");
    setEditingInstitution(false);
    onUpdateParticipants?.({
      ...parts,
      representative: { ...parts.representative, institutionName: name },
      institution: { ...parts.institution, name },
    });
  }

  function getStatusBadge() {
    if (reviewStatus === "pending" || reviewStatus === "review_pending") {
      return (
        <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
          Ready to review
        </span>
      );
    }
    if (reviewStatus === "accepted") {
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          Accepted
        </span>
      );
    }
    if (reviewStatus === "dismissed") {
      return (
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          Dismissed
        </span>
      );
    }
    return null;
  }

  function renderEditableChip({
    editing,
    inputRef,
    value,
    displayValue,
    setValue,
    commit,
    startEditing,
    tone,
    icon,
    ariaLabel,
    known = true,
  }: {
    editing: boolean;
    inputRef: RefObject<HTMLInputElement | null>;
    value: string;
    displayValue: string;
    setValue: (value: string) => void;
    commit: () => void;
    startEditing: () => void;
    tone: HighlightTone;
    icon: ReactNode;
    ariaLabel: string;
    known?: boolean;
  }) {
    if (editing) {
      return (
        <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 ${inputChipClass(tone)}`}>
          {icon}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            className="w-28 max-w-[11rem] bg-transparent text-sm font-semibold outline-none"
          />
        </span>
      );
    }

    // An unrecognized participant renders as an explicit "add" affordance
    // instead of a role word styled like extracted content.
    if (!known) {
      return (
        <button
          type="button"
          onClick={startEditing}
          aria-label={ariaLabel}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-500 transition hover:border-violet-300 hover:text-violet-700 dark:border-stone-600 dark:text-stone-400 dark:hover:border-violet-600 dark:hover:text-violet-300"
        >
          {icon}
          <span className="truncate">{displayValue}</span>
          <Pencil className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={startEditing}
        aria-label={ariaLabel}
        className={`group inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${buttonChipClass(tone)}`}
      >
        {icon}
        <span className="truncate">{displayValue}</span>
        <Pencil className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
      </button>
    );
  }

  function renderHighlightedSummary() {
    if (!summary) return <p className="text-sm text-stone-500 dark:text-stone-400">No summary available.</p>;

    const highlights = [
      { value: parts.caller.name, tone: "caller" as const },
      { value: parts.representative.name, tone: "representative" as const },
      { value: parts.institution.name || parts.representative.institutionName, tone: "institution" as const },
    ].filter((item): item is { value: string; tone: HighlightTone } => Boolean(item.value?.trim()));

    const uniqueHighlights = Array.from(
      new Map(highlights.map((item) => [item.value.trim().toLowerCase(), { ...item, value: item.value.trim() }])).values()
    );

    if (uniqueHighlights.length === 0) {
      return <p className="text-[15px] leading-7 text-stone-800 dark:text-stone-200">{summary}</p>;
    }

    let remaining = summary;
    const elements: ReactNode[] = [];
    let keyIndex = 0;

    while (remaining.length > 0) {
      let earliestMatch: { index: number; length: number; tone: HighlightTone } | null = null;

      for (const item of uniqueHighlights) {
        const match = new RegExp(escapeRegExp(item.value), "i").exec(remaining);
        if (
          match &&
          (earliestMatch === null ||
            match.index < earliestMatch.index ||
            (match.index === earliestMatch.index && item.value.length > earliestMatch.length))
        ) {
          earliestMatch = { index: match.index, length: item.value.length, tone: item.tone };
        }
      }

      if (!earliestMatch) {
        elements.push(<span key={keyIndex++}>{remaining}</span>);
        break;
      }

      if (earliestMatch.index > 0) {
        elements.push(<span key={keyIndex++}>{remaining.slice(0, earliestMatch.index)}</span>);
      }

      const matchedText = remaining.slice(earliestMatch.index, earliestMatch.index + earliestMatch.length);
      elements.push(
        <span
          key={keyIndex++}
          className={`inline rounded-md px-1.5 py-0.5 font-semibold ${highlightClass(earliestMatch.tone)}`}
        >
          {matchedText}
        </span>
      );

      remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
    }

    return <p className="text-[15px] leading-7 text-stone-800 dark:text-stone-200">{elements}</p>;
  }

  return (
    <div className={`rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <NotebookPen className="h-4 w-4 text-stone-600 dark:text-stone-400" />
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">AI note</h3>
          {detectedCallType ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
              {titleCase(detectedCallType)}
              {callTypeConfidenceLabel ? (
                <span className="text-teal-600 dark:text-teal-400">· {callTypeConfidenceLabel}</span>
              ) : null}
            </span>
          ) : null}
        </div>
        {getStatusBadge()}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {renderEditableChip({
          editing: editingCaller,
          inputRef: callerInputRef,
          value: draftCallerName,
          displayValue: parts.caller.name?.trim() ? derivedCallerName : "Add caller",
          known: Boolean(parts.caller.name?.trim()),
          setValue: setDraftCallerName,
          commit: commitCallerName,
          startEditing: startEditingCaller,
          tone: "caller",
          icon: <UserRoundCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />,
          ariaLabel: "Edit caller name",
        })}

        <span className="text-sm text-stone-400 dark:text-stone-500">called</span>

        {renderEditableChip({
          editing: editingRepresentative,
          inputRef: representativeInputRef,
          value: draftRepresentativeName,
          displayValue: parts.representative.name?.trim() ? derivedRepresentativeName : "Add representative",
          known: Boolean(parts.representative.name?.trim()),
          setValue: setDraftRepresentativeName,
          commit: commitRepresentativeName,
          startEditing: startEditingRepresentative,
          tone: "representative",
          icon: <UserRoundCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />,
          ariaLabel: "Edit representative name",
        })}

        <span className="text-sm text-stone-400 dark:text-stone-500">at</span>

        {renderEditableChip({
          editing: editingInstitution,
          inputRef: institutionInputRef,
          value: draftInstitutionName,
          displayValue:
            (parts.institution.name || parts.representative.institutionName)?.trim()
              ? derivedInstitutionName
              : "Add institution",
          known: Boolean((parts.institution.name || parts.representative.institutionName)?.trim()),
          setValue: setDraftInstitutionName,
          commit: commitInstitutionName,
          startEditing: startEditingInstitution,
          tone: "institution",
          icon: <Building2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />,
          ariaLabel: "Edit institution name",
        })}
      </div>

      {editableSummary ? (
        editingSummary ? (
          <div className="rounded-lg bg-stone-50/50 p-4 dark:bg-stone-800/40">
            <textarea
              autoFocus
              value={draftSummary}
              onChange={(event) => setDraftSummary(event.target.value)}
              className="min-h-28 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px] leading-7 text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            />
            <button
              type="button"
              onClick={() => {
                setEditingSummary(false);
                onSummaryChange?.(draftSummary);
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-dark"
            >
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
              Done
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftSummary(summary);
              setEditingSummary(true);
            }}
            className="group w-full rounded-lg bg-stone-50/50 p-4 text-left transition hover:bg-stone-100/70 dark:bg-stone-800/40 dark:hover:bg-stone-800/70"
          >
            {renderHighlightedSummary()}
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-stone-400 opacity-0 transition group-hover:opacity-100 dark:text-stone-500">
              <Pencil aria-hidden="true" className="h-3 w-3" />
              Edit summary
            </span>
          </button>
        )
      ) : (
        <div className="rounded-lg bg-stone-50/50 p-4 dark:bg-stone-800/40">{renderHighlightedSummary()}</div>
      )}
    </div>
  );
}
