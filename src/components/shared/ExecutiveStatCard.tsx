import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus, BookOpenText } from "lucide-react";
import { cn } from "@/lib/utils";
import ConfidenceChip from "./ConfidenceChip";

export interface ExecutiveStatCardProps {
  label: string;
  /** Numeric metric; counts up 800ms on first view (disabled w/ reduced motion). */
  value: number;
  format?: (n: number) => string;
  /** Delta vs prior period, e.g. 0.082 = +8.2%. */
  delta?: number;
  deltaLabel?: string;
  /** Sparkline series (oldest → newest). */
  sparkline?: number[];
  confidence?: number;
  evidenceCount?: number;
  onOpenEvidence?: () => void;
  className?: string;
}

const defaultFormat = (n: number) => n.toLocaleString("en-NG");

function useCountUp(target: number, duration = 800) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setVal(target);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started.current) {
          started.current = true;
          const t0 = performance.now();
          const tick = (t: number) => {
            const p = Math.min((t - t0) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(target * eased);
            if (p < 1) requestAnimationFrame(tick);
            else setVal(target);
          };
          requestAnimationFrame(tick);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target, duration]);

  return { val, ref };
}

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`,
    )
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-7 w-24", className)}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="#3FAE9E"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Executive KPI card: caption label, big mono metric, delta, sparkline,
 *  confidence chip, evidence link. */
export default function ExecutiveStatCard({
  label,
  value,
  format = defaultFormat,
  delta,
  deltaLabel = "vs prior period",
  sparkline,
  confidence,
  evidenceCount,
  onOpenEvidence,
  className,
}: ExecutiveStatCardProps) {
  const { val: animated, ref: metricRef } = useCountUp(value);
  const display = format(animated);

  const DeltaIcon =
    delta === undefined || Math.abs(delta) < 0.0005
      ? Minus
      : delta > 0
        ? TrendingUp
        : TrendingDown;
  const deltaColor =
    delta === undefined || Math.abs(delta) < 0.0005
      ? "text-ink-muted"
      : delta > 0
        ? "text-status-success"
        : "text-status-danger";

  return (
    <section
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
      aria-label={label}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="caption-label text-ink-muted">{label}</h3>
        {confidence !== undefined && (
          <ConfidenceChip score={confidence} evidenceCount={evidenceCount} />
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span
          ref={metricRef}
          className="font-mono text-[34px] leading-10 text-ink-primary"
        >
          {display}
        </span>
        {sparkline && <Sparkline data={sparkline} />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {delta !== undefined ? (
          <span className={cn("inline-flex items-center gap-1 text-xs", deltaColor)}>
            <DeltaIcon aria-hidden className="h-3.5 w-3.5" />
            <span className="font-mono">
              {delta > 0 ? "+" : ""}
              {(delta * 100).toFixed(1)}%
            </span>
            <span className="text-ink-muted">{deltaLabel}</span>
          </span>
        ) : (
          <span />
        )}
        {onOpenEvidence && (
          <button
            type="button"
            onClick={onOpenEvidence}
            className="inline-flex items-center gap-1 text-xs font-medium text-civic hover:text-civic-strong"
          >
            <BookOpenText aria-hidden className="h-3.5 w-3.5" />
            Evidence
          </button>
        )}
      </div>
    </section>
  );
}
