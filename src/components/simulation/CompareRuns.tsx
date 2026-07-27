import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GitCompareArrows, CircleAlert, HelpCircle, Table2, ChartLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { chartSeries } from "@/lib/theme";
import UncertaintyBandChart from "@/components/shared/UncertaintyBandChart";
import EmptyState from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/Skeleton";
import { engineMeta } from "./engines";
import {
  formatNumber,
  metaApi,
  shortRunId,
  unwrapApi,
  type AssumptionSetLite,
  type RunRow,
} from "./studio";

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];
const MAX_RUNS = 4;

interface AlignedRun {
  simulation_run_id: string;
  engine: string;
  metric: string;
  unit: string;
  series: { month: number; mean: number; lower: number; upper: number }[];
}

interface Divergence {
  a: string;
  b: string;
  mean_abs_gap: number;
  max_gap_month: number;
}

export interface CompareRunsProps {
  runs: RunRow[];
  assumptionSets: AssumptionSetLite[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export default function CompareRuns({
  runs,
  assumptionSets,
  selectedIds,
  onSelectionChange,
}: CompareRunsProps) {
  const succeeded = useMemo(
    () => runs.filter((r) => r.status === "succeeded" && r.resultSummary),
    [runs],
  );

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else if (selectedIds.length < MAX_RUNS) {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const compareQuery = trpc.scenarios.compareRuns.useQuery(
    { simulation_run_ids: selectedIds },
    { enabled: selectedIds.length >= 2, retry: false },
  );
  const payload = compareQuery.data
    ? unwrapApi<{ runs: AlignedRun[]; divergence: Divergence[] }>(compareQuery.data)
    : null;
  const meta = metaApi(compareQuery.data);

  const aligned = payload?.runs ?? [];
  const divergence = payload?.divergence ?? [];

  /* Group aligned runs by outcome metric → one chart panel per metric. */
  const panels = useMemo(() => {
    const byMetric = new Map<string, AlignedRun[]>();
    for (const r of aligned) {
      const key = r.metric;
      byMetric.set(key, [...(byMetric.get(key) ?? []), r]);
    }
    return [...byMetric.entries()].map(([metric, rs]) => ({
      metric,
      unit: rs[0]?.unit ?? "",
      runs: rs,
    }));
  }, [aligned]);

  const runById = useMemo(
    () => new Map(runs.map((r) => [r.simulationRunId, r])),
    [runs],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* ------------------------- Run picker ------------------------- */}
      <aside className="lg:col-span-3">
        <div className="rounded-md border border-ink-subtle bg-ink-surface p-3">
          <div className="flex items-center justify-between">
            <p className="caption-label text-ink-muted">Runs to compare</p>
            <span className="font-mono text-[11px] text-ink-muted">
              {selectedIds.length}/{MAX_RUNS}
            </span>
          </div>
          {succeeded.length === 0 ? (
            <p className="mt-2 text-xs text-ink-muted">
              No succeeded runs yet — queue a scenario from the Builder tab.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {succeeded.map((r) => {
                const on = selectedIds.includes(r.simulationRunId);
                const disabled = !on && selectedIds.length >= MAX_RUNS;
                return (
                  <li key={r.simulationRunId}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 transition-colors",
                        on
                          ? "border-civic/60 bg-civic/5"
                          : "border-ink-subtle hover:border-ink-strong",
                        disabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        onChange={() => toggle(r.simulationRunId)}
                        className="mt-0.5 accent-[#3FAE9E]"
                      />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-civic">
                          {shortRunId(r.simulationRunId)}
                          <span className="ml-1.5 text-ink-muted">seed {r.seed}</span>
                        </span>
                        <span className="block truncate text-[11px] text-ink-secondary">
                          {r.scenarioName} · {engineMeta(r.engine).name}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[10px] leading-4 text-ink-muted">
            Select 2–4 succeeded runs. Bands are 80% credible intervals aligned by
            month.
          </p>
        </div>
      </aside>

      {/* ------------------------- Panels ------------------------- */}
      <div className="space-y-4 lg:col-span-9">
        {selectedIds.length < 2 ? (
          <EmptyState
            Icon={GitCompareArrows}
            showSpotArt={false}
            title="Select at least two runs"
            guidance="Pick 2–4 succeeded runs on the left to overlay uncertainty bands and compute divergence."
          />
        ) : compareQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonCard metric={false} lines={4} />
            <SkeletonCard metric={false} lines={4} />
          </div>
        ) : compareQuery.isError ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
            <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {compareQuery.error instanceof Error
              ? compareQuery.error.message
              : "Compare failed — runs may still be in progress."}
          </p>
        ) : (
          <>
            <p className="font-mono text-[11px] text-ink-muted">
              request {meta?.request_id ?? "—"} · runs aligned on shared months
            </p>

            {/* Metric panels */}
            {panels.map((panel, i) => (
              <MetricPanel key={panel.metric} panel={panel} index={i} />
            ))}

            {/* Divergence summary cards */}
            {divergence.length > 0 && (
              <div>
                <h3 className="caption-label mb-2 text-ink-muted">Divergence analysis</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {[...divergence]
                    .sort((x, y) => y.mean_abs_gap - x.mean_abs_gap)
                    .map((d, i) => (
                      <DivergenceCard
                        key={`${d.a}:${d.b}`}
                        divergence={d}
                        index={i}
                        aligned={aligned}
                        runById={runById}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* Assumption diff table */}
            <AssumptionDiff
              selectedIds={selectedIds}
              runById={runById}
              assumptionSets={assumptionSets}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metric panel with data-table toggle                                 */
/* ------------------------------------------------------------------ */

function MetricPanel({
  panel,
  index,
}: {
  panel: { metric: string; unit: string; runs: AlignedRun[] };
  index: number;
}) {
  const [asTable, setAsTable] = useState(false);
  const months = panel.runs[0]?.series.map((p) => p.month) ?? [];
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1, ease: EASE }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize text-ink-primary">
          {panel.metric.replace(/_/g, " ")}
          <span className="ml-2 font-mono text-[11px] font-normal text-ink-muted">
            {panel.unit}
          </span>
        </h3>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-xs text-ink-secondary hover:border-ink-strong"
        >
          {asTable ? (
            <ChartLine aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <Table2 aria-hidden className="h-3.5 w-3.5" />
          )}
          {asTable ? "View as chart" : "View as data table"}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto rounded-md border border-ink-subtle bg-ink-surface">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-elevated">
              <tr className="border-b border-ink-strong">
                <th scope="col" className="caption-label px-3 py-2 text-ink-muted">Month</th>
                {panel.runs.map((r) => (
                  <th key={r.simulation_run_id} scope="col" className="caption-label px-3 py-2 text-right text-ink-muted">
                    {shortRunId(r.simulation_run_id)} mean (80% band)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m, mi) => (
                <tr key={m} className="border-b border-ink-subtle/60">
                  <td className="px-3 py-1.5 font-mono text-ink-secondary">M{m}</td>
                  {panel.runs.map((r) => {
                    const p = r.series[mi];
                    return (
                      <td key={r.simulation_run_id} className="px-3 py-1.5 text-right font-mono text-ink-primary">
                        {p ? formatNumber(p.mean) : "—"}
                        {p && (
                          <span className="block text-[10px] text-ink-muted">
                            {formatNumber(p.lower)}–{formatNumber(p.upper)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <UncertaintyBandChart
          compare
          yLabel={`${panel.metric.replace(/_/g, " ")} — overlaid runs with 80% bands`}
          series={panel.runs.map((r, i) => ({
            id: r.simulation_run_id,
            label: shortRunId(r.simulation_run_id),
            color: chartSeries[i % chartSeries.length],
            points: r.series.map((p) => ({
              x: `M${p.month}`,
              value: p.mean,
              lower: p.lower,
              upper: p.upper,
            })),
          }))}
        />
      )}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Divergence card + causal-diff explanation                           */
/* ------------------------------------------------------------------ */

function DivergenceCard({
  divergence: d,
  index,
  aligned,
  runById,
}: {
  divergence: Divergence;
  index: number;
  aligned: AlignedRun[];
  runById: Map<string, RunRow>;
}) {
  const [whyOpen, setWhyOpen] = useState(false);

  const runA = aligned.find((r) => r.simulation_run_id === d.a);
  const runB = aligned.find((r) => r.simulation_run_id === d.b);
  const pA = runA?.series.find((p) => p.month === d.max_gap_month);
  const pB = runB?.series.find((p) => p.month === d.max_gap_month);
  const overlap =
    pA && pB
      ? Math.max(
          0,
          Math.min(pA.upper, pB.upper) - Math.max(pA.lower, pB.lower),
        ) / Math.max(1, Math.max(pA.upper, pB.upper) - Math.min(pA.lower, pB.lower))
      : 0;

  const fullA = runById.get(d.a);
  const fullB = runById.get(d.b);
  const leversA = (fullA?.executionProfile?.levers ?? {}) as Record<string, unknown>;
  const leversB = (fullB?.executionProfile?.levers ?? {}) as Record<string, unknown>;
  const leverKeys = [...new Set([...Object.keys(leversA), ...Object.keys(leversB)])];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06, ease: EASE }}
      className="rounded-md border border-ink-subtle bg-ink-surface p-3"
    >
      <p className="text-[13px] leading-5 text-ink-primary">
        Largest divergence at{" "}
        <span className="font-mono text-civic">Month {d.max_gap_month}</span>:{" "}
        {shortRunId(d.a)} vs {shortRunId(d.b)} —{" "}
        <span className="font-mono">{formatNumber(d.mean_abs_gap)}</span>{" "}
        {runA?.unit ?? "units"} mean gap
        <span className="text-ink-muted"> (band overlap {Math.round(overlap * 100)}%)</span>
      </p>
      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        aria-expanded={whyOpen}
        className="mt-2 inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-xs text-ink-secondary hover:border-civic/50 hover:text-civic"
      >
        <HelpCircle aria-hidden className="h-3.5 w-3.5" />
        Why?
      </button>
      {whyOpen && (
        <div className="mt-2 rounded-md border border-ink-subtle bg-ink-inset p-2.5">
          <p className="text-xs leading-5 text-ink-secondary">
            {shortRunId(d.a)} ran <strong className="text-ink-primary">{engineMeta(fullA?.engine ?? "").name}</strong>{" "}
            (seed {fullA?.seed ?? "?"}) against{" "}
            <strong className="text-ink-primary">{engineMeta(fullB?.engine ?? "").name}</strong>{" "}
            (seed {fullB?.seed ?? "?"}).
            {overlap < 0.5
              ? " Bands overlap less than half at the widest point — the gap is driven by structural engine and lever differences, not just sampling noise."
              : " Bands still overlap materially — part of the gap is consistent with sampling uncertainty."}
          </p>
          <table className="mt-2 w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-ink-subtle">
                <th scope="col" className="caption-label py-1 pr-2 text-ink-muted">Parameter</th>
                <th scope="col" className="caption-label py-1 pr-2 text-right text-ink-muted">{shortRunId(d.a)}</th>
                <th scope="col" className="caption-label py-1 text-right text-ink-muted">{shortRunId(d.b)}</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <tr className="border-b border-ink-subtle/50">
                <td className="py-1 pr-2 text-ink-secondary">engine</td>
                <td className="py-1 pr-2 text-right text-ink-primary">{fullA?.engine ?? "—"}</td>
                <td className="py-1 text-right text-ink-primary">{fullB?.engine ?? "—"}</td>
              </tr>
              <tr className="border-b border-ink-subtle/50">
                <td className="py-1 pr-2 text-ink-secondary">seed</td>
                <td className="py-1 pr-2 text-right text-ink-primary">{fullA?.seed ?? "—"}</td>
                <td className="py-1 text-right text-ink-primary">{fullB?.seed ?? "—"}</td>
              </tr>
              {leverKeys.map((k) => {
                const va = leversA[k];
                const vb = leversB[k];
                const differs = String(va ?? "—") !== String(vb ?? "—");
                return (
                  <tr key={k} className="border-b border-ink-subtle/50">
                    <td className="py-1 pr-2 text-ink-secondary">{k}</td>
                    <td className={cn("py-1 pr-2 text-right", differs ? "text-status-warning" : "text-ink-primary")}>
                      {String(va ?? "—")}
                    </td>
                    <td className={cn("py-1 text-right", differs ? "text-status-warning" : "text-ink-primary")}>
                      {String(vb ?? "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Assumption diff table (rows = assumptions, columns = runs)          */
/* ------------------------------------------------------------------ */

function AssumptionDiff({
  selectedIds,
  runById,
  assumptionSets,
}: {
  selectedIds: string[];
  runById: Map<string, RunRow>;
  assumptionSets: AssumptionSetLite[];
}) {
  const rows = useMemo(() => {
    const setByRun = selectedIds.map((id) => {
      const run = runById.get(id);
      return assumptionSets.find((s) => s.assumptionsSetId === run?.assumptionsSetId);
    });
    const keys = new Map<string, { label: string; unit?: string }>();
    setByRun.forEach((s) =>
      s?.entries.forEach((e) => keys.set(e.key, { label: e.label, unit: e.unit })),
    );
    return [...keys.entries()].map(([key, info]) => ({
      key,
      ...info,
      values: setByRun.map(
        (s) => s?.entries.find((e) => e.key === key)?.value ?? null,
      ),
    }));
  }, [selectedIds, runById, assumptionSets]);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        No registry assumption sets attached to the selected scenarios.
      </p>
    );
  }

  return (
    <section>
      <h3 className="caption-label mb-2 text-ink-muted">Assumption diff</h3>
      <div className="overflow-x-auto rounded-md border border-ink-subtle bg-ink-surface">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-ink-strong">
              <th scope="col" className="caption-label px-3 py-2 text-ink-muted">Assumption</th>
              {selectedIds.map((id) => (
                <th key={id} scope="col" className="caption-label px-3 py-2 text-right text-ink-muted">
                  {shortRunId(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const allSame = row.values.every(
                (v) => String(v ?? "—") === String(row.values[0] ?? "—"),
              );
              return (
                <tr key={row.key} className="border-b border-ink-subtle/60">
                  <td className="px-3 py-2 text-ink-secondary">
                    {row.label}
                    {row.unit && (
                      <span className="ml-1 font-mono text-[10px] text-ink-muted">({row.unit})</span>
                    )}
                  </td>
                  {row.values.map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-3 py-2 text-right font-mono",
                        allSame ? "text-ink-primary" : "text-status-warning",
                      )}
                    >
                      {v == null ? "—" : String(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-ink-muted">
        Amber cells differ across runs — these deltas explain most outcome divergence.
      </p>
    </section>
  );
}
