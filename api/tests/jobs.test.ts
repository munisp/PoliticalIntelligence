import { describe, expect, it } from "vitest";
import type { JobStatus } from "@contracts/entities";
import { createJobRunner, type JobStore } from "../utils/jobs";

function memoryStore() {
  const state = new Map<
    string,
    { status: JobStatus; progress: number; result?: unknown; error?: string }
  >();
  const store: JobStore = {
    async setRunning(jobId) {
      state.set(jobId, { status: "running", progress: 0 });
    },
    async setProgress(jobId, progress) {
      const s = state.get(jobId);
      if (s) s.progress = progress;
    },
    async setSucceeded(jobId, result) {
      state.set(jobId, { status: "succeeded", progress: 100, result });
    },
    async setFailed(jobId, error) {
      state.set(jobId, { status: "failed", progress: 0, error });
    },
  };
  return { state, store };
}

describe("job runner", () => {
  it("executes a registered handler and records success + progress", async () => {
    const { state, store } = memoryStore();
    const runner = createJobRunner(store);
    const seen: number[] = [];
    runner.register("demo", async ({ reportProgress }) => {
      await reportProgress(50);
      await reportProgress(150); // clamped to 100
      seen.push(1);
      return { ok: true };
    });
    runner.enqueue({ jobId: "job:1", type: "demo", input: {} });
    await runner.drain();
    expect(seen).toEqual([1]);
    expect(state.get("job:1")).toEqual({
      status: "succeeded",
      progress: 100,
      result: { ok: true },
    });
  });

  it("records failures without throwing", async () => {
    const { state, store } = memoryStore();
    const runner = createJobRunner(store);
    runner.register("boom", async () => {
      throw new Error("kaboom");
    });
    runner.enqueue({ jobId: "job:2", type: "boom", input: {} });
    await runner.drain();
    expect(state.get("job:2")?.status).toBe("failed");
    expect(state.get("job:2")?.error).toBe("kaboom");
  });

  it("fails cleanly for unregistered job types", async () => {
    const { state, store } = memoryStore();
    const runner = createJobRunner(store);
    runner.enqueue({ jobId: "job:3", type: "missing", input: {} });
    await runner.drain();
    expect(state.get("job:3")?.status).toBe("failed");
    expect(state.get("job:3")?.error).toContain("No handler");
  });
});
