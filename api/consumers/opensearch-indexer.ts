/**
 * OpenSearch indexer consumer (docs/OPENSEARCH.md).
 *
 * Consumes outbox/Kafka events and keeps the search indices in sync with
 * the MySQL canonical tables:
 *  - documents.parse.requested -> re-read the policy_documents row, index
 *  - graph.index.updated       -> refresh the laws/opportunities/stakeholders slice
 *
 * Idempotency: the OpenSearch document id IS the entity id (bulk action
 * "index" upserts), so replayed/duplicated events converge. Failures throw
 * back into the consumer framework (api/utils/events.ts createConsumer),
 * which retries with backoff and dead-letters after 3 attempts.
 *
 * Wired from startConsumers() behind an OPENSEARCH_URL guard — with no
 * OpenSearch configured the indexer is simply not registered.
 */

import { eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import type { DomainEvent } from "../utils/events";
import {
  ensureIndices,
  getClient,
  type BulkOperation,
  type OpenSearchClient,
} from "../search/opensearch";

/* ------------------------- row -> document mappers ---------------------- */

type DocumentRow = typeof schema.policyDocuments.$inferSelect;
type LawRow = typeof schema.laws.$inferSelect;
type OpportunityRow = typeof schema.opportunities.$inferSelect;
type StakeholderRow = typeof schema.stakeholders.$inferSelect;

export function documentToOp(row: DocumentRow): BulkOperation {
  return {
    index: "pt-documents",
    id: row.documentId,
    doc: {
      document_id: row.documentId,
      title: row.title,
      jurisdiction_id: row.jurisdictionId,
      language: row.language,
      doc_type: row.docType,
      review_state: row.reviewState,
      source_uri: row.sourceUri,
      metadata: row.metadata ?? {},
      origin: row.origin,
      created_at: row.createdAt?.toISOString?.() ?? null,
    },
  };
}

export function lawToOp(row: LawRow): BulkOperation {
  return {
    index: "pt-laws",
    id: row.lawId,
    doc: {
      law_id: row.lawId,
      title: row.title,
      jurisdiction_id: row.jurisdictionId,
      category: row.category,
      status: row.status,
      year: row.year,
      source_uri: row.sourceUri,
      created_at: row.createdAt?.toISOString?.() ?? null,
    },
  };
}

export function opportunityToOp(row: OpportunityRow): BulkOperation {
  return {
    index: "pt-opportunities",
    id: row.opportunityId,
    doc: {
      opportunity_id: row.opportunityId,
      title: row.title,
      summary: row.summary,
      jurisdiction_id: row.jurisdictionId,
      sector_code: row.sectorCode,
      score: row.score,
      review_state: row.reviewState,
      horizon_months: row.horizonMonths,
      origin: row.origin,
      created_at: row.createdAt?.toISOString?.() ?? null,
    },
  };
}

export function stakeholderToOp(row: StakeholderRow): BulkOperation {
  return {
    index: "pt-stakeholders",
    id: row.stakeholderId,
    doc: {
      stakeholder_id: row.stakeholderId,
      kind: row.kind,
      name: row.name,
      title: row.title,
      org: row.org,
      state: row.state,
      chamber: row.chamber,
      sector_tags: (row.sectorTags as string[] | null) ?? [],
      bio: row.bio,
      influence_area: row.influenceArea,
      origin: row.origin,
      created_at: row.createdAt?.toISOString?.() ?? null,
    },
  };
}

/* ------------------------------ handler -------------------------------- */

/**
 * Build the event handler. The client is resolved lazily per event so the
 * handler is testable with a mocked client and so a temporarily-down
 * cluster routes events to the DLQ instead of wedging the consumer.
 */
export function createIndexerHandler(opts?: {
  client?: OpenSearchClient;
}): (event: DomainEvent) => Promise<void> {
  return async (event: DomainEvent) => {
    const client = opts?.client ?? getClient();
    if (!client) throw new Error("OPENSEARCH_URL not configured");
    await ensureIndices(client);
    const ops = await opsForEvent(event);
    if (ops.length === 0) return;
    const res = await client.bulk(ops);
    if (res.errors > 0) {
      throw new Error(
        `bulk index partial failure: ${res.errors}/${ops.length} failed for ${event.topic}`,
      );
    }
  };
}

/** Translate an event into bulk operations (canonical rows re-read). */
export async function opsForEvent(event: DomainEvent): Promise<BulkOperation[]> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const db = getDb();
  switch (event.topic) {
    case "documents.parse.requested": {
      const documentId = String(payload.document_id ?? "");
      if (!documentId) return [];
      const rows = await db
        .select()
        .from(schema.policyDocuments)
        .where(eq(schema.policyDocuments.documentId, documentId))
        .limit(1);
      return rows.map(documentToOp);
    }
    case "graph.index.updated": {
      // Refresh the entity slice for the jurisdiction (or a bounded slice
      // when unspecified): laws + opportunities + stakeholders.
      const jurisdictionId = payload.jurisdiction_id
        ? String(payload.jurisdiction_id)
        : null;
      const [laws, opportunities, stakeholders] = await Promise.all([
        jurisdictionId
          ? db.select().from(schema.laws).where(eq(schema.laws.jurisdictionId, jurisdictionId))
          : db.select().from(schema.laws).limit(500),
        jurisdictionId
          ? db.select().from(schema.opportunities).where(eq(schema.opportunities.jurisdictionId, jurisdictionId))
          : db.select().from(schema.opportunities).limit(500),
        db.select().from(schema.stakeholders).limit(500),
      ]);
      return [
        ...laws.map(lawToOp),
        ...opportunities.map(opportunityToOp),
        ...stakeholders.map(stakeholderToOp),
      ];
    }
    default: {
      // Unknown/other topics: nothing to index.
      return [];
    }
  }
}

/** Index specific entities directly (used by the reindex script). */
export async function indexEntities(
  client: OpenSearchClient,
  kind: "documents" | "laws" | "opportunities" | "stakeholders",
  ids: string[],
): Promise<{ indexed: number; errors: number }> {
  const db = getDb();
  let ops: BulkOperation[] = [];
  if (kind === "documents") {
    const rows = ids.length
      ? await db.select().from(schema.policyDocuments).where(inArray(schema.policyDocuments.documentId, ids))
      : await db.select().from(schema.policyDocuments);
    ops = rows.map(documentToOp);
  } else if (kind === "laws") {
    const rows = ids.length
      ? await db.select().from(schema.laws).where(inArray(schema.laws.lawId, ids))
      : await db.select().from(schema.laws);
    ops = rows.map(lawToOp);
  } else if (kind === "opportunities") {
    const rows = ids.length
      ? await db.select().from(schema.opportunities).where(inArray(schema.opportunities.opportunityId, ids))
      : await db.select().from(schema.opportunities);
    ops = rows.map(opportunityToOp);
  } else {
    const rows = ids.length
      ? await db.select().from(schema.stakeholders).where(inArray(schema.stakeholders.stakeholderId, ids))
      : await db.select().from(schema.stakeholders);
    ops = rows.map(stakeholderToOp);
  }
  // Chunk to keep bulk payloads modest.
  let indexed = 0;
  let errors = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const res = await client.bulk(ops.slice(i, i + 500));
    indexed += res.indexed;
    errors += res.errors;
  }
  return { indexed, errors };
}

/** Topics the indexer subscribes to (registered in api/consumers.ts). */
export const INDEXER_TOPICS = [
  "documents.parse.requested",
  "graph.index.updated",
] as const;
