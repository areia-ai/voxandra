"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, PencilLine, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type {
  Transcript,
  TranscriptSegment,
  TranscriptSpeakerMapping,
  TranscriptSpeakerRole,
} from "@/lib/types";

const ROLE_LABELS: Record<TranscriptSpeakerRole, string> = {
  caller: "Contact",
  representative: "Representative",
  institution: "Institution",
  subject: "Subject",
  other: "Other",
};

const ROLE_OPTIONS: TranscriptSpeakerRole[] = [
  "caller",
  "representative",
  "institution",
  "subject",
  "other",
];

const COLLAPSE_SEGMENT_THRESHOLD = 8;
const COLLAPSE_TEXT_THRESHOLD = 1800;
const PREVIEW_SEGMENT_COUNT = 6;
const PREVIEW_TEXT_LENGTH = 1200;

function uniqueSpeakerLabels(segments: TranscriptSegment[]) {
  return Array.from(new Set(
    segments
      .map((segment) => segment.speaker.trim())
      .filter((speaker) => speaker && speaker !== "combined")
  ));
}

function defaultMappings(transcript: Transcript): TranscriptSpeakerMapping[] {
  const existing = transcript.speakerMappings ?? [];
  const existingByLabel = new Map(existing.map((mapping) => [mapping.label, mapping]));
  return uniqueSpeakerLabels(transcript.segments).map((label) => (
    existingByLabel.get(label) ?? {
      label,
      name: `Speaker ${label}`,
      role: "other",
      source: "ai_inferred",
    }
  ));
}

function displayName(mappingByLabel: Map<string, TranscriptSpeakerMapping>, speaker: string) {
  if (speaker === "combined") return "Transcript";
  return mappingByLabel.get(speaker)?.name || `Speaker ${speaker}`;
}

function speakerRole(mappingByLabel: Map<string, TranscriptSpeakerMapping>, speaker: string) {
  if (speaker === "combined") return null;
  return mappingByLabel.get(speaker)?.role ?? "other";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "T";
}

function groupedSegments(segments: TranscriptSegment[]) {
  return segments.reduce<TranscriptSegment[]>((groups, segment) => {
    const previous = groups[groups.length - 1];
    if (previous && previous.speaker === segment.speaker) {
      const previousText = previous.text;
      previous.text = `${previous.text}\n${segment.text}`.trim();
      if (previous.originalText || segment.originalText) {
        previous.originalText = `${previous.originalText ?? previousText}\n${segment.originalText ?? segment.text}`.trim();
      }
      if (previous.translatedText || segment.translatedText) {
        previous.translatedText = `${previous.translatedText ?? previousText}\n${segment.translatedText ?? segment.text}`.trim();
      }
      previous.end = segment.end ?? previous.end;
    } else {
      groups.push({ ...segment });
    }
    return groups;
  }, []);
}

function speakerTone(role: TranscriptSpeakerRole | null) {
  if (role === "representative" || role === "institution") {
    return {
      avatar: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/40",
      badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
      block: "border-emerald-100 bg-emerald-50/35 text-stone-800 dark:border-emerald-900/40 dark:bg-emerald-950/15 dark:text-stone-200",
    };
  }

  if (role === "caller") {
    return {
      avatar: "bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/40",
      badge: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
      block: "border-violet-100 bg-violet-50/35 text-stone-800 dark:border-violet-900/40 dark:bg-violet-950/15 dark:text-stone-200",
    };
  }

  return {
    avatar: "bg-stone-100 text-stone-600 ring-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-800",
    badge: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    block: "border-stone-200 bg-stone-50/70 text-stone-800 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-200",
  };
}

function previewText(text: string) {
  if (text.length <= PREVIEW_TEXT_LENGTH) return text;
  return `${text.slice(0, PREVIEW_TEXT_LENGTH).trimEnd()}...`;
}

export function TranscriptViewer({ transcript }: { transcript: Transcript }) {
  const updateSpeakerMappings = useMutation(api.transcripts.updateSpeakerMappings);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftMappings, setDraftMappings] = useState<TranscriptSpeakerMapping[]>(() => defaultMappings(transcript));
  const [expanded, setExpanded] = useState(false);
  const [languageView, setLanguageView] = useState<"translated" | "original">("translated");

  const mappingByLabel = useMemo(() => {
    return new Map((editing ? draftMappings : transcript.speakerMappings ?? draftMappings).map((mapping) => [mapping.label, mapping]));
  }, [draftMappings, editing, transcript.speakerMappings]);
  const speakerCount = uniqueSpeakerLabels(transcript.segments).length;
  const hasDiarizedSpeakers = speakerCount > 1;
  const hasBilingualSegments = transcript.segments.some((segment) => Boolean(segment.translatedText && segment.originalText));
  const segments = transcript.segments.length > 0
    ? groupedSegments(transcript.segments)
    : [{ speaker: "combined", text: transcript.text }];
  const shouldCollapse = segments.length > COLLAPSE_SEGMENT_THRESHOLD || transcript.text.length > COLLAPSE_TEXT_THRESHOLD;
  const collapsed = shouldCollapse && !expanded;
  const visibleSegments = collapsed ? segments.slice(0, PREVIEW_SEGMENT_COUNT) : segments;
  const visibleText = collapsed ? previewText(transcript.text) : transcript.text;
  const showMetadata = Boolean(transcript.transcriptionFallbackFrom || hasDiarizedSpeakers);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updateSpeakerMappings({
        transcriptId: transcript.id as Id<"transcripts">,
        mappings: draftMappings.map((mapping) => ({
          label: mapping.label,
          name: mapping.name,
          role: mapping.role,
        })),
      });
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save speaker names.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="border-b border-stone-200 px-4 py-4 sm:px-5 dark:border-stone-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-stone-950 dark:text-stone-50">Transcript</h2>
            {showMetadata ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {transcript.transcriptionFallbackFrom ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                    fallback used
                  </span>
                ) : null}
                {hasDiarizedSpeakers ? (
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                    {speakerCount} speakers
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {hasBilingualSegments && !editing ? (
              <div className="inline-flex rounded-md border border-stone-300 bg-stone-50 p-0.5 text-xs dark:border-stone-700 dark:bg-stone-800" aria-label="Transcript language view">
                <button type="button" onClick={() => setLanguageView("translated")} className={`rounded px-2.5 py-1.5 font-semibold ${languageView === "translated" ? "bg-white text-violet-800 shadow-sm dark:bg-stone-700 dark:text-violet-200" : "text-stone-500"}`}>Translated</button>
                <button type="button" onClick={() => setLanguageView("original")} className={`rounded px-2.5 py-1.5 font-semibold ${languageView === "original" ? "bg-white text-violet-800 shadow-sm dark:bg-stone-700 dark:text-violet-200" : "text-stone-500"}`}>Original</button>
              </div>
            ) : null}
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraftMappings(defaultMappings(transcript));
                    setEditing(false);
                    setError("");
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 text-stone-600 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
                  aria-label="Cancel speaker edits"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-brand text-white transition hover:bg-brand-dark disabled:opacity-50"
                  aria-label="Save speaker edits"
                >
                  <Check aria-hidden="true" className="h-4 w-4" />
                </button>
              </>
            ) : hasDiarizedSpeakers ? (
              <button
                type="button"
                onClick={() => {
                  setDraftMappings(defaultMappings(transcript));
                  setEditing(true);
                  setError("");
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                aria-label="Edit speaker names"
              >
                <PencilLine aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
      </div>

      {editing ? (
        <div className="border-b border-stone-200 px-4 py-4 sm:px-5 dark:border-stone-800">
          <div className="mx-auto grid max-w-3xl gap-3 md:grid-cols-2">
            {draftMappings.map((mapping, index) => (
              <div key={mapping.label} className="grid gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <p className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Speaker {mapping.label}</p>
                <input
                  value={mapping.name}
                  onChange={(event) => {
                    const next = [...draftMappings];
                    next[index] = { ...mapping, name: event.target.value };
                    setDraftMappings(next);
                  }}
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                />
                <select
                  value={mapping.role}
                  onChange={(event) => {
                    const next = [...draftMappings];
                    next[index] = { ...mapping, role: event.target.value as TranscriptSpeakerRole };
                    setDraftMappings(next);
                  }}
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="px-4 py-5 sm:px-6">
        {hasDiarizedSpeakers ? (
          <div className="mx-auto max-w-3xl space-y-5">
            {visibleSegments.map((segment, index) => {
              const name = displayName(mappingByLabel, segment.speaker);
              const role = speakerRole(mappingByLabel, segment.speaker);
              const roleLabel = role ? ROLE_LABELS[role] : null;
              const tone = speakerTone(role);
              return (
                <article
                  key={`${segment.speaker}-${index}`}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3"
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-4 ${tone.avatar}`}>
                    {initials(name)}
                  </span>
                  <div className="min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{name}</span>
                      {roleLabel ? (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.badge}`}>
                          {roleLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className={`max-w-prose whitespace-pre-line rounded-lg border px-4 py-3 text-[15px] leading-7 ${tone.block}`}>
                      {languageView === "original" ? segment.originalText ?? segment.text : segment.translatedText ?? segment.text}
                    </p>
                    {hasBilingualSegments && segment.originalText && segment.translatedText ? (
                      <p className="mt-1 text-xs text-stone-400">
                        {languageView === "original" ? "Showing original speech" : "Showing translated speech"}
                        {segment.language ? ` · ${segment.language.toUpperCase()}` : ""}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            <p className="max-w-prose whitespace-pre-line rounded-lg border border-stone-200 bg-stone-50/70 px-4 py-3 text-[15px] leading-7 text-stone-800 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-200">
              {visibleText}
            </p>
          </div>
        )}
        {shouldCollapse ? (
          <div className="mx-auto mt-5 flex max-w-3xl justify-center border-t border-stone-100 pt-4 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronUp aria-hidden="true" className="h-4 w-4" />
              ) : (
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              )}
              {expanded ? "Collapse transcript" : "Show full transcript"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
