import { X } from "lucide-react";
import type { ExtractedEntity } from "@/lib/types";
import { confidenceLabel, titleCase } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function EntityBadge({
  entity,
  onRemove,
}: {
  entity: ExtractedEntity;
  onRemove?: () => void;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="blue">{titleCase(entity.type)}</Badge>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{confidenceLabel(entity.confidence)}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${entity.label}`}
              title="Remove from record"
              className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-3 break-words text-sm font-medium text-stone-500 dark:text-stone-400">{entity.label}</p>
      <p className="mt-1 break-words text-base font-semibold text-stone-950 dark:text-stone-50">{entity.value}</p>
    </div>
  );
}
