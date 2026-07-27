import type { SimulationEngine } from "@contracts/entities";

/** Lever definition for the intervention-levers section of the builder. */
export interface LeverDef {
  key: string;
  label: string;
  kind: "number" | "slider";
  /** Baseline value from the twin state (mono small readout). */
  baseline: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface EngineMeta {
  id: SimulationEngine;
  name: string;
  /** Mono engine tag (design: "PyMC-style" etc.). */
  tag: string;
  description: string;
  /** Typical runtime caption, e.g. "~6 min". */
  runtime: string;
  runtimeMinutes: number;
  recommendedFor: string;
  levers: LeverDef[];
}

export const ENGINES: EngineMeta[] = [
  {
    id: "forecast",
    name: "Forecast",
    tag: "PyMC-style",
    description: "Bayesian time-series forecast of employment paths with 80% credible bands.",
    runtime: "~6 min",
    runtimeMinutes: 6,
    recommendedFor: "Headline jobs trajectory under a single intervention.",
    levers: [
      { key: "intervention_strength", label: "Intervention strength", kind: "slider", baseline: 0.6, min: 0, max: 1, step: 0.05, unit: "0–1" },
      { key: "trend_shock", label: "External trend shock %", kind: "slider", baseline: 0, min: -20, max: 20, step: 1, unit: "%" },
    ],
  },
  {
    id: "causal",
    name: "Causal inference",
    tag: "DoWhy-style",
    description: "Estimates the causal effect of an intervention using DAG-identified adjustment sets.",
    runtime: "~9 min",
    runtimeMinutes: 9,
    recommendedFor: "Attributing outcomes to a specific policy lever.",
    levers: [
      { key: "treatment_share", label: "Treated LGA share %", kind: "slider", baseline: 35, min: 0, max: 100, step: 5, unit: "%" },
      { key: "effect_floor", label: "Minimum detectable effect %", kind: "number", baseline: 2, min: 0, max: 20, step: 0.5, unit: "%" },
    ],
  },
  {
    id: "microsim",
    name: "Microsimulation",
    tag: "OpenFisca-style",
    description: "Rule-based simulation over household and firm micro-records.",
    runtime: "~12 min",
    runtimeMinutes: 12,
    recommendedFor: "Distributional impacts of recruitment, pay and tax rules.",
    levers: [
      { key: "teachers_recruited", label: "Additional teachers recruited", kind: "number", baseline: 0, min: 0, max: 25000, step: 100, unit: "teachers" },
      { key: "salary_adjustment", label: "Salary adjustment %", kind: "slider", baseline: 0, min: -10, max: 40, step: 1, unit: "%" },
      { key: "sme_set_aside", label: "Procurement SME set-aside %", kind: "slider", baseline: 10, min: 0, max: 50, step: 1, unit: "%" },
    ],
  },
  {
    id: "abm",
    name: "Agent-based",
    tag: "Mesa-style",
    description: "Agent-based labour-market model of workers, firms and training providers.",
    runtime: "~18 min",
    runtimeMinutes: 18,
    recommendedFor: "Emergent dynamics: migration, matching frictions, informality.",
    levers: [
      { key: "agent_count", label: "Simulated agents", kind: "number", baseline: 50000, min: 10000, max: 250000, step: 5000, unit: "agents" },
      { key: "training_uptake", label: "Training uptake %", kind: "slider", baseline: 22, min: 0, max: 80, step: 1, unit: "%" },
    ],
  },
  {
    id: "system_dynamics",
    name: "System dynamics",
    tag: "PySD-style",
    description: "Stock-and-flow model of skills, employment and budget feedback loops.",
    runtime: "~8 min",
    runtimeMinutes: 8,
    recommendedFor: "Long-horizon feedback effects and delay structures.",
    levers: [
      { key: "budget_outlay", label: "Annual budget outlay ₦bn", kind: "number", baseline: 12, min: 0, max: 120, step: 1, unit: "₦bn" },
      { key: "feedback_gain", label: "Reinvestment feedback gain", kind: "slider", baseline: 0.3, min: 0, max: 1, step: 0.05, unit: "0–1" },
    ],
  },
  {
    id: "optimization",
    name: "Optimization",
    tag: "OR-Tools-style",
    description: "Constrained portfolio optimization across interventions and LGAs.",
    runtime: "~5 min",
    runtimeMinutes: 5,
    recommendedFor: "Allocating a fixed budget across competing programmes.",
    levers: [
      { key: "budget_cap", label: "Budget cap ₦bn", kind: "number", baseline: 40, min: 5, max: 200, step: 5, unit: "₦bn" },
      { key: "equity_weight", label: "Equity weight (rural LGAs)", kind: "slider", baseline: 0.4, min: 0, max: 1, step: 0.05, unit: "0–1" },
    ],
  },
];

export function engineMeta(id: string): EngineMeta {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0];
}

/** Executive template picker cards (limited mode, simulation.md §Executive). */
export interface TemplateDef {
  id: string;
  title: string;
  description: string;
  engine: SimulationEngine;
  assumptionsSetId: string;
  /** Preview outcome range shown on the card. */
  preview: { metric: string; low: number; high: number; unit: string };
  levers: LeverDef[];
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: "tpl:recruit-teachers",
    title: "Recruit teachers",
    description: "Pre-approved teacher pipeline surge with locked education assumptions.",
    engine: "microsim",
    assumptionsSetId: "asm:edu:base",
    preview: { metric: "Jobs created by 2027", low: 41000, high: 68500, unit: "jobs" },
    levers: [
      { key: "teachers_recruited", label: "Teachers to recruit", kind: "number", baseline: 5000, min: 1000, max: 15000, step: 500, unit: "teachers" },
      { key: "salary_adjustment", label: "Salary adjustment %", kind: "slider", baseline: 5, min: 0, max: 20, step: 1, unit: "%" },
    ],
  },
  {
    id: "tpl:sme-credit",
    title: "SME credit facility",
    description: "Pre-approved SME formalization facility with locked procurement assumptions.",
    engine: "causal",
    assumptionsSetId: "asm:proc:base",
    preview: { metric: "Jobs created by 2027", low: 28400, high: 47900, unit: "jobs" },
    levers: [
      { key: "treatment_share", label: "Covered SME share %", kind: "slider", baseline: 35, min: 10, max: 80, step: 5, unit: "%" },
      { key: "effect_floor", label: "Target effect %", kind: "number", baseline: 3, min: 1, max: 10, step: 0.5, unit: "%" },
    ],
  },
  {
    id: "tpl:procurement-set-aside",
    title: "Procurement set-aside",
    description: "Pre-approved supplier set-aside portfolio with locked baselines.",
    engine: "optimization",
    assumptionsSetId: "asm:proc:base",
    preview: { metric: "Jobs created by 2027", low: 19800, high: 35200, unit: "jobs" },
    levers: [
      { key: "sme_set_aside", label: "Set-aside share %", kind: "slider", baseline: 20, min: 5, max: 50, step: 1, unit: "%" },
      { key: "budget_cap", label: "Budget cap ₦bn", kind: "number", baseline: 40, min: 10, max: 120, step: 5, unit: "₦bn" },
    ],
  },
];
