import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { confidenceColor, confidenceLevel, confidenceLabel } from "@/lib/theme";

export interface ConfidenceChipProps {
  /** 0–1 confidence score. */
  score: number;
  /** Number of cited evidence items (tooltip). */
  evidenceCount?: number;
  /** Evidence freshness description, e.g. "12 Jan 2025" (tooltip). */
  freshness?: string;
  /** Model agreement 0–1 (tooltip). */
  modelAgreement?: number;
  className?: string;
}

/**
 * Confidence indicator: segmented 3-bar meter + text label + numeric score.
 * Tooltip (hover/focus) lists evidence count, freshness, model agreement.
 * Never color-only (design.md §1.3, §6).
 */
export default function ConfidenceChip({
  score,
  evidenceCount,
  freshness,
  modelAgreement,
  className,
}: ConfidenceChipProps) {
  const level = confidenceLevel(score);
  const color = confidenceColor[level];
  const shortLabel = level === "high" ? "High" : level === "med" ? "Medium" : "Low";
  const filledBars = level === "high" ? 3 : level === "med" ? 2 : 1;
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

  const tooltipLines = [
    confidenceLabel(score),
    evidenceCount !== undefined ? `Evidence: ${evidenceCount} sources` : null,
    freshness ? `Data as of ${freshness}` : null,
    modelAgreement !== undefined
      ? `Model agreement: ${modelAgreement.toFixed(2)}`
      : null,
  ].filter(Boolean);

  return (
    <span ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
        style={{ borderColor: `${color}66`, color, backgroundColor: `${color}14` }}
        aria-label={`${confidenceLabel(score)} — score ${score.toFixed(2)}. Activate for details.`}
      >
        <span className="flex items-end gap-[2px]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-[1px]"
              style={{
                height: 5 + i * 3,
                backgroundColor: i < filledBars ? color : "#2C3F63",
              }}
            />
          ))}
        </span>
        <span>
          {shortLabel} · <span className="font-mono">{score.toFixed(2)}</span>
        </span>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 w-56 rounded-md border border-ink-subtle bg-ink-elevated p-2.5 text-left shadow-overlay"
        >
          {tooltipLines.map((line, i) => (
            <span
              key={i}
              className={cn(
                "block text-xs",
                i === 0 ? "font-medium text-ink-primary" : "text-ink-secondary",
              )}
            >
              {line}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
