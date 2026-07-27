import { z } from "zod";
import { desc } from "drizzle-orm";
import * as schema from "@db/schema";
import { EventTopics } from "@contracts/entities";
import { createRouter, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import { getDb } from "./queries/connection";
import { replayEvents, dlqTopicFor } from "./utils/events";

/**
 * Eventing administration router (EVT-2 replay tooling; gap 10).
 *
 * Procedures:
 *  - replay    Requeue dead-lettered / stuck events for a topic back onto
 *              the bus (consumer group in outbox mode, topic in Kafka
 *              mode). Every replay writes an `events.replayed` audit event.
 *  - dlq       Inspect the dead-letter queue (newest first).
 *  - outbox    Inspect the durable outbox backlog (undelivered rows).
 *
 * INTEGRATION NOTE: this router is intentionally NOT merged into
 * api/router.ts by this change (the frontend agent owns router wiring
 * review). To mount it, add to api/router.ts:
 *
 *   import eventsAdminRouter from "./events-admin";
 *   // inside appRouter:
 *   eventsAdmin: eventsAdminRouter,
 *
 * The procedures are self-contained and fully tested in
 * api/tests/events-replay.test.ts via direct createCaller on this router.
 */
const eventsAdminRouter = createRouter({
  /** Replay dead-lettered and/or stuck events for a topic. */
  replay: authedQuery
    .input(
      z.object({
        topic: z.string().min(1),
        since: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(1000).default(100),
        source: z.enum(["dlq", "outbox", "both"]).default("dlq"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward"]); // + platform_admin via requireRole
      const knownTopics = Object.values(EventTopics) as string[];
      if (!knownTopics.includes(input.topic) && !input.topic.endsWith(".dlq")) {
        throw apiError(ctx, {
          http: "BAD_REQUEST",
          code: "UNKNOWN_TOPIC",
          message: `Topic ${input.topic} is not in the catalog (docs/EVENTS.md)`,
          retryable: false,
          details: { catalog: knownTopics },
        });
      }
      const result = await replayEvents({
        topic: input.topic,
        since: input.since,
        limit: input.limit,
        source: input.source,
        actorId: ctx.user.id,
      });
      audit(ctx, "events.replay.requested", {
        type: "event_topic",
        id: input.topic,
        scopes: ["events:replay"],
        payload: result as never,
      });
      return envelope(result, ctx);
    }),

  /** Dead-letter queue inspection (newest first). */
  dlq: authedQuery
    .input(
      z.object({
        topic: z.string().optional(),
        include_replayed: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward"]);
      const rows = await getDb()
        .select()
        .from(schema.eventDlq)
        .orderBy(desc(schema.eventDlq.createdAt))
        .limit(Math.min(input.limit * 4, 800)); // over-fetch for filtering
      const filtered = rows
        .filter((r) => !input.topic || r.topic === input.topic)
        .filter((r) => input.include_replayed || r.replayedAt === null)
        .slice(0, input.limit)
        .map((r) => ({
          event_id: r.eventId,
          topic: r.topic,
          dlq_topic: r.dlqTopic ?? dlqTopicFor(r.topic),
          partition_key: r.partitionKey,
          attempts: r.attempts,
          last_error: r.lastError,
          consumer_group: r.consumerGroup,
          dead_at: r.deadAt,
          replayed_at: r.replayedAt,
        }));
      return envelope({ items: filtered }, ctx);
    }),

  /** Outbox backlog (undelivered rows, oldest first). */
  outbox: authedQuery
    .input(
      z.object({
        topic: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward"]);
      const rows = await getDb()
        .select()
        .from(schema.eventOutbox)
        .orderBy(desc(schema.eventOutbox.createdAt))
        .limit(Math.min(input.limit * 4, 800));
      const items = rows
        .filter((r) => r.deliveredAt === null)
        .filter((r) => !input.topic || r.topic === input.topic)
        .slice(0, input.limit)
        .map((r) => ({
          event_id: r.eventId,
          topic: r.topic,
          partition_key: r.partitionKey,
          attempts: r.attempts,
          last_error: r.lastError,
          created_at: r.createdAt,
        }));
      return envelope({ items }, ctx);
    }),
});

export default eventsAdminRouter;
