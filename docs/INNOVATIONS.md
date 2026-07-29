# Platform Innovations

Twenty innovations shipped on the Meridian Policy Twin platform: 12 backend
(this branch, `feat-gaps-backend`) and 8 frontend (owned by the frontend
track). Backend procedures live in `api/innovations.ts` (tRPC router
`innovations.*`), with contracts in `contracts/innovations.ts` and queries in
`api/queries/innovations.ts`. All are envelope-wrapped, zod-validated,
RBAC/ABAC-gated where mutating, and deterministic where numeric.

## Backend innovations

1. **Evidence Trust Score** — `innovations.trustScore(evidence_source_id)`
   computes a composite 0–1 trust score: 0.35 × source authority (tier table
   in `contracts/innovations.ts`: official statistics .95, ministry .85,
   registry .8, crowdsourced .6, unknown .4), 0.25 × exponential freshness
   decay, 0.25 × corroboration (independent sources linked to the same
   entities), 0.15 × extraction confidence. The response explains every
   component so analysts can defend the number. *Why:* evidence-backed
   decisions need an auditable trust signal, not a black box. *Status:* shipped, tested.

2. **Opportunity score decomposition** — `innovations.scoreDecomposition`
   returns a waterfall of signed feature contributions (jobs potential,
   fiscal cost, readiness, evidence strength, risk penalty) recomputed
   deterministically from stored metrics; contributions are scaled so they
   sum to the stored score within 1e-6. *Why:* ranked cards must be
   explainable to executives. *Status:* shipped, tested (sum identity asserted).

3. **Assumption sensitivity ranking** — `innovations.assumptionSensitivity(scenario_id)`
   re-runs the deterministic fallback forecast engine at ±20% per numeric
   assumption entry (shares of total assumption mass) and ranks entries by
   swing in final-year employment. *Why:* tells analysts which assumption to
   defend in the review meeting. *Status:* shipped, tested (ordering asserted).

4. **Counterfactual backtesting harness** — `innovations.backtest.run` (async
   job) trains on the pre-cutoff series, projects the remainder, and scores
   MAPE + a clamped skill score with an actual-vs-projected chart series;
   `innovations.backtest.status(job_id)` polls. Handler in `api/runner.ts`.
   *Why:* engines must prove out-of-sample skill before executives trust
   projections. *Status:* shipped, tested.

5. **Sector jobs-multiplier library** — `sector_multipliers` table
   (direct/indirect/induced, source, confidence) seeded from documented
   literature ranges (ILO, World Bank, OECD, IFPRI, GSMA — provenance labelled
   per row); `innovations.multipliers.list` exposes them; engines accept
   multiplier overrides via execution profiles. *Why:* replaces magic numbers
   with citable ranges. *Status:* shipped, seeded, tested.

6. **Cross-jurisdiction policy diff** — `innovations.policyDiff({law_id_a,
   law_id_b})` computes clause-level alignment with an in-process TF-IDF
   cosine similarity matrix, returning aligned pairs (≥0.35), gap clauses,
   and unique clauses. Deterministic (pure function of clause text). *Why:*
   states copying legislation need to see exactly what differs. *Status:*
   shipped, tested (determinism asserted).

7. **Procurement leakage & local-content analyzer** —
   `innovations.procurementAnalysis(jurisdiction_id)` computes supplier
   concentration (HHI), repeat-award ratio, local vs non-local share, and
   flagged patterns with evidence references. `procurement_records` does not
   exist yet, so it analyzes the procurement-shaped seed (proc-sector
   opportunities + interventions) and returns `data_origin:
   "derived_from_opportunities"` explicitly. *Why:* leakage hides in
   concentration and repeat awards. *Status:* shipped, tested.

8. **Adaptive twin recalibration loop** — `innovations.recalibrate(jurisdiction_id)`
   (async job) pulls the latest `sector_metrics`, nudges twin-state priors
   (70% prior / 30% observation), persists versioned `twin_states` rows, and
   emits a drift report of priors that moved >5%. *Why:* a digital twin that
   never recalibrates drifts into fiction. *Status:* shipped, tested.

9. **Scenario template marketplace** — `scenario_templates` table +
   `innovations.marketplace.list/publish/install`. Publish lands in human
   review (`in_review`; even "approved" submissions are forced through
   review); install materializes a real scenario for the caller's
   jurisdiction only from approved templates and increments the install
   counter. Seeded with 3 templates. *Why:* jurisdictions reuse what works.
   *Status:* shipped, tested (approval gate asserted).

10. **Budget portfolio optimizer** — `innovations.optimizePortfolio({jurisdiction_id,
    budget_ngn, intervention_ids, constraints})` runs a greedy value-density
    (jobs/₦m) knapsack with exchange refinement, honoring `max_risk` and
    sector constraints, returning the selected set, expected jobs, cost, and
    binding constraints. Mirrors the simulation service's optimization engine
    logic in TypeScript. *Why:* budget nights need a defensible first-cut
    allocation in seconds. *Status:* shipped, tested (budget cap asserted).

11. **NL scenario builder** — `innovations.parseScenarioText({text,
    jurisdiction_id})` deterministically parses sector keywords, ₦/NGN budget
    figures (m/bn/million/billion suffixes → ₦ millions), horizons ("3
    years" → 36 months), and intervention hints into a validated scenario
    config with per-field confidence and `needs_review` flags; the AI bridge
    is consulted when reachable (`llm_assisted` flag) but the fallback parser
    always works. *Why:* policy staff think in prose, not JSON. *Status:*
    shipped, tested.

12. **Signed webhooks / event subscriptions** — `webhook_subscriptions` table
    + `innovations.webhooks.create/list/test`. The event bus
    (`api/utils/events.ts`) delivers HMAC-SHA256 signed payloads
    (`X-PolicyTwin-Signature`) with 3-retry backoff; the test endpoint sends a
    ping. Seeded with 1 subscription. Includes the **model/prompt regression
    harness**: `services/ai/app/regression.py` holds a golden set of 10 policy
    questions with expected citation domains; the runner scores offline
    synthesizer outputs on citation presence, contract completeness, and
    determinism; `GET /v1/regression/latest` on services/ai returns the latest
    report. *Why:* downstream systems need trustworthy push notifications and
    model changes need regression evidence. *Status:* shipped, tested
    (28 pytest tests green).

## Frontend innovations (owned by the frontend track)

13. **Onboarding wizard UI** — guided first-run flow for jurisdiction, sector,
    and data-source setup. *Where:* `src/` (onboarding). *Status:* owned by frontend agent.

14. **Field-data-collection PWA forms** — offline-capable mobile forms feeding
    the ingestion pipeline. *Where:* `src/`, `mobile/` PWA shell. *Status:* owned by frontend agent.

15. **NL builder UI** — chat-style scenario authoring over
    `innovations.parseScenarioText` with confidence and `needs_review`
    surfacing. *Where:* `src/` scenario builder. *Status:* owned by frontend agent; backend contract shipped here (#11).

16. **Legal QA / IAA board** — inter-annotator agreement review board for
    legal clause extraction. *Where:* `src/` legislation review. *Status:* owned by frontend agent.

17. **Optimizer UI** — budget envelope controls and constraint toggles over
    `innovations.optimizePortfolio`. *Where:* `src/` portfolio view. *Status:* owned by frontend agent; backend shipped here (#10).

18. **Score waterfall UI** — visual decomposition of opportunity scores over
    `innovations.scoreDecomposition`. *Where:* `src/` opportunity detail. *Status:* owned by frontend agent; backend shipped here (#2).

19. **i18n packs** — internationalization resource packs (EN/HA/FR) for the
    platform chrome. *Where:* `src/` i18n. *Status:* owned by frontend agent.

20. **Audit explorer** — hash-chain-aware audit log browser with verify
    status from `auditLog.verify`. *Where:* `src/` admin. *Status:* owned by frontend agent; backend verification shipped here.

## Wave: feat-innov-1-5 (I1–I5)

### I1 — Policy Radar (weekly digest)
- **What:** weekly digest of new bills, regulations and budget lines scored
  by a deterministic impact rubric (sector keyword weight × instrument type ×
  amount magnitude, log-scaled), idempotent on `alertId`
  ("alert:<sourceEntity>:<sourceRef>").
- **Where:** table `policy_alerts` (db/schema.ts, migration 0002); contracts
  in `contracts/radar.ts`; router `api/radar.ts` (`radar.alerts` ABAC-scoped
  feed, `radar.scan` policy_analyst/data_steward mutation); queries in
  `api/queries/radar.ts`; weekly job handler `radar.weeklyScan` registered in
  `api/runner.ts`; extension event topic `policy.alert` (schema registered via
  `registerEventSchema`, fan-out capped at 50/scan); UI `src/pages/Radar.tsx`
  at `/radar` (nav "Radar"); i18n keys `nav.radar` + `radar.*` (en; ha/yo/ig
  English fallback).
- **Status:** shipped, tested (api/tests/radar.test.ts, 7 vitest tests green).

### I2 — Opportunity embed widgets
- **What:** public, sanitized, rate-limited embed cards + iframe-safe HTML
  snippets for opportunities; per-row "Embed" button on the Opportunities
  page copies the snippet.
- **Where:** contracts `contracts/embed.ts`; router `api/embed.ts`
  (`embed.opportunityCard`, `embed.scriptTag`; 60 req/min fixed-window
  limiter, HTML-escaped script-free markup); UI
  `src/components/opportunities/EmbedButton.tsx` + row hook in
  `src/pages/Opportunities.tsx`; i18n `embed.*`; docs `docs/EMBED.md`.
- **Status:** shipped, tested (api/tests/embed.test.ts, 4 vitest tests green).

### I3 — Corridor Twin
- **What:** delivery milestones + deterministic schedule/funding variance
  for infrastructure corridors; seeded Lagos–Calabar (9 milestones:
  S1 financing close, ESIA disclosure, S1 CRCP sections, S1 commissioning
  2025-05, S2 financing $1.126B, solar lighting pilot, rail-median study,
  S2 CRCP works, full-corridor 2030 target).
- **Where:** table `corridor_milestones` (db/schema.ts, migration 0003);
  additive seed in `db/seed-lagos-calabar.ts` (`CORRIDOR_MILESTONES`,
  idempotent via milestoneId); contracts `contracts/corridors.ts`
  (`computeMilestoneVariance` pure math); router `api/corridors.ts`
  (`corridors.progress`, `corridors.variance`, `corridors.list`); UI
  `src/components/simulation/CorridorPanel.tsx` (Recharts timeline +
  variance bars, evidence links) at `/corridors`, linked from Simulation
  (no nav addition); i18n `corridors.*`.
- **Status:** shipped, tested (api/tests/corridors.test.ts, 6 vitest tests green).

### I4 — Legislative diff-impact analyzer
- **What:** diffs two versions of a bill (clauses A vs B): added/removed/
  changed obligations (reusing legal-NLP modal rules), parameter deltas
  (instrument/scale via the G3 param-mapper structures), deterministic
  impact note per change.
- **Where:** `services/documents/app/diff_impact.py` + POST `/v1/diff-impact`
  in `services/documents/app/main.py` (7 pytest tests); contracts
  `contracts/diff-impact.ts`; bridge + deterministic in-process fallback in
  `api/lib/diff-impact.ts`; endpoint `legislation.diffImpact`
  ({fromLawId|docA, toLawId|docB}, audit-logged, `engine` honesty marker)
  in `api/legislation.ts`; UI "Parameter impact" section
  `src/components/legislation/DiffImpactPanel.tsx` on the Legislation page;
  i18n `diffImpact.*`.
- **Status:** shipped, tested (api/tests/diff-impact.test.ts 8 vitest +
  services/documents/tests/test_diff_impact.py 7 pytest, all green).

### I5 — Advocacy CRM
- **What:** per-analyst engagement log on stakeholders: log form, history
  and next-action tracking inside the StakeholderMap detail drawer.
- **Where:** table `stakeholder_engagements` (db/schema.ts, migration
  0004); contracts appended in `contracts/advocacy.ts`; procedures appended
  in `api/advocacy.ts` (`advocacy.logEngagement` authed + validated +
  audited, `advocacy.engagements` own-user scoped, `advocacy.upcomingActions`
  with daysUntil); queries in `api/queries/advocacy.ts`; UI
  `src/components/advocacy/EngagementsSection.tsx` in the StakeholderMap
  drawer; i18n `engagements.*`.
- **Status:** shipped, tested (api/tests/advocacy-crm.test.ts, 5 vitest tests green).
## I6 — Public participation module (feat-innov-6-10)

Citizens comment on bills (anonymous allowed with a pseudonym); bodies and
pseudonyms are PII-redacted at the API boundary (`api/utils/pii`) before
persistence, and posting is rate-limited per actor/IP. A deterministic
keyword-bucket engine (`contracts/participation.ts`) tags comments into fixed
policy themes and aggregates counts per theme with a sentiment split — no ML,
identical inputs always yield identical summaries. Moderation
(flag/hide/restore) is gated to platform_admin / data_steward with audit
events. *Where:* `api/participation.ts`, `contracts/participation.ts`,
`db/schema.ts` (`bill_comments`), `src/components/legislation/BillComments.tsx`
(theme-summary bar + form on the Legislation workbench).

## I7 — State domestication tracker (feat-innov-6-10)

Federal law × (36 states + FCT) domestication grid. Seed covers the Nigeria
Startup Act 2022, NDPA 2023 and Land Use Act amendment proposals with
realistic mixed statuses (all origin="derived", upgradeable to "live").
`domestication.matrix` returns the full 37-cell grid with per-status counts
(missing cells default to not_started); `domestication.update` is
data_steward-gated, upserts one cell and audits. *Where:*
`api/domestication.ts`, `contracts/domestication.ts`,
`db/seed-domestication.ts`, `src/pages/Domestication.tsx` (heatmap grid +
state popover, nav "Tracker" at /tracker).

## I8 — Procurement match (feat-innov-6-10)

`matchmaking.suppliers` ranks CAC business_registrations against an
opportunity with a deterministic readinessScore (30% registration age, 30%
sector keyword match, 20% LGA/jurisdiction proximity, 20% SMEDAN-style size
class from entity_type); `matchmaking.readiness` returns the per-supplier
breakdown. Pure scoring lives in `contracts/matchmaking.ts`. UI: "Matched
suppliers" panel with readiness bars in the expanded opportunity row.

## I9 — Scenario marketplace (feat-innov-6-10)

`published_scenarios` share reproducible simulation runs across
jurisdictions. `marketplace.publish` requires a persisted DM-3 manifest +
reproducibility hash (simulation_specialist / policy_analyst, audited);
`marketplace.list` is public; `marketplace.fork` creates a new draft scenario
from the published assumptions and increments forkCount; `marketplace.verify`
recomputes sha256(manifest + result_summary) → badge valid|stale. UI:
`src/pages/innovations/Marketplace.tsx` rewired from the template mock to the
real router (verify badge per card, fork flow, publish dialog with run
picker), design preserved.

## I10 — Field verification loop (feat-innov-6-10)

`field_verifications` store GPS-stamped verdicts (confirmed / disputed /
needs_review) by field_officer / data_steward against milestones, projects
and outcome metrics (entity refs like `series:{id}:{period}`). New platform
role `field_officer`. Outcomes upgrade hook: `outcomes.getObservations`
attaches `verification_status` (field_verified once ≥2 confirmed
verifications exist for that series period, else unverified). UI: FieldData
page gains a verification section — browser-geolocation GPS capture, verdict
+ notes form, per-entity verification list.
