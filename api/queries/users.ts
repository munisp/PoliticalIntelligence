import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...data,
  };

  if (
    values.role === undefined &&
    values.unionId &&
    values.unionId === env.ownerUnionId
  ) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  await getDb()
    .insert(schema.users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

/* ---------------------- user jurisdictions (ABAC) -------------------- */

export async function jurisdictionsForUser(userId: number) {
  return getDb()
    .select()
    .from(schema.userJurisdictions)
    .where(eq(schema.userJurisdictions.userId, userId));
}

export async function grantJurisdiction(
  row: typeof schema.userJurisdictions.$inferInsert,
) {
  await getDb()
    .insert(schema.userJurisdictions)
    .values(row)
    .onDuplicateKeyUpdate({ set: { accessLevel: row.accessLevel } });
}
