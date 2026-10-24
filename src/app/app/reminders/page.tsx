"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ReminderKanban } from "@/components/reminders/reminder-kanban";
import { AddReminderModal } from "@/components/reminders/add-reminder-modal";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { mapDocs } from "@/lib/convex-helpers";

export default function RemindersPage() {
  const workspace = useQuery(api.profiles.getMyWorkspace);
  const convexReminders = useQuery(api.reminders.getReminders);
  const [addModalOpen, setAddModalOpen] = useState(false);

  if (!workspace || !convexReminders) {
    return <PageSkeleton cards={3} />;
  }

  const reminders = mapDocs(convexReminders);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">Follow-ups</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Reminders</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
            Suggested reminders stay linked to the call, thread, and institution that created them.
            Drag cards between columns or use the Move to buttons to update their status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add reminder
        </button>
      </section>

      <ReminderKanban reminders={reminders} onAddReminder={() => setAddModalOpen(true)} />

      <AddReminderModal open={addModalOpen} onClose={() => setAddModalOpen(false)} />
    </div>
  );
}
