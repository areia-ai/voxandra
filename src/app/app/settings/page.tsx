"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Languages, User, Wallet } from "lucide-react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useEnsureProfile } from "@/lib/auth";
import { WorkspaceNameEditor } from "@/components/workspace/workspace-name-editor";
import { TeamMembersPanel } from "@/components/team/team-members-panel";
import { DisplayNameEditor } from "@/components/profile/display-name-editor";
import { useToast } from "@/components/ui/toast";

function DataExportSection() {
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);
  // exportWorkspaceData is a query, but we only want to fetch it on demand
  // (a button click), not reactively on every render the way useQuery would.
  // The Convex client's imperative .query() is the standard way to call a
  // query one-shot instead of subscribing to it.
  const convex = useConvex();

  async function handleExport() {
    setExporting(true);
    try {
      const data = await convex.query(api.workspaces.exportWorkspaceData, {});
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `voxandra-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Could not export workspace data.", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
          <Download aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Export your data</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
            Download a JSON file of this workspace&apos;s contacts, calls, transcripts, summaries, and
            reminders. Does not include billing details or raw call audio.
          </p>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="mt-4 rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            {exporting ? "Preparing export..." : "Download workspace data"}
          </button>
        </div>
      </div>
    </section>
  );
}

function DangerZoneSection({ workspaceName, canManageWorkspace }: { workspaceName?: string; canManageWorkspace: boolean }) {
  const router = useRouter();
  const { signOut } = useEnsureProfile();
  const { showToast } = useToast();
  const requestDeletion = useMutation(api.workspaces.requestWorkspaceDeletion);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!canManageWorkspace) return null;

  const confirmMatches = workspaceName ? confirmText.trim() === workspaceName : false;

  async function handleDelete() {
    if (!confirmMatches || deleting) return;
    setDeleting(true);
    try {
      await requestDeletion({});
      await signOut();
      router.push("/login");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Could not delete this workspace.", "error");
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-6 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/10">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-rose-100 p-2 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Danger zone</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
            Deleting this workspace immediately signs out and removes access for every member. This
            cannot be undone from the app — contact support within 30 days if this was a mistake.
          </p>
          <label className="mt-4 grid max-w-md gap-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
              Type <span className="font-mono font-semibold">{workspaceName}</span> to confirm
            </span>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              className="h-11 rounded-lg border border-rose-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-100 dark:border-rose-900 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={!confirmMatches || deleting}
            className="mt-4 rounded-md bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete this workspace"}
          </button>
        </div>
      </div>
    </section>
  );
}

// The signed-in twin of the tokenized /unsubscribe link, and the reason the
// transactional footer can point at settings honestly. Covers product follow-up
// email only — account email has nothing to opt out of.
function MarketingEmailPreference({ optedOut }: { optedOut?: boolean }) {
  const setOptOut = useMutation(api.profiles.setMyMarketingEmailOptOut);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const subscribed = optedOut !== true;

  async function toggle(next: boolean) {
    setPending(true);
    setError("");
    try {
      await setOptOut({ optOut: !next });
    } catch {
      setError("Could not save that. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-stone-700 dark:bg-stone-800">
      <span className="min-w-0">
        <span className="block text-stone-600 dark:text-stone-400">Product follow-up emails</span>
        <span className="mt-0.5 block text-xs leading-5 text-stone-500 dark:text-stone-500">
          Occasional tips and product updates. Account emails — like a call record being
          ready — are always sent.
        </span>
        {error ? (
          <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>
        ) : null}
      </span>
      <label className="flex shrink-0 items-center gap-2 sm:justify-end">
        <input
          type="checkbox"
          checked={subscribed}
          disabled={pending || optedOut === undefined}
          onChange={(event) => void toggle(event.target.checked)}
          className="h-4 w-4 rounded border-stone-300 text-[#3b1676] focus:ring-violet-200 disabled:opacity-50 dark:border-stone-600"
        />
        <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
          {pending ? "Saving..." : subscribed ? "Subscribed" : "Unsubscribed"}
        </span>
      </label>
    </div>
  );
}

function VoiceTranslationPreference({
  enabled,
  maxCallMinutes,
  canManageWorkspace,
}: {
  enabled: boolean;
  maxCallMinutes: 30 | 45 | 60;
  canManageWorkspace: boolean;
}) {
  const setEnabled = useMutation(api.workspaces.setVoiceTranslationEnabled);
  const setMaxCallMinutes = useMutation(api.workspaces.setVoiceTranslationMaxCallMinutes);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle(next: boolean) {
    setPending(true);
    setError("");
    try {
      await setEnabled({ enabled: next });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that setting.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
          <Languages aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">
            Live Voice Translation
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
            Allow people in this workspace to place calls where each side hears the conversation in their own language. Spoken disclosure, transient processing, and Call Record creation still apply to every translated call.
          </p>
          <label className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800">
            <span>
              <span className="block text-sm font-medium text-stone-900 dark:text-stone-100">
                Voice Translation for this workspace
              </span>
              <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">
                {canManageWorkspace ? "Owners can change this setting." : "Only a workspace owner can change this setting."}
              </span>
              {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : null}
            </span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canManageWorkspace || pending}
              onChange={(event) => void toggle(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-emerald-700 focus:ring-emerald-200 disabled:opacity-50"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-stone-900 dark:text-stone-100">
            Maximum translated call duration
            <select
              value={maxCallMinutes}
              disabled={!canManageWorkspace || pending}
              onChange={async (event) => {
                const minutes = Number(event.target.value) as 30 | 45 | 60;
                setPending(true);
                setError("");
                try {
                  await setMaxCallMinutes({ minutes });
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Could not save the call limit.");
                } finally {
                  setPending(false);
                }
              }}
              className="mt-2 block w-full rounded-lg border border-stone-300 bg-white p-3 text-sm disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950"
            >
              {[30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes{minutes === 30 ? " (default)" : ""}</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
            Applies to new translated calls. Available credits or platform safety limits may shorten a call.
            After two minutes without speech, both participants hear a warning. After three minutes, the call ends unless someone speaks or the caller selects Keep connected.
            Keep connected never extends the maximum duration or credit limit.
          </p>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { profile, workspace } = useEnsureProfile();
  const currentRole = useQuery(api.team.getMyWorkspaceRole);
  const canManageWorkspace = currentRole === "owner";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section>
        <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Your workspace</h1>
      </section>

      {/* Profile */}
      <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
            <User aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Profile</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Your account and workspace preferences.
            </p>
          </div>
        </div>
        <div className="mt-5 space-y-3 text-sm">
          <WorkspaceNameEditor
            workspaceName={workspace?.name}
            displayName={profile?.displayName}
            email={profile?.email}
            variant="settings"
          />
          <DisplayNameEditor displayName={profile?.displayName} />
          <div className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-stone-50 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-stone-700 dark:bg-stone-800">
            <span className="text-stone-600 dark:text-stone-400">Email</span>
            <span className="break-all font-medium text-stone-900 sm:text-right dark:text-stone-100">
              {profile === undefined ? "Loading..." : profile?.email?.trim() || "Not set"}
            </span>
          </div>
          <MarketingEmailPreference optedOut={profile?.marketingEmailOptOut} />
        </div>
      </section>

      <TeamMembersPanel />

      <VoiceTranslationPreference
        enabled={workspace?.voiceTranslationEnabled !== false}
        maxCallMinutes={workspace?.voiceTranslationMaxCallMinutes ?? 30}
        canManageWorkspace={canManageWorkspace}
      />

      <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
            <Wallet aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Plan & billing</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Manage your subscription and calling credits.
            </p>
            <div className="mt-4">
              <Link
                href="/app/wallet"
                className="inline-flex rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                Open wallet
              </Link>
            </div>
          </div>
        </div>
      </section>

      <DataExportSection />

      <DangerZoneSection workspaceName={workspace?.name} canManageWorkspace={canManageWorkspace} />
    </div>
  );
}
