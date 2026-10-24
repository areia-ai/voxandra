"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Bell,
  ContactRound,
  GitBranch,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  NotebookPen,
  PhoneCall,
  Plug,
  Settings,
  Wallet,
  X,
} from "lucide-react";

const primaryTabs = [
  { href: "/app", label: "Dial", icon: PhoneCall },
  { href: "/app/memory", label: "Records", icon: NotebookPen },
  { href: "/app/reminders", label: "Reminders", icon: Bell },
  { href: "/app/contacts", label: "Contacts", icon: ContactRound },
];

const moreItems = [
  { href: "/app/threads", label: "Threads", icon: GitBranch },
  { href: "/app/wallet", label: "Wallet", icon: Wallet },
  { href: "/app/mcp", label: "MCP", icon: Plug },
  { href: "/app/settings", label: "Settings", icon: Settings },
  { href: "/app/feedback", label: "Feedback", icon: MessageSquarePlus },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/app" && pathname.startsWith(href));
}

export function MobileTabBar() {
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreActive = moreItems.some((item) => isActive(pathname, item.href));

  useEffect(() => {
    if (!moreOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!sheetRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [moreOpen]);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
    >
      {moreOpen ? (
        <div
          ref={sheetRef}
          className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-xl border border-stone-200 bg-surface shadow-xl shadow-stone-950/10 dark:border-stone-700"
        >
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5 dark:border-stone-800">
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">More</span>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              aria-label="Close menu"
              className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          {moreItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  active
                    ? "bg-violet-50 text-brand dark:bg-violet-950/40 dark:text-violet-300"
                    : "text-stone-700 dark:text-stone-300"
                }`}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              void signOut();
            }}
            className="flex w-full items-center gap-3 border-t border-stone-100 px-4 py-3 text-left text-sm font-medium text-rose-600 dark:border-stone-800 dark:text-rose-400"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-5">
        {primaryTabs.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          const isDial = item.href === "/app";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-2 text-[0.68rem] font-semibold ${
                active ? "text-brand dark:text-violet-300" : "text-stone-500 dark:text-stone-500"
              }`}
            >
              <span
                className={
                  isDial
                    ? `flex h-9 w-9 items-center justify-center rounded-full ${
                        active ? "bg-brand text-white" : "bg-violet-100 text-brand dark:bg-violet-950/50 dark:text-violet-300"
                      }`
                    : ""
                }
              >
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((value) => !value)}
          aria-expanded={moreOpen}
          className={`flex flex-col items-center gap-1 py-2 text-[0.68rem] font-semibold ${
            moreOpen || moreActive ? "text-brand dark:text-violet-300" : "text-stone-500 dark:text-stone-500"
          }`}
        >
          <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
          More
        </button>
      </div>
    </nav>
  );
}
