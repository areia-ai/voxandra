"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronRight,
  FileText,
  GitBranch,
  LayoutList,
  List,
  Loader2,
  MessageSquareText,
  NotebookPen,
  PhoneMissed,
  Search,
  Send,
  Sparkles,
  Voicemail,
  X,
} from "lucide-react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDuration } from "@/lib/format";

type MemoryView = "notes" | "transcript";
type NotesFilter = "all" | "with_reminders" | "processing";
type TranscriptFilter = "all" | "corrected" | "ai_inferred";
type SearchMode = "search" | "ask";
type Density = "comfortable" | "compact";
type AskCitation = {
  index: number;
  id: string;
  callId: string;
  title: string;
  snippet: string;
  sourceType: string;
  href: string;
  callStartedAt: string;
};
type AskResult = {
  answer: string;
  citations: AskCitation[];
  retrievalMode: string;
};

type CallRecordRows = FunctionReturnType<typeof api.notes.listCallRecords>;
type CallRecordRow = CallRecordRows["rows"][number];
type TranscriptRecordRows = FunctionReturnType<typeof api.transcripts.listTranscriptRecords>;
type TranscriptRecordRow = TranscriptRecordRows["rows"][number];

const NOTE_FILTERS: { value: NotesFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "with_reminders", label: "With reminders" },
  { value: "processing", label: "Processing" },
];

const TRANSCRIPT_FILTERS: { value: TranscriptFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "corrected", label: "Corrected speakers" },
  { value: "ai_inferred", label: "Suggested speakers" },
];

// Deliberately generic — these render before the user has any call history,
// so they must never reference specific contacts, companies, or case details
// that only exist in seed/demo data.
const SUGGESTED_QUESTIONS = [
  "What follow-ups are still open this week?",
  "Which calls mention a missing document?",
  "What did we promise to send on the last call?",
];

const PAGE_SIZE = 30;
const SEARCH_RESULT_LIMIT = 50;
const DENSITY_STORAGE_KEY = "voxandra.callRecords.density";

const FAILED_STATUSES = new Set([
  "call_failed",
  "recording_callback_missing",
  "transcription_failed",
  "failed",
]);

const FAILED_BADGE_LABELS: Record<string, string> = {
  call_failed: "Didn't connect",
  recording_callback_missing: "Recording missing",
  transcription_failed: "Transcription failed",
  failed: "Extraction failed",
};

function dateGroupFor(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  if (date >= startOfToday) return "Today";
  if (date >= startOfYesterday) return "Yesterday";
  if (date >= startOfWeek) return "This week";
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

// Rows arrive sorted newest-first, so first-seen bucket order is already the
// display order (Today, Yesterday, This week, then months descending).
function groupByDate<T>(items: T[], getIso: (item: T) => string) {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const group = dateGroupFor(getIso(item));
    const bucket = buckets.get(group);
    if (bucket) bucket.push(item);
    else buckets.set(group, [item]);
  }
  return Array.from(buckets.entries()).map(([group, groupItems]) => ({
    group,
    items: groupItems,
  }));
}

function timeLabelFor(iso: string) {
  const date = new Date(iso);
  const group = dateGroupFor(iso);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (group === "Today" || group === "Yesterday") return time;
  if (group === "This week") {
    return `${date.toLocaleDateString([], { weekday: "short" })}, ${time}`;
  }
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function processingLabel(status: string) {
  if (status === "transcript_needed") return "Waiting for recording";
  if (status === "transcribing") return "Transcribing";
  if (status === "extracting" || status === "analyzing") return "Creating call record";
  if (status === "memory_ready") return "Ready";
  if (status === "call_failed") return "Call didn't connect";
  if (status === "recording_callback_missing") return "Recording missing";
  if (status === "transcription_failed") return "Transcription failed";
  if (status === "failed") return "Extraction failed";
  return status.replaceAll("_", " ");
}

function sourceLabel(sourceType: string) {
  if (sourceType === "transcript") return "Transcript";
  if (sourceType === "details") return "Extracted details";
  if (sourceType === "follow_up") return "Follow-up";
  if (sourceType === "user_notes") return "User notes";
  return "AI note";
}

type CallRowMeta = {
  callDirection: string | null;
  inboundCallerNumber: string | null;
  inboundVoicemail: boolean | null;
  dialedNumber: string;
  status: string;
  processingStatus: string;
  durationSeconds: number | null;
};

function callRecordTitle(call: Pick<CallRowMeta, "callDirection" | "inboundCallerNumber" | "dialedNumber">) {
  if (call.callDirection === "inbound") {
    return call.inboundCallerNumber ?? call.dialedNumber;
  }
  return call.dialedNumber;
}

function callDirectionLabel(call: Pick<CallRowMeta, "callDirection" | "inboundVoicemail" | "status">) {
  if (call.callDirection !== "inbound") return "Outbound";
  if (call.inboundVoicemail) return "Inbound voicemail";
  if (call.status === "completed") return "Inbound answered";
  return "Missed inbound";
}

function speakerName(
  mappings: { label: string; name: string }[] | undefined,
  speaker: string
) {
  if (speaker === "combined") return "Transcript";
  return mappings?.find((mapping) => mapping.label === speaker)?.name ?? `Speaker ${speaker}`;
}

// Raw backend errors (validator messages, request IDs, parser noise) should
// never surface verbatim in the Ask panel.
function friendlyAskError(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  const looksTechnical =
    !message ||
    message.length > 180 ||
    /convex|server error|request id|validator|unexpected token|json|fetch failed|network|econn/i.test(message);
  return looksTechnical
    ? "Voxandra couldn't answer that right now. Try again in a moment."
    : message;
}

function DirectionGlyph({ call, size = "md" }: { call: CallRowMeta; size?: "md" | "sm" }) {
  const sizeClass = size === "md" ? "h-9 w-9" : "h-7 w-7";
  const iconClass = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const label = callDirectionLabel(call);
  const failed = call.processingStatus === "call_failed";
  const isInbound = call.callDirection === "inbound";

  let Icon = ArrowUpRight;
  let tone = "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300";
  if (isInbound) {
    if (call.inboundVoicemail) {
      Icon = Voicemail;
      tone = "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
    } else if (call.status !== "completed") {
      Icon = PhoneMissed;
      tone = "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300";
    } else {
      Icon = ArrowDownLeft;
      tone = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
    }
  } else if (failed) {
    Icon = PhoneMissed;
    tone = "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300";
  }

  return (
    <span
      title={label}
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full ${tone}`}
    >
      <Icon aria-hidden="true" className={iconClass} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function CallStatusPill({
  processingStatus,
  reminderCount,
}: {
  processingStatus: string;
  reminderCount: number;
}) {
  if (FAILED_STATUSES.has(processingStatus)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
        <PhoneMissed aria-hidden="true" className="h-3 w-3" />
        {FAILED_BADGE_LABELS[processingStatus] ?? "Failed"}
      </span>
    );
  }
  if (processingStatus !== "memory_ready") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-2 py-1 text-xs font-medium text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
        <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
        Processing
      </span>
    );
  }
  if (reminderCount > 0) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        <Bell aria-hidden="true" className="h-3 w-3" />
        {reminderCount}
      </span>
    );
  }
  return null;
}

function CallMetaLine({ call, startedAt }: { call: CallRowMeta; startedAt: string }) {
  const showDuration =
    typeof call.durationSeconds === "number" &&
    call.durationSeconds > 0 &&
    call.processingStatus !== "call_failed";
  const showProcessing =
    call.processingStatus !== "memory_ready" && !FAILED_STATUSES.has(call.processingStatus);
  return (
    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
      {timeLabelFor(startedAt)}
      {showDuration ? <> · {formatDuration(call.durationSeconds as number)}</> : null}
      {" · "}
      {callDirectionLabel(call)}
      {showProcessing ? <> · {processingLabel(call.processingStatus)}</> : null}
    </p>
  );
}

function DateGroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500 first:pt-0">
      {label} <span className="font-normal text-stone-300 dark:text-stone-600">· {count}</span>
    </p>
  );
}

export default function MemoryPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const view: MemoryView = searchParams.get("view") === "transcript" ? "transcript" : "notes";
  const mode: SearchMode = searchParams.get("mode") === "ask" ? "ask" : "search";
  const urlQuery = searchParams.get("q") ?? "";
  const rawNotesFilter = searchParams.get("filter");
  const notesFilter: NotesFilter =
    rawNotesFilter === "with_reminders" || rawNotesFilter === "processing" ? rawNotesFilter : "all";
  const rawTranscriptFilter = searchParams.get("tfilter");
  const transcriptFilter: TranscriptFilter =
    rawTranscriptFilter === "corrected" || rawTranscriptFilter === "ai_inferred"
      ? rawTranscriptFilter
      : "all";

  const [queryText, setQueryText] = useState(urlQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery);
  const [density, setDensity] = useState<Density>(() => {
    if (typeof window === "undefined") return "comfortable";
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
  });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const askCallRecords = useAction(api.callMemorySearchActions.askCallRecords);

  function setParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function hrefWithParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  // Debounce typing into the query + URL so back/forward and reloads restore
  // the exact list state without firing a query per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(queryText);
      const currentUrlQuery = new URLSearchParams(window.location.search).get("q") ?? "";
      if (queryText !== currentUrlQuery) {
        const params = new URLSearchParams(window.location.search);
        if (queryText) params.set("q", queryText);
        else params.delete("q");
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [queryText, pathname, router]);

  // Adopt the URL's q on browser back/forward (router.replace does not fire
  // popstate, so this never clobbers in-flight typing).
  useEffect(() => {
    function onPopState() {
      const q = new URLSearchParams(window.location.search).get("q") ?? "";
      setQueryText(q);
      setDebouncedQuery(q);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function updateDensity(next: Density) {
    setDensity(next);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  }

  const searchText = mode === "search" ? debouncedQuery.trim() : "";
  const searchActive = searchText.length > 0;

  // Reset pagination whenever the visible dataset changes (render-time state
  // adjustment, per React's "adjusting state when props change" pattern).
  const datasetKey = `${view}|${notesFilter}|${transcriptFilter}|${searchText}`;
  const [prevDatasetKey, setPrevDatasetKey] = useState(datasetKey);
  if (prevDatasetKey !== datasetKey) {
    setPrevDatasetKey(datasetKey);
    setLimit(PAGE_SIZE);
  }

  const notesResult = useQuery(
    api.notes.listCallRecords,
    view === "notes" && !searchActive ? { filter: notesFilter, limit } : "skip"
  );
  const transcriptsResult = useQuery(
    api.transcripts.listTranscriptRecords,
    view === "transcript" && !searchActive ? { filter: transcriptFilter, limit } : "skip"
  );
  const indexedSearchRows = useQuery(
    api.callMemorySearch.searchCallRecords,
    searchActive
      ? {
          search: searchText,
          limit: SEARCH_RESULT_LIMIT,
          ...(view === "transcript"
            ? { sourceTypes: ["transcript" as const] }
            : notesFilter === "with_reminders"
              ? { hasReminder: true }
              : {}),
        }
      : "skip"
  );
  const threadPills = useQuery(
    api.threads.listThreadPillsForNotes,
    view === "notes" ? { limit: 100 } : "skip"
  );

  // Keep the last loaded rows on screen while a new page/filter loads so
  // "Show more" and filter switches never flash the skeleton (render-time
  // state adjustment; useQuery returns a stable reference per result).
  const [stableNotes, setStableNotes] = useState<CallRecordRows | null>(null);
  const [stableTranscripts, setStableTranscripts] = useState<TranscriptRecordRows | null>(null);
  if (notesResult && notesResult !== stableNotes) {
    setStableNotes(notesResult);
  }
  if (transcriptsResult && transcriptsResult !== stableTranscripts) {
    setStableTranscripts(transcriptsResult);
  }

  const notes = notesResult ?? stableNotes;
  const transcripts = transcriptsResult ?? stableTranscripts;

  const threadsByCallId = useMemo(() => {
    return new Map((threadPills ?? []).map((row) => [row.callId, row.thread]));
  }, [threadPills]);

  const groupedIndexedRows = useMemo(
    () => groupByDate(indexedSearchRows ?? [], (row) => row.callStartedAt),
    [indexedSearchRows]
  );
  const groupedNotes = useMemo(
    () => groupByDate(notes?.rows ?? [], (row) => row.startedAt),
    [notes]
  );
  const groupedTranscripts = useMemo(
    () => groupByDate(transcripts?.rows ?? [], (row) => row.startedAt),
    [transcripts]
  );

  const loading = searchActive
    ? !indexedSearchRows
    : view === "notes"
      ? !notes
      : !transcripts;

  // While an indexed search is running, only the filters that the search
  // backend actually honors are offered; the rest would silently do nothing.
  const filters: { value: string; label: string }[] = searchActive
    ? view === "notes"
      ? NOTE_FILTERS.filter((item) => item.value === "all" || item.value === "with_reminders")
      : []
    : view === "notes"
      ? NOTE_FILTERS
      : TRANSCRIPT_FILTERS;
  const activeFilter = view === "notes" ? notesFilter : transcriptFilter;

  const resultCount = searchActive
    ? indexedSearchRows?.length ?? null
    : view === "notes"
      ? notes?.total ?? null
      : transcripts?.total ?? null;
  const totalIsLowerBound = searchActive
    ? false
    : view === "notes"
      ? (notes?.totalIsLowerBound ?? false)
      : (transcripts?.totalIsLowerBound ?? false);
  const resultCountLabel =
    resultCount === null
      ? null
      : searchActive
        ? `${resultCount}${resultCount >= SEARCH_RESULT_LIMIT ? "+" : ""} match${resultCount === 1 ? "" : "es"}`
        : view === "notes"
          ? `${resultCount}${totalIsLowerBound ? "+" : ""} call${resultCount === 1 ? "" : "s"}`
          : `${resultCount}${totalIsLowerBound ? "+" : ""} transcript${resultCount === 1 ? "" : "s"}`;

  async function submitAsk(questionOverride?: string) {
    const question = (questionOverride ?? queryText).trim();
    if (!question || askLoading) return;
    setQueryText(question);
    setAskLoading(true);
    setAskError(null);
    try {
      const result = await askCallRecords({ question });
      setAskResult(result as AskResult);
    } catch (error) {
      setAskResult(null);
      setAskError(friendlyAskError(error));
    } finally {
      setAskLoading(false);
    }
  }

  function clearQuery() {
    setQueryText("");
    setDebouncedQuery("");
    setAskResult(null);
    setAskError(null);
    setParams({ q: null });
  }

  if (loading && !askResult && !askLoading) {
    return <PageSkeleton />;
  }

  const activeResult = searchActive ? null : view === "notes" ? notes : transcripts;
  const showMore = activeResult?.hasMore ?? false;
  const showMoreCount = Math.max(0, (activeResult?.total ?? 0) - (activeResult?.rows.length ?? 0));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-50">Call records</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
          Search notes, transcripts, extracted details, reminders, and speaker corrections from captured calls.
        </p>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            role="group"
            aria-label="Search mode"
            className="inline-flex shrink-0 gap-1 rounded-full bg-stone-100/70 p-1 dark:bg-stone-800/70"
          >
            <button
              type="button"
              aria-pressed={mode === "search"}
              onClick={() => setParams({ mode: null })}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
                mode === "search"
                  ? "bg-white text-brand shadow-[0_8px_20px_rgba(28,25,23,0.08)] dark:bg-stone-900 dark:text-violet-300"
                  : "text-stone-600 hover:bg-white/70 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900/70 dark:hover:text-stone-100"
              }`}
            >
              <Search aria-hidden="true" className="h-4 w-4" />
              Search
            </button>
            <button
              type="button"
              aria-pressed={mode === "ask"}
              onClick={() => setParams({ mode: "ask" })}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
                mode === "ask"
                  ? "bg-white text-brand shadow-[0_8px_20px_rgba(28,25,23,0.08)] dark:bg-stone-900 dark:text-violet-300"
                  : "text-stone-600 hover:bg-white/70 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900/70 dark:hover:text-stone-100"
              }`}
            >
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              Ask AI
            </button>
          </div>

          <form
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (mode === "ask") void submitAsk();
            }}
          >
            <label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900">
              {mode === "ask" ? (
                <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-500" />
              ) : (
                <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" />
              )}
              <input
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                aria-label={mode === "ask" ? "Ask a question about your call records" : "Search call records"}
                placeholder={
                  mode === "ask"
                    ? "Ask a question about your call records"
                    : view === "notes"
                      ? "Search notes, transcripts, contacts, references"
                      : "Search transcript text and speakers"
                }
                className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none dark:text-stone-100"
              />
              {queryText ? (
                <button
                  type="button"
                  onClick={clearQuery}
                  aria-label="Clear search"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
            {mode === "ask" ? (
              <button
                type="submit"
                disabled={askLoading || !queryText.trim()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-stone-300 dark:disabled:bg-stone-700 dark:disabled:text-stone-400"
              >
                {askLoading ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Send aria-hidden="true" className="h-4 w-4" />
                )}
                Ask
              </button>
            ) : null}
          </form>
        </div>

        {mode === "ask" ? (
          <div className="space-y-4" aria-live="polite">
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => void submitAsk(question)}
                  className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 transition hover:border-violet-200 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/50"
                >
                  {question}
                </button>
              ))}
            </div>

            {askError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{askError}</p>
            ) : null}

            {askResult ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm dark:border-violet-900 dark:bg-stone-900">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-stone-800 dark:text-stone-200">{askResult.answer}</p>
                </div>
                {askResult.citations.length > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {askResult.citations.slice(0, 6).map((citation) => (
                      <Link
                        key={`${citation.id}-${citation.index}`}
                        href={citation.href}
                        className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/40 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">
                              Source [{citation.index}] · {sourceLabel(citation.sourceType)}
                            </p>
                            <p className="mt-1 truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{citation.title}</p>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{formatDate(citation.callStartedAt)}</p>
                          </div>
                          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" />
                        </div>
                        <p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-600 dark:text-stone-400">{citation.snippet}</p>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Call record view"
            className="inline-flex w-fit gap-1 rounded-full bg-stone-100/70 p-1 dark:bg-stone-800/70"
          >
            <Link
              href={hrefWithParams({ view: null })}
              aria-current={view === "notes" ? "page" : undefined}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
                view === "notes"
                  ? "bg-white text-brand shadow-[0_8px_20px_rgba(28,25,23,0.08)] dark:bg-stone-900 dark:text-violet-300"
                  : "text-stone-600 hover:bg-white/70 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900/70 dark:hover:text-stone-100"
              }`}
            >
              <NotebookPen aria-hidden="true" className="h-4 w-4" />
              Notes
            </Link>
            <Link
              href={hrefWithParams({ view: "transcript" })}
              aria-current={view === "transcript" ? "page" : undefined}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
                view === "transcript"
                  ? "bg-white text-brand shadow-[0_8px_20px_rgba(28,25,23,0.08)] dark:bg-stone-900 dark:text-violet-300"
                  : "text-stone-600 hover:bg-white/70 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900/70 dark:hover:text-stone-100"
              }`}
            >
              <MessageSquareText aria-hidden="true" className="h-4 w-4" />
              Transcript
            </Link>
          </div>

          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={activeFilter === item.value}
              onClick={() => {
                if (view === "notes") {
                  setParams({ filter: item.value === "all" ? null : item.value });
                } else {
                  setParams({ tfilter: item.value === "all" ? null : item.value });
                }
              }}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                activeFilter === item.value
                  ? "bg-brand text-white"
                  : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
              }`}
            >
              {item.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-3">
            {resultCountLabel ? (
              <span className="text-xs text-stone-500 dark:text-stone-400" aria-live="polite">
                {resultCountLabel}
              </span>
            ) : null}
            <div
              role="group"
              aria-label="List density"
              className="inline-flex gap-1 rounded-md border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900"
            >
              <button
                type="button"
                aria-pressed={density === "comfortable"}
                aria-label="Comfortable list"
                title="Comfortable list"
                onClick={() => updateDensity("comfortable")}
                className={`flex h-8 w-8 items-center justify-center rounded transition ${
                  density === "comfortable"
                    ? "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                }`}
              >
                <LayoutList aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-pressed={density === "compact"}
                aria-label="Compact list"
                title="Compact list"
                onClick={() => updateDensity("compact")}
                className={`flex h-8 w-8 items-center justify-center rounded transition ${
                  density === "compact"
                    ? "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                }`}
              >
                <List aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {searchActive ? (
        groupedIndexedRows.length > 0 ? (
          <section className="space-y-3">
            {groupedIndexedRows.map(({ group, items }) => (
              <div key={group} className="space-y-3">
                <DateGroupHeading label={group} count={items.length} />
                {items.map((row) => (
                  <Link
                    key={row.id}
                    href={row.href}
                    className="block rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/30 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-stone-950 dark:text-stone-50">{row.title}</p>
                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                          {formatDate(row.callStartedAt)} · {sourceLabel(row.sourceType)}
                        </p>
                      </div>
                      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" />
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-700 dark:text-stone-300">{row.snippet}</p>
                    {row.hasReminder ? (
                      <span className="mt-4 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <Bell aria-hidden="true" className="h-3 w-3" />
                        Reminder
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            ))}
            {(indexedSearchRows?.length ?? 0) >= SEARCH_RESULT_LIMIT ? (
              <p className="pt-2 text-center text-xs text-stone-500 dark:text-stone-400">
                Showing the first {SEARCH_RESULT_LIMIT} matches. Refine the search to narrow results.
              </p>
            ) : null}
          </section>
        ) : (
          <EmptyState
            icon={Search}
            title="No records found"
            description="Try another contact, reference, follow-up, or transcript phrase."
          />
        )
      ) : view === "notes" ? (
        groupedNotes.length > 0 ? (
          <section className="space-y-3">
            {groupedNotes.map(({ group, items }) => (
              <div key={group} className={density === "compact" ? "space-y-2" : "space-y-3"}>
                <DateGroupHeading label={group} count={items.length} />
                {items.map((row) => (
                  <NoteRowCard
                    key={row.callId}
                    row={row}
                    density={density}
                    threadTitle={threadsByCallId.get(row.callId)?.title ?? null}
                  />
                ))}
              </div>
            ))}
            {showMore ? (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
                >
                  Show more calls{showMoreCount > 0 ? ` (${showMoreCount} more)` : ""}
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <EmptyState
            icon={NotebookPen}
            title="No call records found"
            description="Start a call to create your first AI note."
            action="Start call"
            href="/app#dialer"
          />
        )
      ) : groupedTranscripts.length > 0 ? (
        <section className="space-y-3">
          {groupedTranscripts.map(({ group, items }) => (
            <div key={group} className={density === "compact" ? "space-y-2" : "space-y-3"}>
              <DateGroupHeading label={group} count={items.length} />
              {items.map((row) => (
                <TranscriptRowCard key={row.transcriptId} row={row} density={density} />
              ))}
            </div>
          ))}
          {showMore ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
              >
                Show more transcripts{showMoreCount > 0 ? ` (${showMoreCount} more)` : ""}
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <EmptyState
          icon={FileText}
          title="No transcripts found"
          description="Start a call to create your first transcript."
          action="Start call"
          href="/app#dialer"
        />
      )}
    </div>
  );
}

function NoteRowCard({
  row,
  density,
  threadTitle,
}: {
  row: CallRecordRow;
  density: Density;
  threadTitle: string | null;
}) {
  const title = row.contactName ?? callRecordTitle(row);

  if (density === "compact") {
    return (
      <Link
        href={`/app/calls/${row.callId}#note`}
        className="flex items-center gap-3 rounded-lg border border-stone-200/80 bg-white px-3 py-2 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/30 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
      >
        <DirectionGlyph call={row} size="sm" />
        <span className="w-40 shrink-0 truncate text-sm font-semibold text-stone-950 sm:w-48 dark:text-stone-50">
          {title}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-sm text-stone-500 sm:block dark:text-stone-400">
          {row.summary ?? "Voxandra is preparing this call record."}
        </span>
        {typeof row.durationSeconds === "number" &&
        row.durationSeconds > 0 &&
        row.processingStatus !== "call_failed" ? (
          <span className="hidden shrink-0 text-xs tabular-nums text-stone-500 md:block dark:text-stone-400">
            {formatDuration(row.durationSeconds)}
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{timeLabelFor(row.startedAt)}</span>
        <CallStatusPill processingStatus={row.processingStatus} reminderCount={row.reminderCount} />
      </Link>
    );
  }

  return (
    <Link
      href={`/app/calls/${row.callId}#note`}
      className="flex gap-3 rounded-xl border border-stone-200/80 bg-white p-4 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/30 sm:p-5 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
    >
      <DirectionGlyph call={row} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <p className="truncate text-base font-semibold text-stone-950 dark:text-stone-50">{title}</p>
          <CallStatusPill processingStatus={row.processingStatus} reminderCount={row.reminderCount} />
        </div>
        <CallMetaLine call={row} startedAt={row.startedAt} />
        {threadTitle ? (
          <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-violet-50 px-2 py-1 text-xs font-medium text-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
            <GitBranch aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="truncate">{threadTitle}</span>
          </span>
        ) : null}
        {row.participants.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {row.participants.map((participant) => (
              <span
                key={participant}
                className="max-w-full truncate rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
              >
                {participant}
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-700 dark:text-stone-300">
          {row.summary ?? "Voxandra is preparing this call record."}
        </p>
      </div>
    </Link>
  );
}

function TranscriptRowCard({ row, density }: { row: TranscriptRecordRow; density: Density }) {
  const title = row.contactName ?? callRecordTitle(row);
  const edited = row.speakerMappings.some((mapping) => mapping.source === "user_edited");

  if (density === "compact") {
    return (
      <Link
        href={`/app/calls/${row.callId}#transcript`}
        className="flex items-center gap-3 rounded-lg border border-stone-200/80 bg-white px-3 py-2 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/30 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
      >
        <DirectionGlyph call={row} size="sm" />
        <span className="w-40 shrink-0 truncate text-sm font-semibold text-stone-950 sm:w-48 dark:text-stone-50">
          {title}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-sm text-stone-500 sm:block dark:text-stone-400">
          {row.summary ?? row.segments[0]?.text ?? ""}
        </span>
        <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{timeLabelFor(row.startedAt)}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
            edited
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
          }`}
        >
          {edited ? "Corrected" : "Suggested"}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/app/calls/${row.callId}#transcript`}
      className="flex gap-3 rounded-xl border border-stone-200/80 bg-white p-4 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/30 sm:p-5 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
    >
      <DirectionGlyph call={row} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <p className="truncate text-base font-semibold text-stone-950 dark:text-stone-50">{title}</p>
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
              edited
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
            }`}
          >
            {edited ? "Corrected speakers" : "Suggested speakers"}
          </span>
        </div>
        <CallMetaLine call={row} startedAt={row.startedAt} />

        {row.summary ? (
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-600 dark:text-stone-400">{row.summary}</p>
        ) : null}

        <div className="mt-3 space-y-2">
          {row.segments.map((segment, index) => (
            <p key={`${segment.speaker}-${index}`} className="line-clamp-1 text-sm text-stone-700 dark:text-stone-300">
              <span className="font-semibold text-stone-900 dark:text-stone-100">
                {speakerName(row.speakerMappings, segment.speaker)}:
              </span>{" "}
              {segment.text}
            </p>
          ))}
        </div>
      </div>
    </Link>
  );
}
