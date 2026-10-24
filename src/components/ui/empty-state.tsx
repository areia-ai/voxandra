import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type EmptyStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

function ActionButton({ action, primary }: { action: EmptyStateAction; primary: boolean }) {
  const className = primary
    ? "inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
    : "inline-flex rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800";

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  href,
  action,
  onAction,
  icon: Icon,
  secondaryAction,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
  onAction?: () => void;
  icon?: LucideIcon;
  secondaryAction?: EmptyStateAction;
}) {
  const primaryAction: EmptyStateAction | null = action
    ? { label: action, href, onClick: onAction }
    : null;

  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white/70 p-8 text-center dark:border-stone-700 dark:bg-stone-900/50">
      {Icon ? <Icon aria-hidden="true" className="mx-auto h-8 w-8 text-stone-300 dark:text-stone-600" /> : null}
      <h3 className={`text-base font-semibold text-stone-950 dark:text-stone-50 ${Icon ? "mt-3" : ""}`}>{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600 dark:text-stone-400">{description}</p>
      {primaryAction || secondaryAction ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {primaryAction ? <ActionButton action={primaryAction} primary /> : null}
          {secondaryAction ? <ActionButton action={secondaryAction} primary={false} /> : null}
        </div>
      ) : null}
    </div>
  );
}
