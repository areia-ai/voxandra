"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { deriveWorkspaceName, validateWorkspaceName } from "@/lib/workspace-name";

type WorkspaceNameEditorProps = {
  workspaceName?: string | null;
  displayName?: string | null;
  email?: string | null;
  variant?: "header" | "settings";
  canEdit?: boolean;
};

export function WorkspaceNameEditor({
  workspaceName,
  displayName,
  email,
  variant = "header",
  canEdit,
}: WorkspaceNameEditorProps) {
  const renameWorkspace = useMutation(api.profiles.renameMyWorkspace);
  const currentRole = useQuery(api.team.getMyWorkspaceRole);
  const canEditWorkspace =
    canEdit ?? (currentRole === "owner" || currentRole === "admin");
  const derivedName = useMemo(
    () => deriveWorkspaceName({ workspaceName, displayName, email }),
    [displayName, email, workspaceName]
  );
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(derivedName);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const visibleName = derivedName;

  const startEditing = () => {
    setDraftName(visibleName);
    setError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftName(visibleName);
    setError(null);
    setIsEditing(false);
  };

  const saveName = async () => {
    const result = validateWorkspaceName(draftName);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await renameWorkspace({ name: result.value });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update workspace name.");
    } finally {
      setIsSaving(false);
    }
  };

  if (variant === "settings") {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-stone-600 dark:text-stone-400">Workspace name</p>
            {!isEditing ? (
              <p className="mt-1 font-medium text-stone-900 dark:text-stone-100">{visibleName}</p>
            ) : null}
          </div>

          {isEditing ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-md">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveName();
                  if (event.key === "Escape") cancelEditing();
                }}
                disabled={isSaving}
                autoFocus
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveName()}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#3b1676] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Check aria-hidden="true" className="h-4 w-4" />
                  {isSaving ? "Saving" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                  Cancel
                </button>
              </div>
            </div>
          ) : canEditWorkspace ? (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
              Edit
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {isEditing ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveName();
              if (event.key === "Escape") cancelEditing();
            }}
            disabled={isSaving}
            autoFocus
            className="h-7 max-w-[220px] rounded-md border border-stone-300 bg-white px-2 text-xs font-medium uppercase text-stone-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
          />
          <button
            type="button"
            onClick={() => void saveName()}
            disabled={isSaving}
            className="rounded-md p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            title="Save workspace name"
          >
            <Check aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={cancelEditing}
            disabled={isSaving}
            className="rounded-md p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800"
            title="Cancel workspace rename"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-xs font-medium uppercase text-stone-500 dark:text-stone-400">{visibleName}</p>
          {canEditWorkspace ? (
            <button
              type="button"
              onClick={startEditing}
              className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
              title="Edit workspace name"
            >
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-1 text-xs font-medium normal-case text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
