/**
 * Dashboard-local data derivations and formatters.
 * All inputs are unwrapped tRPC payloads (structural types only — the
 * end-to-end AppRouter types flow through the page queries).
 */

import {
  unwrap as baseUnwrap,
  envelopeMeta as baseEnvelopeMeta,
  type EnvelopeMeta,
} from "@/lib/trpc-data";

/**
 * Typed unwrap that preserves end-to-end inference. The API envelope type
 * (contracts/entities: audit.actor_id is number|null) is structurally
 * incompatible with the shared helper's local Envelope interface, so we
 * bridge with a cast here rather than at every call site.
 */
export type Unwrapped<P> = P extends { data: infer T; meta: unknown } ? T : P;
export function unwrapData<P>(payload: P): Unwrapped<P> {
  return baseUnwrap(payload as never) as Unwrapped<P>;
}

/** Envelope meta (request_id…) with the same bridge. */
export function envelopeMetaOf(payload: unknown): EnvelopeMeta | null {
  return baseEnvelopeMeta(payload as never);
}

export const JURISDICTION_ID = "jur:ng-kd";
export const JOBS_TARGET = 250_000;
export const HORIZON_MONTHS = 36;
/** Scenario timeline baseline: Jan 2024 (milestone timeline 2024 → 2027). */
export const TIMELINE_START_YEAR = 2024;

/* ------------------------------------------------------------------ */
/* Simulation run shapes (contracts/entities BandPoint)                 */
/* ------------------------------------------------------------------ */

export interface BandPt {
  month: number;
  mean: number;
  lower: number;
  upper: number;
}

export interface RunResultLike {
  simulation_run_id: string;
  engine: string;
  metric: string;
  unit: string;
  series: BandPt[];
}

function pointAt(run: RunResultLike, month: number): BandPt | null {
  if (!run.series.length) return null;
  const idx = Math.max(0, Math.min(month, run.series.length - 1));
  return run.series[idx];
}

/**
 * Cumulative jobs delta at `month`, relative to the run baseline.
 * Level metrics ("employment") are baselined to month 0; effect metrics
 * ("employment_effect", microsim newly-formalized counts) are already deltas.
 */
export function deltaAt(run: RunResultLike, month: number): number {
  const pt = pointAt(run, month);
  if (!pt) return 0;
  const base = run.series[0];
  return run.metric === "employment" ? pt.mean - base.mean : pt.mean;
}

/** 80% credible band around the cumulative delta at `month`. */
export function deltaBandAt(
  run: RunResultLike,
  month: number,
): { low: number; high: number } {
  const pt = pointAt(run, month);
  if (!pt) return { low: 0, high: 0 };
  const base = run.series[0];
  return run.metric === "employment"
    ? { low: pt.lower - base.mean, high: pt.upper - base.mean }
    : { low: pt.lower, high: pt.upper };
}

/** Final projected jobs delta (end of horizon). */
export function finalDelta(run: RunResultLike): number {
  return deltaAt(run, run.series.length - 1);
}

export const ENGINE_LABELS: Record<string, string> = {
  forecast: "Forecast",
  causal: "Causal DiD",
  microsim: "Microsimulation",
  system_dynamics: "System dynamics",
  abm: "Agent-based model",
  optimization: "Optimization",
};

export function engineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? engine.replace(/_/g, " ");
}

/** "education_jobs_v1" → "Education jobs v1". */
export function humanize(name: string): string {
  const s = name.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Timeline labels                                                      */
/* ------------------------------------------------------------------ */

/** "2024 Q1" … for a month offset from Jan 2024. */
export function monthQuarterLabel(month: number): string {
  const year = TIMELINE_START_YEAR + Math.floor(month / 12);
  const q = Math.floor((month % 12) / 3) + 1;
  return `${year} Q${q}`;
}

/** Months elapsed since Jan 2024 for a date (clamped to the horizon). */
export function monthsSinceBaseline(d: Date): number {
  const m = (d.getFullYear() - TIMELINE_START_YEAR) * 12 + d.getMonth();
  return Math.max(0, Math.min(HORIZON_MONTHS, m));
}

/* ------------------------------------------------------------------ */
/* Formatters                                                           */
/* ------------------------------------------------------------------ */

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-NG");
}

export function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : "−"}${fmtInt(Math.abs(n))}`;
}

/** 0.287 → "28.7%" */
export function fmtShare(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Deterministic hash for stable pseudo-random map highlights. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
