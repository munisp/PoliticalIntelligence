import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import app from "../boot";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import {
  listSeriesForJurisdiction,
  observationsForSeries,
  upsertOutcomeObservations,
} from "../queries/outcomes";

/**
 * Realized-outcome store tests (feature G2 — docs/OUTCOMES.md).
 * Require the seeded dev DB (outcome_series / outcome_observations tables).
 * Loader endpoint auth uses LOADER_API_KEY, set here before requests.
 */

const TEST_KEY = "test-loader-key-outcomes";
const TEST_JUR = "test:loader-outcomes";

beforeAll(() => {
  process.env.LOADER_API_KEY = TEST_KEY;
});

async function cleanup() {
  const db = getDb();
  const series = await db
    .select()
    .from(schema.outcomeSeries)
    .where(eq(schema.outcomeSeries.jurisdictionId, TEST_JUR));
  if (series.length > 0) {
    await db
      .delete(schema.outcomeObservations)
      .where(
        inArray(
          schema.outcomeObservations.seriesId,
          series.map((s) => s.id),
        ),
      );
    await db
      .delete(schema.outcomeSeries)
      .where(eq(schema.outcomeSeries.jurisdictionId, TEST_JUR));
  }
}

const REC = {
  data: {
    jurisdiction_id: TEST_JUR,
    indicator_code: "UNEMPLOYMENT_RATE",
    unit: "percent",
    frequency: "quarterly" as const,
    source: "NBS test",
    period: "2099-03",
    value: 5.3,
  },
  provenance: {
    origin: "live" as const,
    source_id: "nbs_labour_force",
    url: "https://example.org/nbs",
    fetched_at: "2025-01-01T00:00:00Z",
  },
};

describe("outcome store queries", () => {
  it("upsertOutcomeObservations creates series + observation, replay updates (idempotent)", async () => {
    await cleanup();
    const first = await upsertOutcomeObservations([REC]);
    expect(first.counts.series.inserted).toBe(1);
    expect(first.counts.observations).toMatchObject({
      inserted: 1,
      updated: 0,
      errors: 0,
    });
    expect(first.error_messages).toEqual([]);

    const series = await listSeriesForJurisdiction(TEST_JUR);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      indicatorCode: "UNEMPLOYMENT_RATE",
      origin: "live",
      frequency: "quarterly",
    });

    // Replay with a new value -> observation updated, no duplicates.
    const second = await upsertOutcomeObservations([
      { ...REC, data: { ...REC.data, value: 5.5 } },
    ]);
    expect(second.counts.series.inserted).toBe(0);
    expect(second.counts.observations).toMatchObject({
      inserted: 0,
      updated: 1,
      errors: 0,
    });
    const obs = await observationsForSeries(series[0].id);
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(5.5);
    await cleanup();
  });

  it("observationsForSeries honors from/to period filters", async () => {
    await cleanup();
    await upsertOutcomeObservations([
      REC,
      { ...REC, data: { ...REC.data, period: "2099-06", value: 5.0 } },
      { ...REC, data: { ...REC.data, period: "2099-09", value: 4.8 } },
    ]);
    const [series] = await listSeriesForJurisdiction(TEST_JUR);
    const all = await observationsForSeries(series.id);
    expect(all.map((o) => o.period)).toEqual(["2099-03", "2099-06", "2099-09"]);
    const window = await observationsForSeries(series.id, "2099-04", "2099-08");
    expect(window.map((o) => o.period)).toEqual(["2099-06"]);
    await cleanup();
  });

  it("rejects invalid periods per-record without aborting the batch", async () => {
    await cleanup();
    const res = await upsertOutcomeObservations([
      { ...REC, data: { ...REC.data, period: "2099-Q1" } },
      REC,
    ]);
    expect(res.counts.observations.inserted).toBe(1);
    expect(res.counts.observations.errors).toBe(1);
    expect(res.error_messages[0]).toContain("2099-Q1");
    await cleanup();
  });
});

describe("outcomes loader endpoint", () => {
  it("upsertObservations returns 401 without a valid x-loader-key", async () => {
    const body = JSON.stringify({ json: { observations: [REC] } });
    const res = await app.request("/api/trpc/outcomes.upsertObservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("upsertObservations loads a batch with the key and listSeries returns it", async () => {
    await cleanup();
    const res = await app.request("/api/trpc/outcomes.upsertObservations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-loader-key": TEST_KEY,
      },
      body: JSON.stringify({
        json: { jurisdiction_id: TEST_JUR, observations: [REC] },
      }),
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as any;
    const data = payload.result.data.json?.data ?? payload.result.data.data;
    expect(data.records).toBe(1);
    expect(data.counts.observations.inserted).toBe(1);
    await cleanup();
  });
});
