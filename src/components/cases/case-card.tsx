import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Case } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";

export function CaseCard({ caseItem }: { caseItem: Case }) {
  return (
    <Link
      href={`/app/threads/${caseItem.id}`}
      className="block rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:border-stone-800 dark:hover:border-violet-700"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">{caseItem.type}</p>
          <h2 className="mt-2 text-lg font-semibold text-stone-950 dark:text-stone-50">{caseItem.title}</h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{caseItem.clientName}</p>
        </div>
        <StatusBadge value={caseItem.status} />
      </div>

      <p className="mt-4 text-sm leading-6 text-stone-700 dark:text-stone-300">{caseItem.summary}</p>

      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="font-medium text-stone-500 dark:text-stone-400">Last call</p>
          <p className="mt-1 text-stone-950 dark:text-stone-50">{formatDateTime(caseItem.lastCallAt)}</p>
        </div>
        <div>
          <p className="font-medium text-stone-500 dark:text-stone-400">Calls</p>
          <p className="mt-1 text-stone-950 dark:text-stone-50">{caseItem.callIds.length}</p>
        </div>
        <div>
          <p className="font-medium text-stone-500 dark:text-stone-400">Open actions</p>
          <p className="mt-1 text-stone-950 dark:text-stone-50">{caseItem.unresolvedActionItemIds.length}</p>
        </div>
      </div>

      <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-400">
        Open thread
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </span>
    </Link>
  );
}
