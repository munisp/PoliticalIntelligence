/**
 * Policy Advocacy Pathway knowledge base (docs/ADVOCACY.md) — standalone,
 * idempotent seed runnable with `npx tsx db/seed-advocacy.ts`.
 *
 * ~45 research-grade Nigerian stakeholders (individuals, committees,
 * ministries/agencies, associations, state bodies), a directed relation
 * graph (oversees / lobbies / regulates / domesticates / member_of), and
 * two full regulatory pathways:
 *   - pw:ng-fintech-tourism-payments
 *   - pw:ng-land-management-platform
 *
 * Provenance honesty: EVERY row is origin="derived", asOf="2025-12", and
 * every stakeholder carries contactNote="verify currency before outreach".
 * Names are used only for broadly established public officeholders;
 * otherwise entries are role-only. Contact notes describe public channels
 * only — no private contact data.
 */
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";

const db = getDb();

export const ADVOCACY_AS_OF = "2025-12";
export const ADVOCACY_CONTACT_NOTE = "verify currency before outreach";

type Stk = typeof schema.stakeholders.$inferInsert;

function stk(
  stakeholderId: string,
  kind: Stk["kind"],
  name: string,
  fields: Partial<Stk>,
): Stk {
  return {
    stakeholderId,
    kind,
    name,
    sectorTags: [],
    origin: "derived",
    asOf: ADVOCACY_AS_OF,
    contactNote: ADVOCACY_CONTACT_NOTE,
    ...fields,
  } as Stk;
}

/* ------------------------------------------------------------------ */
/* Individuals (well-documented public officeholders; role-only where   */
/* the officeholder is not broadly established)                         */
/* ------------------------------------------------------------------ */

export const ADVOCACY_INDIVIDUALS: Stk[] = [
  stk("stk:cbn-governor", "individual", "Olayemi Cardoso", {
    title: "Governor, Central Bank of Nigeria",
    org: "Central Bank of Nigeria",
    sectorTags: ["fintech", "payments", "banking", "fx"],
    bio: "CBN Governor (appointed Sep 2023). Leads monetary policy and payments-system licensing.",
    influenceArea: "Final licensing authority for PSSP/PTSP approvals; sets capital thresholds and FX policy.",
    lobbyAngle: "Engage via formal CBN licensing consultations and payments-system stakeholder fora; frame proposals around financial inclusion and FX-compliant tourism receipts.",
  }),
  stk("stk:minister-comms-digital", "individual", "Bosun Tijani", {
    title: "Minister of Communications, Innovation & Digital Economy",
    org: "Federal Ministry of Communications, Innovation & Digital Economy",
    sectorTags: ["digital_economy", "technology", "startups", "data"],
    bio: "Minister since Aug 2023; champion of the Startup Act 2022 implementation and the 3MTT talent programme.",
    influenceArea: "Policy lead for digital economy, startup labelling and national digital platforms.",
    lobbyAngle: "Position platforms as Startup Act beneficiaries and digital-economy job creators; seek startup label support and ministry convening power.",
  }),
  fmTourismMinisterRow(),
  stk("stk:cbn-payments-director", "individual", "Director, Payments System Supervision (role holder)", {
    title: "Director, Payments System Supervision Department",
    org: "Central Bank of Nigeria",
    sectorTags: ["fintech", "payments"],
    bio: "Role-only entry: heads the CBN department that supervises PSSPs, PTSPs and switches.",
    influenceArea: "Day-to-day licensing supervision, sandbox cohorts and compliance reviews.",
    lobbyAngle: "Technical engagement on licensing requirements, transaction-monitoring readiness and pilot reporting.",
  }),
  stk("stk:nitda-dg", "individual", "Kashifu Inuwa Abdullahi", {
    title: "Director-General, NITDA",
    org: "National Information Technology Development Agency",
    sectorTags: ["technology", "digital_economy", "data", "startups"],
    bio: "NITDA DG since 2019; oversees IT standards, the NDPR legacy and Startup Act implementation support.",
    influenceArea: "IT regulation, startup ecosystem support, government digital-service standards.",
    lobbyAngle: "Seek NITDA endorsement for platform standards and inclusion in startup support programmes.",
  }),
  stk("stk:nimc-dg", "individual", "Abisoye Coker-Odusote", {
    title: "Director-General / CEO, NIMC",
    org: "National Identity Management Commission",
    sectorTags: ["identity", "digital_economy", "land"],
    bio: "NIMC DG/CEO (appointed 2023); leads NIN enrolment and national identity verification services.",
    influenceArea: "Identity verification APIs (NIN) used for KYC on payments and land-registry platforms.",
    lobbyAngle: "Engage on licensed NIN verification integration and data-protection-compliant identity flows.",
  }),
  stk("stk:ndpc-commissioner", "individual", "Vincent Olatunji", {
    title: "National Commissioner / CEO, NDPC",
    org: "Nigeria Data Protection Commission",
    sectorTags: ["data", "technology", "privacy"],
    bio: "NDPC National Commissioner (appointed 2023); enforces the Nigeria Data Protection Act 2023.",
    influenceArea: "Data-controller registration, compliance audits and cross-border transfer rules.",
    lobbyAngle: "Early engagement on data-controller registration and privacy-by-design positioning.",
  }),
  stk("stk:surcon-registrar", "individual", "Registrar, Surveyors Council of Nigeria (role holder)", {
    title: "Registrar, SURCON",
    org: "Surveyors Council of Nigeria",
    sectorTags: ["land", "survey", "geospatial"],
    bio: "Role-only entry: administers surveyor licensing and cadastral survey standards under the Surveyors Registration Council Act.",
    influenceArea: "Survey standards compliance for any land-management or cadastral platform.",
    lobbyAngle: "Frame digitization as strengthening licensed-surveyor workflows, not bypassing them.",
  }),
  stk("stk:lagos-lands-commissioner", "individual", "Lagos State Commissioner for Lands (role holder)", {
    title: "Honourable Commissioner, Ministry of Lands / Lands Bureau",
    org: "Lagos State Government",
    state: "Lagos",
    sectorTags: ["land", "real_estate"],
    bio: "Role-only entry: political head of Lagos land administration; Lagos runs Nigeria's most advanced lands digitization programme.",
    influenceArea: "Gatekeeper for Lagos land-registry digitization MOUs and C-of-O process reform.",
    lobbyAngle: "Pilot-first pitch: measurable reduction in title-processing time on Lagos precedent.",
  }),
  stk("stk:kaduna-lands-commissioner", "individual", "Kaduna State Commissioner for Lands (role holder)", {
    title: "Honourable Commissioner, Ministry of Lands / KADGIS oversight",
    org: "Kaduna State Government",
    state: "Kaduna",
    sectorTags: ["land", "real_estate"],
    bio: "Role-only entry: oversees Kaduna land administration and the KADGIS recertification programme.",
    influenceArea: "Kaduna is a leading land-reform state; political sponsor for digitization bills.",
    lobbyAngle: "Build on KADGIS recertification momentum; offer revenue-assurance metrics.",
  }),
  stk("stk:fct-land-admin-director", "individual", "Director, Land Administration FCTA (role holder)", {
    title: "Director, Land Administration",
    org: "Federal Capital Territory Administration",
    state: "FCT",
    sectorTags: ["land", "real_estate"],
    bio: "Role-only entry: runs FCT land administration (AGIS — Abuja Geographic Information Systems).",
    influenceArea: "FCT is a federal jurisdiction — a distinct adoption path from the 36 states.",
    lobbyAngle: "Position FCT/AGIS integration as the federal-jurisdiction proof point.",
  }),
];

function fmTourismMinisterRow(): Stk {
  return stk("stk:minister-tourism", "individual", "Hannatu Musawa", {
    title: "Minister of Art, Culture, Tourism & the Creative Economy",
    org: "Federal Ministry of Art, Culture, Tourism & the Creative Economy",
    sectorTags: ["tourism", "culture", "creative_economy"],
    bio: "Minister since Aug 2023; leads federal tourism policy and creative-economy initiatives.",
    influenceArea: "Federal tourism promotion policy; convening power over NTDC and state tourism boards.",
    lobbyAngle: "Frame digital tourism payments as unlocking measurable tourism GDP and visitor-spend data.",
  });
}

/* ------------------------------------------------------------------ */
/* Committees (National Assembly + state assemblies)                    */
/* ------------------------------------------------------------------ */

export const ADVOCACY_COMMITTEES: Stk[] = [
  stk("stk:senate-cte-banking", "committee", "Senate Committee on Banking, Insurance & Other Financial Institutions", {
    chamber: "senate",
    sectorTags: ["fintech", "payments", "banking"],
    bio: "Senate standing committee overseeing CBN, banking and non-bank financial institutions.",
    influenceArea: "Oversight hearings on payments licensing; BOFIA amendment carriage.",
    lobbyAngle: "Offer data-driven briefings on fintech tourism payment flows ahead of oversight sessions.",
  }),
  stk("stk:senate-cte-tourism", "committee", "Senate Committee on Tourism & Culture", {
    chamber: "senate",
    sectorTags: ["tourism", "culture"],
    bio: "Senate standing committee on tourism promotion and cultural affairs.",
    influenceArea: "NTDC Act oversight; tourism development bills.",
    lobbyAngle: "Pair tourism-digitalization pilots with committee study tours and state showcases.",
  }),
  stk("stk:senate-cte-lands", "committee", "Senate Committee on Lands, Housing & Urban Development", {
    chamber: "senate",
    sectorTags: ["land", "housing", "real_estate"],
    bio: "Senate standing committee covering FCT lands and federal housing policy.",
    influenceArea: "FCT land administration oversight; federal housing legislation.",
    lobbyAngle: "Engage on FCT/AGIS digitization and federal land-reform signalling.",
  }),
  stk("stk:senate-cte-ict", "committee", "Senate Committee on ICT & Cybercrime", {
    chamber: "senate",
    sectorTags: ["technology", "digital_economy", "data"],
    bio: "Senate standing committee on ICT, cybersecurity and digital economy legislation.",
    influenceArea: "NDPA implementation oversight; digital-economy bills.",
    lobbyAngle: "Provide technical evidence on data-protection-compliant platforms.",
  }),
  stk("stk:house-cte-banking", "committee", "House Committee on Banking & Currency", {
    chamber: "house",
    sectorTags: ["fintech", "payments", "banking"],
    bio: "House standing committee overseeing banking and currency matters.",
    influenceArea: "House carriage of BOFIA/payments amendments; CBN oversight.",
    lobbyAngle: "Coordinate House-Senate briefing symmetry on payments licensing reform.",
  }),
  stk("stk:house-cte-tourism", "committee", "House Committee on Tourism", {
    chamber: "house",
    sectorTags: ["tourism"],
    bio: "House standing committee on tourism development.",
    influenceArea: "House tourism bills; NTDC oversight.",
    lobbyAngle: "Present tourism-payments pilot results as committee evidence.",
  }),
  stk("stk:house-cte-housing", "committee", "House Committee on Housing & Habitat", {
    chamber: "house",
    sectorTags: ["land", "housing", "real_estate"],
    bio: "House standing committee on housing policy and habitat.",
    influenceArea: "Federal housing and mortgage-market legislation.",
    lobbyAngle: "Link land digitization to mortgage-market deepening and title collateralization.",
  }),
  stk("stk:house-cte-ict", "committee", "House Committee on ICT", {
    chamber: "house",
    sectorTags: ["technology", "digital_economy"],
    bio: "House standing committee on ICT and digital services.",
    influenceArea: "Digital-economy and e-government legislation.",
    lobbyAngle: "Offer platform metrics as evidence for digital-government procurement reform.",
  }),
  stk("stk:lagos-assembly-lands-cte", "committee", "Lagos State House of Assembly Committee on Lands", {
    chamber: "lagos_state_house_of_assembly",
    state: "Lagos",
    sectorTags: ["land", "real_estate"],
    bio: "State assembly committee that must carry any Lagos land-administration amendment.",
    influenceArea: "State land bill carriage; oversight of the Lands Bureau.",
    lobbyAngle: "Draft-ready bill support plus registry digitization ROI evidence.",
  }),
  stk("stk:kaduna-assembly-lands-cte", "committee", "Kaduna State House of Assembly Committee on Lands", {
    chamber: "kaduna_state_house_of_assembly",
    state: "Kaduna",
    sectorTags: ["land", "real_estate"],
    bio: "State assembly committee for land-administration legislation in Kaduna.",
    influenceArea: "State land bill carriage; KADGIS oversight.",
    lobbyAngle: "Leverage Kaduna's reform reputation; co-design a model state digitization bill.",
  }),
];

/* ------------------------------------------------------------------ */
/* Ministries, agencies, state bodies                                   */
/* ------------------------------------------------------------------ */

export const ADVOCACY_MINISTRIES_AGENCIES: Stk[] = [
  stk("stk:fm-tourism", "ministry", "Federal Ministry of Art, Culture, Tourism & the Creative Economy", {
    sectorTags: ["tourism", "culture", "creative_economy"],
    bio: "Federal ministry for tourism policy, culture and the creative economy.",
    influenceArea: "Tourism policy ownership; supervises NTDC.",
    lobbyAngle: "Anchor the tourism-payments narrative in the ministry's tourism-GDP agenda.",
  }),
  stk("stk:fm-comms-digital", "ministry", "Federal Ministry of Communications, Innovation & Digital Economy", {
    sectorTags: ["digital_economy", "technology", "startups"],
    bio: "Federal ministry for digital economy policy, innovation and ICT infrastructure.",
    influenceArea: "Startup Act implementation, digital-public-infrastructure policy.",
    lobbyAngle: "Seek startup label facilitation and ministry endorsement for digital platforms.",
  }),
  stk("stk:fm-housing", "ministry", "Federal Ministry of Housing & Urban Development", {
    sectorTags: ["land", "housing", "real_estate"],
    bio: "Federal ministry for housing and urban development (lands/housing role structure).",
    influenceArea: "Federal housing programmes; land-reform convening with states.",
    lobbyAngle: "Tie land digitization to federal housing programme delivery and title collateral.",
  }),
  stk("stk:cbn", "agency", "Central Bank of Nigeria", {
    sectorTags: ["fintech", "payments", "banking", "fx"],
    bio: "Apex bank; licenses and supervises payment service providers (PSSP/PTSP), sets capital thresholds.",
    influenceArea: "Payments licensing, FX rules, AML/CFT supervision of payment providers.",
    lobbyAngle: "Formal licensing engagement; propose tourism-receipts reporting pilot.",
  }),
  stk("stk:nitda", "agency", "National Information Technology Development Agency", {
    sectorTags: ["technology", "digital_economy", "data"],
    bio: "IT development regulator; startup ecosystem support; government IT standards.",
    influenceArea: "IT standards, startup support programmes, e-government guidelines.",
    lobbyAngle: "Standards endorsement and ecosystem programme inclusion.",
  }),
  stk("stk:ntdc", "agency", "Nigerian Tourism Development Corporation", {
    sectorTags: ["tourism"],
    bio: "Federal tourism development and promotion corporation under the NTDC Act.",
    influenceArea: "Tourism product development and promotion; state tourism board coordination.",
    lobbyAngle: "Co-develop digital tourism payment acceptance with state tourism boards.",
  }),
  stk("stk:nipc", "agency", "Nigerian Investment Promotion Commission", {
    sectorTags: ["investment", "digital_economy"],
    bio: "Investment promotion agency; pioneer-status incentives and one-stop investment centre.",
    influenceArea: "Investment incentives, foreign-investor facilitation.",
    lobbyAngle: "Pioneer-status and OSIC facilitation for platform investors.",
  }),
  stk("stk:smedan", "agency", "Small and Medium Enterprises Development Agency of Nigeria", {
    sectorTags: ["sme", "tourism", "digital_economy"],
    bio: "SME development agency; MSME formalization and capacity programmes.",
    influenceArea: "SME onboarding channels for tourism merchants and agents.",
    lobbyAngle: "Bundle merchant onboarding with SMEDAN MSME programmes.",
  }),
  stk("stk:nimc", "agency", "National Identity Management Commission", {
    sectorTags: ["identity", "digital_economy", "land"],
    bio: "National identity registry (NIN); licensed identity verification services.",
    influenceArea: "Identity verification rails for KYC and registry-user identity proofing.",
    lobbyAngle: "Licensed NIN verification integration for platform KYC.",
  }),
  stk("stk:ndpc", "agency", "Nigeria Data Protection Commission", {
    sectorTags: ["data", "privacy", "technology"],
    bio: "Data protection regulator under the NDPA 2023; data-controller registration and enforcement.",
    influenceArea: "Data-controller/processor registration, compliance audits, cross-border transfers.",
    lobbyAngle: "Register early as data controller; publish privacy-by-design posture.",
  }),
  stk("stk:nibss", "agency", "Nigeria Inter-Bank Settlement System", {
    sectorTags: ["fintech", "payments"],
    bio: "Central switching and shared payments infrastructure owned by the CBN and licensed banks.",
    influenceArea: "NIBSS integration (NIP, e-bills) is a de facto requirement for payment platforms.",
    lobbyAngle: "Technical integration engagement via CBN-licensed sponsor banks.",
  }),
  stk("stk:cac", "agency", "Corporate Affairs Commission", {
    sectorTags: ["sme", "investment"],
    bio: "Companies registry; incorporation and post-incorporation compliance.",
    influenceArea: "Entity incorporation is step zero for any licensing pathway.",
    lobbyAngle: "Use CAC e-incorporation rails; keep filings current ahead of license applications.",
  }),
  stk("stk:scuml", "agency", "Special Control Unit Against Money Laundering (SCUML, EFCC)", {
    sectorTags: ["aml", "fintech", "real_estate"],
    bio: "Registers and supervises designated non-financial businesses and professions for AML/CFT.",
    influenceArea: "SCUML registration required for DNFBPs (incl. real estate) handling cash-linked flows.",
    lobbyAngle: "Proactive SCUML registration signals AML/CFT maturity.",
  }),
  stk("stk:osgof", "agency", "Office of the Surveyor-General of the Federation (OSGoF)", {
    sectorTags: ["land", "survey", "geospatial"],
    bio: "Federal geodetic and cadastral standards authority; coordinates state surveyors-general.",
    influenceArea: "National survey standards any cadastral platform must comply with.",
    lobbyAngle: "Standards-alignment MoU; position platform as OSGoF-compliant infrastructure.",
  }),
  stk("stk:lagos-lands-bureau", "state_body", "Lagos State Lands Bureau", {
    state: "Lagos",
    sectorTags: ["land", "real_estate"],
    bio: "Lagos land registry administration; runs the state's lands digitization programme.",
    influenceArea: "Operational owner of Lagos registry digitization; MOU counterpart.",
    lobbyAngle: "Operational pilot MOU with measurable throughput and revenue metrics.",
  }),
  stk("stk:kaduna-kadgis", "state_body", "Kaduna Geographic Information Service (KADGIS)", {
    state: "Kaduna",
    sectorTags: ["land", "geospatial"],
    bio: "Kaduna's GIS-driven land administration agency; leads title recertification.",
    influenceArea: "Operational owner of Kaduna digitized land administration.",
    lobbyAngle: "Integration pilot building on the recertification dataset.",
  }),
  stk("stk:ngf", "state_body", "Nigeria Governors' Forum", {
    sectorTags: ["land", "intergovernmental"],
    bio: "Forum of the 36 state governors; peer-learning and policy-diffusion platform.",
    influenceArea: "Scale channel for state-by-state adoption after pilot proof points.",
    lobbyAngle: "Present pilot ROI at NGF peer-review sessions to trigger multi-state adoption.",
  }),
  stk("stk:algon", "association", "Association of Local Governments of Nigeria (ALGON)", {
    sectorTags: ["land", "intergovernmental", "sme"],
    bio: "Umbrella body of the 774 LGAs; grassroots land-tenure interface.",
    influenceArea: "LGA-level customary tenure and land-charge touchpoints.",
    lobbyAngle: "Engage on customary-tenure data capture and LGA revenue assurance.",
  }),
];

/* ------------------------------------------------------------------ */
/* Associations                                                         */
/* ------------------------------------------------------------------ */

export const ADVOCACY_ASSOCIATIONS: Stk[] = [
  stk("stk:fintechngr", "association", "Fintech Association of Nigeria (FintechNGR)", {
    sectorTags: ["fintech", "payments", "startups"],
    bio: "Umbrella fintech industry body; runs policy advocacy with CBN and NASS.",
    influenceArea: "Collective industry voice on licensing thresholds and sandbox design.",
    lobbyAngle: "Co-sponsor position papers; join relevant FintechNGR working groups.",
  }),
  stk("stk:nanta", "association", "National Association of Nigeria Travel Agencies (NANTA)", {
    sectorTags: ["tourism", "travel"],
    bio: "Travel agents' association; downstream distribution for tourism payments.",
    influenceArea: "Merchant/agent adoption channel for tourism payment products.",
    lobbyAngle: "Co-design agent onboarding and commission-settlement flows.",
  }),
  stk("stk:nesg", "association", "Nigeria Economic Summit Group (NESG)", {
    sectorTags: ["investment", "digital_economy"],
    bio: "Private-sector think-tank; convenes the annual Nigerian Economic Summit with government.",
    influenceArea: "High-level policy convening and evidence-based advocacy.",
    lobbyAngle: "Feature pilot evidence in NES summit sessions and policy briefs.",
  }),
  stk("stk:man", "association", "Manufacturers Association of Nigeria (MAN)", {
    sectorTags: ["manufacturing", "investment"],
    bio: "Manufacturers' umbrella body; strong NASS and executive advocacy machinery.",
    influenceArea: "Cross-sector advocacy weight; payment-cost and FX concerns of members.",
    lobbyAngle: "Align payment-cost reduction arguments with MAN member priorities.",
  }),
  stk("stk:naccima", "association", "Nigerian Association of Chambers of Commerce, Industry, Mines & Agriculture (NACCIMA)", {
    sectorTags: ["commerce", "sme", "investment"],
    bio: "Federation of chambers of commerce; broad SME and trade constituency.",
    influenceArea: "Grassroots business mobilization and chamber networks in all states.",
    lobbyAngle: "Use state chambers to surface state-level tourism and land pain points.",
  }),
  stk("stk:ntda", "association", "Nigerian Tourism Development Association", {
    sectorTags: ["tourism", "travel"],
    bio: "Private-sector tourism development association; operators and destination stakeholders.",
    influenceArea: "Operator-side advocacy for tourism digitalization.",
    lobbyAngle: "Co-publish tourism digitalization gap analyses with pilot states.",
  }),
  stk("stk:niesv", "association", "Nigerian Institution of Estate Surveyors & Valuers (NIESV)", {
    sectorTags: ["land", "real_estate", "valuation"],
    bio: "Professional body for estate surveyors and valuers; title and valuation practice standards.",
    influenceArea: "Professional buy-in is critical for land-registry reform credibility.",
    lobbyAngle: "Co-design practitioner workflows so digitization augments (not replaces) members.",
  }),
  stk("stk:surcon", "agency", "Surveyors Council of Nigeria (SURCON)", {
    sectorTags: ["land", "survey", "geospatial"],
    bio: "Statutory regulator of the surveying profession (also functions as the professional gatekeeper).",
    influenceArea: "Survey standards and licensed-surveyor compliance for cadastral platforms.",
    lobbyAngle: "Formal standards-compliance engagement; SURCON endorsement de-risks state MOUs.",
  }),
];

export const ADVOCACY_STAKEHOLDERS: Stk[] = [
  ...ADVOCACY_INDIVIDUALS,
  ...ADVOCACY_COMMITTEES,
  ...ADVOCACY_MINISTRIES_AGENCIES,
  ...ADVOCACY_ASSOCIATIONS,
];

/* ------------------------------------------------------------------ */
/* Relation graph — committee oversees ministry/agency; association    */
/* lobbies committee; agency regulates sector; state body domesticates  */
/* federal law. Stored as directed edges (fromId, toId, relation).      */
/* ------------------------------------------------------------------ */

export type EdgeSeed = { fromId: string; toId: string; relation: string; label?: string };

export const ADVOCACY_EDGES: EdgeSeed[] = [
  // Oversight: committees → ministries/agencies
  { fromId: "stk:senate-cte-banking", toId: "stk:cbn", relation: "oversees", label: "Senate oversight of CBN" },
  { fromId: "stk:house-cte-banking", toId: "stk:cbn", relation: "oversees", label: "House oversight of CBN" },
  { fromId: "stk:senate-cte-tourism", toId: "stk:fm-tourism", relation: "oversees" },
  { fromId: "stk:senate-cte-tourism", toId: "stk:ntdc", relation: "oversees" },
  { fromId: "stk:house-cte-tourism", toId: "stk:fm-tourism", relation: "oversees" },
  { fromId: "stk:senate-cte-lands", toId: "stk:fm-housing", relation: "oversees" },
  { fromId: "stk:house-cte-housing", toId: "stk:fm-housing", relation: "oversees" },
  { fromId: "stk:senate-cte-ict", toId: "stk:nitda", relation: "oversees" },
  { fromId: "stk:senate-cte-ict", toId: "stk:ndpc", relation: "oversees" },
  { fromId: "stk:house-cte-ict", toId: "stk:fm-comms-digital", relation: "oversees" },
  { fromId: "stk:lagos-assembly-lands-cte", toId: "stk:lagos-lands-bureau", relation: "oversees" },
  { fromId: "stk:kaduna-assembly-lands-cte", toId: "stk:kaduna-kadgis", relation: "oversees" },

  // Leadership: individuals → orgs
  { fromId: "stk:cbn-governor", toId: "stk:cbn", relation: "chairs", label: "Governor of the CBN" },
  { fromId: "stk:minister-comms-digital", toId: "stk:fm-comms-digital", relation: "chairs", label: "Minister" },
  { fromId: "stk:minister-tourism", toId: "stk:fm-tourism", relation: "chairs", label: "Minister" },
  { fromId: "stk:nitda-dg", toId: "stk:nitda", relation: "chairs", label: "Director-General" },
  { fromId: "stk:nimc-dg", toId: "stk:nimc", relation: "chairs", label: "DG/CEO" },
  { fromId: "stk:ndpc-commissioner", toId: "stk:ndpc", relation: "chairs", label: "National Commissioner" },
  { fromId: "stk:cbn-payments-director", toId: "stk:cbn", relation: "member_of", label: "Payments System Supervision Dept" },
  { fromId: "stk:surcon-registrar", toId: "stk:surcon", relation: "member_of", label: "Registrar" },
  { fromId: "stk:lagos-lands-commissioner", toId: "stk:lagos-lands-bureau", relation: "chairs", label: "Commissioner oversight" },
  { fromId: "stk:kaduna-lands-commissioner", toId: "stk:kaduna-kadgis", relation: "chairs", label: "Commissioner oversight" },
  { fromId: "stk:fct-land-admin-director", toId: "stk:senate-cte-lands", relation: "member_of", label: "FCT lands under Senate lands oversight remit" },

  // Associations lobby committees / agencies
  { fromId: "stk:fintechngr", toId: "stk:senate-cte-banking", relation: "lobbies", label: "Fintech policy advocacy" },
  { fromId: "stk:fintechngr", toId: "stk:cbn", relation: "lobbies", label: "Licensing threshold advocacy" },
  { fromId: "stk:nanta", toId: "stk:senate-cte-tourism", relation: "lobbies" },
  { fromId: "stk:ntda", toId: "stk:senate-cte-tourism", relation: "lobbies" },
  { fromId: "stk:nesg", toId: "stk:senate-cte-ict", relation: "lobbies", label: "Digital economy policy briefs" },
  { fromId: "stk:man", toId: "stk:house-cte-banking", relation: "lobbies", label: "Payment cost & FX advocacy" },
  { fromId: "stk:naccima", toId: "stk:house-cte-ict", relation: "lobbies" },
  { fromId: "stk:niesv", toId: "stk:lagos-assembly-lands-cte", relation: "lobbies", label: "Land reform practice input" },
  { fromId: "stk:niesv", toId: "stk:kaduna-assembly-lands-cte", relation: "lobbies" },

  // Agencies regulate sectors/stakeholders
  { fromId: "stk:cbn", toId: "stk:nibss", relation: "regulates", label: "Owns/supervises shared switch" },
  { fromId: "stk:cbn", toId: "stk:fintechngr", relation: "regulates", label: "Licenses member PSPs" },
  { fromId: "stk:ndpc", toId: "stk:fintechngr", relation: "regulates", label: "NDPA enforcement over members" },
  { fromId: "stk:nitda", toId: "stk:fm-comms-digital", relation: "member_of", label: "Agency under the ministry" },
  { fromId: "stk:ntdc", toId: "stk:fm-tourism", relation: "member_of", label: "Corporation under the ministry" },
  { fromId: "stk:surcon", toId: "stk:osgof", relation: "oversees", label: "Professional standards over survey practice" },
  { fromId: "stk:scuml", toId: "stk:niesv", relation: "regulates", label: "AML/CFT registration of DNFBP members" },

  // State bodies domesticate federal law / standards
  { fromId: "stk:lagos-lands-bureau", toId: "stk:fm-housing", relation: "domesticates", label: "Land Use Act administration (state)" },
  { fromId: "stk:kaduna-kadgis", toId: "stk:fm-housing", relation: "domesticates", label: "Land Use Act administration (state)" },
  { fromId: "stk:lagos-assembly-lands-cte", toId: "stk:senate-cte-lands", relation: "domesticates", label: "State land law analogue" },
  { fromId: "stk:ngf", toId: "stk:fm-housing", relation: "lobbies", label: "State-federal land reform channel" },
  { fromId: "stk:algon", toId: "stk:ngf", relation: "member_of", label: "LGA interface to governors" },
];

/* ------------------------------------------------------------------ */
/* Regulatory pathways                                                  */
/* ------------------------------------------------------------------ */

type Pw = typeof schema.regulatoryPathways.$inferInsert;

export const ADVOCACY_PATHWAYS: Pw[] = [
  {
    pathwayId: "pw:ng-fintech-tourism-payments",
    sector: "fintech",
    title: "Fintech payments for tourism (Nigeria)",
    summary:
      "Regulatory route to operate a payment platform serving Nigerian tourism merchants (hotels, tour operators, travel agents): CBN payments licensing, NIBSS integration, NDPA data-controller registration and state-by-state tourism-board onboarding.",
    jurisdictionScope: "both",
    licenses: [
      {
        name: "Payment Solution Service Provider (PSSP) license",
        issuer: "Central Bank of Nigeria",
        requirement: "CBN licensing under the payments-system licensing framework; minimum paid-up capital per CBN category thresholds (historically ₦100m for PSSP — confirm current circular) plus fit-and-proper promoters.",
        typical_timeline: "6–18 months (AIP → final license)",
        cost_note: "Application + capital requirement; verify current CBN threshold circulars.",
      },
      {
        name: "Payment Terminal Service Provider (PTSP) license (if deploying POS)",
        issuer: "Central Bank of Nigeria",
        requirement: "Separate CBN category for terminal deployment; higher capital threshold (historically ₦100m+) and PoS terminal certification.",
        typical_timeline: "6–12 months",
        cost_note: "Only needed for physical acceptance at hotels/attractions.",
      },
      {
        name: "NIBSS integration / settlement participation",
        issuer: "NIBSS (via CBN-licensed sponsor bank)",
        requirement: "Technical certification for NIP/e-bills rails; sponsor-bank settlement arrangement.",
        typical_timeline: "2–4 months post-CBN AIP",
        cost_note: "Certification and integration fees via sponsor bank.",
      },
      {
        name: "Data controller/processor registration",
        issuer: "Nigeria Data Protection Commission (NDPC)",
        requirement: "Registration as data controller of major importance under NDPA 2023; DPIA for payment + traveller data; DPO appointment.",
        typical_timeline: "1–3 months, renewable annually",
        cost_note: "Registration fee banded by turnover; audit obligations.",
      },
      {
        name: "PCI-DSS certification",
        issuer: "PCI Security Standards Council (via QSA)",
        requirement: "Card-data security certification for card acceptance flows.",
        typical_timeline: "3–9 months",
        cost_note: "QSA assessment + remediation costs.",
      },
      {
        name: "SCUML registration (where applicable)",
        issuer: "SCUML / EFCC",
        requirement: "AML/CFT registration where the business model touches designated non-financial business flows (e.g. travel agency settlement).",
        typical_timeline: "2–6 weeks",
        cost_note: "Registration only; ongoing reporting obligations.",
      },
    ],
    constraints: [
      { type: "capital", description: "CBN minimum paid-up capital thresholds per license category; thresholds revised by circular.", severity: "high" },
      { type: "fx", description: "FX rules on tourism receipts and cross-border settlement; repatriation and Naira-settlement directives shift frequently.", severity: "high" },
      { type: "fragmentation", description: "State tourism levies and board registrations are fragmented across states; no single national onboarding.", severity: "medium" },
      { type: "aml_cft", description: "AML/CFT obligations (KYC tiers, transaction monitoring, STR filing) under BOFIA 2020 and MLPPA 2022.", severity: "high" },
      { type: "data_protection", description: "NDPA 2023 consent, residency and breach-notification duties for traveller personal data.", severity: "medium" },
    ],
    supportingLawRefs: [
      { ref: "law:ng-cbn-act", title: "Central Bank of Nigeria Act 2007", relevance: "CBN's licensing and payments-system supervision mandate." },
      { ref: "law:ng-bofia-2020", title: "Banks and Other Financial Institutions Act (BOFIA) 2020", relevance: "Licensing perimeter for payment service providers; AML/CFT duties." },
      { ref: "law:ng-ndpa-2023", title: "Nigeria Data Protection Act 2023", relevance: "Data-controller registration and traveller-data protection." },
      { ref: "law:ng-startup-act-2022", title: "Nigeria Startup Act 2022", relevance: "Startup label benefits: regulatory support, incentives, sandbox access." },
      { ref: "law:ng-ntdc-act", title: "Nigerian Tourism Development Corporation Act", relevance: "Federal tourism promotion framework and state tourism-board interfaces." },
    ],
    associationRefs: ["stk:fintechngr", "stk:nanta", "stk:ntda"],
    steps: [
      { step: "1", owner: "Founders / counsel", description: "Incorporate at CAC; structure shareholding to satisfy CBN fit-and-proper tests.", est_duration: "2–4 weeks" },
      { step: "2", owner: "Compliance lead", description: "NDPC data-controller registration, DPO appointment and DPIA for traveller data.", est_duration: "1–3 months" },
      { step: "3", owner: "Founders + FintechNGR", description: "CBN PSSP license application (pre-approval/AIP); engage FintechNGR working groups on thresholds.", est_duration: "6–18 months" },
      { step: "4", owner: "Engineering + sponsor bank", description: "NIBSS integration and settlement arrangement via CBN-licensed sponsor bank.", est_duration: "2–4 months" },
      { step: "5", owner: "Business development + NANTA/NTDA", description: "Pilot with 2–3 state tourism boards and NANTA agents; SCUML registration where applicable.", est_duration: "3–6 months" },
      { step: "6", owner: "Policy lead", description: "Scale via FM Tourism/NTDC convening; publish pilot evidence with NESG for national uptake.", est_duration: "ongoing" },
    ],
    origin: "derived",
  },
  {
    pathwayId: "pw:ng-land-management-platform",
    sector: "land",
    title: "Digital land-management platform (state-by-state)",
    summary:
      "The Land Use Act 1978 vests land administration in state governors, so a land digitization platform must be adopted state by state: registry digitization MOUs, SURCON/OSGoF survey-standards compliance, NIN identity integration and NDPA registration — piloted in progressive states (Lagos, Kaduna precedents) then scaled via the Governors' Forum.",
    jurisdictionScope: "state",
    licenses: [
      {
        name: "State land registry digitization MOU / concession",
        issuer: "State Lands Bureau / GIS agency (e.g. Lagos Lands Bureau, KADGIS)",
        requirement: "Executive MOU or PPP concession with the state land authority; usually after a pilot demonstrating throughput and revenue-assurance gains.",
        typical_timeline: "3–12 months per state",
        cost_note: "Negotiated; often revenue-share on registry fees.",
      },
      {
        name: "Survey standards compliance (SURCON / OSGoF)",
        issuer: "Surveyors Council of Nigeria / Office of the Surveyor-General of the Federation",
        requirement: "Cadastral and geodetic standards compliance; licensed surveyors in the workflow (Surveyors Registration Council Act).",
        typical_timeline: "1–3 months alignment; ongoing",
        cost_note: "Standards alignment + licensed-surveyor engagement costs.",
      },
      {
        name: "NIN identity verification integration",
        issuer: "NIMC",
        requirement: "Licensed NIN verification for registry-user identity proofing under the NIMC Act framework.",
        typical_timeline: "1–2 months",
        cost_note: "Per-verification fees via licensed channels.",
      },
      {
        name: "Data controller registration",
        issuer: "Nigeria Data Protection Commission (NDPC)",
        requirement: "NDPA 2023 registration; DPIA covering land-title and personal identity data; state data-protection law checks (e.g. Lagos).",
        typical_timeline: "1–3 months",
        cost_note: "Registration + annual audit obligations.",
      },
    ],
    constraints: [
      { type: "constitutional", description: "Land Use Act 1978: governor consent required for title transfers; platform cannot shortcut the consent process.", severity: "high" },
      { type: "fragmentation", description: "36-state fragmentation: each state has its own land administration law, registry practice and fee schedule.", severity: "high" },
      { type: "customary_tenure", description: "Customary tenure and family land claims are largely undocumented; digitization must handle contested titles.", severity: "high" },
      { type: "capacity", description: "State land bureaucracy capacity varies widely; digitization projects fail without change-management and staff buy-in.", severity: "medium" },
      { type: "data_protection", description: "Title and identity data are sensitive; NDPA duties plus state-level data rules (e.g. Lagos) apply.", severity: "medium" },
    ],
    supportingLawRefs: [
      { ref: "law:ng-lua-1978", title: "Land Use Act 1978", relevance: "Constitutional foundation: state governors hold land in trust; consent regime." },
      { ref: "law:ng-state-land-admin", title: "State land administration laws (e.g. Lagos lands digitization precedent)", relevance: "Each adoption state needs its own enabling instrument or MOU." },
      { ref: "law:ng-evidence-act-2011", title: "Evidence Act 2011 (electronic records provisions)", relevance: "Admissibility of digitized titles and electronic registry records." },
      { ref: "law:ng-ndpa-2023", title: "Nigeria Data Protection Act 2023", relevance: "Protection of title-holder personal data and identity integrations." },
      { ref: "law:ng-surcon-act", title: "Surveyors Registration Council of Nigeria Act", relevance: "Licensed-surveyor role and cadastral standards in digitized workflows." },
    ],
    associationRefs: ["stk:niesv", "stk:surcon", "stk:algon"],
    steps: [
      { step: "1", owner: "Founders + NIESV/SURCON", description: "Standards alignment with SURCON/OSGoF; co-design licensed-surveyor workflows with NIESV.", est_duration: "1–3 months" },
      { step: "2", owner: "Policy lead", description: "Select 1–2 progressive pilot states (Lagos/Kaduna precedent); NDPC registration and DPIA.", est_duration: "1–2 months" },
      { step: "3", owner: "Executive sponsor", description: "State executive MOU with Lands Bureau / GIS agency; define pilot KPIs (processing time, revenue assurance).", est_duration: "3–6 months" },
      { step: "4", owner: "Legal + state assembly liaison", description: "State assembly enabling bill via the lands committee where statutory backing is needed.", est_duration: "6–18 months" },
      { step: "5", owner: "Engineering + NIMC", description: "NIN verification integration and registry go-live in the pilot state.", est_duration: "3–9 months" },
      { step: "6", owner: "Policy lead", description: "Scale via Nigeria Governors' Forum and ALGON peer-review channels; replicate to further states.", est_duration: "ongoing" },
    ],
    origin: "derived",
  },
];

/* ------------------------------------------------------------------ */
/* Upsert (idempotent: natural keys; edges deduped on from/to/relation) */
/* ------------------------------------------------------------------ */

async function ensureStakeholders(rows: Stk[]) {
  const existing = await db
    .select({ id: schema.stakeholders.stakeholderId })
    .from(schema.stakeholders);
  const have = new Set(existing.map((r) => r.id));
  const missing = rows.filter((r) => !have.has(r.stakeholderId!));
  if (missing.length > 0) await db.insert(schema.stakeholders).values(missing);
  console.log(`  stakeholders: ${missing.length} inserted, ${have.size} existing`);
}

async function ensureEdges(rows: EdgeSeed[]) {
  const existing = await db
    .select({
      fromId: schema.stakeholderEdges.fromId,
      toId: schema.stakeholderEdges.toId,
      relation: schema.stakeholderEdges.relation,
    })
    .from(schema.stakeholderEdges);
  const have = new Set(existing.map((e) => `${e.fromId}|${e.toId}|${e.relation}`));
  const missing = rows.filter((e) => !have.has(`${e.fromId}|${e.toId}|${e.relation}`));
  if (missing.length > 0) await db.insert(schema.stakeholderEdges).values(missing);
  console.log(`  stakeholder_edges: ${missing.length} inserted, ${have.size} existing`);
}

async function ensurePathways(rows: Pw[]) {
  const existing = await db
    .select({ id: schema.regulatoryPathways.pathwayId })
    .from(schema.regulatoryPathways);
  const have = new Set(existing.map((r) => r.id));
  const missing = rows.filter((r) => !have.has(r.pathwayId!));
  if (missing.length > 0) await db.insert(schema.regulatoryPathways).values(missing);
  console.log(`  regulatory_pathways: ${missing.length} inserted, ${have.size} existing`);
}

export async function seedAdvocacy() {
  console.log("Seeding Policy Advocacy Pathway KB (idempotent)...");
  await ensureStakeholders(ADVOCACY_STAKEHOLDERS);
  await ensureEdges(ADVOCACY_EDGES);
  await ensurePathways(ADVOCACY_PATHWAYS);
  console.log("Done.");
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /seed-advocacy\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  seedAdvocacy()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
