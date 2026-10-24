"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

const MAX_DISPLAY_NAME_LENGTH = 80;

type DisplayNameEditorProps = {
  displayName?: string | null;
};

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function DisplayNameEditor({ displayName }: DisplayNameEditorProps) {
  const updateDisplayName = useMutation(api.profiles.updateMyProfileDisplayName);
  const currentDisplayName = displayName?.trim() ?? "";
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(currentDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const startEditing = () => {
    setDraftName(currentDisplayName);
    setError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftName(currentDisplayName);
    setError(null);
    setIsEditing(false);
  };

  const saveDisplayName = async () => {
    const nextDisplayName = normalizeDisplayName(draftName);
    if (!nextDisplayName) {
      setError("Enter a display name.");
      return;
    }
    if (nextDisplayName.length > MAX_DISPLAY_NAME_LENGTH) {
      setError("Display name must be 80 characters or fewer.");
      return;
    }
    if (nextDisplayName.includes("@")) {
      setError("Use a name, not an email address.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await updateDisplayName({ displayName: nextDisplayName });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update display name.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {isEditing ? (
            <label htmlFor="profile-display-name" className="text-stone-600 dark:text-stone-400">
              Display name
            </label>
          ) : (
            <p className="text-stone-600 dark:text-stone-400">Display name</p>
          )}
          {!isEditing ? (
            <p className="mt-1 truncate font-medium text-stone-900 dark:text-stone-100">
              {currentDisplayName || "Not set"}
            </p>
          ) : null}
        </div>

        {isEditing ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-md">
            <input
              id="profile-display-name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveDisplayName();
                if (event.key === "Escape") cancelEditing();
              }}
              disabled={isSaving}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              autoFocus
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveDisplayName()}
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
        ) : (
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <Pencil aria-hidden="true" className="h-4 w-4" />
            Edit
          </button>
        )}
      </div>
      {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
