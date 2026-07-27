# UI Innovations — 8 frontend innovations + data-provenance UI

Branch: `feat-innovations-frontend`. All routes live under `/innovations/*`,
mounted as a single nested route in `src/App.tsx` (`INNOVATIONS-ROUTE`) with one
secondary-nav item in `src/components/Layout.tsx` (`INNOVATIONS-NAV`).

## What / where

| # | Feature | Entry | Notes |
|---|---------|-------|-------|
| 1 | Provenance system | `src/components/provenance/` | `ProvenanceChip` (live=teal globe / derived=periwinkle sigma / seed=muted package + label + tooltip with `source_url`/`fetched_at`; never color-only), `TrustScoreBadge` (segmented meter + 4-component popover), `ProvenanceBanner` (≥80% seed → honest demo-data notice linking to Data Source Health) |
| 2 | Jurisdiction Onboarding Wizard | `src/pages/innovations/Onboarding.tsx` | 4 steps: pack cards → review (hierarchy tree, LIVE connector badges, seed-policy honesty panel) → run (mutation, polled progress, aria-live log stream) → done (live/derived/seed counts + Switch-jurisdiction CTA). Idempotency key per attempt. Language switcher in header. |
| 3 | Budget Portfolio Optimizer | `src/pages/innovations/Optimizer.tsx` | ₦-formatted budget input, intervention multi-select (from `opportunities.rankings`), max-risk radios + sector-cap toggles, selected-portfolio cards, mono totals, binding-constraint callouts, print/export (print stylesheet hides input column). |
| 4 | Scenario Marketplace | `src/pages/innovations/Marketplace.tsx` | Template cards (author, installs, star rating, `ApprovalBadge` state), install dialog → `/simulation` link, publish dialog sourcing `scenarios.list` with human-review-gate notice. |
| 5 | NL Scenario Builder | `src/pages/innovations/NlBuilder.tsx` | Example prompts, parse → per-field `ConfidenceChip` cards, needs_review highlights, config JSON + copy button + instructions for Simulation Studio (no edit to the Simulation page per constraints). |
| 6 | Field Data Collection | `src/pages/innovations/FieldData.tsx` | Offline-first facility survey; `useOnlineStatus`, localStorage queue, auto-sync on reconnect with `offline_id` idempotency, dedupe feedback, submissions list with `ProvenanceChip`. |
| 7 | Audit Explorer | `src/pages/innovations/AuditExplorer.tsx` | `ops.auditLog` cursor pagination (Newer/Older), action/entity/actor filters, mono request/correlation ids, hash-chain verification panel (gold seal / danger callout with `first_broken_id`), JSON blob export. |
| 8 | Legal QA / IAA board | `src/pages/innovations/LegalQa.tsx` | `legislation.reviewQueue` board; two-annotator agreement (agree/disagree/partial/single) computed client-side from dual `annotations` entries when present; confidence heat bars; reassign dropdown disabled with honest tooltip (no endpoint yet). |
| 9 | i18n packs | `src/i18n/` (`en`, `ha`, `yo`, `ig`) + `src/lib/LocaleContext.tsx` | Typed dictionaries (shape enforced against English), `useT()` hook, `LocaleProvider`, `LanguageSwitcher` (in wizard). Demonstrated on new pages only — existing pages untouched. |
| 10 | Router + gallery | `src/pages/innovations/index.tsx` | `InnovationsRouter` + "Platform Innovations" gallery (7 feature cards + provenance system embedded across pages). |

## Contracts consumed

All innovation/onboarding calls go through `src/lib/innovations-client.ts`:
a loosely-typed vanilla tRPC client (procedures ship on a parallel backend
branch and are absent from this branch's `AppRouter` type) + typed wrappers +
react-query hooks. Envelopes are unwrapped via `unwrap()`.

- `onboarding.listPacks / getPack / onboard / status / jurisdictions`
- `innovations.scoreDecomposition` (wrapper exported; consumed by TrustScoreBadge sibling flows)
- `innovations.optimizePortfolio`, `marketplace.list/install/publish`,
  `parseScenarioText`, `trustScore`, `verifyAuditChain`,
  `fieldData.list/submit`
- Existing typed procedures reused: `ops.auditLog`, `legislation.reviewQueue`,
  `opportunities.rankings`, `scenarios.list`, `jurisdictions.profile`.
- Additive optional `provenance` on rankings/profile payloads is read
  defensively (`ProvenanceChipFromInfo` renders nothing when absent).

## Graceful degradation

`isProcedureMissing()` detects NOT_FOUND-style errors; pages render a designed
"Service not deployed yet" empty state instead of crashing. Queries retry only
for non-missing-procedure errors.

## Surgical edits to existing files

- `src/App.tsx`: one import + one nested route (`INNOVATIONS-ROUTE`).
- `src/components/Layout.tsx`: one secondary-nav item (`INNOVATIONS-NAV`) + `Sparkles` icon import.
- `src/pages/Opportunities.tsx`: additive wrapper div overlaying a
  `ProvenanceChipFromInfo` on each ranking row (marked `INNOVATIONS-PROVENANCE`); shared `RankingRow` untouched.
- `src/pages/Dashboard.tsx`: one jurisdiction-provenance chip above the KPI row (marked `INNOVATIONS-PROVENANCE`).
- `tsconfig.server.json`: created — it was referenced by `tsconfig.json` but
  never tracked, so `npx tsc -b` failed on the base branch. Covers `api/`, `db/`, `contracts/`, `services/`.

## Limitations

- Backend procedures for the innovation routers are not on this branch; all
  innovation pages show designed empty/error states until the API ships.
- NL builder cannot pre-fill Simulation Studio (editing `Simulation.tsx` was
  out of scope) — it renders copyable config JSON + instructions instead.
- Field-data photo capture is a disabled placeholder (low-bandwidth build).
- Legal QA reassignment is disabled until a reassign endpoint exists.
- Provenance chips on Opportunities/Dashboard appear only when the API
  includes the additive `provenance` field.
