/**
 * Shared types + helpers for the Data Source Health Console (data-health.md).
 * Row shapes mirror the db schema (data_sources, pipeline_runs, review_tasks).
 */

export interface DataSourceRow {
  sourceId: string;
  name: string;
  owner: string | null;
  url: string | null;
  category: string | null;
  accessMethod: string | null;
  refreshCadence: string | null;
  ingestionPattern: string | null;
  health: "healthy" | "stale" | "failing";
  lastRefresh: Date | string | null;
  freshnessDays: number;
  contractCompliance: unknown;
  geographyScope: string | null;
  createdAt: Date | string;
}

export interface PipelineRunRow {
  pipelineId: string;
  sourceId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  rowsProcessed: number;
  error: string | null;
  createdAt: Date | string;
}

export interface ReviewTaskRow {
  taskId: string;
  type: "ocr_low_confidence" | "legal_extract" | "data_quality";
  entityRef: string;
  assigneeRole: string;
  status: string;
  payload: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ContractCompliance {
  schema_ok?: boolean;
  sla_ok?: boolean;
  license_ok?: boolean;
  notes?: string;
}

export function parseCompliance(raw: unknown): ContractCompliance | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  return {
    schema_ok: typeof c.schema_ok === "boolean" ? c.schema_ok : undefined,
    sla_ok: typeof c.sla_ok === "boolean" ? c.sla_ok : undefined,
    license_ok: typeof c.license_ok === "boolean" ? c.license_ok : undefined,
    notes: typeof c.notes === "string" ? c.notes : undefined,
  };
}

/** Schema conformance percentage from the three contract checks. */
export function conformancePct(raw: unknown): number | null {
  const c = parseCompliance(raw);
  if (!c) return null;
  const checks = [c.schema_ok, c.sla_ok, c.license_ok].filter(
    (v): v is boolean => typeof v === "boolean",
  );
  if (checks.length === 0) return null;
  const ok = checks.filter(Boolean).length;
  return Math.round(((ok + (checks.length === 3 && ok === 3 ? 0.8 : 0)) / checks.length) * 1000) / 10;
}

/** SLA window in days parsed from a refresh cadence string ("daily 02:00" → 1). */
export function slaWindowDays(cadence: string | null | undefined): number {
  if (!cadence) return 7;
  const s = cadence.toLowerCase();
  if (s.includes("daily")) return 1;
  if (s.includes("week")) return 7;
  if (s.includes("month")) return 30;
  if (s.includes("hour")) return 1;
  const m = s.match(/(\d+)\s*d/);
  return m ? Number(m[1]) : 7;
}

export type SlaStatus = "within" | "approaching" | "breached";

export function slaStatus(freshnessDays: number, cadence: string | null | undefined): SlaStatus {
  const window = slaWindowDays(cadence);
  if (freshnessDays <= window) return "within";
  if (freshnessDays <= window * 2) return "approaching";
  return "breached";
}

export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function durationLabel(run: PipelineRunRow): string {
  if (!run.startedAt || !run.finishedAt) return "—";
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function ageDays(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

/** Review-queue tab mapping (data-health.md §2). */
export type QueueTab = "extraction" | "contracts" | "triage";

export const QUEUE_TABS: {
  id: QueueTab;
  label: string;
  taskType: ReviewTaskRow["type"];
}[] = [
  { id: "extraction", label: "Extraction QA", taskType: "ocr_low_confidence" },
  { id: "contracts", label: "Contract approvals", taskType: "legal_extract" },
  { id: "triage", label: "Issue triage", taskType: "data_quality" },
];

export type Severity = "high" | "medium" | "low";

export function taskSeverity(task: ReviewTaskRow): Severity {
  const p = task.payload as Record<string, unknown> | null;
  const conf = typeof p?.ocr_confidence === "number" ? p.ocr_confidence : null;
  if (conf !== null) {
    if (conf < 0.5) return "high";
    if (conf < 0.75) return "medium";
    return "low";
  }
  if (task.type === "legal_extract") return "high";
  if (task.type === "ocr_low_confidence") return "medium";
  return "medium";
}

/** Human-readable title for a review task row. */
export function taskTitle(task: ReviewTaskRow): string {
  switch (task.type) {
    case "ocr_low_confidence":
      return `Validate extraction: ${task.entityRef}`;
    case "legal_extract":
      return `Contract review: ${task.entityRef}`;
    case "data_quality":
      return `Data quality issue: ${task.entityRef}`;
  }
}
