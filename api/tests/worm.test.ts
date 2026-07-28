import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { insertAuditEvent } from "../queries/audit";
import { exportWormNow, verifyWormExports } from "../utils/worm";

const dir = mkdtempSync(path.join(tmpdir(), "worm-test-"));
process.env.WORM_EXPORT_DIR = dir;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("WORM audit export", () => {
  it("exports new audit events and verifies the chain", async () => {
    await insertAuditEvent({
      action: "worm.test.event",
      entityType: "test",
      entityId: "worm-1",
      payload: { n: 1 } as never,
    });
    await insertAuditEvent({
      action: "worm.test.event",
      entityType: "test",
      entityId: "worm-2",
      payload: { n: 2 } as never,
    });
    const result = await exportWormNow();
    expect(result.exported).toBeGreaterThan(0);
    expect(result.file).toBeTruthy();
    expect(result.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    const check = verifyWormExports(dir);
    expect(check.valid).toBe(true);
    expect(check.files_checked).toBeGreaterThan(0);
    expect(check.events_checked).toBeGreaterThan(0);
  });

  it("second export continues the chain across files (no gap)", async () => {
    await insertAuditEvent({
      action: "worm.test.event",
      entityType: "test",
      entityId: "worm-3",
      payload: { n: 3 } as never,
    });
    const result = await exportWormNow();
    expect(result.exported).toBeGreaterThan(0);
    const check = verifyWormExports(dir);
    expect(check.valid).toBe(true);
    expect(check.files_checked).toBeGreaterThanOrEqual(2);
  });

  it("detects tampering (gap / hash mismatch) in an export file", async () => {
    // Corrupt the first export file so recomputed hashes no longer match.
    const files = (await import("node:fs")).readdirSync(dir).filter((f) =>
      f.endsWith(".jsonl")
    );
    const target = path.join(dir, files.sort()[0]);
    const body = readFileSync(target, "utf8");
    const corrupted = body.replace('"action":"', '"action":"tampered.');
    writeFileSync(target, corrupted);
    const check = verifyWormExports(dir);
    expect(check.valid).toBe(false);
    expect(check.error).toBeTruthy();
  });
});
