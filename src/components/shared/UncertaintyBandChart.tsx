import { Fragment, useMemo, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { chartSeries } from "@/lib/theme";

export interface BandPoint {
  /** X label (year, month, etc.). */
  x: string;
  /** Central estimate. */
  value: number;
  /** 80% credible interval lower bound. */
  lower: number;
  /** 80% credible interval upper bound. */
  upper: number;
}

export interface BandSeries {
  id: string;
  label: string;
  color?: string;
  points: BandPoint[];
}

export interface UncertaintyBandChartProps {
  series: BandSeries[];
  yLabel?: string;
  formatValue?: (n: number) => string;
  height?: number;
  /** Show compare toggle when multiple series are present. */
  compare?: boolean;
  className?: string;
}

const defaultFmt = (n: number) => n.toLocaleString("en-NG");

/** Line chart with 80% credible-interval band (12% opacity fill, dashed
 *  1px bounds), mono readouts, run compare toggle. */
export default function UncertaintyBandChart({
  series,
  yLabel,
  formatValue = defaultFmt,
  height = 280,
  compare = false,
  className,
}: UncertaintyBandChartProps) {
  const [activeIds, setActiveIds] = useState<string[]>(
    series.slice(0, 1).map((s) => s.id),
  );

  const rows = useMemo(() => {
    const map = new Map<string, Record<string, string | number>>();
    for (const s of series.filter((s) => activeIds.includes(s.id))) {
      for (const p of s.points) {
        const row = map.get(p.x) ?? { x: p.x };
        row[`${s.id}__value`] = p.value;
        row[`${s.id}__lower`] = p.lower;
        // Stacked-area trick: band height = upper - lower
        row[`${s.id}__band`] = Math.max(p.upper - p.lower, 0);
        map.set(p.x, row);
      }
    }
    return [...map.values()];
  }, [series, activeIds]);

  const active = series.filter((s) => activeIds.includes(s.id));

  return (
    <figure
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-3",
        className,
      )}
    >
      {(yLabel || (compare && series.length > 1)) && (
        <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="caption-label text-ink-muted">{yLabel}</span>
          {compare && series.length > 1 && (
            <div role="group" aria-label="Compare runs" className="flex gap-1.5">
              {series.map((s, i) => {
                const color = s.color ?? chartSeries[i % chartSeries.length];
                const on = activeIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setActiveIds((ids) =>
                        on
                          ? ids.filter((x) => x !== s.id)
                          : [...ids, s.id],
                      )
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
                      on
                        ? "border-ink-strong text-ink-primary"
                        : "border-ink-subtle text-ink-muted",
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: on ? color : "#2C3F63" }}
                    />
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </figcaption>
      )}
      <div style={{ height }} role="img" aria-label={yLabel ?? "Forecast chart with uncertainty band"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="#1E2C47" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="x"
              tick={{ fill: "#5E6D87", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}
              stroke="#1E2C47"
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => formatValue(v)}
              tick={{ fill: "#5E6D87", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}
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
              formatter={(v: number | string, name: string) => [
                typeof v === "number" ? formatValue(v) : v,
                String(name).replace(/__(value|lower|band)$/, ""),
              ]}
            />
            {active.map((s, i) => {
              const color = s.color ?? chartSeries[i % chartSeries.length];
              return (
                <Fragment key={s.id}>
                  <Area
                    type="monotone"
                    dataKey={`${s.id}__lower`}
                    stackId={`band-${s.id}`}
                    stroke="none"
                    fill="transparent"
                    isAnimationActive
                    animationDuration={600}
                    legendType="none"
                    tooltipType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey={`${s.id}__band`}
                    stackId={`band-${s.id}`}
                    stroke={color}
                    strokeDasharray="4 3"
                    strokeWidth={1}
                    fill={color}
                    fillOpacity={0.12}
                    animationDuration={600}
                    legendType="none"
                    tooltipType="none"
                  />
                  <Line
                    type="monotone"
                    dataKey={`${s.id}__value`}
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    animationDuration={600}
                  />
                </Fragment>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">
        Shaded band: 80% credible interval (dashed bounds).
      </p>
    </figure>
  );
}
