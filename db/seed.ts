/**
 * Nigeria pilot seed — idempotent (existing PKs are skipped).
 * Reference deployment: Federal Nigeria → Kaduna (jur:ng-kd), Lagos (jur:ng-la),
 * Kano (jur:ng-kn); 23 real Kaduna LGAs; pilot sectors education / SME
 * formation / procurement-led job creation / agro-processing / digital services.
 * Headline target: 250,000 new jobs by 2027.
 *
 * Run with: npx tsx db/seed.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { runFallbackEngine } from "../api/bridges/simulation";
import type { SimulationEngine } from "../contracts/entities";

const db = getDb();

async function existingIds(table: never, pkCol: never): Promise<Set<string>> {
  const rows = await db
    .select({ id: pkCol })
    .from(table as never);
  return new Set(
    (rows as unknown as { id: string }[]).map((r) => String(r.id)),
  );
}

async function tableCount(table: never): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(table as never);
  return Number((row as unknown as { n: number }).n);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/* ------------------------------------------------------------------ */
/* Jurisdictions                                                       */
/* ------------------------------------------------------------------ */

const JURISDICTIONS: (typeof schema.jurisdictions.$inferInsert)[] = [
  {
    jurisdictionId: "jur:ng",
    name: "Federal Republic of Nigeria",
    adminLevel: "federal",
    countryCode: "NG",
    parentId: null,
    // MySQL TIMESTAMP floor is 1970 — use Fourth Republic date.
    validFrom: new Date("1999-05-29"),
    sourceRefs: ["src:nbs", "src:national-assembly"],
  },
  {
    jurisdictionId: "jur:ng-kd",
    name: "Kaduna State",
    adminLevel: "state",
    countryCode: "NG",
    parentId: "jur:ng",
    validFrom: new Date("1999-05-29"),
    sourceRefs: ["src:nbs", "src:grid3"],
  },
  {
    jurisdictionId: "jur:ng-la",
    name: "Lagos State",
    adminLevel: "state",
    countryCode: "NG",
    parentId: "jur:ng",
    validFrom: new Date("1999-05-29"),
    sourceRefs: ["src:nbs"],
  },
  {
    jurisdictionId: "jur:ng-kn",
    name: "Kano State",
    adminLevel: "state",
    countryCode: "NG",
    parentId: "jur:ng",
    validFrom: new Date("1999-05-29"),
    sourceRefs: ["src:nbs"],
  },
];

/* 23 real Kaduna LGAs (parent jur:ng-kd). Populations are plausible
   NBS-2022-projection-scale figures. */
const KADUNA_LGAS: [string, number][] = [
  ["Kaduna North", 421_000],
  ["Kaduna South", 462_000],
  ["Chikun", 563_000],
  ["Igabi", 615_000],
  ["Zaria", 475_000],
  ["Sabon Gari", 393_000],
  ["Soba", 348_000],
  ["Makarfi", 175_000],
  ["Ikara", 233_000],
  ["Kubau", 266_000],
  ["Kudan", 165_000],
  ["Lere", 395_000],
  ["Giwa", 336_000],
  ["Birnin Gwari", 305_000],
  ["Kajuru", 134_000],
  ["Kachia", 296_000],
  ["Jema'a", 333_000], // Kafanchan
  ["Jaba", 184_000],
  ["Kaura", 264_000],
  ["Kauru", 210_000],
  ["Zangon Kataf", 379_000],
  ["Sanga", 182_000],
  ["Kagarko", 288_000],
];

const ADMIN_UNITS: (typeof schema.adminUnits.$inferInsert)[] = KADUNA_LGAS.map(
  ([name, pop]) => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-+$/, "");
    return {
      adminUnitId: `adm:ng-kd-${slug}`,
      jurisdictionId: "jur:ng-kd",
      name: `${name} LGA`,
      adminLevel: "lga" as const,
      countryCode: "NG",
      parentId: "jur:ng-kd",
      population: pop,
      sourceRefs: ["src:nbs", "src:grid3"],
    };
  },
);

/* ------------------------------------------------------------------ */
/* Sectors & metrics                                                   */
/* ------------------------------------------------------------------ */

const SECTORS: (typeof schema.sectors.$inferInsert)[] = [
  { sectorCode: "edu", name: "Education", description: "Basic & secondary education, teacher pipeline, school feeding." },
  { sectorCode: "sme", name: "SME Formation", description: "Micro/small enterprise formalization and growth." },
  { sectorCode: "proc", name: "Public Procurement", description: "Procurement-led job creation and supplier development." },
  { sectorCode: "agro", name: "Agro-processing", description: "Value-chain clusters: ginger, maize, soy, dairy." },
  { sectorCode: "digital", name: "Digital Services", description: "BPO, digital skills, connectivity-linked services." },
];

// (sector, metric, values 2022→2025, confidence, source)
const METRIC_ROWS: [string, string, number[], number, string][] = [
  ["edu", "unemployment", [0.302, 0.311, 0.298, 0.287], 0.82, "src:nbs"],
  ["edu", "literacy", [0.571, 0.583, 0.594, 0.607], 0.78, "src:nbs-microdata"],
  ["edu", "school_count", [4_214, 4_260, 4_301, 4_338], 0.88, "src:ubec"],
  ["sme", "sme_density", [41.2, 43.8, 46.1, 48.9], 0.71, "src:cac"],
  ["sme", "unemployment", [0.312, 0.32, 0.305, 0.293], 0.8, "src:nbs"],
  ["proc", "procurement_volume", [98_400, 112_300, 126_900, 141_200], 0.76, "src:bpp"], // ₦m annual
  ["proc", "sme_density", [39.8, 42.5, 45.3, 48.1], 0.7, "src:cac"],
  ["agro", "unemployment", [0.335, 0.341, 0.327, 0.318], 0.74, "src:nbs"],
  ["agro", "literacy", [0.512, 0.524, 0.537, 0.549], 0.72, "src:nbs-microdata"],
  ["digital", "sme_density", [12.6, 15.2, 18.4, 22.1], 0.66, "src:cac"],
  ["digital", "literacy", [0.648, 0.661, 0.675, 0.69], 0.7, "src:nbs-microdata"],
];

const PERIODS = ["2022", "2023", "2024", "2025"];

const SECTOR_METRICS: (typeof schema.sectorMetrics.$inferInsert)[] =
  METRIC_ROWS.flatMap(([sectorCode, metricKey, values, confidence, sourceId]) =>
    PERIODS.map((period, i) => ({
      jurisdictionId: "jur:ng-kd",
      sectorCode,
      metricKey,
      value: values[i],
      period,
      confidence,
      sourceId,
    })),
  );

/* ------------------------------------------------------------------ */
/* Opportunities                                                       */
/* ------------------------------------------------------------------ */

const OPPORTUNITIES: (typeof schema.opportunities.$inferInsert)[] = [
  {
    opportunityId: "opp:edu:teacher-pipeline",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "edu",
    title: "Teacher recruitment & training pipeline",
    summary: "Recruit and license 25,000 teachers across 23 LGAs with a 12-month induction; closes pupil-teacher gaps in rural wards.",
    score: 0.91, confidence: 0.86,
    estimatedJobsMin: 18_000, estimatedJobsMax: 27_000,
    budgetMin: 38_000, budgetMax: 54_000, horizonMonths: 36,
    reviewState: "approved",
    evidenceRefs: ["ev:sql:ubec-schools-2024", "ev:sql:nbs-lfs-2024", "ev:document:teacher-licensing-brief"],
  },
  {
    opportunityId: "opp:edu:school-meals-sourcing",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "edu",
    title: "School-meal programme local sourcing",
    summary: "Home-grown school feeding for 1,900 primary schools sourced from local smallholders; jobs in catering, logistics and farm supply.",
    score: 0.84, confidence: 0.8,
    estimatedJobsMin: 9_500, estimatedJobsMax: 14_000,
    budgetMin: 12_500, budgetMax: 19_000, horizonMonths: 30,
    reviewState: "in_review",
    evidenceRefs: ["ev:document:school-meals-policy", "ev:sql:nbs-lfs-2024"],
  },
  {
    opportunityId: "opp:proc:lga-supplier-development",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "proc",
    title: "LGA procurement supplier development",
    summary: "Certify 1,200 LGA-level suppliers for public works and supplies lots under the state procurement law; reserved lots for youth-led firms.",
    score: 0.88, confidence: 0.77,
    estimatedJobsMin: 12_000, estimatedJobsMax: 19_500,
    budgetMin: 6_800, budgetMax: 11_000, horizonMonths: 24,
    reviewState: "approved",
    evidenceRefs: ["ev:sql:bpp-contracts-2024", "ev:graph:procurement-dependencies"],
  },
  {
    opportunityId: "opp:sme:formalization-drive",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "sme",
    title: "SME formalization drive",
    summary: "One-stop CAC registration plus tiered tax holiday to formalize 60,000 nano/micro enterprises; unlocks finance and procurement eligibility.",
    score: 0.86, confidence: 0.74,
    estimatedJobsMin: 22_000, estimatedJobsMax: 41_000,
    budgetMin: 4_200, budgetMax: 7_500, horizonMonths: 36,
    reviewState: "in_review",
    evidenceRefs: ["ev:sql:cac-registrations-2024", "ev:document:cama-2020-sme"],
  },
  {
    opportunityId: "opp:agro:processing-clusters",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "agro",
    title: "Agro-processing clusters (ginger, maize, soy)",
    summary: "Anchor 9 cluster processing hubs around Kafanchan, Zaria and Makarfi with shared milling/drying infrastructure and offtake agreements.",
    score: 0.89, confidence: 0.81,
    estimatedJobsMin: 16_500, estimatedJobsMax: 24_000,
    budgetMin: 21_000, budgetMax: 33_000, horizonMonths: 42,
    reviewState: "approved",
    evidenceRefs: ["ev:sql:nbs-lfs-2024", "ev:sql:grid3-cropland"],
  },
  {
    opportunityId: "opp:digital:bpo-services",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "digital",
    title: "Digital services & BPO corridor",
    summary: "Two BPO centres (Kaduna, Zaria) plus digital-skills academy targeting data annotation, customer operations and back-office exports.",
    score: 0.78, confidence: 0.68,
    estimatedJobsMin: 6_000, estimatedJobsMax: 11_500,
    budgetMin: 9_400, budgetMax: 15_000, horizonMonths: 36,
    reviewState: "draft",
    evidenceRefs: ["ev:sql:nelex-placements-2024"],
  },
  {
    opportunityId: "opp:digital:solar-minigrid-crews",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "digital",
    title: "Solar mini-grid maintenance crews",
    summary: "Train and certify 800 technicians to operate/maintain mini-grids under NERC regulation; pairs energy access with SME productivity.",
    score: 0.74, confidence: 0.66,
    estimatedJobsMin: 3_200, estimatedJobsMax: 5_800,
    budgetMin: 5_600, budgetMax: 8_900, horizonMonths: 30,
    reviewState: "draft",
    evidenceRefs: ["ev:sql:nerc-minigrid-register"],
  },
  {
    opportunityId: "opp:proc:primary-health-expansion",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "proc",
    title: "Primary-health expansion staffing",
    summary: "Procurement-led PHC upgrade (255 wards) with community health worker recruitment and local construction lots.",
    score: 0.81, confidence: 0.72,
    estimatedJobsMin: 8_400, estimatedJobsMax: 13_200,
    budgetMin: 17_500, budgetMax: 26_000, horizonMonths: 36,
    reviewState: "in_review",
    evidenceRefs: ["ev:sql:bpp-contracts-2024", "ev:sql:grid3-settlements"],
  },
  {
    opportunityId: "opp:proc:market-infrastructure",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "proc",
    title: "Market infrastructure modernization",
    summary: "Rehabilitate 14 urban markets with vendor stalls, cold storage and waste services; construction and O&M employment.",
    score: 0.72, confidence: 0.63,
    estimatedJobsMin: 5_700, estimatedJobsMax: 9_600,
    budgetMin: 14_000, budgetMax: 22_500, horizonMonths: 40,
    reviewState: "draft",
    evidenceRefs: ["ev:sql:bpp-contracts-2024"],
  },
  {
    opportunityId: "opp:sme:waste-recycling-enterprise",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "sme",
    title: "Waste & recycling enterprise network",
    summary: "Franchise 300 collection micro-enterprises feeding two material recovery facilities; offtake contracts with recyclers.",
    score: 0.7, confidence: 0.61,
    estimatedJobsMin: 4_100, estimatedJobsMax: 7_300,
    budgetMin: 3_800, budgetMax: 6_200, horizonMonths: 28,
    reviewState: "draft",
    evidenceRefs: ["ev:sql:cac-registrations-2024"],
  },
  {
    opportunityId: "opp:edu:digital-classroom-assistants",
    jurisdictionId: "jur:ng-kd",
    sectorCode: "edu",
    title: "Digital classroom assistants",
    summary: "Deploy 2,400 trained assistants with device kits to junior secondary schools; blends education quality with digital jobs.",
    score: 0.69, confidence: 0.6,
    estimatedJobsMin: 2_400, estimatedJobsMax: 3_900,
    budgetMin: 4_900, budgetMax: 7_800, horizonMonths: 24,
    reviewState: "returned",
    evidenceRefs: ["ev:sql:ubec-schools-2024"],
  },
];

const INTERVENTIONS: (typeof schema.interventions.$inferInsert)[] = [
  { interventionId: "itv:teacher-recruitment", opportunityId: "opp:edu:teacher-pipeline", name: "Mass teacher recruitment", description: "Competency-tested recruitment of 25,000 teachers in three annual cohorts.", instrumentType: "public_employment", estimatedCost: 26_000, expectedJobs: 25_000, timelineMonths: 36, evidenceRefs: ["ev:sql:ubec-schools-2024"] },
  { interventionId: "itv:teacher-licensing", opportunityId: "opp:edu:teacher-pipeline", name: "Licensing & induction", description: "12-month induction and state licensing under the Kaduna teacher framework.", instrumentType: "regulation_capacity", estimatedCost: 12_000, expectedJobs: 1_800, timelineMonths: 36, evidenceRefs: ["ev:document:teacher-licensing-brief"] },
  { interventionId: "itv:school-meals-offtake", opportunityId: "opp:edu:school-meals-sourcing", name: "Local offtake contracts", description: "Ward-level offtake agreements with smallholder clusters for school feeding.", instrumentType: "procurement", estimatedCost: 15_500, expectedJobs: 11_500, timelineMonths: 30, evidenceRefs: ["ev:document:school-meals-policy"] },
  { interventionId: "itv:supplier-certification", opportunityId: "opp:proc:lga-supplier-development", name: "Supplier certification academy", description: "Certification, bid training and e-procurement onboarding for 1,200 suppliers.", instrumentType: "capacity_building", estimatedCost: 4_800, expectedJobs: 6_500, timelineMonths: 18, evidenceRefs: ["ev:sql:bpp-contracts-2024"] },
  { interventionId: "itv:reserved-lots", opportunityId: "opp:proc:lga-supplier-development", name: "Reserved youth lots", description: "Reserve 30% of LGA works lots for certified youth-led suppliers.", instrumentType: "procurement_policy", estimatedCost: 3_200, expectedJobs: 8_000, timelineMonths: 24, evidenceRefs: ["ev:graph:procurement-dependencies"] },
  { interventionId: "itv:cac-one-stop", opportunityId: "opp:sme:formalization-drive", name: "One-stop CAC desks", description: "LGA one-stop registration desks with fee waivers for nano enterprises.", instrumentType: "regulatory_reform", estimatedCost: 5_900, expectedJobs: 35_000, timelineMonths: 36, evidenceRefs: ["ev:sql:cac-registrations-2024"] },
  { interventionId: "itv:agro-hubs", opportunityId: "opp:agro:processing-clusters", name: "Cluster processing hubs", description: "9 shared-facility hubs (milling, drying, cold chain) with anchor offtakers.", instrumentType: "infrastructure", estimatedCost: 27_000, expectedJobs: 20_500, timelineMonths: 42, evidenceRefs: ["ev:sql:grid3-cropland"] },
  { interventionId: "itv:bpo-centres", opportunityId: "opp:digital:bpo-services", name: "BPO centre build-out", description: "Fit-out two 500-seat BPO centres with connectivity SLAs.", instrumentType: "infrastructure", estimatedCost: 12_200, expectedJobs: 8_500, timelineMonths: 30, evidenceRefs: ["ev:sql:nelex-placements-2024"] },
];

/* ------------------------------------------------------------------ */
/* Evidence sources                                                    */
/* ------------------------------------------------------------------ */

const EVIDENCE: (typeof schema.evidenceSources.$inferInsert)[] = [
  {
    evidenceSourceId: "ev:sql:nbs-lfs-2024",
    sourceType: "sql",
    citation: "NBS Nigeria Labour Force Survey Q3 2024 — Kaduna State tables",
    retrievalPath: "sector_metrics?jurisdiction_id=jur:ng-kd&metric_key=unemployment",
    confidence: 0.82,
    contentExcerpt: "Kaduna unemployment 29.8% (Q3 2024), youth unemployment 38.1%; labour force ≈ 3.6M.",
    linkedEntityIds: { opportunity_ids: ["opp:edu:teacher-pipeline", "opp:agro:processing-clusters"] },
  },
  {
    evidenceSourceId: "ev:sql:ubec-schools-2024",
    sourceType: "sql",
    citation: "UBEC 2024 Basic Education Statistics — Kaduna school census",
    retrievalPath: "sector_metrics?jurisdiction_id=jur:ng-kd&sector_code=edu",
    confidence: 0.88,
    contentExcerpt: "4,338 public basic schools; pupil-teacher ratio 47:1 urban, 71:1 rural.",
    linkedEntityIds: { opportunity_ids: ["opp:edu:teacher-pipeline", "opp:edu:digital-classroom-assistants"] },
  },
  {
    evidenceSourceId: "ev:sql:bpp-contracts-2024",
    sourceType: "sql",
    citation: "BPP Nigeria Open Contracting (NOCOPO) — Kaduna awards 2023–2024",
    retrievalPath: "sector_metrics?jurisdiction_id=jur:ng-kd&sector_code=proc",
    confidence: 0.76,
    contentExcerpt: "₦126.9bn awarded 2024 across 1,140 contracts; 18% to LGA-registered suppliers.",
    linkedEntityIds: { opportunity_ids: ["opp:proc:lga-supplier-development", "opp:proc:market-infrastructure"] },
  },
  {
    evidenceSourceId: "ev:sql:cac-registrations-2024",
    sourceType: "sql",
    citation: "CAC registration statistics 2024 — Kaduna new entities",
    retrievalPath: "sector_metrics?jurisdiction_id=jur:ng-kd&metric_key=sme_density",
    confidence: 0.71,
    contentExcerpt: "48.9 registered SMEs per 1,000 adults; formalization rate up 6.1% YoY.",
    linkedEntityIds: { opportunity_ids: ["opp:sme:formalization-drive", "opp:sme:waste-recycling-enterprise"] },
  },
  {
    evidenceSourceId: "ev:sql:grid3-cropland",
    sourceType: "sql",
    citation: "GRID3 Nigeria — cropland & settlement layers, Kaduna State 2024",
    retrievalPath: "geounits/jur:ng-kd",
    confidence: 0.79,
    contentExcerpt: "1.9M ha cultivated; high-density ginger belt across Kachia, Jema'a, Kagarko, Zangon Kataf.",
    linkedEntityIds: { opportunity_ids: ["opp:agro:processing-clusters"] },
  },
  {
    evidenceSourceId: "ev:sql:grid3-settlements",
    sourceType: "sql",
    citation: "GRID3 settlement extents — ward-level access modelling",
    retrievalPath: "geounits/jur:ng-kd",
    confidence: 0.73,
    contentExcerpt: "255 wards; 62% of settlements within 5km of a primary-health facility.",
    linkedEntityIds: { opportunity_ids: ["opp:proc:primary-health-expansion"] },
  },
  {
    evidenceSourceId: "ev:sql:nelex-placements-2024",
    sourceType: "sql",
    citation: "NELEX job-placement registry 2024 — digital services placements",
    retrievalPath: "sector_metrics?jurisdiction_id=jur:ng-kd&sector_code=digital",
    confidence: 0.64,
    contentExcerpt: "2,180 digital-services placements from Kaduna in 2024; median wage ₦95k/month.",
    linkedEntityIds: { opportunity_ids: ["opp:digital:bpo-services"] },
  },
  {
    evidenceSourceId: "ev:sql:nerc-minigrid-register",
    sourceType: "sql",
    citation: "NERC mini-grid register 2024 — licensed & interconnected sites",
    retrievalPath: "sector_metrics?jurisdiction_id=jur:ng-kd&sector_code=digital",
    confidence: 0.62,
    contentExcerpt: "41 mini-grids licensed in Kaduna; estimated 800 technician FTE demand by 2027.",
    linkedEntityIds: { opportunity_ids: ["opp:digital:solar-minigrid-crews"] },
  },
  {
    evidenceSourceId: "ev:document:teacher-licensing-brief",
    sourceType: "document",
    citation: "Kaduna State Teacher Licensing Framework implementation brief (2021)",
    retrievalPath: "documents/doc:ng-kd:teacher-licensing-framework",
    confidence: 0.77,
    contentExcerpt: "Licensing prerequisites, induction requirements and register administration.",
    linkedEntityIds: { law_ids: ["law:ng-kd:teacher-licensing"], opportunity_ids: ["opp:edu:teacher-pipeline"] },
  },
  {
    evidenceSourceId: "ev:document:school-meals-policy",
    sourceType: "document",
    citation: "National Home-Grown School Feeding Programme policy (re-issued 2023)",
    retrievalPath: "documents/doc:ng:school-meals-policy",
    confidence: 0.74,
    contentExcerpt: "Local-sourcing mandate: 70% of meal inputs from within the implementing LGA.",
    linkedEntityIds: { law_ids: ["law:ng:school-meals"], opportunity_ids: ["opp:edu:school-meals-sourcing"] },
  },
  {
    evidenceSourceId: "ev:document:cama-2020-sme",
    sourceType: "document",
    citation: "CAMA 2020 — SME-relevant provisions explainer (CAC guidance note)",
    retrievalPath: "documents/doc:ng:cama-2020-guidance",
    confidence: 0.7,
    contentExcerpt: "Single-member companies, reduced compliance burden for small companies.",
    linkedEntityIds: { law_ids: ["law:ng:cama-2020"], opportunity_ids: ["opp:sme:formalization-drive"] },
  },
  {
    evidenceSourceId: "ev:graph:procurement-dependencies",
    sourceType: "graph",
    citation: "Legal dependency graph — PPA 2007 ↔ Kaduna Procurement Law",
    retrievalPath: "legislation/graphQuery?seed_law_id=law:ng-kd:procurement-law",
    confidence: 0.83,
    contentExcerpt: "Reserved-lot policy requires state-law enabling clause consistent with PPA 2007 s.34.",
    linkedEntityIds: { law_ids: ["law:ng:ppa-2007", "law:ng-kd:procurement-law"], opportunity_ids: ["opp:proc:lga-supplier-development"] },
  },
];

/* ------------------------------------------------------------------ */
/* Laws, clauses, citation edges                                       */
/* ------------------------------------------------------------------ */

const LAWS: (typeof schema.laws.$inferInsert)[] = [
  { lawId: "law:ng:ppa-2007", title: "Public Procurement Act 2007", jurisdictionId: "jur:ng", category: "procurement", status: "in_force", year: 2007, sourceUri: "https://bpp.gov.ng/ppa-2007" },
  { lawId: "law:ng:cama-2020", title: "Companies and Allied Matters Act 2020", jurisdictionId: "jur:ng", category: "business", status: "in_force", year: 2020, sourceUri: "https://www.cac.gov.ng/cama-2020" },
  { lawId: "law:ng:school-meals", title: "National Home-Grown School Feeding Policy", jurisdictionId: "jur:ng", category: "education", status: "in_force", year: 2023, sourceUri: "https://nass.gov.ng/school-feeding" },
  { lawId: "law:ng-kd:teacher-licensing", title: "Kaduna State Teacher Licensing Framework", jurisdictionId: "jur:ng-kd", category: "education", status: "in_force", year: 2021, sourceUri: "https://kdsg.gov.ng/education/teacher-licensing" },
  { lawId: "law:ng-kd:procurement-law", title: "Kaduna State Public Procurement Law", jurisdictionId: "jur:ng-kd", category: "procurement", status: "in_force", year: 2016, sourceUri: "https://kdsg.gov.ng/procurement-law" },
];

type Obligation = { actor: string; action: string; condition?: string; penalty?: string };

const CLAUSES: (typeof schema.clauses.$inferInsert)[] = [
  // PPA 2007
  { clauseId: "cls:law:ng:ppa-2007:s16", lawId: "law:ng:ppa-2007", sectionPath: "s.16", text: "Procuring entities shall apply open competitive bidding for all public procurements except as otherwise provided by this Act.", language: "en", confidence: 0.95, reviewState: "approved", obligations: [{ actor: "procuring entity", action: "use open competitive bidding", condition: "all procurements unless exempt" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng:ppa-2007:s28", lawId: "law:ng:ppa-2007", sectionPath: "s.28", text: "The Bureau shall maintain a national database of federal contractors and issue certificates of registration to qualified suppliers.", language: "en", confidence: 0.94, reviewState: "approved", obligations: [{ actor: "BPP", action: "maintain contractor register" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng:ppa-2007:s34", lawId: "law:ng:ppa-2007", sectionPath: "s.34", text: "A procuring entity may grant a margin of preference in the evaluation of tenders to domestic and local contractors for the promotion of local content.", language: "en", confidence: 0.93, reviewState: "in_review", obligations: [{ actor: "procuring entity", action: "may apply margin of preference", condition: "local content promotion" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng:ppa-2007:s51", lawId: "law:ng:ppa-2007", sectionPath: "s.51", text: "The Bureau shall issue certificates of no objection for contract awards above prescribed thresholds.", language: "en", confidence: 0.9, reviewState: "draft", obligations: [{ actor: "BPP", action: "issue certificate of no objection", condition: "awards above threshold" } satisfies Obligation] as never },
  // CAMA 2020
  { clauseId: "cls:law:ng:cama-2020:s18", lawId: "law:ng:cama-2020", sectionPath: "s.18(2)", text: "A single member may form a private company, which shall be a limited liability company.", language: "en", confidence: 0.96, reviewState: "approved", obligations: [{ actor: "CAC", action: "register single-member companies" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng:cama-2020:s394", lawId: "law:ng:cama-2020", sectionPath: "s.394", text: "A small company shall be exempt from the requirement to appoint auditors and may file modified financial statements.", language: "en", confidence: 0.93, reviewState: "approved", obligations: [{ actor: "small company", action: "file modified statements", condition: "qualifies as small company" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng:cama-2020:s861", lawId: "law:ng:cama-2020", sectionPath: "s.861", text: "The Commission may prescribe reduced fees for the registration of business names and incorporated trustees to encourage formalization.", language: "en", confidence: 0.88, reviewState: "in_review", obligations: [{ actor: "CAC", action: "may prescribe reduced registration fees" } satisfies Obligation] as never },
  // School meals
  { clauseId: "cls:law:ng:school-meals:s4", lawId: "law:ng:school-meals", sectionPath: "§4.1", text: "Each participating school shall source no less than seventy per cent of meal inputs from producers within the implementing local government area.", language: "en", confidence: 0.86, reviewState: "in_review", obligations: [{ actor: "school feeding programme", action: "source ≥70% inputs locally", condition: "participating schools" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng:school-meals:s6", lawId: "law:ng:school-meals", sectionPath: "§6.2", text: "State ministries of education shall maintain a register of accredited caterers and inspect meal quality quarterly.", language: "en", confidence: 0.84, reviewState: "draft", obligations: [{ actor: "state ministry of education", action: "register caterers and inspect quarterly" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng:school-meals:s9", lawId: "law:ng:school-meals", sectionPath: "§9.3", text: "Payments to caterers shall be made through the designated payment platform within fourteen days of verified service.", language: "en", confidence: 0.81, reviewState: "draft", obligations: [{ actor: "programme payment desk", action: "pay within 14 days", condition: "verified service" } satisfies Obligation] as never },
  // Teacher licensing (Kaduna)
  { clauseId: "cls:law:ng-kd:teacher-licensing:s3", lawId: "law:ng-kd:teacher-licensing", sectionPath: "s.3", text: "No person shall teach in a public basic school in Kaduna State unless registered on the State Teachers Register.", language: "en", confidence: 0.92, reviewState: "approved", obligations: [{ actor: "teacher", action: "register on State Teachers Register", penalty: "ineligibility for employment" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng-kd:teacher-licensing:s7", lawId: "law:ng-kd:teacher-licensing", sectionPath: "s.7", text: "The Teachers Registration Board shall conduct competency tests and issue provisional licences valid for twenty-four months.", language: "en", confidence: 0.9, reviewState: "in_review", obligations: [{ actor: "Teachers Registration Board", action: "conduct competency tests", condition: "prior to licensing" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng-kd:teacher-licensing:s11", lawId: "law:ng-kd:teacher-licensing", sectionPath: "s.11", text: "The State Universal Basic Education Board shall administer the Register and publish the list of licensed teachers annually.", language: "en", confidence: 0.89, reviewState: "approved", obligations: [{ actor: "SUBEB", action: "administer register and publish annually" } satisfies Obligation] as never },
  // Kaduna procurement law
  { clauseId: "cls:law:ng-kd:procurement-law:s5", lawId: "law:ng-kd:procurement-law", sectionPath: "s.5", text: "The Kaduna State Bureau of Public Procurement is established to regulate and monitor public procurement in the State.", language: "en", confidence: 0.93, reviewState: "approved", obligations: [{ actor: "state government", action: "maintain Bureau of Public Procurement" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng-kd:procurement-law:s22", lawId: "law:ng-kd:procurement-law", sectionPath: "s.22", text: "The Bureau may designate categories of works and supplies for which preference shall be given to suppliers registered in the State.", language: "en", confidence: 0.87, reviewState: "in_review", obligations: [{ actor: "Bureau", action: "may designate preference categories", condition: "state-registered suppliers" } satisfies Obligation] as never },
  { clauseId: "cls:law:ng-kd:procurement-law:s31", lawId: "law:ng-kd:procurement-law", sectionPath: "s.31", text: "All procurement records shall be published on the State e-procurement portal within thirty days of contract award.", language: "en", confidence: 0.91, reviewState: "approved", obligations: [{ actor: "procuring entity", action: "publish award records within 30 days" } satisfies Obligation] as never },
];

const CITATIONS: Omit<typeof schema.citations.$inferInsert, "id">[] = [
  { fromClauseId: "cls:law:ng-kd:procurement-law:s22", toClauseId: "cls:law:ng:ppa-2007:s34", relation: "ENABLES", targetMeta: { note: "State preference scheme relies on federal local-content margin" } },
  { fromClauseId: "cls:law:ng-kd:procurement-law:s31", toClauseId: "cls:law:ng:ppa-2007:s16", relation: "CITES", targetMeta: { note: "Publication duty extends federal open-bidding transparency" } },
  { fromClauseId: "cls:law:ng:ppa-2007:s51", toClauseId: "cls:law:ng:ppa-2007:s16", relation: "RESTRICTS", targetMeta: { note: "No-objection gate above thresholds constrains direct awards" } },
  { fromClauseId: "cls:law:ng:school-meals:s4", toClauseId: "cls:law:ng:ppa-2007:s34", relation: "APPLIES_TO", targetMeta: { note: "Local sourcing uses preference margin mechanism" } },
  { fromClauseId: "cls:law:ng-kd:teacher-licensing:s11", toClauseId: "cls:law:ng-kd:teacher-licensing:s3", relation: "ADMINISTERED_BY", targetMeta: { note: "SUBEB administers the register required by s.3" } },
  { fromClauseId: "cls:law:ng-kd:teacher-licensing:s7", toClauseId: "cls:law:ng-kd:teacher-licensing:s3", relation: "ENABLES", targetMeta: { note: "Competency testing operationalizes registration" } },
  { fromClauseId: "cls:law:ng:cama-2020:s861", toClauseId: "cls:law:ng:cama-2020:s18", relation: "ENABLES", targetMeta: { note: "Reduced fees lower barrier to single-member incorporation" } },
  { fromClauseId: "cls:law:ng:school-meals:s6", toClauseId: "cls:law:ng-kd:procurement-law:s31", relation: "CITES", targetMeta: { note: "Caterer register published via state portal" } },
];

/* ------------------------------------------------------------------ */
/* Policy documents                                                    */
/* ------------------------------------------------------------------ */

const DOCUMENTS: (typeof schema.policyDocuments.$inferInsert)[] = [
  { documentId: "doc:ng-kd:teacher-licensing-framework", title: "Kaduna State Teacher Licensing Framework (gazetted)", jurisdictionId: "jur:ng-kd", language: "en", sourceUri: "https://kdsg.gov.ng/education/teacher-licensing", hash: "sha256:9f2c1ab7", reviewState: "approved", docType: "regulation", ocrConfidence: 0.94 },
  { documentId: "doc:ng:school-meals-policy", title: "National Home-Grown School Feeding Policy (2023 re-issue)", jurisdictionId: "jur:ng", language: "en", sourceUri: "https://nass.gov.ng/school-feeding", hash: "sha256:77d04e12", reviewState: "in_review", docType: "policy", ocrConfidence: 0.81 },
  { documentId: "doc:ng:ppa-2007-pdf", title: "Public Procurement Act 2007 (official gazette scan)", jurisdictionId: "jur:ng", language: "en", sourceUri: "https://bpp.gov.ng/ppa-2007", hash: "sha256:aa10c3f9", reviewState: "approved", docType: "statute", ocrConfidence: 0.71 },
  { documentId: "doc:ng:cama-2020-guidance", title: "CAMA 2020 CAC Guidance Note on Small Companies", jurisdictionId: "jur:ng", language: "en", sourceUri: "https://www.cac.gov.ng/cama-2020", hash: "sha256:5be891d0", reviewState: "in_review", docType: "guidance", ocrConfidence: 0.88 },
  { documentId: "doc:ng-kd:procurement-law-pdf", title: "Kaduna State Public Procurement Law 2016", jurisdictionId: "jur:ng-kd", language: "en", sourceUri: "https://kdsg.gov.ng/procurement-law", hash: "sha256:01fa7c62", reviewState: "draft", docType: "statute", ocrConfidence: 0.63 },
  { documentId: "doc:ng-kd:budget-2025", title: "Kaduna State 2025 Appropriation — sector allocations", jurisdictionId: "jur:ng-kd", language: "en", sourceUri: "https://kdsg.gov.ng/budget/2025", hash: "sha256:3cc77aa1", reviewState: "approved", docType: "budget", ocrConfidence: 0.9 },
];

/* ------------------------------------------------------------------ */
/* Scenarios, assumption sets, simulation runs                         */
/* ------------------------------------------------------------------ */

const ASSUMPTION_SETS: (typeof schema.assumptionSets.$inferInsert)[] = [
  {
    assumptionsSetId: "asm:edu:base",
    name: "Education baseline 2025",
    description: "Baseline for teacher pipeline and school-feeding scenarios.",
    entries: [
      { key: "pupil_teacher_ratio_target", label: "Target pupil-teacher ratio", value: 40, unit: "ratio", source_id: "src:ubec" },
      { key: "teacher_attrition", label: "Annual teacher attrition", value: 0.06, unit: "rate", source_id: "src:nbs" },
      { key: "cohort_size", label: "Annual recruitment cohort", value: 8500, unit: "teachers", source_id: "src:ubec" },
    ],
  },
  {
    assumptionsSetId: "asm:proc:base",
    name: "Procurement baseline 2025",
    description: "Baseline for supplier development scenarios.",
    entries: [
      { key: "reserved_lot_share", label: "Reserved youth-lot share", value: 0.3, unit: "share", source_id: "src:bpp" },
      { key: "avg_lot_value", label: "Average LGA lot value", value: 18, unit: "NGN_m", source_id: "src:bpp" },
      { key: "supplier_cert_rate", label: "Certification pass rate", value: 0.72, unit: "rate", source_id: "src:cac" },
    ],
  },
  {
    assumptionsSetId: "asm:agro:base",
    name: "Agro-cluster baseline 2025",
    description: "Baseline for agro-processing cluster scenarios.",
    entries: [
      { key: "hubs", label: "Processing hubs", value: 9, unit: "count", source_id: "src:grid3" },
      { key: "jobs_per_hub", label: "Direct jobs per hub", value: 1800, unit: "jobs", source_id: "src:nbs" },
      { key: "offtake_coverage", label: "Offtake coverage", value: 0.65, unit: "share", source_id: "src:nbs" },
    ],
  },
];

const SCENARIOS: (typeof schema.scenarios.$inferInsert)[] = [
  {
    scenarioId: "scn:001",
    jurisdictionId: "jur:ng-kd",
    name: "education_jobs_v1",
    description: "Teacher pipeline + school meals: education-led employment path to 2027.",
    interventionIds: ["itv:teacher-recruitment", "itv:teacher-licensing", "itv:school-meals-offtake"],
    assumptionsSetId: "asm:edu:base",
    modelPlan: [{ engine: "forecast" }, { engine: "system_dynamics" }],
    status: "active",
    version: 1,
    createdBy: null,
  },
  {
    scenarioId: "scn:002",
    jurisdictionId: "jur:ng-kd",
    name: "procurement_sme_v1",
    description: "Supplier development + SME formalization: procurement-led jobs to 2027.",
    interventionIds: ["itv:supplier-certification", "itv:reserved-lots", "itv:cac-one-stop"],
    assumptionsSetId: "asm:proc:base",
    modelPlan: [{ engine: "causal" }, { engine: "optimization" }],
    status: "active",
    version: 1,
    createdBy: null,
  },
  {
    scenarioId: "scn:003",
    jurisdictionId: "jur:ng-kd",
    name: "agro_cluster_v1",
    description: "Agro-processing clusters: hub employment build-out to 2028.",
    interventionIds: ["itv:agro-hubs"],
    assumptionsSetId: "asm:agro:base",
    modelPlan: [{ engine: "abm" }, { engine: "microsim" }],
    status: "active",
    version: 1,
    createdBy: null,
  },
];

const RUNS: { id: string; scenario: string; engine: SimulationEngine; seed: number }[] = [
  { id: "sim:001", scenario: "scn:001", engine: "forecast", seed: 101 },
  { id: "sim:002", scenario: "scn:001", engine: "system_dynamics", seed: 102 },
  { id: "sim:003", scenario: "scn:002", engine: "causal", seed: 201 },
  { id: "sim:004", scenario: "scn:002", engine: "optimization", seed: 202 },
  { id: "sim:005", scenario: "scn:003", engine: "abm", seed: 301 },
  { id: "sim:006", scenario: "scn:003", engine: "microsim", seed: 302 },
];

function buildRuns(): (typeof schema.simulationRuns.$inferInsert)[] {
  return RUNS.map((r) => {
    const result = runFallbackEngine({
      scenario_id: r.scenario,
      engine: r.engine,
      seed: r.seed,
      horizon_months: 36,
      baseline_employment: 3_600_000,
      intervention_strength: 0.6,
    });
    return {
      simulationRunId: r.id,
      scenarioId: r.scenario,
      engine: r.engine,
      executionProfile: { mode: "deterministic-fallback" },
      modelVersions: result.model_versions,
      status: "succeeded" as const,
      progress: 100,
      resultSummary: result as never,
      artifactUri: `artifacts://${r.scenario}/${r.id}.json`,
      seed: r.seed,
      startedAt: daysAgo(12),
      finishedAt: daysAgo(12),
      createdAt: daysAgo(12),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Briefs                                                              */
/* ------------------------------------------------------------------ */

const BRIEFS: (typeof schema.briefs.$inferInsert)[] = [
  {
    briefId: "brf:ng-kd:jobs-strategy-2027",
    jurisdictionId: "jur:ng-kd",
    template: "executive_memo",
    title: "Kaduna Jobs Strategy 2027 — Executive Memo",
    reviewState: "signed_off",
    content: {
      title: "Kaduna Jobs Strategy 2027",
      sections: [
        { heading: "Executive summary", body: "The evidence base supports a five-instrument portfolio to deliver 250,000 new jobs by 2027. Teacher pipeline and agro-processing clusters are the highest-confidence anchors." },
        { heading: "Portfolio", body: "Ranked opportunities: teacher pipeline (0.91), agro clusters (0.89), LGA supplier development (0.88), SME formalization (0.86), school-meals sourcing (0.84)." },
        { heading: "Recommendation", body: "Approve phased rollout beginning with the teacher pipeline in 8 pilot LGAs, subject to quarterly KPI review." },
      ],
      citations_rail: [
        { evidence_source_id: "ev:sql:nbs-lfs-2024", citation: "NBS LFS Q3 2024" },
        { evidence_source_id: "ev:sql:ubec-schools-2024", citation: "UBEC 2024 census" },
      ],
    } as never,
    modelRouting: { tier: "qwen3-32b", model: "qwen3-32b-instruct", fallback: false } as never,
    requestId: "req_seed_brf001",
    createdBy: null,
    approvedBy: null,
    signedOffAt: daysAgo(9),
    createdAt: daysAgo(14),
  },
  {
    briefId: "brf:ng-kd:q1-education",
    jurisdictionId: "jur:ng-kd",
    template: "sector_brief",
    title: "Q1 Education Sector Brief — Teacher Pipeline Readiness",
    reviewState: "in_review",
    content: {
      title: "Q1 Education Sector Brief",
      sections: [
        { heading: "Situation", body: "Pupil-teacher ratio stands at 47:1 urban / 71:1 rural against a 40:1 target; 25,000-teacher pipeline scenario scn:001 projects closure within 36 months." },
        { heading: "Legal readiness", body: "Teacher Licensing Framework clauses s.3/s.11 approved; s.7 (competency testing) remains in legal review." },
        { heading: "Next steps", body: "Complete legal review of licensing clauses; confirm cohort-1 budget release; begin competency testing procurement." },
      ],
      citations_rail: [
        { evidence_source_id: "ev:sql:ubec-schools-2024", citation: "UBEC 2024 census" },
        { evidence_source_id: "ev:document:teacher-licensing-brief", citation: "Teacher Licensing brief" },
      ],
    } as never,
    modelRouting: { tier: "qwen3-32b", model: "qwen3-32b-instruct", fallback: false } as never,
    requestId: "req_seed_brf002",
    createdBy: null,
    createdAt: daysAgo(3),
  },
];

/* ------------------------------------------------------------------ */
/* Data sources (13) — health variety incl. 1 failing, 2 stale         */
/* ------------------------------------------------------------------ */

const DATA_SOURCES: (typeof schema.dataSources.$inferInsert)[] = [
  { sourceId: "src:nbs", name: "National Bureau of Statistics", owner: "NBS", url: "https://nigerianstat.gov.ng", category: "statistics", accessMethod: "api", refreshCadence: "quarterly", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(5), freshnessDays: 5, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "Nigeria Data Act 2023 (public)", qualityScore: 88, privacyClassification: "public", geographyScope: "national+states" },
  { sourceId: "src:nbs-microdata", name: "NBS Microdata Library", owner: "NBS", url: "https://microdata.nigerianstat.gov.ng", category: "microdata", accessMethod: "download", refreshCadence: "annual", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(11), freshnessDays: 11, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "NBS Microdata License (registered use)", qualityScore: 76, privacyClassification: "restricted", geographyScope: "national+states" },
  { sourceId: "src:national-assembly", name: "National Assembly Bills & Acts", owner: "NASS", url: "https://nass.gov.ng", category: "legislation", accessMethod: "scrape", refreshCadence: "weekly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(2), freshnessDays: 2, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "Public legislative record", qualityScore: 82, privacyClassification: "public", geographyScope: "federal" },
  { sourceId: "src:budget-office", name: "Budget Office of the Federation", owner: "BOF", url: "https://budgetoffice.gov.ng", category: "fiscal", accessMethod: "download", refreshCadence: "annual", ingestionPattern: "batch", health: "stale", lastRefresh: daysAgo(41), freshnessDays: 41, contractCompliance: { schema_ok: true, sla_ok: false, license_ok: true, notes: "2025 implementation report delayed" }, license: "Public fiscal document", qualityScore: 61, privacyClassification: "public", geographyScope: "federal" },
  { sourceId: "src:cac", name: "Corporate Affairs Commission", owner: "CAC", url: "https://www.cac.gov.ng", category: "business_registry", accessMethod: "api", refreshCadence: "monthly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(8), freshnessDays: 8, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "CAC API Terms of Use", qualityScore: 74, privacyClassification: "internal", geographyScope: "national" },
  { sourceId: "src:bpp", name: "Bureau of Public Procurement (NOCOPO)", owner: "BPP", url: "https://bpp.gov.ng", category: "procurement", accessMethod: "api", refreshCadence: "monthly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(6), freshnessDays: 6, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "NOCOPO open contracting (OCDS)", qualityScore: 79, privacyClassification: "public", geographyScope: "national" },
  { sourceId: "src:osgof", name: "OSGoF Geospatial Data", owner: "OSGoF", url: "https://osgof.gov.ng", category: "geospatial", accessMethod: "download", refreshCadence: "quarterly", ingestionPattern: "batch", health: "stale", lastRefresh: daysAgo(34), freshnessDays: 34, contractCompliance: { schema_ok: true, sla_ok: false, license_ok: true }, license: "OSGoF data-sharing agreement", qualityScore: 58, privacyClassification: "internal", geographyScope: "national" },
  { sourceId: "src:grid3", name: "GRID3 Nigeria", owner: "GRID3", url: "https://grid3.org", category: "geospatial", accessMethod: "api", refreshCadence: "quarterly", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(9), freshnessDays: 9, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "CC BY 4.0", qualityScore: 85, privacyClassification: "public", geographyScope: "national" },
  { sourceId: "src:ubec", name: "Universal Basic Education Commission", owner: "UBEC", url: "https://ubec.gov.ng", category: "education", accessMethod: "download", refreshCadence: "annual", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(13), freshnessDays: 13, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "Public sector statistics", qualityScore: 71, privacyClassification: "public", geographyScope: "national" },
  { sourceId: "src:ndpc", name: "Nigeria Data Protection Commission", owner: "NDPC", url: "https://ndpc.gov.ng", category: "compliance", accessMethod: "scrape", refreshCadence: "monthly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(10), freshnessDays: 10, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "Public regulatory register", qualityScore: 80, privacyClassification: "public", geographyScope: "national" },
  { sourceId: "src:open-treasury", name: "Open Treasury Portal", owner: "OAGF", url: "https://opentreasury.gov.ng", category: "fiscal", accessMethod: "api", refreshCadence: "daily", ingestionPattern: "streaming", health: "failing", lastRefresh: daysAgo(19), freshnessDays: 19, contractCompliance: { schema_ok: false, sla_ok: false, license_ok: true, notes: "Schema drift: payment voucher v3 fields unmapped since 2025-12" }, license: "Public fiscal data (v3 drift)", qualityScore: 42, privacyClassification: "public", geographyScope: "federal" },
  { sourceId: "src:nerc", name: "Nigerian Electricity Regulatory Commission", owner: "NERC", url: "https://nerc.gov.ng", category: "energy", accessMethod: "scrape", refreshCadence: "quarterly", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(7), freshnessDays: 7, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "Public regulatory data", qualityScore: 73, privacyClassification: "public", geographyScope: "national" },
  { sourceId: "src:nelex", name: "NELEX Job Exchange", owner: "FMLE", url: "https://nelex.ng", category: "labour", accessMethod: "api", refreshCadence: "weekly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(4), freshnessDays: 4, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "NELEX API Terms of Use", qualityScore: 69, privacyClassification: "internal", geographyScope: "national" },
];

const PIPELINE_RUNS: (typeof schema.pipelineRuns.$inferInsert)[] = [
  { pipelineId: "run:nbs:20260122", sourceId: "src:nbs", status: "succeeded", startedAt: daysAgo(5), finishedAt: daysAgo(5), rowsProcessed: 14_208, error: null },
  { pipelineId: "run:cac:20260119", sourceId: "src:cac", status: "succeeded", startedAt: daysAgo(8), finishedAt: daysAgo(8), rowsProcessed: 61_337, error: null },
  { pipelineId: "run:bpp:20260121", sourceId: "src:bpp", status: "succeeded", startedAt: daysAgo(6), finishedAt: daysAgo(6), rowsProcessed: 1_140, error: null },
  { pipelineId: "run:grid3:20260118", sourceId: "src:grid3", status: "succeeded", startedAt: daysAgo(9), finishedAt: daysAgo(9), rowsProcessed: 88_510, error: null },
  { pipelineId: "run:open-treasury:20260108", sourceId: "src:open-treasury", status: "failed", startedAt: daysAgo(19), finishedAt: daysAgo(19), rowsProcessed: 3_012, error: "Schema drift: payment voucher v3 fields unmapped (contract_compliance.schema_ok=false)" },
  { pipelineId: "run:open-treasury:20260115", sourceId: "src:open-treasury", status: "failed", startedAt: daysAgo(12), finishedAt: daysAgo(12), rowsProcessed: 0, error: "HTTP 503 from opentreasury.gov.ng after 3 retries" },
  { pipelineId: "run:budget-office:20251217", sourceId: "src:budget-office", status: "succeeded", startedAt: daysAgo(41), finishedAt: daysAgo(41), rowsProcessed: 2_004, error: null },
  { pipelineId: "run:osgof:20251224", sourceId: "src:osgof", status: "succeeded", startedAt: daysAgo(34), finishedAt: daysAgo(34), rowsProcessed: 41_900, error: null },
];

const REVIEW_TASKS: (typeof schema.reviewTasks.$inferInsert)[] = [
  { taskId: "task:001", type: "ocr_low_confidence", entityRef: "doc:ng-kd:procurement-law-pdf", assigneeRole: "data_steward", status: "open", payload: { ocr_confidence: 0.63, pages_flagged: 12 } },
  { taskId: "task:002", type: "ocr_low_confidence", entityRef: "doc:ng:ppa-2007-pdf", assigneeRole: "data_steward", status: "in_progress", payload: { ocr_confidence: 0.71, pages_flagged: 7 } },
  { taskId: "task:003", type: "legal_extract", entityRef: "cls:law:ng-kd:procurement-law:s22", assigneeRole: "legal_analyst", status: "open", payload: { question: "Confirm preference-category scope vs PPA s.34" } },
  { taskId: "task:004", type: "legal_extract", entityRef: "cls:law:ng:ppa-2007:s34", assigneeRole: "legal_analyst", status: "in_progress", payload: { question: "Validate margin-of-preference extraction confidence 0.93" } },
  { taskId: "task:005", type: "data_quality", entityRef: "src:open-treasury", assigneeRole: "data_steward", status: "open", payload: { issue: "schema drift in payment voucher v3", failing_since: "2026-01-08" } },
];

/* ------------------------------------------------------------------ */
/* Audit trail seed                                                    */
/* ------------------------------------------------------------------ */

const AUDIT_EVENTS: Omit<typeof schema.auditEvents.$inferInsert, "eventId">[] = [
  { actorId: null, action: "ingest.raw.received", entityType: "data_source", entityId: "src:nbs", scopes: ["ingest"], requestId: "req_seed_a01", correlationId: "cor_seed_a01", payload: { topic: "ingest.raw.received", rows: 14208 }, createdAt: daysAgo(5) },
  { actorId: null, action: "features.materialized", entityType: "sector_metrics", entityId: "jur:ng-kd", scopes: ["features"], requestId: "req_seed_a02", correlationId: "cor_seed_a02", payload: { topic: "features.materialized", metrics: 44 }, createdAt: daysAgo(5) },
  { actorId: null, action: "scenarios.run.requested", entityType: "scenario", entityId: "scn:001", scopes: ["scenarios:run"], requestId: "req_seed_a03", correlationId: "cor_seed_a03", payload: { topic: "scenarios.run.requested", engine: "forecast" }, createdAt: daysAgo(12) },
  { actorId: null, action: "simulations.run.completed", entityType: "simulation_run", entityId: "sim:001", scopes: ["scenarios:run"], requestId: "req_seed_a04", correlationId: "cor_seed_a03", payload: { topic: "simulations.run.completed", status: "succeeded" }, createdAt: daysAgo(12) },
  { actorId: null, action: "reports.generated", entityType: "brief", entityId: "brf:ng-kd:jobs-strategy-2027", scopes: ["briefs:generate"], requestId: "req_seed_a05", correlationId: "cor_seed_a05", payload: { topic: "reports.generated", template: "executive_memo" }, createdAt: daysAgo(14) },
  { actorId: null, action: "briefs.signed_off", entityType: "brief", entityId: "brf:ng-kd:jobs-strategy-2027", scopes: ["briefs:signoff"], requestId: "req_seed_a06", correlationId: "cor_seed_a06", payload: { topic: "audit.events", from_state: "approved", to_state: "signed_off" }, createdAt: daysAgo(9) },
  { actorId: null, action: "ops.alerts", entityType: "data_source", entityId: "src:open-treasury", scopes: ["ops"], requestId: "req_seed_a07", correlationId: "cor_seed_a07", payload: { topic: "ops.alerts", alert: "pipeline failing", consecutive_failures: 2 }, createdAt: daysAgo(12) },
  { actorId: null, action: "briefs.exported", entityType: "brief", entityId: "brf:ng-kd:jobs-strategy-2027", scopes: ["briefs:export"], requestId: "req_seed_a08", correlationId: "cor_seed_a08", payload: { topic: "audit.events", data: { format: "brief_pdf" } }, createdAt: daysAgo(8) },
];

const APPROVAL_EVENTS: Omit<typeof schema.approvalEvents.$inferInsert, "id">[] = [
  { entityType: "brief", entityId: "brf:ng-kd:jobs-strategy-2027", fromState: "draft", toState: "in_review", actorId: 1, comment: "Ready for legal + policy review.", createdAt: daysAgo(13) },
  { entityType: "brief", entityId: "brf:ng-kd:jobs-strategy-2027", fromState: "in_review", toState: "approved", actorId: 1, comment: "Evidence base verified against UBEC/NBS sources.", createdAt: daysAgo(10) },
  { entityType: "brief", entityId: "brf:ng-kd:jobs-strategy-2027", fromState: "approved", toState: "signed_off", actorId: 1, comment: "Signed off for cabinet circulation.", createdAt: daysAgo(9) },
  { entityType: "brief", entityId: "brf:ng-kd:q1-education", fromState: "draft", toState: "in_review", actorId: 1, comment: "Q1 brief submitted for review.", createdAt: daysAgo(3) },
  { entityType: "clause", entityId: "cls:law:ng-kd:teacher-licensing:s3", fromState: "in_review", toState: "approved", actorId: 1, comment: "Extraction verified against gazette.", createdAt: daysAgo(20) },
  { entityType: "clause", entityId: "cls:law:ng:ppa-2007:s34", fromState: "draft", toState: "in_review", actorId: 1, comment: "Margin-of-preference scope needs confirmation.", createdAt: daysAgo(6) },
];

/* ------------------------------------------------------------------ */
/* Demo users + jurisdiction grants (ABAC)                             */
/* ------------------------------------------------------------------ */

const DEMO_USERS: (typeof schema.users.$inferInsert)[] = [
  { unionId: "demo-policy-analyst", name: "Demo Policy Analyst", email: "analyst@example.test", role: "user", platformRole: "policy_analyst" },
  { unionId: "demo-legal-analyst", name: "Demo Legal Analyst", email: "legal@example.test", role: "user", platformRole: "legal_analyst" },
  { unionId: "demo-sim-specialist", name: "Demo Simulation Specialist", email: "sim@example.test", role: "user", platformRole: "simulation_specialist" },
];

/* ------------------------------------------------------------------ */
/* Sector jobs-multiplier library (documented literature ranges)       */
/* ------------------------------------------------------------------ */

const SECTOR_MULTIPLIERS: (typeof schema.sectorMultipliers.$inferInsert)[] = [
  { sectorCode: "edu", direct: 1.0, indirect: 0.4, induced: 0.3, source: "ILO employment-multiplier ranges for public education programmes (2019); UK ONS education Type-II ~1.6", confidence: 0.7 },
  { sectorCode: "sme", direct: 1.0, indirect: 0.6, induced: 0.5, source: "World Bank SME formalization multipliers (2021); Nigeria SMEDAN MSME survey-derived ranges", confidence: 0.65 },
  { sectorCode: "proc", direct: 1.0, indirect: 0.8, induced: 0.6, source: "OECD public-procurement local-content multiplier band 1.8-2.4; BPP NOCOPO preference-scheme evaluations", confidence: 0.6 },
  { sectorCode: "agro", direct: 1.0, indirect: 0.7, induced: 0.5, source: "IFPRI Nigeria agro-processing SAM multipliers (2020); FAO agro-industry Type-II 1.9-2.3", confidence: 0.7 },
  { sectorCode: "digital", direct: 1.0, indirect: 0.5, induced: 0.4, source: "GSMA digital-services employment multiplier range (2022); NCC broadband-economy studies", confidence: 0.55 },
];

/* ------------------------------------------------------------------ */
/* Scenario template marketplace seed                                  */
/* ------------------------------------------------------------------ */

const SCENARIO_TEMPLATES: (typeof schema.scenarioTemplates.$inferInsert)[] = [
  {
    templateId: "tpl:edu-teacher-pipeline",
    name: "Teacher Pipeline 25k",
    description: "Recruit and license 25,000 teachers over 36 months with school-meals local sourcing.",
    config: { intervention_ids: ["itv:teacher-recruitment", "itv:school-meals-sourcing"], model_plan: [{ engine: "forecast" }, { engine: "system_dynamics" }], horizon_months: 36 },
    authorJurisdiction: "jur:ng-kd",
    installs: 4,
    rating: 4.5,
    publishedState: "approved",
  },
  {
    templateId: "tpl:sme-formalization",
    name: "SME Formalization Drive",
    description: "CAC one-stop formalization + credit window for 40k informal firms.",
    config: { intervention_ids: ["itv:sme-formalization"], model_plan: [{ engine: "microsim" }], horizon_months: 24 },
    authorJurisdiction: "jur:ng-kd",
    installs: 2,
    rating: 4.0,
    publishedState: "approved",
  },
  {
    templateId: "tpl:proc-local-content",
    name: "Local-Content Procurement Shift",
    description: "Margin-of-preference procurement steering 60% of state spend to in-state suppliers.",
    config: { intervention_ids: ["itv:procurement-preference"], model_plan: [{ engine: "causal" }], horizon_months: 36 },
    authorJurisdiction: "jur:ng-kd",
    installs: 1,
    rating: 3.8,
    publishedState: "in_review",
  },
];

/* ------------------------------------------------------------------ */
/* Webhook subscription seed                                           */
/* ------------------------------------------------------------------ */

const WEBHOOKS: (typeof schema.webhookSubscriptions.$inferInsert)[] = [
  {
    subId: "sub:demo-ops-alerts",
    url: "http://localhost:3000/api/webhooks/demo",
    topics: ["ops.alerts", "simulations.run.completed"],
    secret: "demo-webhook-secret-0123456789abcdef",
    active: 1,
  },
];

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function ensureStringPk<Row extends Record<string, unknown>>(
  label: string,
  table: never,
  pkCol: never,
  rows: Row[],
  pkField: keyof Row,
) {
  const have = await existingIds(table, pkCol);
  const missing = rows.filter((r) => !have.has(String(r[pkField])));
  if (missing.length > 0) {
    await db.insert(table as never).values(missing as never);
  }
  console.log(`  ${label}: ${missing.length} inserted, ${have.size} existing`);
}


/* ------------------------------------------------------------------ */
/* Canonical model completion seed (additive — feat-data-loader).      */
/* 9 Kaduna budget lines FY2023–25, 6 officials, 4 flagship programs,  */
/* 25 sample business registrations, 69 facilities at real LGA         */
/* centroids, 23 real LGA boundary polygons (OSM, DP-simplified).      */
/* ------------------------------------------------------------------ */

const BUDGETS: (typeof schema.budgets.$inferInsert)[] = [
  { budgetId: "bud:ng-kd-2023-edu", jurisdictionId: "jur:ng-kd", fiscalYear: 2023, mda: "Ministry of Education", sectorCode: "education", appropriatedNgn: 68400000000, releasedNgn: 51200000000, source: "seed:kd-appropriation-2023", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2023-health", jurisdictionId: "jur:ng-kd", fiscalYear: 2023, mda: "Ministry of Health", sectorCode: "health", appropriatedNgn: 52100000000, releasedNgn: 38700000000, source: "seed:kd-appropriation-2023", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2023-works", jurisdictionId: "jur:ng-kd", fiscalYear: 2023, mda: "Ministry of Works & Infrastructure", sectorCode: "infrastructure", appropriatedNgn: 84300000000, releasedNgn: 60900000000, source: "seed:kd-appropriation-2023", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2024-edu", jurisdictionId: "jur:ng-kd", fiscalYear: 2024, mda: "Ministry of Education", sectorCode: "education", appropriatedNgn: 82600000000, releasedNgn: 47800000000, source: "seed:kd-appropriation-2024", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2024-health", jurisdictionId: "jur:ng-kd", fiscalYear: 2024, mda: "Ministry of Health", sectorCode: "health", appropriatedNgn: 61400000000, releasedNgn: 33100000000, source: "seed:kd-appropriation-2024", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2024-works", jurisdictionId: "jur:ng-kd", fiscalYear: 2024, mda: "Ministry of Works & Infrastructure", sectorCode: "infrastructure", appropriatedNgn: 102700000000, releasedNgn: 58400000000, source: "seed:kd-appropriation-2024", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2025-edu", jurisdictionId: "jur:ng-kd", fiscalYear: 2025, mda: "Ministry of Education", sectorCode: "education", appropriatedNgn: 79900000000, releasedNgn: 18300000000, source: "seed:kd-appropriation-2025", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2025-health", jurisdictionId: "jur:ng-kd", fiscalYear: 2025, mda: "Ministry of Health", sectorCode: "health", appropriatedNgn: 58800000000, releasedNgn: 12600000000, source: "seed:kd-appropriation-2025", origin: "seed", sourceUrl: null },
  { budgetId: "bud:ng-kd-2025-works", jurisdictionId: "jur:ng-kd", fiscalYear: 2025, mda: "Ministry of Works & Infrastructure", sectorCode: "infrastructure", appropriatedNgn: 97200000000, releasedNgn: 21500000000, source: "seed:kd-appropriation-2025", origin: "seed", sourceUrl: null },
];

const OFFICIALS: (typeof schema.officials.$inferInsert)[] = [
  { officialId: "off:ng-kd-comm-budget", jurisdictionId: "jur:ng-kd", name: "Hon. Commissioner for Budget & Planning", role: "Commissioner for Budget & Planning", level: "state", party: null, validFrom: "2023-08-01", validTo: null, source: "seed:role-title", origin: "seed", sourceUrl: null },
  { officialId: "off:ng-kd-comm-education", jurisdictionId: "jur:ng-kd", name: "Hon. Commissioner for Education", role: "Commissioner for Education", level: "state", party: null, validFrom: "2023-08-01", validTo: null, source: "seed:role-title", origin: "seed", sourceUrl: null },
  { officialId: "off:ng-kd-comm-health", jurisdictionId: "jur:ng-kd", name: "Hon. Commissioner for Health", role: "Commissioner for Health", level: "state", party: null, validFrom: "2023-08-01", validTo: null, source: "seed:role-title", origin: "seed", sourceUrl: null },
  { officialId: "off:ng-kd-comm-works", jurisdictionId: "jur:ng-kd", name: "Hon. Commissioner for Works & Infrastructure", role: "Commissioner for Works & Infrastructure", level: "state", party: null, validFrom: "2023-08-01", validTo: null, source: "seed:role-title", origin: "seed", sourceUrl: null },
  { officialId: "off:ng-kd-deputy", jurisdictionId: "jur:ng-kd", name: "Hadiza Sabuwa Balarabe", role: "Deputy Governor", level: "state", party: "APC", validFrom: "2023-05-29", validTo: null, source: "public-record:kdsg", origin: "seed", sourceUrl: null },
  { officialId: "off:ng-kd-governor", jurisdictionId: "jur:ng-kd", name: "Uba Sani", role: "Governor", level: "state", party: "APC", validFrom: "2023-05-29", validTo: null, source: "public-record:kdsg", origin: "seed", sourceUrl: null },
];

const PROGRAMS: (typeof schema.programs.$inferInsert)[] = [
  { programId: "prg:ng-kd-agro-corridor", jurisdictionId: "jur:ng-kd", name: "Agro-processing Corridor Initiative (maize/ginger value chains)", sectorCode: "agriculture", status: "active", targetJobs: 60000, budgetId: "bud:ng-kd-2024-works", origin: "seed", sourceUrl: null },
  { programId: "prg:ng-kd-digital-skills", jurisdictionId: "jur:ng-kd", name: "Digital Skills & Remote Work Accelerator", sectorCode: "digital", status: "active", targetJobs: 25000, budgetId: "bud:ng-kd-2025-edu", origin: "seed", sourceUrl: null },
  { programId: "prg:ng-kd-jobs-250k", jurisdictionId: "jur:ng-kd", name: "Kaduna Jobs 250K \u2014 inclusive employment compact", sectorCode: "labor", status: "active", targetJobs: 250000, budgetId: "bud:ng-kd-2025-edu", origin: "seed", sourceUrl: null },
  { programId: "prg:ng-kd-phc-revitalization", jurisdictionId: "jur:ng-kd", name: "PHC Revitalization \u2014 255 ward-level primary health centres", sectorCode: "health", status: "active", targetJobs: 8500, budgetId: "bud:ng-kd-2024-health", origin: "seed", sourceUrl: null },
];

const BUSINESS_REGISTRATIONS: (typeof schema.businessRegistrations.$inferInsert)[] = [
  { registrationId: "biz:seed:rc1636147", jurisdictionId: "jur:ng-kd", name: "Kaduna South Welders Guild Ltd", rcNumber: "RC1636147", entityType: "limited_liability", registeredAt: "2023-05-15", status: "active", lga: "Kaduna South", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1644908", jurisdictionId: "jur:ng-kd", name: "Kachia Timber Works Ltd", rcNumber: "RC1644908", entityType: "limited_liability", registeredAt: "2022-01-15", status: "active", lga: "Kachia", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1655920", jurisdictionId: "jur:ng-kd", name: "Kaduna Textile Recyclers Ltd", rcNumber: "RC1655920", entityType: "limited_liability", registeredAt: "2024-03-15", status: "active", lga: "Kaduna North", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1667811", jurisdictionId: "jur:ng-kd", name: "Soba Dairy Collection Ltd", rcNumber: "RC1667811", entityType: "limited_liability", registeredAt: "2022-07-15", status: "active", lga: "Soba", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1673121", jurisdictionId: "jur:ng-kd", name: "Jaba Beekeepers Enterprise", rcNumber: "RC1673121", entityType: "cooperative", registeredAt: "2023-02-15", status: "active", lga: "Jaba", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1682733", jurisdictionId: "jur:ng-kd", name: "Kagarko Blocks & Aggregates Ltd", rcNumber: "RC1682733", entityType: "cooperative", registeredAt: "2022-07-15", status: "active", lga: "Kagarko", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1698844", jurisdictionId: "jur:ng-kd", name: "Giwa Rice Parboilers Assoc Ltd", rcNumber: "RC1698844", entityType: "limited_liability", registeredAt: "2022-04-15", status: "active", lga: "Giwa", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1704556", jurisdictionId: "jur:ng-kd", name: "Zangon Kataf Vegetable Growers Ltd", rcNumber: "RC1704556", entityType: "limited_liability", registeredAt: "2024-06-15", status: "active", lga: "Zangon Kataf", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1719678", jurisdictionId: "jur:ng-kd", name: "Ikara Tomatoes Processing Ltd", rcNumber: "RC1719678", entityType: "limited_liability", registeredAt: "2024-09-15", status: "active", lga: "Ikara", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1720894", jurisdictionId: "jur:ng-kd", name: "Kauru Cassava Flour Mills", rcNumber: "RC1720894", entityType: "limited_liability", registeredAt: "2024-03-15", status: "active", lga: "Kauru", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1733845", jurisdictionId: "jur:ng-kd", name: "Sabon Gari Agro Inputs Ventures", rcNumber: "RC1733845", entityType: "cooperative", registeredAt: "2022-04-15", status: "active", lga: "Sabon Gari", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1740678", jurisdictionId: "jur:ng-kd", name: "Barnawa Pharmaceuticals Retail Ltd", rcNumber: "RC1740678", entityType: "limited_liability", registeredAt: "2022-07-15", status: "active", lga: "Kaduna South", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1745023", jurisdictionId: "jur:ng-kd", name: "Makarfi Shea Cooperative Ltd", rcNumber: "RC1745023", entityType: "cooperative", registeredAt: "2023-08-15", status: "active", lga: "Makarfi", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1755409", jurisdictionId: "jur:ng-kd", name: "Kudan Leather Craft Ltd", rcNumber: "RC1755409", entityType: "limited_liability", registeredAt: "2023-08-15", status: "active", lga: "Kudan", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1766550", jurisdictionId: "jur:ng-kd", name: "Kubau Groundnut Oil Mills", rcNumber: "RC1766550", entityType: "limited_liability", registeredAt: "2023-02-15", status: "active", lga: "Kubau", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1771290", jurisdictionId: "jur:ng-kd", name: "Birnin Gwari Honey Packers", rcNumber: "RC1771290", entityType: "limited_liability", registeredAt: "2023-05-15", status: "active", lga: "Birnin Gwari", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1782301", jurisdictionId: "jur:ng-kd", name: "Zaria Grains & Allied Ltd", rcNumber: "RC1782301", entityType: "limited_liability", registeredAt: "2022-01-15", status: "active", lga: "Zaria", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1790234", jurisdictionId: "jur:ng-kd", name: "Igabi Solar Installers Ltd", rcNumber: "RC1790234", entityType: "limited_liability", registeredAt: "2024-06-15", status: "active", lga: "Igabi", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1798456", jurisdictionId: "jur:ng-kd", name: "Sanga Fisheries Cooperative", rcNumber: "RC1798456", entityType: "limited_liability", registeredAt: "2022-04-15", status: "active", lga: "Sanga", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1809312", jurisdictionId: "jur:ng-kd", name: "Kujama Maize Millers Ltd", rcNumber: "RC1809312", entityType: "limited_liability", registeredAt: "2024-09-15", status: "active", lga: "Kajuru", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1811442", jurisdictionId: "jur:ng-kd", name: "Kafanchan Ginger Processors Coop Ltd", rcNumber: "RC1811442", entityType: "limited_liability", registeredAt: "2023-02-15", status: "active", lga: "Jema'a", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1822067", jurisdictionId: "jur:ng-kd", name: "Chikun Poultry Alliance Ltd", rcNumber: "RC1822067", entityType: "limited_liability", registeredAt: "2023-05-15", status: "active", lga: "Chikun", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1833187", jurisdictionId: "jur:ng-kd", name: "Lere Potato Cold Store Ltd", rcNumber: "RC1833187", entityType: "cooperative", registeredAt: "2024-03-15", status: "active", lga: "Lere", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1847265", jurisdictionId: "jur:ng-kd", name: "Kaura ICT Services Hub", rcNumber: "RC1847265", entityType: "limited_liability", registeredAt: "2022-01-15", status: "active", lga: "Kaura", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
  { registrationId: "biz:seed:rc1855032", jurisdictionId: "jur:ng-kd", name: "Millennium City Logistics Ltd", rcNumber: "RC1855032", entityType: "cooperative", registeredAt: "2024-06-15", status: "active", lga: "Chikun", source: "seed:sample-registry", origin: "seed", sourceUrl: null },
];

const FACILITIES_SEED: (typeof schema.facilities.$inferInsert)[] = [
  { facilityId: "fac:seed:adm:ng-kd-birnin-gwari:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Birnin Gwari", lat: 10.8151, lon: 6.558, source: "seed:lga-centroid:adm:ng-kd-birnin-gwari", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-birnin-gwari:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Birnin Gwari", lat: 10.8241, lon: 6.569, source: "seed:lga-centroid:adm:ng-kd-birnin-gwari", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-birnin-gwari:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Birnin Gwari", lat: 10.8061, lon: 6.547, source: "seed:lga-centroid:adm:ng-kd-birnin-gwari", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-chikun:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Chikun", lat: 10.4488, lon: 7.2592, source: "seed:lga-centroid:adm:ng-kd-chikun", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-chikun:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Chikun", lat: 10.4578, lon: 7.2372, source: "seed:lga-centroid:adm:ng-kd-chikun", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-chikun:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Chikun", lat: 10.4398, lon: 7.2482, source: "seed:lga-centroid:adm:ng-kd-chikun", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-giwa:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Giwa", lat: 11.1314, lon: 7.3324, source: "seed:lga-centroid:adm:ng-kd-giwa", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-giwa:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Giwa", lat: 11.1404, lon: 7.3434, source: "seed:lga-centroid:adm:ng-kd-giwa", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-giwa:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Giwa", lat: 11.1224, lon: 7.3544, source: "seed:lga-centroid:adm:ng-kd-giwa", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-igabi:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Igabi", lat: 10.7051, lon: 7.5894, source: "seed:lga-centroid:adm:ng-kd-igabi", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-igabi:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Igabi", lat: 10.7141, lon: 7.6004, source: "seed:lga-centroid:adm:ng-kd-igabi", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-igabi:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Igabi", lat: 10.6961, lon: 7.5784, source: "seed:lga-centroid:adm:ng-kd-igabi", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-ikara:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Ikara", lat: 11.291, lon: 8.185, source: "seed:lga-centroid:adm:ng-kd-ikara", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-ikara:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Ikara", lat: 11.3, lon: 8.163, source: "seed:lga-centroid:adm:ng-kd-ikara", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-ikara:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Ikara", lat: 11.282, lon: 8.174, source: "seed:lga-centroid:adm:ng-kd-ikara", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-jaba:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Jaba", lat: 9.5004, lon: 8.0246, source: "seed:lga-centroid:adm:ng-kd-jaba", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-jaba:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Jaba", lat: 9.5094, lon: 8.0356, source: "seed:lga-centroid:adm:ng-kd-jaba", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-jaba:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Jaba", lat: 9.4914, lon: 8.0466, source: "seed:lga-centroid:adm:ng-kd-jaba", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-jema-a:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Jema'a", lat: 9.414, lon: 8.2466, source: "seed:lga-centroid:adm:ng-kd-jema-a", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-jema-a:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Jema'a", lat: 9.423, lon: 8.2576, source: "seed:lga-centroid:adm:ng-kd-jema-a", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-jema-a:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Jema'a", lat: 9.405, lon: 8.2356, source: "seed:lga-centroid:adm:ng-kd-jema-a", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kachia:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kachia", lat: 9.8443, lon: 7.7342, source: "seed:lga-centroid:adm:ng-kd-kachia", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kachia:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kachia", lat: 9.8533, lon: 7.7122, source: "seed:lga-centroid:adm:ng-kd-kachia", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kachia:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kachia", lat: 9.8353, lon: 7.7232, source: "seed:lga-centroid:adm:ng-kd-kachia", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaduna-north:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kaduna North", lat: 10.5702, lon: 7.4239, source: "seed:lga-centroid:adm:ng-kd-kaduna-north", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaduna-north:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kaduna North", lat: 10.5792, lon: 7.4349, source: "seed:lga-centroid:adm:ng-kd-kaduna-north", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaduna-north:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kaduna North", lat: 10.5612, lon: 7.4459, source: "seed:lga-centroid:adm:ng-kd-kaduna-north", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaduna-south:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kaduna South", lat: 10.4847, lon: 7.4163, source: "seed:lga-centroid:adm:ng-kd-kaduna-south", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaduna-south:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kaduna South", lat: 10.4937, lon: 7.4273, source: "seed:lga-centroid:adm:ng-kd-kaduna-south", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaduna-south:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kaduna South", lat: 10.4757, lon: 7.4053, source: "seed:lga-centroid:adm:ng-kd-kaduna-south", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kagarko:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kagarko", lat: 9.5099, lon: 7.7101, source: "seed:lga-centroid:adm:ng-kd-kagarko", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kagarko:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kagarko", lat: 9.5189, lon: 7.6881, source: "seed:lga-centroid:adm:ng-kd-kagarko", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kagarko:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kagarko", lat: 9.5009, lon: 7.6991, source: "seed:lga-centroid:adm:ng-kd-kagarko", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kajuru:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kajuru", lat: 10.2818, lon: 7.8321, source: "seed:lga-centroid:adm:ng-kd-kajuru", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kajuru:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kajuru", lat: 10.2908, lon: 7.8431, source: "seed:lga-centroid:adm:ng-kd-kajuru", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kajuru:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kajuru", lat: 10.2728, lon: 7.8541, source: "seed:lga-centroid:adm:ng-kd-kajuru", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaura:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kaura", lat: 9.654, lon: 8.4498, source: "seed:lga-centroid:adm:ng-kd-kaura", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaura:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kaura", lat: 9.663, lon: 8.4608, source: "seed:lga-centroid:adm:ng-kd-kaura", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kaura:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kaura", lat: 9.645, lon: 8.4388, source: "seed:lga-centroid:adm:ng-kd-kaura", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kauru:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kauru", lat: 10.2467, lon: 8.2908, source: "seed:lga-centroid:adm:ng-kd-kauru", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kauru:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kauru", lat: 10.2557, lon: 8.2688, source: "seed:lga-centroid:adm:ng-kd-kauru", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kauru:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kauru", lat: 10.2377, lon: 8.2798, source: "seed:lga-centroid:adm:ng-kd-kauru", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kubau:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kubau", lat: 10.8349, lon: 8.3033, source: "seed:lga-centroid:adm:ng-kd-kubau", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kubau:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kubau", lat: 10.8439, lon: 8.3143, source: "seed:lga-centroid:adm:ng-kd-kubau", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kubau:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kubau", lat: 10.8259, lon: 8.3253, source: "seed:lga-centroid:adm:ng-kd-kubau", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kudan:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Kudan", lat: 11.2415, lon: 7.7625, source: "seed:lga-centroid:adm:ng-kd-kudan", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kudan:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Kudan", lat: 11.2505, lon: 7.7735, source: "seed:lga-centroid:adm:ng-kd-kudan", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-kudan:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Kudan", lat: 11.2325, lon: 7.7515, source: "seed:lga-centroid:adm:ng-kd-kudan", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-lere:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Lere", lat: 10.3845, lon: 8.53, source: "seed:lga-centroid:adm:ng-kd-lere", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-lere:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Lere", lat: 10.3935, lon: 8.508, source: "seed:lga-centroid:adm:ng-kd-lere", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-lere:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Lere", lat: 10.3755, lon: 8.519, source: "seed:lga-centroid:adm:ng-kd-lere", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-makarfi:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Makarfi", lat: 11.339, lon: 7.941, source: "seed:lga-centroid:adm:ng-kd-makarfi", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-makarfi:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Makarfi", lat: 11.348, lon: 7.952, source: "seed:lga-centroid:adm:ng-kd-makarfi", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-makarfi:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Makarfi", lat: 11.33, lon: 7.963, source: "seed:lga-centroid:adm:ng-kd-makarfi", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-sabon-gari:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Sabon Gari", lat: 11.1683, lon: 7.7102, source: "seed:lga-centroid:adm:ng-kd-sabon-gari", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-sabon-gari:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Sabon Gari", lat: 11.1773, lon: 7.7212, source: "seed:lga-centroid:adm:ng-kd-sabon-gari", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-sabon-gari:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Sabon Gari", lat: 11.1593, lon: 7.6992, source: "seed:lga-centroid:adm:ng-kd-sabon-gari", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-sanga:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Sanga", lat: 9.234, lon: 8.3919, source: "seed:lga-centroid:adm:ng-kd-sanga", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-sanga:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Sanga", lat: 9.243, lon: 8.3699, source: "seed:lga-centroid:adm:ng-kd-sanga", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-sanga:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Sanga", lat: 9.225, lon: 8.3809, source: "seed:lga-centroid:adm:ng-kd-sanga", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-soba:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Soba", lat: 10.9203, lon: 7.9781, source: "seed:lga-centroid:adm:ng-kd-soba", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-soba:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Soba", lat: 10.9293, lon: 7.9891, source: "seed:lga-centroid:adm:ng-kd-soba", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-soba:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Soba", lat: 10.9113, lon: 8.0001, source: "seed:lga-centroid:adm:ng-kd-soba", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-zangon-kataf:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Zangon Kataf", lat: 9.9201, lon: 8.187, source: "seed:lga-centroid:adm:ng-kd-zangon-kataf", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-zangon-kataf:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Zangon Kataf", lat: 9.9291, lon: 8.198, source: "seed:lga-centroid:adm:ng-kd-zangon-kataf", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-zangon-kataf:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Zangon Kataf", lat: 9.9111, lon: 8.176, source: "seed:lga-centroid:adm:ng-kd-zangon-kataf", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-zaria:clinic", jurisdictionId: "jur:ng-kd", type: "clinic", name: "Primary Health Centre Zaria", lat: 11.0337, lon: 7.6866, source: "seed:lga-centroid:adm:ng-kd-zaria", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-zaria:market", jurisdictionId: "jur:ng-kd", type: "market", name: "Weekly Market Zaria", lat: 11.0427, lon: 7.6646, source: "seed:lga-centroid:adm:ng-kd-zaria", origin: "seed", sourceUrl: null },
  { facilityId: "fac:seed:adm:ng-kd-zaria:school", jurisdictionId: "jur:ng-kd", type: "school", name: "Government Secondary School Zaria", lat: 11.0247, lon: 7.6756, source: "seed:lga-centroid:adm:ng-kd-zaria", origin: "seed", sourceUrl: null },
];

const GEO_BOUNDARIES_SEED: (typeof schema.geoBoundaries.$inferInsert)[] = [
  { unitId: "adm:ng-kd-birnin-gwari", level: "lga", geojson: {"coordinates": [[[6.0897, 10.4753], [6.093, 10.546], [6.1211, 10.5532], [6.1275, 10.5693], [6.1275, 10.5934], [6.1122, 10.6054], [6.1371, 10.6697], [6.0914, 10.7002], [6.113, 10.7396], [6.0994, 10.7709], [6.1082, 10.8135], [6.1311, 10.824], [6.1227, 10.8448], [6.1815, 10.8722], [6.206, 10.8634], [6.2263, 10.8953], [6.2338, 10.9455], [6.2772, 10.9658], [6.3233, 11.0255], [6.4115, 11.0303], [6.4393, 10.9984], [6.4583, 10.9991], [6.4718, 11.0215], [6.5078, 11.0133], [6.5173, 11.0262], [6.5756, 11.0235], [6.6068, 11.0472], [6.676, 11.0574], [6.6916, 11.073], [6.6889, 11.0947], [6.716, 11.1062], [6.7065, 11.1218], [6.7337, 11.1476], [6.7425, 11.1745], [6.733, 11.2019], [6.7575, 11.2658], [6.8458, 11.3218], [6.8886, 11.3807], [6.9193, 11.3831], [6.9616, 11.358], [7.0062, 11.3618], [7.0184, 11.3174], [7.0087, 11.2938], [6.9888, 11.2753], [6.9575, 11.2761], [6.9096, 11.2418], [6.9634, 11.0748], [6.9527, 10.8943], [6.996, 10.7961], [7.1292, 10.7144], [7.1044, 10.5566], [6.9893, 10.5615], [6.9896, 10.5929], [7.0097, 10.6087], [7.0076, 10.6632], [6.9423, 10.6976], [6.933, 10.7163], [6.9097, 10.7109], [6.8792, 10.7308], [6.8462, 10.8121], [6.8365, 10.7932], [6.8093, 10.7915], [6.7966, 10.7547], [6.7166, 10.6415], [6.7259, 10.5894], [6.6471, 10.5934], [6.5403, 10.5452], [6.5216, 10.5728], [6.5243, 10.595], [6.5066, 10.6095], [6.4391, 10.5926], [6.3966, 10.5725], [6.3701, 10.5324], [6.3066, 10.489], [6.2986, 10.4705], [6.2632, 10.4569], [6.2496, 10.4215], [6.2095, 10.3803], [6.1685, 10.3838], [6.1492, 10.4504], [6.1323, 10.4641], [6.105, 10.4569], [6.0897, 10.4753]]], "type": "Polygon"} as object, centroidLat: 10.8271, centroidLon: 6.558, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709354", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-chikun", level: "lga", geojson: {"coordinates": [[[7.4399, 10.4655], [7.4394, 10.4862], [7.4885, 10.5638], [7.5218, 10.5622], [7.5263, 10.5762], [7.5408, 10.5699], [7.5594, 10.5817], [7.5735, 10.5728], [7.6021, 10.5878], [7.6249, 10.5655], [7.6746, 10.5604], [7.6926, 10.5953], [7.7051, 10.5502], [7.6953, 10.5409], [7.6986, 10.51], [7.7309, 10.469], [7.6913, 10.4318], [7.6955, 10.4119], [7.6328, 10.3896], [7.6092, 10.4028], [7.5965, 10.3947], [7.611, 10.3142], [7.5891, 10.3057], [7.5913, 10.2755], [7.5807, 10.2713], [7.5705, 10.2928], [7.5228, 10.2691], [7.5106, 10.1947], [7.4451, 10.1841], [7.3842, 10.0929], [7.335, 10.0603], [7.3005, 10.0577], [7.2885, 10.0405], [7.2071, 10.0417], [7.1886, 10.0274], [6.9523, 10.0476], [6.9012, 10.0764], [6.8821, 10.1171], [6.8853, 10.1508], [6.915, 10.1886], [6.9423, 10.1806], [6.9545, 10.192], [6.9825, 10.244], [7.0082, 10.2424], [7.0194, 10.2737], [7.0459, 10.2914], [7.0508, 10.3171], [7.0202, 10.3541], [6.9263, 10.3701], [6.9535, 10.4822], [6.9126, 10.538], [6.8691, 10.5554], [6.8395, 10.5316], [6.8419, 10.5725], [6.8166, 10.6384], [6.7198, 10.6435], [6.7966, 10.7547], [6.8093, 10.7915], [6.8365, 10.7932], [6.8541, 10.8117], [6.8792, 10.7308], [6.9097, 10.7109], [6.933, 10.7163], [6.9423, 10.6976], [7.0076, 10.6632], [7.0097, 10.6087], [6.9896, 10.5929], [6.9893, 10.5615], [7.1044, 10.5566], [7.1292, 10.7144], [7.1882, 10.7262], [7.2127, 10.693], [7.2946, 10.6495], [7.3106, 10.6272], [7.3077, 10.5943], [7.2798, 10.5853], [7.2327, 10.5299], [7.2683, 10.5125], [7.2848, 10.5249], [7.295, 10.4962], [7.3986, 10.4832], [7.4062, 10.4357], [7.4323, 10.4442], [7.4399, 10.4655]]], "type": "Polygon"} as object, centroidLat: 10.4488, centroidLon: 7.2482, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709355", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-giwa", level: "lga", geojson: {"coordinates": [[[7.5858, 11.3027], [7.6221, 11.2661], [7.6253, 11.2171], [7.6014, 11.1844], [7.6494, 11.14], [7.6401, 11.077], [7.6006, 11.0844], [7.5983, 11.0731], [7.578, 11.0764], [7.5648, 11.0619], [7.517, 11.0628], [7.4906, 11.0413], [7.5231, 10.9706], [7.492, 10.9629], [7.4517, 10.972], [7.426, 11.0146], [7.4086, 11.0003], [7.3766, 11.0139], [7.3532, 11.011], [7.3324, 10.9882], [7.3245, 10.9987], [7.31, 10.9921], [7.3097, 10.942], [7.258, 10.916], [7.2157, 10.8521], [7.2056, 10.7503], [7.1882, 10.7262], [7.1292, 10.7144], [6.996, 10.7961], [6.9527, 10.8943], [6.9634, 11.0748], [6.9096, 11.2418], [6.9575, 11.2761], [6.9888, 11.2753], [6.9701, 11.2429], [7.0647, 11.1967], [7.1521, 11.1288], [7.2003, 11.1517], [7.2001, 11.1732], [7.2197, 11.1942], [7.1949, 11.2576], [7.2274, 11.2786], [7.2733, 11.2744], [7.2896, 11.2843], [7.3202, 11.2651], [7.3578, 11.2643], [7.3701, 11.3332], [7.3979, 11.378], [7.4677, 11.3777], [7.4895, 11.3522], [7.5203, 11.3616], [7.5217, 11.3404], [7.574, 11.3191], [7.5858, 11.3027]]], "type": "Polygon"} as object, centroidLat: 11.1194, centroidLon: 7.3434, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709356", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-igabi", level: "lga", geojson: {"coordinates": [[[7.4864, 10.5627], [7.4549, 10.6012], [7.4684, 10.6253], [7.4246, 10.6061], [7.4076, 10.5409], [7.3781, 10.4901], [7.295, 10.4962], [7.2848, 10.5249], [7.2683, 10.5125], [7.2327, 10.5299], [7.2798, 10.5853], [7.3077, 10.5943], [7.3106, 10.6272], [7.2946, 10.6495], [7.2127, 10.693], [7.1882, 10.7262], [7.2056, 10.7503], [7.2081, 10.8348], [7.2235, 10.8655], [7.258, 10.916], [7.3097, 10.942], [7.31, 10.9921], [7.3245, 10.9987], [7.3324, 10.9882], [7.3532, 11.011], [7.4086, 11.0003], [7.426, 11.0146], [7.4391, 10.9813], [7.492, 10.9629], [7.5685, 10.9955], [7.5879, 11.0216], [7.6255, 10.9966], [7.6423, 10.9687], [7.6684, 10.9999], [7.7031, 10.9929], [7.7177, 10.9654], [7.7475, 10.9691], [7.7783, 10.9211], [7.7919, 10.9226], [7.8339, 10.8731], [7.8063, 10.8333], [7.828, 10.8259], [7.8289, 10.8127], [7.8436, 10.8118], [7.8358, 10.8001], [7.8564, 10.7883], [7.8665, 10.7996], [7.8825, 10.7945], [7.8862, 10.7644], [7.8506, 10.7478], [7.8894, 10.678], [7.859, 10.6602], [7.8662, 10.6163], [7.8549, 10.5807], [7.8963, 10.5427], [7.8597, 10.5131], [7.8586, 10.5304], [7.8409, 10.5426], [7.8579, 10.512], [7.8435, 10.4992], [7.8169, 10.5076], [7.7989, 10.4899], [7.7782, 10.4998], [7.7297, 10.4775], [7.6986, 10.51], [7.6953, 10.5409], [7.7051, 10.5502], [7.6926, 10.5953], [7.6746, 10.5604], [7.6249, 10.5655], [7.6021, 10.5878], [7.5735, 10.5728], [7.5594, 10.5817], [7.5408, 10.5699], [7.5263, 10.5762], [7.5218, 10.5622], [7.4864, 10.5627]]], "type": "Polygon"} as object, centroidLat: 10.7171, centroidLon: 7.5894, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709357", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-ikara", level: "lga", geojson: {"coordinates": [[[7.9449, 11.4643], [7.9957, 11.4916], [8.0515, 11.489], [8.102, 11.5238], [8.1501, 11.5192], [8.1617, 11.4972], [8.1404, 11.4568], [8.1433, 11.4203], [8.1137, 11.4085], [8.1229, 11.3867], [8.1499, 11.3754], [8.2068, 11.3187], [8.2374, 11.3271], [8.2644, 11.3132], [8.2573, 11.2797], [8.2861, 11.2682], [8.2979, 11.2342], [8.4338, 11.2266], [8.4647, 11.1696], [8.5187, 11.1623], [8.506, 11.1322], [8.4789, 11.1134], [8.4116, 11.1085], [8.4017, 11.1539], [8.3357, 11.1698], [8.3195, 11.1847], [8.3022, 11.1617], [8.3107, 11.1274], [8.2888, 11.1054], [8.2225, 11.1042], [8.2275, 11.1328], [8.2132, 11.1403], [8.1579, 11.1155], [8.1142, 11.1629], [8.0706, 11.1709], [8.0451, 11.1955], [8.0799, 11.2588], [8.1061, 11.2665], [8.1055, 11.2824], [8.0732, 11.2902], [8.0576, 11.3225], [8.0635, 11.3751], [7.999, 11.3394], [7.9732, 11.3499], [7.9721, 11.3723], [7.9618, 11.3743], [7.9662, 11.4015], [7.9756, 11.4018], [7.973, 11.4377], [7.9449, 11.4643]]], "type": "Polygon"} as object, centroidLat: 11.291, centroidLon: 8.174, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709358", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-jaba", level: "lga", geojson: {"coordinates": [[[8.0175, 9.5718], [7.9579, 9.6335], [7.9275, 9.6147], [7.9257, 9.5745], [7.9443, 9.5599], [7.9327, 9.5382], [7.953, 9.5023], [7.9556, 9.4608], [7.9391, 9.4432], [7.9576, 9.4221], [7.9593, 9.3976], [7.9065, 9.3297], [7.9191, 9.3174], [8.0083, 9.3231], [8.021, 9.3429], [8.0358, 9.3407], [8.0302, 9.3618], [8.0591, 9.3583], [8.045, 9.3935], [8.1047, 9.4477], [8.0749, 9.4597], [8.0698, 9.4954], [8.1518, 9.5068], [8.1593, 9.5246], [8.1458, 9.5345], [8.1648, 9.5511], [8.1574, 9.5676], [8.1718, 9.5658], [8.1725, 9.582], [8.1167, 9.625], [8.0944, 9.6186], [8.0791, 9.5819], [8.0175, 9.5718]]], "type": "Polygon"} as object, centroidLat: 9.4884, centroidLon: 8.0356, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709359", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-jema-a", level: "lga", geojson: {"coordinates": [[[8.4987, 9.5756], [8.4541, 9.5326], [8.4123, 9.5502], [8.3513, 9.5427], [8.3354, 9.59], [8.3199, 9.6094], [8.2989, 9.6097], [8.2795, 9.5784], [8.286, 9.5716], [8.2409, 9.5754], [8.2448, 9.5316], [8.2265, 9.5049], [8.1521, 9.5503], [8.1518, 9.5068], [8.0698, 9.4954], [8.0749, 9.4597], [8.1047, 9.4477], [8.045, 9.3935], [8.0591, 9.3583], [8.0302, 9.3618], [8.0358, 9.3407], [8.021, 9.3429], [8.0083, 9.3231], [7.9406, 9.3142], [8.0609, 9.2658], [8.0872, 9.2307], [8.1304, 9.2154], [8.1498, 9.2287], [8.1726, 9.2226], [8.1865, 9.2386], [8.247, 9.2394], [8.2705, 9.2673], [8.2669, 9.2803], [8.2966, 9.2857], [8.3673, 9.3522], [8.4128, 9.3694], [8.4477, 9.4342], [8.473, 9.4446], [8.5159, 9.4934], [8.5778, 9.4992], [8.5557, 9.5816], [8.4987, 9.5756]]], "type": "Polygon"} as object, centroidLat: 9.426, centroidLon: 8.2466, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709360", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kachia", level: "lga", geojson: {"coordinates": [[[7.2227, 9.7409], [7.2047, 9.7583], [7.2105, 9.7801], [7.2517, 9.7944], [7.2736, 9.7834], [7.2929, 9.8112], [7.2955, 9.8877], [7.2778, 10.0164], [7.2541, 10.0392], [7.2885, 10.0405], [7.3005, 10.0577], [7.335, 10.0603], [7.3719, 10.0823], [7.4451, 10.1841], [7.5106, 10.1947], [7.556, 10.1724], [7.5983, 10.1002], [7.6187, 10.095], [7.6373, 10.0385], [7.6199, 10.0447], [7.6273, 10.0167], [7.6906, 10.0048], [7.7205, 10.0202], [7.7361, 10.0124], [7.7481, 9.978], [7.7664, 9.9957], [7.802, 9.9999], [7.7955, 10.0476], [7.8203, 10.0688], [7.8576, 10.0748], [7.8963, 10.0587], [7.8971, 10.0874], [7.9395, 10.1061], [7.949, 10.1306], [7.9985, 10.1181], [7.9971, 10.0935], [7.9807, 10.1033], [7.9797, 10.089], [8.027, 10.0432], [8.0365, 9.9895], [8.0108, 9.9494], [8.0423, 9.9492], [8.0603, 9.9336], [8.0598, 9.9158], [8.0777, 9.9203], [8.0899, 9.8864], [8.087, 9.8611], [8.0228, 9.8016], [8.0234, 9.7836], [8.0677, 9.7716], [8.0786, 9.7575], [8.0708, 9.7327], [8.1101, 9.7067], [8.1156, 9.6804], [8.1334, 9.6689], [8.1167, 9.625], [8.0944, 9.6186], [8.0873, 9.5889], [8.0378, 9.5678], [8.0066, 9.5756], [7.9579, 9.6335], [7.9206, 9.6372], [7.9004, 9.6743], [7.8656, 9.6777], [7.8673, 9.6934], [7.8469, 9.6954], [7.8158, 9.6479], [7.7695, 9.6795], [7.7486, 9.6765], [7.7478, 9.6356], [7.7343, 9.6092], [7.716, 9.604], [7.648, 9.6271], [7.6121, 9.5953], [7.5671, 9.5772], [7.5297, 9.6023], [7.5122, 9.5871], [7.448, 9.6162], [7.4315, 9.5912], [7.3087, 9.5729], [7.29, 9.5141], [7.2087, 9.5402], [7.3056, 9.6277], [7.2764, 9.6899], [7.2227, 9.7409]]], "type": "Polygon"} as object, centroidLat: 9.8443, centroidLon: 7.7232, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709361", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kaduna-north", level: "lga", geojson: {"coordinates": [[[7.419, 10.5093], [7.4397, 10.4867], [7.4854, 10.5548], [7.4549, 10.6012], [7.4684, 10.6253], [7.4246, 10.6061], [7.4152, 10.5883], [7.4127, 10.5614], [7.4272, 10.5504], [7.4182, 10.5473], [7.419, 10.5093]]], "type": "Polygon"} as object, centroidLat: 10.5582, centroidLon: 7.4349, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709362", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kaduna-south", level: "lga", geojson: {"coordinates": [[[7.4269, 10.5494], [7.4182, 10.5473], [7.4185, 10.5022], [7.4383, 10.4914], [7.4405, 10.4671], [7.4323, 10.4442], [7.4089, 10.4351], [7.3983, 10.4456], [7.4006, 10.4811], [7.3781, 10.4901], [7.4076, 10.5574], [7.4269, 10.5494]]], "type": "Polygon"} as object, centroidLat: 10.4967, centroidLon: 7.4163, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709363", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kagarko", level: "lga", geojson: {"coordinates": [[[7.7312, 9.3261], [7.693, 9.3494], [7.6675, 9.4014], [7.647, 9.4087], [7.6141, 9.4061], [7.5091, 9.355], [7.3897, 9.3359], [7.334, 9.3408], [7.2328, 9.3184], [7.1967, 9.4756], [7.2087, 9.5402], [7.29, 9.5141], [7.3087, 9.5729], [7.4315, 9.5912], [7.448, 9.6162], [7.5122, 9.5871], [7.5297, 9.6023], [7.5671, 9.5772], [7.6121, 9.5953], [7.648, 9.6271], [7.716, 9.604], [7.7343, 9.6092], [7.7478, 9.6356], [7.7486, 9.6765], [7.7695, 9.6795], [7.8158, 9.6479], [7.8365, 9.6916], [7.8673, 9.6934], [7.8656, 9.6777], [7.9004, 9.6743], [7.9206, 9.6372], [7.9479, 9.6349], [7.9275, 9.6147], [7.9257, 9.5745], [7.9443, 9.5599], [7.9327, 9.5382], [7.953, 9.5023], [7.9556, 9.4608], [7.9391, 9.4432], [7.9576, 9.4221], [7.9593, 9.3976], [7.9065, 9.3297], [7.9191, 9.3174], [7.8725, 9.29], [7.7929, 9.2756], [7.7312, 9.3261]]], "type": "Polygon"} as object, centroidLat: 9.5099, centroidLon: 7.6991, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709364", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kajuru", level: "lga", geojson: {"coordinates": [[[7.7989, 10.4899], [7.8169, 10.5076], [7.833, 10.4987], [7.857, 10.5059], [7.8409, 10.5426], [7.8586, 10.5304], [7.8597, 10.5131], [7.8856, 10.5169], [7.898, 10.4887], [7.9317, 10.4662], [7.9489, 10.477], [8.0114, 10.4751], [8.0002, 10.4497], [8.0394, 10.3432], [8.0327, 10.302], [8.0594, 10.3178], [8.0772, 10.3055], [8.0977, 10.3123], [8.1166, 10.2928], [8.1141, 10.2671], [8.1276, 10.249], [8.0925, 10.2224], [8.0648, 10.2389], [8.0829, 10.2611], [8.071, 10.2861], [8.039, 10.2829], [8.0173, 10.244], [8.0231, 10.2319], [7.9923, 10.195], [7.9903, 10.1785], [8.004, 10.1712], [7.9956, 10.1497], [7.9704, 10.1497], [7.9395, 10.1061], [7.8971, 10.0874], [7.8963, 10.0587], [7.8576, 10.0748], [7.8203, 10.0688], [7.7955, 10.0476], [7.802, 9.9999], [7.7664, 9.9957], [7.7481, 9.978], [7.7361, 10.0124], [7.7205, 10.0202], [7.6906, 10.0048], [7.6273, 10.0167], [7.6199, 10.0447], [7.6373, 10.0385], [7.6187, 10.095], [7.5983, 10.1002], [7.556, 10.1724], [7.5106, 10.1947], [7.5228, 10.2691], [7.5705, 10.2928], [7.5861, 10.2719], [7.5891, 10.3057], [7.611, 10.3142], [7.5965, 10.3947], [7.6092, 10.4028], [7.6328, 10.3896], [7.6955, 10.4119], [7.6913, 10.4318], [7.732, 10.4827], [7.7782, 10.4998], [7.7989, 10.4899]]], "type": "Polygon"} as object, centroidLat: 10.2698, centroidLon: 7.8431, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709365", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kaura", level: "lga", geojson: {"coordinates": [[[8.5007, 9.7303], [8.4779, 9.6889], [8.4012, 9.7041], [8.3787, 9.7265], [8.352, 9.707], [8.368, 9.6792], [8.3426, 9.6609], [8.348, 9.6486], [8.3299, 9.649], [8.3385, 9.6252], [8.3175, 9.6284], [8.3118, 9.6124], [8.3354, 9.59], [8.3513, 9.5427], [8.4123, 9.5502], [8.4541, 9.5326], [8.4987, 9.5756], [8.5557, 9.5816], [8.5704, 9.64], [8.599, 9.6787], [8.5989, 9.7279], [8.576, 9.726], [8.5708, 9.7409], [8.5452, 9.7385], [8.5283, 9.7551], [8.5285, 9.7369], [8.5011, 9.7409], [8.5007, 9.7303]]], "type": "Polygon"} as object, centroidLat: 9.666, centroidLon: 8.4498, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709366", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kauru", level: "lga", geojson: {"coordinates": [[[[7.8894, 10.678], [7.859, 10.6602], [7.8662, 10.6163], [7.8549, 10.5807], [7.8963, 10.5427], [7.8716, 10.5208], [7.9317, 10.4662], [7.9489, 10.477], [8.0114, 10.4751], [8.0002, 10.4497], [8.0394, 10.3432], [8.0353, 10.2987], [8.0594, 10.3178], [8.0772, 10.3055], [8.0977, 10.3123], [8.1171, 10.2885], [8.1445, 10.282], [8.1446, 10.2503], [8.1939, 10.2185], [8.1694, 10.19], [8.2062, 10.1678], [8.203, 10.147], [8.2401, 10.1195], [8.2211, 10.104], [8.2463, 10.063], [8.2716, 10.0548], [8.2721, 10.0223], [8.3199, 10.0288], [8.3349, 10.0167], [8.3698, 10.043], [8.3825, 10.0135], [8.4343, 9.998], [8.4553, 10.0178], [8.4513, 10.0449], [8.5009, 10.0922], [8.4862, 10.1308], [8.45, 10.1415], [8.4395, 10.1761], [8.4153, 10.1886], [8.4243, 10.2092], [8.3959, 10.2944], [8.3794, 10.2957], [8.328, 10.246], [8.3199, 10.2969], [8.3305, 10.3539], [8.363, 10.3939], [8.4071, 10.4031], [8.4162, 10.4442], [8.3493, 10.4928], [8.3203, 10.4938], [8.3137, 10.5648], [8.2504, 10.5966], [8.2544, 10.6302], [8.235, 10.6662], [8.2124, 10.6511], [8.2059, 10.669], [8.1822, 10.6797], [8.1662, 10.6704], [8.1299, 10.6849], [8.1143, 10.6715], [8.0913, 10.6744], [8.0753, 10.6908], [7.9769, 10.7127], [7.9541, 10.6922], [7.9477, 10.7146], [7.9178, 10.7018], [7.9152, 10.6871], [7.8988, 10.6957], [7.8894, 10.678]]], [[[8.6347, 9.8668], [8.6439, 9.7754], [8.6336, 9.7546], [8.5822, 9.7239], [8.5708, 9.7409], [8.5452, 9.7385], [8.5283, 9.7551], [8.5285, 9.7369], [8.5011, 9.7409], [8.4847, 9.7641], [8.512, 9.8119], [8.5096, 9.8651], [8.4332, 9.8869], [8.4202, 9.918], [8.4357, 9.9654], [8.4238, 9.9701], [8.4348, 9.9771], [8.429, 9.9881], [8.4769, 9.9851], [8.4878, 10.0185], [8.5385, 10.0323], [8.589, 10.0229], [8.6107, 10.0012], [8.6401, 10.015], [8.6796, 10.0111], [8.6347, 9.8668]]]], "type": "MultiPolygon"} as object, centroidLat: 10.2467, centroidLon: 8.2798, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709367", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kubau", level: "lga", geojson: {"coordinates": [[[8.5133, 11.1222], [8.6073, 11.0712], [8.6148, 11.0177], [8.599, 11.0021], [8.5685, 10.9075], [8.5808, 10.9017], [8.585, 10.8615], [8.5587, 10.7892], [8.5729, 10.7737], [8.5716, 10.7483], [8.4812, 10.7159], [8.4469, 10.7321], [8.3835, 10.7331], [8.3724, 10.7265], [8.3847, 10.7099], [8.3695, 10.7069], [8.3776, 10.6733], [8.3345, 10.6512], [8.3344, 10.6264], [8.3566, 10.613], [8.346, 10.5997], [8.3638, 10.588], [8.3451, 10.5771], [8.3666, 10.5734], [8.3476, 10.5488], [8.3835, 10.5362], [8.3921, 10.4941], [8.4218, 10.4682], [8.4162, 10.4442], [8.3493, 10.4928], [8.3203, 10.4938], [8.3137, 10.5648], [8.2504, 10.5966], [8.2544, 10.6302], [8.2405, 10.6629], [8.2124, 10.6511], [8.2059, 10.669], [8.1822, 10.6797], [8.1662, 10.6704], [8.1299, 10.6849], [8.1143, 10.6715], [8.0913, 10.6744], [8.0752, 10.7064], [8.0869, 10.7403], [8.0607, 10.7672], [8.0872, 10.7998], [8.1266, 10.809], [8.1449, 10.7966], [8.1633, 10.8215], [8.1596, 10.849], [8.174, 10.8759], [8.1805, 10.8848], [8.1841, 10.8676], [8.1991, 10.8738], [8.1832, 10.896], [8.2298, 10.9064], [8.2503, 10.9366], [8.2174, 11.0227], [8.1974, 11.0323], [8.1661, 11.0802], [8.1571, 11.1121], [8.1671, 11.1247], [8.2132, 11.1403], [8.2275, 11.1328], [8.2225, 11.1042], [8.2888, 11.1054], [8.3107, 11.1274], [8.3022, 11.1617], [8.3195, 11.1847], [8.3357, 11.1698], [8.4017, 11.1539], [8.4116, 11.1085], [8.4789, 11.1134], [8.506, 11.1322], [8.5133, 11.1222]]], "type": "Polygon"} as object, centroidLat: 10.8229, centroidLon: 8.3143, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709368", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-kudan", level: "lga", geojson: {"coordinates": [[[7.7927, 11.3761], [7.8775, 11.287], [7.8539, 11.2739], [7.8486, 11.2882], [7.8126, 11.29], [7.8098, 11.2132], [7.8157, 11.2019], [7.8407, 11.2004], [7.8492, 11.1706], [7.8125, 11.1495], [7.7909, 11.1604], [7.7874, 11.1767], [7.753, 11.1969], [7.7521, 11.2401], [7.7363, 11.2368], [7.7339, 11.2467], [7.715, 11.2322], [7.7205, 11.2049], [7.6998, 11.1924], [7.6857, 11.1961], [7.6904, 11.2078], [7.6253, 11.2171], [7.6187, 11.2777], [7.7062, 11.31], [7.7197, 11.3244], [7.7209, 11.3659], [7.7659, 11.3777], [7.7859, 11.3614], [7.7927, 11.3761]]], "type": "Polygon"} as object, centroidLat: 11.2535, centroidLon: 7.7625, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709369", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-lere", level: "lga", geojson: {"coordinates": [[[8.7792, 10.5981], [8.8069, 10.5904], [8.7843, 10.5433], [8.7855, 10.4965], [8.7492, 10.4407], [8.7968, 10.4168], [8.8235, 10.3833], [8.8051, 10.3556], [8.7993, 10.3029], [8.7343, 10.2751], [8.7287, 10.2483], [8.6861, 10.2112], [8.672, 10.1462], [8.6796, 10.011], [8.6401, 10.015], [8.6107, 10.0012], [8.589, 10.0229], [8.5385, 10.0323], [8.4878, 10.0185], [8.4769, 9.9851], [8.4342, 9.994], [8.4553, 10.0178], [8.4513, 10.0449], [8.5009, 10.0922], [8.4862, 10.1308], [8.45, 10.1415], [8.4395, 10.1761], [8.4153, 10.1886], [8.4243, 10.2092], [8.3959, 10.2944], [8.3794, 10.2957], [8.328, 10.246], [8.3199, 10.2969], [8.3305, 10.3539], [8.363, 10.3939], [8.4071, 10.4031], [8.4217, 10.4354], [8.4218, 10.4682], [8.3921, 10.4941], [8.3835, 10.5362], [8.3476, 10.5488], [8.3666, 10.5734], [8.3451, 10.5771], [8.3638, 10.588], [8.346, 10.5997], [8.3566, 10.613], [8.3344, 10.6264], [8.3369, 10.6574], [8.3776, 10.6733], [8.3695, 10.7069], [8.3862, 10.7172], [8.3724, 10.7265], [8.4141, 10.7366], [8.4812, 10.7159], [8.5063, 10.6505], [8.5345, 10.6327], [8.5936, 10.6451], [8.6439, 10.6305], [8.7111, 10.5434], [8.7792, 10.5981]]], "type": "Polygon"} as object, centroidLat: 10.3845, centroidLon: 8.519, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709370", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-makarfi", level: "lga", geojson: {"coordinates": [[[7.9449, 11.4643], [7.973, 11.4377], [7.9756, 11.4018], [7.9662, 11.4015], [7.9618, 11.3743], [7.9721, 11.3723], [7.9732, 11.3499], [7.999, 11.3394], [8.0635, 11.3751], [8.0576, 11.3225], [8.0732, 11.2902], [8.1055, 11.2824], [8.1061, 11.2665], [8.0799, 11.2588], [8.0451, 11.1955], [7.9823, 11.2354], [7.9475, 11.2346], [7.8822, 11.1926], [7.8157, 11.2019], [7.8126, 11.29], [7.8486, 11.2882], [7.8539, 11.2739], [7.8775, 11.287], [7.8005, 11.3767], [7.8221, 11.3689], [7.8738, 11.3821], [7.8975, 11.4286], [7.9449, 11.4643]]], "type": "Polygon"} as object, centroidLat: 11.327, centroidLon: 7.952, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709371", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-sabon-gari", level: "lga", geojson: {"coordinates": [[[7.7704, 11.18], [7.753, 11.1969], [7.7521, 11.2401], [7.7257, 11.2474], [7.715, 11.2322], [7.7205, 11.2049], [7.6998, 11.1924], [7.6857, 11.1961], [7.6904, 11.2078], [7.6253, 11.2171], [7.6014, 11.1844], [7.6494, 11.14], [7.6457, 11.1308], [7.6688, 11.1312], [7.7443, 11.0864], [7.7533, 11.1276], [7.8125, 11.1495], [7.7704, 11.18]]], "type": "Polygon"} as object, centroidLat: 11.1803, centroidLon: 7.7102, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709372", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-sanga", level: "lga", geojson: {"coordinates": [[[8.1865, 9.2386], [8.247, 9.2394], [8.2705, 9.2673], [8.2669, 9.2803], [8.2966, 9.2857], [8.3673, 9.3522], [8.4128, 9.3694], [8.4477, 9.4342], [8.473, 9.4446], [8.5159, 9.4934], [8.5778, 9.4992], [8.6027, 9.4825], [8.6423, 9.4011], [8.6954, 9.3784], [8.6981, 9.3206], [8.6492, 9.1713], [8.6207, 9.1149], [8.5668, 9.0608], [8.5595, 9.029], [8.5333, 9.0044], [8.5043, 9.0014], [8.4466, 9.1126], [8.3815, 9.1774], [8.2584, 9.1829], [8.2328, 9.1048], [8.1919, 9.0524], [8.1376, 9.0362], [8.0616, 9.0521], [8.0872, 9.2307], [8.1304, 9.2154], [8.1498, 9.2287], [8.1726, 9.2226], [8.1865, 9.2386]]], "type": "Polygon"} as object, centroidLat: 9.234, centroidLon: 8.3809, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709373", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-soba", level: "lga", geojson: {"coordinates": [[[7.9823, 11.2354], [8.0706, 11.1709], [8.0917, 11.1738], [8.1334, 11.1482], [8.1974, 11.0323], [8.2174, 11.0227], [8.2493, 10.952], [8.2298, 10.9064], [8.1832, 10.896], [8.1991, 10.8738], [8.1841, 10.8676], [8.1805, 10.8848], [8.174, 10.8759], [8.1596, 10.849], [8.1633, 10.8215], [8.1449, 10.7966], [8.1266, 10.809], [8.0633, 10.781], [8.0607, 10.7672], [8.0869, 10.7403], [8.0744, 10.7189], [8.0889, 10.6801], [7.9769, 10.7127], [7.9541, 10.6922], [7.9451, 10.7147], [7.9178, 10.7018], [7.9152, 10.6871], [7.8988, 10.6957], [7.8894, 10.678], [7.8506, 10.7478], [7.8862, 10.7644], [7.8825, 10.7945], [7.8485, 10.7926], [7.8358, 10.8001], [7.8436, 10.8118], [7.8051, 10.8389], [7.8339, 10.8731], [7.7919, 10.9226], [7.8175, 10.9607], [7.8145, 10.9991], [7.7995, 11.0107], [7.8202, 11.0353], [7.7999, 11.1038], [7.7746, 11.133], [7.8492, 11.1706], [7.8413, 11.1992], [7.8822, 11.1926], [7.9475, 11.2346], [7.9823, 11.2354]]], "type": "Polygon"} as object, centroidLat: 10.9083, centroidLon: 7.9891, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709374", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-zangon-kataf", level: "lga", geojson: {"coordinates": [[[8.3698, 10.043], [8.3825, 10.0135], [8.4343, 9.998], [8.4202, 9.918], [8.4332, 9.8869], [8.5096, 9.8651], [8.512, 9.8119], [8.4847, 9.7641], [8.5007, 9.7303], [8.4779, 9.6889], [8.4012, 9.7041], [8.3787, 9.7265], [8.352, 9.707], [8.368, 9.6792], [8.3426, 9.6609], [8.348, 9.6486], [8.3299, 9.649], [8.3385, 9.6252], [8.3175, 9.6284], [8.2869, 9.5999], [8.2803, 9.5684], [8.2409, 9.5754], [8.2448, 9.5316], [8.2265, 9.5049], [8.1748, 9.5332], [8.1574, 9.5676], [8.1718, 9.5658], [8.1725, 9.582], [8.1167, 9.625], [8.1334, 9.6689], [8.1156, 9.6804], [8.1101, 9.7067], [8.0708, 9.7327], [8.0771, 9.7609], [8.0234, 9.7836], [8.0228, 9.8016], [8.087, 9.8611], [8.0899, 9.8864], [8.0777, 9.9203], [8.0598, 9.9158], [8.0603, 9.9336], [8.0423, 9.9492], [8.0108, 9.9494], [8.0365, 9.9895], [8.027, 10.0432], [7.9826, 10.0796], [7.9807, 10.1033], [7.9971, 10.0935], [7.9985, 10.1181], [7.9519, 10.1312], [7.976, 10.1525], [7.9956, 10.1497], [8.004, 10.1712], [7.9903, 10.1785], [7.9923, 10.195], [8.0231, 10.2319], [8.0173, 10.244], [8.039, 10.2829], [8.071, 10.2861], [8.0829, 10.2611], [8.0648, 10.2389], [8.0925, 10.2224], [8.1276, 10.249], [8.1141, 10.2671], [8.1171, 10.2885], [8.1445, 10.282], [8.1446, 10.2503], [8.1939, 10.2185], [8.1694, 10.19], [8.2062, 10.1678], [8.203, 10.147], [8.2401, 10.1195], [8.2211, 10.104], [8.2463, 10.063], [8.2716, 10.0548], [8.2721, 10.0223], [8.3199, 10.0288], [8.3349, 10.0167], [8.3698, 10.043]]], "type": "Polygon"} as object, centroidLat: 9.9321, centroidLon: 8.187, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709375", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
  { unitId: "adm:ng-kd-zaria", level: "lga", geojson: {"coordinates": [[[7.7496, 11.1211], [7.7443, 11.0864], [7.6688, 11.1312], [7.6457, 11.1308], [7.6401, 11.077], [7.6006, 11.0844], [7.5983, 11.0731], [7.578, 11.0764], [7.5648, 11.0619], [7.517, 11.0628], [7.4878, 11.0341], [7.5056, 11.0196], [7.5231, 10.9706], [7.5685, 10.9955], [7.5879, 11.0216], [7.6255, 10.9966], [7.6423, 10.9687], [7.6684, 10.9999], [7.7031, 10.9929], [7.7177, 10.9654], [7.7475, 10.9691], [7.7863, 10.9201], [7.8039, 10.9273], [7.8175, 10.9607], [7.8145, 10.9991], [7.7995, 11.0107], [7.8202, 11.0353], [7.8162, 11.0659], [7.7746, 11.133], [7.7496, 11.1211]]], "type": "Polygon"} as object, centroidLat: 11.0337, centroidLon: 7.6756, origin: "derived", sourceUrl: "https://www.openstreetmap.org/relation/3709376", fetchedAt: new Date("2024-12-31T16:00:00.000Z") },
];

async function seed() {
  console.log("Seeding Nigeria pilot data (idempotent)...");

  await ensureStringPk("jurisdictions", schema.jurisdictions as never, schema.jurisdictions.jurisdictionId as never, JURISDICTIONS as never, "jurisdictionId");
  await ensureStringPk("admin_units", schema.adminUnits as never, schema.adminUnits.adminUnitId as never, ADMIN_UNITS as never, "adminUnitId");
  await ensureStringPk("sectors", schema.sectors as never, schema.sectors.sectorCode as never, SECTORS as never, "sectorCode");

  if ((await tableCount(schema.sectorMetrics as never)) === 0) {
    await db.insert(schema.sectorMetrics).values(SECTOR_METRICS);
    console.log(`  sector_metrics: ${SECTOR_METRICS.length} inserted`);
  } else {
    console.log("  sector_metrics: already seeded, skipped");
  }

  await ensureStringPk("opportunities", schema.opportunities as never, schema.opportunities.opportunityId as never, OPPORTUNITIES as never, "opportunityId");
  await ensureStringPk("interventions", schema.interventions as never, schema.interventions.interventionId as never, INTERVENTIONS as never, "interventionId");
  await ensureStringPk("evidence_sources", schema.evidenceSources as never, schema.evidenceSources.evidenceSourceId as never, EVIDENCE as never, "evidenceSourceId");
  await ensureStringPk("laws", schema.laws as never, schema.laws.lawId as never, LAWS as never, "lawId");
  await ensureStringPk("clauses", schema.clauses as never, schema.clauses.clauseId as never, CLAUSES as never, "clauseId");

  if ((await tableCount(schema.citations as never)) === 0) {
    await db.insert(schema.citations).values(CITATIONS);
    console.log(`  citations: ${CITATIONS.length} inserted`);
  } else {
    console.log("  citations: already seeded, skipped");
  }

  await ensureStringPk("policy_documents", schema.policyDocuments as never, schema.policyDocuments.documentId as never, DOCUMENTS as never, "documentId");
  await ensureStringPk("assumption_sets", schema.assumptionSets as never, schema.assumptionSets.assumptionsSetId as never, ASSUMPTION_SETS as never, "assumptionsSetId");
  await ensureStringPk("scenarios", schema.scenarios as never, schema.scenarios.scenarioId as never, SCENARIOS as never, "scenarioId");
  await ensureStringPk("simulation_runs", schema.simulationRuns as never, schema.simulationRuns.simulationRunId as never, buildRuns() as never, "simulationRunId");
  await ensureStringPk("briefs", schema.briefs as never, schema.briefs.briefId as never, BRIEFS as never, "briefId");
  await ensureStringPk("data_sources", schema.dataSources as never, schema.dataSources.sourceId as never, DATA_SOURCES as never, "sourceId");
  await ensureStringPk("pipeline_runs", schema.pipelineRuns as never, schema.pipelineRuns.pipelineId as never, PIPELINE_RUNS as never, "pipelineId");
  await ensureStringPk("review_tasks", schema.reviewTasks as never, schema.reviewTasks.taskId as never, REVIEW_TASKS as never, "taskId");

  if ((await tableCount(schema.auditEvents as never)) === 0) {
    await db.insert(schema.auditEvents).values(AUDIT_EVENTS);
    console.log(`  audit_events: ${AUDIT_EVENTS.length} inserted`);
  } else {
    console.log("  audit_events: already seeded, skipped");
  }

  if ((await tableCount(schema.approvalEvents as never)) === 0) {
    await db.insert(schema.approvalEvents).values(APPROVAL_EVENTS);
    console.log(`  approval_events: ${APPROVAL_EVENTS.length} inserted`);
  } else {
    console.log("  approval_events: already seeded, skipped");
  }

  // Demo users + jurisdiction grants (ABAC demo mapping).
  const existingUsers = await db.select({ unionId: schema.users.unionId }).from(schema.users);
  const haveUsers = new Set(existingUsers.map((u) => u.unionId));
  const missingUsers = DEMO_USERS.filter((u) => !haveUsers.has(u.unionId));
  if (missingUsers.length > 0) {
    await db.insert(schema.users).values(missingUsers);
  }
  console.log(`  users: ${missingUsers.length} inserted, ${haveUsers.size} existing`);

  const demoAnalyst = await db.query.users.findFirst({
    where: (t, { eq }) => eq(t.unionId, "demo-policy-analyst"),
  });
  const demoLegal = await db.query.users.findFirst({
    where: (t, { eq }) => eq(t.unionId, "demo-legal-analyst"),
  });
  const demoSim = await db.query.users.findFirst({
    where: (t, { eq }) => eq(t.unionId, "demo-sim-specialist"),
  });
  const grants = [
    ...(demoAnalyst ? [{ userId: Number(demoAnalyst.id), jurisdictionId: "jur:ng-kd", accessLevel: "write" as const }] : []),
    ...(demoLegal ? [{ userId: Number(demoLegal.id), jurisdictionId: "jur:ng-kd", accessLevel: "write" as const }] : []),
    ...(demoSim ? [{ userId: Number(demoSim.id), jurisdictionId: "jur:ng-kd", accessLevel: "write" as const }] : []),
  ];
  for (const g of grants) {
    await db
      .insert(schema.userJurisdictions)
      .values(g)
      .onDuplicateKeyUpdate({ set: { accessLevel: g.accessLevel } });
  }
  console.log(`  user_jurisdictions: ${grants.length} upserted (jur:ng-kd)`);

  await ensureStringPk("sector_multipliers", schema.sectorMultipliers as never, schema.sectorMultipliers.sectorCode as never, SECTOR_MULTIPLIERS as never, "sectorCode");
  await ensureStringPk("scenario_templates", schema.scenarioTemplates as never, schema.scenarioTemplates.templateId as never, SCENARIO_TEMPLATES as never, "templateId");
  await ensureStringPk("webhook_subscriptions", schema.webhookSubscriptions as never, schema.webhookSubscriptions.subId as never, WEBHOOKS as never, "subId");

  // feat-data-loader: canonical model + geo boundaries (idempotent).
  await ensureStringPk("budgets", schema.budgets as never, schema.budgets.budgetId as never, BUDGETS as never, "budgetId");
  await ensureStringPk("officials", schema.officials as never, schema.officials.officialId as never, OFFICIALS as never, "officialId");
  await ensureStringPk("programs", schema.programs as never, schema.programs.programId as never, PROGRAMS as never, "programId");
  await ensureStringPk("business_registrations", schema.businessRegistrations as never, schema.businessRegistrations.registrationId as never, BUSINESS_REGISTRATIONS as never, "registrationId");
  await ensureStringPk("facilities", schema.facilities as never, schema.facilities.facilityId as never, FACILITIES_SEED as never, "facilityId");
  await ensureStringPk("geo_boundaries", schema.geoBoundaries as never, schema.geoBoundaries.unitId as never, GEO_BOUNDARIES_SEED as never, "unitId");

  // === feat-llm-events seed ===
  // Demo job heartbeat (stuck-job sweeper demo target) — additive.
  await db
    .insert(schema.jobHeartbeats)
    .values({ jobId: "job:seed-demo", status: "succeeded", ts: new Date() })
    .onDuplicateKeyUpdate({ set: { status: "succeeded" } });
  console.log("  job_heartbeats: 1 upserted (demo)");
  // === end feat-llm-events seed ===

  // === feat-dataset-abac seed (SEC-3, additive) ===
  // One dataset policy per classification class. Exact-dataset policies for
  // tests live in api/tests/dataset-abac.test.ts; these are the platform
  // defaults (entity-type wildcard "*").
  const DATASET_POLICIES: (typeof schema.datasetPolicies.$inferInsert)[] = [
    { policyId: "pol:sector:public", datasetId: "*", entityType: "sector",
      classification: "public", allowedRoles: null, jurisdictionId: null },
    { policyId: "pol:data-source:internal", datasetId: "*", entityType: "data_source",
      classification: "internal", allowedRoles: null, jurisdictionId: null },
    { policyId: "pol:audit-event:restricted", datasetId: "*", entityType: "audit_event",
      classification: "restricted",
      allowedRoles: ["platform_admin", "data_steward"], jurisdictionId: null },
  ];
  for (const p of DATASET_POLICIES) {
    await db
      .insert(schema.datasetPolicies)
      .values(p)
      .onDuplicateKeyUpdate({
        set: {
          classification: p.classification,
          allowedRoles: p.allowedRoles,
          jurisdictionId: p.jurisdictionId ?? null,
        },
      });
  }
  console.log(`  dataset_policies: ${DATASET_POLICIES.length} upserted`);
  // === end feat-dataset-abac seed ===

  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
