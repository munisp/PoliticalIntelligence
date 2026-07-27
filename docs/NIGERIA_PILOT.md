# Nigeria Reference Deployment & Pilot

Nigeria is the platform's reference deployment. This document captures the localization profile, pilot scope, data source catalog, onboarding sequence and checklist, pilot plans, and governance structure.

## Localization profile

- **Administrative hierarchy:** Federal → 36 states + FCT → 774 LGAs → wards. All entities are partitioned along this hierarchy (`jurisdiction_id` scheme: `nga-ng` → `nga-ng-<state>` → LGA/ward codes).
- **Governance context:** Federal and state executives (governors, ministries/MDAs), National and State Houses of Assembly, and subnational planning/budget offices are the primary users.
- **Data protection:** The **Nigeria Data Protection Commission (NDPC)** regime governs personal data handling. The platform's posture: minimize personal data (aggregate statistics first), classify every source for privacy at onboarding, keep data in-country, and retain a full audit trail (see `SECURITY.md`).
- **Language/localization:** English primary; currency NGN; fiscal-year-aware datasets.

## Pilot scope

Three pilot sectors chosen for data availability and political salience:

1. **Education** — enrolment, school facilities, UBEC/State UBEB interventions.
2. **SME formation** — business registrations, ease-of-formation bottlenecks, state-level drivers.
3. **Procurement-led job creation** — public procurement awards, SME award share, payment timeliness → employment effects.

## Data source catalog

| Source                                      | Publisher / URL                                                        | Content                                              | Access method            | Cadence    |
| ------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------ | ---------- |
| National Bureau of Statistics               | https://www.nigerianstat.gov.ng                                        | Macro & sector statistics, CPI, labour force, GDP    | Portal downloads/API     | Monthly–quarterly |
| NBS Microdata Catalog                       | https://microdata.nigerianstat.gov.ng                                  | Survey microdata (NLSMS, MICS partners)              | Catalog download (terms) | Per survey |
| National Assembly                           | https://nass.gov.ng                                                    | Bills, acts, legislative tracking                    | Web scraping (respectful)| Weekly     |
| Budget Office of the Federation             | https://budgetoffice.gov.ng                                            | Federal budgets, implementation reports              | Portal downloads         | Annual + quarterly |
| Corporate Affairs Commission (CAC)          | https://www.cac.gov.ng                                                 | Business registration statistics                     | Public reports / partnership | Monthly |
| Bureau of Public Procurement (BPP)          | https://www.bpp.gov.ng                                                 | Procurement plans, awards, NOC records               | Portal downloads         | Monthly–quarterly |
| Office of the Surveyor General (OSGoF)      | https://osgof.gov.ng                                                   | Official geodetic/boundary data                      | Partnership request      | On change  |
| GRID3                                       | https://grid3.org                                                      | Settlement extents, population grids, boundaries     | Open downloads           | Periodic   |
| Universal Basic Education Commission (UBEC) | https://factsheets.ubecedata.com                                       | School census factsheets (enrolment, facilities)     | Open factsheets          | Annual     |
| Nigeria Data Protection Commission (NDPC)   | https://ndpc.gov.ng                                                    | Regulatory guidance (governance reference, not data) | Web                      | As issued  |
| Open Treasury                               | https://opentreasury.gov.ng                                            | Treasury/payment transparency records                | Portal downloads         | Monthly    |
| Nigerian Electricity Regulatory Commission (NERC) | https://nerc.gov.ng                                               | Power-sector regulatory data (SME operating context) | Portal downloads         | Quarterly  |
| NELEX (National Electronic Labour Exchange) | https://nelex.gov.ng                                                   | Labour market / job matching data                    | Partnership              | Continuous |

Each catalog row maps to an `EvidenceSource` record (see `DATA_MODEL.md`) before any ingestion is enabled.

## Data onboarding sequence

1. **Geography first:** OSGoF + GRID3 boundaries into PostGIS; jurisdiction hierarchy into MySQL. Everything else keys off this.
2. **Statistics backbone:** NBS headline indicators → lakehouse + indicator store; UBEC education factsheets; CAC registration aggregates.
3. **Law & policy:** National Assembly bills/acts + Budget Office documents into the document pipeline (parse → OpenSearch/Neo4j).
4. **Procurement & treasury:** BPP awards + Open Treasury payments; link to agencies and sectors in the graph.
5. **Labour & power context:** NELEX and NERC datasets as opportunity-model features.

## Source onboarding checklist

Every new source must clear all ten gates (tracked on the admin source registry; the data source health console surfaces status):

- [ ] **Ownership** — named data steward (platform side) and publisher contact identified.
- [ ] **Access method** — api / bulk download / respectful scraping / manual upload, with terms documented.
- [ ] **Quality** — initial profiling done; completeness/consistency issues logged with a quality score.
- [ ] **Schema mapping** — fields mapped to the canonical model; contracts in `contracts/` updated.
- [ ] **Refresh cadence** — expected cadence recorded (drives the `DataSourceStale` alert).
- [ ] **Lineage** — raw artifacts versioned in object storage; transformations logged; source id attached to every derived record.
- [ ] **Privacy review** — NDPC classification; personal data absent, aggregated, or justified + safeguarded.
- [ ] **Ingestion pattern** — pull schedule or push endpoint defined; emits `ingest.raw.received`.
- [ ] **Observability** — success/failure metrics + freshness timestamps wired to the health console.
- [ ] **Acceptance criteria** — steward sign-off checklist: sample records verified end-to-end (raw → canonical → retrievable → cited).

## 6-month pilot plan

| Month | Milestones |
| ----- | ---------- |
| 1 | Platform bootstrap (dev + staging), Keycloak + RBAC, geography backbone loaded |
| 2 | NBS + UBEC + CAC onboarding through checklist; indicator store live |
| 3 | Document pipeline MVP (bills, budgets); search with citations; governor dashboard alpha |
| 4 | Qwen3-32B serving in staging; opportunity generation workflow (SME sector first) |
| 5 | Simulation service MVP: procurement localization scenario; executive brief generator alpha |
| 6 | UAT with pilot state stakeholders; data source health console live; go/no-go for scale-out |

## 12-month pilot plan

| Quarter | Milestones |
| ------- | ---------- |
| Q3 (months 7–9) | Scale to early-adopter states; DeepSeek-R1 specialist tier; legislation workbench GA; dbt data contracts enforced on all onboarded sources |
| Q4 (months 10–12) | Multi-state rollout waves underway; DR tested (RPO ≤ 24h / RTO ≤ 8h); external evaluation of opportunity recommendations against realized outcomes; handover/sustainability plan with government counterparts |

## Governance & stakeholder structure

- **Steering committee:** state governor's office / federal ministry sponsor, platform lead, data protection advisor — meets monthly, owns go/no-go gates.
- **Technical working group:** MDAs' ICT leads, NBS liaison, platform engineering — weekly; owns source onboarding and data quality.
- **Data stewardship council:** data stewards per sector; own quality scores, privacy classifications, and acceptance sign-off.
- **User panel:** pilot analysts (policy, legal, planning) providing structured UAT feedback each month.

## Rollout waves

| Wave | States | Rationale |
| ---- | ------ | --------- |
| Early adopter | 2–3 states with strong data offices and political sponsorship | Prove value fast; tight feedback loops |
| Scale-out | 8–12 states with adequate ICT capacity | Harden multi-jurisdiction ops, shared playbooks |
| Complex later-wave | Remaining states incl. low-connectivity / low-capacity contexts | Requires offline-tolerant PWA features, assisted data collection, and federated support model |
