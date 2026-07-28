/**
 * Idempotent e2e identity seed — creates the two actors the e2e suite and the
 * advisory k6 profile use:
 *
 *   e2e-analyst   platform_role=policy_analyst, write grant on jur:ng-kd
 *   e2e-executive role=admin (→ executive, jurisdiction-global sign-off rights)
 *
 * Run with: npx tsx tests/e2e/seed-users.ts   (requires DATABASE_URL)
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../api/queries/connection";
import * as schema from "../../db/schema";

const db = getDb();

async function upsertUser(unionId: string, fields: Partial<schema.InsertUser>) {
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId));
  if (existing.length === 0) {
    await db.insert(schema.users).values({
      unionId,
      name: unionId,
      lastSignInAt: new Date(),
      ...fields,
    });
  } else if (Object.keys(fields).length > 0) {
    await db.update(schema.users).set(fields).where(eq(schema.users.unionId, unionId));
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.unionId, unionId));
  return user;
}

async function main() {
  const analyst = await upsertUser("e2e-analyst", { platformRole: "policy_analyst" });
  const executive = await upsertUser("e2e-executive", {
    role: "admin",
    platformRole: "executive",
  });

  const sim = await upsertUser("e2e-sim", { platformRole: "simulation_specialist" });

  // Analyst + sim specialist get explicit write grants on the pilot jurisdiction (ABAC).
  for (const u of [analyst, sim]) {
    const grant = await db
      .select()
      .from(schema.userJurisdictions)
      .where(eq(schema.userJurisdictions.userId, Number(u.id)));
    if (!grant.some((g) => g.jurisdictionId === "jur:ng-kd")) {
      await db.insert(schema.userJurisdictions).values({
        userId: Number(u.id),
        jurisdictionId: "jur:ng-kd",
        accessLevel: "write",
      });
    }
  }

  console.log(
    `seeded e2e users: analyst id=${analyst.id}, executive id=${executive.id}, sim id=${sim.id}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
