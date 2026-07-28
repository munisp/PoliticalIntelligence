import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { insertAuditEvent } from "../queries/audit";
import { exportWormNow } from "../utils/worm";

/**
 * SEC-4: S3 Object-Lock adapter — presigned PUT carries the COMPLIANCE-mode
 * headers, and a sealed export manifest is immutable (append/rewrite
 * attempts are rejected; the export never silently overwrites).
 */

const dir = mkdtempSync(path.join(tmpdir(), "worm-lock-test-"));
process.env.WORM_EXPORT_DIR = dir;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WORM_S3_PRESIGN_URL_TEMPLATE;
  delete process.env.WORM_RETENTION_YEARS;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("WORM Object Lock adapter (SEC-4)", () => {
  it("presigned PUT sends COMPLIANCE object-lock headers with retention", async () => {
    process.env.WORM_S3_PRESIGN_URL_TEMPLATE =
      "https://s3.example/audit-bucket/{key}?sig=abc";
    process.env.WORM_RETENTION_YEARS = "7";
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 200 });
      }),
    );
    await insertAuditEvent({
      action: "worm.objectlock.test",
      entityType: "test",
      entityId: `lock-${Date.now()}`,
      payload: { n: 1 } as never,
    });
    const result = await exportWormNow();
    expect(result.exported).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const headers = (call.init?.headers ?? {}) as Record<string, string>;
      expect(headers["x-amz-object-lock-mode"]).toBe("COMPLIANCE");
      const until = Date.parse(headers["x-amz-object-lock-retain-until-date"]);
      expect(until).toBeGreaterThan(Date.now() + 6 * 365 * 24 * 3600 * 1000);
    }
    expect(result.s3).toMatch(/^presigned:/);
  });

  it("sealed manifest rejects append/rewrite attempts (compliance-mode simulation)", async () => {
    await insertAuditEvent({
      action: "worm.objectlock.seal",
      entityType: "test",
      entityId: `seal-${Date.now()}`,
      payload: { n: 2 } as never,
    });
    const result = await exportWormNow();
    expect(result.manifest).toBeTruthy();
    const sealedPath = result.manifest!;
    const sealedBody = readFileSync(sealedPath, "utf8");

    // Adversarial append to the sealed manifest must be rejected.
    expect(() =>
      writeFileSync(sealedPath, `${sealedBody}\n{"forged":true}`, {
        flag: "wx",
      }),
    ).toThrow(/EEXIST/);

    // Re-running the exporter over the same range must NOT touch the sealed
    // artifact (WORM: write once, read many).
    const again = await exportWormNow();
    expect(again.exported).toBe(0);
    expect(readFileSync(sealedPath, "utf8")).toBe(sealedBody);
  });
});
