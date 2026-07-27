import { forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  FileSearch,
  FlaskConical,
  GitCompareArrows,
  Check,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import ConfidenceChip from "@/components/shared/ConfidenceChip";
import ApprovalBadge, { type ApprovalState } from "@/components/shared/ApprovalBadge";
import { approvalStateLabel } from "@/lib/trpc-data";
import { chartSeries } from "@/lib/theme";
import {
  evidenceIds,
  formatCostPerJob,
  formatBudgetRange,
  formatDate,
  formatHorizon,
  formatJobs,
  unwrapData,
  type OpportunityDetail,
  type OpportunityItem,
} from "./types";

const SECTOR_ORDER = ["edu", "sme", "proc", "agro", "digital"];

export function sectorColor(code: string): string {
  const i = SECTOR_ORDER.indexOf(code);
  return chartSeries[i >= 0 ? i % chartSeries.length : 0];
}

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface RankingRowProps {
  rank: number;
  item: OpportunityItem;
  sectorName: string;
  /** Mono geography path, e.g. "Kaduna State › All LGAs". */
  geographyPath: string;
  expanded: boolean;
  inCompare: boolean;
  compareFull: boolean;
  onToggle: () => void;
  onOpenEvidence: () => void;
  onSimulate: () => void;
  onToggleCompare: () => void;
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2">
      <p className="caption-label text-[10px] text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-sm text-ink-primary">{value}</p>
    </div>
  );
}

/** Inline detail band: blueprint summary fetched lazily on first expand. */
function ExpandedDetail({
  item,
  onOpenEvidence,
  onSimulate,
  onToggleCompare,
  inCompare,
  compareFull,
}: {
  item: OpportunityItem;
  onOpenEvidence: () => void;
  onSimulate: () => void;
  onToggleCompare: () => void;
  inCompare: boolean;
  compareFull: boolean;
}) {
  const detailQuery = trpc.opportunities.get.useQuery(
    { opportunity_id: item.opportunityId },
    { staleTime: 60_000 },
  );
  const detail = unwrapData<OpportunityDetail>(detailQuery.data);
  const interventions = detail?.interventions ?? [];

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.26, ease: EASE_OUT }}
      className="overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, delay: 0.1 }}
        className="border-t border-ink-subtle px-4 py-3"
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div>
            <p className="caption-label text-ink-muted">Rationale</p>
            <p className="mt-1 text-[13px] leading-5 text-ink-secondary">
              {item.summary ?? "No rationale recorded for this opportunity yet."}
            </p>

            <p className="caption-label mt-3 text-ink-muted">
              Recommendation blueprint
            </p>
            {detailQuery.isLoading ? (
              <div aria-busy="true" className="mt-2 space-y-1.5">
                <div className="skeleton-shimmer h-3.5 w-3/4" />
                <div className="skeleton-shimmer h-3.5 w-1/2" />
              </div>
            ) : interventions.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {interventions.map((itv) => (
                  <li
                    key={itv.interventionId}
                    className="flex flex-wrap items-baseline gap-x-2 text-[13px]"
                  >
                    <span className="text-ink-primary">{itv.name}</span>
                    <span className="font-mono text-xs text-ink-muted">
                      {itv.expectedJobs != null
                        ? `${formatJobs(itv.expectedJobs)} jobs`
                        : "jobs n/a"}
                      {itv.timelineMonths != null &&
                        ` · ${itv.timelineMonths} mo`}
                      {itv.instrumentType &&
                        ` · ${itv.instrumentType.replace(/_/g, " ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[13px] text-ink-muted">
                Blueprint interventions not yet drafted for this opportunity.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 self-start">
            <DetailStat
              label="Budget range"
              value={formatBudgetRange(item.budgetMin, item.budgetMax)}
            />
            <DetailStat label="Timeline" value={formatHorizon(item.horizonMonths)} />
            <DetailStat
              label="Interventions"
              value={detailQuery.isLoading ? "…" : String(interventions.length)}
            />
            <DetailStat
              label="Evidence sources"
              value={String(evidenceIds(item.evidenceRefs).length)}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenEvidence}
            className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-xs font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98]"
          >
            <FileSearch aria-hidden className="h-3.5 w-3.5" />
            Open evidence
          </button>
          <button
            type="button"
            onClick={onSimulate}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-elevated px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-ink-strong hover:text-ink-primary"
          >
            <FlaskConical aria-hidden className="h-3.5 w-3.5" />
            Simulate →
          </button>
          <button
            type="button"
            onClick={onToggleCompare}
            disabled={!inCompare && compareFull}
            title={
              !inCompare && compareFull
                ? "Compare tray is full (3/3)"
                : inCompare
                  ? "Remove from compare"
                  : "Add to compare"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              inCompare
                ? "border-civic bg-civic/10 text-civic"
                : "border-ink-subtle bg-ink-elevated text-ink-secondary hover:border-ink-strong hover:text-ink-primary",
              !inCompare && compareFull && "cursor-not-allowed opacity-50",
            )}
          >
            {inCompare ? (
              <Check aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <GitCompareArrows aria-hidden className="h-3.5 w-3.5" />
            )}
            {inCompare ? "In compare tray" : "Add to compare"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Ranked opportunity row-card (96px) with FLIP re-sort and expand band. */
const RankingRow = forwardRef<HTMLDivElement, RankingRowProps>(
  function RankingRow(
    {
      rank,
      item,
      sectorName,
      geographyPath,
      expanded,
      inCompare,
      compareFull,
      onToggle,
      onOpenEvidence,
      onSimulate,
      onToggleCompare,
    },
    ref,
  ) {
    const color = sectorColor(item.sectorCode);
    const evCount = evidenceIds(item.evidenceRefs).length;
    const lowConfidence = item.confidence < 0.5;
    const approval = approvalStateLabel(item.reviewState) as ApprovalState;

    return (
      <motion.div
        layout="position"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          layout: { duration: 0.2, ease: EASE_OUT },
          duration: 0.24,
          delay: Math.min(rank, 10) * 0.05,
          ease: EASE_OUT,
        }}
        ref={ref}
        data-opportunity-id={item.opportunityId}
        className={cn(
          "group rounded-md border bg-ink-surface transition-colors duration-150",
          expanded
            ? "border-ink-strong"
            : "border-ink-subtle hover:border-ink-strong",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={`Rank ${rank}: ${item.title}. Press Enter to ${expanded ? "collapse" : "expand"}, C to compare, E for evidence.`}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
          className="flex min-h-24 cursor-pointer items-center gap-3 px-3 py-2.5 focus:outline-none"
        >
          <span
            aria-hidden
            className="w-7 shrink-0 text-right font-mono text-lg font-medium text-ink-muted"
          >
            {rank}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-sm font-semibold text-ink-primary">
                {item.title}
              </h3>
              <span
                className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{
                  borderColor: `${color}55`,
                  color,
                  backgroundColor: `${color}14`,
                }}
              >
                {sectorName}
              </span>
              <ApprovalBadge state={approval} />
              {lowConfidence && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-status-danger/40 bg-status-danger/10 px-2 py-0.5 text-[11px] font-medium text-status-danger"
                  title="Imputation flag: proxy features in use for this jurisdiction (BR-8). Treat estimates as indicative pending steward review."
                >
                  <AlertTriangle aria-hidden className="h-3 w-3" />
                  Low confidence — proxy features in use
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
              {geographyPath}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-ink-secondary">
              <span>
                Score{" "}
                <span className="text-ink-primary">{item.score.toFixed(2)}</span>
              </span>
              <span>
                Est. jobs{" "}
                <span className="text-ink-primary">
                  {formatJobs(item.estimatedJobsMax ?? item.estimatedJobsMin)}
                </span>
              </span>
              <span>
                Cost/job{" "}
                <span className="text-ink-primary">{formatCostPerJob(item)}</span>
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <ConfidenceChip
              score={item.confidence}
              evidenceCount={evCount}
              freshness={formatDate(item.updatedAt)}
            />
            <span className="text-[11px] text-ink-muted">
              Evidence: {evCount} sources · newest {formatDate(item.updatedAt)}
            </span>
          </div>

          <ChevronRight
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200",
              expanded && "rotate-90 text-civic",
            )}
          />
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <ExpandedDetail
              item={item}
              onOpenEvidence={onOpenEvidence}
              onSimulate={onSimulate}
              onToggleCompare={onToggleCompare}
              inCompare={inCompare}
              compareFull={compareFull}
            />
          )}
        </AnimatePresence>
      </motion.div>
    );
  },
);

export default RankingRow;

/** Skeleton row matching the 96px ranking row exactly (no layout shift). */
export function SkeletonRankingRow() {
  return (
    <div
      aria-hidden
      className="flex min-h-24 items-center gap-3 rounded-md border border-ink-subtle bg-ink-surface px-3 py-2.5"
    >
      <div className="skeleton-shimmer h-6 w-7" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="skeleton-shimmer h-4 w-2/5" />
          <div className="skeleton-shimmer h-5 w-20 rounded-full" />
        </div>
        <div className="skeleton-shimmer h-3 w-32" />
        <div className="skeleton-shimmer h-3 w-3/5" />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="skeleton-shimmer h-5 w-24 rounded-full" />
        <div className="skeleton-shimmer h-3 w-32" />
      </div>
      <div className="skeleton-shimmer h-4 w-4" />
    </div>
  );
}
