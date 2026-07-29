import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spatialJoin, withinKm, containsFallback, withinKmFallback } from "../bridges/geoRs";
import { geoRouter } from "../geo";
import type { TrpcContext } from "../context";
import type { GeoJsonFeatureCollection } from "@contracts/geo";

/**
 * geo-rs bridge tests (docs/GEOSPATIAL.md §6). GEO_RS_URL is unset in CI,
 * so every assertion exercises the honest TS fallback path; the remote
 * contract is pinned by shape checks + the Rust suite in services/geo-rs.
 */

const states = JSON.parse(
  readFileSync("public/geo/nigeria-states.geojson", "utf8"),
) as GeoJsonFeatureCollection;

describe("geoRs bridge — fallback kernels", () => {
  it("containsFallback: Zaria is inside Kaduna", () => {
    const hits = containsFallback(states, [[7.68, 11.03], [0, 0]]);
    expect(hits).toHaveLength(2);
    expect(hits[0].properties?.name).toBe("Kaduna");
    expect(hits[1].properties).toBeNull();
  });

  it("withinKmFallback: corridor filter with honesty method", () => {
    const matches = withinKmFallback({
      line_geojson: {
        type: "LineString",
        coordinates: [
          [7.68, 11.03],
          [7.44, 10.52],
        ],
      },
      features_geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { tag: "zaria" },
            geometry: { type: "Point", coordinates: [7.71, 11.08] },
          },
          {
            type: "Feature",
            properties: { tag: "lagos" },
            geometry: { type: "Point", coordinates: [3.39, 6.45] },
          },
        ],
      },
      km: 25,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].properties.tag).toBe("zaria");
    expect(matches[0].distance_km).toBeLessThan(25);
  });
});

describe("geoRs bridge — remote-first wrapper", () => {
  it("spatialJoin falls back with geo_engine honesty marker when GEO_RS_URL unset", async () => {
    delete process.env.GEO_RS_URL;
    const res = await spatialJoin({ polygon_geojson: states, points: [[7.68, 11.03]] });
    expect(res.geo_engine).toBe("ts_fallback");
    expect(res.polygon_count).toBe(37);
    expect(res.results[0].properties?.name).toBe("Kaduna");
  });

  it("spatialJoin falls back when the remote is unreachable", async () => {
    process.env.GEO_RS_URL = "http://127.0.0.1:1";
    const res = await spatialJoin({ polygon_geojson: states, points: [[7.68, 11.03]] });
    expect(res.geo_engine).toBe("ts_fallback");
    delete process.env.GEO_RS_URL;
  });

  it("withinKm falls back and returns the documented method", async () => {
    delete process.env.GEO_RS_URL;
    const res = await withinKm({
      point: [7.44, 10.52],
      features_geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { tag: "kaduna-city" },
            geometry: { type: "Point", coordinates: [7.44, 10.52] },
          },
        ],
      },
      km: 1,
    });
    expect(res.geo_engine).toBe("ts_fallback");
    expect(res.matches).toHaveLength(1);
    expect(res.method).toContain("haversine");
  });
});

describe("geo router procedures — envelope", () => {
  const ctx: TrpcContext = {
    req: new Request("http://test.local/"),
    resHeaders: new Headers(),
  };

  it("geo.spatialJoin returns standard envelope {data, meta}", async () => {
    delete process.env.GEO_RS_URL;
    const caller = geoRouter.createCaller(ctx);
    const res = await caller.spatialJoin({
      polygon_geojson: states,
      points: [[7.68, 11.03]],
    });
    expect(res.meta.request_id).toMatch(/^req_/);
    expect(res.meta.api_version).toBeDefined();
    expect(res.data.geo_engine).toBe("ts_fallback");
    expect(res.data.results[0].properties?.name).toBe("Kaduna");
  });

  it("geo.withinKm validates input (point or line required)", async () => {
    const caller = geoRouter.createCaller(ctx);
    await expect(
      caller.withinKm({
        features_geojson: { type: "FeatureCollection", features: [] },
        km: 5,
      } as never),
    ).rejects.toThrow();
  });
});
