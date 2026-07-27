import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  FileSearch,
  FlaskConical,
  Printer,
} from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import ConfidenceChip from "@/components/shared/ConfidenceChip";
import { SkeletonTable } from "@/components/shared/Skeleton";
import EmptyState from "@/components/shared/EmptyState";
import { chartSeries } from "@/lib/theme";
import {
  clamp01,
  costPerJob,
  evidenceIds,
  formatBudgetRange,
  formatCostPerJob,
  formatHorizon,
  formatJobs,
  unwrapData,
  type ComparePayload,
  type OpportunityItem,
} from "./types";

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface MetricRow {
  id: string;
  label: string;
  values: (string | number)[];
  raw: number[];
  /** "max" → highest raw wins; "min" → lowest raw wins. */
  best: "max" | "min";
  format: (o: OpportunityItem) => string;
}

export interface CompareViewProps {
  ids: string[];
  sectorName: (code: string) => string;
  onBack: () => void;
  onSimulate: (id: string) => void;
  onOpenEvidence: (id: string) => void;
}

/** 3-column side-by-side spec sheet replacing the main area. */
export default function CompareView({
  ids,
  sectorName,
  onBack,
  onSimulate,
  onOpenEvidence,
}: CompareViewProps) {
  const compareQuery = trpc.opportunities.compare.useQuery(
    { opportunity_ids: ids },
    { staleTime: 60_000 },
  );
  const payload = unwrapData<ComparePayload>(compareQuery.data);

  // Preserve tray order (API returns rows unordered).
  const items = useMemo(() => {
    if (!payload) return [];
    const byId = new Map(payload.opportunities.map((o) => [o.opportunityId, o]));
    return ids.map((id) => byId.get(id)).filter((o): o is OpportunityItem => !!o);
  }, [payload, ids]);

  const rows: MetricRow[] = useMemo(() => {
    if (items.length === 0) return [];
    const jobsMax = (o: OpportunityItem) => o.estimatedJobsMax ?? 0;
    const budgetMid = (o: OpportunityItem) =>
      o.budgetMin != null && o.budgetMax != null
        ? (o.budgetMin + o.budgetMax) / 2
        : 0;
    const riskProxy = (o: OpportunityItem) =>
      // Fewer cited sources + lower confidence → higher delivery risk.
      Math.round(
        clamp01(1 - o.confidence) * 10 -
          Math.min(4, evidenceIds(o.evidenceRefs).length),
      );
    return [
      {
        id: "score",
        label: "Score",
        values: items.map((o) => o.score.toFixed(2)),
        raw: items.map((o) => o.score),
        best: "max",
        format: (o) => o.score.toFixed(2),
      },
      {
        id: "jobs",
        label: "Est. jobs (max)",
        values: items.map((o) => formatJobs(jobsMax(o))),
        raw: items.map(jobsMax),
        best: "max",
        format: (o) => formatJobs(jobsMax(o)),
      },
      {
        id: "budget",
        label: "Budget range",
        values: items.map((o) => formatBudgetRange(o.budgetMin, o.budgetMax)),
        raw: items.map(budgetMid),
        best: "min",
        format: (o) => formatBudgetRange(o.budgetMin, o.budgetMax),
      },
      {
        id: "timeline",
        label: "Timeline",
        values: items.map((o) => formatHorizon(o.horizonMonths)),
        raw: items.map((o) => o.horizonMonths ?? 999),
        best: "min",
        format: (o) => formatHorizon(o.horizonMonths),
      },
      {
        id: "cost",
        label: "Cost / job",
        values: items.map((o) => formatCostPerJob(o)),
        raw: items.map((o) => costPerJob(o) ?? Number.MAX_SAFE_INTEGER),
        best: "min",
        format: (o) => formatCostPerJob(o),
      },
      {
        id: "confidence",
        label: "Confidence",
        values: items.map((o) => o.confidence.toFixed(2)),
        raw: items.map((o) => o.confidence),
        best: "max",
        format: (o) => o.confidence.toFixed(2),
      },
      {
        id: "risk",
        label: "Risk count (proxy)",
        values: items.map((o) => String(riskProxy(o))),
        raw: items.map(riskProxy),
        best: "min",
        format: (o) => String(riskProxy(o)),
      },
    ];
  }, [items]);

  const bestIdx = (row: MetricRow): number => {
    let best = 0;
    row.raw.forEach((v, i) => {
      if (row.best === "max" ? v > row.raw[best] : v < row.raw[best]) best = i;
    });
    return best;
  };

  /** Shared cited sources across all compared opportunities. */
  const sharedSources = useMemo(() => {
    if (items.length < 2) return 0;
    const sets = items.map((o) => new Set(evidenceIds(o.evidenceRefs)));
    const [first, ...rest] = sets;
    let n = 0;
    first.forEach((id) => {
      if (rest.every((s) => s.has(id))) n += 1;
    });
    return n;
  }, [items]);

  const radarData = useMemo(() => {
    if (items.length === 0) return [];
    const maxJobs = Math.max(...items.map((o) => o.estimatedJobsMax ?? 0), 1);
    const costs = items.map((o) => costPerJob(o) ?? 0);
    const maxCost = Math.max(...costs, 1);
    const maxHorizon = Math.max(...items.map((o) => o.horizonMonths ?? 1), 1);
    const axes: { axis: string; value: (o: OpportunityItem) => number }[] = [
      { axis: "Score", value: (o) => o.score },
      { axis: "Jobs", value: (o) => (o.estimatedJobsMax ?? 0) / maxJobs },
      {
        axis: "Cost-efficiency",
        value: (o) => 1 - (costPerJob(o) ?? 0) / maxCost,
      },
      { axis: "Confidence", value: (o) => o.confidence },
      { axis: "Speed", value: (o) => 1 - (o.horizonMonths ?? 0) / maxHorizon },
    ];
    return axes.map(({ axis, value }) => {
      const point: Record<string, string | number> = { axis };
      items.forEach((o) => {
        point[o.opportunityId] = Number(clamp01(value(o)).toFixed(3));
      });
      return point;
    });
  }, [items]);

  if (compareQuery.isLoading) {
    return (
      <div className="space-y-4">
        <CompareHeader onBack={onBack} count={ids.length} />
        <SkeletonTable rows={7} columns={ids.length + 1} />
      </div>
    );
  }

  if (compareQuery.isError || !payload) {
    return (
      <div className="space-y-4">
        <CompareHeader onBack={onBack} count={ids.length} />
        <EmptyState
          title="Comparison unavailable"
          guidance={
            compareQuery.error?.message ??
            "One or more selected opportunities could not be loaded."
          }
          action={{ label: "Back to ranking", onClick: onBack }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CompareHeader onBack={onBack} count={items.length} />

      {/* Column headers */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `160px repeat(${items.length}, minmax(0,1fr))`,
        }}
      >
        <div aria-hidden />
        {items.map((o, i) => (
          <motion.div
            key={o.opportunityId}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: i * 0.08, ease: EASE_OUT }}
            className="rounded-md border border-ink-subtle bg-ink-surface p-3"
          >
            <p className="caption-label text-ink-muted">{sectorName(o.sectorCode)}</p>
            <h3 className="mt-1 text-sm font-semibold leading-5 text-ink-primary">
              {o.title}
            </h3>
            <div className="mt-2">
              <ConfidenceChip
                score={o.confidence}
                evidenceCount={evidenceIds(o.evidenceRefs).length}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Metrics spec sheet */}
      <div className="overflow-hidden rounded-md border border-ink-subtle bg-ink-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Side-by-side metrics for {items.length} compared opportunities
          </caption>
          <thead>
            <tr className="border-b border-ink-strong">
              <th
                scope="col"
                className="caption-label px-3 py-2 text-left text-ink-muted"
              >
                Metric
              </th>
              {items.map((o) => (
                <th
                  key={o.opportunityId}
                  scope="col"
                  className="caption-label max-w-0 truncate px-3 py-2 text-left text-ink-muted"
                >
                  {o.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const best = bestIdx(row);
              const bestVal = row.raw[best];
              return (
                <tr
                  key={row.id}
                  className="border-b border-ink-subtle/60 last:border-0"
                >
                  <th
                    scope="row"
                    className="px-3 py-2.5 text-left text-[13px] font-medium text-ink-secondary"
                  >
                    {row.label}
                  </th>
                  {items.map((o, i) => {
                    const isBest = i === best && items.length > 1;
                    const delta = row.raw[i] - bestVal;
                    return (
                      <td
                        key={o.opportunityId}
                        className={cn(
                          "px-3 py-2.5 font-mono text-[13px]",
                          isBest
                            ? "bg-civic/10 text-civic-strong"
                            : "text-ink-primary",
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {row.values[i]}
                          {isBest && (
                            <span className="rounded-full bg-civic/20 px-1.5 py-0.5 text-[10px] font-sans font-medium text-civic">
                              best
                            </span>
                          )}
                        </span>
                        {!isBest && delta !== 0 && row.id !== "budget" && (
                          <span className="ml-1.5 text-[11px] text-ink-muted">
                            {row.best === "max"
                              ? `${delta >= 0 ? "+" : "−"}${Math.abs(delta) >= 100 ? Math.abs(delta).toLocaleString("en-NG") : Math.abs(delta).toFixed(2)}`
                              : `+${Math.abs(delta) >= 100 ? Math.abs(delta).toLocaleString("en-NG") : Math.abs(delta).toFixed(row.id === "cost" ? 0 : 2)}`}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Radar + evidence overlap */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-ink-subtle bg-ink-surface p-3">
          <h3 className="caption-label text-ink-muted">Profile overlay</h3>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="#1E2C47" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fill: "#9AA8BF", fontSize: 11 }}
                />
                <PolarRadiusAxis
                  domain={[0, 1]}
                  tick={false}
                  axisLine={false}
                />
                {items.map((o, i) => (
                  <Radar
                    key={o.opportunityId}
                    name={o.title}
                    dataKey={o.opportunityId}
                    stroke={chartSeries[i % chartSeries.length]}
                    fill={chartSeries[i % chartSeries.length]}
                    fillOpacity={0.12}
                    isAnimationActive
                    animationDuration={500}
                  />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {items.map((o, i) => (
              <li
                key={o.opportunityId}
                className="inline-flex items-center gap-1.5 text-[11px] text-ink-secondary"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: chartSeries[i % chartSeries.length] }}
                />
                <span className="max-w-40 truncate">{o.title}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col rounded-md border border-ink-subtle bg-ink-surface p-3">
          <h3 className="caption-label text-ink-muted">Evidence overlap</h3>
          <p className="mt-2 text-[13px] leading-5 text-ink-secondary">
            {sharedSources > 0
              ? `${sharedSources} shared source${sharedSources === 1 ? "" : "s"} cited across all compared opportunities — recommendations draw on a partially common evidence base.`
              : "No cited source is shared across all compared opportunities — each recommendation rests on a distinct evidence base."}
          </p>
          <div className="mt-auto space-y-2 pt-3">
            {items.map((o) => (
              <div
                key={o.opportunityId}
                className="flex flex-wrap items-center gap-2 border-t border-ink-subtle/60 pt-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-primary">
                  {o.title}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenEvidence(o.opportunityId)}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-subtle bg-ink-elevated px-2 py-1 text-[11px] font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
                >
                  <FileSearch aria-hidden className="h-3 w-3" />
                  Open evidence
                </button>
                <button
                  type="button"
                  onClick={() => onSimulate(o.opportunityId)}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-subtle bg-ink-elevated px-2 py-1 text-[11px] font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
                >
                  <FlaskConical aria-hidden className="h-3 w-3" />
                  Simulate →
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => window.print()}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-xs font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98]"
            >
              <Printer aria-hidden className="h-3.5 w-3.5" />
              Export comparison PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareHeader({ onBack, count }: { onBack: () => void; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        Back to ranking
      </button>
      <p className="caption-label text-ink-muted">
        Comparing {count} opportunit{count === 1 ? "y" : "ies"}
      </p>
    </div>
  );
}
