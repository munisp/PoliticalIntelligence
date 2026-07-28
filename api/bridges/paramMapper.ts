import {
  assumptionCandidateSchema,
  paramMapResultSchema,
  PARAM_MAP_POPULATIONS,
  PARAM_MAP_SECTORS,
  type AssumptionCandidate,
  type ParamMapInstrument,
  type ParamMapResult,
  type RationaleSpan,
} from "@contracts/param-mapper";
import {
  clauseArtifactSchema,
  type ClauseArtifact,
} from "@contracts/documents";
import {
  DOCUMENTS_BASE_URL,
  DocumentsServiceUnreachable,
} from "../queries/documents";

/**
 * G3 bridge → documents service POST /v1/param-map.
 *
 * Primary path: the Python legal-NLP param mapper. When the service is
 * unreachable (5s timeout), a deterministic in-process rule engine with the
 * same rules (instrument lexicon, scale parsing, sector lexicon, population
 * hints, confidence formula) produces candidates so the platform stays
 * production-ready — mirroring the simulation bridge fallback pattern.
 * No LLM calls anywhere; same clauses in ⇒ same candidates out.
 */

const TIMEOUT_MS = 5000;

/* ------------------------------------------------------------------ */
/* Remote call                                                         */
/* ------------------------------------------------------------------ */

export async function mapClausesRemote(
  clauses: ClauseArtifact[],
  topK = 10,
): Promise<ParamMapResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${DOCUMENTS_BASE_URL}/v1/param-map`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clauses, top_k: topK }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`documents service ${resp.status}`);
    const body = (await resp.json()) as { data?: unknown };
    return paramMapResultSchema.parse(body.data ?? body);
  } catch (err) {
    if (err instanceof Error && /documents service \d+/.test(err.message))
      throw err;
    throw new DocumentsServiceUnreachable(
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic local fallback (mirrors param_mapper.py)              */
/* ------------------------------------------------------------------ */

const INSTRUMENT_RULES: Array<[ParamMapInstrument, RegExp, number]> = [
  ["tax_credit", /\btax\s+(?:credit|relief|rebate|holiday|exemption)\b/i, 0.9],
  ["subsidy", /\bsubsid(?:y|ies|ise|ize|ised|ized)\b/i, 0.88],
  // procurement_quota before grant: "grant a margin of preference for
  // local content" is a quota instrument, not a fiscal grant.
  [
    "procurement_quota",
    /\b(?:procurement\s+quota|local\s+content|preference\s+margin|quota\b|set[-\s]?aside)\b/i,
    0.86,
  ],
  ["grant", /\bgrants?\b/i, 0.82],
  [
    "training_levy",
    /\b(?:training\s+levy|levy\b|apprenticeship(?:\s+fund)?|training\s+fund)\b/i,
    0.85,
  ],
  [
    "regulatory_threshold",
    /\b(?:threshold|shall\s+not\s+exceed|minimum\s+(?:capital|threshold|requirement)|licen[cs]e\s+requirement)\b/i,
    0.78,
  ],
  ["penalty", /\b(?:penalt(?:y|ies)|fine\b|sanction|offence|surcharge)\b/i, 0.84],
];
const PENALTY_RE = INSTRUMENT_RULES[INSTRUMENT_RULES.length - 1][1];

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:per\s*cent|percent|%)/i;
const AMOUNT_RE =
  /(?:₦|NGN|N\s*=?\s?|naira\s+)?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|m\b|bn\b)?(?:\s*(?:naira|NGN|₦))?/i;
const CURRENCY_HINT = /₦|NGN|\bnaira\b/i;
const DURATION_RE = /(\d{1,4})\s*(years?|yrs?|months?|mos?|weeks?|days?)/i;

const UNIT_MULTIPLIER: Record<string, number> = {
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
  m: 1_000_000,
  bn: 1_000_000_000,
};
const DURATION_TO_MONTHS: Record<string, number> = {
  year: 12,
  yr: 12,
  month: 1,
  mo: 1,
  week: 0.25,
  day: 1 / 30,
};

export function parsePercentage(text: string): number | null {
  const m = PERCENT_RE.exec(text);
  return m ? Number(m[1]) : null;
}

export function parseAmount(text: string): number | null {
  if (!CURRENCY_HINT.test(text)) return null;
  const m = AMOUNT_RE.exec(text);
  if (!m) return null;
  let value = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] ?? "").toLowerCase().replace(/\.$/, "");
  value *= UNIT_MULTIPLIER[unit] ?? 1;
  return value;
}

export function parseDurationMonths(text: string): number | null {
  const m = DURATION_RE.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase().replace(/s$/, "");
  const months = n * (DURATION_TO_MONTHS[unit] ?? 0);
  return Math.max(1, Math.round(months));
}

const SECTOR_LEXICON: Record<string, string[]> = {
  agriculture: ["agriculture", "agricultural", "farming", "farmer", "crop", "livestock", "agro", "fisheries"],
  manufacturing: ["manufacturing", "manufacturer", "factory", "industrial", "production plant"],
  ICT: ["ict", "information technology", "digital", "telecom", "software", "broadband", "technology hub"],
  construction: ["construction", "building works", "infrastructure", "housing", "contractor"],
  energy: ["energy", "electricity", "power sector", "petroleum", "gas", "renewable", "solar"],
  health: ["health", "hospital", "medical", "clinic", "pharmaceutical"],
  education: ["education", "school", "teacher", "student", "university", "tertiary institution"],
};

const POPULATION_LEXICON: Record<string, string[]> = {
  SME: ["sme", "msme", "small and medium", "small-scale enterprise", "micro enterprise"],
  youth: ["youth", "young person", "young people", "graduate trainee"],
  women: ["women", "female", "gender", "widow"],
};

export function detectSector(text: string) {
  const low = text.toLowerCase();
  let best: { len: number; sector: string } | null = null;
  for (const sector of PARAM_MAP_SECTORS) {
    for (const kw of SECTOR_LEXICON[sector]) {
      if (low.includes(kw) && (best === null || kw.length > best.len))
        best = { len: kw.length, sector };
    }
  }
  return best?.sector ?? null;
}

export function detectPopulations(text: string): string[] {
  const low = text.toLowerCase();
  return PARAM_MAP_POPULATIONS.filter((p) =>
    POPULATION_LEXICON[p].some((kw) => low.includes(kw)),
  );
}

function spanFor(
  clause: ClauseArtifact,
  matched: string,
  parameter: string,
): RationaleSpan {
  const idx = clause.text.toLowerCase().indexOf(matched.toLowerCase());
  const excerpt =
    idx < 0
      ? clause.text.slice(0, 120)
      : clause.text
          .slice(Math.max(0, idx - 60), Math.min(clause.text.length, idx + matched.length + 60))
          .trim();
  return {
    clause_id: clause.clause_id,
    section_path: clause.section_path,
    span: excerpt,
    parameter,
  };
}

export function candidateFromClause(
  clause: ClauseArtifact,
): AssumptionCandidate | null {
  let instrument: ParamMapInstrument | null = null;
  let weight = 0;
  let matched = "";
  const penaltyM = PENALTY_RE.exec(clause.text);
  if (
    penaltyM &&
    clause.obligations.some((o) => o.kind === "prohibition")
  ) {
    instrument = "penalty";
    weight = 0.88;
    matched = penaltyM[0];
  } else {
    for (const [inst, re, w] of INSTRUMENT_RULES) {
      const m = re.exec(clause.text);
      if (m) {
        instrument = inst;
        weight = w;
        matched = m[0];
        break;
      }
    }
  }
  if (!instrument) return null;

  const rationale: RationaleSpan[] = [spanFor(clause, matched, "instrument")];
  const pct = parsePercentage(clause.text);
  if (pct !== null) rationale.push(spanFor(clause, PERCENT_RE.exec(clause.text)![0], "scale_percent"));
  const amt = parseAmount(clause.text);
  if (amt !== null) rationale.push(spanFor(clause, AMOUNT_RE.exec(clause.text)![0].trim(), "amount_ngn"));
  const dur = parseDurationMonths(clause.text);
  if (dur !== null) rationale.push(spanFor(clause, DURATION_RE.exec(clause.text)![0], "duration_months"));
  const sector = detectSector(clause.text);
  if (sector) rationale.push(spanFor(clause, sector, "sector"));
  const populations = detectPopulations(clause.text);

  const bonus =
    (pct !== null ? 0.04 : 0) +
    (amt !== null ? 0.04 : 0) +
    (dur !== null ? 0.03 : 0) +
    (sector ? 0.03 : 0) +
    (populations.length ? 0.02 : 0);
  const confidence =
    Math.round(Math.min(0.99, weight * clause.confidence + bonus) * 10000) /
    10000;

  return assumptionCandidateSchema.parse({
    instrument,
    scale_percent: pct,
    amount_ngn: amt,
    duration_months: dur,
    sector: sector as AssumptionCandidate["sector"],
    target_population: populations,
    confidence,
    rationale,
    requires_analyst_review: true,
  });
}

function mergeCandidates(cands: AssumptionCandidate[]): AssumptionCandidate[] {
  const merged = new Map<string, AssumptionCandidate>();
  for (const c of cands) {
    const key = `${c.instrument}|${c.sector ?? ""}`;
    const m = merged.get(key);
    if (!m) {
      merged.set(key, { ...c, rationale: [...c.rationale] });
      continue;
    }
    m.confidence = Math.round(Math.max(m.confidence, c.confidence) * 10000) / 10000;
    m.scale_percent = m.scale_percent ?? c.scale_percent;
    m.amount_ngn = m.amount_ngn ?? c.amount_ngn;
    m.duration_months = m.duration_months ?? c.duration_months;
    m.target_population = [...new Set([...m.target_population, ...c.target_population])].sort() as never;
    m.rationale.push(...c.rationale);
  }
  return [...merged.values()];
}

/** Deterministic local mapping (service-unreachable fallback). */
export function mapClausesLocal(
  clauses: ClauseArtifact[],
  topK = 10,
): ParamMapResult {
  const raw = clauses
    .map((c) => candidateFromClause(clauseArtifactSchema.parse(c)))
    .filter((c): c is AssumptionCandidate => c !== null);
  const merged = mergeCandidates(raw);
  merged.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.instrument.localeCompare(b.instrument) ||
      (a.sector ?? "").localeCompare(b.sector ?? ""),
  );
  return {
    candidates: merged.slice(0, topK),
    clause_count: clauses.length,
    requires_analyst_review: true,
  };
}

/** Remote-first mapping with deterministic local fallback. */
export async function mapClausesToParameters(
  clauses: ClauseArtifact[],
  topK = 10,
): Promise<ParamMapResult & { source: "service" | "fallback" }> {
  try {
    return { ...(await mapClausesRemote(clauses, topK)), source: "service" };
  } catch (err) {
    if (err instanceof DocumentsServiceUnreachable)
      return { ...mapClausesLocal(clauses, topK), source: "fallback" };
    throw err;
  }
}
