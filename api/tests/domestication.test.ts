import { beforeAll, describe, expect, it } from "vitest";
import { NG_STATES, TRACKED_FEDERAL_LAWS } from "@contracts/domestication";
import { seedDomestication } from "@db/seed-domestication";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { anonCtx, ctxFor, ensureUser } from "./helpers";

beforeAll(async () => {
  await seedDomestication();
});

describe("domestication seed", () => {
  it("seeds 3 federal laws × 37 cells with origin=derived", async () => {
    const rows = await getDb().select().from(schema.domesticationStatus);
    expect(rows.length).toBeGreaterThanOrEqual(3 * 37);
    for (const law of TRACKED_FEDERAL_LAWS) {
      const cells = rows.filter((r) => r.lawRef === law.lawRef);
      expect(cells.length, law.lawRef).toBe(37);
      for (const c of cells) expect(c.origin).toBe("derived");
    }
  });

  it("seed is idempotent (row count stable on re-run)", async () => {
    const before = (await getDb().select().from(schema.domesticationStatus)).length;
    await seedDomestication();
    expect((await getDb().select().from(schema.domesticationStatus)).length).toBe(before);
  });
});

describe("domestication router", () => {
  it("matrix returns 37 cells with coherent counts", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const m = await caller.domestication.matrix({ law_ref: "startup-act-2022" });
    expect(m.data.cells.length).toBe(37);
    expect(new Set(m.data.cells.map((c) => c.state))).toEqual(new Set(NG_STATES));
    const total = Object.values(m.data.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(37);
    // Kaduna is a seeded domesticated early adopter.
    expect(m.data.cells.find((c) => c.state === "KD")?.status).toBe("domesticated");
  });

  it("update is data_steward-gated and upserts a cell", async () => {
    const analyst = await ensureUser("demo-policy-analyst", "policy_analyst");
    const steward = await ensureUser("demo-data-steward", "data_steward");
    await expect(
      appRouter.createCaller(ctxFor(analyst)).domestication.update({
        law_ref: "startup-act-2022",
        state: "OS",
        status: "in_assembly",
      }),
    ).rejects.toThrow();
    const res = await appRouter
      .createCaller(ctxFor(steward))
      .domestication.update({
        law_ref: "startup-act-2022",
        state: "OS",
        status: "in_assembly",
        bill_ref: "OS/HB/STARTUP-2025",
      });
    expect(res.data.status).toBe("in_assembly");
    expect(res.data.billRef).toBe("OS/HB/STARTUP-2025");
    const m = await appRouter
      .createCaller(anonCtx())
      .domestication.matrix({ law_ref: "startup-act-2022" });
    expect(m.data.cells.find((c) => c.state === "OS")?.status).toBe("in_assembly");
    // restore seed value for idempotence of other suites
    await appRouter
      .createCaller(ctxFor(steward))
      .domestication.update({ law_ref: "startup-act-2022", state: "OS", status: "not_started", bill_ref: null });
  });
});
