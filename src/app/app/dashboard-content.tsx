"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock,
  ContactRound,
  GitBranch,
  ListChecks,
  Loader2,
  MessageSquareText,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  Sparkles,
  X,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DialerMock } from "@/components/dialer/dialer-mock";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import type { CallingNumber } from "@/lib/types";

const DISMISSED_HANDOFF_STORAGE_KEY = "voxandra.dashboard.dismissedHandoffCallIds";
// Stable empty snapshot: useSyncExternalStore re-renders forever if getSnapshot
// returns a new array reference on every call (React error #185).
const EMPTY_DISMISSED_HANDOFF_IDS: string[] = [];
let cachedDismissedHandoffRaw: string | null = null;
let cachedDismissedHandoffIds: string[] = EMPTY_DISMISSED_HANDOFF_IDS;

function readDismissedHandoffIds(): string[] {
  if (typeof window === "undefined") return EMPTY_DISMISSED_HANDOFF_IDS;
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_HANDOFF_STORAGE_KEY);
    if (!raw) {
      cachedDismissedHandoffRaw = null;
      cachedDismissedHandoffIds = EMPTY_DISMISSED_HANDOFF_IDS;
      return EMPTY_DISMISSED_HANDOFF_IDS;
    }
    if (raw === cachedDismissedHandoffRaw) return cachedDismissedHandoffIds;
    const parsed = JSON.parse(raw) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : EMPTY_DISMISSED_HANDOFF_IDS;
    cachedDismissedHandoffRaw = raw;
    cachedDismissedHandoffIds = ids.length === 0 ? EMPTY_DISMISSED_HANDOFF_IDS : ids;
    return cachedDismissedHandoffIds;
  } catch {
    cachedDismissedHandoffRaw = null;
    cachedDismissedHandoffIds = EMPTY_DISMISSED_HANDOFF_IDS;
    return EMPTY_DISMISSED_HANDOFF_IDS;
  }
}

function writeDismissedHandoffIds(ids: string[]) {
  if (typeof window === "undefined") return;
  const next = ids.slice(-20);
  const raw = JSON.stringify(next);
  window.sessionStorage.setItem(DISMISSED_HANDOFF_STORAGE_KEY, raw);
  cachedDismissedHandoffRaw = raw;
  cachedDismissedHandoffIds = next.length === 0 ? EMPTY_DISMISSED_HANDOFF_IDS : next;
  window.dispatchEvent(new Event("voxandra-dismissed-handoff-change"));
}

function subscribeDismissedHandoffs(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("voxandra-dismissed-handoff-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("voxandra-dismissed-handoff-change", handler);
  };
}

function useDismissedHandoffIds() {
  return useSyncExternalStore(
    subscribeDismissedHandoffs,
    readDismissedHandoffIds,
    () => EMPTY_DISMISSED_HANDOFF_IDS
  );
}

type DashboardStage = "calling" | "processing" | "ready" | "failed" | "completed";
type QueueTone = "violet" | "amber" | "rose" | "emerald" | "stone";

type DashboardAction = {
  label: string;
  href: string;
  style: "primary" | "secondary";
};

type Handoff = {
  callId: Id<"calls">;
  stage: DashboardStage;
  eyebrow: string;
  title: string;
  phoneNumber: string;
  startedAt: string;
  durationSeconds: number;
  statusLabel: string;
  description: string;
  summary: string | null;
  transcriptAvailable: boolean;
  reminderCount: number;
  contactLinked: boolean;
  contactName: string | null;
  createdByName: string | null;
  actions: DashboardAction[];
};

type WorkQueueItem = {
  id: string;
  tone: QueueTone;
  icon?: "phone_missed";
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  dueAt?: string;
};

type RecentActivityItem = {
  callId: Id<"calls">;
  title: string;
  phoneNumber: string;
  startedAt: string;
  durationSeconds: number;
  stage: DashboardStage;
  statusLabel: string;
  summary: string | null;
  href: string;
  transcriptAvailable: boolean;
  reminderCount: number;
  createdByName: string | null;
};

type ActiveThreadItem = {
  thread: {
    _id: Id<"cases">;
    title: string;
  };
  openFollowUpCount: number;
  callCount: number;
  nextFollowUpAt?: string;
};

type ReceiveCallsPanelProps = {
  callingNumbers: CallingNumber[] | undefined;
  currentRole: string | null | undefined;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 604800000) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds?: number) {
  if (!seconds) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function stageClasses(stage: DashboardStage) {
  if (stage === "ready") {
    return {
      border: "border-emerald-200 dark:border-emerald-900/50",
      bg: "bg-emerald-50 dark:bg-emerald-950/20",
      text: "text-emerald-900 dark:text-emerald-300",
      chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
      icon: "text-emerald-700 dark:text-emerald-400",
    };
  }
  if (stage === "failed") {
    return {
      border: "border-rose-200 dark:border-rose-900/50",
      bg: "bg-rose-50 dark:bg-rose-950/20",
      text: "text-rose-950 dark:text-rose-300",
      chip: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
      icon: "text-rose-700 dark:text-rose-400",
    };
  }
  if (stage === "calling") {
    return {
      border: "border-violet-200 dark:border-violet-900/50",
      bg: "bg-violet-50 dark:bg-violet-950/20",
      text: "text-violet-950 dark:text-violet-300",
      chip: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
      icon: "text-violet-700 dark:text-violet-400",
    };
  }
  if (stage === "completed") {
    return {
      border: "border-stone-200 dark:border-stone-800",
      bg: "bg-stone-50 dark:bg-stone-900/40",
      text: "text-stone-900 dark:text-stone-200",
      chip: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
      icon: "text-stone-600 dark:text-stone-400",
    };
  }
  return {
    border: "border-amber-200 dark:border-amber-900/50",
    bg: "bg-amber-50 dark:bg-amber-950/20",
    text: "text-amber-950 dark:text-amber-300",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    icon: "text-amber-700 dark:text-amber-400",
  };
}

function queueClasses(tone: QueueTone) {
  if (tone === "rose") return "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300";
  if (tone === "amber") return "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
  if (tone === "emerald") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (tone === "violet") return "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300";
  return "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400";
}

function StageIcon({ stage }: { stage: DashboardStage }) {
  if (stage === "ready") return <Sparkles aria-hidden="true" className="h-4 w-4" />;
  if (stage === "failed") return <AlertTriangle aria-hidden="true" className="h-4 w-4" />;
  if (stage === "calling") return <Phone aria-hidden="true" className="h-4 w-4" />;
  if (stage === "completed") return <CheckCircle2 aria-hidden="true" className="h-4 w-4" />;
  return <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />;
}

function QueueIcon({ tone, icon }: { tone: QueueTone; icon?: WorkQueueItem["icon"] }) {
  if (icon === "phone_missed") return <PhoneMissed aria-hidden="true" className="h-4 w-4" />;
  if (tone === "rose") return <AlertTriangle aria-hidden="true" className="h-4 w-4" />;
  if (tone === "amber") return <Bell aria-hidden="true" className="h-4 w-4" />;
  if (tone === "emerald") return <CheckCircle2 aria-hidden="true" className="h-4 w-4" />;
  if (tone === "violet") return <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />;
  return <GitBranch aria-hidden="true" className="h-4 w-4" />;
}

function ActionLink({ action }: { action: DashboardAction }) {
  return (
    <Link
      href={action.href}
      className={
        action.style === "primary"
          ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
          : "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-stone-300 bg-surface px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:text-stone-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
      }
    >
      {action.label}
      {action.style === "primary" ? <ArrowRight aria-hidden="true" className="h-4 w-4" /> : null}
    </Link>
  );
}

function ReceiveCallsPanel({ callingNumbers, currentRole }: ReceiveCallsPanelProps) {
  const activeRentedNumbers =
    callingNumbers?.filter(
      (number) => number.source === "rented" && number.status === "active" && number.id
    ) ?? [];
  const configuredNumber = activeRentedNumbers.find(
    (number) => number.inboundEnabled && number.inboundForwardingNumber
  );
  const canRentNumber = currentRole === "owner";
  const canConfigureInbound = currentRole === "owner" || currentRole === "admin";
  const receiveCallsHref = "/app/wallet#receive-calls";
  const loading = callingNumbers === undefined || currentRole === undefined;

  // Plain members can't rent numbers or configure forwarding, so the setup
  // pitch is noise for them; only show the panel once forwarding is live and
  // the card is purely informational.
  if (!loading && !canConfigureInbound && !configuredNumber) {
    return null;
  }

  let title = "Receive calls";
  let description =
    "Receive calls requires a rented Voxandra number. Calls to that number ring your forwarding phone and can become Call Records.";
  let statusLabel = "Rented number required";
  let actionLabel = canRentNumber ? "Rent a number" : "View setup";
  let detail: string | null = canRentNumber
    ? "Renting stays owner-only. Admins can configure receive-call settings once a rented number exists."
    : "Ask the workspace owner to rent a Voxandra number before receive-call forwarding can be enabled.";

  if (loading) {
    statusLabel = "Checking setup";
    actionLabel = "Open setup";
    detail = "Checking this workspace's rented numbers and receive-call settings.";
  } else if (configuredNumber) {
    title = configuredNumber.label || "Receive calls";
    description = "Calls to this rented Voxandra number ring the forwarding phone first and can become Call Records afterward.";
    statusLabel = "Forwarding on";
    actionLabel = "Manage setup";
    detail = [
      configuredNumber.phoneNumber,
      configuredNumber.inboundForwardingNumber
        ? `forwards to ${configuredNumber.inboundForwardingNumber}`
        : null,
      configuredNumber.inboundVoicemailEnabled !== false ? "voicemail on" : "voicemail off",
      configuredNumber.inboundAiCaptureEnabled ? "AI capture on" : "AI capture off",
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (activeRentedNumbers.length > 0) {
    title = "Finish receive-call setup";
    description =
      "Add a human forwarding phone and enable receive calls for an active rented number. Calls will ring that phone first and can become Call Records.";
    statusLabel = "Forwarding not set";
    actionLabel = canConfigureInbound ? "Configure forwarding" : "View setup";
    detail = `${activeRentedNumbers.length} active rented ${
      activeRentedNumbers.length === 1 ? "number" : "numbers"
    } available for receive-call setup.`;
  }

  return (
    <section className="rounded-xl border border-violet-100 bg-violet-50/60 p-5 shadow-sm dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-violet-700 shadow-sm dark:bg-stone-900 dark:text-violet-300">
              <PhoneIncoming aria-hidden="true" className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
              {title}
            </h2>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
              {statusLabel}
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700 dark:text-stone-300">
            {description}
          </p>
          {detail ? (
            <p className="mt-2 text-xs font-medium text-stone-500 dark:text-stone-400">
              {detail}
            </p>
          ) : null}
        </div>
        <Link
          href={receiveCallsHref}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          {actionLabel}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function HandoffCard({
  handoff,
  onDismiss,
}: {
  handoff: Handoff | null;
  onDismiss?: () => void;
}) {
  if (!handoff) {
    return (
      <section className="rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-50">
          <CircleDot aria-hidden="true" className="h-4 w-4 text-stone-400" />
          Ready for the next call
        </div>
        <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
          Start a call and this area will track recording, transcription, AI notes, and follow-up review.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="#dialer"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            Start call
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link
            href="/app/memory"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-stone-300 bg-surface px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:text-stone-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
          >
            View all records
          </Link>
        </div>
      </section>
    );
  }

  const tone = stageClasses(handoff.stage);
  const duration = formatDuration(handoff.durationSeconds);
  const showStatusChip = handoff.statusLabel !== handoff.eyebrow;
  const canDismiss = handoff.stage === "failed" && Boolean(onDismiss);

  return (
    <section className={`rounded-xl border ${tone.border} ${tone.bg} p-5 shadow-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`inline-flex items-center gap-2 text-sm font-semibold ${tone.icon}`}>
            <StageIcon stage={handoff.stage} />
            {handoff.eyebrow}
          </div>
          <h2 className={`mt-2 truncate text-xl font-semibold ${tone.text}`}>
            {handoff.title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showStatusChip ? (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone.chip}`}>
              {handoff.statusLabel}
            </span>
          ) : null}
          {canDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-white/80 text-rose-700 transition hover:bg-white dark:border-rose-900/60 dark:bg-stone-900/60 dark:text-rose-300"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {handoff.stage !== "failed" && handoff.stage !== "completed" ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {(["calling", "processing", "ready"] as const).map((step, index) => {
            const stepDone =
              step === "calling" ||
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
                      stepActive && handoff.stage !== "ready"
                        ? "animate-pulse bg-violet-500"
                        : stepDone
                          ? "bg-violet-500"
                          : "bg-stone-300 dark:bg-stone-700"
                    }`}
                  />
                  {step}
                </span>
                {index < 2 ? <span className="h-px w-4 bg-stone-200 dark:bg-stone-800" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <p className={`mt-3 text-sm leading-6 ${tone.text}`}>
        {handoff.description}
      </p>
      {handoff.summary ? (
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-700 dark:text-stone-300">{handoff.summary}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-stone-600 dark:text-stone-400">
        <span className="font-mono">{handoff.phoneNumber}</span>
        <span>{formatDateTime(handoff.startedAt)}</span>
        {duration ? <span>{duration}</span> : null}
        {handoff.createdByName ? <span>Started by {handoff.createdByName}</span> : null}
        {handoff.contactLinked ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <ContactRound aria-hidden="true" className="h-3.5 w-3.5" />
            {handoff.contactName}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <ContactRound aria-hidden="true" className="h-3.5 w-3.5" />
            Contact not linked
          </span>
        )}
        {handoff.transcriptAvailable ? (
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareText aria-hidden="true" className="h-3.5 w-3.5" />
            Transcript
          </span>
        ) : null}
        {handoff.reminderCount > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Bell aria-hidden="true" className="h-3.5 w-3.5" />
            {handoff.reminderCount} reminders
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {handoff.actions.map((action) => (
          <ActionLink key={`${action.href}-${action.label}`} action={action} />
        ))}
        {canDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-stone-300 bg-surface px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </section>
  );
}

function NextUpCard({ items }: { items: WorkQueueItem[] }) {
  return (
    <section className="rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListChecks aria-hidden="true" className="h-4 w-4 text-violet-600" />
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-50">Next up</h2>
        </div>
        <Link href="/app/memory" className="text-xs font-medium text-violet-700 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300">
          View all records
        </Link>
      </div>

      {items.length > 0 ? (
        <div className="mt-4 divide-y divide-stone-100">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="group flex min-w-0 items-center gap-3 py-3 text-sm transition first:pt-0 last:pb-0"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${queueClasses(item.tone)}`}>
                <QueueIcon tone={item.tone} icon={item.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-stone-950 dark:text-stone-50">
                  {item.title}
                </span>
                <span className="mt-1 block truncate text-xs text-stone-500 dark:text-stone-500">
                  {item.description}
                  {item.dueAt ? ` · ${formatDate(item.dueAt)}` : ""}
                </span>
              </span>
              <span className="hidden shrink-0 text-xs font-semibold text-violet-700 group-hover:text-violet-900 dark:text-violet-400 dark:group-hover:text-violet-300 sm:inline">
                {item.actionLabel}
              </span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400 group-hover:text-violet-700 dark:group-hover:text-violet-400" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-stone-200 dark:border-stone-700 py-8 text-center">
          <CheckCircle2 aria-hidden="true" className="mx-auto h-6 w-6 text-emerald-500" />
          <p className="mt-2 text-sm font-medium text-stone-800 dark:text-stone-200">Nothing urgent</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-stone-500 dark:text-stone-400">
            Finished calls, reminders, and contact cleanup will appear here when they need attention.
          </p>
        </div>
      )}
    </section>
  );
}

function RecentActivityCard({ items }: { items: RecentActivityItem[] }) {
  return (
    <section className="rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock aria-hidden="true" className="h-4 w-4 text-stone-500" />
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-50">Recent activity</h2>
        </div>
        <Link href="/app/memory" className="text-xs font-medium text-violet-700 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300">
          Call Records
        </Link>
      </div>

      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((item) => {
            const tone = stageClasses(item.stage);
            const duration = formatDuration(item.durationSeconds);
            return (
              <Link
                key={item.callId}
                href={item.href}
                className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-stone-50 dark:hover:bg-stone-800"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                  <Phone aria-hidden="true" className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-stone-950 dark:text-stone-50">{item.title}</span>
                  <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                    <span className="truncate">{item.summary ?? item.phoneNumber}</span>
                    {item.createdByName ? (
                      <span className="hidden shrink-0 sm:inline">by {item.createdByName}</span>
                    ) : null}
                    {item.reminderCount > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-amber-700 dark:text-amber-400">
                        <Bell aria-hidden="true" className="h-3 w-3" />
                        {item.reminderCount}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-stone-400 dark:text-stone-500">
                  <span className="block">
                    {formatDate(item.startedAt)}
                    {duration ? <span className="ml-2">{duration}</span> : null}
                  </span>
                  <span
                    title={item.statusLabel}
                    className={`mt-1 inline-flex max-w-44 truncate whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${tone.chip}`}
                  >
                    {item.statusLabel}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-200 dark:border-stone-700 py-8 text-center">
          <Phone aria-hidden="true" className="mx-auto h-6 w-6 text-stone-300 dark:text-stone-600" />
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">No calls yet</p>
          <p className="text-xs text-stone-400 dark:text-stone-500">Use the dialer to create your first call record</p>
        </div>
      )}
    </section>
  );
}

function ActiveThreadsSection({ threads }: { threads: ActiveThreadItem[] }) {
  if (threads.length === 0) return null;

  return (
    <section className="rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800">
      <div className="mb-4 flex items-center gap-2">
        <GitBranch aria-hidden="true" className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-50">Open threads</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {threads.map(({ thread, openFollowUpCount, callCount, nextFollowUpAt }) => (
          <Link
            key={thread._id}
            href={`/app/threads/${thread._id}`}
            className="group rounded-lg border border-stone-200 bg-stone-50/60 p-3 transition hover:border-violet-200 hover:bg-violet-50/60 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="line-clamp-2 text-sm font-semibold leading-5 text-stone-950 dark:text-stone-50">{thread.title}</p>
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-stone-300 transition group-hover:text-violet-600 dark:text-stone-600 dark:group-hover:text-violet-400"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-surface px-2 py-1 font-medium text-stone-600 dark:text-stone-300">{callCount} calls</span>
              <span className="rounded-full bg-surface px-2 py-1 font-medium text-amber-700 dark:text-amber-400">
                {openFollowUpCount} follow-ups
              </span>
            </div>
            {nextFollowUpAt ? <p className="mt-2 text-xs text-stone-500 dark:text-stone-500">Next {formatDate(nextFollowUpAt)}</p> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

function OnboardingChecklist() {
  const steps = [
    {
      title: "Make your first call",
      description: "Use the dial pad above — one free trial call, no credits used.",
    },
    {
      title: "Review what Voxandra captured",
      description: "Check the summary, transcript, extracted details, and reminders it creates.",
    },
    {
      title: "Invite a teammate",
      description: "Share this workspace so your team sees the same call records.",
      href: "/app/settings",
      linkLabel: "Open settings",
    },
  ];

  return (
    <section className="rounded-xl border border-violet-100 bg-violet-50/60 p-5 shadow-sm dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="h-4 w-4 text-violet-700 dark:text-violet-400" />
        <h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Get started with Voxandra</h2>
      </div>
      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-violet-700 shadow-sm dark:bg-stone-900 dark:text-violet-300">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">{step.title}</p>
              <p className="mt-0.5 text-sm leading-6 text-stone-600 dark:text-stone-300">
                {step.description}
                {step.href ? (
                  <Link href={step.href} className="ml-1.5 font-semibold text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300">
                    {step.linkLabel}
                  </Link>
                ) : null}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DashboardContent() {
  const searchParams = useSearchParams();
  const phoneNumber = searchParams.get("number") || "";
  const contactId = searchParams.get("contactId") || "";
  const [postCallCallId, setPostCallCallId] = useState<Id<"calls"> | null>(null);
  const dismissedHandoffIds = useDismissedHandoffIds();

  // Navigating with a dial target (e.g. "Call again" from the work queue) means
  // the user wants the dial pad, not the inline post-call tracker.
  const dialTargetKey = `${phoneNumber}|${contactId}`;
  const [lastDialTargetKey, setLastDialTargetKey] = useState(dialTargetKey);
  if (dialTargetKey !== lastDialTargetKey) {
    setLastDialTargetKey(dialTargetKey);
    setPostCallCallId(null);
  }

  const callingNumbers = useQuery(api.callingNumbers.getCallingNumbers) as
    | CallingNumber[]
    | undefined;
  const currentRole = useQuery(api.team.getMyWorkspaceRole) as string | null | undefined;

  const dashboard = useQuery(
    api.dashboard.getDashboardData,
    postCallCallId ? { postCallCallId } : {}
  );

  const dismissHandoff = useCallback((callId: Id<"calls">) => {
    const next = [...readDismissedHandoffIds().filter((id) => id !== callId), callId];
    writeDismissedHandoffIds(next);
    setPostCallCallId((current) => (current === callId ? null : current));
  }, []);

  if (!dashboard) {
    return <PageSkeleton cards={2} />;
  }

  const trackedInline = Boolean(postCallCallId && dashboard.handoff?.callId === postCallCallId);
  const isEmptyWorkspace = !dashboard.stats.hasCalls;
  const handoffDismissed =
    dashboard.handoff?.stage === "failed" &&
    dismissedHandoffIds.includes(dashboard.handoff.callId);
  const visibleHandoff = handoffDismissed ? null : dashboard.handoff;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DialerMock
        key={`${contactId}-${phoneNumber}`}
        variant="dashboard"
        initialPhoneNumber={phoneNumber}
        initialContactId={contactId}
        onCallEnd={(callId) => {
          setPostCallCallId(callId as Id<"calls">);
        }}
        postCallHandoff={trackedInline && !handoffDismissed ? dashboard.handoff : null}
        onDismissPostCall={() => {
          if (dashboard.handoff?.stage === "failed") {
            dismissHandoff(dashboard.handoff.callId);
            return;
          }
          setPostCallCallId(null);
        }}
      />

      {isEmptyWorkspace ? <OnboardingChecklist /> : null}

      {!trackedInline ? (
        <HandoffCard
          handoff={visibleHandoff}
          onDismiss={
            visibleHandoff?.stage === "failed"
              ? () => dismissHandoff(visibleHandoff.callId)
              : undefined
          }
        />
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <NextUpCard items={dashboard.workQueue} />
        <RecentActivityCard items={dashboard.recentActivity} />
      </section>

      <ActiveThreadsSection threads={dashboard.activeThreads} />

      {/* Rental upsell — deliberately below the fold behind real workspace
          content, not the first thing a brand-new user sees on this page. */}
      <ReceiveCallsPanel callingNumbers={callingNumbers} currentRole={currentRole} />
    </div>
  );
}
