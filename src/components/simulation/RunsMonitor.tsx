import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  XCircle,
  Ban,
  GitCompareArrows,
  RotateCw,
  FlaskConical,
  Loader2,
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import StatusDot from "@/components/shared/StatusDot";
import DataTable, { type DataTableColumn } from "@/components/shared/DataTable";
import EmptyState from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { engineMeta } from "./engines";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  runStepCaption,
  shortRunId,
  unwrapApi,
  type RunRow,
} from "./studio";

/* ------------------------------------------------------------------ */
/* Status chip (icon + label, never color-only)                        */
/* ------------------------------------------------------------------ */

export function RunStatusChip({ status }: { status: string }) {
  if (status === "queued" || status === "running" || status === "succeeded") {
    return <StatusDot status={status} />;
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5" role="status" aria-label="Status: Failed">
        <span aria-hidden className="h-2 w-2 rounded-full bg-status-danger" />
        <XCircle aria-hidden className="h-3.5 w-3.5 text-status-danger" />
        <span className="text-xs font-medium text-status-danger">Failed</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-label="Status: Canceled">
      <span aria-hidden className="h-2 w-2 rounded-full bg-ink-muted" />
      <Ban aria-hidden className="h-3.5 w-3.5 text-ink-muted" />
      <span className="text-xs font-medium text-ink-muted">Canceled</span>
    </span>
  );
}

/** Striped shimmer progress bar for running jobs (animates between polls). */
function RunProgress({ progress }: { progress: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Run progress"
      className="h-1.5 w-36 overflow-hidden rounded-full bg-ink-inset"
    >
      <motion.div
        className="h-full rounded-full"
        initial={false}
        animate={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
        transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
      >
        <motion.div
          className="h-full w-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #5E93CF 0px, #5E93CF 8px, #4A7DB3 8px, #4A7DB3 16px)",
          }}
          animate={{ backgroundPositionX: ["0px", "22px"] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
        />
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

const STATUS_FILTERS = ["all", "queued", "running", "succeeded", "failed", "canceled"] as const;
const DATE_FILTERS = [
  { id: "all", label: "All time", days: Infinity },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
] as const;

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-150",
        active
          ? "border-civic/60 bg-civic/10 text-civic"
          : "border-ink-subtle text-ink-secondary hover:border-ink-strong hover:text-ink-primary",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Runs monitor                                                        */
/* ------------------------------------------------------------------ */

export interface RunsMonitorProps {
  runs: RunRow[];
  isLoading: boolean;
  readOnly: boolean;
  sessionRunIds: Set<string>;
  currentUserId: number | null;
  onAddToCompare: (runId: string) => void;
  onRerunQueued: (info: { simulationRunId: string; scenarioName: string }) => void;
}

export default function RunsMonitor({
  runs,
  isLoading,
  readOnly,
  sessionRunIds,
  currentUserId,
  onAddToCompare,
  onRerunQueued,
}: RunsMonitorProps) {
  const utils = trpc.useUtils();
  const addRunMut = trpc.scenarios.addRun.useMutation();
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [dateFilter, setDateFilter] = useState<(typeof DATE_FILTERS)[number]["id"]>("all");

  /* Completed-row teal flash (600ms) on transition to succeeded. */
  const prevStatus = useRef<Map<string, string>>(new Map());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const newlyDone: string[] = [];
    for (const r of runs) {
      const prev = prevStatus.current.get(r.simulationRunId);
      if (prev && prev !== "succeeded" && r.status === "succeeded") {
        newlyDone.push(r.simulationRunId);
      }
      prevStatus.current.set(r.simulationRunId, r.status);
    }
    if (newlyDone.length > 0) {
      setFlashIds((s) => new Set([...s, ...newlyDone]));
      const timer = setTimeout(
        () =>
          setFlashIds((s) => {
            const next = new Set(s);
            newlyDone.forEach((id) => next.delete(id));
            return next;
          }),
        700,
      );
      return () => clearTimeout(timer);
    }
  }, [runs]);

  const filtered = useMemo(() => {
    const days = DATE_FILTERS.find((d) => d.id === dateFilter)?.days ?? Infinity;
    const cutoff = days === Infinity ? null : Date.now() - days * 86_400_000;
    return runs.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (engineFilter !== "all" && r.engine !== engineFilter) return false;
      if (mineOnly) {
        const mine =
          sessionRunIds.has(r.simulationRunId) ||
          (currentUserId != null && r.scenarioCreatedBy === currentUserId);
        if (!mine) return false;
      }
      if (cutoff != null && new Date(r.createdAt).getTime() < cutoff) return false;
      return true;
    });
  }, [runs, statusFilter, engineFilter, mineOnly, dateFilter, sessionRunIds, currentUserId]);

  const rerun = async (run: RunRow) => {
    setRerunError(null);
    setRerunningId(run.simulationRunId);
    try {
      const res = await addRunMut.mutateAsync({
        scenario_id: run.scenarioId,
        engine: run.engine as never,
        seed: run.seed,
        execution_profile: {
          ...(run.executionProfile ?? {}),
          rerun_of: run.simulationRunId,
        },
        idempotency_key: `rerun:${run.simulationRunId}:${crypto.randomUUID()}`,
      });
      await utils.scenarios.invalidate();
      const handle = unwrapApi<{ simulation_run_id?: string }>(res);
      onRerunQueued({
        simulationRunId: handle?.simulation_run_id ?? "",
        scenarioName: run.scenarioName,
      });
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : "Re-run could not be queued.");
    } finally {
      setRerunningId(null);
    }
  };

  const columns: DataTableColumn<RunRow>[] = [
    {
      id: "run",
      header: "Run ID",
      accessor: (r) => (
        <span className="font-mono text-xs text-civic">{shortRunId(r.simulationRunId)}</span>
      ),
      sortValue: (r) => r.simulationRunId,
    },
    {
      id: "scenario",
      header: "Scenario",
      accessor: (r) => (
        <span className="block max-w-48 truncate text-[13px] text-ink-primary" title={r.scenarioName}>
          {r.scenarioName}
        </span>
      ),
      sortValue: (r) => r.scenarioName,
    },
    {
      id: "engine",
      header: "Engine",
      accessor: (r) => (
        <span className="rounded-full border border-ink-subtle px-2 py-0.5 font-mono text-[10px] text-ink-secondary">
          {engineMeta(r.engine).tag}
        </span>
      ),
      sortValue: (r) => r.engine,
    },
    {
      id: "status",
      header: "Status",
      accessor: (r) => (
        <div
          className={cn(
            "space-y-1 rounded px-1 py-0.5 transition-colors duration-500",
            flashIds.has(r.simulationRunId) && "bg-civic/15",
          )}
        >
          <RunStatusChip status={r.status} />
          {(r.status === "running" || r.status === "queued") && (
            <>
              <RunProgress progress={r.progress} />
              <span className="block font-mono text-[10px] text-ink-muted">
                {runStepCaption(r.status, r.progress)}{" "}
                {r.status === "running" ? `${r.progress}%` : ""}
              </span>
            </>
          )}
        </div>
      ),
      sortValue: (r) => r.status,
    },
    {
      id: "submitted",
      header: "Submitted",
      accessor: (r) => (
        <span className="text-xs text-ink-secondary">{formatDateTime(r.createdAt)}</span>
      ),
      sortValue: (r) => new Date(r.createdAt).getTime(),
    },
    {
      id: "duration",
      header: "Duration",
      numeric: true,
      accessor: (r) => (
        <span className="font-mono text-xs text-ink-secondary">
          {formatDuration(r.startedAt, r.finishedAt)}
        </span>
      ),
    },
    {
      id: "seed",
      header: "Seed",
      numeric: true,
      accessor: (r) => <span className="font-mono text-xs text-ink-muted">{r.seed}</span>,
      sortValue: (r) => r.seed,
    },
    {
      id: "actions",
      header: "Actions",
      accessor: (r) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAddToCompare(r.simulationRunId)}
            disabled={r.status !== "succeeded"}
            title={
              r.status === "succeeded"
                ? "Add to compare"
                : "Compare is available once the run succeeds"
            }
            aria-label={`Compare run ${shortRunId(r.simulationRunId)}`}
            className="rounded p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-civic disabled:opacity-30"
          >
            <GitCompareArrows aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void rerun(r)}
            disabled={readOnly || rerunningId === r.simulationRunId}
            title={readOnly ? "Read-only in executive mode" : "Re-run with the same seed"}
            aria-label={`Re-run ${shortRunId(r.simulationRunId)}`}
            className="rounded p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-civic disabled:opacity-30"
          >
            {rerunningId === r.simulationRunId ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw aria-hidden className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            disabled
            title="Cancellation is handled from the jobs console"
            aria-label={`Cancel run ${shortRunId(r.simulationRunId)} (via jobs console)`}
            className="rounded p-1.5 text-ink-secondary opacity-30"
          >
            <Ban aria-hidden className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return <SkeletonTable rows={6} columns={7} />;
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        Icon={FlaskConical}
        showSpotArt={false}
        title="No simulation runs yet"
        guidance="Build your first scenario in the Builder tab — queued runs appear here with live status."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Run filters">
        {STATUS_FILTERS.map((s) => (
          <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s}
          </Chip>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-ink-subtle" />
        <Chip active={engineFilter === "all"} onClick={() => setEngineFilter("all")}>
          all engines
        </Chip>
        {["forecast", "causal", "microsim", "abm", "system_dynamics", "optimization"].map((e) => (
          <Chip key={e} active={engineFilter === e} onClick={() => setEngineFilter(e)}>
            {engineMeta(e).name}
          </Chip>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-ink-subtle" />
        <Chip active={!mineOnly} onClick={() => setMineOnly(false)}>
          all
        </Chip>
        <Chip active={mineOnly} onClick={() => setMineOnly(true)}>
          mine
        </Chip>
        <span aria-hidden className="mx-1 h-4 w-px bg-ink-subtle" />
        {DATE_FILTERS.map((d) => (
          <Chip key={d.id} active={dateFilter === d.id} onClick={() => setDateFilter(d.id)}>
            {d.label}
          </Chip>
        ))}
      </div>

      {rerunError && (
        <p role="alert" className="flex items-start gap-1.5 rounded border border-status-danger/40 bg-status-danger/10 px-2 py-1.5 text-xs text-status-danger">
          <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {rerunError}
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          Icon={FlaskConical}
          showSpotArt={false}
          title="No runs match these filters"
          guidance="Loosen the status, engine or date filters to see more runs."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered.map((r) => ({
            ...r,
            id: r.simulationRunId,
          }))}
          caption="Simulation runs"
          exportFileName="simulation-runs.csv"
          renderExpanded={(r) => <RunDetail run={r} />}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expanded run detail                                                 */
/* ------------------------------------------------------------------ */

function RunDetail({ run }: { run: RunRow }) {
  const summary = run.resultSummary;
  const final = summary?.series?.[summary.series.length - 1];
  return (
    <div className="grid gap-4 px-1 py-2 md:grid-cols-2">
      <div>
        <p className="caption-label mb-1 text-ink-muted">Inputs (execution profile)</p>
        <pre className="max-h-44 overflow-auto rounded-md border border-ink-subtle bg-ink-inset p-2 font-mono text-[11px] leading-4 text-ink-secondary">
          {JSON.stringify(run.executionProfile ?? {}, null, 2)}
        </pre>
        <p className="caption-label mb-1 mt-3 text-ink-muted">Model versions</p>
        <pre className="rounded-md border border-ink-subtle bg-ink-inset p-2 font-mono text-[11px] leading-4 text-ink-secondary">
          {JSON.stringify(run.modelVersions ?? {}, null, 2)}
        </pre>
      </div>
      <div className="space-y-2 text-xs">
        <p className="caption-label text-ink-muted">Trace</p>
        <dl className="space-y-1.5 font-mono text-[11px] text-ink-secondary">
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">run id</dt>
            <dd>{run.simulationRunId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">request id</dt>
            <dd>{run.meta?.request_id ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">correlation id</dt>
            <dd>{run.meta?.correlation_id ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">artifact</dt>
            <dd className="truncate" title={run.artifactUri ?? undefined}>
              {run.artifactUri ?? "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">engine · seed</dt>
            <dd>
              {run.engine} · {run.seed}
            </dd>
          </div>
        </dl>
        {final && summary && (
          <div className="rounded-md border border-ink-subtle bg-ink-inset p-2.5">
            <p className="caption-label text-[10px] text-ink-muted">Outcome summary</p>
            <p className="mt-1 font-mono text-sm text-ink-primary">
              {formatNumber(final.mean)}{" "}
              <span className="text-xs text-ink-muted">{summary.unit}</span>
            </p>
            <p className="font-mono text-[11px] text-ink-muted">
              80% band {formatNumber(final.lower)}–{formatNumber(final.upper)} at month{" "}
              {final.month}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
