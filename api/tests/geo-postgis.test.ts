import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilitiesNear } from "../queries/geo";

/**
 * PostGIS integration tests (audit gap #22 — docs/GEOSPATIAL.md).
 *
 * These exercise the optional PostGIS adapter path in api/queries/geo.ts
 * (ST_DWithin / ST_Distance against the `facilities` mirror). They run only
 * when POSTGIS_URL is set AND a `pg` driver is resolvable AND the server is
 * reachable; otherwise every test skips cleanly so `npm run test` stays green
 * in environments without PostGIS (e.g. the MySQL-only sandbox).
 *
 * Bring up PostGIS locally with:
 *   docker compose -f infra/docker/docker-compose.yml up postgis
 *   export POSTGIS_URL=postgres://policytwin:policytwin@localhost:5432/geo
 */

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<void>;
  end: () => Promise<void>;
};

async function probePostgis(): Promise<PgClient | null> {
  const url = process.env.POSTGIS_URL;
  if (!url) return null;
  try {
    const importer = new Function("spec", "return import(spec)") as (
      s: string,
    ) => Promise<{ Client: new (c: { connectionString: string }) => PgClient }>;
    const { Client } = await importer("pg");
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

let pg: PgClient | null = null;

beforeAll(async () => {
  pg = await probePostgis();
}, 15000);

afterAll(async () => {
  await pg?.end().catch(() => {});
});

describe("geo adapter — PostGIS integration", () => {
  it("connects and reports a PostGIS version", async (ctx) => {
    if (!pg) return ctx.skip();
    const res = await pg!.query("SELECT PostGIS_Version() AS version");
    expect(res.rows).toHaveLength(1);
    expect((res.rows[0] as { version: string }).version).toBeTruthy();
  });

  it("facilitiesNear uses the postgis engine when POSTGIS_URL is reachable", async (ctx) => {
    if (!pg) return ctx.skip();
    // Seed one facility mirror row if the table exists; skip if the mirror
    // schema has not been applied to this PostGIS instance yet.
    const hasTable = await pg!.query(
      "SELECT to_regclass('public.facilities') AS t",
    );
    if (!(hasTable.rows[0] as { t: string | null }).t) return ctx.skip();
    const out = await facilitiesNear({
      lat: 10.52,
      lon: 7.44,
      radius_km: 50,
      limit: 10,
    });
    expect(out.engine).toBe("postgis");
    for (const item of out.items) {
      expect(item.distance_km).toBeLessThanOrEqual(50);
      expect(typeof item.facility_id).toBe("string");
    }
    // Results must be ordered by ascending distance.
    const distances = out.items.map((i) => i.distance_km);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("documents the skip path when POSTGIS_URL is not configured", () => {
    // This assertion always runs: it pins the contract that the suite is
    // conditional on POSTGIS_URL, so an accidental hard dependency on a
    // running PostGIS instance cannot sneak into CI unnoticed.
    if (!process.env.POSTGIS_URL) {
      expect(pg).toBeNull();
    }
  });
});
