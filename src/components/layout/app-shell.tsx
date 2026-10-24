"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useEnsureProfile } from "@/lib/auth";
import { CallProvider } from "@/components/providers/call-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { CallBar } from "./call-bar";
import { CommandPaletteProvider } from "./command-palette";
import { MobileTabBar } from "./mobile-tab-bar";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

function LoadingScreen({
  title,
  description,
  showActions,
}: {
  title: string;
  description: string;
  showActions: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-stone-200 dark:border-stone-800 border-t-brand" />
        <h2 className="mt-4 text-xl font-semibold text-stone-950 dark:text-stone-50">{title}</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{description}</p>
        {showActions ? (
          <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Refresh
            </button>
            <Link
              href="/login?mode=signIn"
              className="rounded-lg border border-stone-300 bg-surface px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Sign in
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const { isReady, hasWorkspace, isAuthError } = useEnsureProfile();
  const [showFallback, setShowFallback] = useState(false);
  const isBlocked = isLoading || !isAuthenticated || !isReady || !hasWorkspace;
  const showDelayedFallback = showFallback && isBlocked;

  // Client-side auth protection
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setShowFallback(isBlocked),
      isBlocked ? 8000 : 0
    );
    return () => window.clearTimeout(timer);
  }, [isBlocked]);

  if (isLoading || !isAuthenticated) {
    return (
      <LoadingScreen
        title="Checking authentication..."
        description="Please wait while we verify your session."
        showActions={showDelayedFallback}
      />
    );
  }

  if (!isReady || !hasWorkspace) {
    return (
      <LoadingScreen
        title="Setting up your workspace..."
        description={
          isAuthError
            ? "Having trouble connecting. Please refresh the page."
            : showDelayedFallback
              ? "This is taking longer than expected. Refresh or sign in again."
              : "This should only take a moment."
        }
        showActions={Boolean(isAuthError || showDelayedFallback)}
      />
    );
  }

  return (
    <CallProvider>
      <CommandPaletteProvider>
        <div className="min-h-screen bg-background">
          <div className="flex">
            <Sidebar />
            <div className="min-w-0 flex-1 overflow-x-clip">
              <CallBar />
              <TopBar />
              <main className="px-4 py-6 pb-20 md:px-6 lg:px-8 lg:pb-6">{children}</main>
              <MobileTabBar />
            </div>
          </div>
        </div>
      </CommandPaletteProvider>
    </CallProvider>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppShellContent>{children}</AppShellContent>
      </ToastProvider>
    </ThemeProvider>
  );
}
