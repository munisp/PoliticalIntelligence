/**
 * Unified seed (audit gap #31): runs every idempotent seed in dependency
 * order against DATABASE_URL.
 *
 *   1. db/seed.ts              — Nigeria pilot essentials (jurisdictions,
 *                                sectors, canonical rows, users, policies)
 *   2. db/seed-advocacy.ts     — Policy Advocacy Pathway KB (stakeholders,
 *                                edges, regulatory pathways)
 *   3. db/seed-lagos-calabar.ts — Lagos–Calabar coastal-highway corridor
 *                                scenario template + budget line
 *
 * Run with: npm run db:seed:all
 */
import { seed } from "./seed";
import { seedAdvocacy } from "./seed-advocacy";
import { seedLagosCalabar } from "./seed-lagos-calabar";

async function seedAll() {
  console.log("== seed-all: essentials (db/seed.ts) ==");
  await seed();
  console.log("== seed-all: advocacy KB (db/seed-advocacy.ts) ==");
  await seedAdvocacy();
  console.log("== seed-all: lagos-calabar corridor (db/seed-lagos-calabar.ts) ==");
  await seedLagosCalabar();
  console.log("seed-all: done.");
}

seedAll()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-all failed:", err);
    process.exit(1);
  });
