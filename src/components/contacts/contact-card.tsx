import type { Contact } from "@/lib/types";
import { formatDateTime, titleCase } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function ContactCard({ contact }: { contact: Contact }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">{contact.name}</h2>
          <p className="mt-1 text-sm text-stone-600">{contact.country}</p>
        </div>
        <Badge tone="violet">{titleCase(contact.type)}</Badge>
      </div>
      <p className="mt-4 font-mono text-sm text-stone-950">{contact.phoneNumber}</p>
      <p className="mt-3 text-sm leading-6 text-stone-700">{contact.notes}</p>
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-stone-500">
        <span>{contact.relatedCaseIds.length} related case</span>
        {contact.lastCallAt ? <span>Last call {formatDateTime(contact.lastCallAt)}</span> : null}
      </div>
    </div>
  );
}
