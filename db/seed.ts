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
  { sourceId: "src:nbs", name: "National Bureau of Statistics", owner: "NBS", url: "https://nigerianstat.gov.ng", category: "statistics", accessMethod: "api", refreshCadence: "quarterly", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(5), freshnessDays: 5, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national+states" },
  { sourceId: "src:nbs-microdata", name: "NBS Microdata Library", owner: "NBS", url: "https://microdata.nigerianstat.gov.ng", category: "microdata", accessMethod: "download", refreshCadence: "annual", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(11), freshnessDays: 11, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national+states" },
  { sourceId: "src:national-assembly", name: "National Assembly Bills & Acts", owner: "NASS", url: "https://nass.gov.ng", category: "legislation", accessMethod: "scrape", refreshCadence: "weekly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(2), freshnessDays: 2, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "federal" },
  { sourceId: "src:budget-office", name: "Budget Office of the Federation", owner: "BOF", url: "https://budgetoffice.gov.ng", category: "fiscal", accessMethod: "download", refreshCadence: "annual", ingestionPattern: "batch", health: "stale", lastRefresh: daysAgo(41), freshnessDays: 41, contractCompliance: { schema_ok: true, sla_ok: false, license_ok: true, notes: "2025 implementation report delayed" }, geographyScope: "federal" },
  { sourceId: "src:cac", name: "Corporate Affairs Commission", owner: "CAC", url: "https://www.cac.gov.ng", category: "business_registry", accessMethod: "api", refreshCadence: "monthly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(8), freshnessDays: 8, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national" },
  { sourceId: "src:bpp", name: "Bureau of Public Procurement (NOCOPO)", owner: "BPP", url: "https://bpp.gov.ng", category: "procurement", accessMethod: "api", refreshCadence: "monthly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(6), freshnessDays: 6, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national" },
  { sourceId: "src:osgof", name: "OSGoF Geospatial Data", owner: "OSGoF", url: "https://osgof.gov.ng", category: "geospatial", accessMethod: "download", refreshCadence: "quarterly", ingestionPattern: "batch", health: "stale", lastRefresh: daysAgo(34), freshnessDays: 34, contractCompliance: { schema_ok: true, sla_ok: false, license_ok: true }, geographyScope: "national" },
  { sourceId: "src:grid3", name: "GRID3 Nigeria", owner: "GRID3", url: "https://grid3.org", category: "geospatial", accessMethod: "api", refreshCadence: "quarterly", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(9), freshnessDays: 9, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national" },
  { sourceId: "src:ubec", name: "Universal Basic Education Commission", owner: "UBEC", url: "https://ubec.gov.ng", category: "education", accessMethod: "download", refreshCadence: "annual", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(13), freshnessDays: 13, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national" },
  { sourceId: "src:ndpc", name: "Nigeria Data Protection Commission", owner: "NDPC", url: "https://ndpc.gov.ng", category: "compliance", accessMethod: "scrape", refreshCadence: "monthly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(10), freshnessDays: 10, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national" },
  { sourceId: "src:open-treasury", name: "Open Treasury Portal", owner: "OAGF", url: "https://opentreasury.gov.ng", category: "fiscal", accessMethod: "api", refreshCadence: "daily", ingestionPattern: "streaming", health: "failing", lastRefresh: daysAgo(19), freshnessDays: 19, contractCompliance: { schema_ok: false, sla_ok: false, license_ok: true, notes: "Schema drift: payment voucher v3 fields unmapped since 2025-12" }, geographyScope: "federal" },
  { sourceId: "src:nerc", name: "Nigerian Electricity Regulatory Commission", owner: "NERC", url: "https://nerc.gov.ng", category: "energy", accessMethod: "scrape", refreshCadence: "quarterly", ingestionPattern: "batch", health: "healthy", lastRefresh: daysAgo(7), freshnessDays: 7, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national" },
  { sourceId: "src:nelex", name: "NELEX Job Exchange", owner: "FMLE", url: "https://nelex.ng", category: "labour", accessMethod: "api", refreshCadence: "weekly", ingestionPattern: "incremental", health: "healthy", lastRefresh: daysAgo(4), freshnessDays: 4, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, geographyScope: "national" },
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

  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
