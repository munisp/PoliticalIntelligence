import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import {
  unwrap,
  envelopeMeta,
  type Envelope,
  type EnvelopeMeta,
} from "@/lib/trpc-data";
import type { SimulationResultSummary } from "@contracts/entities";

/** Pilot jurisdiction scope (Kaduna State, design.md §9). */
export const JURISDICTION_ID = "jur:ng-kd";

/**
 * The API envelope (api/utils/envelope) uses `audit.actor_id: number | null`
 * while the shared helper's Envelope type declares `actor_id: string` — both
 * are structurally `{ data, meta, audit }` at runtime. These adapters bridge
 * the two without touching shared files.
 */
export function unwrapApi<T = unknown>(payload: unknown): T {
  return unwrap(payload as Envelope<T> | T | null | undefined);
}
export function metaApi(payload: unknown): EnvelopeMeta | null {
  return envelopeMeta(payload as Envelope<unknown> | null | undefined);
}

/* ------------------------------------------------------------------ */
/* API row shapes (db/schema.ts)                                       */
/* ------------------------------------------------------------------ */

export interface AssumptionEntry {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  source_id?: string;
}

export interface AssumptionSetLite {
  assumptionsSetId: string;
  name: string;
  description?: string | null;
  entries: AssumptionEntry[];
}

interface AssumptionSetRow {
  assumptionsSetId: string;
  name: string;
  description: string | null;
  entries: unknown;
}

interface ScenarioRow {
  scenarioId: string;
  jurisdictionId: string;
  name: string;
  description: string | null;
  interventionIds: unknown;
  assumptionsSetId: string | null;
  modelPlan: unknown;
  status: string;
  version: number;
  createdBy: number | null;
  createdAt: string | Date;
  updatedAt?: string | Date;
}

interface RunDb {
  simulationRunId: string;
  scenarioId: string;
  engine: string;
  executionProfile: unknown;
  modelVersions: unknown;
  status: string;
  progress: number;
  resultSummary: unknown;
  artifactUri: string | null;
  seed: number;
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  createdAt: string | Date;
}

interface ScenarioListPage {
  items: ScenarioRow[];
  next_cursor: string | null;
}

interface ScenarioDetail extends ScenarioRow {
  runs: RunDb[];
  assumptions: AssumptionSetRow | null;
}

/* ------------------------------------------------------------------ */
/* Flattened studio model                                              */
/* ------------------------------------------------------------------ */

export interface ScenarioLite {
  scenarioId: string;
  name: string;
  description: string | null;
  status: string;
  assumptionsSetId: string | null;
  jurisdictionId: string;
  modelPlan: unknown;
  createdBy: number | null;
  createdAt: string | Date;
}

export interface RunRow {
  id: string;
  simulationRunId: string;
  scenarioId: string;
  scenarioName: string;
  engine: string;
  status: string;
  progress: number;
  seed: number;
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  createdAt: string | Date;
  executionProfile: Record<string, unknown> | null;
  modelVersions: Record<string, string> | null;
  resultSummary: SimulationResultSummary | null;
  artifactUri: string | null;
  assumptionsSetId: string | null;
  scenarioCreatedBy: number | null;
  /** Envelope meta of the scenarios.get response that surfaced this run. */
  meta: EnvelopeMeta | null;
}

export interface StudioData {
  scenarios: ScenarioLite[];
  runs: RunRow[];
  assumptionSets: AssumptionSetLite[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  activeRunCount: number;
  refetch: () => void;
}

function isActiveStatus(status: string) {
  return status === "queued" || status === "running";
}

/** Scenarios + their runs for the pilot jurisdiction, with live polling
 *  (2.5s) only while a scenario has queued/running jobs. */
export function useStudioData(): StudioData {
  const listQuery = trpc.scenarios.list.useQuery(
    { jurisdiction_id: JURISDICTION_ID, limit: 100 },
    { staleTime: 5_000 },
  );
  const page = unwrapApi<ScenarioListPage | undefined>(listQuery.data);
  const scenarioIds = useMemo(
    () => (page?.items ?? []).map((s) => s.scenarioId),
    [page],
  );

  const detailQueries = trpc.useQueries((t) =>
    scenarioIds.map((id) =>
      t.scenarios.get(
        { scenario_id: id },
        {
          refetchInterval: (query) => {
            const detail = unwrapApi<ScenarioDetail | undefined>(
              query.state.data,
            );
            const active = (detail?.runs ?? []).some((r) =>
              isActiveStatus(r.status),
            );
            return active ? 2_500 : false;
          },
        },
      ),
    ),
  );

  return useMemo(() => {
    const scenarios: ScenarioLite[] = [];
    const runs: RunRow[] = [];
    const setMap = new Map<string, AssumptionSetLite>();
    let anyLoading = listQuery.isLoading;
    let anyError: unknown = listQuery.isError ? listQuery.error : null;

    detailQueries.forEach((dq, i) => {
      if (dq.isLoading) anyLoading = true;
      if (dq.isError && !anyError) anyError = dq.error;
      const detail = unwrapApi<ScenarioDetail | undefined>(dq.data);
      const scenarioId = scenarioIds[i];
      if (!detail) {
        const stub = (page?.items ?? []).find((s) => s.scenarioId === scenarioId);
        if (stub) scenarios.push(stub);
        return;
      }
      const { runs: scenarioRuns, assumptions, ...scenario } = detail;
      scenarios.push(scenario);
      if (assumptions) {
        setMap.set(assumptions.assumptionsSetId, {
          assumptionsSetId: assumptions.assumptionsSetId,
          name: assumptions.name,
          description: assumptions.description,
          entries: (assumptions.entries ?? []) as AssumptionEntry[],
        });
      }
      const meta = metaApi(dq.data);
      for (const r of scenarioRuns ?? []) {
        runs.push({
          id: r.simulationRunId,
          simulationRunId: r.simulationRunId,
          scenarioId: r.scenarioId,
          scenarioName: scenario.name,
          engine: r.engine,
          status: r.status,
          progress: r.progress ?? 0,
          seed: r.seed ?? 42,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          createdAt: r.createdAt,
          executionProfile: (r.executionProfile ?? null) as Record<string, unknown> | null,
          modelVersions: (r.modelVersions ?? null) as Record<string, string> | null,
          resultSummary: (r.resultSummary ?? null) as SimulationResultSummary | null,
          artifactUri: r.artifactUri ?? null,
          assumptionsSetId: scenario.assumptionsSetId ?? null,
          scenarioCreatedBy: scenario.createdBy ?? null,
          meta,
        });
      }
    });

    runs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      scenarios,
      runs,
      assumptionSets: [...setMap.values()],
      isLoading: anyLoading,
      isError: !!anyError,
      error: anyError,
      activeRunCount: runs.filter((r) => isActiveStatus(r.status)).length,
      refetch: () => {
        void listQuery.refetch();
        detailQueries.forEach((dq) => void dq.refetch());
      },
    };
  }, [detailQueries, listQuery, page, scenarioIds]);
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

/** Short mono run label, e.g. "sim:001" → "#001", "sim:a1b2c3d4e5" → "#A1B2C3". */
export function shortRunId(runId: string): string {
  const raw = runId.replace(/^sim:/, "");
  return `#${raw.slice(0, raw.length <= 4 ? raw.length : 6).toUpperCase()}`;
}

const numFmt = new Intl.NumberFormat("en-NG");
export function formatNumber(n: number): string {
  return numFmt.format(Math.round(n));
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(
  started: string | Date | null,
  finished: string | Date | null,
): string {
  if (!started) return "—";
  const start = new Date(started).getTime();
  const end = finished ? new Date(finished).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Live step captions for running jobs (design: "Calibrating ward-level priors… 62%"). */
export function runStepCaption(status: string, progress: number): string {
  if (status === "queued") return "Queued — waiting for an engine worker";
  if (status === "succeeded") return "Complete — artifacts sealed";
  if (status === "failed") return "Failed — see engine logs";
  if (status === "canceled") return "Canceled by operator";
  if (progress < 20) return "Calibrating ward-level priors…";
  if (progress < 45) return "Sampling posterior draws…";
  if (progress < 70) return "Aggregating LGA outcomes…";
  if (progress < 95) return "Computing 80% credible bands…";
  return "Writing artifacts and sealing run…";
}

/* ------------------------------------------------------------------ */
/* Download / clipboard / checksum helpers                             */
/* ------------------------------------------------------------------ */

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Deterministic SHA-256 checksum prefix of the artifact URI (content address). */
export async function checksumPrefix(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return [...new Uint8Array(buf)]
      .slice(0, 6)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "unavail.";
  }
}

export function artifactFileName(uri: string): string {
  const clean = uri.replace(/^[a-z]+:\/\//i, "");
  const tail = clean.split("/").pop();
  return tail || clean;
}
