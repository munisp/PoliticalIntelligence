import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@db/schema";
import type { TrpcContext } from "../context";
import { appRouter } from "../router";
import * as temporalBridge from "../bridges/temporal";

function fakeUser(platformRole: string): User {
  return {
    id: 42,
    unionId: `u-${platformRole}`,
    name: platformRole,
    email: null,
    role: "user",
    platformRole,
  } as unknown as User;
}

function ctxFor(user?: User): TrpcContext {
  return {
    req: new Request("http://test.local/"),
    resHeaders: new Headers(),
    user,
  } as TrpcContext;
}

describe("workflows router", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingestion.runWorkflow rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.workflows.ingestion.runWorkflow({ connector: "worldbank", jurisdiction: "ng" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("ingestion.runWorkflow rejects non-steward roles", async () => {
    const caller = appRouter.createCaller(ctxFor(fakeUser("policy_analyst")));
    await expect(
      caller.workflows.ingestion.runWorkflow({ connector: "worldbank", jurisdiction: "ng" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ingestion.runWorkflow starts a workflow for data_steward", async () => {
    const spy = vi
      .spyOn(temporalBridge, "startIngestionWorkflow")
      .mockResolvedValue({ mode: "temporal", id: "wf-1", status: "started" });
    const caller = appRouter.createCaller(ctxFor(fakeUser("data_steward")));

    const res = await caller.workflows.ingestion.runWorkflow({
      connector: "worldbank",
      jurisdiction: "ng",
    });

    expect(spy).toHaveBeenCalledWith({ connector: "worldbank", jurisdiction: "ng" });
    expect(res.data).toEqual({ mode: "temporal", id: "wf-1", status: "started" });
  });

  it("ingestion.runWorkflow surfaces the runner-fallback mode", async () => {
    vi.spyOn(temporalBridge, "startIngestionWorkflow").mockResolvedValue({
      mode: "fallback",
      id: "job-7",
      status: "queued",
    });
    const caller = appRouter.createCaller(ctxFor(fakeUser("data_steward")));
    const res = await caller.workflows.ingestion.runWorkflow({
      connector: "nbs_bulletin",
      jurisdiction: "ng",
    });
    expect(res.data.mode).toBe("fallback");
  });

  it("status reports temporal enablement for stewards", async () => {
    const caller = appRouter.createCaller(ctxFor(fakeUser("data_steward")));
    const res = await caller.workflows.status();
    expect(res.data).toMatchObject({ task_queue: "policy-twin" });
    expect(typeof res.data.temporal_enabled).toBe("boolean");
  });
});
