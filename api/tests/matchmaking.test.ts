import { describe, expect, it } from "vitest";
import {
  computeReadiness,
  proximityScore,
  registrationAgeScore,
  sectorMatchScore,
  sizeClassScore,
} from "@contracts/matchmaking";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import { anonCtx } from "./helpers";

describe("matchmaking scoring (pure, deterministic)", () => {
  it("component scores behave to spec", () => {
    expect(sizeClassScore("limited_liability")).toBe(1.0);
    expect(sizeClassScore("business_name")).toBe(0.7);
    expect(sectorMatchScore("agro", "Kachia Farm Produce Ltd")).toBe(1.0);
    expect(sectorMatchScore("agro", "Zaria Cyber Cafe Ltd")).toBe(0.3);
    expect(proximityScore("jur:ng-kd", null, "jur:ng-kd", "Kachia")).toBe(0.8);
    expect(proximityScore("jur:ng-kd", null, "jur:ng-la", null)).toBe(0.2);
    expect(registrationAgeScore("2000-01-01", new Date("2025-01-01"))).toBe(1);
    expect(registrationAgeScore(null)).toBe(0.3);
  });

  it("readiness is a weighted 0-100 blend, deterministic", () => {
    const a = computeReadiness({
      registration_age: 1,
      sector_match: 1,
      lga_proximity: 0.8,
      size_class: 1,
    });
    expect(a.readiness_score).toBeCloseTo(0.3 * 100 + 0.3 * 100 + 0.2 * 80 + 0.2 * 100, 1);
    const b = computeReadiness({
      registration_age: 1,
      sector_match: 1,
      lga_proximity: 0.8,
      size_class: 1,
    });
    expect(b).toEqual(a);
  });
});

describe("matchmaking router", () => {
  it("suppliers ranks active registrations with breakdowns", async () => {
    const opp = (await getDb().query.opportunities.findMany({ limit: 1 }))[0];
    if (!opp) throw new Error("no opportunities seeded");
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.matchmaking.suppliers({
      opportunity_id: opp.opportunityId,
      limit: 5,
    });
    expect(res.data.sector_code).toBe(opp.sectorCode);
    expect(res.data.suppliers.length).toBeGreaterThan(0);
    const scores = res.data.suppliers.map((s) => s.readiness_score);
    const sorted = [...scores].sort((x, y) => y - x);
    expect(scores).toEqual(sorted);
    expect(res.data.suppliers[0].breakdown).toHaveProperty("sector_match");
  });

  it("readiness returns a breakdown for one registration; unknown ids 404", async () => {
    const reg = (await getDb().query.businessRegistrations.findMany({ limit: 1 }))[0];
    if (!reg) throw new Error("no registrations seeded");
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.matchmaking.readiness({
      registration_id: reg.registrationId,
    });
    expect(res.data.readiness_score).toBeGreaterThan(0);
    await expect(
      caller.matchmaking.readiness({ registration_id: "biz:nope" }),
    ).rejects.toThrow();
  });
});
