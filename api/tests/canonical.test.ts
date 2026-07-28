import { beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import app from "../boot";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import {
  latestMetricsPreferringLive,
  upsertSectorMetrics,
} from "../queries/canonical";

/**
 * Canonical loader tests (docs/LOADER.md). Require the seeded dev DB.
 * Loader endpoint auth uses LOADER_API_KEY, set here before requests.
 */

const TEST_KEY = "test-loader-key-canonical";
const TEST_JUR = "test:loader-canonical";

beforeAll(() => {
  process.env.LOADER_API_KEY = TEST_KEY;
});

async function cleanup() {
  await getDb()
    .delete(schema.sectorMetrics)
    .where(eq(schema.sectorMetrics.jurisdictionId, TEST_JUR));
}

describe("canonical loader", () => {
  it("upsertSectorMetrics inserts then updates (idempotent, provenance preserved)", async () => {
    await cleanup();
    const rec = {
      data: {
        jurisdiction_id: TEST_JUR,
        sector_code: "economy",
        metric_key: "test_metric",
        value: 1.5,
        period: "2099",
        confidence: 0.9,
      },
      provenance: {
        origin: "live" as const,
        source_id: "test_src",
        url: "https://example.org/x",
        fetched_at: "2025-01-01T00:00:00Z",
      },
    };
    const first = await upsertSectorMetrics([rec]);
    expect(first).toMatchObject({ inserted: 1, updated: 0, errors: [] });

    const second = await upsertSectorMetrics([
      { ...rec, data: { ...rec.data, value: 2.5 }, provenance: { origin: "seed" as const } },
    ]);
    expect(second).toMatchObject({ inserted: 0, updated: 1, errors: [] });

    const rows = await getDb()
      .select()
      .from(schema.sectorMetrics)
      .where(
        and(
          eq(schema.sectorMetrics.jurisdictionId, TEST_JUR),
          eq(schema.sectorMetrics.metricKey, "test_metric"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(2.5);
    // Provenance preserved from the original insert (not downgraded).
    expect(rows[0].origin).toBe("live");
    expect(rows[0].sourceUrl).toBe("https://example.org/x");
    await cleanup();
  });

  it("loadCanonical returns 401 without a valid x-loader-key", async () => {
    const body = JSON.stringify({
      json: {
        jurisdiction_id: TEST_JUR,
        sector_metrics: [
          {
            data: { jurisdiction_id: TEST_JUR, sector_code: "x", metric_key: "m", value: 1, period: "2099" },
            provenance: { origin: "live", source_id: "s" },
          },
        ],
      },
    });
    const res = await app.request("/api/trpc/jurisdictions.loadCanonical", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("loadCanonical loads a batch with the key and returns per-entity counts", async () => {
    await cleanup();
    const body = JSON.stringify({
      json: {
        jurisdiction_id: TEST_JUR,
        sector_metrics: [
          {
            data: { jurisdiction_id: TEST_JUR, sector_code: "economy", metric_key: "batch_metric", value: 7.7, period: "2099" },
            provenance: { origin: "live", source_id: "test_src", url: "https://example.org/b" },
          },
        ],
      },
    });
    const res = await app.request("/api/trpc/jurisdictions.loadCanonical", {
      method: "POST",
      headers: { "content-type": "application/json", "x-loader-key": TEST_KEY },
      body,
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as any;
    const env = payload.result.data.json ?? payload.result.data;
    const data = env.data ?? env;
    expect(data.counts.sector_metrics.inserted).toBe(1);
    const rows = await getDb()
      .select()
      .from(schema.sectorMetrics)
      .where(
        and(
          eq(schema.sectorMetrics.jurisdictionId, TEST_JUR),
          eq(schema.sectorMetrics.metricKey, "batch_metric"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe("live");
    await cleanup();
  });

  it("latestMetricsPreferringLive prefers live rows over seed per metric key", async () => {
    // The verified worldbank load landed live gdp_growth rows under "ng-kd";
    // the seed corpus has seed rows under "jur:ng-kd".
    const metrics = await latestMetricsPreferringLive("jur:ng-kd");
    const gdp = metrics.find((m) => m.metricKey === "gdp_growth");
    expect(gdp).toBeDefined();
    expect(gdp!.origin).toBe("live");
    expect(gdp!.sourceUrl).toContain("api.worldbank.org");
  });
});
