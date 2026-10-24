"use client";

import Link from "next/link";
import { ArrowLeft, PhoneCall } from "lucide-react";
import { ActionItemList } from "@/components/memory/action-item-list";
import { AIMemoryCard } from "@/components/memory/ai-memory-card";
import { EntityBadge } from "@/components/memory/entity-badge";
import { ReminderCard } from "@/components/reminders/reminder-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { mapDoc, mapDocs } from "@/lib/convex-helpers";
import type { Id } from "@convex/_generated/dataModel";

export function CaseDetailClient({ id }: { id: string }) {
  const caseItem = useQuery(api.cases.getCaseById, { id: id as Id<"cases"> });
  const calls = useQuery(api.calls.getCallsByCaseId, { caseId: id as Id<"cases"> });
  const actions = useQuery(api.actionItems.getActionItemsByCaseId, { caseId: id as Id<"cases"> });
  const reminders = useQuery(api.reminders.getRemindersByCaseId, { caseId: id as Id<"cases"> });
  const memories = useQuery(api.aiMemories.getAIMemoriesByCaseId, { caseId: id as Id<"cases"> });
  const entities = useQuery(api.extractedEntities.getExtractedEntitiesByCaseId, { caseId: id as Id<"cases"> });
  const contacts = useQuery(api.contacts.getContacts);

  const markActionItemComplete = useMutation(api.actionItems.markActionItemComplete);
  const markReminderComplete = useMutation(api.reminders.markReminderComplete);

  if (caseItem === undefined) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-stone-500 dark:text-stone-400">
        Loading thread...
      </div>
    );
  }

  if (caseItem === null) {
    return (
      <EmptyState
        title="Thread not found"
        description="This thread does not exist or is not part of your workspace."
        href="/app/threads"
        action="Back to threads"
      />
    );
  }

  const mappedCase = mapDoc(caseItem);
  const mappedCalls = calls ? mapDocs(calls) : [];
  const mappedActions = actions ? mapDocs(actions) : [];
  const mappedReminders = reminders ? mapDocs(reminders) : [];
  const mappedMemories = memories ? mapDocs(memories) : [];
  const mappedEntities = entities ? mapDocs(entities) : [];
  const mappedContacts = contacts ? mapDocs(contacts) : [];

  const relatedContacts = mappedContacts.filter((contact) =>
    mappedCase.contactIds.includes(contact.id as Id<"contacts">)
  );
  const primaryContact = relatedContacts[0];
  const callHref = primaryContact
    ? `/app?number=${encodeURIComponent(primaryContact.phoneE164 || primaryContact.phoneNumber)}&contactId=${primaryContact.id}#dialer`
    : "/app#dialer";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href="/app/threads"
        className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 transition hover:text-violet-800 dark:text-stone-400 dark:hover:text-violet-300"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Threads
      </Link>

      <section className="rounded-xl border border-stone-200/80 bg-surface p-6 shadow-sm dark:border-stone-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">
              Thread · {mappedCase.type}
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">{mappedCase.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">{mappedCase.summary}</p>
          </div>
          <StatusBadge value={mappedCase.status} />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={callHref}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            <PhoneCall aria-hidden="true" className="h-4 w-4" />
            {primaryContact ? `Call ${primaryContact.name}` : "Start call"}
          </Link>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Calls in this thread</h2>
          <div className="mt-4 space-y-4">
            {mappedCalls.length > 0 ? (
              mappedCalls.map((call) => {
                const contact = mappedContacts.find((c) => c.id === call.contactId);
                return (
                  <Link
                    key={call.id}
                    href={`/app/calls/${call.id}`}
                    className="block rounded-lg border-t border-stone-100 pt-4 transition hover:bg-stone-50/60 dark:border-stone-800 dark:hover:bg-stone-900/60"
                  >
                    <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">
                      {contact?.name ?? call.dialedNumber}
                    </p>
                    <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{formatDateTime(call.startedAt)}</p>
                  </Link>
                );
              })
            ) : (
              <p className="text-sm text-stone-600 dark:text-stone-400">No calls linked to this thread yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Related contacts</h2>
          <div className="mt-4 space-y-4">
            {relatedContacts.length > 0 ? (
              relatedContacts.map((contact) => (
                <div key={contact.id} className="border-t border-stone-100 pt-4 dark:border-stone-800">
                  <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">{contact.name}</p>
                  <p className="mt-1 font-mono text-sm text-stone-600 dark:text-stone-400">{contact.phoneNumber}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-stone-600 dark:text-stone-400">No contacts linked to this thread yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800">
        <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Extracted reference numbers and details</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {mappedEntities.length > 0 ? (
            mappedEntities.map((entity) => <EntityBadge key={entity.id} entity={entity} />)
          ) : (
            <p className="text-sm text-stone-600 dark:text-stone-400">No accepted extracted details yet.</p>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-4 text-lg font-semibold text-stone-950 dark:text-stone-50">Open action items</h2>
          <ActionItemList
            items={mappedActions}
            onComplete={(actionItemId) => markActionItemComplete({ actionItemId: actionItemId as Id<"actionItems"> })}
          />
        </div>
        <div>
          <h2 className="mb-4 text-lg font-semibold text-stone-950 dark:text-stone-50">Upcoming reminders</h2>
          <div className="space-y-3">
            {mappedReminders.length > 0 ? (
              mappedReminders.map((reminder) => (
                <div key={reminder.id} className="space-y-2">
                  <ReminderCard
                    reminder={reminder}
                    caseItem={mappedCase}
                    contact={reminder.contactId ? mappedContacts.find((c) => c.id === reminder.contactId) : undefined}
                  />
                  {reminder.status !== "completed" ? (
                    <button
                      onClick={() => markReminderComplete({ reminderId: reminder.id as Id<"reminders"> })}
                      className="rounded-md border border-stone-300 bg-surface px-3 py-1.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                    >
                      Mark complete
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-stone-600 dark:text-stone-400">No reminders linked to this thread yet.</p>
            )}
          </div>
        </div>
      </section>

      {mappedMemories.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Call records in this thread</h2>
          {mappedMemories.map((memory) => (
            <AIMemoryCard key={memory.id} memory={memory} extractedEntities={mappedEntities} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
