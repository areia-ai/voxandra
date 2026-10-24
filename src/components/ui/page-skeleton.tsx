function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-stone-200 dark:bg-stone-800 ${className}`} />;
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <Bar className="h-4 w-2/3" />
      <Bar className="mt-3 h-3 w-1/3" />
      <Bar className="mt-4 h-3 w-full" />
      <Bar className="mt-2 h-3 w-5/6" />
    </div>
  );
}

// A generic loading placeholder for the app's list-style pages (Contacts, Call
// Records, Feedback, Wallet, Reminders) so a page load reads as "content is on
// the way" rather than a bare loading string in five different shapes per page.
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div>
        <Bar className="h-4 w-24" />
        <Bar className="mt-2 h-7 w-64" />
        <Bar className="mt-3 h-3 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: cards }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
