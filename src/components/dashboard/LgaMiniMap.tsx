/**
 * Compact real-polygon LGA choropleth for the Executive Dashboard sector
 * panel (additive). Uses the same geo API queries as the Opportunity
 * Explorer (geo.boundaries + geo.lgaSummary); degrades to nothing
 * (null render) when the geo router is unavailable — the dashboard has
 * its own KPI fallbacks and should never break on this block.
 */
import { useMemo } from "react";
import type { FeatureCollection } from "geojson";
import { trpc } from "@/providers/trpc";
import { unwrapData } from "@/components/opportunities/types";
import { isProcedureMissing } from "@/lib/innovations-client";
import MapPanel, { type LgaDatum } from "@/components/shared/MapPanel";
import { SkeletonCard } from "@/components/shared/Skeleton";

const JURISDICTION_ID = "jur:ng-kd";

interface LgaSummaryRow {
  unit_id: string;
  name: string;
  facility_count: number;
}

const geoRetry = (count: number, err: unknown) =>
  isProcedureMissing(err) ? false : count < 2;

export default function LgaMiniMap() {
  const boundariesQuery = trpc.geo.boundaries.useQuery(
    { jurisdiction_id: JURISDICTION_ID },
    { staleTime: 600_000, retry: geoRetry },
  );
  const summaryQuery = trpc.geo.lgaSummary.useQuery(
    { jurisdiction_id: JURISDICTION_ID },
    { staleTime: 300_000, retry: geoRetry },
  );

  const boundaries = unwrapData<FeatureCollection>(boundariesQuery.data);
  const summary = unwrapData<{ items: LgaSummaryRow[] }>(summaryQuery.data);

  const { data, values } = useMemo(() => {
    const items = summary?.items ?? [];
    const values: Record<string, number> = {};
    const data: LgaDatum[] = items.map((row) => {
      const name = row.name.replace(/ LGA$/, "");
      values[name] = row.facility_count;
      return { id: row.unit_id, name, value: row.facility_count };
    });
    return { data, values };
  }, [summary]);

  // Graceful degradation: hide the block entirely if the geo API is missing.
  if (boundariesQuery.isError || summaryQuery.isError) return null;
  if (!boundaries?.features?.length) {
    return boundariesQuery.isLoading || summaryQuery.isLoading ? (
      <SkeletonCard lines={3} metric={false} />
    ) : null;
  }

  const sourceUrl = boundaries.features[0]?.properties?.source_url;

  return (
    <MapPanel
      title="LGA facility coverage"
      data={data}
      geoJson={boundaries}
      values={values}
      facilityCounts={values}
      provenanceUrl={typeof sourceUrl === "string" ? sourceUrl : null}
      legendLabel="Facilities per LGA"
      mapHeight={220}
      className="[&_section]:bg-ink-surface"
    />
  );
}
