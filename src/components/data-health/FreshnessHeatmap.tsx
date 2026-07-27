import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Table2, Grid3X3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { hashSeed, seededRandom } from "@/components/briefs/brief-utils";
import type { DataSourceRow } from "./health-utils";

type CellStatus = "success" | "late" | "missed";

interface Cell {
  day: number; // 0 = today … 29
  status: CellStatus;
  rows: number;
}

interface HeatRow {
  source: DataSourceRow;
  cells: Cell[];
  summary: { success: number; late: number; missed: number };
}

const DAYS = 30;

/** Deterministic per-source/day ingestion status, weighted by source health. */
function buildRows(sources: DataSourceRow[], days: number): HeatRow[] {
  return sources.slice(0, 20).map((source) => {
    const rand = seededRandom(hashSeed(`heat:${source.sourceId}`));
    const pSuccess = source.health === "healthy" ? 0.9 : source.health === "stale" ? 0.55 : 0.2;
    const pLate = source.health === "healthy" ? 0.08 : source.health === "stale" ? 0.3 : 0.3;
    const cells: Cell[] = Array.from({ length: days }, (_, day) => {
      let status: CellStatus;
      if (day === source.freshnessDays) {
        status = "success"; // the recorded refresh
      } else if (day < source.freshnessDays && source.health !== "healthy") {
        status = "missed"; // gap since last successful refresh
      } else {
        const r = rand();
        status = r < pSuccess ? "success" : r < pSuccess + pLate ? "late" : "missed";
      }
      return {
        day,
        status,
        rows: status === "missed" ? 0 : 400 + Math.floor(rand() * 2600),
      };
    });
    return {
      source,
      cells,
      summary: {
        success: cells.filter((c) => c.status === "success").length,
        late: cells.filter((c) => c.status === "late").length,
        missed: cells.filter((c) => c.status === "missed").length,
      },
    };
  });
}

const CELL_FILL: Record<CellStatus, string> = {
  success: "#3FAE9E",
  late: "url(#dh-hatch-late)",
  missed: "url(#dh-hatch-missed)",
};

const CELL_LABEL: Record<CellStatus, string> = {
  success: "sync succeeded",
  late: "sync late",
  missed: "sync missed",
};

function defaultTableView(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return Boolean(conn?.saveData || conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g");
}

export interface FreshnessHeatmapProps {
  sources: DataSourceRow[];
  days?: number;
}

export default function FreshnessHeatmap({ sources, days = DAYS }: FreshnessHeatmapProps) {
  const rows = useMemo(() => buildRows(sources, days), [sources, days]);
  const [tableView, setTableView] = useState(defaultTableView);
  const [hover, setHover] = useState<{ row: HeatRow; cell: Cell; x: number; y: number } | null>(null);

  const dayLabels = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: days }, (_, d) => {
      const date = new Date(now - d * 86400000);
      return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    }).reverse(); // oldest first (left)
  }, [days]);

  if (rows.length === 0) return null;

  return (
    <section
      aria-label="Freshness heatmap — last 30 days"
      className="rounded-md border border-ink-subtle bg-ink-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-subtle px-3 py-2">
        <p className="caption-label text-ink-muted">Freshness heatmap · last {days} days</p>
        <div className="flex items-center gap-2">
          {/* Pattern legend — never color-only */}
          <span className="hidden items-center gap-3 sm:flex" role="list" aria-label="Cell legend">
            <LegendSwatch fill="#3FAE9E" label="On time" />
            <LegendSwatch fill="url(#dh-hatch-late)" label="Late" />
            <LegendSwatch fill="url(#dh-hatch-missed)" label="Missed" />
          </span>
          <button
            type="button"
            onClick={() => setTableView((v) => !v)}
            aria-pressed={tableView}
            className="inline-flex items-center gap-1.5 rounded border border-ink-subtle px-2 py-1 text-xs text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
          >
            {tableView ? (
              <Grid3X3 aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <Table2 aria-hidden className="h-3.5 w-3.5" />
            )}
            {tableView ? "View as grid" : "View as table"}
          </button>
        </div>
      </div>

      {/* Shared hatch patterns */}
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <pattern id="dh-hatch-late" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#D9A441" opacity="0.55" />
            <circle cx="3" cy="3" r="1.1" fill="#0B1220" />
          </pattern>
          <pattern id="dh-hatch-missed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#D9635F" opacity="0.45" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#0B1220" strokeWidth="1.6" />
          </pattern>
        </defs>
      </svg>

      {tableView ? (
        /* Low-bandwidth text summary */
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] leading-5">
            <thead>
              <tr className="border-b border-ink-strong">
                {["Source", "On time", "Late", "Missed", "Reliability"].map((h) => (
                  <th key={h} scope="col" className="caption-label whitespace-nowrap px-3 py-2 text-ink-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = Math.round((r.summary.success / days) * 100);
                return (
                  <tr key={r.source.sourceId} className="border-b border-ink-subtle/60">
                    <td className="max-w-[260px] truncate px-3 py-2 font-medium text-ink-primary">
                      {r.source.name}
                    </td>
                    <td className="px-3 py-2 font-mono text-status-success">{r.summary.success}</td>
                    <td className="px-3 py-2 font-mono text-status-warning">{r.summary.late}</td>
                    <td className="px-3 py-2 font-mono text-status-danger">{r.summary.missed}</td>
                    <td className="px-3 py-2 font-mono text-ink-primary">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {/* Desktop grid */}
          <div className="relative hidden overflow-x-auto p-3 md:block">
            <div className="min-w-[860px]">
              {/* Day header */}
              <div className="flex">
                <div className="w-52 shrink-0" />
                <div className="flex flex-1 gap-[2px]">
                  {dayLabels.map((l, i) =>
                    i % 5 === 0 ? (
                      <span key={i} className="flex-1 font-mono text-[9px] text-ink-muted">
                        {l}
                      </span>
                    ) : (
                      <span key={i} className="flex-1" />
                    ),
                  )}
                </div>
              </div>
              {rows.map((r, ri) => (
                <motion.div
                  key={r.source.sourceId}
                  className="mt-1 flex items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: ri * 0.02 }}
                >
                  <p className="w-52 shrink-0 truncate pr-2 text-xs text-ink-secondary" title={r.source.name}>
                    {r.source.name}
                  </p>
                  <div className="flex flex-1 gap-[2px]">
                    {[...r.cells].reverse().map((cell) => (
                      <button
                        key={cell.day}
                        type="button"
                        aria-label={`${r.source.name} · ${dayLabels[days - 1 - cell.day]} · ${CELL_LABEL[cell.status]} · ${cell.rows.toLocaleString()} rows`}
                        onMouseEnter={(e) => {
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          const parent = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                          setHover({
                            row: r,
                            cell,
                            x: rect.left - (parent?.left ?? 0) + rect.width / 2,
                            y: rect.top - (parent?.top ?? 0),
                          });
                        }}
                        onMouseLeave={() => setHover(null)}
                        onFocus={(e) => {
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          const parent = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                          setHover({
                            row: r,
                            cell,
                            x: rect.left - (parent?.left ?? 0) + rect.width / 2,
                            y: rect.top - (parent?.top ?? 0),
                          });
                        }}
                        onBlur={() => setHover(null)}
                        className="h-4 flex-1 rounded-[2px] transition-transform hover:scale-110"
                        style={{
                          background:
                            cell.status === "success"
                              ? CELL_FILL.success
                              : cell.status === "late"
                                ? "repeating-linear-gradient(0deg, rgba(217,164,65,0.55) 0 2px, transparent 2px 4px), #D9A44155"
                                : "repeating-linear-gradient(45deg, rgba(217,99,95,0.5) 0 2px, transparent 2px 5px)",
                          backgroundColor:
                            cell.status === "late"
                              ? "rgba(217,164,65,0.4)"
                              : cell.status === "missed"
                                ? "rgba(217,99,95,0.35)"
                                : undefined,
                          opacity: cell.status === "success" ? 0.35 + 0.65 * Math.min(1, cell.rows / 2600) : 1,
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Tooltip */}
            {hover && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-ink-strong bg-ink-elevated px-2.5 py-1.5 text-[11px] shadow-overlay"
                style={{ left: hover.x, top: hover.y - 6 }}
              >
                <p className="font-medium text-ink-primary">{hover.row.source.name}</p>
                <p className="text-ink-secondary">
                  {dayLabels[days - 1 - hover.cell.day]} · {CELL_LABEL[hover.cell.status]} ·{" "}
                  <span className="font-mono">{hover.cell.rows.toLocaleString()}</span> rows
                </p>
              </div>
            )}
          </div>

          {/* Mobile: last-7-days status rows */}
          <ul className="divide-y divide-ink-subtle/60 p-3 md:hidden">
            {rows.map((r) => (
              <li key={r.source.sourceId} className="py-2">
                <p className="truncate text-xs font-medium text-ink-primary">{r.source.name}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {r.cells.slice(0, 7).map((c) => (
                    <span
                      key={c.day}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[9px]",
                        c.status === "success"
                          ? "border-status-success/40 text-status-success"
                          : c.status === "late"
                            ? "border-status-warning/40 text-status-warning"
                            : "border-status-danger/40 text-status-danger",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          c.status === "success"
                            ? "bg-status-success"
                            : c.status === "late"
                              ? "bg-status-warning"
                              : "bg-status-danger",
                        )}
                      />
                      {dayLabels[days - 1 - c.day]} · {c.status}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LegendSwatch({ fill, label }: { fill: string; label: string }) {
  const isPattern = fill.startsWith("url(");
  return (
    <span className="inline-flex items-center gap-1.5" role="listitem">
      {isPattern ? (
        <svg width="12" height="12" aria-hidden>
          <rect width="12" height="12" rx="2" fill={fill} />
        </svg>
      ) : (
        <span aria-hidden className="h-3 w-3 rounded-[2px]" style={{ background: fill }} />
      )}
      <span className="text-[11px] text-ink-secondary">{label}</span>
    </span>
  );
}
