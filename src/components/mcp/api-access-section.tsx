"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useToast } from "@/components/ui/toast";

type CreatedKey = {
  plaintextKey: string;
  label: string;
};

function formatDate(timestamp: number | undefined) {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-800 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
    >
      {copied ? (
        <>
          <Check aria-hidden="true" className="h-3.5 w-3.5 text-green-600" />
          Copied
        </>
      ) : (
        <>
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

export function ApiAccessSection() {
  const { showToast } = useToast();
  const keys = useQuery(api.apiKeys.listWorkspaceApiKeys);
  const createApiKey = useMutation(api.apiKeys.createApiKey);
  const revokeApiKey = useMutation(api.apiKeys.revokeApiKey);

  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = label.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const result = await createApiKey({ label: trimmed });
      setCreatedKey({ plaintextKey: result.plaintextKey, label: result.label });
      setLabel("");
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : "Could not create the API key.",
        "error"
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: Id<"apiKeys">) {
    setRevokingKeyId(null);
    try {
      await revokeApiKey({ keyId });
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : "Could not revoke the API key.",
        "error"
      );
    }
  }

  const activeKeys = (keys ?? []).filter((key) => !key.revoked);

  return (
    <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
          <KeyRound aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">
            API keys
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
            Personal keys for connecting MCP clients to this workspace&apos;s Call
            Records. Keys are read-only and can be revoked anytime.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCreate();
              }}
              placeholder="Key name (e.g. Claude on my laptop)"
              maxLength={60}
              className="h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 sm:max-w-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-violet-950/40"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!label.trim() || creating}
              className="rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create API key"}
            </button>
          </div>

          {createdKey && (
            <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {createdKey.label} — copy this key now
              </p>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                For security, it won&apos;t be shown again.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
                  {createdKey.plaintextKey}
                </code>
                <CopyButton value={createdKey.plaintextKey} />
              </div>
              <button
                type="button"
                onClick={() => setCreatedKey(null)}
                className="mt-3 text-xs font-semibold text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
              >
                I saved it — dismiss
              </button>
            </div>
          )}

          {activeKeys.length > 0 && (
            <ul className="mt-5 divide-y divide-stone-100 border-t border-stone-100 dark:divide-stone-800 dark:border-stone-800">
              {activeKeys.map((key) => (
                <li
                  key={key.keyId}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                      {key.label}
                      {!key.mine && key.createdByEmail && (
                        <span className="ml-2 font-normal text-stone-500 dark:text-stone-400">
                          ({key.createdByEmail})
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-stone-500 dark:text-stone-400">
                      {key.keyPrefix}… · created {formatDate(key.createdAt)} · last used{" "}
                      {formatDate(key.lastUsedAt)}
                    </p>
                  </div>
                  {revokingKeyId === key.keyId ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRevoke(key.keyId)}
                        className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-800"
                      >
                        Confirm revoke
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevokingKeyId(null)}
                        className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRevokingKeyId(key.keyId)}
                      className="shrink-0 self-start rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 sm:self-auto dark:border-stone-700 dark:text-stone-300 dark:hover:border-rose-900 dark:hover:bg-rose-950/20 dark:hover:text-rose-300"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
