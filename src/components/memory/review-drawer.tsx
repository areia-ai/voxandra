"use client";

import { X, Sparkles } from "lucide-react";
import { ReviewWorkspace } from "./review-workspace";

export function ReviewDrawer({
  callId,
  open,
  onClose,
}: {
  callId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !callId) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-2xl transform overflow-y-auto bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-stone-950">AI Summary</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-stone-500 hover:bg-stone-100"
            aria-label="Close review"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">
          <ReviewWorkspace
            callId={callId}
            onAccept={onClose}
            onDismiss={onClose}
          />
        </div>
      </div>
    </>
  );
}
