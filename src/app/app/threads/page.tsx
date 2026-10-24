"use client";

import { GitBranch } from "lucide-react";
import { CaseCard } from "@/components/cases/case-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { mapDocs } from "@/lib/convex-helpers";

export default function ThreadsPage() {
  const cases = useQuery(api.cases.getCases);

  if (cases === undefined) {
    return <PageSkeleton cards={3} />;
  }

  const threads = mapDocs(cases);

  return (
    <div className="space-y-6">
      <section>
        <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">
          <GitBranch aria-hidden="true" className="h-4 w-4" />
          Threads
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Ongoing work threads</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
          Related calls stay connected to the process they belong to — a renewal, verification,
          claim, dispute, or follow-up — with the open items and key details in one place.
        </p>
      </section>

      {threads.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {threads.map((thread) => (
            <CaseCard key={thread.id} caseItem={thread} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No threads yet"
          description="Threads are created when you link a call record to a new or existing process during review."
          href="/app/memory"
          action="Open Call Records"
        />
      )}
    </div>
  );
}
