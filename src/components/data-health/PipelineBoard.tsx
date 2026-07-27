import { Fragment, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  ClipboardPlus,
  Database,
  Globe,
  Play,
  RotateCcw,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import StatusDot, { type StatusKind } from "@/components/shared/StatusDot";
import { hashSeed } from "@/components/briefs/brief-utils";
import {
  durationLabel,
  relativeTime,
  slaStatus,
  slaWindowDays,
  type DataSourceRow,
  type PipelineRunRow,
} from "./health-utils";

export interface PipelineRow {
  id: string;
  source: DataSourceRow;
  latestRun: PipelineRunRow | null;
  status: StatusKind;
  running: boolean;
}

const DAG_STEPS = ["Ingest", "Parse", "Transform", "Materialize", "Index"] as const;

/** DAG mini-view: failed node highlighted, nodes light up to the failure point. */
function DagMiniView({ failedAt }: { failedAt: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Pipeline DAG">
      {DAG_STEPS.map((step, i) => {
        const failed = i === failedAt;
        const passed = i < failedAt;
        return (
          <li key={step} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="text-ink-muted">→</span>}
            <motion.span
              initial={{ opacity: 0.2 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.08, duration: 0.2 }}
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                failed
                  ? "border-status-danger bg-status-danger/15 text-status-danger"
                  : passed
                    ? "border-status-success/50 bg-status-success/10 text-status-success"
                    : "border-ink-subtle text-ink-muted",
              )}
            >
              {step}
              {failed && " ✕"}
            </motion.span>
          </li>
        );
      })}
    </ol>
  );
}

/** Freshness SLA bar: green within / amber approaching / red breached + text. */
function SlaBar({ source }: { source: DataSourceRow }) {
  const status = slaStatus(source.freshnessDays, source.refreshCadence);
  const window = slaWindowDays(source.refreshCadence);
  const pct = Math.min(100, (source.freshnessDays / (window * 2)) * 100);
  const meta = {
    within: { label: "Within SLA", bar: "bg-status-success", text: "text-status-success" },
    approaching: { label: "Approaching SLA", bar: "bg-status-warning", text: "text-status-warning" },
    breached: { label: "SLA breached", bar: "bg-status-danger", text: "text-status-danger" },
  }[status];
  return (
    <div className="min-w-[120px]">
      <div
        role="meter"
        aria-valuenow={source.freshnessDays}
        aria-valuemin={0}
        aria-valuemax={window * 2}
        aria-label={`Freshness SLA: ${meta.label}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-inset"
      >
        <div className={cn("h-full rounded-full", meta.bar)} style={{ width: `${Math.max(6, pct)}%` }} />
      </div>
      <p className={cn("mt-1 text-[11px] font-medium", meta.text)}>
        {meta.label} · {source.freshnessDays}d of {window}d
      </p>
    </div>
  );
}

export interface PipelineBoardProps {
  rows: PipelineRow[];
  onViewRuns: (sourceId: string) => void;
  onReRun: (row: PipelineRow) => void;
  onCreateTriage: (row: PipelineRow) => void;
}

export default function PipelineBoard({
  rows,
  onViewRuns,
  onReRun,
  onCreateTriage,
}: PipelineBoardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [logsFor, setLogsFor] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onRowKey = (e: React.KeyboardEvent, row: PipelineRow) => {
    const k = e.key.toLowerCase();
    if (k === "r") {
      e.preventDefault();
      onReRun(row);
    } else if (k === "t") {
      e.preventDefault();
      onCreateTriage(row);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-ink-subtle bg-ink-surface" id="pipeline-board">
      <div className="flex items-center justify-between border-b border-ink-subtle px-3 py-2">
        <p className="caption-label text-ink-muted">Pipelines</p>
        <p className="font-mono text-[10px] text-ink-muted">
          R re-run · T triage task (focused row)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] leading-5">
          <thead>
            <tr className="border-b border-ink-strong">
              <th scope="col" className="w-8 px-2 py-2" />
              {["Pipeline", "Owner", "Last run", "Schedule", "Duration", "Status", "Freshness SLA", "Actions"].map(
                (h) => (
                  <th key={h} scope="col" className="caption-label whitespace-nowrap px-3 py-2 text-ink-muted">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const failed = row.latestRun?.status === "failed" || row.source.health === "failing";
              const isOpen = expanded.has(row.id);
              const failedStep = hashSeed(row.latestRun?.pipelineId ?? row.id) % DAG_STEPS.length;
              return (
                <Fragment key={row.id}>
                  <motion.tr
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.45) }}
                    tabIndex={0}
                    onKeyDown={(e) => onRowKey(e, row)}
                    className={cn(
                      "border-b border-ink-subtle/60 transition-colors hover:bg-ink-elevated focus:bg-ink-elevated",
                      isOpen && "bg-ink-elevated",
                      failed && "border-l-2 border-l-status-danger",
                    )}
                  >
                    <td className="px-2 py-2">
                      {failed && (
                        <button
                          type="button"
                          onClick={() => toggle(row.id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Collapse error detail" : "Expand error detail"}
                          className="rounded p-0.5 text-ink-muted hover:text-ink-primary"
                        >
                          {isOpen ? (
                            <ChevronDown aria-hidden className="h-4 w-4" />
                          ) : (
                            <ChevronRight aria-hidden className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        {row.source.accessMethod === "api" ? (
                          <Globe aria-hidden className="h-4 w-4 shrink-0 text-civic" />
                        ) : (
                          <Database aria-hidden className="h-4 w-4 shrink-0 text-civic-periwinkle" />
                        )}
                        <span>
                          <span className="block max-w-[220px] truncate font-medium text-ink-primary">
                            {row.source.name}
                          </span>
                          <span className="block text-[11px] text-ink-muted">
                            {row.source.accessMethod ?? "batch"} sync
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">{row.source.owner ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-secondary">
                      {relativeTime(row.latestRun?.startedAt ?? row.source.lastRefresh)}
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">{row.source.refreshCadence ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-secondary">
                      {row.latestRun ? durationLabel(row.latestRun) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusDot status={row.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <SlaBar source={row.source} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onViewRuns(row.source.sourceId)}
                          className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
                        >
                          <ScrollText aria-hidden className="h-3 w-3" />
                          View runs
                        </button>
                        <button
                          type="button"
                          onClick={() => onReRun(row)}
                          className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-[11px] text-ink-secondary hover:border-civic/60 hover:text-civic"
                        >
                          <RotateCcw aria-hidden className="h-3 w-3" />
                          Re-run
                        </button>
                      </span>
                    </td>
                  </motion.tr>
                  <AnimatePresence>
                    {failed && isOpen && (
                      <tr key={`${row.id}-detail`}>
                        <td colSpan={9} className="border-b border-ink-subtle/60 bg-ink-inset/60 p-0">
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-3 px-4 py-3">
                              <div>
                                <p className="caption-label text-status-danger">Failure detail</p>
                                <pre className="mt-1.5 overflow-x-auto rounded-md border border-status-danger/30 bg-ink-inset p-2.5 font-mono text-xs leading-5 text-status-danger">
                                  {row.latestRun?.error ??
                                    `Pipeline health is failing — last run ${
                                      row.latestRun ? row.latestRun.status : "not recorded"
                                    }. No error payload captured.`}
                                </pre>
                              </div>
                              <div>
                                <p className="caption-label text-ink-muted">Failed step</p>
                                <div className="mt-1.5">
                                  <DagMiniView failedAt={failedStep} />
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setLogsFor(logsFor === row.id ? null : row.id)}
                                  className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
                                >
                                  <ScrollText aria-hidden className="h-3 w-3" />
                                  {logsFor === row.id ? "Hide logs" : "Open logs"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onCreateTriage(row)}
                                  className="inline-flex items-center gap-1 rounded border border-status-warning/40 px-2 py-1 text-[11px] font-medium text-status-warning hover:bg-status-warning/10"
                                >
                                  <ClipboardPlus aria-hidden className="h-3 w-3" />
                                  Create triage task
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onReRun(row)}
                                  className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-[11px] text-ink-secondary hover:border-civic/60 hover:text-civic"
                                >
                                  <Play aria-hidden className="h-3 w-3" />
                                  Re-run pipeline
                                </button>
                              </div>
                              {logsFor === row.id && (
                                <pre className="overflow-x-auto rounded-md border border-ink-subtle bg-ink-inset p-2.5 font-mono text-[11px] leading-5 text-ink-secondary">
{`run_id      ${row.latestRun?.pipelineId ?? "—"}
source_id   ${row.source.sourceId}
status      ${row.latestRun?.status ?? row.source.health}
started     ${row.latestRun?.startedAt ? new Date(row.latestRun.startedAt).toISOString() : "—"}
finished    ${row.latestRun?.finishedAt ? new Date(row.latestRun.finishedAt).toISOString() : "—"}
rows        ${row.latestRun?.rowsProcessed ?? 0}
error       ${row.latestRun?.error ?? "none captured"}`}
                                </pre>
                              )}
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[13px] text-ink-muted">
                  No pipelines registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Join sources with their latest run to build board rows. */
export function buildPipelineRows(
  sources: DataSourceRow[],
  runs: PipelineRunRow[],
  runningSourceIds?: Set<string>,
): PipelineRow[] {
  const latest = new Map<string, PipelineRunRow>();
  for (const run of runs) {
    const prev = latest.get(run.sourceId);
    if (!prev || new Date(run.createdAt) > new Date(prev.createdAt)) latest.set(run.sourceId, run);
  }
  return sources.map((source) => {
    const run = latest.get(source.sourceId) ?? null;
    const running = runningSourceIds?.has(source.sourceId) || run?.status === "running";
    let status: StatusKind;
    if (running) status = "running";
    else if (run?.status === "queued") status = "queued";
    else if (run?.status === "failed" || source.health === "failing") status = "failing";
    else if (source.health === "stale") status = "stale";
    else if (run?.status === "succeeded") status = "succeeded";
    else status = "healthy";
    return { id: source.sourceId, source, latestRun: run, status, running: Boolean(running) };
  });
}

export const pipelineRowCount = (rows: PipelineRow[]) => rows.length;

export function useMemoRows(
  sources: DataSourceRow[],
  runs: PipelineRunRow[],
  runningSourceIds?: Set<string>,
): PipelineRow[] {
  return useMemo(
    () => buildPipelineRows(sources, runs, runningSourceIds),
    [sources, runs, runningSourceIds],
  );
}
