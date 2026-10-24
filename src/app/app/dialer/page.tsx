import { DialerMock } from "@/components/dialer/dialer-mock";

export default async function DialerPage({
  searchParams,
}: {
  searchParams?: Promise<{ number?: string; contactId?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section>
        <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">Dialer</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Low-friction call start</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
          This is intentionally simple. The only required input is a phone number.
        </p>
      </section>

      <DialerMock
        key={`${params?.contactId ?? ""}-${params?.number ?? ""}`}
        initialPhoneNumber={params?.number ?? ""}
        initialContactId={params?.contactId ?? ""}
      />
    </div>
  );
}
