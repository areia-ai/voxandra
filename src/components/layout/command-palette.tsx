"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  ContactRound,
  GitBranch,
  LayoutDashboard,
  Loader2,
  MessageSquarePlus,
  Moon,
  NotebookPen,
  PhoneCall,
  Search,
  Settings,
  Sun,
  Wallet,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useTheme } from "@/components/providers/theme-provider";
import { mapDocs } from "@/lib/convex-helpers";

export function isAppleDevice() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? navigator.userAgent ?? "");
}

type PaletteContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const PaletteContext = createContext<PaletteContextValue | null>(null);

function usePaletteState() {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
}

export function useCommandPaletteControls() {
  const ctx = useContext(PaletteContext);
  if (!ctx) {
    throw new Error("useCommandPaletteControls must be used within CommandPalette's provider");
  }
  return ctx;
}

type ResultItem = {
  key: string;
  group: "Actions" | "Pages" | "Contacts" | "Call records" | "Reminders";
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onSelect: () => void;
};

function PaletteBody({ close }: { close: () => void }) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const contactsRaw = useQuery(api.contacts.getContacts);
  const remindersRaw = useQuery(api.reminders.getReminders);
  const callResults = useQuery(
    api.callMemorySearch.searchCallRecords,
    debouncedQuery.length >= 2 ? { search: debouncedQuery, limit: 6 } : "skip"
  );

  const contacts = useMemo(() => (contactsRaw ? mapDocs(contactsRaw) : []), [contactsRaw]);

  function go(href: string) {
    close();
    router.push(href);
  }

  const needle = debouncedQuery.toLowerCase();

  const results = useMemo<ResultItem[]>(() => {
    const items: ResultItem[] = [];

    const actions: ResultItem[] = [
      {
        key: "action-start-call",
        group: "Actions",
        icon: <PhoneCall aria-hidden="true" className="h-4 w-4" />,
        label: "Start a call",
        onSelect: () => go("/app#dialer"),
      },
      {
        key: "action-toggle-theme",
        group: "Actions",
        icon: theme === "dark" ? (
          <Sun aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Moon aria-hidden="true" className="h-4 w-4" />
        ),
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        onSelect: () => {
          toggleTheme();
          close();
        },
      },
    ];

    const pages: ResultItem[] = [
      { href: "/app", label: "Dashboard", icon: <LayoutDashboard aria-hidden="true" className="h-4 w-4" /> },
      { href: "/app/memory", label: "Call Records", icon: <NotebookPen aria-hidden="true" className="h-4 w-4" /> },
      { href: "/app/threads", label: "Threads", icon: <GitBranch aria-hidden="true" className="h-4 w-4" /> },
      { href: "/app/reminders", label: "Reminders", icon: <Bell aria-hidden="true" className="h-4 w-4" /> },
      { href: "/app/contacts", label: "Contacts", icon: <ContactRound aria-hidden="true" className="h-4 w-4" /> },
      { href: "/app/wallet", label: "Wallet", icon: <Wallet aria-hidden="true" className="h-4 w-4" /> },
      { href: "/app/settings", label: "Settings", icon: <Settings aria-hidden="true" className="h-4 w-4" /> },
      { href: "/app/feedback", label: "Feedback", icon: <MessageSquarePlus aria-hidden="true" className="h-4 w-4" /> },
    ].map((page) => ({
      key: `page-${page.href}`,
      group: "Pages" as const,
      icon: page.icon,
      label: page.label,
      onSelect: () => go(page.href),
    }));

    const filteredActions = needle
      ? actions.filter((item) => item.label.toLowerCase().includes(needle))
      : actions;
    const filteredPages = needle
      ? pages.filter((item) => item.label.toLowerCase().includes(needle))
      : pages;

    items.push(...filteredActions, ...filteredPages);

    if (needle) {
      const matchingContacts = contacts
        .filter((contact) =>
          [contact.name, contact.phoneNumber, contact.country]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
        .slice(0, 6)
        .map((contact): ResultItem => ({
          key: `contact-${contact.id}`,
          group: "Contacts",
          icon: <ContactRound aria-hidden="true" className="h-4 w-4" />,
          label: contact.name,
          detail: contact.phoneNumber,
          onSelect: () =>
            go(`/app?number=${encodeURIComponent(contact.phoneE164 || contact.phoneNumber)}&contactId=${contact.id}#dialer`),
        }));
      items.push(...matchingContacts);

      const matchingReminders = (remindersRaw ?? [])
        .filter((reminder) => reminder.title.toLowerCase().includes(needle))
        .slice(0, 6)
        .map((reminder): ResultItem => ({
          key: `reminder-${reminder._id}`,
          group: "Reminders",
          icon: <Bell aria-hidden="true" className="h-4 w-4" />,
          label: reminder.title,
          detail: new Date(reminder.remindAt).toLocaleDateString(),
          onSelect: () => go("/app/reminders"),
        }));
      items.push(...matchingReminders);

      const matchingCalls = (callResults ?? []).map((result): ResultItem => ({
        key: `call-${result.id}`,
        group: "Call records",
        icon: <NotebookPen aria-hidden="true" className="h-4 w-4" />,
        label: result.title,
        detail: result.snippet,
        onSelect: () => go(result.href),
      }));
      items.push(...matchingCalls);
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, contacts, remindersRaw, callResults, theme]);

  // Reset the highlighted row whenever the query changes, following React's render-time
  // state-adjustment pattern instead of an effect (avoids an extra render pass).
  const [resetKey, setResetKey] = useState(needle);
  if (resetKey !== needle) {
    setResetKey(needle);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      results[activeIndex]?.onSelect();
    }
  }

  const isSearching = needle.length >= 2 && callResults === undefined;
  let groupCursor = "";

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-xl border border-stone-200 bg-surface shadow-2xl dark:border-stone-700">
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 dark:border-stone-800">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search contacts, call records, reminders, or jump to a page…"
          className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100"
        />
        {isSearching ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-stone-400" />
        ) : (
          <kbd className="hidden shrink-0 rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 font-mono text-[0.65rem] text-stone-500 sm:inline dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400">
            Esc
          </kbd>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto py-2">
        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-500 dark:text-stone-400">
            {needle ? "No matches. Try a different search." : "Start typing to search everything."}
          </p>
        ) : (
          results.map((item, index) => {
            const showGroupHeader = item.group !== groupCursor;
            groupCursor = item.group;
            return (
              <div key={item.key}>
                {showGroupHeader ? (
                  <p className="px-4 pb-1 pt-3 text-[0.65rem] font-semibold uppercase tracking-wide text-stone-400 first:pt-1 dark:text-stone-500">
                    {item.group}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={item.onSelect}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                    index === activeIndex
                      ? "bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200"
                      : "text-stone-700 dark:text-stone-300"
                  }`}
                >
                  <span className="shrink-0 text-stone-500 dark:text-stone-400">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.detail ? (
                      <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                        {item.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const palette = usePaletteState();

  useEffect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      const isCombo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCombo) {
        event.preventDefault();
        if (palette.isOpen) {
          palette.close();
        } else {
          palette.open();
        }
        return;
      }
      if (event.key === "Escape" && palette.isOpen) {
        palette.close();
      }
    }
    document.addEventListener("keydown", handleGlobalKeydown);
    return () => document.removeEventListener("keydown", handleGlobalKeydown);
  }, [palette]);

  return (
    <PaletteContext.Provider value={palette}>
      {children}
      {palette.isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="fixed inset-0 z-50 flex items-start justify-center bg-stone-950/40 px-4 pt-24"
          onClick={(event) => {
            if (event.target === event.currentTarget) palette.close();
          }}
        >
          <PaletteBody close={palette.close} />
        </div>
      ) : null}
    </PaletteContext.Provider>
  );
}
