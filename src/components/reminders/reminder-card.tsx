import type { Case, Contact, Reminder } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";

export function ReminderCard({
  reminder,
  caseItem,
  contact,
}: {
  reminder: Reminder;
  caseItem?: Case;
  contact?: Contact;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">{reminder.title}</h3>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{formatDateTime(reminder.remindAt)}</p>
        </div>
        <StatusBadge value={reminder.status} />
      </div>
      <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
        {caseItem?.title ?? "No case linked"} {contact ? `• ${contact.name}` : ""}
      </p>
    </div>
  );
}
