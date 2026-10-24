import Link from "next/link";
import type { AIMemory, ExtractedEntity } from "@/lib/types";
import { confidenceLabel } from "@/lib/format";
import { EntityBadge } from "./entity-badge";

export function AIMemoryCard({
  memory,
  extractedEntities = [],
}: {
  memory: AIMemory;
  extractedEntities?: ExtractedEntity[];
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-700 dark:text-teal-300">{memory.detectedCallType}</p>
          <h2 className="mt-2 text-xl font-semibold text-stone-950 dark:text-stone-50">AI call record</h2>
        </div>
        <span className="rounded-md bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
          {confidenceLabel(memory.confidence)}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-stone-700 dark:text-stone-300">{memory.summary}</p>

      {extractedEntities.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {extractedEntities.slice(0, 4).map((entity) => (
            <EntityBadge key={entity.id} entity={entity} />
          ))}
        </div>
      )}

      {memory.reviewStatus === "pending" ? (
        <Link
          href={`/app/calls/${memory.callId}`}
          className="mt-5 inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          Open note
        </Link>
      ) : null}
    </div>
  );
}
