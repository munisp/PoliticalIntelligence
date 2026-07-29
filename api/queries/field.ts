import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function insertVerification(row: {
  verificationId: string;
  entityType: string;
  entityRef: string;
  verifierId: number;
  gpsLat: number;
  gpsLng: number;
  photoUri: string | null;
  verdict: schema.FieldVerdict;
  notes: string | null;
}) {
  await getDb().insert(schema.fieldVerifications).values({
    verificationId: row.verificationId,
    entityType: row.entityType,
    entityRef: row.entityRef,
    verifierId: row.verifierId,
    gpsLat: row.gpsLat,
    gpsLng: row.gpsLng,
    photoUri: row.photoUri,
    verdict: row.verdict,
    notes: row.notes,
  });
  return getDb().query.fieldVerifications.findFirst({
    where: eq(schema.fieldVerifications.verificationId, row.verificationId),
  });
}

export async function verificationsFor(
  entityType: string,
  entityRef: string,
  limit = 50,
) {
  return getDb()
    .select()
    .from(schema.fieldVerifications)
    .where(
      and(
        eq(schema.fieldVerifications.entityType, entityType),
        eq(schema.fieldVerifications.entityRef, entityRef),
      ),
    )
    .orderBy(desc(schema.fieldVerifications.createdAt))
    .limit(Math.min(limit, 200));
}

/** Confirmed counts grouped by entityRef for a batch of refs (one query). */
export async function confirmedCounts(
  entityType: string,
  entityRefs: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (entityRefs.length === 0) return out;
  const rows = await getDb()
    .select({
      entityRef: schema.fieldVerifications.entityRef,
    })
    .from(schema.fieldVerifications)
    .where(
      and(
        eq(schema.fieldVerifications.entityType, entityType),
        eq(schema.fieldVerifications.verdict, "confirmed"),
        inArray(schema.fieldVerifications.entityRef, entityRefs),
      ),
    );
  for (const r of rows) out.set(r.entityRef, (out.get(r.entityRef) ?? 0) + 1);
  return out;
}
