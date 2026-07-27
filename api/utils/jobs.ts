import type { JobStatus } from "@contracts/entities";

/**
 * In-process async job runner (spec §15 async job model).
 *
 * Handlers are registered per job type; `enqueue` persists nothing itself —
 * the caller creates the `jobs` row first (idempotency checked), then hands
 * the job to the runner, which executes on the next tick (setImmediate) and
 * streams progress/status through the injected store (DB-backed in prod,
 * in-memory in tests). Status polling reads the store.
 */

export interface JobRecord {
  jobId: string;
  type: string;
  status: JobStatus;
  progress: number;
  input: unknown;
  result?: unknown;
  error?: string | null;
}

/** Persistence interface the runner needs. */
export interface JobStore {
  setRunning(jobId: string): Promise<void>;
  setProgress(jobId: string, progress: number): Promise<void>;
  setSucceeded(jobId: string, result: unknown): Promise<void>;
  setFailed(jobId: string, error: string): Promise<void>;
}

export interface JobContext {
  jobId: string;
  input: unknown;
  reportProgress(progress: number): Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export interface JobRunner {
  register(type: string, handler: JobHandler): void;
  /** Schedule execution; resolves immediately (fire-and-forget). */
  enqueue(job: Pick<JobRecord, "jobId" | "type" | "input">): void;
  /** Test helper: wait for all scheduled jobs to settle. */
  drain(): Promise<void>;
}

export function createJobRunner(store: JobStore): JobRunner {
  const handlers = new Map<string, JobHandler>();
  const pending = new Set<Promise<void>>();

  async function execute(
    job: Pick<JobRecord, "jobId" | "type" | "input">,
  ): Promise<void> {
    const handler = handlers.get(job.type);
    if (!handler) {
      await store.setFailed(job.jobId, `No handler registered for ${job.type}`);
      return;
    }
    await store.setRunning(job.jobId);
    try {
      const result = await handler({
        jobId: job.jobId,
        input: job.input,
        reportProgress: (p) =>
          store.setProgress(job.jobId, Math.max(0, Math.min(100, Math.round(p)))),
      });
      await store.setSucceeded(job.jobId, result);
    } catch (err) {
      await store.setFailed(
        job.jobId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    register(type, handler) {
      handlers.set(type, handler);
    },
    enqueue(job) {
      const p = new Promise<void>((resolve) => {
        setImmediate(async () => {
          try {
            await execute(job);
          } catch (err) {
            // store failures must not crash the process
            console.error(`[jobs] ${job.jobId} store error:`, err);
          } finally {
            resolve();
          }
        });
      });
      pending.add(p);
      void p.finally(() => pending.delete(p));
    },
    async drain() {
      await Promise.all([...pending]);
    },
  };
}
