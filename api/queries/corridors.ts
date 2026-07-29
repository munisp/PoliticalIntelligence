import { asc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function milestonesForCorridor(
  corridorId: string,
): Promise<schema.CorridorMilestone[]> {
  return getDb()
    .select()
    .from(schema.corridorMilestones)
    .where(eq(schema.corridorMilestones.corridorId, corridorId))
    .orderBy(asc(schema.corridorMilestones.plannedDate));
}

/** Distinct corridor ids (for listing). */
export async function listCorridorIds(): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ corridorId: schema.corridorMilestones.corridorId })
    .from(schema.corridorMilestones);
  return rows.map((r) => r.corridorId);
}
