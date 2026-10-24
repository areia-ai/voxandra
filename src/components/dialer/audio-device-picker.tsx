"use client";

import { Headphones, Mic, X } from "lucide-react";
import type { AudioDeviceOption } from "@/components/providers/call-provider";

function DeviceSelect({
  icon,
  label,
  devices,
  selectedDeviceId,
  onSelect,
  fallbackLabel,
}: {
  icon: React.ReactNode;
  label: string;
  devices: AudioDeviceOption[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
  fallbackLabel: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
        {icon}
        {label}
      </span>
      {devices.length > 0 ? (
        <select
          value={selectedDeviceId ?? devices[0]?.deviceId ?? ""}
          onChange={(event) => onSelect(event.target.value)}
          className="h-10 rounded-md border border-stone-700 bg-stone-950 px-3 text-sm text-stone-100 outline-none focus:border-teal-400"
        >
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="rounded-md border border-stone-800 bg-stone-950 px-3 py-2 text-xs text-stone-500">
          {fallbackLabel}
        </p>
      )}
    </label>
  );
}

export function AudioDevicePopover({
  inputDevices,
  outputDevices,
  selectedInputDeviceId,
  selectedOutputDeviceId,
  onSelectInput,
  onSelectOutput,
  onClose,
}: {
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  selectedInputDeviceId: string | null;
  selectedOutputDeviceId: string | null;
  onSelectInput: (deviceId: string) => void;
  onSelectOutput: (deviceId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-xl border border-stone-800 bg-stone-900 p-4 shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-white">Audio devices</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close audio devices"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 transition hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3 grid gap-3">
        <DeviceSelect
          icon={<Mic aria-hidden="true" className="h-3.5 w-3.5" />}
          label="Microphone"
          devices={inputDevices}
          selectedDeviceId={selectedInputDeviceId}
          onSelect={onSelectInput}
          fallbackLabel="No microphones detected."
        />
        <DeviceSelect
          icon={<Headphones aria-hidden="true" className="h-3.5 w-3.5" />}
          label="Speaker"
          devices={outputDevices}
          selectedDeviceId={selectedOutputDeviceId}
          onSelect={onSelectOutput}
          fallbackLabel="This browser does not support speaker selection."
        />
      </div>
    </div>
  );
}
