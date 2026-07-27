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
import FilterBar, { type FilterBarValue } from "@/components/shared/FilterBar";
import MapPanel, { type LgaDatum } from "@/components/shared/MapPanel";
import EvidenceDrawer, {
  type EvidenceSource,
} from "@/components/shared/EvidenceDrawer";
import EmptyState from "@/components/shared/EmptyState";
import StatusDot from "@/components/shared/StatusDot";
import RankingRow, { SkeletonRankingRow } from "@/components/opportunities/RankingRow";
import CompareTray from "@/components/opportunities/CompareTray";
import CompareView from "@/components/opportunities/CompareView";
import GenerateModal from "@/components/opportunities/GenerateModal";
import {
  baseOpportunityScore,
  costPerJob,
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

const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "jobs", label: "Jobs impact" },
  { id: "cost", label: "Cost-efficiency" },
  { id: "freshness", label: "Freshness" },
];

const SAVED_VIEWS = [
  { id: "sme-pipeline", label: "My views: SME pipeline" },
  { id: "edu-fy25", label: "My views: Education FY25" },
];

const TERMINAL_JOB_STATES: JobStatus[] = ["succeeded", "failed", "canceled"];

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

function freshnessFor(updatedAt: string | Date): {
  status: "healthy" | "stale" | "failing";
  label: string;
} {
  const d = typeof updatedAt === "string" ? new Date(updatedAt) : updatedAt;
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (days <= 7)
    return { status: "healthy", label: `Evidence fresh — updated ${formatDate(d)}` };
  if (days <= 30)
    return { status: "stale", label: `Newest evidence ${formatDate(d)} — within 30 days` };
  return {
    status: "failing",
    label: `Evidence older than 30 days (${formatDate(d)}) — refresh recommended`,
  };
}

export default function Opportunities() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

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
  const lgaUnits = useMemo(
    () => geoUnits.filter((u) => u.adminLevel === "lga" || u.children.length === 0),
    [geoUnits],
  );

  const geographies = useMemo(
    () => [
      { id: JURISDICTION_ID, label: "Kaduna State (all 23 LGAs)" },
      ...lgaUnits.map((u) => ({ id: u.adminUnitId, label: `› ${u.name}` })),
    ],
    [lgaUnits],
  );

  const selectedLga = lgaUnits.find((u) => u.adminUnitId === filters.geography);
  const selectedLgaName = selectedLga?.name.replace(/ LGA$/, "") ?? null;

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
          toast.warning("Compare tray is full (3/3).", {
            description: "Remove an opportunity before adding another.",
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
      toast.success("Opportunity generation complete.", {
        description: "The ranking list has been refreshed.",
      });
      void utils.opportunities.rankings.invalidate();
      setActiveJobId(null);
    } else if (jobStatus.status === "failed" || jobStatus.status === "canceled") {
      notifiedJob.current = activeJobId;
      toast.error(`Generation job ${jobStatus.status}.`, {
        description: jobStatus.error ?? "See the Jobs indicator for details.",
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

  const geographyPath = selectedLgaName
    ? `Kaduna State › ${selectedLgaName}`
    : "Kaduna State › All LGAs";

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
    <div className="space-y-2" onKeyDown={onListKeyDown} aria-label="Ranked opportunities">
      {rankingsQuery.isLoading &&
        Array.from({ length: 6 }).map((_, i) => <SkeletonRankingRow key={i} />)}

      {rankingsQuery.isError && (
        <EmptyState
          title="Rankings failed to load"
          guidance={rankingsQuery.error.message}
          showSpotArt={false}
          action={{ label: "Retry", onClick: () => void rankingsQuery.refetch() }}
        />
      )}

      {!rankingsQuery.isLoading && !rankingsQuery.isError && visibleItems.length === 0 && (
        <EmptyState
          title="No opportunities match these filters"
          guidance="Lower the confidence floor or generate a new analysis for this sector and geography."
          action={{ label: "Reset filters", onClick: resetFilters }}
        />
      )}

      {visibleItems.map((o, i) => (
        <RankingRow
          key={o.opportunityId}
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
      ))}
    </div>
  );

  const mapPanel = (
    <div className="space-y-2 lg:sticky lg:top-[88px]">
      <div
        role="group"
        aria-label="Map layers"
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
        title="Kaduna State — LGA choropleth"
        data={mapData}
        legendLabel={MAP_LAYERS.find((l) => l.id === layer)?.legend}
      />
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
            Kaduna State · Opportunity Explorer
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
            Sector Opportunity Explorer
          </h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {allItems.length} ranked opportunities · Scoring model v2.4
            {generatedDate ? ` · Generated ${formatDate(new Date(generatedDate))}` : ""}
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
                toast.info("Select at least 2 opportunities to compare.");
              else
                toast.info(
                  "Add opportunities to the compare tray from a row (keyboard: C).",
                );
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:border-ink-strong hover:text-ink-primary"
          >
            <GitCompareArrows aria-hidden className="h-4 w-4" />
            Compare ({compareIds.length}/3)
          </button>
          <button
            type="button"
            onClick={() => setGenerateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3.5 py-1.5 text-sm font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98]"
          >
            <Sparkles aria-hidden className="h-4 w-4" />
            Generate opportunities
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
                <span className="caption-label text-ink-muted">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortId)}
                  className="rounded-md border border-ink-subtle bg-ink-surface px-2 py-1 text-xs text-ink-primary"
                >
                  {SORT_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-ink-secondary" aria-live="polite">
                <span className="font-mono text-ink-primary">{visibleItems.length}</span>{" "}
                opportunities
              </span>
              {selectedLgaName && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-civic/50 bg-civic/10 px-2.5 py-0.5 text-[11px] font-medium text-civic">
                  {selectedLgaName} LGA
                  <button
                    type="button"
                    onClick={() => applyFilters({ ...filters, geography: JURISDICTION_ID })}
                    aria-label={`Clear ${selectedLgaName} geography filter`}
                    className="rounded-full text-civic/80 hover:text-civic-strong"
                  >
                    ×
                  </button>
                </span>
              )}
              {floorAboveData && (
                <span className="text-[11px] text-status-warning">
                  Confidence floor is above all available scores — lower it to see results.
                </span>
              )}
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink-primary"
              >
                <RotateCcw aria-hidden className="h-3 w-3" />
                Reset
              </button>
            </div>
          </div>

          {/* Mobile / tablet: List | Map tabs (map is sticky side panel ≥1280px) */}
          <div className="flex gap-1.5 lg:hidden" role="tablist" aria-label="Explorer view">
            {(["list", "map"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={mobileTab === t}
                onClick={() => setMobileTab(t)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium capitalize",
                  mobileTab === t
                    ? "border-civic bg-civic/10 text-civic"
                    : "border-ink-subtle bg-ink-surface text-ink-secondary",
                )}
              >
                {t === "list" ? "List" : "Map"}
              </button>
            ))}
          </div>

          {/* --------------------- Main: list (7) + map (5) --------------------- */}
          <div className="grid gap-4 lg:grid-cols-12">
            <section
              aria-label="Ranked opportunities list"
              className={cn("lg:col-span-7", mobileTab === "map" && "hidden lg:block")}
            >
              {rankingList}
            </section>
            <section
              aria-label="Opportunity map"
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
        title={evidenceItem?.title ?? "Opportunity evidence"}
        sources={(evidenceDetail?.evidence_bundle ?? []).map(toEvidenceSource)}
        excerpts={(evidenceDetail?.evidence_bundle ?? [])
          .filter((e) => e.contentExcerpt)
          .map((e) => ({
            sourceId: e.evidenceSourceId,
            text: e.contentExcerpt as string,
          }))}
        freshness={
          evidenceItem ? freshnessFor(evidenceItem.updatedAt) : undefined
        }
        requestId={evidenceMeta?.request_id}
        onOpenDocument={(s) =>
          toast.info("Source retrieval path", {
            description:
              (evidenceDetail?.evidence_bundle ?? []).find(
                (e) => e.evidenceSourceId === s.id,
              )?.retrievalPath ?? "No retrieval path recorded.",
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
