"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronUp, Filter, Lightbulb, Plus, Send } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackSort,
  type FeedbackStatus,
  feedbackCategoryLabel,
  feedbackCustomerMessage,
  feedbackStatusLabel,
} from "@/lib/feedback";
import { captureProductEvent } from "@/lib/analytics";
import { useToast } from "@/components/ui/toast";
import { PageSkeleton } from "@/components/ui/page-skeleton";

const SORT_OPTIONS: Array<{ value: FeedbackSort; label: string }> = [
  { value: "top", label: "Top" },
  { value: "new", label: "New" },
  { value: "my_votes", label: "My votes" },
];

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  open: "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300",
  planned: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300",
  building: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  shipped: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
  closed: "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-400",
};

function formatAge(timestamp: number) {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function emptyForm() {
  return {
    title: "",
    description: "",
    category: "Call Memory" as FeedbackCategory,
  };
}

export default function FeedbackPage() {
  const [sort, setSort] = useState<FeedbackSort>("top");
  const [category, setCategory] = useState<"All" | FeedbackCategory>("All");
  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [votingRequestId, setVotingRequestId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { showToast } = useToast();
  const createRequest = useMutation(api.feedback.createRequest);
  const toggleWorkspaceVote = useMutation(api.feedback.toggleWorkspaceVote);
  const feedbackData = useQuery(api.feedback.listRequests, {
    sort,
    category: category === "All" ? undefined : category,
  });

  const access = feedbackData?.access;
  const requests = feedbackData?.requests ?? [];
  const canPost = access?.canPost !== false;
  const canVote = access?.canVote === true;
  const categories = useMemo(() => FEEDBACK_CATEGORIES, []);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPost) return;
    setSaving(true);
    setError("");
    try {
      await createRequest(form);
      captureProductEvent("feedback_request_created", {
        feedbackCategory: form.category,
      });
      setForm(emptyForm());
      setFormVisible(false);
      setSort("new");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? feedbackCustomerMessage(caught.message)
          : "Could not create request."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleVote(requestId: Id<"feedbackRequests">) {
    if (!canVote || votingRequestId) return;
    setVotingRequestId(requestId);
    setError("");
    try {
      const result = await toggleWorkspaceVote({ requestId });
      captureProductEvent("feedback_workspace_vote_toggled", {
        enabled: result.hasWorkspaceVoted,
      });
    } catch (caught) {
      // Voting happens from any row in a potentially long, scrollable list,
      // so a toast (not just the top-of-page banner) keeps the error visible
      // no matter which row triggered it.
      const message =
        caught instanceof Error ? feedbackCustomerMessage(caught.message) : "Could not update vote.";
      setError(message);
      showToast(message, "error");
    } finally {
      setVotingRequestId(null);
    }
  }

  if (!feedbackData) {
    return <PageSkeleton cards={3} />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">Feedback</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Customer feature board</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
            Vote as a workspace on the improvements that would make Voxandra more useful for your team.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError("");
            setFormVisible((visible) => !visible);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New request
        </button>
      </section>

      {!canVote ? (
        <section className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              {feedbackCustomerMessage(access?.voteUpgradeReason) ||
                "Upgrade to a paid plan to vote on requests. Posting requests is open to everyone."}
            </p>
            <Link
              href="/app/wallet"
              className="inline-flex rounded-md bg-white px-3 py-2 text-sm font-semibold text-violet-800 shadow-sm shadow-violet-950/5 hover:bg-violet-100 dark:bg-stone-900 dark:text-violet-300 dark:hover:bg-stone-800"
            >
              View plans
            </Link>
          </div>
        </section>
      ) : null}

      {formVisible && canPost ? (
        <section className="rounded-lg border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <form onSubmit={submitRequest} className="grid gap-4">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
                <Lightbulb aria-hidden="true" className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Create feature request</h2>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Title</span>
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                maxLength={120}
                className="h-11 rounded-lg border border-stone-300 px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="Short request title"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Category</span>
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value as FeedbackCategory })
                  }
                  className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {feedbackCategoryLabel(item)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Details</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  maxLength={1000}
                  className="min-h-24 rounded-lg border border-stone-300 px-4 py-3 text-sm leading-6 text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                  placeholder="What should change, and why would it help your workspace?"
                />
              </label>
            </div>

            {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
              >
                <Send aria-hidden="true" className="h-4 w-4" />
                {saving ? "Sending..." : "Post request"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(emptyForm());
                  setFormVisible(false);
                  setError("");
                }}
                className="rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200/80 bg-white px-3 py-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSort(option.value)}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                sort === option.value
                  ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex min-w-0 items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
          <Filter aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as "All" | FeedbackCategory)}
            className="h-10 max-w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          >
            <option value="All">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {feedbackCategoryLabel(item)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && !formVisible ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}

      <section className="overflow-hidden rounded-lg border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
        {requests.length > 0 ? (
          <ol className="divide-y divide-stone-100 dark:divide-stone-800">
            {requests.map((request, index) => {
              const voting = votingRequestId === request.requestId;
              return (
                <li key={request.requestId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-3 md:px-4">
                  <div className="w-12 text-center">
                    <button
                      type="button"
                      onClick={() => toggleVote(request.requestId)}
                      disabled={!canVote || voting}
                      aria-label={
                        request.hasWorkspaceVoted
                          ? `Remove workspace vote from ${request.title}`
                          : `Vote for ${request.title}`
                      }
                      title={
                        canVote
                          ? request.hasWorkspaceVoted
                            ? "Remove workspace vote"
                            : "Add workspace vote"
                          : "Upgrade to a paid plan to vote"
                      }
                      className={`mx-auto flex h-8 w-8 items-center justify-center rounded-md border transition ${
                        request.hasWorkspaceVoted
                          ? "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                          : "border-stone-200 bg-stone-50 text-stone-500 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <p className="mt-1 text-xs font-bold text-stone-800 dark:text-stone-200">{request.voteCount}</p>
                  </div>

                  <article className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs text-stone-400 dark:text-stone-500">{index + 1}.</span>
                      <h2 className="min-w-0 text-sm font-semibold leading-6 text-stone-950 dark:text-stone-50">
                        {request.title}
                      </h2>
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[0.7rem] font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                        {feedbackCategoryLabel(request.category as FeedbackCategory)}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${
                          STATUS_STYLES[request.status as FeedbackStatus]
                        }`}
                      >
                        {feedbackStatusLabel(request.status as FeedbackStatus)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                      {request.description}
                    </p>
                    <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                      anonymous customer · {formatAge(request.createdAt)}
                      {request.hasWorkspaceVoted ? " · your workspace voted" : ""}
                    </p>
                  </article>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center px-4 py-10 text-center">
            <Lightbulb aria-hidden="true" className="h-8 w-8 text-stone-300 dark:text-stone-600" />
            <h2 className="mt-3 text-sm font-semibold text-stone-950 dark:text-stone-50">No requests found</h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-stone-600 dark:text-stone-400">
              Try another sort or category, or create the first request for this view.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
