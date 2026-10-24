"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { mapDocs } from "@/lib/convex-helpers";
import type { Reminder } from "@/lib/types";

function toLocalInputValue(iso: string) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function defaultRemindAtLocal() {
  return toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
}

export function AddReminderModal({
  open,
  onClose,
  reminder,
}: {
  open: boolean;
  onClose: () => void;
  reminder?: Reminder | null;
}) {
  const contactsRaw = useQuery(api.contacts.getContacts);
  const createReminder = useMutation(api.reminders.createReminder);
  const updateReminder = useMutation(api.reminders.updateReminder);
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [remindAtLocal, setRemindAtLocal] = useState(defaultRemindAtLocal);
  const [contactId, setContactId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const contacts = contactsRaw ? mapDocs(contactsRaw) : [];
  const isEditing = Boolean(reminder);

  /* eslint-disable react-hooks/set-state-in-effect -- this modal is a shared
     singleton (reused for both "add" and "edit"), so its form fields must be
     reset from the `reminder` prop whenever it opens; there's no external
     store to read synchronously during render the way there is for
     localStorage/URL-hash cases elsewhere in this codebase. */
  useEffect(() => {
    if (!open) return;
    if (reminder) {
      setTitle(reminder.title);
      setRemindAtLocal(toLocalInputValue(reminder.remindAt));
      setContactId(reminder.contactId ?? "");
    } else {
      setTitle("");
      setRemindAtLocal(defaultRemindAtLocal());
      setContactId("");
    }
    setError("");
  }, [open, reminder]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function reset() {
    setTitle("");
    setRemindAtLocal(defaultRemindAtLocal());
    setContactId("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Enter what you need to follow up on.");
      return;
    }
    const remindAt = new Date(remindAtLocal);
    if (Number.isNaN(remindAt.getTime())) {
      setError("Enter a valid date and time.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (reminder) {
        await updateReminder({
          reminderId: reminder.id as Id<"reminders">,
          title: trimmedTitle,
          remindAt: remindAt.toISOString(),
        });
        showToast("Reminder updated.", "success");
      } else {
        await createReminder({
          title: trimmedTitle,
          remindAt: remindAt.toISOString(),
          status: "upcoming",
          source: "manual",
          contactId: contactId ? (contactId as Id<"contacts">) : undefined,
        });
        showToast("Reminder added.", "success");
      }
      reset();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save reminder.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      eyebrow="Reminders"
      title={isEditing ? "Edit reminder" : "Add reminder"}
      labelledBy="add-reminder-title"
    >
      <form onSubmit={submit} className="mt-4 grid gap-4">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">What do you need to follow up on?</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Call the visa office about the missing document"
            className="h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Remind me at</span>
          <input
            type="datetime-local"
            value={remindAtLocal}
            onChange={(event) => setRemindAtLocal(event.target.value)}
            className="h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          />
        </label>
        {!isEditing ? (
          <label className="grid gap-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Contact (optional)</span>
            <select
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            >
              <option value="">No contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving..." : isEditing ? "Save changes" : "Add reminder"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
