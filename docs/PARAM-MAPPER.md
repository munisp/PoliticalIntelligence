# G3 — Legal-NLP → Simulation-Parameter Mapper

One-click "simulate this bill": automatically translates a law's extracted
legal constructs into ranked, analyst-reviewable scenario parameter
candidates. **Deterministic rule-based mapping — no LLM calls.**

## Flow

```
law / document ──► legal NLP (clauses, obligations)      services/documents
                 ──► POST /v1/param-map                  param_mapper.py
                 ──► scenarios.mapBillToParameters       api/scenarios.ts
                 ──► "From legislation" review table     ScenarioBuilder.tsx
                 ──► analyst approves ──► scenario form
```

## Components

| Layer | Location | What it does |
|---|---|---|
| Mapper | `services/documents/app/param_mapper.py` | Deterministic clause → candidate mapping |
| Endpoint | `services/documents/app/main.py` — `POST /v1/param-map` | Standard envelope; body: `{document_id}` or `{clauses[]}`, `top_k` |
| Contract | `contracts/param-mapper.ts` | Zod schemas for candidates / rationale / input |
| Bridge | `api/bridges/paramMapper.ts` | Remote-first with deterministic in-process fallback (same rules) |
| Procedure | `api/scenarios.ts` — `scenarios.mapBillToParameters` | Input: `law_id` or `document_id`; role-gated (`simulation_specialist`, `policy_analyst`); audited |
| Review UI | `src/components/simulation/ScenarioBuilder.tsx` — "From legislation" | Pick law → fetch → edit table → approve → applies to form |

## Mapping rules

* **Instrument taxonomy** (keyword rules, first match wins; penalty wins when
  the clause carries a prohibition): `tax_credit`, `subsidy`,
  `procurement_quota` (checked before `grant` so "grant a margin of
  preference for local content" classifies as a quota), `grant`,
  `training_levy`, `regulatory_threshold`, `penalty`.
* **Scale estimation**: percentages (`7.5%`, `10 per cent`), currency
  amounts (`₦250 million`, `NGN 5,000 thousand` — a currency hint is
  required so section numbers are not misread), durations (`5 years` → 60
  months).
* **Sector lexicon**: agriculture, manufacturing, ICT, construction,
  energy, health, education (longest keyword hit wins).
* **Target population hints**: SME, youth, women.
* **Confidence**: `min(0.99, rule_weight × clause_confidence + Σ bonuses)`
  where bonuses reward corroborating parameters (scale/amount/duration/
  sector/population). Candidates for the same `(instrument, sector)` merge;
  ranking is confidence desc (stable tie-break). Same input ⇒ same output.

## Output (every candidate)

```jsonc
{
  "instrument": "training_levy",
  "scale_percent": 1.0,
  "amount_ngn": null,
  "duration_months": null,
  "sector": null,
  "target_population": [],
  "confidence": 0.8475,
  "rationale": [
    { "clause_id": "clause:5", "section_path": "s.5",
      "span": "…pay a training levy of 1 per cent…",
      "parameter": "scale_percent" }
  ],
  "requires_analyst_review": true   // always — analyst sign-off mandatory
}
```

`rationale` spans are verbatim excerpts of the clause text that produced
each parameter (shown as the "why" tooltip in the review table).

## Tests

* `services/documents/tests/test_param_mapper.py` — 27 tests: every
  instrument class, scale parsing edge cases, sector lexicon, populations,
  ranking/merge, determinism, endpoint envelope + error paths.
* `api/tests/param-mapper.test.ts` — 8 tests: bridge rule parity,
  determinism, contract validation, role gating, seeded-law procedure with
  fallback source, 404.
