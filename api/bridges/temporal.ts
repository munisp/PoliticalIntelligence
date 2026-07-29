/**
 * Bridge to Temporal for durable workflow execution (ADR-010, docs/TEMPORAL.md).
 *
 * When TEMPORAL_URL is set, ingestion runs are started as Temporal
 * `IngestionPipelineWorkflow` executions (Go worker: services/workflows-go)
 * and the workflow id is returned for status tracking.
 *
 * When TEMPORAL_URL is unset (or the server is unreachable at dial time),
 * the bridge degrades to the existing direct HTTP trigger against the
 * ingestion service (the same path api/onboarding.ts uses) — zero
 * behavioural change for environments without Temporal.
 */

export interface IngestionWorkflowInput {
  connector: string;
  jurisdiction: string;
  since?: string;
  params?: Record<string, unknown>;
}

export interface IngestionWorkflowStart {
  mode: "temporal" | "fallback";
  /** Temporal workflow id (mode=temporal) or ingestion job id (fallback). */
  id: string;
  /** Human-facing status hint. */
  status: string;
}

const TASK_QUEUE = () => process.env.TEMPORAL_TASK_QUEUE ?? "policy-twin";
const NAMESPACE = () => process.env.TEMPORAL_NAMESPACE ?? "default";
const INGESTION_BASE_URL = () =>
  process.env.INGESTION_BASE_URL ?? "http://localhost:8300";

export function temporalEnabled(): boolean {
  return Boolean(process.env.TEMPORAL_URL && process.env.TEMPORAL_URL.trim());
}

/**
 * Minimal structural type for the Temporal client — lets the bridge be unit
 * tested with a stub while the real client comes from @temporalio/client
 * (dynamically imported so test/CI environments without a server stay fast).
 */
export interface TemporalClientLike {
  workflow: {
    start(
      workflowType: string,
      options: {
        taskQueue: string;
        workflowId: string;
        args: unknown[];
      },
    ): Promise<{ workflowId: string }>;
  };
}

/** Overridable client factory (tests inject a stub). */
export type ClientFactory = () => Promise<TemporalClientLike>;

const realClientFactory: ClientFactory = async () => {
  const { Client, Connection } = await import("@temporalio/client");
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_URL!,
  });
  return new Client({ connection, namespace: NAMESPACE() }) as unknown as TemporalClientLike;
};

let clientFactory: ClientFactory = realClientFactory;
let cached: Promise<TemporalClientLike> | null = null;

/** Test hook: swap the client factory and reset the cached connection. */
export function __setClientFactoryForTests(factory: ClientFactory | null): void {
  clientFactory = factory ?? realClientFactory;
  cached = null;
}

async function getClient(): Promise<TemporalClientLike> {
  if (!cached) {
    cached = clientFactory();
    cached.catch(() => {
      cached = null; // allow retry on next call
    });
  }
  return cached;
}

/**
 * Start an ingestion pipeline run.
 * Temporal path: workflowId `ingestion-<connector>-<jurisdiction>-<ts>`.
 * Fallback path: POST {INGESTION_BASE_URL}/v1/ingest/{connector}.
 */
export async function startIngestionWorkflow(
  input: IngestionWorkflowInput,
): Promise<IngestionWorkflowStart> {
  if (temporalEnabled()) {
    try {
      const client = await getClient();
      const workflowId = `ingestion-${input.connector}-${input.jurisdiction}-${Date.now()}`;
      const handle = await client.workflow.start("IngestionPipelineWorkflow", {
        taskQueue: TASK_QUEUE(),
        workflowId,
        args: [input],
      });
      return { mode: "temporal", id: handle.workflowId, status: "started" };
    } catch (err) {
      // Fall through to the direct trigger: an unavailable Temporal server
      // must not block data stewards from running connectors.
      console.error("[temporal] start failed, falling back to direct trigger:", err);
    }
  }
  return triggerIngestionDirectly(input);
}

/** Existing pre-Temporal trigger path (shared with api/onboarding.ts). */
async function triggerIngestionDirectly(
  input: IngestionWorkflowInput,
): Promise<IngestionWorkflowStart> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const resp = await fetch(`${INGESTION_BASE_URL()}/v1/ingest/${input.connector}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jurisdiction: input.jurisdiction,
        ...(input.since ? { since: input.since } : {}),
        ...(input.params ? { params: input.params } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`ingestion service HTTP ${resp.status}`);
    const body = (await resp.json()) as { data?: { job_id?: string } };
    const jobId = body?.data?.job_id;
    if (!jobId) throw new Error("ingestion service returned no job_id");
    return { mode: "fallback", id: jobId, status: "queued" };
  } finally {
    clearTimeout(timer);
  }
}
