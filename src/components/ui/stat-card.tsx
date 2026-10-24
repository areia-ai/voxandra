import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "stone",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone?: "stone" | "teal" | "amber" | "blue" | "rose";
}) {
  const tones = {
    stone: "bg-stone-100 text-stone-700",
    teal: "bg-teal-100 text-teal-800",
    amber: "bg-amber-100 text-amber-900",
    blue: "bg-sky-100 text-sky-800",
    rose: "bg-rose-100 text-rose-800",
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-surface p-5 shadow-sm dark:border-stone-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{label}</p>
          <p className="mt-3 text-3xl font-semibold text-stone-950 dark:text-stone-50">{value}</p>
        </div>
        <span className={`rounded-md p-2 ${tones[tone]}`}>
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-stone-600 dark:text-stone-400">{detail}</p>
    </div>
  );
}
