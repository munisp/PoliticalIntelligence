# G4 — Evidence-Grounded Bill Drafting

End-to-end workflow for drafting new legislation backed by simulation
evidence: **purpose → evidence base → grounded clauses → RIA annex →
Akoma Ntoso export.**

## API procedures (`api/legislation.ts`)

| Procedure | Role | Description |
|---|---|---|
| `legislation.createDraft` | legal_analyst, policy_analyst | Creates a `laws` row (`status="draft"`, `category="draft_bill"`) with its evidence base (`simulation_run_id`, `opportunity_ids`, `citation_ids`) persisted in the additive `laws.evidence_base` json column. Linked evidence is validated up-front. |
| `legislation.generateClauses` | legal_analyst, policy_analyst | Generates the five canonical sections (definitions, instruments, obligations, enforcement, commencement) via the LLM serving layer (`api/bridges/drafting.ts`). **Every clause records `grounding`** — which evidence item(s) justify it — persisted in the additive `clauses.grounding` column. `only_sections` regenerates individual sections; clause ids are deterministic (`cls:<law>:gen:<section>`) so regeneration is idempotent. |
| `legislation.updateDraftClause` | legal_analyst, policy_analyst | Edit a generated clause's text; grounding and provenance are preserved. |
| `legislation.attachRIA` | legal_analyst, policy_analyst | Builds the Regulatory Impact Assessment annex from the draft's linked simulation run: engine consensus summary, point estimates with 80% uncertainty bands, assumptions, reproducibility hash (DM-3) and citations. Validated against `RiaAnnexSchema` and stored in `laws.ria_annex`. |
| `legislation.exportDraftAkn` | legal_analyst, policy_analyst | Emits Akoma Ntoso 3.0 XML (`doc_type="bill"`) via the documents service `POST /v1/akn/draft` (RIA as `<annex>`). Falls back to the local deterministic builder (`api/lib/akn.ts`) when the service is unreachable; the response reports `bridge: "service" \| "local"` and structural-check `problems`. |

All procedures use the standard envelope, are jurisdiction-ABAC scoped
(write access on the law's jurisdiction), and emit audit events
(`legislation.draft.created|clauses_generated|clause_edited|ria_attached|akn_exported`).

## Serving layer tiers

`api/bridges/drafting.ts` mirrors the recommendations bridge: it POSTs
`/v1/drafting/clauses`, enforces the `ClauseSet` contract
(`contracts/drafting.ts`) with one repair retry, and falls back to a
**deterministic offline synthesizer** (identical input ⇒ identical clause
set) when the remote tier is unreachable. A remote tier therefore flips
quality with configuration only — never code.

## Contracts

`contracts/drafting.ts` — zod schemas: `EvidenceBaseSchema`,
`DraftedClauseSchema` (+ `ClauseGroundingSchema`), `ClauseSetSchema`,
`RiaAnnexSchema` (+ validators used by the bridge for remote-tier
enforcement).

## Schema changes (additive only)

- `laws.evidence_base` json, `laws.ria_annex` json
- `clauses.heading` varchar(256), `clauses.grounding` json

Applied as additive `ALTER TABLE … ADD COLUMN` statements (drizzle-kit push
is interactive-only in this environment).

## Documents service

`services/documents/app/akn.py::build_draft_akn` serializes an
already-grounded draft (clauses + optional RIA dict) to AKN 3.0; exposed as
`POST /v1/akn/draft` returning `{akn_xml, problems}` inside the standard
envelope.

## UI

`src/components/legislation/DraftingPanel.tsx` — five-step wizard opened
from the "Drafting wizard" button in the Legislation workbench header:
(1) purpose/outcomes form, (2) evidence picker (simulation run id,
opportunity checkboxes, citation ids), (3) clause review with per-clause
grounding badges, inline edit and per-section regenerate, (4) RIA annex
preview (estimates, bands, hash), (5) AKN download.

## Tests

- `api/tests/drafting.test.ts` (9 tests): auth/role gates, audit trail,
  end-to-end against a seeded simulation run (real `simulations.run` job →
  manifest + reproducibility hash), offline-tier determinism, grounding
  presence, RIA contents, AKN well-formedness (saxes parse + structural
  markers).
- `services/documents/tests/test_akn.py` (+3 tests): draft writer with/without
  RIA annex, `/v1/akn/draft` endpoint envelope + validation.
