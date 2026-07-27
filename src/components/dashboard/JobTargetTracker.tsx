import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Table2, ChartLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { chartSeries } from "@/lib/theme";
import {
  HORIZON_MONTHS,
  JOBS_TARGET,
  deltaAt,
  deltaBandAt,
  finalDelta,
  fmtDate,
  fmtInt,
  fmtSigned,
  monthQuarterLabel,
  type RunResultLike,
} from "./utils";

export interface TrackerRun {
  scenarioId: string;
  scenarioName: string;
  engine: string;
  seed?: number | null;
  finishedAt?: Date | string | null;
  result: RunResultLike;
}

export interface JobTargetTrackerProps {
  runs: TrackerRun[];
  /** "Today" as months since Jan 2024 (today-marker gold line). */
  currentMonth: number;
  className?: string;
}

const SCENARIO_LABELS = ["Conservative", "Base", "Accelerated"];
const SCENARIO_COLORS = ["#6C8BD4", "#3FAE9E", "#C9A24B"];

interface RankedRun extends TrackerRun {
  rankLabel: string;
  color: string;
}

/**
 * "Path to 250,000 jobs by 2027" — milestone timeline 2024→2027 with the
 * cumulative portfolio line, three dashed scenario projections, an 80%
 * uncertainty band on the Base scenario and a gold today-marker.
 */
export default function JobTargetTracker({
  runs,
  currentMonth,
  className,
}: JobTargetTrackerProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [asTable, setAsTable] = useState(false);

  // Rank scenarios by final projected delta → Conservative / Base / Accelerated.
  const ranked: RankedRun[] = useMemo(() => {
    const sorted = [...runs].sort(
      (a, b) => finalDelta(a.result) - finalDelta(b.result),
    );
    return sorted.map((r, i) => ({
      ...r,
      rankLabel:
        SCENARIO_LABELS[i] ??
        `Scenario ${i + 1}`,
      color: SCENARIO_COLORS[i] ?? chartSeries[(i + 3) % chartSeries.length],
    }));
  }, [runs]);

  const base = ranked.find((r) => r.rankLabel === "Base") ?? ranked[0];
  const visible = ranked.filter((r) => !hidden.has(r.scenarioId));
  const showBand = base && visible.some((r) => r.scenarioId === base.scenarioId);

  const rows = useMemo(() => {
    const out: Record<string, number | string | null>[] = [];
    for (let m = 0; m <= HORIZON_MONTHS; m += 3) {
      const row: Record<string, number | string | null> = {
        x: monthQuarterLabel(m),
      };
      // Portfolio actual/committed line stops at the today-marker.
      row.portfolio =
        m <= currentMonth
          ? ranked.reduce((sum, r) => sum + deltaAt(r.result, m), 0)
          : null;
      for (const r of ranked) {
        row[`${r.scenarioId}__delta`] = deltaAt(r.result, m);
        if (base && r.scenarioId === base.scenarioId) {
          const band = deltaBandAt(r.result, m);
          row.base__lower = band.low;
          row.base__band = Math.max(band.high - band.low, 0);
        }
      }
      out.push(row);
    }
    return out;
  }, [ranked, base, currentMonth]);

  const todayLabel = monthQuarterLabel(currentMonth);
  const lastRun = ranked
    .map((r) => r.finishedAt)
    .filter((d): d is Date | string => !!d)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
      aria-labelledby="tracker-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tracker-title" className="text-lg font-semibold text-ink-primary">
          Path to {fmtInt(JOBS_TARGET)} jobs by 2027
        </h2>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-2 py-1 text-xs font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
        >
          {asTable ? (
            <ChartLine aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <Table2 aria-hidden className="h-3.5 w-3.5" />
          )}
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>

      {/* Scenario visibility toggle chips */}
      <div
        role="group"
        aria-label="Toggle scenario projections"
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {ranked.map((r) => {
          const on = !hidden.has(r.scenarioId);
          return (
            <button
              key={r.scenarioId}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(r.scenarioId)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors duration-200",
                on
                  ? "border-ink-strong text-ink-primary"
                  : "border-ink-subtle text-ink-muted",
              )}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: on ? r.color : "#2C3F63" }}
              />
              {r.rankLabel}
              <span className="font-mono text-[10px] text-ink-muted">
                {fmtSigned(finalDelta(r.result))}
              </span>
            </button>
          );
        })}
      </div>

      {asTable ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">
              Cumulative projected jobs per scenario by quarter
            </caption>
            <thead>
              <tr className="border-b border-ink-strong text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Quarter</th>
                <th scope="col" className="py-2 pr-3 font-medium">Portfolio</th>
                {visible.map((r) => (
                  <th key={r.scenarioId} scope="col" className="py-2 pr-3 font-medium">
                    {r.rankLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.x)} className="border-b border-ink-subtle/60">
                  <td className="py-1.5 pr-3 font-mono text-ink-secondary">
                    {row.x}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink-primary">
                    {row.portfolio == null ? "—" : fmtInt(row.portfolio as number)}
                  </td>
                  {visible.map((r) => (
                    <td
                      key={r.scenarioId}
                      className="py-1.5 pr-3 font-mono text-ink-secondary"
                    >
                      {fmtInt(row[`${r.scenarioId}__delta`] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="mt-3"
          style={{ height: 300 }}
          role="img"
          aria-label="Cumulative jobs projection with uncertainty band on the Base scenario"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            >
              <CartesianGrid stroke="#1E2C47" strokeOpacity={0.5} vertical={false} />
              <XAxis
                dataKey="x"
                tick={{
                  fill: "#5E6D87",
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
                stroke="#1E2C47"
                tickLine={false}
                interval={1}
              />
              <YAxis
                tickFormatter={(v: number) => fmtInt(v)}
                tick={{
                  fill: "#5E6D87",
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
                stroke="#1E2C47"
                tickLine={false}
                width={64}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#16233C",
                  border: "1px solid #1E2C47",
                  borderRadius: 6,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                }}
                labelStyle={{ color: "#E6ECF5" }}
                itemStyle={{ color: "#9AA8BF" }}
                formatter={(v: number | string, name: string) => {
                  if (typeof v !== "number") return ["—", name];
                  const scenario = ranked.find(
                    (r) => name === `${r.scenarioId}__delta`,
                  );
                  const label = scenario
                    ? scenario.rankLabel
                    : name === "portfolio"
                      ? "Portfolio (actual)"
                      : name;
                  return [fmtInt(v), label];
                }}
              />
              <ReferenceLine
                y={JOBS_TARGET}
                stroke="#5E6D87"
                strokeDasharray="3 4"
                label={{
                  value: `Target ${fmtInt(JOBS_TARGET)}`,
                  position: "insideTopRight",
                  fill: "#9AA8BF",
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              />
              <ReferenceLine
                x={todayLabel}
                stroke="#C9A24B"
                strokeWidth={1.5}
                label={{
                  value: "Today",
                  position: "insideTopLeft",
                  fill: "#C9A24B",
                  fontSize: 11,
                }}
              />
              {showBand && (
                <>
                  <Area
                    type="monotone"
                    dataKey="base__lower"
                    stackId="base-band"
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={!reduced}
                    animationDuration={700}
                    legendType="none"
                    tooltipType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="base__band"
                    stackId="base-band"
                    stroke={base.color}
                    strokeDasharray="4 3"
                    strokeWidth={1}
                    fill={base.color}
                    fillOpacity={0.12}
                    isAnimationActive={!reduced}
                    animationDuration={700}
                    animationBegin={150}
                    legendType="none"
                    tooltipType="none"
                  />
                </>
              )}
              {visible.map((r) => (
                <Line
                  key={r.scenarioId}
                  type="monotone"
                  dataKey={`${r.scenarioId}__delta`}
                  name={`${r.scenarioId}__delta`}
                  stroke={r.color}
                  strokeWidth={1.75}
                  strokeDasharray="6 4"
                  dot={false}
                  isAnimationActive={!reduced}
                  animationDuration={700}
                />
              ))}
              <Line
                type="monotone"
                dataKey="portfolio"
                name="portfolio"
                stroke="#3FAE9E"
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={!reduced}
                animationDuration={700}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mt-1 text-[11px] text-ink-muted">
        Shaded band: 80% credible interval on the Base scenario (dashed bounds).
        Solid line: committed portfolio to date.
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-subtle pt-3">
        <p className="font-mono text-xs text-ink-muted">
          Last simulation run: {fmtDate(lastRun)}
          {base ? ` · Engine ${base.engine.replace(/_/g, " ")}` : ""}
          {base?.seed != null ? ` · Seed ${base.seed}` : ""}
        </p>
        <Link
          to="/simulation"
          className="text-xs font-medium text-civic hover:text-civic-strong"
        >
          Open in Simulation Studio →
        </Link>
      </div>
    </section>
  );
}
