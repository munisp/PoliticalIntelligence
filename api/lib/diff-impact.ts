import type {
  DiffClause,
  DiffImpactResult,
  ObligationChange,
  ParameterDelta,
} from "@contracts/diff-impact";

/**
 * I4 — in-process deterministic fallback for the legislative diff-impact
 * analyzer. Mirrors services/documents/app/diff_impact.py semantics with a
 * compact rule set (instrument keywords + scale parsing), so the endpoint
 * honors its contract even when the documents service is unreachable.
 */

const MODAL_PREFIX = /^(?:shall\s+not|may\s+not|shall|must|may)\s+/i;

function normAction(action: string): string {
  return action.trim().toLowerCase().replace(MODAL_PREFIX, "").slice(0, 160);
}

function oblKey(o: DiffClause["obligations"][number]): string {
  return `${o.kind}|${(o.actor ?? "").toLowerCase()}|${o.action
    .trim()
    .toLowerCase()
    .slice(0, 160)}`;
}

/** Extract obligations from text when none are supplied (modal rules). */
export function extractObligationsFallback(
  clause: DiffClause,
): DiffClause["obligations"] {
  if (clause.obligations.length > 0) return clause.obligations;
  const out: DiffClause["obligations"] = [];
  for (const sent of clause.text.split(/(?<=[.;:])\s+/)) {
    let m = /(shall\s+not|may\s+not)\b/i.exec(sent);
    if (m) {
      out.push({
        kind: "prohibition",
        actor: actorOf(sent, m.index),
        action: sent.slice(m.index).trim().replace(/[.;:]$/, "").slice(0, 400),
        modal: m[1].toLowerCase(),
      });
      continue;
    }
    m = /(shall|must)\b/i.exec(sent);
    if (m) {
      out.push({
        kind: "obligation",
        actor: actorOf(sent, m.index),
        action: sent.slice(m.index).trim().replace(/[.;:]$/, "").slice(0, 400),
        modal: m[1].toLowerCase(),
      });
      continue;
    }
    m = /\b(may)\b/i.exec(sent);
    if (m) {
      out.push({
        kind: "permission",
        actor: actorOf(sent, m.index),
        action: sent.slice(m.index).trim().replace(/[.;:]$/, "").slice(0, 400),
        modal: "may",
      });
    }
  }
  return out;
}

function actorOf(sent: string, modalIndex: string | number): string | null {
  const idx = typeof modalIndex === "number" ? modalIndex : 0;
  const before = sent.slice(0, idx).trim();
  const m = /((?:The\s+)?[A-Z][\w\s-]{2,60})$/.exec(before);
  return m ? m[1].trim() : null;
}

export function diffObligationsFallback(
  a: DiffClause[],
  b: DiffClause[],
): ObligationChange[] {
  const changes: ObligationChange[] = [];
  const byPathA = new Map(a.map((c) => [c.section_path, c]));
  const byPathB = new Map(b.map((c) => [c.section_path, c]));
  const paths = [...new Set([...byPathA.keys(), ...byPathB.keys()])].sort();
  const order = { removed: 0, changed: 1, added: 2 } as const;

  for (const path of paths) {
    const ca = byPathA.get(path);
    const cb = byPathB.get(path);
    const obsA = ca ? extractObligationsFallback(ca) : [];
    const obsB = cb ? extractObligationsFallback(cb) : [];
    if (ca && !cb) {
      for (const o of obsA) {
        changes.push({
          change: "removed", section_path: path, kind: o.kind,
          actor: o.actor, action_a: o.action, action_b: null,
          impact_note: `Clause ${path} removed: ${o.kind} on ${o.actor ?? "unspecified actor"} no longer applies.`,
        });
      }
      continue;
    }
    if (cb && !ca) {
      for (const o of obsB) {
        changes.push({
          change: "added", section_path: path, kind: o.kind,
          actor: o.actor, action_a: null, action_b: o.action,
          impact_note: `New clause ${path}: introduces ${o.kind} for ${o.actor ?? "unspecified actor"}.`,
        });
      }
      continue;
    }
    const keysA = new Map(obsA.map((o) => [oblKey(o), o]));
    const keysB = new Map(obsB.map((o) => [oblKey(o), o]));
    for (const [k, o] of keysA) {
      if (!keysB.has(k)) {
        changes.push({
          change: "removed", section_path: path, kind: o.kind,
          actor: o.actor, action_a: o.action, action_b: null,
          impact_note: `${path}: ${o.kind} removed for ${o.actor ?? "unspecified actor"}.`,
        });
      }
    }
    for (const [k, o] of keysB) {
      if (!keysA.has(k)) {
        changes.push({
          change: "added", section_path: path, kind: o.kind,
          actor: o.actor, action_a: null, action_b: o.action,
          impact_note: `${path}: new ${o.kind} for ${o.actor ?? "unspecified actor"}.`,
        });
      }
    }
    const flipA = new Map(obsA.map((o) => [`${o.actor ?? ""}|${normAction(o.action)}`, o]));
    const flipB = new Map(obsB.map((o) => [`${o.actor ?? ""}|${normAction(o.action)}`, o]));
    for (const [fk, oa] of flipA) {
      const ob = flipB.get(fk);
      if (ob && oa.kind !== ob.kind) {
        changes.push({
          change: "changed", section_path: path, kind: ob.kind,
          actor: ob.actor, action_a: oa.action, action_b: ob.action,
          impact_note: `${path}: modality shift ${oa.kind} → ${ob.kind} for ${ob.actor ?? "unspecified actor"} — compliance posture changes materially.`,
        });
      }
    }
  }
  changes.sort(
    (x, y) =>
      x.section_path.localeCompare(y.section_path) ||
      order[x.change] - order[y.change] ||
      (x.action_a ?? x.action_b ?? "").localeCompare(y.action_a ?? y.action_b ?? ""),
  );
  return changes;
}

/* ------------------------- parameter mapping ------------------------- */

const INSTRUMENT_RULES: [string, RegExp][] = [
  ["tax_credit", /\btax\s+(?:credit|relief|rebate|holiday|exemption)\b/i],
  ["subsidy", /\bsubsid(?:y|ies|ise|ize|ised|ized)\b/i],
  ["procurement_quota", /\b(?:procurement\s+quota|local\s+content|preference\s+margin|quota\b|set[-\s]?aside)\b/i],
  ["grant", /\bgrants?\b/i],
  ["training_levy", /\b(?:training\s+levy|levy\b|apprenticeship|training\s+fund)\b/i],
  ["regulatory_threshold", /\b(?:threshold|shall\s+not\s+exceed|minimum\s+(?:capital|threshold|requirement))\b/i],
  ["penalty", /\b(?:penalt(?:y|ies)|fine\b|sanction|offence|surcharge)\b/i],
];

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:per\s*cent|percent|%)/i;
const AMOUNT_RE = /(?:₦|NGN|naira)?\s*(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|m\b|bn\b)?/i;
const UNIT_MULT: Record<string, number> = {
  thousand: 1e3, million: 1e6, billion: 1e9, m: 1e6, bn: 1e9,
};

interface ParamCandidate {
  instrument: string;
  scale_percent: number | null;
  amount_ngn: number | null;
}

function candidatesFor(clauses: DiffClause[]): Map<string, ParamCandidate> {
  const out = new Map<string, ParamCandidate>();
  for (const c of clauses) {
    for (const [instrument, re] of INSTRUMENT_RULES) {
      if (!re.test(c.text)) continue;
      const existing = out.get(instrument);
      const pct = PERCENT_RE.exec(c.text);
      const amt = AMOUNT_RE.exec(c.text);
      const cand: ParamCandidate = existing ?? {
        instrument,
        scale_percent: null,
        amount_ngn: null,
      };
      if (pct && cand.scale_percent == null) cand.scale_percent = parseFloat(pct[1]);
      if (amt && cand.amount_ngn == null && /₦|NGN|naira|million|billion/i.test(c.text)) {
        const base = parseFloat(amt[1].replace(/,/g, ""));
        const mult = amt[2] ? UNIT_MULT[amt[2].toLowerCase()] ?? 1 : 1;
        cand.amount_ngn = base * mult;
      }
      out.set(instrument, cand);
      break; // first matching instrument per clause wins
    }
  }
  return out;
}

export function diffParametersFallback(
  a: DiffClause[],
  b: DiffClause[],
): ParameterDelta[] {
  const deltas: ParameterDelta[] = [];
  const instA = candidatesFor(a);
  const instB = candidatesFor(b);
  const keys = [...new Set([...instA.keys(), ...instB.keys()])].sort();
  for (const k of keys) {
    const ca = instA.get(k);
    const cb = instB.get(k);
    if (ca && !cb) {
      deltas.push({
        instrument: k, sector: null, field: "instrument", change: "removed",
        value_a: k, value_b: null, delta: null,
        impact_note: `Instrument ${k} removed — scenario assumption sets relying on it must be retired.`,
      });
      continue;
    }
    if (cb && !ca) {
      deltas.push({
        instrument: k, sector: null, field: "instrument", change: "added",
        value_a: null, value_b: k, delta: null,
        impact_note: `New instrument ${k} — model plan should add a matching assumption candidate.`,
      });
      continue;
    }
    for (const field of ["scale_percent", "amount_ngn"] as const) {
      const va = ca![field];
      const vb = cb![field];
      if (va === vb) continue;
      const delta = va != null && vb != null ? Math.round((vb - va) * 10000) / 10000 : null;
      deltas.push({
        instrument: k, sector: null, field, change: "changed",
        value_a: va, value_b: vb, delta,
        impact_note:
          field === "scale_percent"
            ? `${k}: rate ${va}% → ${vb}% (${delta != null && delta >= 0 ? "+" : ""}${delta}pp).`
            : `${k}: amount ₦${va ?? "—"} → ₦${vb ?? "—"}.`,
      });
    }
  }
  return deltas;
}

/** Full fallback computation (deterministic, pure). */
export function computeDiffImpactFallback(
  a: DiffClause[],
  b: DiffClause[],
): DiffImpactResult {
  const obl = diffObligationsFallback(a, b);
  const par = diffParametersFallback(a, b);
  const pathsA = new Set(a.map((c) => c.section_path));
  const pathsB = new Set(b.map((c) => c.section_path));
  const aligned = [...pathsA].filter((p) => pathsB.has(p)).length;
  return {
    clauses_a: a.length,
    clauses_b: b.length,
    aligned_pairs: aligned,
    obligations_added: obl.filter((c) => c.change === "added").length,
    obligations_removed: obl.filter((c) => c.change === "removed").length,
    obligations_changed: obl.filter((c) => c.change === "changed").length,
    obligation_changes: obl,
    parameter_deltas: par,
    requires_analyst_review: true,
  };
}
