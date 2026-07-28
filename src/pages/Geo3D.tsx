import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import { Globe2, Map as MapIcon, TriangleAlert, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { unwrap } from "@/lib/trpc-data";
import { isProcedureMissing } from "@/lib/innovations-client";
import MapPanel, { type LgaDatum } from "@/components/shared/MapPanel";
import { SkeletonCard } from "@/components/shared/Skeleton";
import { useT } from "@/lib/LocaleContext";
import { cn } from "@/lib/utils";

/**
 * GEO-2 — 3D geospatial intelligence page.
 *
 * Wraps the lazy-loaded CesiumJS view (token-free: OSM imagery + WGS84
 * ellipsoid) with a 2D GeoJSON fallback, a low-bandwidth guard
 * (saveData / 2g ⇒ 2D by default with an explicit opt-in), a civic-ink
 * infobox per selected LGA, and static-GeoJSON fallback when the geo
 * service is unavailable. See docs/UI-3D.md.
 */

const Cesium3DView = lazy(() => import("@/components/geo/Cesium3DView"));

const JURISDICTION_ID = "jur:ng-kd";

interface LgaSummaryRow {
  unit_id: string;
  name: string;
  centroid_lat: number | null;
  centroid_lon: number | null;
  facility_count: number;
  by_type: Record<string, number>;
}

/** Never retry when the geo router is not deployed — fall back to static data. */
const geoRetry = (count: number, err: unknown) =>
  isProcedureMissing(err) ? false : count < 2;

const bareLga = (name: string) => name.replace(/ LGA$/, "");

/** Low-bandwidth guard: Data-Saver or a 2g-class effective type. */
function prefersReducedData(): boolean {
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return ["slow-2g", "2g"].includes(conn.effectiveType ?? "");
}

export default function Geo3D() {
  const t = useT();
  const reducedData = useMemo(prefersReducedData, []);
  const [mode, setMode] = useState<"2d" | "3d">(reducedData ? "2d" : "3d");
  const [optedIn, setOptedIn] = useState(false);
  const [selectedLga, setSelectedLga] = useState<string | null>(null);
  const [staticGeo, setStaticGeo] = useState<FeatureCollection | null>(null);

  /* Built-in boundaries — always available, used as fallback. */
  useEffect(() => {
    let cancelled = false;
    fetch("/geo/kaduna-lgas.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((fc: FeatureCollection) => !cancelled && setStaticGeo(fc))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* Live boundaries via tRPC, graceful fallback to the static GeoJSON. */
  const boundariesQuery = trpc.geo.boundaries.useQuery(
    { jurisdiction_id: JURISDICTION_ID },
    { staleTime: 600_000, retry: geoRetry },
  );
  // Structural bridge (same pattern as Opportunities' unwrapData): the
  // server envelope types GeoJSON geometry loosely — cast through unknown.
  const liveBoundaries = unwrap(
    boundariesQuery.data as unknown as null,
  ) as FeatureCollection | null;
  const boundaries =
    boundariesQuery.isError || !liveBoundaries?.features?.length
      ? staticGeo
      : liveBoundaries;
  const usingFallback = !!boundaries && boundaries === staticGeo;

  /* Per-LGA facility summary (drives extrusion heights + infobox). */
  const lgaSummaryQuery = trpc.geo.lgaSummary.useQuery(
    { jurisdiction_id: JURISDICTION_ID },
    { staleTime: 300_000, retry: geoRetry },
  );
  const lgaSummary = unwrap<{ items: LgaSummaryRow[] }>(lgaSummaryQuery.data);
  const summaryByName = useMemo(() => {
    const m = new Map<string, LgaSummaryRow>();
    for (const row of lgaSummary?.items ?? []) m.set(bareLga(row.name), row);
    return m;
  }, [lgaSummary]);
  const facilityCounts = useMemo<Record<string, number> | undefined>(() => {
    if (summaryByName.size === 0) return undefined;
    const rec: Record<string, number> = {};
    for (const [name, row] of summaryByName) rec[name] = row.facility_count;
    return rec;
  }, [summaryByName]);

  /* State-wide ranked opportunity count for the infobox. */
  const rankingsQuery = trpc.opportunities.rankings.useQuery(
    { jurisdiction_id: JURISDICTION_ID, limit: 100 },
    { staleTime: 30_000 },
  );
  const rankings = unwrap<{ items: unknown[] }>(rankingsQuery.data);
  const opportunityCount = rankings?.items.length;

  /* 2D map rows derived from the boundary polygons. */
  const lgaData = useMemo<LgaDatum[]>(() => {
    const counts = facilityCounts ?? {};
    const max = Math.max(1, ...Object.values(counts));
    return (boundaries?.features ?? []).map((f) => {
      const name = bareLga(
        String(f.properties?.name ?? f.properties?.lga ?? "?"),
      );
      return { id: name, name, value: (counts[name] ?? 0) / max };
    });
  }, [boundaries, facilityCounts]);

  const selected = selectedLga ? summaryByName.get(selectedLga) : undefined;
  const show3d = mode === "3d" && (!reducedData || optedIn);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="caption-label text-ink-muted">{t.geo3d.caption}</p>
          <h2 className="mt-1 text-xl font-semibold text-ink-primary">
            {t.geo3d.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            {t.geo3d.subtitle}
          </p>
        </div>

        {/* 2D / 3D toggle */}
        <div
          role="group"
          aria-label="Map dimension"
          className="flex rounded-md border border-ink-subtle bg-ink-surface p-0.5"
        >
          {(
            [
              { id: "2d", label: t.geo3d.view2d, Icon: MapIcon },
              { id: "3d", label: t.geo3d.view3d, Icon: Globe2 },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                mode === id
                  ? "bg-ink-elevated text-ink-primary"
                  : "text-ink-secondary hover:text-ink-primary",
              )}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {usingFallback && (
        <p className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <TriangleAlert aria-hidden className="mr-1.5 inline h-3.5 w-3.5" />
          {t.geo3d.boundariesFallback}
        </p>
      )}

      <div className="relative overflow-hidden rounded-lg border border-ink-subtle bg-ink-surface">
        {mode === "3d" && reducedData && !optedIn ? (
          /* Low-bandwidth guard: 2D map + explicit 3D opt-in. */
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-subtle bg-ink-elevated p-3">
              <div>
                <p className="text-sm font-medium text-ink-primary">
                  {t.geo3d.load3dTitle}
                </p>
                <p className="mt-0.5 max-w-xl text-xs text-ink-secondary">
                  {t.geo3d.load3dBody}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOptedIn(true)}
                className="flex items-center gap-1.5 rounded-md border border-civic/50 bg-civic/10 px-3 py-1.5 text-xs font-medium text-civic hover:bg-civic/20"
              >
                <Globe2 aria-hidden className="h-3.5 w-3.5" />
                {t.geo3d.load3dCta}
              </button>
            </div>
            <MapPanel
              title={t.geo3d.title}
              data={lgaData}
              geoJson={boundaries ?? undefined}
              values={facilityCounts}
              facilityCounts={facilityCounts}
              onSelectUnit={setSelectedLga}
              selectedUnit={selectedLga}
              legendLabel={t.geo3d.infoboxFacilities}
            />
          </div>
        ) : show3d ? (
          <div className="h-[540px]">
            <Suspense
              fallback={
                <div
                  className="flex h-full flex-col gap-3 p-4"
                  role="status"
                  aria-label={t.geo3d.loading3d}
                >
                  <span className="text-xs text-ink-muted">
                    {t.geo3d.loading3d}
                  </span>
                  <SkeletonCard className="flex-1" metric={false} lines={0} />
                </div>
              }
            >
              {boundaries ? (
                <Cesium3DView
                  geoJson={boundaries}
                  values={facilityCounts}
                  onSelect={setSelectedLga}
                />
              ) : (
                <div className="flex h-full flex-col gap-3 p-4" role="status">
                  <SkeletonCard className="flex-1" metric={false} lines={0} />
                </div>
              )}
            </Suspense>
          </div>
        ) : (
          <div className="p-4">
            <MapPanel
              title={t.geo3d.title}
              data={lgaData}
              geoJson={boundaries ?? undefined}
              values={facilityCounts}
              facilityCounts={facilityCounts}
              onSelectUnit={setSelectedLga}
              selectedUnit={selectedLga}
              legendLabel={t.geo3d.infoboxFacilities}
            />
          </div>
        )}
      </div>

      {/* Infobox — civic-ink panel for the selected LGA. */}
      <aside
        aria-live="polite"
        className="rounded-lg border border-ink-subtle bg-ink-elevated p-4"
      >
        {selectedLga ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink-primary">
                {selectedLga} LGA
              </h3>
              <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <dt className="caption-label text-ink-muted">
                    {t.geo3d.infoboxFacilities}
                  </dt>
                  <dd className="mt-0.5 font-mono text-lg text-civic">
                    {selected ? selected.facility_count : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="caption-label text-ink-muted">
                    {t.geo3d.infoboxOpportunities}
                  </dt>
                  <dd className="mt-0.5 font-mono text-lg text-civic">
                    {opportunityCount ?? "—"}
                  </dd>
                </div>
                {selected &&
                  Object.keys(selected.by_type ?? {}).length > 0 && (
                    <div>
                      <dt className="caption-label text-ink-muted">
                        {t.geo3d.infoboxByType}
                      </dt>
                      <dd className="mt-0.5 text-sm text-ink-secondary">
                        {Object.entries(selected.by_type)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 4)
                          .map(([type, n]) => `${type} · ${n}`)
                          .join("  ·  ")}
                      </dd>
                    </div>
                  )}
              </dl>
              {!selected && (
                <p className="mt-2 text-xs text-ink-muted">
                  {t.geo3d.infoboxNoData}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedLga(null)}
              aria-label={t.geo3d.close}
              className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-ink-surface hover:text-ink-primary"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <p className="text-sm text-ink-secondary">{t.geo3d.selectLga}</p>
        )}
      </aside>

      <p className="text-[11px] text-ink-muted">{t.geo3d.terrainNote}</p>
    </div>
  );
}
