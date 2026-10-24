import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantClassNames: Record<Variant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-dark focus-visible:ring-violet-200 shadow-sm shadow-violet-950/10",
  secondary:
    "border border-stone-300 bg-surface text-stone-700 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 focus-visible:ring-violet-100 dark:border-stone-700 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",
  ghost:
    "text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-stone-200 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-50",
  danger:
    "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-200",
};

const sizeClassNames: Record<Size, string> = {
  sm: "h-9 gap-1.5 rounded-md px-3 text-xs",
  md: "h-10 gap-2 rounded-md px-4 text-sm",
  lg: "h-12 gap-2 rounded-full px-5 text-sm",
};

const base =
  "inline-flex shrink-0 items-center justify-center font-semibold transition focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`${base} ${variantClassNames[variant]} ${sizeClassNames[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${base} ${variantClassNames[variant]} ${sizeClassNames[size]} ${className}`}
    >
      {children}
    </Link>
  );
}
