"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { captureProductEvent } from "@/lib/analytics";
import type { Id } from "@convex/_generated/dataModel";
import {
  Copy,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";

type TeamRole = "owner" | "admin" | "member" | "viewer";
type InviteRole = "admin" | "member";

type TeamMember = {
  membershipId: Id<"workspaceMemberships">;
  email: string;
  displayName: string | null;
  label: string;
  role: TeamRole;
  roleLabel: string;
  joinedAt: number;
  isCurrentUser: boolean;
};

type PendingInvite = {
  invitationId: Id<"workspaceInvitations">;
  email: string;
  role: InviteRole;
  roleLabel: string;
  createdAt: number;
  expiresAt: number;
  emailDeliveryStatus: "pending" | "sent" | "failed" | "skipped";
  emailError: string | null;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function roleClasses(role: TeamRole | InviteRole) {
  if (role === "owner") return "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
  if (role === "admin") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

function deliveryLabel(status: PendingInvite["emailDeliveryStatus"]) {
  if (status === "sent") return "Email sent";
  if (status === "failed") return "Email failed";
  if (status === "skipped") return "Link ready";
  return "Sending";
}

export function TeamMembersPanel() {
  const summary = useQuery(api.team.getTeamSummary);
  const createInvitation = useMutation(api.team.createInvitation);
  const resendInvitation = useMutation(api.team.resendInvitation);
  const revokeInvitation = useMutation(api.team.revokeInvitation);
  const updateMemberRole = useMutation(api.team.updateMemberRole);
  const removeMember = useMutation(api.team.removeMember);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [inviteToRevoke, setInviteToRevoke] = useState<PendingInvite | null>(null);

  const canInviteAdmin = summary?.currentUserRole === "owner";
  const atSeatLimit = summary ? summary.usedSeats >= summary.seatLimit : true;
  const canInvite = Boolean(summary?.canInvite && !atSeatLimit);

  const seatCopy = useMemo(() => {
    if (!summary) return "Loading seats...";
    return `${summary.usedSeats} of ${summary.seatLimit} seats used`;
  }, [summary]);

  async function copyInviteLink(url: string) {
    await navigator.clipboard.writeText(url);
    setMessage("Invite link copied.");
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLastInviteUrl(null);
    setBusyAction("invite");
    try {
      const result = await createInvitation({ email, role });
      setEmail("");
      setLastInviteUrl(result.inviteUrl);
      setMessage(`Invite ready for ${result.email}.`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not send invite.";
      setError(reason);
      // Blocked invites were previously invisible: the seat ceiling throws, so
      // there was no way to tell how often teams actually hit it. This is the
      // evidence for whether paid seats above the included count are worth
      // building. Coarse and plan-scoped only, per the analytics privacy rules.
      if (/seat plan limit/.test(reason)) {
        captureProductEvent("seat_limit_reached", {
          planId: summary?.planId,
          seatLimit: summary?.seatLimit,
          area: "team_invite",
        });
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResend(invite: PendingInvite) {
    setError(null);
    setMessage(null);
    setLastInviteUrl(null);
    setBusyAction(`resend:${invite.invitationId}`);
    try {
      const result = await resendInvitation({ invitationId: invite.invitationId });
      setLastInviteUrl(result.inviteUrl);
      setMessage(`Invite resent to ${result.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend invite.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevoke(invite: PendingInvite) {
    setError(null);
    setMessage(null);
    setBusyAction(`revoke:${invite.invitationId}`);
    try {
      await revokeInvitation({ invitationId: invite.invitationId });
      setMessage(`Invite revoked for ${invite.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke invite.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRoleChange(member: TeamMember, nextRole: InviteRole) {
    setError(null);
    setMessage(null);
    setBusyAction(`role:${member.membershipId}`);
    try {
      await updateMemberRole({ membershipId: member.membershipId, role: nextRole });
      setMessage(`${member.label} is now ${nextRole === "admin" ? "an admin" : "a member"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemove(member: TeamMember) {
    setError(null);
    setMessage(null);
    setBusyAction(`remove:${member.membershipId}`);
    try {
      await removeMember({ membershipId: member.membershipId });
      setMessage(`${member.label} was removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove member.");
    } finally {
      setBusyAction(null);
    }
  }

  if (!summary) {
    return (
      <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="h-5 w-36 rounded bg-stone-100 dark:bg-stone-800" />
        <div className="mt-4 h-20 rounded-lg bg-stone-100 dark:bg-stone-800" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
            <UsersRound aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Team members</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Share this workspace&apos;s calls, Call Records, contacts, reminders, and work threads.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-right dark:border-stone-700 dark:bg-stone-800">
          <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">{seatCopy}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">{summary.planName}</p>
        </div>
      </div>

      {summary.canInvite ? (
        <form onSubmit={handleInvite} className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-800">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!canInvite || busyAction === "invite"}
                placeholder="teammate@company.com"
                className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50 dark:disabled:bg-stone-800"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as InviteRole)}
                disabled={!canInvite || busyAction === "invite"}
                className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:disabled:bg-stone-800"
              >
                <option value="member">Member</option>
                {canInviteAdmin ? <option value="admin">Admin</option> : null}
              </select>
            </label>
            <button
              type="submit"
              disabled={!canInvite || busyAction === "invite"}
              className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-[#3b1676] px-4 text-sm font-semibold text-white transition hover:bg-[#2e1065] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus aria-hidden="true" className="h-4 w-4" />
              {busyAction === "invite" ? "Sending..." : "Invite"}
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">
            Members can use shared calls, Call Records, contacts, and reminders. Admins can also invite teammates and manage members.
          </p>
          {atSeatLimit ? (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
              This workspace is at its plan limit. Remove a pending invite or member, or upgrade before inviting more people.
            </p>
          ) : null}
        </form>
      ) : (
        <div className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
          Only the workspace owner and admins can invite or remove teammates.
        </div>
      )}

      {message ? (
        <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}
      {lastInviteUrl ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900/60 dark:bg-violet-950/30">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-violet-950 dark:text-violet-300">
            {lastInviteUrl}
          </span>
          <button
            type="button"
            onClick={() => void copyInviteLink(lastInviteUrl)}
            className="inline-flex items-center gap-2 rounded-md border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-stone-900 dark:text-violet-300 dark:hover:bg-violet-950/50"
          >
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            Copy link
          </button>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          Members
        </div>
        <div className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-700">
          {summary.members.map((member: TeamMember) => {
            const canChangeRole =
              summary.currentUserRole === "owner" && member.role !== "owner";
            const canRemove =
              !member.isCurrentUser &&
              member.role !== "owner" &&
              (summary.currentUserRole === "owner" ||
                (summary.currentUserRole === "admin" && member.role === "member"));

            return (
              <div key={member.membershipId} className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 dark:bg-stone-900">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3b1676] text-sm font-bold text-white">
                    {member.label.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
                      {member.label}
                      {member.isCurrentUser ? <span className="font-normal text-stone-500 dark:text-stone-400"> · You</span> : null}
                    </p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">{member.email}</p>
                  </div>
                </div>

                {canChangeRole ? (
                  <select
                    value={member.role === "admin" ? "admin" : "member"}
                    onChange={(event) =>
                      void handleRoleChange(member, event.target.value as InviteRole)
                    }
                    disabled={busyAction === `role:${member.membershipId}`}
                    className="h-9 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${roleClasses(member.role)}`}>
                    {member.roleLabel}
                  </span>
                )}

                <span className="text-xs text-stone-400 dark:text-stone-500">Joined {formatDate(member.joinedAt)}</span>
                {canRemove ? (
                  <button
                    type="button"
                    onClick={() => setMemberToRemove(member)}
                    disabled={busyAction === `remove:${member.membershipId}`}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-rose-200 px-2.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/30"
                    aria-label={`Remove ${member.label}`}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {summary.pendingInvites.length > 0 ? (
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <Mail aria-hidden="true" className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Pending invites
          </div>
          <div className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-700">
            {summary.pendingInvites.map((invite: PendingInvite) => {
              const canManageAdminInvite =
                invite.role !== "admin" || summary.currentUserRole === "owner";
              return (
                <div key={invite.invitationId} className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 dark:bg-stone-900">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{invite.email}</p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                      {deliveryLabel(invite.emailDeliveryStatus)} · Expires {formatDate(invite.expiresAt)}
                      {invite.emailError ? ` · ${invite.emailError}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${roleClasses(invite.role)}`}>
                    {invite.roleLabel}
                  </span>
                  {canManageAdminInvite ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleResend(invite)}
                        disabled={busyAction === `resend:${invite.invitationId}`}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-stone-300 px-2.5 text-stone-700 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                        aria-label={`Resend invite to ${invite.email}`}
                      >
                        <RefreshCw aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviteToRevoke(invite)}
                        disabled={busyAction === `revoke:${invite.invitationId}`}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-rose-200 px-2.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/30"
                        aria-label={`Revoke invite to ${invite.email}`}
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {memberToRemove ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-member-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h3 id="remove-member-title" className="text-lg font-semibold text-stone-950 dark:text-stone-50">
              Remove teammate?
            </h3>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              {memberToRemove.label} will lose access to this workspace&apos;s calls, Call Records,
              contacts, reminders, and work threads.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setMemberToRemove(null)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Keep member
              </button>
              <button
                type="button"
                disabled={busyAction === `remove:${memberToRemove.membershipId}`}
                onClick={async () => {
                  await handleRemove(memberToRemove);
                  setMemberToRemove(null);
                }}
                className="inline-flex h-10 items-center justify-center rounded-md bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
              >
                {busyAction === `remove:${memberToRemove.membershipId}` ? "Removing..." : "Remove member"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {inviteToRevoke ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-invite-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h3 id="revoke-invite-title" className="text-lg font-semibold text-stone-950 dark:text-stone-50">
              Revoke invite?
            </h3>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              The invite link for {inviteToRevoke.email} will stop working immediately.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setInviteToRevoke(null)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Keep invite
              </button>
              <button
                type="button"
                disabled={busyAction === `revoke:${inviteToRevoke.invitationId}`}
                onClick={async () => {
                  await handleRevoke(inviteToRevoke);
                  setInviteToRevoke(null);
                }}
                className="inline-flex h-10 items-center justify-center rounded-md bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
              >
                {busyAction === `revoke:${inviteToRevoke.invitationId}` ? "Revoking..." : "Revoke invite"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
