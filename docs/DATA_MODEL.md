# Data Model

## Canonical entity domains

The canonical model is jurisdiction-partitioned: every entity carries `jurisdiction_id` and is traceable to at least one `EvidenceSource`.

| Domain          | Core entities                                                        | Keys / relationships                                                                 |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Geography       | `Jurisdiction`, `Boundary`, `Ward`, `Facility Location`              | `Jurisdiction.id` (e.g. `nga-ng-kd`); parent/child federal→state→LGA→ward; boundaries and facilities keyed by `jurisdiction_id`, stored as PostGIS geometries |
| Government      | `Agency`, `Official`, `Budget`, `ProcurementRecord`, `Program`       | `Agency.jurisdiction_id`; `ProcurementRecord → Agency`, `→ Sector`; budgets versioned by fiscal year |
| Law & policy    | `PolicyDocument`, `Bill`, `Act`, `Regulation`, `Amendment`           | `PolicyDocument.id`; amendment/supersedes edges in Neo4j; `PolicyDocument → Jurisdiction`, `→ Sector` |
| Economy         | `Indicator`, `Observation`, `Sector`, `Opportunity`, `BusinessRegistration` | `Observation(indicator_id, jurisdiction_id, period)` unique; `Opportunity → Sector, Jurisdiction, EvidenceSource` |
| Facilities      | `Facility` (schools, clinics, markets), `ServiceCoverage`            | `Facility.jurisdiction_id` + PostGIS point; coverage joins facilities to wards       |
| Simulation      | `Scenario`, `SimulationRun`, `SimulationResult`, `ModelVersion`      | `SimulationRun → Scenario`, `→ ModelVersion`, `→ dataset snapshot`; results keyed by run |

## Required metadata per entity

| Entity            | Required fields beyond domain attributes                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Jurisdiction`    | `id`, `name`, `level` (federal/state/lga/ward), `parent_id`, `country_code`, `geometry_ref`, `population` (latest + source year), `created_at`, `updated_at`, `source_ids` |
| `Opportunity`     | `id`, `jurisdiction_id`, `sector_id`, `title`, `evidence_refs[]` (≥1), `scores` (impact/feasibility/job_creation), `model_version`, `generation_job_id`, `created_at`, `created_by` |
| `PolicyDocument`  | `id`, `jurisdiction_id`, `type` (bill/act/regulation/budget/gazette), `title`, `issued_at`, `raw_object_uri` (object storage), `parse_status`, `checksum`, `source_id`, `language` |
| `Scenario`        | `id`, `jurisdiction_id`, `name`, `levers[]` (code+value), `baseline_run_id`, `ensemble_size`, `seed`, `created_by`, `created_at` |
| `SimulationRun`   | `id`, `scenario_id`, `model_version`, `dataset_snapshot_id`, `seed`, `status`, `started_at`, `completed_at`, `metrics_uri`, `reproducibility_hash` |
| `EvidenceSource`  | `id`, `name`, `publisher`, `url`, `jurisdiction_scope[]`, `access_method` (api/bulk/scrape/upload), `license`, `refresh_cadence`, `last_success_at`, `quality_score`, `privacy_classification` |

## Representation rule

One logical entity may have multiple physical representations. The rule for deciding where data lives:

| Representation          | Store                     | What goes there                                                                 |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| Operational records     | MySQL (Drizzle)           | Current state of entities the API mutates: jurisdictions, opportunities, scenarios, runs, sources, users/roles |
| Historical analytics    | Apache Iceberg (via Trino)| Time-series observations, indicator history, ingest snapshots, simulation outputs at scale |
| Relationships           | Neo4j                     | Entity graphs: amendment chains, agency↔program↔procurement links, citation/dependency edges |
| Text + semantics        | OpenSearch                | Parsed document text, chunk embeddings, hybrid search indices                   |
| Geometry                | PostGIS                   | Boundaries (state/LGA/ward), facility points, GRID3 settlement layers, coverage rasters |
| Raw artifacts           | MinIO/S3                  | Original uploads, parsed payloads, run manifests (immutably versioned)          |

Invariants: MySQL holds the **id and current pointer** for anything also represented elsewhere; Iceberg is append-only history; Neo4j/OpenSearch/PostGIS are **rebuildable projections** — the lakehouse + object storage are the source of truth for re-indexing.

## Schema governance

- **Contracts in `contracts/`** are the single source of truth for API payloads and event schemas; changes are PR-reviewed and versioned with the API version.
- **dbt data contracts** validate analytical models on every pipeline run; a failed contract blocks promotion of that dataset (see `TESTING.md`).
- **Migrations** (Drizzle for MySQL, dbt for the lakehouse) are forward-only, reviewed, and applied by CI/CD — never by hand in staging/prod.
- Every new entity must declare: owning domain, key, jurisdiction partitioning, privacy classification, and at least one `EvidenceSource` lineage path before merge.
- Schema changes that affect projections (graph/search/geo) must include a re-index plan.

## Implementation status (feat-v6 gap closure)

- **DM-2 canonical entity coverage:** `budgets`, `officials`, `programs`, and
  `business_registrations` exist as first-class MySQL tables (`db/schema.ts`)
  with jurisdiction partitioning, provenance columns, and seed coverage
  (9 Kaduna budget lines FY2023–25, 6 officials, 4 flagship programs,
  25 business registrations). Contract assertions in
  `api/tests/data-contracts.test.ts` ("canonical entity coverage (DM-2)")
  enforce presence, natural-key uniqueness, and jurisdiction referential
  integrity on every seeded database.
- **DM-8 EvidenceSource registry metadata:** `data_sources` now carries
  `license` (varchar), `quality_score` (int 0–100), and
  `privacy_classification` (`public`/`internal`/`restricted`, default
  `internal`). All 13 seeded sources ship curated values; the canonical
  loader (`api/queries/canonical.ts upsertDataSources`) stamps conservative
  defaults on newly registered sources pending steward review; the admin
  console patch path (`updateDataSource`) accepts all three fields. Contract
  assertions ("evidence-source registry metadata (DM-8)") reject NULL/blank
  licenses, out-of-range quality scores, and invalid classifications.
