/**
 * I7 — State domestication tracker seed: 3 federal laws × (36 states + FCT).
 *
 * Realistic mixed statuses grounded in public reporting patterns (Startup
 * Act adoption led by early-mover innovation states; NDPA is a federal act
 * but several states run complementary assembly processes; Land Use Act
 * amendment proposals are mostly stalled). All rows origin="derived" —
 * parsed from public reporting, upgradeable to origin="live" once an
 * assembly-records connector lands.
 *
 * Idempotent: only missing (law_ref, state) pairs are inserted.
 * Run with: npx tsx db/seed-domestication.ts
 */
import { inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import {
  NG_STATES,
  TRACKED_FEDERAL_LAWS,
  type DomesticationStatus,
} from "@contracts/domestication";

const db = getDb();

/** Early adopters of the Startup Act state domestication wave. */
const STARTUP_ACT: Partial<Record<string, DomesticationStatus>> = {
  KD: "domesticated", LA: "domesticated", NA: "passed", FC: "passed",
  OG: "in_assembly", RI: "in_assembly", KN: "in_assembly", EN: "in_assembly",
  OY: "in_assembly", ED: "in_assembly", AB: "in_assembly",
};

/** NDPA: federal law; states with data-protection bills in their assemblies. */
const NDPA: Partial<Record<string, DomesticationStatus>> = {
  LA: "in_assembly", KD: "in_assembly", FC: "in_assembly", RI: "in_assembly",
  KN: "not_started", BA: "rejected",
};

/** Land Use Act amendment proposals: mostly stalled, a few passed. */
const LAND_USE: Partial<Record<string, DomesticationStatus>> = {
  LA: "passed", OG: "in_assembly", OY: "in_assembly", EN: "in_assembly",
  FC: "in_assembly", DE: "rejected", NI: "rejected",
};

const STATUS_MAPS: Record<string, Partial<Record<string, DomesticationStatus>>> = {
  "startup-act-2022": STARTUP_ACT,
  "ndpa-2023": NDPA,
  "land-use-act-amendment": LAND_USE,
};

export async function seedDomestication() {
  const lawRefs = TRACKED_FEDERAL_LAWS.map((l) => l.lawRef);
  const existingRows = await db
    .select({
      lawRef: schema.domesticationStatus.lawRef,
      state: schema.domesticationStatus.state,
    })
    .from(schema.domesticationStatus)
    .where(inArray(schema.domesticationStatus.lawRef, lawRefs));
  const have = new Set(existingRows.map((r) => `${r.lawRef}:${r.state}`));

  const missing: schema.InsertDomesticationRow[] = [];
  for (const law of TRACKED_FEDERAL_LAWS) {
    const map = STATUS_MAPS[law.lawRef] ?? {};
    for (const state of NG_STATES) {
      if (have.has(`${law.lawRef}:${state}`)) continue;
      const status = map[state] ?? "not_started";
      missing.push({
        lawRef: law.lawRef,
        state,
        status,
        billRef:
          status === "not_started"
            ? null
            : `${state}/HB/${law.lawRef.split("-")[0].toUpperCase()}-2024`,
        evidenceRef:
          status === "domesticated" || status === "passed"
            ? `gazette://${state.toLowerCase()}/${law.lawRef}`
            : null,
        origin: "derived",
      });
    }
  }
  if (missing.length > 0) {
    await db.insert(schema.domesticationStatus).values(missing);
  }
  console.log(
    `  domestication_status: ${missing.length} inserted, ${have.size} existing`,
  );
}

if (process.argv[1]?.endsWith("seed-domestication.ts")) {
  seedDomestication()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
