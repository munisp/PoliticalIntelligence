import { TrendingDown, BookOpenText, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfidenceChip } from "@/components/shared";
import { fmtInt, fmtShare } from "./utils";

/* Shared card chrome — matches ExecutiveStatCard layout exactly. */
const CARD = "rounded-md border border-ink-subtle bg-ink-surface p-4";

function EvidenceLink({ onClick }: { onClick?: () => void }) {
  if (!onClick) return <span />;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-civic hover:text-civic-strong"
    >
      <BookOpenText aria-hidden className="h-3.5 w-3.5" />
      Evidence
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 2027 target trajectory — radial progress ring                        */
/* ------------------------------------------------------------------ */

export interface TrajectoryRingCardProps {
  /** Jobs supported so far (numerator of the 250,000 target). */
  jobsSupported: number;
  target: number;
  /** "On pace" scenarios / total scenarios. */
  onPace: number;
  scenarioCount: number;
  confidence?: number;
  onOpenEvidence?: () => void;
  className?: string;
}

export function TrajectoryRingCard({
  jobsSupported,
  target,
  onPace,
  scenarioCount,
  confidence,
  onOpenEvidence,
  className,
}: TrajectoryRingCardProps) {
  const pct = Math.max(0, Math.min(1, jobsSupported / target));
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <section className={cn(CARD, className)} aria-label="2027 target trajectory">
      <div className="flex items-start justify-between gap-2">
        <h3 className="caption-label text-ink-muted">2027 target trajectory</h3>
        {confidence !== undefined && <ConfidenceChip score={confidence} />}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <svg
          viewBox="0 0 64 64"
          className="h-16 w-16 shrink-0"
          role="img"
          aria-label={`${fmtShare(pct)} of ${fmtInt(target)} target`}
        >
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="#080E1A"
            strokeWidth="7"
          />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="#3FAE9E"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform="rotate(-90 32 32)"
            className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
          />
          <text
            x="32"
            y="36"
            textAnchor="middle"
            className="fill-ink-primary font-mono"
            fontSize="13"
          >
            {fmtShare(pct, 1)}
          </text>
        </svg>
        <div>
          <p className="font-mono text-xl leading-7 text-ink-primary">
            {fmtInt(jobsSupported)}
          </p>
          <p className="text-xs text-ink-muted">
            of {fmtInt(target)} jobs by 2027
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-secondary">
          On pace:{" "}
          <span className="font-mono text-ink-primary">
            {onPace} of {scenarioCount}
          </span>{" "}
          scenarios
        </span>
        <EvidenceLink onClick={onOpenEvidence} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Youth unemployment — downward delta is good (success color)          */
/* ------------------------------------------------------------------ */

export interface UnemploymentCardProps {
  /** Latest unemployment share (0–1). */
  value: number;
  /** Year-over-year change in percentage points (negative = improving). */
  deltaPts: number;
  confidence?: number;
  evidenceCount?: number;
  caption?: string;
  onOpenEvidence?: () => void;
  className?: string;
}

export function UnemploymentCard({
  value,
  deltaPts,
  confidence,
  evidenceCount,
  caption,
  onOpenEvidence,
  className,
}: UnemploymentCardProps) {
  const improving = deltaPts < 0;
  return (
    <section
      className={cn(CARD, className)}
      aria-label="Youth unemployment (15–34)"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="caption-label text-ink-muted">
          Youth unemployment (15–34)
        </h3>
        {confidence !== undefined && (
          <ConfidenceChip score={confidence} evidenceCount={evidenceCount} />
        )}
      </div>
      <p className="mt-2 font-mono text-[34px] leading-10 text-ink-primary">
        {fmtShare(value)}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs",
            improving ? "text-status-success" : "text-status-danger",
          )}
        >
          <TrendingDown
            aria-hidden
            className={cn("h-3.5 w-3.5", !improving && "rotate-180")}
          />
          <span className="font-mono">
            {deltaPts > 0 ? "+" : "−"}
            {Math.abs(deltaPts).toFixed(1)} pts
          </span>
          <span className="text-ink-muted">
            YoY · {improving ? "improving" : "worsening"}
          </span>
        </span>
        <EvidenceLink onClick={onOpenEvidence} />
      </div>
      {caption && <p className="mt-1 text-[11px] text-ink-muted">{caption}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Open approvals — gold accent, click filters to the approvals column  */
/* ------------------------------------------------------------------ */

export interface ApprovalsKpiCardProps {
  count: number;
  /** Breakdown, e.g. ["2 briefs", "1 scenario"]. */
  breakdown: string[];
  onOpenQueue?: () => void;
  className?: string;
}

export function ApprovalsKpiCard({
  count,
  breakdown,
  onOpenQueue,
  className,
}: ApprovalsKpiCardProps) {
  return (
    <section
      className={cn(CARD, "border-gold/40", className)}
      aria-label="Open approvals"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="caption-label text-ink-muted">Open approvals</h3>
        <ClipboardCheck aria-hidden className="h-4 w-4 text-gold" />
      </div>
      <p className="mt-2 font-mono text-[34px] leading-10 text-gold">{count}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-secondary">
          {breakdown.length ? breakdown.join(" · ") : "Nothing awaiting sign-off"}
        </span>
        {onOpenQueue && (
          <button
            type="button"
            onClick={onOpenQueue}
            className="text-xs font-medium text-gold hover:text-[#d9b66a]"
          >
            Review queue
          </button>
        )}
      </div>
    </section>
  );
}
