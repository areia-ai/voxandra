import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  className = "",
  children,
  ...props
}: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-stone-200/80 bg-surface p-5 shadow-sm dark:border-stone-800 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  eyebrow,
  action,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">{eyebrow}</p>
        ) : null}
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-50">{title}</h2>
      </div>
      {action}
    </div>
  );
}
