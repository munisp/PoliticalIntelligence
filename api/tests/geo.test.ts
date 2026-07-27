import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  boundaryFeatures,
  facilitiesNear,
  lgaSummary,
  pointInFeature,
} from "../queries/geo";
import type { GeoJsonFeatureCollection } from "@contracts/geo";

/** Geospatial tests (docs/GEOSPATIAL.md). Require the seeded dev DB. */

describe("geospatial layer", () => {
  it("kaduna-lgas.geojson artifact has 23 real LGA polygons with real centroids", () => {
    const fc = JSON.parse(
      readFileSync("public/geo/kaduna-lgas.geojson", "utf8"),
    ) as GeoJsonFeatureCollection;
    expect(fc.features).toHaveLength(23);
    const zaria = fc.features.find((f) => f.properties.lga === "Zaria");
    expect(zaria).toBeDefined();
    expect(Math.abs((zaria!.properties.centroid_lat as number) - 11.08)).toBeLessThan(0.1);
    expect(Math.abs((zaria!.properties.centroid_lon as number) - 7.72)).toBeLessThan(0.1);
    expect(zaria!.geometry.type).toMatch(/Polygon/);
  });

  it("nigeria-states.geojson artifact has 37 real state polygons (36 + FCT)", () => {
    const fc = JSON.parse(
      readFileSync("public/geo/nigeria-states.geojson", "utf8"),
    ) as GeoJsonFeatureCollection;
    expect(fc.features).toHaveLength(37);
    const names = fc.features.map((f) => f.properties.name);
    expect(names).toContain("Kaduna");
    expect(names).toContain("Federal Capital Territory");
  });

  it("geo.boundaries returns 23 LGA features for jur:ng-kd from geo_boundaries", async () => {
    const fc = await boundaryFeatures("jur:ng-kd");
    expect(fc.features).toHaveLength(23);
    const zaria = fc.features.find((f) => f.properties.unit_id === "adm:ng-kd-zaria");
    expect(zaria).toBeDefined();
    // Zaria's real centroid lies inside its own polygon.
    const p = zaria!.properties;
    expect(
      pointInFeature(p.centroid_lon as number, p.centroid_lat as number, zaria!),
    ).toBe(true);
  });

  it("facilitiesNear finds seeded facilities around Zaria (haversine fallback)", async () => {
    const res = await facilitiesNear({
      lat: 11.03,
      lon: 7.68,
      radius_km: 5,
      limit: 10,
    });
    expect(["mysql", "postgis"]).toContain(res.engine);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0].distance_km).toBeLessThanOrEqual(5);
    const typed = await facilitiesNear({
      lat: 11.03,
      lon: 7.68,
      radius_km: 5,
      type: "school",
      limit: 10,
    });
    expect(typed.items.every((f) => f.type === "school")).toBe(true);
  });

  it("lgaSummary attributes facilities to LGAs via real polygons", async () => {
    const res = await lgaSummary("jur:ng-kd");
    expect(res.items).toHaveLength(23);
    const zaria = res.items.find((i) => i.unit_id === "adm:ng-kd-zaria");
    expect(zaria).toBeDefined();
    expect(zaria!.facility_count).toBeGreaterThan(0);
    const total = res.items.reduce((n, i) => n + i.facility_count, 0);
    expect(total).toBeGreaterThanOrEqual(69);
  });
});
