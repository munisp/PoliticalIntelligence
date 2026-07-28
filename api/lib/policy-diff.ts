import type { PolicyDiffResult } from "@contracts/innovations";
import { clausesForLaw, findLaw } from "../queries/legislation";

/**
 * Cross-law clause-level alignment engine (deterministic, in-process).
 * Shared by innovations.policyDiff and legislation.compare — the
 * legislation compare endpoint reuses this engine rather than duplicating
 * the TF-IDF-ish cosine alignment logic.
 */

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** TF-IDF-ish cosine over token multisets (deterministic, in-process). */
export function tokenSimilarity(
  a: string,
  b: string,
  df: Map<string, number>,
  nDocs: number,
): number {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const vec = (s: string) => {
    const counts = new Map<string, number>();
    for (const tok of tokenize(s)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    const v = new Map<string, number>();
    for (const [tok, c] of counts) {
      const idf = Math.log(1 + nDocs / (1 + (df.get(tok) ?? 0)));
      v.set(tok, c * idf);
    }
    return v;
  };
  const va = vec(a);
  const vb = vec(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, x] of va) na += x * x;
  for (const [, x] of vb) nb += x * x;
  for (const [tok, x] of va) {
    const y = vb.get(tok);
    if (y) dot += x * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type PolicyDiffComputation =
  | { result: PolicyDiffResult; missingLawId: null }
  | { result: null; missingLawId: string };

/**
 * Compute the clause-level alignment between two laws. Deterministic for a
 * fixed corpus: identical inputs always produce identical outputs.
 */
export async function computePolicyDiff(
  lawIdA: string,
  lawIdB: string,
): Promise<PolicyDiffComputation> {
  const [lawA, lawB] = await Promise.all([findLaw(lawIdA), findLaw(lawIdB)]);
  if (!lawA || !lawB) {
    return { result: null, missingLawId: !lawA ? lawIdA : lawIdB };
  }
  const [clausesA, clausesB] = await Promise.all([
    clausesForLaw(lawA.lawId),
    clausesForLaw(lawB.lawId),
  ]);
  // Document frequency over the combined corpus.
  const df = new Map<string, number>();
  const docs = [...clausesA, ...clausesB];
  for (const d of docs) {
    const toks = new Set(
      d.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
    );
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const aligned: PolicyDiffResult["aligned"] = [];
  const matchedB = new Set<string>();
  const uniqueA: string[] = [];
  for (const ca of clausesA) {
    let best: { id: string; sim: number } | null = null;
    for (const cb of clausesB) {
      if (matchedB.has(cb.clauseId)) continue;
      const sim = tokenSimilarity(ca.text, cb.text, df, docs.length);
      if (!best || sim > best.sim) best = { id: cb.clauseId, sim };
    }
    if (best && best.sim >= 0.35) {
      aligned.push({ clause_a: ca.clauseId, clause_b: best.id, similarity: round(best.sim) });
      matchedB.add(best.id);
    } else {
      uniqueA.push(ca.clauseId);
    }
  }
  const uniqueB = clausesB.filter((c) => !matchedB.has(c.clauseId)).map((c) => c.clauseId);
  return {
    result: {
      law_id_a: lawA.lawId,
      law_id_b: lawB.lawId,
      aligned: aligned.sort((a, b) => b.similarity - a.similarity),
      gap_clauses: [
        ...uniqueA.map((id) => ({
          law_id: lawA.lawId,
          clause_id: id,
          reason: `No aligned clause in ${lawB.lawId} (similarity < 0.35)`,
        })),
        ...uniqueB.map((id) => ({
          law_id: lawB.lawId,
          clause_id: id,
          reason: `No aligned clause in ${lawA.lawId} (similarity < 0.35)`,
        })),
      ],
      unique_clauses: [
        ...uniqueA.map((id) => ({ law_id: lawA.lawId, clause_id: id })),
        ...uniqueB.map((id) => ({ law_id: lawB.lawId, clause_id: id })),
      ],
    },
    missingLawId: null,
  };
}
