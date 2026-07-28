/**
 * §9.2 recommendation output-contract validation (TypeScript port of
 * services/ai/app/llm/prompts/contract.py — same semantics).
 *
 * Two entry points:
 *  - `validateRecommendationContract(raw)` for RAW LLM text: extracts the
 *    JSON object (repairing markdown fences / surrounding prose — that
 *    extraction counts as the "repair" flag, exactly like the Python
 *    validator) and validates the §9.2 shape.
 *  - `validateRecommendationObject(obj)` for already-parsed recommendation
 *    objects (remote bridge responses, offline fallback output) — the same
 *    field/type rules against the TS Recommendation shape.
 *
 * Callers get ONE repair retry (`generateWithContract` re-invokes the
 * generator with `repairPrompt` output; the HTTP bridge re-POSTs with the
 * validation errors attached). If the output is still invalid after the
 * retry, `RecommendationContractError` is thrown and the job MUST fail —
 * invalid recommendations are never persisted.
 */

export const REQUIRED_LIST_KEYS = [
  "assumptions",
  "evidence_base",
  "budget_ranges",
  "timeline",
  "implementation_actors",
  "legal_dependencies",
  "risk_register",
  "kpis",
  "simulation_scenarios",
] as const;

export const REQUIRED_SCALAR_KEYS = [
  "title",
  "rationale",
  "estimated_jobs",
  "confidence",
] as const;

export interface ContractResult {
  ok: boolean;
  data: Record<string, unknown> | null;
  errors: string[];
  /** True when the JSON had to be extracted from fences/prose. */
  repaired: boolean;
}

export class RecommendationContractError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`recommendation contract validation failed: ${errors.join("; ")}`);
    this.name = "RecommendationContractError";
    this.errors = errors;
  }
}

/* ------------------------- raw-text extraction ------------------------ */

/**
 * Extract a JSON object from raw LLM output.
 * Returns { obj, repaired, error }. `repaired` is true when the object had
 * to be recovered from markdown fences or surrounding prose.
 */
export function extractJson(raw: string): {
  obj: Record<string, unknown> | null;
  repaired: boolean;
  error: string | null;
} {
  const text = raw.trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { obj: parsed as Record<string, unknown>, repaired: false, error: null };
    }
    return { obj: null, repaired: false, error: "top-level JSON is not an object" };
  } catch {
    /* fall through to repair */
  }
  // Repair: strip code fences.
  const fenced = text.replace(/^```(?:json)?\s*|\s*```$/gm, "");
  // Repair: take the first balanced {...} block.
  const start = fenced.indexOf("{");
  if (start === -1) return { obj: null, repaired: false, error: "no JSON object found in output" };
  let depth = 0;
  for (let i = start; i < fenced.length; i++) {
    const ch = fenced[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(fenced.slice(start, i + 1)) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return { obj: parsed as Record<string, unknown>, repaired: true, error: null };
          }
          return { obj: null, repaired: true, error: "top-level JSON is not an object" };
        } catch (exc) {
          return { obj: null, repaired: true, error: `JSON parse error: ${exc}` };
        }
      }
    }
  }
  return { obj: null, repaired: true, error: "unbalanced braces in output" };
}

/* ------------------------------ validation ---------------------------- */

/**
 * Validate a parsed object against the §9.2 contract shape. Returns the
 * list of violations (empty = valid). Accepts both the raw-LLM variant
 * (`estimated_jobs` integer) and the TS contract variant
 * (`estimated_jobs` {min,max,expected}) — both are spec-conformant; the
 * gateway normalizes to the TS shape.
 */
export function validateRecommendationObject(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["recommendation is not an object"];
  const obj = input as Record<string, unknown>;
  for (const key of REQUIRED_SCALAR_KEYS) {
    if (!(key in obj)) errors.push(`missing required key: ${key}`);
  }
  for (const key of REQUIRED_LIST_KEYS) {
    if (!Array.isArray(obj[key])) errors.push(`key must be a list: ${key}`);
  }
  if (typeof obj.title === "string" && obj.title.trim() === "") {
    errors.push("title must be a non-empty string");
  }
  if (typeof obj.rationale === "string" && obj.rationale.trim() === "") {
    errors.push("rationale must be a non-empty string");
  }
  const evidence = obj.evidence_base;
  if (Array.isArray(evidence)) {
    if (evidence.length < 1) {
      errors.push("evidence_base must contain at least 1 item");
    } else if (
      !evidence.every(
        (e) =>
          e &&
          typeof e === "object" &&
          typeof (e as { citation?: unknown }).citation === "string" &&
          ((e as { citation: string }).citation ?? "").length > 0,
      )
    ) {
      errors.push("every evidence_base item needs a citation");
    }
  }
  const conf = obj.confidence;
  if (
    conf !== undefined &&
    conf !== null &&
    !(typeof conf === "number" && Number.isFinite(conf) && conf >= 0 && conf <= 1)
  ) {
    errors.push("confidence must be a number in [0, 1]");
  }
  const jobs = obj.estimated_jobs;
  if (jobs !== undefined && jobs !== null) {
    const intOk = typeof jobs === "number" && Number.isInteger(jobs);
    const rangeOk =
      typeof jobs === "object" &&
      jobs !== null &&
      ["min", "max", "expected"].every(
        (k) => typeof (jobs as Record<string, unknown>)[k] === "number",
      );
    if (!intOk && !rangeOk) {
      errors.push("estimated_jobs must be an integer or {min,max,expected}");
    }
  }
  return errors;
}

/** Validate raw LLM output text against the §9.2 contract shape. */
export function validateRecommendationContract(raw: string): ContractResult {
  const { obj, repaired, error } = extractJson(raw);
  if (obj === null) {
    return { ok: false, data: null, errors: [error ?? "unparseable"], repaired };
  }
  const errors = validateRecommendationObject(obj);
  return { ok: errors.length === 0, data: errors.length === 0 ? obj : null, errors, repaired };
}

/** Throw when a parsed recommendation violates the contract. */
export function assertValidRecommendation(obj: unknown): void {
  const errors = validateRecommendationObject(obj as Record<string, unknown>);
  if (errors.length > 0) throw new RecommendationContractError(errors);
}

/* ------------------------------ repair flow --------------------------- */

/** Prompt for the single allowed repair retry (mirrors contract.py). */
export function repairPrompt(
  originalPrompt: string,
  badOutput: string,
  errors: string[],
): string {
  return (
    `${originalPrompt}\n\n` +
    "Your previous answer FAILED the output contract:\n" +
    errors.map((e) => `- ${e}`).join("\n") +
    "\nPrevious answer:\n" +
    badOutput.slice(0, 2000) +
    "\nReturn ONLY the corrected JSON object."
  );
}

export interface GenerateWithContractOutcome {
  /** Parsed, contract-valid object — null when generation/validation failed. */
  data: Record<string, unknown> | null;
  result: ContractResult;
  /** Number of repair re-prompts issued (0 or 1). */
  repairAttempts: number;
}

/**
 * Generate via a text generator and validate against the §9.2 contract.
 * On contract failure the generator is re-prompted ONCE with the validation
 * errors appended (maxRepairs=1, matching the Python service). Returns the
 * final outcome; callers fall back / fail the job when `data` is null.
 */
export async function generateWithContract(
  generate: (prompt: string) => Promise<string | null>,
  prompt: string,
  opts: { maxRepairs?: number } = {},
): Promise<GenerateWithContractOutcome> {
  const maxRepairs = opts.maxRepairs ?? 1;
  let text = await generate(prompt);
  if (text === null) {
    return {
      data: null,
      result: { ok: false, data: null, errors: ["offline"], repaired: false },
      repairAttempts: 0,
    };
  }
  let result = validateRecommendationContract(text);
  let repairAttempts = 0;
  while (!result.ok && repairAttempts < maxRepairs) {
    repairAttempts += 1;
    text = await generate(repairPrompt(prompt, text, result.errors));
    if (text === null) {
      return {
        data: null,
        result: { ok: false, data: null, errors: ["offline"], repaired: false },
        repairAttempts,
      };
    }
    result = validateRecommendationContract(text);
  }
  return { data: result.ok ? result.data : null, result, repairAttempts };
}
