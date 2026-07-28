import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import {
  recordJobHeartbeat,
  sweepStaleJobs,
  wrapJobStoreWithHeartbeats,
} from "../consumers";

describe("job heartbeats + stuck-job sweeper", () => {
  it("wrapped job store records heartbeats on lifecycle transitions", async () => {
    const jobId = `job_hb_${Date.now()}`;
    const calls: string[] = [];
    const store = wrapJobStoreWithHeartbeats({
      async setRunning(id: string) {
        calls.push(`running:${id}`);
      },
      async setProgress(id: string) {
        calls.push(`progress:${id}`);
      },
      async setSucceeded(id: string) {
        calls.push(`succeeded:${id}`);
      },
      async setFailed(id: string) {
        calls.push(`failed:${id}`);
      },
    } as never);
    await (store as never as { setRunning(id: string): Promise<void> }).setRunning(jobId);
    const rows = await getDb()
      .select()
      .from(schema.jobHeartbeats)
      .where(eq(schema.jobHeartbeats.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("running");
    expect(calls).toEqual([`running:${jobId}`]);
  });

  it("sweeper auto-fails running jobs with a stale heartbeat", { timeout: 20000 }, async () => {
    const jobId = `job_stale_${Date.now()}`;
    await getDb()
      .insert(schema.jobs)
      .values({ jobId, type: "simulations.run", status: "running" } as never);
    // Heartbeat stamped 30 minutes ago.
    await recordJobHeartbeat(jobId, "running");
    const staleTs = new Date(Date.now() - 30 * 60 * 1000);
    await getDb()
      .update(schema.jobHeartbeats)
      .set({ ts: staleTs })
      .where(eq(schema.jobHeartbeats.jobId, jobId));

    const failed = await sweepStaleJobs(10 * 60 * 1000);
    expect(failed).toBeGreaterThanOrEqual(1);
    const rows = await getDb()
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.jobId, jobId));
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("stuck job");
  });

  it("sweeper leaves fresh-heartbeat jobs alone", async () => {
    const jobId = `job_fresh_${Date.now()}`;
    await getDb()
      .insert(schema.jobs)
      .values({ jobId, type: "simulations.run", status: "running" } as never);
    await recordJobHeartbeat(jobId, "running");
    await sweepStaleJobs(10 * 60 * 1000);
    const rows = await getDb()
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.jobId, jobId));
    expect(rows[0].status).toBe("running");
  });
});
