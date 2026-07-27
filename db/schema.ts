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
    text: text("text").notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EvidenceSource = typeof evidenceSources.$inferSelect;

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

/** Append-only audit log (spec §27). */
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
