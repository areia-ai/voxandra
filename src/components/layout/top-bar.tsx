"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, LogOut, Moon, PhoneCall, Search, Settings, Sun } from "lucide-react";
import { useEnsureProfile } from "@/lib/auth";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { WorkspaceNameEditor } from "@/components/workspace/workspace-name-editor";
import { useTheme } from "@/components/providers/theme-provider";
import { isAppleDevice, useCommandPaletteControls } from "./command-palette";

const pageTitleEntries = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/memory", label: "Call Records" },
  { href: "/app/threads", label: "Threads" },
  { href: "/app/contacts", label: "Contacts" },
  { href: "/app/reminders", label: "Reminders" },
  { href: "/app/settings", label: "Settings" },
  { href: "/app/wallet", label: "Wallet" },
  { href: "/app/feedback", label: "Feedback" },
];

const pageTitles: Record<string, string> = Object.fromEntries(
  pageTitleEntries.map((entry) => [entry.href, entry.label])
);

function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/app/calls/")) return "Call record";
  if (pathname.startsWith("/app/threads/")) return "Thread";
  if (pathname.startsWith("/app/review/")) return "Call record review";
  if (pathname.startsWith("/app/settings/")) return pageTitles[pathname] ?? "Settings";
  return pageTitles[pathname] ?? "Voxandra";
}

function emailLocalPart(email: string) {
  return email.split("@")[0] || email;
}

function getAccountDisplay(
  profile: {
    displayName?: string | null;
    email?: string | null;
  } | null | undefined,
  workspaceName?: string | null
) {
  const displayName = profile?.displayName?.trim() ?? "";
  const email = profile?.email?.trim() ?? "";
  const emailLabel = email ? emailLocalPart(email) : "";
  const primary = displayName || emailLabel || "User";
  const initialSource = displayName || emailLabel || "User";
  // Prefer information over a static "Signed in": the email when the primary
  // line is a display name, otherwise the workspace name.
  const pillSecondary =
    (displayName && emailLabel && emailLabel !== displayName ? emailLabel : "") ||
    workspaceName?.trim() ||
    "Signed in";

  return {
    primary,
    pillSecondary,
    dropdownSecondary: email || workspaceName?.trim() || "Signed in",
    initial: initialSource.charAt(0).toUpperCase() || "U",
  };
}

export function TopBar() {
  const pathname = usePathname();
  const { profile, workspace, signOut } = useEnsureProfile();
  const processingCountResult = useQuery(api.dashboard.getProcessingCount, {});
  const { theme, toggleTheme } = useTheme();
  const { open: openCommandPalette } = useCommandPaletteControls();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const processingCount = processingCountResult ?? 0;
  const accountDisplay = getAccountDisplay(profile, workspace?.name);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-background/90 px-4 py-3 backdrop-blur md:px-6 dark:border-stone-800">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <WorkspaceNameEditor
            workspaceName={workspace?.name}
            displayName={profile?.displayName}
            email={profile?.email}
          />
          <h1 className="truncate text-base font-semibold text-stone-950 dark:text-stone-50">
            {getPageTitle(pathname)}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCommandPalette}
              className="hidden items-center gap-2 rounded-md border border-stone-200 bg-surface px-3 py-2 text-xs font-medium text-stone-500 transition hover:border-violet-200 hover:text-violet-800 sm:inline-flex dark:border-stone-700 dark:text-stone-400 dark:hover:border-violet-800 dark:hover:text-violet-300"
              aria-label="Open search and quick actions"
            >
              <Search aria-hidden="true" className="h-4 w-4" />
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 font-mono text-[0.65rem] text-stone-500 md:inline dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400">
                {isAppleDevice() ? "⌘K" : "Ctrl K"}
              </kbd>
            </button>

            {processingCount > 0 ? (
              <Link
                href="/app"
                className="relative inline-flex items-center gap-1.5 rounded-md bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200"
              >
                <Bell aria-hidden="true" className="h-4 w-4" />
                <span className="hidden sm:inline">{processingCount} processing</span>
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet-700 text-[10px] font-bold text-white sm:hidden">
                  {processingCount}
                </span>
              </Link>
            ) : null}

            <Link
              href="/app#dialer"
              className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              <PhoneCall aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Start call</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-surface text-stone-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 dark:border-stone-700 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
            >
              {theme === "dark" ? (
                <Sun aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Moon aria-hidden="true" className="h-4 w-4" />
              )}
            </button>

            <div ref={accountMenuRef} className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-label="Account menu"
                className="flex max-w-[230px] items-center gap-2 rounded-full border border-stone-200 bg-surface px-2 py-1.5 text-left shadow-sm shadow-stone-950/5 transition hover:border-violet-200 hover:bg-violet-50/40 dark:border-stone-700 dark:hover:border-violet-800 dark:hover:bg-violet-950/30"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                  {accountDisplay.initial}
                </span>
                <span className="hidden min-w-0 md:block">
                  <span className="block truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
                    {accountDisplay.primary}
                  </span>
                  <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                    {accountDisplay.pillSecondary}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-stone-400 transition ${accountMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {accountMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-stone-200 bg-surface shadow-xl shadow-stone-950/10 dark:border-stone-700"
                >
                  <div className="border-b border-stone-100 px-4 py-3 dark:border-stone-800">
                    <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
                      {accountDisplay.primary}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                      {accountDisplay.dropdownSecondary}
                    </p>
                  </div>
                  <Link
                    href="/app/settings"
                    role="menuitem"
                    onClick={() => setAccountMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
                  >
                    <Settings aria-hidden="true" className="h-4 w-4" />
                    Account settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void signOut();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-stone-700 transition hover:bg-rose-50 hover:text-rose-700 dark:text-stone-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  >
                    <LogOut aria-hidden="true" className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
