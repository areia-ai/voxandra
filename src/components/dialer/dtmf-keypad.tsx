"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useGlobalCall } from "@/components/providers/call-provider";

const keys = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

export function DialerKeypadPopover({ onClose }: { onClose: () => void }) {
  const { sendDigits } = useGlobalCall();
  const [sentDigits, setSentDigits] = useState("");

  function press(digit: string) {
    sendDigits(digit);
    setSentDigits((value) => `${value}${digit}`.slice(-24));
  }

  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-xl border border-stone-800 bg-stone-900 p-4 shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <span className="min-h-5 truncate font-mono text-sm text-teal-200">
          {sentDigits || "Send DTMF tones"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close keypad"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 transition hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {keys.map((key) => (
          <button
            key={key.digit}
            type="button"
            onClick={() => press(key.digit)}
            className="flex h-14 flex-col items-center justify-center rounded-lg bg-stone-800 text-white transition hover:bg-stone-700 active:scale-95"
          >
            <span className="text-lg font-semibold leading-none">{key.digit}</span>
            {key.letters ? (
              <span className="mt-1 text-[0.6rem] font-bold leading-none tracking-[0.08em] text-stone-400">
                {key.letters}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
