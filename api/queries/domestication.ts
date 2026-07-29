import { and, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function rowsForLaw(lawRef: string) {
  return getDb()
    .select()
    .from(schema.domesticationStatus)
    .where(eq(schema.domesticationStatus.lawRef, lawRef));
}

export async function findCell(lawRef: string, state: string) {
  return getDb().query.domesticationStatus.findFirst({
    where: and(
      eq(schema.domesticationStatus.lawRef, lawRef),
      eq(schema.domesticationStatus.state, state),
    ),
  });
}

/** Upsert one (law_ref, state) cell — update wins over the seed default. */
export async function upsertCell(row: {
  lawRef: string;
  state: string;
  status: schema.DomesticationStatus;
  billRef?: string | null;
  evidenceRef?: string | null;
}) {
  const existing = await findCell(row.lawRef, row.state);
  if (existing) {
    await getDb()
      .update(schema.domesticationStatus)
      .set({
        status: row.status,
        billRef: row.billRef ?? existing.billRef,
        evidenceRef: row.evidenceRef ?? existing.evidenceRef,
        // Steward-entered corrections are treated as derived-from-records.
        origin: "derived",
      })
      .where(
        and(
          eq(schema.domesticationStatus.lawRef, row.lawRef),
          eq(schema.domesticationStatus.state, row.state),
        ),
      );
  } else {
    await getDb().insert(schema.domesticationStatus).values({
      lawRef: row.lawRef,
      state: row.state,
      status: row.status,
      billRef: row.billRef ?? null,
      evidenceRef: row.evidenceRef ?? null,
      origin: "derived",
    });
  }
  return findCell(row.lawRef, row.state);
}
