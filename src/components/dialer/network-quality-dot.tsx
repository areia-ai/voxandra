import type { NetworkQuality } from "@/components/providers/call-provider";

const qualityStyles: Record<NetworkQuality, { dot: string; label: string }> = {
  unknown: { dot: "bg-stone-500", label: "Connecting" },
  good: { dot: "bg-emerald-400", label: "Good connection" },
  fair: { dot: "bg-amber-400", label: "Fair connection" },
  poor: { dot: "bg-rose-500", label: "Poor connection" },
};

export function NetworkQualityDot({
  quality,
  showLabel = false,
}: {
  quality: NetworkQuality;
  showLabel?: boolean;
}) {
  const style = qualityStyles[quality];
  return (
    <span className="inline-flex items-center gap-1.5" title={style.label}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot} ${quality === "poor" ? "animate-pulse" : ""}`} />
      {showLabel ? <span className="text-xs font-medium text-stone-300">{style.label}</span> : null}
    </span>
  );
}
