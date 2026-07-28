import {
  DRAFT_SECTIONS,
  validateClauseSetObject,
  type ClauseSet,
  type DraftSection,
  type DraftedClause,
  type EvidenceBase,
} from "@contracts/drafting";
import type { SimulationResultSummary } from "@contracts/entities";
import { hashSeed, mulberry32 } from "../utils/prng";
import type { ModelRoutingRecord } from "./ai";

/**
 * G4 bridge to the LLM serving layer for clause drafting.
 * POST /v1/drafting/clauses → ClauseSet contract (contracts/drafting).
 * The DEFAULT tier is the offline deterministic synthesizer below; when the
 * remote serving tier is configured/reachable the same contract is enforced
 * (with one repair retry) so quality flips with config, not code.
 */

const BASE_URL = process.env.AI_BASE_URL ?? "http://localhost:8200";
const TIMEOUT_MS = 5000;

export class DraftingContractError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`drafting clause-set contract violation: ${errors.join("; ")}`);
    this.name = "DraftingContractError";
    this.errors = errors;
  }
}

export interface DraftingEvidenceSnippet {
  evidence_source_id: string;
  citation: string;
  confidence: number;
  excerpt?: string | null;
}

export interface DraftingOpportunity {
  opportunity_id: string;
  title: string;
  summary?: string | null;
}

export interface DraftingRequest {
  law_id: string;
  title: string;
  purpose: string;
  jurisdiction_id: string;
  target_outcomes: string[];
  evidence_base: EvidenceBase;
  evidence: DraftingEvidenceSnippet[];
  opportunities: DraftingOpportunity[];
  simulation?: {
    simulation_run_id: string;
    engine: string;
    seed: number;
    reproducibility_hash?: string | null;
    result_summary: SimulationResultSummary | null;
  } | null;
  /** Restrict regeneration to these sections (default: all). */
  only_sections?: DraftSection[];
}

/* ------------------------------------------------------------------ */
/* Offline deterministic synthesizer (DEFAULT tier)                    */
/* ------------------------------------------------------------------ */

const SECTION_HEADINGS: Record<DraftSection, string> = {
  definitions: "Interpretation and Definitions",
  instruments: "Enabling Instruments",
  obligations: "Duties and Obligations",
  enforcement: "Enforcement and Compliance",
  commencement: "Commencement and Review",
};

function citeList(evidence: DraftingEvidenceSnippet[], max = 3): string {
  const top = [...evidence].sort((a, b) => b.confidence - a.confidence).slice(0, max);
  return top.map((e) => e.citation).join("; ") || "the jurisdiction evidence base";
}

/** Deterministic: identical request ⇒ identical ClauseSet (offline tier). */
export function fallbackClauseSet(req: DraftingRequest): ClauseSet {
  const sections = req.only_sections?.length ? req.only_sections : DRAFT_SECTIONS;
  const rand = mulberry32(hashSeed(`${req.law_id}|${req.title}|${req.purpose}`));
  const sim = req.simulation ?? null;
  const horizon = sim?.result_summary?.series?.length ?? 36;
  const terminal = sim?.result_summary?.series?.[horizon - 1] ?? null;
  const outcomes =
    req.target_outcomes.length > 0
      ? req.target_outcomes.join("; ")
      : "the outcomes stated in the purpose of this Bill";
  // Stable ordering pick for variety without nondeterminism.
  const oppPool = [...req.opportunities].sort((a, b) =>
    a.opportunity_id.localeCompare(b.opportunity_id),
  );
  const primaryOpp = oppPool[Math.floor(rand() * Math.max(1, oppPool.length))] ?? null;

  const simGrounding = sim
    ? [
        {
          kind: "simulation_run" as const,
          id: sim.simulation_run_id,
          note: `${sim.engine} projection (seed ${sim.seed}) over ${horizon} months grounds the expected effect of this provision.`,
        },
      ]
    : [];
  const citationGrounding = (n: number) =>
    [...req.evidence]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, n)
      .map((e) => ({
        kind: "citation" as const,
        id: e.evidence_source_id,
        note: `Evidence source (confidence ${e.confidence.toFixed(2)}): ${e.citation}`,
      }));
  const oppGrounding = oppPool.slice(0, 2).map((o) => ({
    kind: "opportunity" as const,
    id: o.opportunity_id,
    note: `Ranked opportunity "${o.title}" motivates this provision.`,
  }));

  const texts: Record<DraftSection, string> = {
    definitions:
      `In this Bill, unless the context otherwise requires: "Purpose" means ${req.purpose}. ` +
      `"Target outcomes" means ${outcomes}. "Evidence base" means the sources cited in the ` +
      `Schedule, including ${citeList(req.evidence, 2)}. Terms defined in existing instruments ` +
      `of ${req.jurisdiction_id} retain their statutory meaning.`,
    instruments:
      `(1) There is hereby established the enabling instrument(s) required to give effect to ` +
      `${req.title}, comprising appropriation authority, procurement frameworks and an ` +
      `implementation delivery unit. ` +
      (primaryOpp
        ? `(2) The instrument shall initially operationalise the intervention described as "${primaryOpp.title}". `
        : "") +
      (terminal
        ? `(3) The design of the instrument reflects a projected ${sim!.engine} employment path ` +
          `reaching a mean of ${Math.round(terminal.mean).toLocaleString()} (80% band ` +
          `${Math.round(terminal.lower).toLocaleString()}–${Math.round(terminal.upper).toLocaleString()}) at month ${terminal.month}.`
        : ""),
    obligations:
      `(1) The responsible Ministry shall deliver against the target outcomes: ${outcomes}. ` +
      `(2) Implementing agencies shall publish quarterly progress returns disaggregated by local ` +
      `government area. (3) All disbursements under this Bill shall comply with extant public ` +
      `procurement law and the evidence-grounding requirements of the Schedule.`,
    enforcement:
      `(1) The Auditor-General shall review performance against the projected trajectory ` +
      (sim
        ? `of simulation run ${sim.simulation_run_id} (${sim.engine}, seed ${sim.seed}` +
          `${sim.reproducibility_hash ? `, reproducibility hash ${sim.reproducibility_hash.slice(0, 16)}…` : ""}) `
        : "in the Regulatory Impact Assessment ") +
      `and report material adverse variance to the House. (2) Persistent non-compliance by an ` +
      `implementing agency constitutes grounds for withholding further disbursement, subject to ` +
      `due process.`,
    commencement:
      `This Bill comes into force on the date of assent and shall be reviewed against the ` +
      `evidence base no later than ${horizon} months thereafter. The review shall re-run or ` +
      `verify the grounding simulation and table an updated Regulatory Impact Assessment.`,
  };

  const grounding: Record<DraftSection, DraftedClause["grounding"]> = {
    definitions: citationGrounding(2),
    instruments: [...oppGrounding, ...simGrounding].slice(0, 3),
    obligations: oppGrounding.length > 0 ? oppGrounding : citationGrounding(2),
    enforcement:
      simGrounding.length > 0
        ? [...simGrounding, ...citationGrounding(1)]
        : citationGrounding(2),
    commencement: simGrounding.length > 0 ? simGrounding : citationGrounding(1),
  };

  const clauses: DraftedClause[] = sections.map((section) => {
    const idx = DRAFT_SECTIONS.indexOf(section) + 1;
    const g = grounding[section];
    return {
      section,
      section_path: `s.${idx}`,
      heading: SECTION_HEADINGS[section],
      text: texts[section],
      grounding:
        g.length > 0
          ? g
          : [
              {
                kind: "citation" as const,
                id: req.evidence[0]?.evidence_source_id ?? "ev:unlinked",
                note: "Grounded in the draft's evidence base.",
              },
            ],
    };
  });

  return {
    law_id: req.law_id,
    clauses,
    model_routing: {
      tier: "offline-fallback",
      model: "deterministic",
      fallback: true,
      decided_at: new Date(0).toISOString(), // caller replaces with wall clock
    },
  };
}

/* ------------------------------------------------------------------ */
/* Serving-layer client with contract enforcement                      */
/* ------------------------------------------------------------------ */

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`ai service ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateDraftClauses(req: DraftingRequest): Promise<{
  clauseSet: ClauseSet;
  bridge: "remote" | "fallback";
  routing: ModelRoutingRecord;
}> {
  try {
    const first = await postJson<unknown>("/v1/drafting/clauses", req);
    let errors = validateClauseSetObject(first);
    let candidate = first;
    if (errors.length > 0) {
      // Single repair retry (mirrors recommendations contract enforcement).
      candidate = await postJson<unknown>("/v1/drafting/clauses", {
        ...req,
        repair_errors: errors,
        repair_instruction:
          "Your previous answer FAILED the clause-set contract. Return ONLY the corrected payload.",
      });
      errors = validateClauseSetObject(candidate);
      if (errors.length > 0) throw new DraftingContractError(errors);
    }
    const set = candidate as ClauseSet;
    // Every clause must carry grounding, regardless of tier.
    for (const c of set.clauses) {
      if (!c.grounding || c.grounding.length === 0) {
        throw new DraftingContractError([`clause ${c.section_path} has no grounding`]);
      }
    }
    return {
      clauseSet: set,
      bridge: "remote",
      routing: {
        tier: "remote",
        model: "serving-tier",
        fallback: false,
        decided_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    if (err instanceof DraftingContractError) throw err; // never persist invalid
    const clauseSet = fallbackClauseSet(req);
    clauseSet.model_routing.decided_at = new Date().toISOString();
    return {
      clauseSet,
      bridge: "fallback",
      routing: {
        tier: "offline-fallback",
        model: "deterministic",
        fallback: true,
        decided_at: new Date().toISOString(),
      },
    };
  }
}
