import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  double,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/* ------------------------------------------------------------------ */
/* Graft tables (auth) — existing columns untouched.                   */
/* `platformRole` is an additive RBAC column (spec §7): the graft's    */
/* `role` enum (user/admin) only distinguishes admins, while the        */
/* platform needs executive / policy_analyst / legal_analyst /          */
/* simulation_specialist / data_steward / platform_admin.               */
/* ------------------------------------------------------------------ */

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  platformRole: varchar("platformRole", { length: 32 })
    .default("policy_analyst")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/* ------------------------------------------------------------------ */
/* Shared enums (snake_case per spec §39; the UI maps to kebab-case)   */
/* ------------------------------------------------------------------ */

const reviewStateEnum = (name: string) =>
  mysqlEnum(name, ["draft", "in_review", "approved", "signed_off", "returned"])
    .default("draft")
    .notNull();

const jobStatusEnum = (name: string) =>
  mysqlEnum(name, ["queued", "running", "succeeded", "failed", "canceled"])
    .default("queued")
    .notNull();

const adminLevelEnum = (name: string) =>
  mysqlEnum(name, ["federal", "state", "lga", "ward"]).notNull();

const sourceHealthEnum = (name: string) =>
  mysqlEnum(name, ["healthy", "stale", "failing"]).default("healthy").notNull();

/**
 * Provenance columns (additive, migration-safe — never dropped).
 * origin: "live" (fetched from a real source), "derived" (computed/parsed
 * from fetched artifacts), "seed" (demo data; the honest default for the
 * pre-ingestion seed corpus).
 */
const provenanceColumns = () => ({
  origin: varchar("origin", { length: 8 }).default("seed").notNull(),
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at"),
});

/* ------------------------------------------------------------------ */
/* Geography                                                           */
/* ------------------------------------------------------------------ */

export const jurisdictions = mysqlTable("jurisdictions", {
  jurisdictionId: varchar("jurisdiction_id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  adminLevel: adminLevelEnum("admin_level"),
  countryCode: varchar("country_code", { length: 2 }).notNull(),
  parentId: varchar("parent_id", { length: 64 }),
  validFrom: timestamp("valid_from"),
  sourceRefs: json("source_refs"),
  ...provenanceColumns(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Jurisdiction = typeof jurisdictions.$inferSelect;

export const adminUnits = mysqlTable(
  "admin_units",
  {
    adminUnitId: varchar("admin_unit_id", { length: 64 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    adminLevel: adminLevelEnum("admin_level"),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    parentId: varchar("parent_id", { length: 64 }),
    population: int("population"),
    sourceRefs: json("source_refs"),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("admin_units_jur_idx").on(t.jurisdictionId),
    parentIdx: index("admin_units_parent_idx").on(t.parentId),
  }),
);

export type AdminUnit = typeof adminUnits.$inferSelect;

/* ------------------------------------------------------------------ */
/* Sectors & metrics                                                   */
/* ------------------------------------------------------------------ */

export const sectors = mysqlTable("sectors", {
  sectorCode: varchar("sector_code", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
});

export type Sector = typeof sectors.$inferSelect;

export const sectorMetrics = mysqlTable(
  "sector_metrics",
  {
    id: serial("id").primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    sectorCode: varchar("sector_code", { length: 32 }).notNull(),
    metricKey: varchar("metric_key", { length: 64 }).notNull(),
    value: double("value").notNull(),
    /** Period label, e.g. "2022", "2024-Q3". */
    period: varchar("period", { length: 16 }).notNull(),
    confidence: double("confidence").default(0.5).notNull(),
    sourceId: varchar("source_id", { length: 64 }),
    ...provenanceColumns(),
  },
  (t) => ({
    jurSectorIdx: index("sector_metrics_jur_sector_idx").on(
      t.jurisdictionId,
      t.sectorCode,
    ),
  }),
);

export type SectorMetric = typeof sectorMetrics.$inferSelect;

/* ------------------------------------------------------------------ */
/* Opportunities, interventions, recommendations                       */
/* ------------------------------------------------------------------ */

export const opportunities = mysqlTable(
  "opportunities",
  {
    opportunityId: varchar("opportunity_id", { length: 64 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    sectorCode: varchar("sector_code", { length: 32 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    summary: text("summary"),
    score: double("score").default(0).notNull(),
    confidence: double("confidence").default(0.5).notNull(),
    estimatedJobsMin: int("estimated_jobs_min"),
    estimatedJobsMax: int("estimated_jobs_max"),
    /** Budget figures in ₦ millions. */
    budgetMin: double("budget_min"),
    budgetMax: double("budget_max"),
    horizonMonths: int("horizon_months"),
    reviewState: reviewStateEnum("review_state"),
    evidenceRefs: json("evidence_refs"),
    ...provenanceColumns(),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jurSectorIdx: index("opportunities_jur_sector_idx").on(
      t.jurisdictionId,
      t.sectorCode,
    ),
    scoreIdx: index("opportunities_score_idx").on(t.score),
  }),
);

export type Opportunity = typeof opportunities.$inferSelect;

export const interventions = mysqlTable(
  "interventions",
  {
    interventionId: varchar("intervention_id", { length: 64 }).primaryKey(),
    opportunityId: varchar("opportunity_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    instrumentType: varchar("instrument_type", { length: 64 }),
    estimatedCost: double("estimated_cost"),
    expectedJobs: int("expected_jobs"),
    timelineMonths: int("timeline_months"),
    evidenceRefs: json("evidence_refs"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    oppIdx: index("interventions_opp_idx").on(t.opportunityId),
  }),
);

export type Intervention = typeof interventions.$inferSelect;

export const recommendations = mysqlTable(
  "recommendations",
  {
    recommendationId: varchar("recommendation_id", { length: 64 }).primaryKey(),
    opportunityId: varchar("opportunity_id", { length: 64 }),
    scenarioId: varchar("scenario_id", { length: 64 }),
    /** Typed Recommendation contract (spec §9.2) as JSON. */
    contract: json("contract").notNull(),
    reviewState: reviewStateEnum("review_state"),
    /** Ordered approval chain: [{role, actor_id, state, at}]. */
    approvalChain: json("approval_chain"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    oppIdx: index("recommendations_opp_idx").on(t.opportunityId),
  }),
);

export type RecommendationRow = typeof recommendations.$inferSelect;

/* ------------------------------------------------------------------ */
/* Legislation                                                         */
/* ------------------------------------------------------------------ */

export const laws = mysqlTable(
  "laws",
  {
    lawId: varchar("law_id", { length: 64 }).primaryKey(),
    title: varchar("title", { length: 512 }).notNull(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    category: varchar("category", { length: 64 }),
    status: varchar("status", { length: 32 }).default("in_force").notNull(),
    year: int("year"),
    sourceUri: text("source_uri"),
    /** G4: evidence base for drafted bills (contracts/drafting EvidenceBase). */
    evidenceBase: json("evidence_base"),
    /** G4: Regulatory Impact Assessment annex (contracts/drafting RiaAnnex). */
    riaAnnex: json("ria_annex"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("laws_jur_idx").on(t.jurisdictionId),
  }),
);

export type Law = typeof laws.$inferSelect;

export const clauses = mysqlTable(
  "clauses",
  {
    clauseId: varchar("clause_id", { length: 96 }).primaryKey(),
    lawId: varchar("law_id", { length: 64 }).notNull(),
    sectionPath: varchar("section_path", { length: 128 }).notNull(),
    /** G4: generated-clause heading (null for imported clauses). */
    heading: varchar("heading", { length: 256 }),
    text: text("text").notNull(),
    /** G4: evidence grounding per generated clause (ClauseGrounding[]). */
    grounding: json("grounding"),
    language: varchar("language", { length: 8 }).default("en").notNull(),
    confidence: double("confidence").default(0.9).notNull(),
    reviewState: reviewStateEnum("review_state"),
    /** Extracted obligations: [{actor, action, condition, penalty}]. */
    obligations: json("obligations"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    lawIdx: index("clauses_law_idx").on(t.lawId),
  }),
);

export type Clause = typeof clauses.$inferSelect;

export const citations = mysqlTable(
  "citations",
  {
    id: serial("id").primaryKey(),
    fromClauseId: varchar("from_clause_id", { length: 96 }).notNull(),
    toClauseId: varchar("to_clause_id", { length: 96 }).notNull(),
    relation: mysqlEnum("relation", [
      "CITES",
      "ENABLES",
      "RESTRICTS",
      "APPLIES_TO",
      "ADMINISTERED_BY",
    ]).notNull(),
    targetMeta: json("target_meta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    fromIdx: index("citations_from_idx").on(t.fromClauseId),
    toIdx: index("citations_to_idx").on(t.toClauseId),
  }),
);

export type Citation = typeof citations.$inferSelect;

/* ------------------------------------------------------------------ */
/* Policy documents                                                    */
/* ------------------------------------------------------------------ */

export const policyDocuments = mysqlTable(
  "policy_documents",
  {
    documentId: varchar("document_id", { length: 64 }).primaryKey(),
    title: varchar("title", { length: 512 }).notNull(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    language: varchar("language", { length: 8 }).default("en").notNull(),
    sourceUri: text("source_uri"),
    hash: varchar("hash", { length: 128 }),
    reviewState: reviewStateEnum("review_state"),
    docType: varchar("doc_type", { length: 64 }),
    ocrConfidence: double("ocr_confidence"),
    /** Free-form metadata (e.g. bill stage/sponsor/chamber for doc_type="bill"). */
    metadata: json("metadata"),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("policy_documents_jur_idx").on(t.jurisdictionId),
  }),
);

export type PolicyDocument = typeof policyDocuments.$inferSelect;

/* ------------------------------------------------------------------ */
/* Scenarios, assumptions, simulation runs                             */
/* ------------------------------------------------------------------ */

export const scenarios = mysqlTable(
  "scenarios",
  {
    scenarioId: varchar("scenario_id", { length: 64 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    interventionIds: json("intervention_ids"),
    assumptionsSetId: varchar("assumptions_set_id", { length: 64 }),
    /** Model plan: [{engine, params}] chosen for this scenario. */
    modelPlan: json("model_plan"),
    status: varchar("status", { length: 32 }).default("draft").notNull(),
    version: int("version").default(1).notNull(),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jurIdx: index("scenarios_jur_idx").on(t.jurisdictionId),
  }),
);

export type Scenario = typeof scenarios.$inferSelect;

export const assumptionSets = mysqlTable("assumption_sets", {
  assumptionsSetId: varchar("assumptions_set_id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  /** Entries: [{key, label, value, unit, source_id}]. */
  entries: json("entries").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AssumptionSet = typeof assumptionSets.$inferSelect;

export const simulationRuns = mysqlTable(
  "simulation_runs",
  {
    simulationRunId: varchar("simulation_run_id", { length: 64 }).primaryKey(),
    scenarioId: varchar("scenario_id", { length: 64 }).notNull(),
    engine: varchar("engine", { length: 32 }).notNull(),
    executionProfile: json("execution_profile"),
    modelVersions: json("model_versions"),
    status: jobStatusEnum("status"),
    progress: int("progress").default(0).notNull(),
    /** SimulationResultSummary (contracts) — series with 80% bands. */
    resultSummary: json("result_summary"),
    artifactUri: varchar("artifact_uri", { length: 512 }),
    seed: int("seed").default(42).notNull(),
    /** DM-3: persisted run manifest (everything needed to re-run). */
    manifest: json("manifest"),
    /** Content-addressed snapshot of run inputs: snap:<sha256-16>. */
    datasetSnapshotId: varchar("dataset_snapshot_id", { length: 96 }),
    /** sha256(manifest + result_summary) — recomputed to verify reproducibility. */
    reproducibilityHash: varchar("reproducibility_hash", { length: 64 }),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    scenarioIdx: index("simulation_runs_scenario_idx").on(t.scenarioId),
  }),
);

export type SimulationRun = typeof simulationRuns.$inferSelect;

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export const evidenceSources = mysqlTable("evidence_sources", {
  evidenceSourceId: varchar("evidence_source_id", { length: 96 }).primaryKey(),
  sourceType: mysqlEnum("source_type", [
    "sql",
    "vector",
    "graph",
    "document",
  ]).notNull(),
  citation: text("citation").notNull(),
  retrievalPath: varchar("retrieval_path", { length: 512 }),
  confidence: double("confidence").default(0.5).notNull(),
  contentExcerpt: text("content_excerpt"),
  /** Linked entity ids: {opportunity_ids, clause_ids, law_ids, brief_ids}. */
  linkedEntityIds: json("linked_entity_ids"),
  ...provenanceColumns(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EvidenceSource = typeof evidenceSources.$inferSelect;

/* ------------------------------------------------------------------ */
/* Ingestion & provenance (additive — feat-ingestion)                  */
/* ------------------------------------------------------------------ */

export const facilities = mysqlTable(
  "facilities",
  {
    facilityId: varchar("facility_id", { length: 96 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    lat: double("lat"),
    lon: double("lon"),
    /** Source locator, e.g. "osm:node/123", "hdx:nigeria-health-facilities". */
    source: varchar("source", { length: 255 }),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("facilities_jur_idx").on(t.jurisdictionId),
    typeIdx: index("facilities_type_idx").on(t.type),
    latLonIdx: index("facilities_lat_lon_idx").on(t.lat, t.lon),
  }),
);

export type Facility = typeof facilities.$inferSelect;

export const procurementRecords = mysqlTable(
  "procurement_records",
  {
    recordId: varchar("record_id", { length: 96 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    buyer: varchar("buyer", { length: 255 }).notNull(),
    supplier: varchar("supplier", { length: 255 }),
    valueNgn: double("value_ngn"),
    awardDate: varchar("award_date", { length: 32 }),
    status: varchar("status", { length: 32 }).default("unknown").notNull(),
    /** Open Contracting ID (OCDS). */
    ocid: varchar("ocid", { length: 128 }),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("procurement_records_jur_idx").on(t.jurisdictionId),
    ocidIdx: index("procurement_records_ocid_idx").on(t.ocid),
  }),
);

export type ProcurementRecord = typeof procurementRecords.$inferSelect;

export const ingestionRuns = mysqlTable(
  "ingestion_runs",
  {
    runId: varchar("run_id", { length: 64 }).primaryKey(),
    connector: varchar("connector", { length: 32 }).notNull(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    status: jobStatusEnum("status"),
    recordsIn: int("records_in").default(0).notNull(),
    recordsOut: int("records_out").default(0).notNull(),
    /** {schema_ok, freshness_ok, completeness_ok, notes[]} from the connector. */
    contractResults: json("contract_results"),
    error: text("error"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("ingestion_runs_jur_idx").on(t.jurisdictionId),
    connectorIdx: index("ingestion_runs_connector_idx").on(t.connector),
  }),
);

export type IngestionRun = typeof ingestionRuns.$inferSelect;

/* ------------------------------------------------------------------ */
/* Canonical model completion (additive — feat-data-loader)            */
/* ------------------------------------------------------------------ */

/** State budget lines: appropriation vs release per MDA/sector/year. */
export const budgets = mysqlTable(
  "budgets",
  {
    budgetId: varchar("budget_id", { length: 96 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    fiscalYear: int("fiscal_year").notNull(),
    /** Ministry/Department/Agency. */
    mda: varchar("mda", { length: 255 }).notNull(),
    sectorCode: varchar("sector_code", { length: 32 }),
    /** Figures in ₦ (naira), not millions. */
    appropriatedNgn: double("appropriated_ngn"),
    releasedNgn: double("released_ngn"),
    source: varchar("source", { length: 255 }),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurYearIdx: index("budgets_jur_year_idx").on(t.jurisdictionId, t.fiscalYear),
  }),
);

export type Budget = typeof budgets.$inferSelect;

/** Public officials relevant to policy twin (tenure-windowed). */
export const officials = mysqlTable(
  "officials",
  {
    officialId: varchar("official_id", { length: 96 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: varchar("role", { length: 255 }).notNull(),
    level: adminLevelEnum("level"),
    party: varchar("party", { length: 64 }),
    /** Tenure window as ISO date labels (e.g. "2023-05-29"). */
    validFrom: varchar("valid_from", { length: 32 }),
    validTo: varchar("valid_to", { length: 32 }),
    source: varchar("source", { length: 255 }),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("officials_jur_idx").on(t.jurisdictionId),
  }),
);

export type Official = typeof officials.$inferSelect;

/** Flagship government programs (status + headline targets). */
export const programs = mysqlTable(
  "programs",
  {
    programId: varchar("program_id", { length: 96 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sectorCode: varchar("sector_code", { length: 32 }),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    targetJobs: int("target_jobs"),
    budgetId: varchar("budget_id", { length: 96 }),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("programs_jur_idx").on(t.jurisdictionId),
  }),
);

export type Program = typeof programs.$inferSelect;

/** Business registrations (CAC-style) — SME formalization proxy. */
export const businessRegistrations = mysqlTable(
  "business_registrations",
  {
    registrationId: varchar("registration_id", { length: 96 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    rcNumber: varchar("rc_number", { length: 32 }),
    entityType: varchar("entity_type", { length: 64 }),
    /** Registration date as ISO date label. */
    registeredAt: varchar("registered_at", { length: 32 }),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    lga: varchar("lga", { length: 128 }),
    source: varchar("source", { length: 255 }),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    jurIdx: index("business_registrations_jur_idx").on(t.jurisdictionId),
    rcIdx: index("business_registrations_rc_idx").on(t.rcNumber),
  }),
);

export type BusinessRegistration = typeof businessRegistrations.$inferSelect;

/* ------------------------------------------------------------------ */
/* Geospatial (additive — feat-data-loader)                            */
/* ------------------------------------------------------------------ */

/**
 * Administrative boundary polygons (GeoJSON Feature per unit) with real
 * centroids. Mirrors public/geo/*.geojson; powers choropleths and the
 * point-in-polygon fallback when POSTGIS_URL is not configured.
 */
export const geoBoundaries = mysqlTable(
  "geo_boundaries",
  {
    /** e.g. "adm:ng-kd-zaria" — mirrors admin_units ids. */
    unitId: varchar("unit_id", { length: 96 }).primaryKey(),
    level: adminLevelEnum("level"),
    /** GeoJSON Feature (Polygon/MultiPolygon) with name/osm props. */
    geojson: json("geojson").notNull(),
    centroidLat: double("centroid_lat"),
    centroidLon: double("centroid_lon"),
    ...provenanceColumns(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

export type GeoBoundary = typeof geoBoundaries.$inferSelect;

/* ------------------------------------------------------------------ */
/* Briefs                                                              */
/* ------------------------------------------------------------------ */

export const briefs = mysqlTable(
  "briefs",
  {
    briefId: varchar("brief_id", { length: 64 }).primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    template: varchar("template", { length: 64 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    reviewState: reviewStateEnum("review_state"),
    /** Structured content: {sections, citations_rail, ...} (Plex-Serif ready). */
    content: json("content"),
    /** Model routing used for generation: {tier, model, fallback}. */
    modelRouting: json("model_routing"),
    requestId: varchar("request_id", { length: 64 }),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }),
    approvedBy: bigint("approved_by", { mode: "number", unsigned: true }),
    signedOffAt: timestamp("signed_off_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jurIdx: index("briefs_jur_idx").on(t.jurisdictionId),
  }),
);

export type Brief = typeof briefs.$inferSelect;

/* ------------------------------------------------------------------ */
/* Data sources, pipelines, review tasks                               */
/* ------------------------------------------------------------------ */

export const dataSources = mysqlTable("data_sources", {
  sourceId: varchar("source_id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  owner: varchar("owner", { length: 255 }),
  url: varchar("url", { length: 512 }),
  category: varchar("category", { length: 64 }),
  accessMethod: varchar("access_method", { length: 64 }),
  refreshCadence: varchar("refresh_cadence", { length: 64 }),
  ingestionPattern: varchar("ingestion_pattern", { length: 64 }),
  health: sourceHealthEnum("health"),
  lastRefresh: timestamp("last_refresh"),
  freshnessDays: int("freshness_days").default(0).notNull(),
  /** Source contract compliance: {schema_ok, sla_ok, license_ok, notes}. */
  contractCompliance: json("contract_compliance"),
  geographyScope: varchar("geography_scope", { length: 128 }),
  /** §16 EvidenceSource registry metadata. */
  license: varchar("license", { length: 255 }),
  /** Data-quality score 0–100 (freshness/schema/SLA composite). */
  qualityScore: int("quality_score"),
  /** Privacy classification: public | internal | restricted. */
  privacyClassification: varchar("privacy_classification", { length: 32 })
    .default("internal")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DataSource = typeof dataSources.$inferSelect;

export const pipelineRuns = mysqlTable(
  "pipeline_runs",
  {
    pipelineId: varchar("pipeline_id", { length: 64 }).primaryKey(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    status: jobStatusEnum("status"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    rowsProcessed: int("rows_processed").default(0).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    sourceIdx: index("pipeline_runs_source_idx").on(t.sourceId),
  }),
);

export type PipelineRun = typeof pipelineRuns.$inferSelect;

export const reviewTasks = mysqlTable(
  "review_tasks",
  {
    taskId: varchar("task_id", { length: 64 }).primaryKey(),
    type: mysqlEnum("type", [
      "ocr_low_confidence",
      "legal_extract",
      "data_quality",
    ]).notNull(),
    entityRef: varchar("entity_ref", { length: 128 }).notNull(),
    assigneeRole: varchar("assignee_role", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).default("open").notNull(),
    payload: json("payload"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    statusIdx: index("review_tasks_status_idx").on(t.status),
  }),
);

export type ReviewTask = typeof reviewTasks.$inferSelect;

/* ------------------------------------------------------------------ */
/* Jobs, audit, approvals                                              */
/* ------------------------------------------------------------------ */

export const jobs = mysqlTable(
  "jobs",
  {
    jobId: varchar("job_id", { length: 64 }).primaryKey(),
    type: varchar("type", { length: 64 }).notNull(),
    status: jobStatusEnum("status"),
    progress: int("progress").default(0).notNull(),
    input: json("input"),
    result: json("result"),
    error: text("error"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    actorId: bigint("actor_id", { mode: "number", unsigned: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    idemIdx: uniqueIndex("jobs_idempotency_key_idx").on(t.idempotencyKey),
    actorIdx: index("jobs_actor_idx").on(t.actorId),
  }),
);

export type Job = typeof jobs.$inferSelect;

/** Append-only audit log (spec §27) with hash-chained tamper evidence. */
export const auditEvents = mysqlTable(
  "audit_events",
  {
    eventId: serial("event_id").primaryKey(),
    actorId: bigint("actor_id", { mode: "number", unsigned: true }),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 128 }).notNull(),
    scopes: json("scopes"),
    requestId: varchar("request_id", { length: 64 }),
    correlationId: varchar("correlation_id", { length: 64 }),
    payload: json("payload"),
    /** SHA-256 of the previous event's entry_hash (GENESIS for the first). */
    prevHash: varchar("prev_hash", { length: 64 }),
    /** SHA-256 of canonical payload + prev_hash. */
    entryHash: varchar("entry_hash", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    entityIdx: index("audit_events_entity_idx").on(t.entityType, t.entityId),
    createdIdx: index("audit_events_created_idx").on(t.createdAt),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;

export const approvalEvents = mysqlTable(
  "approval_events",
  {
    id: serial("id").primaryKey(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 128 }).notNull(),
    fromState: varchar("from_state", { length: 32 }).notNull(),
    toState: varchar("to_state", { length: 32 }).notNull(),
    actorId: bigint("actor_id", { mode: "number", unsigned: true }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    entityIdx: index("approval_events_entity_idx").on(t.entityType, t.entityId),
  }),
);

export type ApprovalEvent = typeof approvalEvents.$inferSelect;

/* ------------------------------------------------------------------ */
/* Jurisdiction-scoped authorization (ABAC)                            */
/* ------------------------------------------------------------------ */

/** Per-actor jurisdiction grants; executive/platform_admin bypass (all). */
export const userJurisdictions = mysqlTable(
  "user_jurisdictions",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    accessLevel: mysqlEnum("access_level", ["read", "write", "admin"])
      .default("read")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userJurIdx: uniqueIndex("user_jurisdictions_user_jur_idx").on(
      t.userId,
      t.jurisdictionId,
    ),
    jurIdx: index("user_jurisdictions_jur_idx").on(t.jurisdictionId),
  }),
);

export type UserJurisdiction = typeof userJurisdictions.$inferSelect;

/* ------------------------------------------------------------------ */
/* Event backbone fallback: durable outbox                             */
/* ------------------------------------------------------------------ */

/**
 * Durable outbox for domain events (docs/EVENTS.md). When KAFKA_BROKERS is
 * configured the relay delivers to Redpanda/Kafka and stamps delivered_at;
 * otherwise rows accumulate for replay. Webhook subscriptions fan out from
 * the same bus with HMAC-signed payloads.
 */
export const eventOutbox = mysqlTable(
  "event_outbox",
  {
    eventId: varchar("event_id", { length: 64 }).primaryKey(),
    topic: varchar("topic", { length: 128 }).notNull(),
    /** Ordering/partition key (document_id, jurisdiction_id, scenario_id...). */
    partitionKey: varchar("partition_key", { length: 128 }),
    payload: json("payload").notNull(),
    attempts: int("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
  },
  (t) => ({
    topicIdx: index("event_outbox_topic_idx").on(t.topic),
    deliveredIdx: index("event_outbox_delivered_idx").on(t.deliveredAt),
  }),
);

export type EventOutboxRow = typeof eventOutbox.$inferSelect;

/* ------------------------------------------------------------------ */
/* Innovation: sector jobs-multiplier library                          */
/* ------------------------------------------------------------------ */

export const sectorMultipliers = mysqlTable("sector_multipliers", {
  sectorCode: varchar("sector_code", { length: 32 }).primaryKey(),
  direct: double("direct").notNull(),
  indirect: double("indirect").notNull(),
  induced: double("induced").notNull(),
  /** Literature provenance label (documented ranges). */
  source: varchar("source", { length: 255 }).notNull(),
  confidence: double("confidence").default(0.5).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SectorMultiplier = typeof sectorMultipliers.$inferSelect;

/* ------------------------------------------------------------------ */
/* Innovation: adaptive twin recalibration state                       */
/* ------------------------------------------------------------------ */

export const twinStates = mysqlTable(
  "twin_states",
  {
    id: serial("id").primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    /** Twin layer: demographics | labour | fiscal | procurement | ... */
    layer: varchar("layer", { length: 64 }).notNull(),
    state: json("state").notNull(),
    version: int("version").default(1).notNull(),
    calibratedAt: timestamp("calibrated_at").defaultNow().notNull(),
  },
  (t) => ({
    jurLayerIdx: uniqueIndex("twin_states_jur_layer_idx").on(
      t.jurisdictionId,
      t.layer,
    ),
  }),
);

export type TwinState = typeof twinStates.$inferSelect;

/* ------------------------------------------------------------------ */
/* Innovation: scenario template marketplace                           */
/* ------------------------------------------------------------------ */

export const scenarioTemplates = mysqlTable(
  "scenario_templates",
  {
    templateId: varchar("template_id", { length: 64 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    /** Canonical scenario config (intervention_ids, model_plan, horizon...). */
    config: json("config").notNull(),
    authorJurisdiction: varchar("author_jurisdiction", { length: 64 }),
    installs: int("installs").default(0).notNull(),
    rating: double("rating").default(0).notNull(),
    /** Publish gate: draft -> in_review -> approved (human review required). */
    publishedState: varchar("published_state", { length: 32 })
      .default("draft")
      .notNull(),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    stateIdx: index("scenario_templates_state_idx").on(t.publishedState),
  }),
);

export type ScenarioTemplate = typeof scenarioTemplates.$inferSelect;

/* ------------------------------------------------------------------ */
/* Innovation: signed webhook subscriptions                            */
/* ------------------------------------------------------------------ */

export const webhookSubscriptions = mysqlTable("webhook_subscriptions", {
  subId: varchar("sub_id", { length: 64 }).primaryKey(),
  url: varchar("url", { length: 512 }).notNull(),
  /** Topics filter (dot-namespaced, docs/EVENTS.md). */
  topics: json("topics").notNull(),
  /** HMAC-SHA256 signing secret (X-PolicyTwin-Signature). */
  secret: varchar("secret", { length: 128 }).notNull(),
  active: int("active").default(1).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;

/* ------------------------------------------------------------------ */
// === feat-llm-events tables ===
/* ------------------------------------------------------------------ */

/**
 * Dead-letter queue for the event backbone (docs/EVENTS.md). Rows land here
 * after the consumer retry budget (3x backoff) is exhausted — either from a
 * Kafka consumer group or from the outbox-mode polled consumer. The original
 * event_outbox row keeps its attempts/last_error; this table is the durable
 * DLQ record (`<topic>.dlq` equivalent when Kafka is not deployed).
 */
export const eventDlq = mysqlTable("event_dlq", {
  eventId: varchar("event_id", { length: 64 }).primaryKey(),
  /** Source topic (the DLQ topic is derived as `${topic}.dlq`). */
  topic: varchar("topic", { length: 128 }).notNull(),
  dlqTopic: varchar("dlq_topic", { length: 160 }).notNull(),
  partitionKey: varchar("partition_key", { length: 128 }),
  payload: json("payload").notNull(),
  attempts: int("attempts").default(0).notNull(),
  lastError: text("last_error"),
  /** Consumer group / handler that exhausted retries. */
  consumerGroup: varchar("consumer_group", { length: 128 }),
  deadAt: timestamp("dead_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** Set when an operator replays the message back onto the bus. */
  replayedAt: timestamp("replayed_at"),
});

export type EventDlqRow = typeof eventDlq.$inferSelect;

/**
 * Job heartbeats (SR-9 jobs hardening). The in-process runner stamps a row
 * on every lifecycle transition; a sweeper interval auto-fails jobs whose
 * heartbeat is stale (>10 min) while the jobs row still says running.
 */
export const jobHeartbeats = mysqlTable("job_heartbeats", {
  jobId: varchar("job_id", { length: 64 }).primaryKey(),
  /** Last lifecycle status observed by the runner. */
  status: varchar("status", { length: 32 }).notNull(),
  ts: timestamp("ts").defaultNow().notNull(),
});

export type JobHeartbeat = typeof jobHeartbeats.$inferSelect;

/**
 * WORM audit export checkpoints (SEC-4). One row per export file: anchors
 * the running hash-chain head + sha256 manifest so continuity across
 * hourly exports is verifiable even if the artifact dir is remounted.
 */
export const auditWormExports = mysqlTable("audit_worm_exports", {
  exportId: varchar("export_id", { length: 64 }).primaryKey(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  /** First/last audit event ids included (inclusive). */
  fromEventId: bigint("from_event_id", { mode: "number" }),
  toEventId: bigint("to_event_id", { mode: "number" }),
  eventCount: int("event_count").default(0).notNull(),
  /** Chain head (entry_hash of the last exported event) and manifest sha. */
  chainHead: varchar("chain_head", { length: 64 }).notNull(),
  manifestSha256: varchar("manifest_sha256", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AuditWormExport = typeof auditWormExports.$inferSelect;

/* ------------------------------------------------------------------ */
/* ADDITIVE (SEC-3): dataset-level ABAC policies.                      */
/* One row per protected dataset: a concrete dataset key (document id, */
/* law id, opportunity id, source id) or the entity-type wildcard "*". */
/* Resolution at read time: exact dataset_id match wins over "*".      */
/* ------------------------------------------------------------------ */
export const datasetPolicies = mysqlTable(
  "dataset_policies",
  {
    policyId: varchar("policy_id", { length: 64 }).primaryKey(),
    /** Concrete dataset key or "*" (entity-type default). */
    datasetId: varchar("dataset_id", { length: 128 }).notNull(),
    /** document | clause | opportunity | data_source | ... */
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    classification: mysqlEnum("classification", [
      "public",
      "internal",
      "restricted",
    ])
      .notNull()
      .default("internal"),
    /** Platform roles allowed when classification = restricted (json array). */
    allowedRoles: json("allowed_roles"),
    /** Optional: policy only applies within this jurisdiction. */
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    datasetEntity: uniqueIndex("dataset_policies_dataset_entity").on(
      t.datasetId,
      t.entityType,
    ),
  }),
);

export type DatasetPolicy = typeof datasetPolicies.$inferSelect;


/* ------------------------------------------------------------------ */
/* ADDITIVE (G2): realized-outcome store (docs/OUTCOMES.md).           */
/* Realized indicator observations (e.g. NBS labour-force releases)    */
/* that feed real-data causal estimation and backtesting.              */
/* NOTE: jurisdictionId follows the repo-wide convention (varchar(64)  */
/* natural key, e.g. "jur:ng-kd") — NOT a bigint FK — matching every   */
/* other jurisdiction-scoped table in this schema.                     */
/* ------------------------------------------------------------------ */
export const outcomeSeries = mysqlTable(
  "outcome_series",
  {
    id: serial("id").primaryKey(),
    jurisdictionId: varchar("jurisdiction_id", { length: 64 }).notNull(),
    /** e.g. EMPLOYMENT_TOTAL, UNEMPLOYMENT_RATE, FIRM_COUNT */
    indicatorCode: varchar("indicator_code", { length: 64 }).notNull(),
    source: varchar("source", { length: 255 }).notNull(),
    origin: mysqlEnum("origin", ["live", "derived", "seed"])
      .default("seed")
      .notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    frequency: mysqlEnum("frequency", ["monthly", "quarterly", "annual"])
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jurIndicator: uniqueIndex("outcome_series_jur_indicator_src").on(
      t.jurisdictionId,
      t.indicatorCode,
      t.source,
      t.frequency,
    ),
    jurIdx: index("outcome_series_jur_idx").on(t.jurisdictionId),
  }),
);

export type OutcomeSeries = typeof outcomeSeries.$inferSelect;
export type InsertOutcomeSeries = typeof outcomeSeries.$inferInsert;

export const outcomeObservations = mysqlTable(
  "outcome_observations",
  {
    id: serial("id").primaryKey(),
    /** FK -> outcome_series.id (bigint unsigned serial). */
    seriesId: bigint("series_id", { mode: "number", unsigned: true }).notNull(),
    /** Period label YYYY-MM (quarterly/annual series use the end month). */
    period: varchar("period", { length: 7 }).notNull(),
    value: double("value").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    provenanceJson: json("provenance_json"),
  },
  (t) => ({
    seriesPeriod: uniqueIndex("outcome_observations_series_period").on(
      t.seriesId,
      t.period,
    ),
    seriesIdx: index("outcome_observations_series_idx").on(t.seriesId),
  }),
);

export type OutcomeObservation = typeof outcomeObservations.$inferSelect;
export type InsertOutcomeObservation = typeof outcomeObservations.$inferInsert;

/* ------------------------------------------------------------------ */
/* ADDITIVE (feat-advocacy-backend): Policy Advocacy Pathway.          */
/* "idea → legislation" knowledge base: stakeholders, their relation   */
/* graph, and regulatory pathways (licenses/constraints/steps).        */
/* stakeholderId / pathwayId are natural keys (e.g. "stk:cbn-governor",*/
/* "pw:ng-fintech-tourism-payments"); id serials are internal only.    */
/* ------------------------------------------------------------------ */

export const STAKEHOLDER_KINDS = [
  "individual",
  "committee",
  "ministry",
  "agency",
  "association",
  "state_body",
  "development_partner",
] as const;

export const stakeholders = mysqlTable(
  "stakeholders",
  {
    id: serial("id").primaryKey(),
    /** Natural key, e.g. "stk:cbn-governor". */
    stakeholderId: varchar("stakeholder_id", { length: 96 }).notNull().unique(),
    kind: mysqlEnum("kind", STAKEHOLDER_KINDS).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    /** Role/title for individuals (nullable for orgs). */
    title: varchar("title", { length: 255 }),
    org: varchar("org", { length: 255 }),
    /** State name for state-level stakeholders (e.g. "Lagos"). */
    state: varchar("state", { length: 64 }),
    /** "senate" | "house" | state assembly name, for committees. */
    chamber: varchar("chamber", { length: 64 }),
    /** string[] sector tags (e.g. ["fintech","payments","tourism"]). */
    sectorTags: json("sector_tags"),
    bio: text("bio"),
    /** Why this stakeholder matters for the advocacy pathway. */
    influenceArea: text("influence_area"),
    /** How/why to engage (lobby angle). */
    lobbyAngle: text("lobby_angle"),
    /** Public channels only — no private contact data. */
    contactNote: text("contact_note"),
    /** string[] of adjacent sector codes. */
    relatedSectors: json("related_sectors"),
    /** Data currency label, e.g. "2025-12". */
    asOf: varchar("as_of", { length: 10 }),
    origin: mysqlEnum("origin", ["live", "derived", "seed"])
      .default("derived")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    kindIdx: index("stakeholders_kind_idx").on(t.kind),
  }),
);

export type Stakeholder = typeof stakeholders.$inferSelect;
export type InsertStakeholder = typeof stakeholders.$inferInsert;

/** Directed stakeholder relation graph (oversees / lobbies / regulates...). */
export const stakeholderEdges = mysqlTable(
  "stakeholder_edges",
  {
    id: serial("id").primaryKey(),
    /** stakeholders.stakeholder_id (natural key, not the serial). */
    fromId: varchar("from_id", { length: 96 }).notNull(),
    toId: varchar("to_id", { length: 96 }).notNull(),
    /** e.g. 'oversees','member_of','chairs','lobbies','regulates','domesticates'. */
    relation: varchar("relation", { length: 64 }).notNull(),
    label: varchar("label", { length: 255 }),
  },
  (t) => ({
    fromIdx: index("stakeholder_edges_from_idx").on(t.fromId),
    toIdx: index("stakeholder_edges_to_idx").on(t.toId),
  }),
);

export type StakeholderEdge = typeof stakeholderEdges.$inferSelect;
export type InsertStakeholderEdge = typeof stakeholderEdges.$inferInsert;

export const regulatoryPathways = mysqlTable(
  "regulatory_pathways",
  {
    id: serial("id").primaryKey(),
    /** Natural key, e.g. "pw:ng-fintech-tourism-payments". */
    pathwayId: varchar("pathway_id", { length: 96 }).notNull().unique(),
    sector: varchar("sector", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    summary: text("summary"),
    jurisdictionScope: mysqlEnum("jurisdiction_scope", [
      "federal",
      "state",
      "both",
    ]).notNull(),
    /** [{name, issuer, requirement, typical_timeline, cost_note}]. */
    licenses: json("licenses"),
    /** [{type, description, severity}]. */
    constraints: json("constraints"),
    /** [{ref, title, relevance}] — ref may be a laws.law_id or free ref. */
    supportingLawRefs: json("supporting_law_refs"),
    /** stakeholderId[] of associations/bodies to engage. */
    associationRefs: json("association_refs"),
    /** Ordered [{step, owner, description, est_duration}]. */
    steps: json("steps"),
    origin: mysqlEnum("origin", ["live", "derived", "seed"])
      .default("derived")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    sectorIdx: index("regulatory_pathways_sector_idx").on(t.sector),
  }),
);

export type RegulatoryPathway = typeof regulatoryPathways.$inferSelect;
export type InsertRegulatoryPathway = typeof regulatoryPathways.$inferInsert;
