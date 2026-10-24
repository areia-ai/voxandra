import type { ActionItem } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";

export function ActionItemList({
  items,
  onComplete,
}: {
  items: ActionItem[];
  onComplete?: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">{item.title}</h3>
              <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">{item.description}</p>
            </div>
            <StatusBadge value={item.status} />
          </div>
          {item.dueAt ? <p className="mt-3 text-xs font-medium text-stone-500 dark:text-stone-400">Due {formatDateTime(item.dueAt)}</p> : null}
          {onComplete && item.status !== "completed" ? (
            <button
              onClick={() => onComplete(item.id)}
              className="mt-3 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-800 dark:border-stone-700 dark:text-stone-200"
            >
              Mark complete
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
