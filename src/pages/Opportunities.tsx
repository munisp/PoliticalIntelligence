import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import {
  GitCompareArrows,
  RotateCcw,
  Sparkles,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { Toaster } from "@/components/ui/sonner";
import type { FeatureCollection } from "geojson";
import FilterBar, { type FilterBarValue } from "@/components/shared/FilterBar";
import MapPanel, {
  type LgaDatum,
  type MapMarker,
} from "@/components/shared/MapPanel";
import EmbedButton from "@/components/opportunities/EmbedButton";
import { isProcedureMissing } from "@/lib/innovations-client";
import { useT } from "@/lib/LocaleContext";
import OfflineBoundary from "@/lib/OfflineBoundary";
import EvidenceDrawer, {
  type EvidenceSource,
} from "@/components/shared/EvidenceDrawer";
import EmptyState from "@/components/shared/EmptyState";
import StatusDot from "@/components/shared/StatusDot";
import RankingRow, { SkeletonRankingRow } from "@/components/opportunities/RankingRow";
import { ProvenanceChipFromInfo } from "@/components/provenance";
import CompareTray from "@/components/opportunities/CompareTray";
import CompareView from "@/components/opportunities/CompareView";
import GenerateModal from "@/components/opportunities/GenerateModal";
import {
  baseOpportunityScore,
  costPerJob,
  facilityCountByType,
  formatDate,
  lgaLayerValue,
  metaOf,
  unwrapData,
  MAP_LAYERS,
  type AdminUnitNode,
  type GenerateStatusPayload,
  type JobStatus,
  type MapLayer,
  type OpportunityDetail,
  type OpportunityItem,
  type RankingsPage,
  type SectorRow,
} from "@/components/opportunities/types";

const JURISDICTION_ID = "jur:ng-kd";
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

const DEFAULT_FILTERS: FilterBarValue = {
  sectors: [],
  geography: JURISDICTION_ID,
  horizon: 5,
  confidenceFloor: 0.5,
};

type SortId = "score" | "jobs" | "cost" | "freshness";

const SORT_OPTION_IDS = ["score", "jobs", "cost", "freshness"] as const;

const SAVED_VIEWS = [
  { id: "sme-pipeline", label: "My views: SME pipeline" },
  { id: "edu-fy25", label: "My views: Education FY25" },
];

const TERMINAL_JOB_STATES: JobStatus[] = ["succeeded", "failed", "canceled"];

/** Per-LGA facility summary row (geo.lgaSummary envelope payload). */
interface LgaSummaryRow {
  unit_id: string;
  name: string;
  centroid_lat: number | null;
  centroid_lon: number | null;
  facility_count: number;
  by_type: Record<string, number>;
}

/** Facility row (geo.facilitiesNear envelope payload). */
interface FacilityNearRow {
  facility_id: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  distance_km: number;
}

/** Retry policy: never retry when the geo router is not deployed yet —
 *  the map then degrades gracefully to the derived SVG grid. */
const geoRetry = (count: number, err: unknown) =>
  isProcedureMissing(err) ? false : count < 2;

const bareLga = (name: string) => name.replace(/ LGA$/, "");

/** Parse a citation string into drawer source fields. */
function toEvidenceSource(row: {
  evidenceSourceId: string;
  sourceType: string;
  citation: string;
  confidence: number;
  createdAt: string | Date;
}): EvidenceSource {
  const acronym = row.citation.match(/^([A-Z]{2,6})\b/);
  const issuer =
    acronym?.[1] ??
    (row.sourceType === "document"
      ? "Policy document"
      : row.sourceType === "graph"
        ? "Dependency graph"
        : "State data platform");
  const year = row.citation.match(/\b(19|20)\d{2}\b/);
  return {
    id: row.evidenceSourceId,
    title: row.citation,
    issuer,
    date: year ? year[0] : formatDate(row.createdAt),
    relevance: row.confidence,
  };
}

function freshnessFor(
  updatedAt: string | Date,
  t: ReturnType<typeof useT>,
): {
  status: "healthy" | "stale" | "failing";
  label: string;
} {
  const d = typeof updatedAt === "string" ? new Date(updatedAt) : updatedAt;
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (days <= 7)
    return {
      status: "healthy",
      label: t.opportunities.freshEvidence.replace("{date}", formatDate(d)),
    };
  if (days <= 30)
    return {
      status: "stale",
      label: t.opportunities.staleEvidence.replace("{date}", formatDate(d)),
    };
  return {
    status: "failing",
    label: t.opportunities.failingEvidence.replace("{date}", formatDate(d)),
  };
}

export default function Opportunities() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const t = useT();

  /* ------------------------------ state ------------------------------ */
  const [filters, setFilters] = useState<FilterBarValue>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortId>("score");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"list" | "map">("list");
  const [layer, setLayer] = useState<MapLayer>("opportunity");
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const notifiedJob = useRef<string | null>(null);

  /* ----------------------------- queries ----------------------------- */
  const rankingsQuery = trpc.opportunities.rankings.useQuery(
    { jurisdiction_id: JURISDICTION_ID, limit: 100 },
    { staleTime: 30_000 },
  );
  const rankings = unwrapData<RankingsPage>(rankingsQuery.data);
  const allItems = useMemo(() => rankings?.items ?? [], [rankings]);

  const sectorsQuery = trpc.sectors.list.useQuery(undefined, {
    staleTime: 300_000,
  });
  const sectors = unwrapData<SectorRow[]>(sectorsQuery.data) ?? [];
  const sectorName = useCallback(
    (code: string) => sectors.find((s) => s.sectorCode === code)?.name ?? code,
    [sectors],
  );
  const codeForName = useCallback(
    (name: string) => sectors.find((s) => s.name === name)?.sectorCode ?? name,
    [sectors],
  );

  const geoQuery = trpc.jurisdictions.geoUnits.useQuery(
    { jurisdiction_id: JURISDICTION_ID },
    { staleTime: 300_000 },
  );
  const geoUnits = unwrapData<AdminUnitNode[]>(geoQuery.data) ?? [];

  /* ---------------- geo API: real boundaries + facility summary -------- */
  const boundariesQuery = trpc.geo.boundaries.useQuery(
    { jurisdiction_id: JURISDICTION_ID },
    { staleTime: 600_000, retry: geoRetry },
  );
  const boundaries = unwrapData<FeatureCollection>(boundariesQuery.data);
  const boundariesOk =
    !boundariesQuery.isError && (boundaries?.features?.length ?? 0) > 0;
  const provenanceUrl = useMemo(() => {
    const u = boundaries?.features?.[0]?.properties?.source_url;
    return typeof u === "string" ? u : null;
  }, [boundaries]);

  const lgaSummaryQuery = trpc.geo.lgaSummary.useQuery(
    { jurisdiction_id: JURISDICTION_ID },
    { staleTime: 300_000, retry: geoRetry },
  );
  const lgaSummary = unwrapData<{ items: LgaSummaryRow[] }>(
    lgaSummaryQuery.data,
  );
  const summaryByName = useMemo(() => {
    const m = new Map<string, LgaSummaryRow>();
    for (const row of lgaSummary?.items ?? []) m.set(bareLga(row.name), row);
    return m;
  }, [lgaSummary]);

  /** Real per-LGA facility counts (drives choropleth + tooltips). */
  const facilityCounts = useMemo<Record<string, number> | undefined>(() => {
    if (summaryByName.size === 0) return undefined;
    const rec: Record<string, number> = {};
    for (const [name, row] of summaryByName) rec[name] = row.facility_count;
    return rec;
  }, [summaryByName]);

  /** Real per-LGA school counts from the facility type breakdown. */
  const schoolCounts = useMemo<Record<string, number> | undefined>(() => {
    if (summaryByName.size === 0) return undefined;
    const rec: Record<string, number> = {};
    let any = false;
    for (const [name, row] of summaryByName) {
      rec[name] = facilityCountByType(row.by_type, /school|education|academy/i);
      if (rec[name] > 0) any = true;
    }
    return any ? rec : undefined;
  }, [summaryByName]);

  /** Raw values that drive the real choropleth where the geo API provides
   *  them; other layers keep the deterministic derived 0–1 index. */
  const mapValues = useMemo<Record<string, number> | undefined>(() => {
    if (layer === "facilities") return facilityCounts;
    if (layer === "schools") return schoolCounts;
    return undefined;
  }, [layer, facilityCounts, schoolCounts]);


  const lgaUnits = useMemo(
    () => geoUnits.filter((u) => u.adminLevel === "lga" || u.children.length === 0),
    [geoUnits],
  );

  const geographies = useMemo(
    () => [
      { id: JURISDICTION_ID, label: t.opportunities.allLgas },
      ...lgaUnits.map((u) => ({ id: u.adminUnitId, label: `› ${u.name}` })),
    ],
    [lgaUnits],
  );

  const selectedLga = lgaUnits.find((u) => u.adminUnitId === filters.geography);
  const selectedLgaName = selectedLga?.name.replace(/ LGA$/, "") ?? null;

  /* ------------- facilities-near-me markers (facilities layer) --------- */
  const nearCenter = useMemo(() => {
    const sel = selectedLgaName ? summaryByName.get(selectedLgaName) : undefined;
    if (sel?.centroid_lat != null && sel.centroid_lon != null)
      return { lat: sel.centroid_lat, lon: sel.centroid_lon, radius: 25 };
    const pts = [...summaryByName.values()].filter(
      (r) => r.centroid_lat != null && r.centroid_lon != null,
    );
    if (pts.length === 0) return null;
    return {
      lat: pts.reduce((a, r) => a + (r.centroid_lat ?? 0), 0) / pts.length,
      lon: pts.reduce((a, r) => a + (r.centroid_lon ?? 0), 0) / pts.length,
      radius: 60,
    };
  }, [summaryByName, selectedLgaName]);

  const facilitiesNearQuery = trpc.geo.facilitiesNear.useQuery(
    {
      lat: nearCenter?.lat ?? 0,
      lon: nearCenter?.lon ?? 0,
      radius_km: nearCenter?.radius ?? 25,
      limit: 100,
    },
    {
      enabled: layer === "facilities" && nearCenter != null,
      staleTime: 300_000,
      retry: geoRetry,
    },
  );
  const facilityMarkers = useMemo<MapMarker[]>(() => {
    const rows =
      (unwrapData<FacilityNearRow[]>(facilitiesNearQuery.data) ?? []).filter(
        (f) => Number.isFinite(f.lat) && Number.isFinite(f.lon),
      );
    return rows.map((f) => ({
      lat: f.lat,
      lon: f.lon,
      label: f.name,
      type: f.type,
    }));
  }, [facilitiesNearQuery.data]);

  /* --------------------- filtering, sorting, mapping ------------------ */
  const visibleItems = useMemo(() => {
    const selectedCodes = new Set(filters.sectors.map(codeForName));
    const horizonMonths = filters.horizon * 12;
    const filtered = allItems.filter(
      (o) =>
        (selectedCodes.size === 0 || selectedCodes.has(o.sectorCode)) &&
        o.confidence >= filters.confidenceFloor &&
        (o.horizonMonths == null || o.horizonMonths <= horizonMonths),
    );
    const by: Record<SortId, (a: OpportunityItem, b: OpportunityItem) => number> = {
      score: (a, b) => b.score - a.score,
      jobs: (a, b) => (b.estimatedJobsMax ?? 0) - (a.estimatedJobsMax ?? 0),
      cost: (a, b) =>
        (costPerJob(a) ?? Number.MAX_SAFE_INTEGER) -
        (costPerJob(b) ?? Number.MAX_SAFE_INTEGER),
      freshness: (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    };
    return [...filtered].sort(by[sort]);
  }, [allItems, filters, sort, codeForName]);

  const generatedDate = useMemo(() => {
    if (allItems.length === 0) return null;
    return allItems.reduce((latest, o) => {
      const t = new Date(o.updatedAt).getTime();
      return t > latest ? t : latest;
    }, 0);
  }, [allItems]);

  const floorAboveData =
    allItems.length > 0 &&
    filters.confidenceFloor > Math.max(...allItems.map((o) => o.confidence));

  const mapData = useMemo<LgaDatum[]>(() => {
    const base = baseOpportunityScore(visibleItems);
    const rows = lgaUnits.map((u) => {
      const name = u.name.replace(/ LGA$/, "");
      return {
        id: u.adminUnitId,
        name,
        value: lgaLayerValue(layer, name, base),
        hotspot: selectedLga?.adminUnitId === u.adminUnitId,
      };
    });
    if (layer === "opportunity" && rows.length > 0 && !selectedLga) {
      const top = rows.reduce((a, b) => (b.value > a.value ? b : a));
      top.hotspot = true;
    }
    return rows;
  }, [lgaUnits, visibleItems, layer, selectedLga]);

  /* --------------------------- compare logic --------------------------- */
  const toggleCompare = useCallback(
    (id: string) => {
      setCompareIds((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length >= 3) {
          toast.warning(t.opportunities.compareTrayFull, {
            description: t.opportunities.compareTrayFullDesc,
          });
          return prev;
        }
        return [...prev, id];
      });
    },
    [],
  );
  const compareItems = useMemo(() => {
    const byId = new Map(allItems.map((o) => [o.opportunityId, o]));
    return compareIds.map((id) => byId.get(id)).filter((o): o is OpportunityItem => !!o);
  }, [compareIds, allItems]);

  /* -------------------------- evidence drawer -------------------------- */
  const evidenceQuery = trpc.opportunities.get.useQuery(
    { opportunity_id: evidenceFor ?? "" },
    { enabled: evidenceFor != null, staleTime: 60_000 },
  );
  const evidenceDetail = unwrapData<OpportunityDetail>(evidenceQuery.data);
  const evidenceMeta = metaOf(evidenceQuery.data);
  const evidenceItem =
    allItems.find((o) => o.opportunityId === evidenceFor) ?? null;

  /* --------------------------- generation job --------------------------- */
  const jobQuery = trpc.opportunities.generateStatus.useQuery(
    { job_id: activeJobId ?? "" },
    {
      enabled: activeJobId != null,
      refetchInterval: (q) => {
        const s = unwrapData<GenerateStatusPayload>(q.state.data)?.status;
        return s && TERMINAL_JOB_STATES.includes(s) ? false : 3000;
      },
    },
  );
  const jobStatus = unwrapData<GenerateStatusPayload>(jobQuery.data);

  useEffect(() => {
    if (!jobStatus || !activeJobId || notifiedJob.current === activeJobId) return;
    if (jobStatus.status === "succeeded") {
      notifiedJob.current = activeJobId;
      toast.success(t.opportunities.generationComplete, {
        description: t.opportunities.generationCompleteDesc,
      });
      void utils.opportunities.rankings.invalidate();
      setActiveJobId(null);
    } else if (jobStatus.status === "failed" || jobStatus.status === "canceled") {
      notifiedJob.current = activeJobId;
      toast.error(t.opportunities.generationFailed.replace("{status}", jobStatus.status), {
        description: jobStatus.error ?? t.opportunities.generationFailedDesc,
      });
      setActiveJobId(null);
    }
  }, [jobStatus, activeJobId, utils]);

  /* ----------------------------- handlers ----------------------------- */
  const applyFilters = (next: FilterBarValue) => {
    if (next.savedView && next.savedView !== filters.savedView) {
      if (next.savedView === "sme-pipeline") {
        setFilters({
          sectors: ["SME Formation"],
          geography: JURISDICTION_ID,
          horizon: 3,
          confidenceFloor: 0.5,
          savedView: next.savedView,
        });
        setSort("jobs");
        return;
      }
      if (next.savedView === "edu-fy25") {
        setFilters({
          sectors: ["Education"],
          geography: JURISDICTION_ID,
          horizon: 1,
          confidenceFloor: 0.5,
          savedView: next.savedView,
        });
        setSort("score");
        return;
      }
    }
    setFilters(next);
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSort("score");
  };

  const simulate = (id: string) =>
    navigate(`/simulation?opportunity=${encodeURIComponent(id)}`);

  /** Click on a boundary polygon → scope the explorer to that LGA. */
  const onSelectUnit = useCallback(
    (name: string) => {
      const unit = lgaUnits.find((u) => bareLga(u.name) === name);
      if (unit)
        applyFilters({ ...filters, geography: unit.adminUnitId });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lgaUnits, filters],
  );

  const geographyPath = selectedLgaName
    ? `${t.common.jurisdiction} › ${selectedLgaName}`
    : t.opportunities.allLgasPath;

  /* ----------------------- keyboard list navigation --------------------- */
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-opportunity-id]",
    );
    if (!rowEl) return;
    const id = rowEl.dataset.opportunityId!;
    const idx = visibleItems.findIndex((o) => o.opportunityId === id);
    if (idx < 0) return;
    const focusRow = (i: number) => {
      const el = rowRefs.current.get(visibleItems[i]?.opportunityId ?? "");
      el?.querySelector<HTMLElement>('[role="button"]')?.focus();
    };
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(Math.min(idx + 1, visibleItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(Math.max(idx - 1, 0));
    } else if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      toggleCompare(id);
    } else if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      setEvidenceFor(id);
    }
  };

  /* ------------------------------ render ------------------------------ */
  const rankingList = (
    <div className="space-y-2" onKeyDown={onListKeyDown} aria-label={t.opportunities.rankedOpportunities}>
      {rankingsQuery.isLoading &&
        Array.from({ length: 6 }).map((_, i) => <SkeletonRankingRow key={i} />)}

      {rankingsQuery.isError && (
        <EmptyState
          title={t.opportunities.errorRankings}
          guidance={rankingsQuery.error.message}
          showSpotArt={false}
          action={{ label: t.action.retry, onClick: () => void rankingsQuery.refetch() }}
        />
      )}

      {!rankingsQuery.isLoading && !rankingsQuery.isError && visibleItems.length === 0 && (
        <EmptyState
          title={t.opportunities.emptyTitle}
          guidance={t.opportunities.emptyGuidance}
          action={{ label: t.action.reset, onClick: resetFilters }}
        />
      )}

      {visibleItems.map((o, i) => (
        /* INNOVATIONS-PROVENANCE: additive wrapper — chip overlays the row's
           chip area without touching the shared RankingRow component. */
        <div key={o.opportunityId} className="relative">
        {/* I2 — per-opportunity embed widget (docs/EMBED.md) */}
        <div className="absolute bottom-2 right-12 z-10">
          <EmbedButton opportunityId={o.opportunityId} />
        </div>
        {(o as { provenance?: import("@/lib/innovations-client").ProvenanceInfo }).provenance && (
          <div className="pointer-events-none absolute right-12 top-2 z-10">
            <div className="pointer-events-auto">
              <ProvenanceChipFromInfo
                provenance={(o as { provenance?: import("@/lib/innovations-client").ProvenanceInfo }).provenance}
              />
            </div>
          </div>
        )}
        <RankingRow
          ref={(el) => {
            if (el) rowRefs.current.set(o.opportunityId, el);
            else rowRefs.current.delete(o.opportunityId);
          }}
          rank={i + 1}
          item={o}
          sectorName={sectorName(o.sectorCode)}
          geographyPath={geographyPath}
          expanded={expandedId === o.opportunityId}
          inCompare={compareIds.includes(o.opportunityId)}
          compareFull={compareIds.length >= 3}
          onToggle={() =>
            setExpandedId((cur) => (cur === o.opportunityId ? null : o.opportunityId))
          }
          onOpenEvidence={() => setEvidenceFor(o.opportunityId)}
          onSimulate={() => simulate(o.opportunityId)}
          onToggleCompare={() => toggleCompare(o.opportunityId)}
        />
        </div>
      ))}
    </div>
  );

  const mapPanel = (
    <div className="space-y-2 lg:sticky lg:top-[88px]">
      <div
        role="group"
        aria-label={t.opportunities.mapLayers}
        className="flex flex-wrap items-center gap-1.5"
      >
        {MAP_LAYERS.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={layer === l.id}
            onClick={() => setLayer(l.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              layer === l.id
                ? "border-civic bg-civic/10 text-civic"
                : "border-ink-subtle bg-ink-surface text-ink-secondary hover:border-ink-strong",
            )}
          >
            {l.label}
          </button>
        ))}
      </div>
      <MapPanel
        title={t.opportunities.mapTitle}
        data={mapData}
        geoJson={boundariesOk && boundaries ? boundaries : undefined}
        values={mapValues}
        facilityCounts={facilityCounts}
        onSelectUnit={onSelectUnit}
        selectedUnit={selectedLgaName}
        markers={layer === "facilities" ? facilityMarkers : undefined}
        provenanceUrl={provenanceUrl}
        legendLabel={MAP_LAYERS.find((l) => l.id === layer)?.legend}
      />
      {layer === "facilities" && facilitiesNearQuery.isError && (
        <p className="text-[11px] text-ink-muted" role="status">
          {t.opportunities.markersUnavailable}
        </p>
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="space-y-4 pb-24"
    >
      <Toaster position="bottom-right" theme="dark" richColors={false} />

      {/* --------------------------- Page header --------------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="caption-label text-ink-muted">
            {t.opportunities.caption}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
            {t.opportunities.title}
          </h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {t.opportunities.subtitle.replace("{count}", String(allItems.length))}
            {generatedDate ? ` · ${t.opportunities.generatedAt.replace("{date}", formatDate(new Date(generatedDate)))}` : ""}
          </p>
          {/* Live async job status (aria-live per design.md §6) */}
          <div aria-live="polite" className="mt-1.5 min-h-5">
            {activeJobId && jobStatus && (
              <span className="inline-flex items-center gap-2 rounded-full border border-ink-subtle bg-ink-surface px-2.5 py-1">
                <StatusDot
                  status={jobStatus.status === "queued" ? "queued" : "running"}
                />
                <span className="font-mono text-[11px] text-ink-muted">
                  {activeJobId}
                  {jobStatus.progress != null ? ` · ${jobStatus.progress}%` : ""}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (compareIds.length >= 2) setCompareOpen(true);
              else if (compareIds.length > 0)
                toast.info(t.opportunities.compareMinTwo);
              else
                toast.info(t.opportunities.compareHowTo);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:border-ink-strong hover:text-ink-primary"
          >
            <GitCompareArrows aria-hidden className="h-4 w-4" />
            {t.opportunities.compare} ({compareIds.length}/3)
          </button>
          <button
            type="button"
            onClick={() => setGenerateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3.5 py-1.5 text-sm font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98]"
          >
            <Sparkles aria-hidden className="h-4 w-4" />
            {t.opportunities.generate}
          </button>
        </div>
      </header>

      {compareOpen && compareIds.length >= 2 ? (
        <CompareView
          ids={compareIds}
          sectorName={sectorName}
          onBack={() => setCompareOpen(false)}
          onSimulate={simulate}
          onOpenEvidence={setEvidenceFor}
        />
      ) : (
        <>
          {/* ---------------------------- FilterBar ---------------------------- */}
          <div>
            <FilterBar
              sectors={sectors.map((s) => s.name)}
              geographies={geographies}
              savedViews={SAVED_VIEWS}
              value={filters}
              onChange={applyFilters}
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2">
                <ArrowUpDown aria-hidden className="h-3.5 w-3.5 text-ink-muted" />
                <span className="caption-label text-ink-muted">{t.opportunities.sort}</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortId)}
                  className="rounded-md border border-ink-subtle bg-ink-surface px-2 py-1 text-xs text-ink-primary"
                >
                  {SORT_OPTION_IDS.map((id) => (
                    <option key={id} value={id}>
                      {{ score: t.opportunities.sortScore, jobs: t.opportunities.sortJobs, cost: t.opportunities.sortCost, freshness: t.opportunities.sortFreshness }[id]}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-ink-secondary" aria-live="polite">
                <span className="font-mono text-ink-primary">{visibleItems.length}</span>{" "}
                {t.opportunities.resultsCount}
              </span>
              {selectedLgaName && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-civic/50 bg-civic/10 px-2.5 py-0.5 text-[11px] font-medium text-civic">
                  {selectedLgaName} LGA
                  <button
                    type="button"
                    onClick={() => applyFilters({ ...filters, geography: JURISDICTION_ID })}
                    aria-label={t.opportunities.clearGeography.replace("{name}", selectedLgaName)}
                    className="rounded-full text-civic/80 hover:text-civic-strong"
                  >
                    ×
                  </button>
                </span>
              )}
              {floorAboveData && (
                <span className="text-[11px] text-status-warning">
                  {t.opportunities.floorAboveData}
                </span>
              )}
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink-primary"
              >
                <RotateCcw aria-hidden className="h-3 w-3" />
                {t.action.reset}
              </button>
            </div>
          </div>

          {/* Mobile / tablet: List | Map tabs (map is sticky side panel ≥1280px) */}
          <div className="flex gap-1.5 lg:hidden" role="tablist" aria-label={t.opportunities.explorerView}>
            {(["list", "map"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={mobileTab === tab}
                onClick={() => setMobileTab(tab)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium capitalize",
                  mobileTab === tab
                    ? "border-civic bg-civic/10 text-civic"
                    : "border-ink-subtle bg-ink-surface text-ink-secondary",
                )}
              >
                {tab === "list" ? t.opportunities.listTab : t.opportunities.mapTab}
              </button>
            ))}
          </div>

          {/* --------------------- Main: list (7) + map (5) --------------------- */}
          <div className="grid gap-4 lg:grid-cols-12">
            <section
              aria-label={t.opportunities.rankedListAria}
              className={cn("lg:col-span-7", mobileTab === "map" && "hidden lg:block")}
            >
              <OfflineBoundary
                isLoading={rankingsQuery.isLoading}
                hasData={allItems.length > 0}
                onRetry={() => void rankingsQuery.refetch()}
                label={t.opportunities.rankedOpportunities}
              >
                {rankingList}
              </OfflineBoundary>
            </section>
            <section
              aria-label={t.opportunities.mapAria}
              className={cn("lg:col-span-5", mobileTab === "list" && "hidden lg:block")}
            >
              {mapPanel}
            </section>
          </div>
        </>
      )}

      {/* ----------------------------- Overlays ----------------------------- */}
      <CompareTray
        items={compareItems}
        onRemove={(id) => setCompareIds((p) => p.filter((x) => x !== id))}
        onCompareNow={() => setCompareOpen(true)}
        onClear={() => setCompareIds([])}
      />

      <EvidenceDrawer
        open={evidenceFor != null}
        onClose={() => setEvidenceFor(null)}
        title={evidenceItem?.title ?? t.opportunities.evidenceTitle}
        sources={(evidenceDetail?.evidence_bundle ?? []).map(toEvidenceSource)}
        excerpts={(evidenceDetail?.evidence_bundle ?? [])
          .filter((e) => e.contentExcerpt)
          .map((e) => ({
            sourceId: e.evidenceSourceId,
            text: e.contentExcerpt as string,
          }))}
        freshness={
          evidenceItem ? freshnessFor(evidenceItem.updatedAt, t) : undefined
        }
        requestId={evidenceMeta?.request_id}
        onOpenDocument={(s) =>
          toast.info(t.opportunities.sourceRetrievalPath, {
            description:
              (evidenceDetail?.evidence_bundle ?? []).find(
                (e) => e.evidenceSourceId === s.id,
              )?.retrievalPath ?? t.opportunities.noRetrievalPath,
          })
        }
      />

      <GenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        sectors={sectors}
        items={allItems}
        onSubmitted={(jobId) => setActiveJobId(jobId)}
      />
    </motion.div>
  );
}
