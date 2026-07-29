import { beforeAll, describe, expect, it } from "vitest";
import { verificationStatusFor } from "@contracts/field";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import { anonCtx, ctxFor, ensureUser } from "./helpers";
import type { User } from "@db/schema";

let officer: User;
let steward: User;
let seriesId: number;
const PERIOD = "2025-06";

beforeAll(async () => {
  officer = await ensureUser("demo-field-officer", "field_officer", "Demo Field Officer");
  steward = await ensureUser("demo-data-steward", "data_steward");
  const db = getDb();
  let series = await db.query.outcomeSeries.findFirst();
  if (!series) {
    // Seed a minimal series + observation (idempotent on natural key).
    const { and, eq } = await import("drizzle-orm");
    const schema = await import("@db/schema");
    series = await db.query.outcomeSeries.findFirst({
      where: and(
        eq(schema.outcomeSeries.jurisdictionId, "jur:ng-kd"),
        eq(schema.outcomeSeries.indicatorCode, "EMPLOYMENT_TOTAL"),
        eq(schema.outcomeSeries.source, "field-test"),
      ),
    });
    if (!series) {
      await db.insert(schema.outcomeSeries).values({
        jurisdictionId: "jur:ng-kd",
        indicatorCode: "EMPLOYMENT_TOTAL",
        source: "field-test",
        origin: "seed",
        unit: "jobs",
        frequency: "monthly",
      });
      series = await db.query.outcomeSeries.findFirst({
        where: and(
          eq(schema.outcomeSeries.jurisdictionId, "jur:ng-kd"),
          eq(schema.outcomeSeries.indicatorCode, "EMPLOYMENT_TOTAL"),
          eq(schema.outcomeSeries.source, "field-test"),
        ),
      });
      await db.insert(schema.outcomeObservations).values([
        { seriesId: series!.id, period: PERIOD, value: 12500 },
        { seriesId: series!.id, period: "2025-07", value: 12600 },
      ]);
    }
  }
  seriesId = series!.id;
});

describe("field verification router", () => {
  const ref = () => `series:${seriesId}:${PERIOD}`;

  it("verify is role-gated to field_officer / data_steward", async () => {
    const analyst = await ensureUser("demo-policy-analyst", "policy_analyst");
    await expect(
      appRouter.createCaller(ctxFor(analyst)).field.verify({
        entity_type: "metric",
        entity_ref: ref(),
        gps_lat: 10.5,
        gps_lng: 7.4,
        verdict: "confirmed",
      }),
    ).rejects.toThrow();
  });

  it("field officer submits a GPS-stamped verdict; list returns it", async () => {
    const res = await appRouter.createCaller(ctxFor(officer)).field.verify({
      entity_type: "metric",
      entity_ref: ref(),
      gps_lat: 10.5223,
      gps_lng: 7.4383,
      verdict: "confirmed",
      notes: "Enumerated headcount matches the posted series.",
    });
    expect(res.data!.verdict).toBe("confirmed");
    expect(res.data!.gpsLat).toBeCloseTo(10.5223);
    const list = await appRouter.createCaller(anonCtx()).field.list({
      entity_type: "metric",
      entity_ref: ref(),
    });
    expect(list.data.length).toBeGreaterThanOrEqual(1);
    expect(list.data[0].verdict).toBe("confirmed");
  });

  it("verificationStatusFor: <2 confirmed unverified, ≥2 field_verified", () => {
    expect(verificationStatusFor(0)).toBe("unverified");
    expect(verificationStatusFor(1)).toBe("unverified");
    expect(verificationStatusFor(2)).toBe("field_verified");
    expect(verificationStatusFor(5)).toBe("field_verified");
  });

  it("outcomes.getObservations exposes verification_status after ≥2 confirmations", async () => {
    const caller = appRouter.createCaller(anonCtx());
    // second confirmation from a different verifier (data steward)
    await appRouter.createCaller(ctxFor(steward)).field.verify({
      entity_type: "metric",
      entity_ref: ref(),
      gps_lat: 10.53,
      gps_lng: 7.44,
      verdict: "confirmed",
    });
    const obs = await caller.outcomes.getObservations({ series_id: seriesId });
    expect(obs.data.observations.length).toBeGreaterThan(0);
    for (const o of obs.data.observations) {
      expect(o).toHaveProperty("verification_status");
      if (o.period === PERIOD) {
        expect(o.verification_status).toBe("field_verified");
      } else {
        expect(o.verification_status).toBe("unverified");
      }
    }
  });
});
