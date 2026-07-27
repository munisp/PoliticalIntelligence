import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { envelope, apiError, requestMeta } from "../utils/envelope";
import type { TrpcContext } from "../context";

function mockCtx(headers?: Record<string, string>): TrpcContext {
  return {
    req: new Request("http://localhost/api/trpc/test", { headers }),
    resHeaders: new Headers(),
  };
}

describe("envelope", () => {
  it("produces the standard {data, meta, audit} shape", () => {
    const ctx = mockCtx();
    const env = envelope({ hello: "world" }, ctx);
    expect(env.data).toEqual({ hello: "world" });
    expect(env.meta.api_version).toBe("v1");
    expect(env.meta.request_id).toMatch(/^req_/);
    expect(env.meta.correlation_id).toMatch(/^cor_/);
    expect(env.audit.actor_id).toBeNull();
    expect(env.audit.generated_at).toBeInstanceOf(Date);
  });

  it("keeps request meta stable across calls on one request", () => {
    const ctx = mockCtx();
    const a = requestMeta(ctx);
    const b = requestMeta(ctx);
    expect(a.request_id).toBe(b.request_id);
    expect(a.correlation_id).toBe(b.correlation_id);
  });

  it("honours an inbound x-correlation-id header", () => {
    const ctx = mockCtx({ "x-correlation-id": "cor_external_1" });
    expect(requestMeta(ctx).correlation_id).toBe("cor_external_1");
  });

  it("includes actor_id when a user is present", () => {
    const ctx = mockCtx();
    ctx.user = { id: 7 } as TrpcContext["user"];
    expect(envelope({}, ctx).audit.actor_id).toBe(7);
  });
});

describe("apiError", () => {
  it("carries the error-envelope shape in TRPCError.cause", () => {
    const ctx = mockCtx();
    const err = apiError(ctx, {
      http: "FORBIDDEN",
      code: "FORBIDDEN",
      message: "nope",
      retryable: false,
      details: { role: "policy_analyst" },
    });
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    const cause = err.cause as unknown as {
      code: string;
      message: string;
      request_id: string;
      retryable: boolean;
      details: unknown;
    };
    expect(cause.code).toBe("FORBIDDEN");
    expect(cause.message).toBe("nope");
    expect(cause.request_id).toMatch(/^req_/);
    expect(cause.retryable).toBe(false);
    expect(cause.details).toEqual({ role: "policy_analyst" });
  });
});
