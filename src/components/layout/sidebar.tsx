"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ContactRound,
  GitBranch,
  LayoutDashboard,
  MessageSquarePlus,
  NotebookPen,
  Plug,
  Settings,
  Wallet,
} from "lucide-react";
import { VoxandraLogo } from "@/components/brand/voxandra-logo";

const navItems = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/memory", label: "Call Records", icon: NotebookPen },
  { href: "/app/threads", label: "Threads", icon: GitBranch },
  { href: "/app/reminders", label: "Reminders", icon: Bell },
  { href: "/app/contacts", label: "Contacts", icon: ContactRound },
  { href: "/app/wallet", label: "Wallet", icon: Wallet },
  { href: "/app/mcp", label: "MCP", icon: Plug },
  { href: "/app/settings", label: "Settings", icon: Settings },
  { href: "/app/feedback", label: "Feedback", icon: MessageSquarePlus },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 self-start border-r border-stone-200 bg-surface px-4 py-5 lg:block dark:border-stone-800">
      <div className="px-3">
        <VoxandraLogo />
      </div>

      <nav className="mt-10 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-violet-100 text-brand dark:bg-violet-950/50 dark:text-violet-300"
                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-50"
              }`}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
