"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { ContactRound, GitBranch, PencilLine, PhoneCall, Plus, Search, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { mapDocs } from "@/lib/convex-helpers";
import { titleCase, formatRelativeTime } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { dialerCountries, compactDialerCountryLabel } from "@/lib/countries";
import { isE164Phone, normalizePhoneE164 } from "@/lib/phone";
import type { Contact } from "@/lib/types";
import type { Id } from "@convex/_generated/dataModel";

const CONTACT_TYPES = [
  "government",
  "university",
  "employer",
  "insurance",
  "supplier",
  "finance",
  "customer_support",
  "other",
];

const DEFAULT_COUNTRY_CODE = "+1";

function emptyForm() {
  return {
    name: "",
    type: "other",
    country: "",
    countryCode: DEFAULT_COUNTRY_CODE,
    phoneDigits: "",
    notes: "",
  };
}

function splitPhoneNumber(phoneNumber: string) {
  const normalized = normalizePhoneE164(phoneNumber);
  if (!normalized) return { countryCode: DEFAULT_COUNTRY_CODE, phoneDigits: "" };

  const match = [...dialerCountries]
    .map(([code]) => code)
    .sort((a, b) => b.length - a.length)
    .find((code) => normalized.startsWith(code));

  if (!match) return { countryCode: DEFAULT_COUNTRY_CODE, phoneDigits: normalized.slice(1) };
  return { countryCode: match, phoneDigits: normalized.slice(match.length) };
}

export default function ContactsPage() {
  const workspace = useQuery(api.profiles.getMyWorkspace);
  const convexContacts = useQuery(api.contacts.getContacts);
  const contactThreads = useQuery(api.threads.listThreadPillsForContacts);
  const createContact = useMutation(api.contacts.createContact);
  const updateContact = useMutation(api.contacts.updateContact);
  const deleteContact = useMutation(api.contacts.deleteContact);
  const { showToast } = useToast();

  const contacts = useMemo(() => (convexContacts ? mapDocs(convexContacts) : []), [convexContacts]);
  const threadsByContactId = useMemo(() => {
    return new Map((contactThreads ?? []).map((row) => [row.contactId, row.threads]));
  }, [contactThreads]);
  const [search, setSearch] = useState("");
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filteredContacts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) =>
      [contact.name, contact.phoneNumber, contact.country, contact.type, contact.notes]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [contacts, search]);

  function closeForm() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setFormVisible(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setFormVisible(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setForm({
      name: contact.name,
      type: contact.type || "other",
      country: contact.country,
      ...splitPhoneNumber(contact.phoneNumber),
      notes: contact.notes,
    });
    setError("");
    setFormVisible(true);
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDigits = form.phoneDigits.trim();
    const phoneNumber = trimmedDigits ? `${form.countryCode}${trimmedDigits.replace(/[^0-9]/g, "")}` : "";
    if (phoneNumber && !isE164Phone(phoneNumber)) {
      setError("Enter a valid phone number for the selected country.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        type: form.type,
        country: form.country,
        phoneNumber,
        notes: form.notes,
      };
      if (editing) {
        await updateContact({ contactId: editing.id as Id<"contacts">, ...payload });
      } else {
        await createContact(payload);
      }
      closeForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save contact.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteContact() {
    if (!deletingContact) return;
    setDeleting(true);
    try {
      await deleteContact({ contactId: deletingContact.id as Id<"contacts"> });
      showToast(`Deleted ${deletingContact.name}.`, "success");
      setDeletingContact(null);
      if (editing?.id === deletingContact.id) {
        closeForm();
      }
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Could not delete contact.", "error");
    } finally {
      setDeleting(false);
    }
  }

  function callHref(contact: Contact) {
    const params = new URLSearchParams({
      number: contact.phoneE164 || contact.phoneNumber,
      contactId: contact.id,
    });
    return `/app?${params.toString()}#dialer`;
  }

  if (!workspace || !convexContacts) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">Contacts</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Contact book</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
            Save people, offices, and support lines so calls start faster and notes stay easier to read.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add contact
        </button>
      </section>

      <section className="flex min-h-10 max-w-xl items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900">
        <Search aria-hidden="true" className="h-4 w-4 text-stone-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search contacts"
          className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none dark:text-stone-100"
        />
      </section>

      <Modal
        open={formVisible}
        onClose={closeForm}
        eyebrow="Contacts"
        title={editing ? "Edit contact" : "Add contact"}
        labelledBy="contact-form-title"
      >
        <form onSubmit={saveContact} className="mt-4 grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Name</span>
            <input
              autoFocus
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Phone number</span>
            <div className="flex gap-2">
              <select
                value={form.countryCode}
                onChange={(event) => setForm({ ...form, countryCode: event.target.value })}
                className="h-11 w-28 shrink-0 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              >
                {dialerCountries.map(([code, label]) => (
                  <option key={code} value={code}>
                    {compactDialerCountryLabel(code, label)}
                  </option>
                ))}
              </select>
              <input
                value={form.phoneDigits}
                onChange={(event) =>
                  setForm({ ...form, phoneDigits: event.target.value.replace(/[^0-9\s]/g, "") })
                }
                className="h-11 min-w-0 flex-1 rounded-lg border border-stone-300 px-3 font-mono text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="910 000 000"
                inputMode="tel"
              />
            </div>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Type</span>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            >
              {CONTACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Country</span>
            <input
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
              className="h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className="min-h-24 rounded-lg border border-stone-300 px-4 py-3 text-sm leading-6 text-stone-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
            />
          </label>
          {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save contact"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {filteredContacts.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {filteredContacts.map((contact) => (
            <div key={contact.id} className="rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-stone-950 dark:text-stone-50">{contact.name}</h2>
                  <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                    {titleCase(contact.type)} · {contact.country || "Unknown country"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {contact.phoneNumber ? (
                    <Link
                      href={callHref(contact)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-violet-100 text-violet-800 transition hover:bg-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/60"
                      aria-label={`Call ${contact.name}`}
                      title={`Call ${contact.name}`}
                    >
                      <PhoneCall className="h-4 w-4" />
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openEdit(contact)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                    aria-label={`Edit ${contact.name}`}
                    title={`Edit ${contact.name}`}
                  >
                    <PencilLine className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingContact(contact)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 text-stone-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-stone-700 dark:text-stone-300 dark:hover:border-rose-900 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
                    aria-label={`Delete ${contact.name}`}
                    title={`Delete ${contact.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                {contact.phoneNumber ? (
                  <p className="font-mono text-sm text-stone-950 dark:text-stone-50">{contact.phoneNumber}</p>
                ) : null}
                {contact.lastCallAt ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Last called {formatRelativeTime(contact.lastCallAt)}
                  </p>
                ) : null}
              </div>
              {threadsByContactId.get(contact.id as Id<"contacts">)?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {threadsByContactId.get(contact.id as Id<"contacts">)?.slice(0, 2).map((thread) => (
                    <span
                      key={thread._id}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
                    >
                      <GitBranch aria-hidden="true" className="h-3 w-3 shrink-0" />
                      <span className="truncate">{thread.title}</span>
                    </span>
                  ))}
                  {(threadsByContactId.get(contact.id as Id<"contacts">)?.length ?? 0) > 2 ? (
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                      +{(threadsByContactId.get(contact.id as Id<"contacts">)?.length ?? 0) - 2} threads
                    </span>
                  ) : null}
                </div>
              ) : null}
              {contact.notes ? (
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-700 dark:text-stone-300">{contact.notes}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : (
        <EmptyState
          icon={ContactRound}
          title="No contacts found"
          description="Add a contact or change your search."
          action="Add contact"
          onAction={openCreate}
          secondaryAction={{ label: "Start call", href: "/app#dialer" }}
        />
      )}

      {deletingContact ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-contact-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h2 id="delete-contact-title" className="text-lg font-semibold text-stone-950 dark:text-stone-50">
              Delete {deletingContact.name}?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              This removes the contact from your book. Past calls, reminders, and threads stay in your
              records but will no longer show this contact&apos;s name.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeletingContact(null)}
                disabled={deleting}
                className="inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDeleteContact()}
                className="inline-flex h-10 items-center justify-center rounded-md bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete contact"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
