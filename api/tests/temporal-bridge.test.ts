import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setClientFactoryForTests,
  startIngestionWorkflow,
  temporalEnabled,
  type TemporalClientLike,
} from "../bridges/temporal";

const ENV_KEYS = ["TEMPORAL_URL", "TEMPORAL_TASK_QUEUE", "TEMPORAL_NAMESPACE", "INGESTION_BASE_URL"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  __setClientFactoryForTests(null);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __setClientFactoryForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("temporalEnabled", () => {
  it("is false when TEMPORAL_URL is unset", () => {
    expect(temporalEnabled()).toBe(false);
  });
  it("is true when TEMPORAL_URL is set", () => {
    process.env.TEMPORAL_URL = "localhost:7233";
    expect(temporalEnabled()).toBe(true);
  });
});

describe("startIngestionWorkflow", () => {
  it("starts a Temporal workflow when TEMPORAL_URL is set", async () => {
    process.env.TEMPORAL_URL = "temporal:7233";
    const start = vi.fn().mockResolvedValue({ workflowId: "wf-1" });
    __setClientFactoryForTests(async () => ({ workflow: { start } }) as TemporalClientLike);

    const res = await startIngestionWorkflow({ connector: "worldbank", jurisdiction: "ng" });

    expect(res).toEqual({ mode: "temporal", id: "wf-1", status: "started" });
    expect(start).toHaveBeenCalledOnce();
    const [wfType, opts] = start.mock.calls[0];
    expect(wfType).toBe("IngestionPipelineWorkflow");
    expect(opts.taskQueue).toBe("policy-twin");
    expect(opts.args).toEqual([{ connector: "worldbank", jurisdiction: "ng" }]);
  });

  it("falls back to the direct ingestion trigger when TEMPORAL_URL is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { job_id: "job-123" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await startIngestionWorkflow({ connector: "nbs_bulletin", jurisdiction: "ng" });

    expect(res).toEqual({ mode: "fallback", id: "job-123", status: "queued" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8300/v1/ingest/nbs_bulletin");
    expect(init.method).toBe("POST");
  });

  it("falls back when the Temporal client fails to start the workflow", async () => {
    process.env.TEMPORAL_URL = "temporal:7233";
    __setClientFactoryForTests(async () => {
      throw new Error("connection refused");
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { job_id: "job-999" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await startIngestionWorkflow({ connector: "worldbank", jurisdiction: "ng" });

    expect(res.mode).toBe("fallback");
    expect(res.id).toBe("job-999");
    expect(errSpy).toHaveBeenCalled();
  });

  it("propagates ingestion-service errors on the fallback path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    await expect(
      startIngestionWorkflow({ connector: "worldbank", jurisdiction: "ng" }),
    ).rejects.toThrow("502");
  });
});
