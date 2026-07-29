/**
 * Lagos–Calabar Coastal Highway evidence pack — idempotent (existing PKs are
 * skipped; scenario template is upserted). Worked example of
 * "funded project → opportunities (incl. TECHNOLOGY)".
 *
 * Facts encoded (grounded in Dec 2025 public reporting):
 *  - 700km coastal highway across 9 states (Lagos → Cross River).
 *  - Phase 1 Section 1 (47.5km) commissioned May 2025.
 *  - Section 2 (55.7km, Eleko → Ode-Omi) financed at $1.126B
 *    ($626M First Abuja Bank + $500M Afreximbank, ICIEC-wrapped),
 *    after $747M Section 1. Contractor: Hitech (CRCP pavement).
 *  - Median reserved for future rail; solar lighting + wind; links Lekki
 *    Deep Sea Port, Dangote Refinery, Lekki Free Zone.
 *  - Travel time Lagos–Calabar ~14h → ~7h.
 *
 * Provenance honesty: all rows carry origin="derived" — parsed from public
 * reporting (Dec 2025), NOT harvested from the Budget Office connector.
 * Upgrade path: origin="live" once the Budget Office connector ingests the
 * Federal Ministry of Works appropriation directly (see docs/DEMO-LAGOS-CALABAR.md).
 *
 * Run with: npx tsx db/seed-lagos-calabar.ts
 */
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";

const db = getDb();

async function existingIds(table: never, pkCol: never): Promise<Set<string>> {
  const rows = await db.select({ id: pkCol }).from(table as never);
  return new Set((rows as unknown as { id: string }[]).map((r) => String(r.id)));
}

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
/* Corridor constants                                                  */
/* ------------------------------------------------------------------ */

/** 9 corridor states, Lagos → Cross River (west→east). */
export const CORRIDOR_STATES = [
  "lagos",
  "ogun",
  "ondo",
  "delta",
  "bayelsa",
  "rivers",
  "akwa-ibom",
  "cross-river",
  "edo",
] as const;

export type CorridorLayer =
  | "direct"
  | "corridor"
  | "asset"
  | "tangential"
  | "technology";

export const EV = {
  commissioning: "ev:document:lch-commissioning-2025",
  financing: "ev:document:lch-section2-financing-2025",
  esia: "ev:document:lch-esia-disclosure",
  design: "ev:document:lch-corridor-design-2025",
} as const;

/* ------------------------------------------------------------------ */
/* Jurisdictions — 9 corridor states (jur:ng-la already in base seed;  */
/* ensureStringPk skips it).                                            */
/* ------------------------------------------------------------------ */

const CORRIDOR_JURISDICTIONS: (typeof schema.jurisdictions.$inferInsert)[] = [
  { jurisdictionId: "jur:ng-la", name: "Lagos State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-og", name: "Ogun State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-on", name: "Ondo State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-de", name: "Delta State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-ba", name: "Bayelsa State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-ri", name: "Rivers State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-ak", name: "Akwa Ibom State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-cr", name: "Cross River State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
  { jurisdictionId: "jur:ng-ed", name: "Edo State", adminLevel: "state", countryCode: "NG", parentId: "jur:ng", validFrom: new Date("1999-05-29"), sourceRefs: ["src:nbs"] },
];

/* ------------------------------------------------------------------ */
/* Sectors (create if absent)                                          */
/* ------------------------------------------------------------------ */

const CORRIDOR_SECTORS: (typeof schema.sectors.$inferInsert)[] = [
  { sectorCode: "construction", name: "Construction", description: "Highway, civil works, materials and equipment services." },
  { sectorCode: "logistics", name: "Logistics", description: "Trucking, cold chain, warehousing and distribution." },
  { sectorCode: "tourism_hospitality", name: "Tourism & Hospitality", description: "Coastal tourism, eco-tourism, hotels and leisure services." },
  { sectorCode: "real_estate", name: "Real Estate", description: "Corridor land development, industrial parks and housing." },
  { sectorCode: "energy", name: "Energy", description: "Solar/wind highway power, fuel retail and EV charging." },
  { sectorCode: "technology", name: "Technology", description: "Smart tolling, IoT, drones, connectivity and digital platforms." },
];

/* ------------------------------------------------------------------ */
/* Data-source registry rows (license / quality / privacy per §16)     */
/* ------------------------------------------------------------------ */

const CORRIDOR_DATA_SOURCES: (typeof schema.dataSources.$inferInsert)[] = [
  { sourceId: "src:statehouse-ng", name: "Nigerian State House Press Releases", owner: "Presidency", url: "https://statehouse.gov.ng", category: "government_communications", accessMethod: "scrape", refreshCadence: "daily", ingestionPattern: "incremental", health: "healthy", freshnessDays: 1, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "Public government communications", qualityScore: 78, privacyClassification: "public", geographyScope: "federal" },
  { sourceId: "src:afreximbank", name: "Afreximbank Press & Deal Announcements", owner: "Afreximbank", url: "https://www.afreximbank.com", category: "development_finance", accessMethod: "scrape", refreshCadence: "weekly", ingestionPattern: "incremental", health: "healthy", freshnessDays: 4, contractCompliance: { schema_ok: true, sla_ok: true, license_ok: true }, license: "Public press releases", qualityScore: 81, privacyClassification: "public", geographyScope: "regional" },
  { sourceId: "src:fmw-esia", name: "FMEnv ESIA Disclosure Portal (eia.gov.ng)", owner: "Federal Ministry of Environment", url: "https://eia.gov.ng", category: "environmental_disclosure", accessMethod: "download", refreshCadence: "monthly", ingestionPattern: "batch", health: "stale", freshnessDays: 30, contractCompliance: { schema_ok: true, sla_ok: false, license_ok: true }, license: "Public environmental disclosure", qualityScore: 64, privacyClassification: "public", geographyScope: "national" },
];

/* ------------------------------------------------------------------ */
/* Evidence sources — origin="derived" from public reporting (Dec 2025) */
/* ------------------------------------------------------------------ */

const CORRIDOR_EVIDENCE: (typeof schema.evidenceSources.$inferInsert)[] = [
  {
    evidenceSourceId: EV.commissioning,
    sourceType: "document",
    citation: "State House release — President commissions Phase 1 Section 1 (47.5km) of the Lagos–Calabar Coastal Highway, May 2025",
    retrievalPath: "documents/doc:ng:lch-commissioning-2025",
    confidence: 0.85,
    contentExcerpt:
      "Phase 1 Section 1 (47.5km, Lagos) commissioned May 2025; 700km corridor across 9 states; Lagos–Calabar travel time ~14h → ~7h; links Lekki Deep Sea Port, Dangote Refinery and Lekki Free Zone.",
    linkedEntityIds: { opportunity_ids: [] },
    origin: "derived",
    sourceUrl: "https://statehouse.gov.ng/news/",
  },
  {
    evidenceSourceId: EV.financing,
    sourceType: "document",
    citation: "Afreximbank / First Abuja Bank announcement — $1.126B financing for Section 2 (55.7km, Eleko → Ode-Omi), ICIEC-wrapped, Dec 2025",
    retrievalPath: "documents/doc:ng:lch-section2-financing-2025",
    confidence: 0.88,
    contentExcerpt:
      "Section 2 (55.7km) financed at $1.126B — $626M First Abuja Bank facility + $500M Afreximbank, with ICIEC insurance wrap; follows $747M Section 1 financing; contractor Hitech Construction.",
    linkedEntityIds: { opportunity_ids: [] },
    origin: "derived",
    sourceUrl: "https://www.afreximbank.com/media/",
  },
  {
    evidenceSourceId: EV.esia,
    sourceType: "document",
    citation: "ESIA disclosure — Lagos–Calabar Coastal Highway sections, Federal Ministry of Environment disclosure portal",
    retrievalPath: "documents/doc:ng:lch-esia",
    confidence: 0.72,
    contentExcerpt:
      "Environmental & Social Impact Assessment disclosure for corridor sections; wetland/coastal crossings, resettlement and erosion-control commitments on Lagoon–Cross River stretches.",
    linkedEntityIds: { opportunity_ids: [] },
    origin: "derived",
    sourceUrl: "https://eia.gov.ng",
  },
  {
    evidenceSourceId: EV.design,
    sourceType: "document",
    citation: "Federal Ministry of Works corridor design briefs — CRCP pavement, rail-ready median, solar + wind highway power (2024–2025 reporting)",
    retrievalPath: "documents/doc:ng:lch-corridor-design",
    confidence: 0.78,
    contentExcerpt:
      "Continuously Reinforced Concrete Pavement (CRCP) by Hitech; median reserved for future rail; solar street lighting with wind supplementation; service ducts along right-of-way.",
    linkedEntityIds: { opportunity_ids: [] },
    origin: "derived",
    sourceUrl: "https://works.gov.ng",
  },
];

/* ------------------------------------------------------------------ */
/* Budget row — FMW capital line for the coastal highway               */
/* Figures in ₦ (not millions). $1.126B ≈ ₦1.74trn at ~₦1,550/$        */
/* (Dec 2025 reporting range). provenance derived; linked to the       */
/* financing evidence via `source`.                                    */
/* ------------------------------------------------------------------ */

const CORRIDOR_BUDGETS: (typeof schema.budgets.$inferInsert)[] = [
  {
    budgetId: "bud:ng-2025-fmw-coastal-highway",
    jurisdictionId: "jur:ng",
    fiscalYear: 2025,
    mda: "Federal Ministry of Works",
    sectorCode: "construction",
    appropriatedNgn: 1_744_000_000_000,
    releasedNgn: null,
    source: EV.financing,
    origin: "derived",
    sourceUrl: "https://www.afreximbank.com/media/",
  },
];

/* ------------------------------------------------------------------ */
/* Opportunities — layer encoded in the summary tag                    */
/* [layer:X | states:... | lgas:...] and in LCH_LAYERS below.          */
/* ------------------------------------------------------------------ */

type OppRow = typeof schema.opportunities.$inferInsert;

function opp(
  opportunityId: string,
  jurisdictionId: string,
  sectorCode: string,
  title: string,
  body: string,
  layer: CorridorLayer,
  states: string[],
  lgas: string[],
  fields: Partial<OppRow>,
  evidenceRefs: string[],
): OppRow {
  return {
    opportunityId,
    jurisdictionId,
    sectorCode,
    title,
    summary: `${body} [layer:${layer} | states:${states.join(",")} | lgas:${lgas.join(",")}]`,
    reviewState: "in_review",
    evidenceRefs,
    ...fields,
  } as OppRow;
}

export const CORRIDOR_OPPORTUNITIES: OppRow[] = [
  /* ---- Direct (construction supply chain) ---- */
  opp("opp:lch:materials-supply", "jur:ng-la", "construction", "Cement, aggregates & laterite supply contracts",
    "Framework supply of cement, crushed aggregates and laterite borrow-pit material to Hitech section camps; 700km CRCP pavement implies multi-year demand across section lots.",
    "direct", ["lagos", "ogun", "ondo"], ["eti-osa", "ibeju-lekki", "epe", "ijebu-ode", "ode-omi"],
    { score: 0.9, confidence: 0.8, estimatedJobsMin: 4_500, estimatedJobsMax: 9_000, budgetMin: 60_000, budgetMax: 110_000, horizonMonths: 60 },
    [EV.financing, EV.design]),
  opp("opp:lch:equipment-leasing", "jur:ng-og", "construction", "Heavy-equipment leasing & maintenance pool",
    "Leasing pool for pavers, crushers, batching plants and haulage fleets serving simultaneous section fronts; maintenance depots at Eleko and Ode-Omi.",
    "direct", ["lagos", "ogun"], ["ibeju-lekki", "epe", "ijebu-ode"],
    { score: 0.84, confidence: 0.74, estimatedJobsMin: 1_800, estimatedJobsMax: 3_600, budgetMin: 28_000, budgetMax: 52_000, horizonMonths: 48 },
    [EV.financing, EV.design]),
  opp("opp:lch:geotech-survey", "jur:ng-de", "construction", "Geotechnical & survey services (wetland stretches)",
    "Bathymetric, geotechnical and cadastral survey contracts for lagoon/wetland crossings between Ondo and Cross River, per ESIA disclosure commitments.",
    "direct", ["ondo", "delta", "bayelsa", "rivers"], ["ilaje", "warri-north", "brass", "degema"],
    { score: 0.78, confidence: 0.7, estimatedJobsMin: 900, estimatedJobsMax: 1_900, budgetMin: 9_500, budgetMax: 18_000, horizonMonths: 42 },
    [EV.esia, EV.design]),
  opp("opp:lch:camp-services", "jur:ng-ri", "construction", "Construction camp services & catering",
    "Camp construction, catering, security and medical services for rolling contractor camps across the 9 corridor states; local-hire preference per ESIA social commitments.",
    "direct", CORRIDOR_STATES.slice(3, 8) as unknown as string[], ["degema", "bonny", "akpabuyo"],
    { score: 0.72, confidence: 0.66, estimatedJobsMin: 2_600, estimatedJobsMax: 5_200, budgetMin: 7_800, budgetMax: 14_500, horizonMonths: 54 },
    [EV.esia, EV.financing]),
  opp("opp:lch:crcp-qaqc-labs", "jur:ng-la", "construction", "CRCP QA/QC materials-testing laboratories",
    "Accredited concrete/soils testing laboratories serving CRCP pours; mobile labs per section plus a reference lab in Lekki; certification demand anchored on Hitech's CRCP specification.",
    "direct", ["lagos", "ogun", "ondo"], ["ibeju-lekki", "epe", "ilaje"],
    { score: 0.8, confidence: 0.72, estimatedJobsMin: 650, estimatedJobsMax: 1_300, budgetMin: 4_200, budgetMax: 8_800, horizonMonths: 48 },
    [EV.design, EV.financing]),

  /* ---- Corridor-enabled (mobility services) ---- */
  opp("opp:lch:trucking-cold-chain", "jur:ng-ri", "logistics", "Long-haul trucking & cold-chain fleets",
    "New-entrant and expansion financing for refrigerated and dry fleets exploiting the ~14h→7h travel-time cut; perishables (fish, horticulture) Lagos↔Calabar in one driver shift.",
    "corridor", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.86, confidence: 0.76, estimatedJobsMin: 7_500, estimatedJobsMax: 14_000, budgetMin: 22_000, budgetMax: 44_000, horizonMonths: 60 },
    [EV.commissioning]),
  opp("opp:lch:truck-stops", "jur:ng-og", "logistics", "Truck stops & rest plazas",
    "Develop 6–8 branded truck stops with rest facilities, weighbridges and secure parking at ~100km spacing; PPP concessions along the corridor.",
    "corridor", ["lagos", "ogun", "ondo", "delta", "rivers", "cross-river"], ["epe", "ijebu-ode", "ore", "warri", "port-harcourt", "calabar"],
    { score: 0.74, confidence: 0.64, estimatedJobsMin: 2_200, estimatedJobsMax: 4_800, budgetMin: 16_000, budgetMax: 30_000, horizonMonths: 48 },
    [EV.commissioning, EV.design]),
  opp("opp:lch:fuel-ev-charging", "jur:ng-on", "energy", "Fuel retail + EV charging stations",
    "Fuel stations with co-located DC fast-charging at corridor interchanges; powered partly by the highway's solar/wind installations where grid is weak.",
    "corridor", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.76, confidence: 0.66, estimatedJobsMin: 1_500, estimatedJobsMax: 3_100, budgetMin: 19_000, budgetMax: 36_000, horizonMonths: 54 },
    [EV.design, EV.commissioning]),
  opp("opp:lch:toll-adjacent-retail", "jur:ng-la", "real_estate", "Toll-adjacent retail & services",
    "Retail, food-court and service concessions at toll plazas and major interchanges; anchored on tolled Section 1 traffic ramp-up.",
    "corridor", ["lagos", "ogun", "cross-river"], ["eti-osa", "ibeju-lekki", "calabar"],
    { score: 0.68, confidence: 0.58, estimatedJobsMin: 1_100, estimatedJobsMax: 2_400, budgetMin: 8_500, budgetMax: 16_000, horizonMonths: 42 },
    [EV.commissioning]),

  /* ---- Asset-linked (Lekki port / FTZ / refinery) ---- */
  opp("opp:lch:lekki-warehousing", "jur:ng-la", "logistics", "Warehousing & distribution near Lekki Port & FTZ",
    "Bonded and dry warehousing within 10km of Lekki Deep Sea Port and Lekki Free Zone; the highway is the primary evacuation artery for port and refinery cargo.",
    "asset", ["lagos"], ["ibeju-lekki", "epe"],
    { score: 0.88, confidence: 0.8, estimatedJobsMin: 5_000, estimatedJobsMax: 9_500, budgetMin: 45_000, budgetMax: 85_000, horizonMonths: 60 },
    [EV.commissioning, EV.financing]),
  opp("opp:lch:agro-aggregation-port", "jur:ng-de", "logistics", "Agro-aggregation to port (Delta–Ondo belt)",
    "Aggregation centres for cassava, palm and aquaculture feeding processing and export via Lekki/Onne/Calabar ports; corridor halves spoilage on long hauls.",
    "asset", ["ondo", "delta", "rivers", "akwa-ibom"], ["ilaje", "ndokwa", "port-harcourt", "uyo"],
    { score: 0.82, confidence: 0.7, estimatedJobsMin: 6_200, estimatedJobsMax: 11_500, budgetMin: 14_000, budgetMax: 26_000, horizonMonths: 54 },
    [EV.commissioning, EV.esia]),
  opp("opp:lch:export-processing", "jur:ng-la", "logistics", "Export processing & light manufacturing (FTZ-adjacent)",
    "FTZ-adjacent light manufacturing and export processing (garments, agro-foods, assembly) using refinery/port inputs and corridor distribution.",
    "asset", ["lagos", "ogun"], ["ibeju-lekki", "epe", "ijebu-ode"],
    { score: 0.79, confidence: 0.68, estimatedJobsMin: 8_000, estimatedJobsMax: 15_000, budgetMin: 38_000, budgetMax: 72_000, horizonMonths: 72 },
    [EV.commissioning, EV.financing]),

  /* ---- Tangential (second-order) ---- */
  opp("opp:lch:tourism-hospitality", "jur:ng-cr", "tourism_hospitality", "Coastal tourism & eco-tourism circuit",
    "Araromi beach (Ondo), Idanre hills access, and Cross River eco-tourism (Obudu, Calabar carnival) packaged as a drive circuit; hotels, resorts and tour operations along the coastal stretch.",
    "tangential", ["lagos", "ondo", "akwa-ibom", "cross-river"], ["ilaje", "araromi", "idanre", "calabar", "obudu"],
    { score: 0.77, confidence: 0.62, estimatedJobsMin: 4_800, estimatedJobsMax: 9_600, budgetMin: 24_000, budgetMax: 48_000, horizonMonths: 72 },
    [EV.commissioning, EV.esia]),
  opp("opp:lch:real-estate-dev", "jur:ng-la", "real_estate", "Corridor real-estate & industrial park development",
    "Residential estates, industrial parks and logistics parks on corridor-adjacent land in Ibeju-Lekki, Epe and Ode-Omi; land values already re-rating on Section 1.",
    "tangential", ["lagos", "ogun"], ["ibeju-lekki", "epe", "ode-omi"],
    { score: 0.73, confidence: 0.6, estimatedJobsMin: 6_500, estimatedJobsMax: 12_500, budgetMin: 90_000, budgetMax: 170_000, horizonMonths: 84 },
    [EV.commissioning]),
  opp("opp:lch:fisheries-cold-chain", "jur:ng-ba", "logistics", "Fisheries cold chains (Bayelsa–Rivers coast)",
    "Landing-site cold rooms and refrigerated transport for artisanal fisheries; corridor access lets catch reach Lagos markets same-day instead of multi-day.",
    "tangential", ["bayelsa", "rivers", "akwa-ibom"], ["brass", "degema", "okrika"],
    { score: 0.7, confidence: 0.58, estimatedJobsMin: 2_800, estimatedJobsMax: 5_400, budgetMin: 6_500, budgetMax: 12_500, horizonMonths: 48 },
    [EV.commissioning, EV.esia]),
  opp("opp:lch:insurance-services", "jur:ng-la", "real_estate", "Insurance & surety services for corridor businesses",
    "Marine-cargo, motor-fleet, construction-all-risk and surety products for corridor contractors, fleet operators and FTZ firms; the ICIEC wrap on Section 2 financing signals insurer appetite.",
    "tangential", ["lagos"], ["eti-osa", "lagos-island"],
    { score: 0.66, confidence: 0.56, estimatedJobsMin: 900, estimatedJobsMax: 1_800, budgetMin: 3_200, budgetMax: 6_500, horizonMonths: 42 },
    [EV.financing]),

  /* ---- TECHNOLOGY (layer="technology") ---- */
  opp("opp:lch:tech:smart-tolling", "jur:ng", "technology", "Smart tolling & traffic-management systems",
    "Free-flow electronic toll collection, ANPR gantries and corridor traffic-management centre; Section 1 tolling is the proving ground for corridor-wide ITS.",
    "technology", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.87, confidence: 0.75, estimatedJobsMin: 1_200, estimatedJobsMax: 2_600, budgetMin: 32_000, budgetMax: 58_000, horizonMonths: 60 },
    [EV.design, EV.commissioning]),
  opp("opp:lch:tech:iot-sensors", "jur:ng-ba", "technology", "Corridor IoT/sensor networks (structural health, weather, flood)",
    "Structural-health sensors on bridges, plus weather and flood sensors on wetland stretches flagged in the ESIA; telemetry feeds the corridor traffic-management centre.",
    "technology", ["ondo", "delta", "bayelsa", "rivers", "akwa-ibom"], ["ilaje", "brass", "degema"],
    { score: 0.81, confidence: 0.7, estimatedJobsMin: 700, estimatedJobsMax: 1_500, budgetMin: 14_000, budgetMax: 27_000, horizonMonths: 54 },
    [EV.esia, EV.design]),
  opp("opp:lch:tech:solar-wind-om", "jur:ng-la", "technology", "Solar/wind hybrid installation & O&M + carbon-credit MRV",
    "Design-build-operate contracts for the highway's solar street lighting with wind supplementation; carbon-credit MRV platform monetising displaced grid/diesel lighting.",
    "technology", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.83, confidence: 0.72, estimatedJobsMin: 1_600, estimatedJobsMax: 3_200, budgetMin: 26_000, budgetMax: 49_000, horizonMonths: 66 },
    [EV.design]),
  opp("opp:lch:tech:drone-analytics", "jur:ng-og", "technology", "Drone surveying & construction-progress analytics",
    "Recurring UAV corridor surveys with photogrammetry and AI progress-tracking against section schedules; independent verification for lenders (FAB/Afreximbank/ICIEC) and FMW.",
    "technology", ["lagos", "ogun", "ondo"], ["ibeju-lekki", "epe", "ijebu-ode", "ilaje"],
    { score: 0.75, confidence: 0.66, estimatedJobsMin: 450, estimatedJobsMax: 950, budgetMin: 3_800, budgetMax: 7_600, horizonMonths: 48 },
    [EV.financing, EV.design]),
  opp("opp:lch:tech:fiber-5g-ducting", "jur:ng", "technology", "Fiber/5G ducting along ROW + edge data services",
    "Dark-fiber and 5G small-cell ducting in the right-of-way service ducts, with edge data nodes at interchanges serving corridor businesses and communities.",
    "technology", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.8, confidence: 0.68, estimatedJobsMin: 1_900, estimatedJobsMax: 3_800, budgetMin: 44_000, budgetMax: 82_000, horizonMonths: 72 },
    [EV.design]),
  opp("opp:lch:tech:rail-median-systems", "jur:ng", "technology", "Future rail-median systems integration (signaling/comms)",
    "Systems-engineering readiness for the reserved rail median: signaling, telecoms and SCADA integration contracts when the coastal rail concession advances; interface with highway ITS.",
    "technology", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.71, confidence: 0.58, estimatedJobsMin: 800, estimatedJobsMax: 1_700, budgetMin: 18_000, budgetMax: 40_000, horizonMonths: 84 },
    [EV.design]),
  opp("opp:lch:tech:freight-matching", "jur:ng-la", "technology", "Digital freight-matching platform for the corridor",
    "Shipper-carrier matching, backhaul optimisation and e-CMR documentation for Lagos–Calabar flows; rides the travel-time cut to grow addressable freight volume.",
    "technology", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.78, confidence: 0.64, estimatedJobsMin: 550, estimatedJobsMax: 1_200, budgetMin: 2_800, budgetMax: 6_200, horizonMonths: 42 },
    [EV.commissioning]),
  opp("opp:lch:tech:gis-digital-twin", "jur:ng", "technology", "GIS / digital-twin asset management for FMW",
    "Corridor digital twin for the Federal Ministry of Works: GIS asset register, pavement-condition modelling and maintenance planning across all 700km.",
    "technology", CORRIDOR_STATES as unknown as string[], [],
    { score: 0.76, confidence: 0.65, estimatedJobsMin: 380, estimatedJobsMax: 820, budgetMin: 5_500, budgetMax: 11_000, horizonMonths: 60 },
    [EV.design, EV.esia]),
];

/** Layer lookup for tests/UI (authoritative; mirrored in summary tag). */
export const LCH_LAYERS: Record<string, CorridorLayer> = Object.fromEntries(
  CORRIDOR_OPPORTUNITIES.map((o) => {
    const m = /\[layer:(\w+) \|/.exec(o.summary ?? "");
    return [o.opportunityId, (m?.[1] ?? "direct") as CorridorLayer];
  }),
);

/* ------------------------------------------------------------------ */
/* Interventions (back the scenario template config)                   */
/* ------------------------------------------------------------------ */

const CORRIDOR_INTERVENTIONS: (typeof schema.interventions.$inferInsert)[] = [
  { interventionId: "itv:lch:corridor-construction", opportunityId: "opp:lch:materials-supply", name: "Corridor construction programme", description: "Section-by-section CRCP build-out across the 9 corridor states, anchored on the $1.126B Section 2 financing envelope.", instrumentType: "infrastructure_investment", estimatedCost: 120_000, expectedJobs: 28_000, timelineMonths: 84, evidenceRefs: [EV.financing, EV.design] },
  { interventionId: "itv:lch:logistics-policy", opportunityId: "opp:lch:trucking-cold-chain", name: "Corridor logistics & cold-chain policy", description: "Fleet-financing window, truck-stop concessions and cold-chain standards exploiting the ~14h→7h travel-time cut.", instrumentType: "logistics_policy", estimatedCost: 24_000, expectedJobs: 16_000, timelineMonths: 60, evidenceRefs: [EV.commissioning] },
  { interventionId: "itv:lch:tech-systems", opportunityId: "opp:lch:tech:smart-tolling", name: "Corridor technology systems bundle", description: "Smart tolling, IoT sensors, solar/wind O&M with carbon MRV, fiber ducting and FMW digital twin as one procurement bundle.", instrumentType: "infrastructure_investment", estimatedCost: 48_000, expectedJobs: 6_500, timelineMonths: 66, evidenceRefs: [EV.design, EV.esia] },
  { interventionId: "itv:lch:tourism-dev", opportunityId: "opp:lch:tourism-hospitality", name: "Coastal tourism development", description: "Eco-tourism circuit (Araromi, Idanre, Cross River) with hospitality investment incentives.", instrumentType: "investment_incentive", estimatedCost: 20_000, expectedJobs: 7_500, timelineMonths: 72, evidenceRefs: [EV.commissioning, EV.esia] },
];

/* ------------------------------------------------------------------ */
/* Scenario template preset                                            */
/* ------------------------------------------------------------------ */

export const CORRIDOR_TEMPLATE: typeof schema.scenarioTemplates.$inferInsert = {
  templateId: "tpl:lagos-calabar-corridor",
  name: "Lagos–Calabar corridor build-out",
  description:
    "84-month corridor build-out anchored on the $1.126B Section 2 financing scale ($626M FAB + $500M Afreximbank, ICIEC-wrapped; $747M Section 1 precedent). Instruments: infrastructure_investment + logistics_policy. Targets employment and firm births across the 9 corridor states (Lagos, Ogun, Ondo, Delta, Bayelsa, Rivers, Akwa Ibom, Cross River, Edo). Provenance: origin=derived from Dec 2025 public reporting.",
  config: {
    intervention_ids: ["itv:lch:corridor-construction", "itv:lch:logistics-policy", "itv:lch:tech-systems", "itv:lch:tourism-dev"],
    model_plan: [{ engine: "forecast" }, { engine: "system_dynamics" }],
    horizon_months: 84,
    assumptions: {
      financing_usd: 1_126_000_000,
      financing_ngn_approx: 1_744_000_000_000,
      corridor_states: CORRIDOR_STATES,
      instruments: ["infrastructure_investment", "logistics_policy"],
      targets: ["employment", "firm_births"],
      travel_time_hours: { before: 14, after: 7 },
      evidence: [EV.financing, EV.commissioning, EV.design, EV.esia],
    },
  } as never,
  authorJurisdiction: "jur:ng",
  installs: 0,
  rating: 0,
  publishedState: "approved",
};

/* ------------------------------------------------------------------ */
/* I3 — Corridor Twin milestones (ADDITIVE; idempotent via milestoneId) */
/* Corridor: Lagos–Calabar coastal highway, ₦1.744trn planned envelope */
/* ($1.126B S2 + $747M S1 at ~₦1,550/$). Disbursement figures are     */
/* cumulative ₦ against each milestone; provenance origin="derived".  */
/* ------------------------------------------------------------------ */

export const CORRIDOR_ID = "corridor:lagos-calabar";

export const CORRIDOR_MILESTONES: (typeof schema.corridorMilestones.$inferInsert)[] = [
  {
    milestoneId: "ms:lch-s1-financing-close",
    corridorId: CORRIDOR_ID,
    title: "Section 1 financing close ($747M)",
    plannedDate: "2024-03-31",
    actualDate: "2024-03-31",
    status: "done",
    pctComplete: 100,
    fundingDisbursedNgn: 747_000_000 * 1550,
    evidenceRef: EV.financing,
  },
  {
    milestoneId: "ms:lch-esia-disclosure",
    corridorId: CORRIDOR_ID,
    title: "ESIA disclosure (FMEnv portal)",
    plannedDate: "2024-06-30",
    actualDate: "2024-09-15",
    status: "done",
    pctComplete: 100,
    fundingDisbursedNgn: null,
    evidenceRef: EV.esia,
  },
  {
    milestoneId: "ms:lch-s1-crcp-sections",
    corridorId: CORRIDOR_ID,
    title: "Section 1 CRCP pavement sections (Hitech)",
    plannedDate: "2025-02-28",
    actualDate: "2025-04-30",
    status: "done",
    pctComplete: 100,
    fundingDisbursedNgn: 500_000_000 * 1550,
    evidenceRef: EV.design,
  },
  {
    milestoneId: "ms:lch-s1-commissioning",
    corridorId: CORRIDOR_ID,
    title: "Section 1 commissioning (47.5km)",
    plannedDate: "2025-05-31",
    actualDate: "2025-05-31",
    status: "done",
    pctComplete: 100,
    fundingDisbursedNgn: 247_000_000 * 1550,
    evidenceRef: EV.commissioning,
  },
  {
    milestoneId: "ms:lch-s2-financing",
    corridorId: CORRIDOR_ID,
    title: "Section 2 financing close ($1.126B — FAB $626M + Afreximbank $500M, ICIEC-wrapped)",
    plannedDate: "2025-12-15",
    actualDate: "2025-12-15",
    status: "done",
    pctComplete: 100,
    fundingDisbursedNgn: 250_000_000 * 1550,
    evidenceRef: EV.financing,
  },
  {
    milestoneId: "ms:lch-solar-lighting-pilot",
    corridorId: CORRIDOR_ID,
    title: "Solar lighting pilot (Section 1 stretch)",
    plannedDate: "2026-03-31",
    actualDate: null,
    status: "in_progress",
    pctComplete: 40,
    fundingDisbursedNgn: 12_000_000_000,
    evidenceRef: EV.design,
  },
  {
    milestoneId: "ms:lch-rail-median-study",
    corridorId: CORRIDOR_ID,
    title: "Rail-median feasibility study",
    plannedDate: "2026-06-30",
    actualDate: null,
    status: "planned",
    pctComplete: 5,
    fundingDisbursedNgn: null,
    evidenceRef: EV.design,
  },
  {
    milestoneId: "ms:lch-s2-crcp-works",
    corridorId: CORRIDOR_ID,
    title: "Section 2 CRCP main works (55.7km, Eleko → Ode-Omi)",
    plannedDate: "2027-12-31",
    actualDate: null,
    status: "delayed",
    pctComplete: 10,
    fundingDisbursedNgn: 60_000_000_000,
    evidenceRef: EV.financing,
  },
  {
    milestoneId: "ms:lch-full-corridor-2030",
    corridorId: CORRIDOR_ID,
    title: "Full corridor completion target (700km, 9 states)",
    plannedDate: "2030-12-31",
    actualDate: null,
    status: "planned",
    pctComplete: 8,
    fundingDisbursedNgn: null,
    evidenceRef: EV.commissioning,
  },
];

/* ------------------------------------------------------------------ */
/* Upsert                                                              */
/* ------------------------------------------------------------------ */

export async function seedLagosCalabar() {
  console.log("Seeding Lagos–Calabar corridor pack (idempotent)...");
  await ensureStringPk("jurisdictions", schema.jurisdictions as never, schema.jurisdictions.jurisdictionId as never, CORRIDOR_JURISDICTIONS as never, "jurisdictionId");
  await ensureStringPk("sectors", schema.sectors as never, schema.sectors.sectorCode as never, CORRIDOR_SECTORS as never, "sectorCode");
  await ensureStringPk("data_sources", schema.dataSources as never, schema.dataSources.sourceId as never, CORRIDOR_DATA_SOURCES as never, "sourceId");
  await ensureStringPk("evidence_sources", schema.evidenceSources as never, schema.evidenceSources.evidenceSourceId as never, CORRIDOR_EVIDENCE as never, "evidenceSourceId");
  await ensureStringPk("budgets", schema.budgets as never, schema.budgets.budgetId as never, CORRIDOR_BUDGETS as never, "budgetId");
  await ensureStringPk("opportunities", schema.opportunities as never, schema.opportunities.opportunityId as never, CORRIDOR_OPPORTUNITIES as never, "opportunityId");
  await ensureStringPk("interventions", schema.interventions as never, schema.interventions.interventionId as never, CORRIDOR_INTERVENTIONS as never, "interventionId");
  // I3 — corridor milestones (additive; ensureStringPk keeps idempotency).
  await ensureStringPk("corridor_milestones", schema.corridorMilestones as never, schema.corridorMilestones.milestoneId as never, CORRIDOR_MILESTONES as never, "milestoneId");
  await db
    .insert(schema.scenarioTemplates)
    .values(CORRIDOR_TEMPLATE)
    .onDuplicateKeyUpdate({
      set: {
        name: CORRIDOR_TEMPLATE.name,
        description: CORRIDOR_TEMPLATE.description,
        config: CORRIDOR_TEMPLATE.config,
        publishedState: CORRIDOR_TEMPLATE.publishedState,
      },
    });
  console.log("  scenario_templates: 1 upserted (tpl:lagos-calabar-corridor)");
  console.log("Done.");
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /seed-lagos-calabar\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  seedLagosCalabar()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
