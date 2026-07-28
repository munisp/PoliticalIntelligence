/**
 * PII redaction (AI-11, NDPC posture in docs/SECURITY.md).
 *
 * Applied on (a) copilot/query inputs before the LLM bridge, (b) document /
 * field-data ingestion payloads, and (c) audit payloads — via the tRPC input
 * middleware in api/middleware.ts and the event consumers in api/consumers.ts.
 *
 * Redaction events are logged as COUNTS ONLY; matched PII is never logged,
 * stored, or emitted. Replacement tokens are stable per pattern type
 * (`[REDACTED:email]`, ...) so downstream flows remain deterministic.
 */

export type PiiPatternName =
  | "email"
  | "phone_ng"
  | "bvn_nin"
  | "name_labeled";

export interface PiiPattern {
  name: PiiPatternName;
  regex: RegExp;
  token: string;
}

/**
 * Default configurable pattern set (extend via PII_EXTRA_PATTERNS as a JSON
 * array of {name, pattern, flags} — validated defensively at load).
 *
 * - email: RFC-5322-ish addresses.
 * - phone_ng: Nigerian formats — +234XXXXXXXXXX, 234XXXXXXXXXX, 0XXXXXXXXXX
 *   (mobile/landline, 10-11 significant digits).
 * - bvn_nin: standalone 11-digit numbers (BVN / NIN).
 * - name_labeled: free-text fields that LABEL a person ("my name is X",
 *   "contact: X", "attn: X") — only the captured name is redacted.
 */
export const DEFAULT_PII_PATTERNS: PiiPattern[] = [
  {
    name: "email",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    token: "[REDACTED:email]",
  },
  {
    name: "phone_ng",
    regex: /(?:\+234|234|0)(?:7\d|8\d|9\d|70|80|81|90|91|01)\d{7,8}\b/g,
    token: "[REDACTED:phone]",
  },
  {
    name: "bvn_nin",
    regex: /\b\d{11}\b/g,
    token: "[REDACTED:id]",
  },
  {
    name: "name_labeled",
    regex:
      /\b(?:my name is|name\s*:|contact\s*:|attn\s*:|attention\s*:)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g,
    token: "[REDACTED:name]",
  },
];

function extraPatterns(): PiiPattern[] {
  const raw = process.env.PII_EXTRA_PATTERNS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      name?: string;
      pattern?: string;
      flags?: string;
    }[];
    return parsed.flatMap((p) => {
      if (!p?.name || !p?.pattern) return [];
      try {
        return [
          {
            name: p.name as PiiPatternName,
            regex: new RegExp(p.pattern, p.flags ?? "g"),
            token: `[REDACTED:${p.name}]`,
          },
        ];
      } catch {
        return [];
      }
    });
  } catch {
    console.error("[pii] PII_EXTRA_PATTERNS is not valid JSON — ignored");
    return [];
  }
}

export function activePatterns(): PiiPattern[] {
  return [...DEFAULT_PII_PATTERNS, ...extraPatterns()];
}

export type RedactionCounts = Partial<Record<PiiPatternName | string, number>>;

export interface RedactionResult {
  text: string;
  counts: RedactionCounts;
  total: number;
}

/** Redact one string. Counts only — matched values are never retained. */
export function redactText(
  text: string,
  patterns: PiiPattern[] = activePatterns(),
): RedactionResult {
  const counts: RedactionCounts = {};
  let out = text;
  for (const p of patterns) {
    p.regex.lastIndex = 0;
    out = out.replace(p.regex, (...args) => {
      counts[p.name] = (counts[p.name] ?? 0) + 1 as number;
      // name_labeled keeps the label, redacts only the captured name (group 1)
      if (p.name === "name_labeled" && args.length > 2 && args[1]) {
        return args[0].replace(args[1], p.token);
      }
      return p.token;
    });
  }
  const total = Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
  return { text: out, counts, total };
}

/**
 * Deep-redact every string in a JSON-shaped payload (objects, arrays,
 * nested). Returns a new payload; the input is not mutated.
 */
export function redactPayload(
  value: unknown,
  patterns: PiiPattern[] = activePatterns(),
  counts: RedactionCounts = {},
): unknown {
  if (typeof value === "string") {
    const r = redactText(value, patterns);
    for (const [k, v] of Object.entries(r.counts)) {
      counts[k] = (counts[k] ?? 0) + (v ?? 0);
    }
    return r.text;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactPayload(v, patterns, counts));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactPayload(v, patterns, counts);
    }
    return out;
  }
  return value;
}

/**
 * Log a redaction event — COUNTS ONLY. Never pass the source text or the
 * matched values; doing so would defeat the control.
 */
export function logRedactionEvent(
  surface: string,
  counts: RedactionCounts,
): void {
  const total = Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (total === 0) return;
  console.info(
    `[pii] redaction surface=${surface} total=${total} by_pattern=${JSON.stringify(counts)}`,
  );
}
