import { titleCase } from "@/lib/format";

const toneClassNames = {
  neutral: "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  blue: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  violet: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: keyof typeof toneClassNames;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${toneClassNames[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const tone =
    value.includes("pending") || value.includes("waiting")
      ? "amber"
      : value.includes("blocked") || value.includes("overdue") || value.includes("failed") || value.includes("missing")
        ? "red"
        : value.includes("ready") || value.includes("active") || value.includes("completed")
          ? "green"
          : "neutral";

  return <Badge tone={tone}>{titleCase(value)}</Badge>;
}
