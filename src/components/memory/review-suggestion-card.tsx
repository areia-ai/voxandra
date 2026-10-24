import Link from "next/link";
import { Check, Edit3, Link2, Plus, X } from "lucide-react";
import type { Case, ReviewSuggestion } from "@/lib/types";
import { confidenceLabel, formatDateTime } from "@/lib/format";
import { EntityBadge } from "./entity-badge";
import { ActionItemList } from "./action-item-list";

export function ReviewSuggestionCard({
  suggestion,
  suggestedCase,
}: {
  suggestion: ReviewSuggestion;
  suggestedCase?: Case;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-teal-200 bg-teal-50 p-5 dark:border-teal-900/60 dark:bg-teal-950/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-teal-800 dark:text-teal-300">Detected call type</p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">{suggestion.detectedCallType}</h1>
          </div>
          <span className="rounded-md bg-white px-3 py-1 text-sm font-semibold text-teal-800 dark:bg-stone-900 dark:text-teal-300">
            {confidenceLabel(suggestion.confidence)}
          </span>
        </div>
        <p className="mt-4 max-w-4xl text-sm leading-6 text-stone-700 dark:text-stone-300">{suggestion.summary}</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Extracted details</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {suggestion.extractedEntities.map((entity) => (
              <EntityBadge key={entity.id} entity={entity} />
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Suggested organization</h2>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Existing thread match</p>
              <p className="mt-1 text-sm font-semibold text-stone-950 dark:text-stone-50">
                {suggestedCase?.title ?? "No confident match"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-stone-500 dark:text-stone-400">New thread title</p>
              <p className="mt-1 text-sm font-semibold text-stone-950 dark:text-stone-50">
                {suggestion.suggestedNewCaseTitle ?? "Not needed if existing match is accepted"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Suggested reminder</p>
              <p className="mt-1 text-sm font-semibold text-stone-950 dark:text-stone-50">{suggestion.suggestedReminder.title}</p>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{formatDateTime(suggestion.suggestedReminder.remindAt)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Contact creation</p>
              <p className="mt-1 text-sm font-semibold text-stone-950 dark:text-stone-50">
                {suggestion.suggestedContactCreation?.name ?? "Existing contact looks correct"}
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Suggested action items</h2>
        <div className="mt-4">
          <ActionItemList items={suggestion.suggestedActionItems} />
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark">
          <Check aria-hidden="true" className="h-4 w-4" />
          Accept suggestions
        </button>
        <button className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
          <Edit3 aria-hidden="true" className="h-4 w-4" />
          Edit
        </button>
        <button className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
          <X aria-hidden="true" className="h-4 w-4" />
          Dismiss
        </button>
        <button className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Create new case
        </button>
        {suggestedCase ? (
          <Link
            href={`/app/threads/${suggestedCase.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            Link to existing case
          </Link>
        ) : null}
      </div>
    </div>
  );
}
