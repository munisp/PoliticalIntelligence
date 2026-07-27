import { desc, lt, and, eq, like } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function insertAuditEvent(
  row: typeof schema.auditEvents.$inferInsert,
) {
  await getDb().insert(schema.auditEvents).values(row);
}

/** Cursor = last seen eventId (keyset, newest first). Append-only table. */
export async function listAuditEvents(filters: {
  entityType?: string;
  actorId?: number;
  cursor?: number;
  limit: number;
}) {
  const conds = [];
  if (filters.entityType)
    conds.push(eq(schema.auditEvents.entityType, filters.entityType));
  if (filters.actorId)
    conds.push(eq(schema.auditEvents.actorId, filters.actorId));
  if (filters.cursor)
    conds.push(lt(schema.auditEvents.eventId, filters.cursor));
  const rows = await getDb()
    .select()
    .from(schema.auditEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.auditEvents.eventId))
    .limit(filters.limit + 1);
  const items = rows.slice(0, filters.limit);
  return {
    items,
    next_cursor:
      rows.length > filters.limit
        ? String(items[items.length - 1].eventId)
        : null,
  };
}

/** Export history for an entity (actions recorded as `<domain>.exported`). */
export async function listExportEvents(entityType: string, entityId: string) {
  return getDb()
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.entityType, entityType),
        eq(schema.auditEvents.entityId, entityId),
        like(schema.auditEvents.action, "%.exported"),
      ),
    )
    .orderBy(desc(schema.auditEvents.createdAt));
}
