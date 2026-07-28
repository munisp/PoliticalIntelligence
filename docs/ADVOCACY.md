# Policy Advocacy Pathway

The "idea → legislation" backend: a curated Nigerian knowledge base of
regulatory pathways, stakeholders and their relation graph, plus a
deterministic idea analyzer.

## Tables (db/schema.ts, additive)

- **`stakeholders`** — `stakeholderId` natural key (`stk:cbn-governor`),
  `kind` (individual | committee | ministry | agency | association |
  state_body | development_partner), role/org/state/chamber, `sectorTags`
  json, `bio`, `influenceArea`, `lobbyAngle`, `contactNote` (public
  channels only), `relatedSectors`, `asOf` data-currency label, `origin`
  (live|derived|seed, default derived).
- **`stakeholder_edges`** — directed relation graph
  (`fromId`, `toId`, `relation` — oversees | member_of | chairs | lobbies |
  regulates | domesticates, `label`). Indexed on both endpoints.
- **`regulatory_pathways`** — `pathwayId` natural key
  (`pw:ng-fintech-tourism-payments`), `sector`, `jurisdictionScope`
  (federal|state|both), json `licenses` / `constraints` /
  `supportingLawRefs` / `associationRefs` / ordered `steps`.

## Seed KB (db/seed-advocacy.ts)

Standalone, idempotent: `npx tsx db/seed-advocacy.ts`. Existing natural
keys are skipped; edges dedupe on (from,to,relation).

- **47 stakeholders** — CBN Governor, ministers (Comms/Digital Economy,
  Tourism), NITDA/NIMC/NDPC heads, role-only entries where officeholders
  are not broadly established; 10 NASS + state-assembly committees;
  ministries/agencies (CBN, NITDA, NTDC, NIPC, SMEDAN, NIMC, NDPC, NIBSS,
  CAC, SCUML, OSGoF); state bodies (Lagos Lands Bureau, KADGIS, NGF,
  ALGON); associations (FintechNGR, NANTA, NESG, MAN, NACCIMA, NTDA,
  NIESV, SURCON).
- **Provenance honesty**: every row is `origin="derived"`,
  `asOf="2025-12"`, and every stakeholder carries
  `contactNote="verify currency before outreach"`.
- **44 edges** — oversight (committee→agency), leadership
  (individual→org), lobbying (association→committee), regulation,
  domestication (state body→federal ministry).
- **2 pathways**: `pw:ng-fintech-tourism-payments` (CBN PSSP/PTSP, NIBSS,
  NDPA registration, PCI-DSS, SCUML; CBN Act/BOFIA/NDPA/Startup
  Act/NTDC Act) and `pw:ng-land-management-platform` (Land Use Act 1978
  state-by-state reality; registry digitization MOU, SURCON/OSGoF
  standards, NIN integration, NDPA; Lagos/Kaduna pilot → NGF scaling).

## tRPC API (api/advocacy.ts, mounted at `advocacy`)

| Procedure | Access | Contract |
| --- | --- | --- |
| `advocacy.listPathways` | public | `{pathways: [{pathwayId, sector, title, summary, jurisdictionScope}]}` |
| `advocacy.getPathway {pathwayId}` | public | full detail: licenses, constraints, supportingLawRefs, associationRefs, steps |
| `advocacy.stakeholderMap {sector?, pathwayId?}` | public | `{nodes, edges}` filtered by sector tag or pathway associations, expanded with 1-hop neighbours |
| `advocacy.analyzeIdea {title, description, sector, jurisdictionScope}` | authed, policy_analyst+ | matchedPathways (fitScore 0–1 + rationale), supportingLaws, gaps, licenses, constraints, recommendedStakeholders, nextSteps, `meta.analysis_mode: "rule_based"` |
| `advocacy.pathwayChecklist {pathwayId}` | public | ordered steps + owners |

Zod schemas for every input/output live in **contracts/advocacy.ts** —
the frontend consumes these verbatim.

### analyzeIdea — rule_based v1

Deterministic scoring: keyword overlap between the idea text and pathway
title/summary/sector/supporting-law text (55%), sector alignment (30%),
jurisdiction-scope compatibility (15%). Supporting laws are the union of
matched-pathway refs and keyword matches over the platform `laws` table.
Gaps are honestly stated (e.g. high-severity constraints, thin KB
coverage). **LLM hook**: `ADVOCACY_LLM_HOOK` in `api/advocacy.ts` marks
where the LLM serving tier may later enrich rationale text — it must keep
deterministic fitScore ordering and update `meta.analysis_mode` so the UI
discloses provenance.

### RBAC & audit

`analyzeIdea` requires `policy_analyst` (also allows legal_analyst,
executive, data_steward, platform_admin) and writes an
`advocacy.analyze_idea` audit event with the matched pathway ids and
analysis mode. Read endpoints are public (aggregate reference data).
Pathways carry no per-jurisdiction rows, so ABAC jurisdiction scoping is
not applied; state-level stakeholders carry a `state` label instead.

## Tests

`api/tests/advocacy.test.ts` — 12 tests: table presence/population, seed
idempotency, provenance stamping, graph integrity, associationRef
integrity, router contract validation (listPathways / getPathway /
stakeholderMap / pathwayChecklist / analyzeIdea), role gating
(UNAUTHORIZED/FORBIDDEN) and the audit event.
