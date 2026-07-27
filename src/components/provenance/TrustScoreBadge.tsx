import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrustScore } from "@/lib/innovations-client";
import { confidenceLevel } from "@/lib/theme";

const COMPONENT_LABELS: { key: "authority" | "freshness" | "corroboration" | "extraction"; label: string }[] = [
  { key: "authority", label: "Source authority" },
  { key: "freshness", label: "Freshness" },
  { key: "corroboration", label: "Corroboration" },
  { key: "extraction", label: "Extraction quality" },
];

const LEVEL_CLASSES = {
  high: "border-status-success/50 bg-status-success/10 text-status-success",
  med: "border-status-warning/50 bg-status-warning/10 text-status-warning",
  low: "border-status-danger/50 bg-status-danger/10 text-status-danger",
} as const;

export interface TrustScoreBadgeProps {
  evidenceSourceId: string;
  className?: string;
}

/**
 * Evidence-source trust score: segmented 5-segment meter + numeric score,
 * with a popover breaking down the four trust components
 * (innovations.trustScore). Renders nothing if the endpoint is unavailable.
 */
export default function TrustScoreBadge({ evidenceSourceId, className }: TrustScoreBadgeProps) {
  const q = useTrustScore(evidenceSourceId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (q.isError || !q.data) return null;
  const { score, components } = q.data;
  const level = confidenceLevel(score);
  const filled = Math.round(Math.min(1, Math.max(0, score)) * 5);

  return (
    <span ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Trust score ${(score * 100).toFixed(0)} out of 100 — view component breakdown`}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
          LEVEL_CLASSES[level],
        )}
      >
        <ShieldCheck aria-hidden className="h-3 w-3" />
        <span aria-hidden className="inline-flex items-end gap-px">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                "w-1 rounded-sm",
                i < filled ? "bg-current" : "bg-ink-subtle",
              )}
              style={{ height: `${5 + i * 2}px` }}
            />
          ))}
        </span>
        Trust {(score * 100).toFixed(0)}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute right-0 top-full z-40 mt-1.5 block w-64 rounded-md border border-ink-subtle bg-ink-elevated p-3 shadow-lg"
        >
          <span className="block text-[12px] font-medium text-ink-primary">
            Trust score breakdown
          </span>
          <span className="mt-2 block space-y-1.5">
            {COMPONENT_LABELS.map(({ key, label }) => {
              const v = Math.min(1, Math.max(0, components[key] ?? 0));
              return (
                <span key={key} className="block">
                  <span className="flex items-center justify-between text-[11px] text-ink-secondary">
                    <span>{label}</span>
                    <span className="font-mono text-ink-primary">{(v * 100).toFixed(0)}</span>
                  </span>
                  <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-ink-inset">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        v >= 0.75
                          ? "bg-status-success"
                          : v >= 0.5
                            ? "bg-status-warning"
                            : "bg-status-danger",
                      )}
                      style={{ width: `${v * 100}%` }}
                    />
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}
