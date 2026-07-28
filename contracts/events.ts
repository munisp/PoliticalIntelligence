import { z } from "zod";
import { EventTopics } from "./entities";

/**
 * Event schema pack (§40 / API-8): one zod payload schema per topic in the
 * catalog. Producers validate on emit (`api/utils/events.ts emitEvent`);
 * invalid payloads are dropped + counted, never published.
 *
 * Schemas are intentionally "loose" (unknown keys pass through) so additive
 * payload evolution is non-breaking, but every documented field is typed and
 * the payload must be an object. Tightening a field to required is a
 * breaking change and must accompany a topic version bump.
 */
export const EventPayloadSchemas = {
  [EventTopics.ingestRawReceived]: z.looseObject({
    source_id: z.string().min(1),
    object_uri: z.string().optional(),
    checksum: z.string().optional(),
    cadence: z.string().optional(),
  }),
  [EventTopics.documentsParseRequested]: z.looseObject({
    document_id: z.string().min(1),
    retry: z.number().int().nonnegative().optional(),
  }),
  [EventTopics.graphIndexUpdated]: z.looseObject({
    jurisdiction_id: z.string().min(1).optional(),
    entity_slice: z.string().optional(),
  }),
  [EventTopics.featuresMaterialized]: z.looseObject({
    jurisdiction_id: z.string().min(1).optional(),
    dataset_snapshot_id: z.string().optional(),
    recalibration: z.boolean().optional(),
    layers: z.number().int().optional(),
  }),
  [EventTopics.scenariosRunRequested]: z.looseObject({
    job_id: z.string().min(1),
    scenario_id: z.string().optional(),
    idempotency_key: z.string().optional(),
    status: z.string().optional(),
  }),
  [EventTopics.simulationsRunCompleted]: z.looseObject({
    scenario_id: z.string().optional(),
    simulation_run_id: z.string().optional(),
    engine: z.string().optional(),
    seed: z.number().int().optional(),
    job_id: z.string().optional(),
    backtest: z.boolean().optional(),
    mape: z.number().optional(),
    reproducibility_hash: z.string().optional(),
    status: z.string().optional(),
  }),
  [EventTopics.recommendationsGenerated]: z.looseObject({
    job_id: z.string().min(1),
    generation_job_id: z.string().optional(),
    model_routing: z.record(z.string(), z.unknown()).optional(),
    status: z.string().optional(),
  }),
  [EventTopics.reportsGenerated]: z.looseObject({
    job_id: z.string().min(1),
    object_uri: z.string().optional(),
    citation_manifest: z.record(z.string(), z.unknown()).optional(),
    status: z.string().optional(),
  }),
  [EventTopics.auditEvents]: z.looseObject({
    actor: z.string().optional(),
    action: z.string().optional(),
    entity_ref: z.string().optional(),
  }),
  [EventTopics.opsAlerts]: z.looseObject({
    job_id: z.string().optional(),
    type: z.string().min(1).optional(),
    reason: z.string().optional(),
    status: z.string().optional(),
  }),
} as const;

export type EventPayloadTopic = keyof typeof EventPayloadSchemas;

/**
 * Schema registry: extension topics (e.g. tests, plugins) must register a
 * payload schema before emitEvent will publish them — unregistered topics
 * are rejected at emit time, keeping the catalog closed by default.
 */
const registry: Record<string, z.ZodType> = { ...EventPayloadSchemas };

export function registerEventSchema(topic: string, schema: z.ZodType): void {
  registry[topic] = schema;
}

export function registeredEventTopics(): string[] {
  return Object.keys(registry);
}

export type PayloadValidation =
  | { ok: true }
  | { ok: false; error: string };

/** Validate a payload against the schema registered for `topic`. */
export function validateEventPayload(
  topic: string,
  payload: unknown,
): PayloadValidation {
  const schema = registry[topic];
  if (!schema) {
    return { ok: false, error: `no schema registered for topic ${topic}` };
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true };
}
