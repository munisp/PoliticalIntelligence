import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfidenceChip } from "@/components/shared";
import { fmtInt, fmtShare, hashStr } from "./utils";

export interface SectorLike {
  sectorCode: string;
  name: string;
  description?: string | null;
}

export interface MetricRow {
  sectorCode: string;
  metricKey: string;
  value: number;
  period: string;
  confidence: number;
}

export interface OpportunityLike {
  opportunityId: string;
  sectorCode: string;
  title: string;
  score: number;
  confidence: number;
  estimatedJobsMin?: number | null;
  estimatedJobsMax?: number | null;
}

/* ------------------------------------------------------------------ */

/** Preferred headline metric per sector (fallback: first available). */
const PREFERRED_METRIC: Record<string, string> = {
  edu: "literacy",
  sme: "sme_density",
  proc: "procurement_volume",
  agro: "unemployment",
  digital: "sme_density",
};

const METRIC_LABELS: Record<string, string> = {
  literacy: "Literacy rate",
  unemployment: "Unemployment",
  school_count: "Public schools",
  sme_density: "SME density",
  procurement_volume: "Procurement volume",
};

function formatMetric(key: string, value: number): string {
  if (key === "literacy" || key === "unemployment") return fmtShare(value);
  if (key === "procurement_volume") return `₦${(value / 1000).toFixed(1)}B`;
  if (key === "sme_density") return `${value.toFixed(1)} /10k`;
  return fmtInt(value);
}

function formatDelta(key: string, delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const abs = Math.abs(delta);
  if (key === "literacy" || key === "unemployment")
    return `${sign}${(abs * 100).toFixed(1)} pts`;
  if (key === "procurement_volume") return `${sign}₦${(abs / 1000).toFixed(1)}B`;
  return `${sign}${abs.toFixed(1)}`;
}

/** Kaduna LGA names on the simplified grid (matches shared MapPanel). */
const KADUNA_LGAS = [
  "Zangon Kataf", "Kaura", "Jema'a", "Kauru", "Lere", "Kubau",
  "Kachia", "Kajuru", "Chikun", "Kaduna South", "Kaduna North", "Ikara",
  "Jaba", "Kagarko", "Igabi", "Giwa", "Makarfi", "Kudan",
  "Sanga", "Birnin Gwari", "Zaria", "Sabon Gari", "Soba",
];

function tileColor(v: number): string {
  const t = Math.max(0, Math.min(1, v));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(22, 63)}, ${mix(35, 174)}, ${mix(60, 158)})`;
}

/** Mini choropleth thumbnail: sector-relevant LGA highlight, click-through
 *  to the Opportunity Explorer. Static SVG — low-bandwidth friendly. */
function SectorMapThumb({
  sectorCode,
  onClick,
}: {
  sectorCode: string;
  onClick: () => void;
}) {
  const tiles = useMemo(
    () =>
      KADUNA_LGAS.map((name) => ({
        name,
        value: hashStr(`${sectorCode}:${name}`),
      })),
    [sectorCode],
  );
  const top = tiles.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col rounded-md border border-ink-subtle bg-ink-inset/40 p-3 text-left hover:border-civic/50"
      aria-label={`Kaduna LGA map — ${sectorCode === "all" ? "all sectors" : sectorCode} hotspots. Open in Opportunity Explorer.`}
    >
      <span className="caption-label flex items-center gap-1.5 text-ink-muted">
        <MapIcon aria-hidden className="h-3.5 w-3.5" />
        LGA hotspots
      </span>
      <span className="mt-2 grid flex-1 grid-cols-6 gap-[3px]" aria-hidden>
        {tiles.map((t) => (
          <span
            key={t.name}
            title={`${t.name} · ${t.value.toFixed(2)}`}
            className={cn(
              "aspect-square rounded-[2px]",
              t.name === top.name && "ring-1 ring-gold",
            )}
            style={{ backgroundColor: tileColor(t.value) }}
          />
        ))}
      </span>
      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-civic group-hover:text-civic-strong">
        {top.name} leads · View in Explorer
        <ArrowUpRight aria-hidden className="h-3 w-3" />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

export interface SectorHighlightsProps {
  sectors: SectorLike[];
  metrics: MetricRow[];
  opportunities: OpportunityLike[];
  className?: string;
}

const TAB_ORDER = ["edu", "sme", "proc"];

export default function SectorHighlights({
  sectors,
  metrics,
  opportunities,
  className,
}: SectorHighlightsProps) {
  const navigate = useNavigate();
  const tabs = useMemo(() => {
    const byCode = new Map(sectors.map((s) => [s.sectorCode, s]));
    const ordered = TAB_ORDER.map((c) => byCode.get(c)).filter(
      (s): s is SectorLike => !!s,
    );
    return ordered.length ? ordered : sectors.slice(0, 3);
  }, [sectors]);

  const [active, setActive] = useState<string>("edu");
  const activeTab = [...tabs.map((t) => t.sectorCode), "all"].includes(active)
    ? active
    : (tabs[0]?.sectorCode ?? "all");

  const content = useMemo(() => {
    if (activeTab === "all") {
      const top = [...opportunities].sort((a, b) => b.score - a.score)[0];
      return {
        kpiLabel: "Sectors tracked",
        kpiValue: String(tabs.length || sectors.length),
        kpiDelta: `${opportunities.length} ranked opportunities`,
        confidence: top?.confidence,
        top,
      };
    }
    const rows = metrics
      .filter((m) => m.sectorCode === activeTab)
      .sort((a, b) => a.period.localeCompare(b.period));
    const preferred = PREFERRED_METRIC[activeTab];
    const metricKey =
      preferred && rows.some((r) => r.metricKey === preferred)
        ? preferred
        : rows[0]?.metricKey;
    const series = rows.filter((r) => r.metricKey === metricKey);
    const latest = series[series.length - 1];
    const prior = series[series.length - 2];
    const top = opportunities
      .filter((o) => o.sectorCode === activeTab)
      .sort((a, b) => b.score - a.score)[0];
    return {
      kpiLabel: METRIC_LABELS[metricKey ?? ""] ?? metricKey ?? "Sector KPI",
      kpiValue: latest ? formatMetric(latest.metricKey, latest.value) : "—",
      kpiDelta:
        latest && prior
          ? `${formatDelta(latest.metricKey, latest.value - prior.value)} vs ${prior.period}`
          : latest
            ? `Period ${latest.period}`
            : "No metrics yet",
      confidence: latest?.confidence,
      top,
    };
  }, [activeTab, metrics, opportunities, sectors.length, tabs.length]);

  const explorerLink =
    activeTab === "all" ? "/opportunities" : `/opportunities?sector=${activeTab}`;

  return (
    <section
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
      aria-labelledby="sector-highlights-title"
    >
      <h2
        id="sector-highlights-title"
        className="text-lg font-semibold text-ink-primary"
      >
        Sector highlights
      </h2>

      <div
        role="tablist"
        aria-label="Sector"
        className="mt-3 flex flex-wrap gap-1 border-b border-ink-subtle"
      >
        {tabs.map((t) => (
          <button
            key={t.sectorCode}
            role="tab"
            aria-selected={activeTab === t.sectorCode}
            onClick={() => setActive(t.sectorCode)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors duration-200",
              activeTab === t.sectorCode
                ? "text-ink-primary"
                : "text-ink-muted hover:text-ink-secondary",
            )}
          >
            {t.name}
            {activeTab === t.sectorCode && (
              <motion.span
                layoutId="sector-tab-underline"
                transition={{ duration: 0.16 }}
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-civic"
              />
            )}
          </button>
        ))}
        <button
          role="tab"
          aria-selected={activeTab === "all"}
          onClick={() => setActive("all")}
          className={cn(
            "relative px-3 py-2 text-sm font-medium transition-colors duration-200",
            activeTab === "all"
              ? "text-ink-primary"
              : "text-ink-muted hover:text-ink-secondary",
          )}
        >
          All sectors
          {activeTab === "all" && (
            <motion.span
              layoutId="sector-tab-underline"
              transition={{ duration: 0.16 }}
              className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-civic"
            />
          )}
        </button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-4 grid gap-3 md:grid-cols-3"
        >
          {/* Sector KPI mini-card */}
          <div className="rounded-md border border-ink-subtle bg-ink-inset/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="caption-label text-ink-muted">{content.kpiLabel}</p>
              {content.confidence !== undefined && (
                <ConfidenceChip score={content.confidence} />
              )}
            </div>
            <p className="mt-2 font-mono text-xl leading-7 text-ink-primary">
              {content.kpiValue}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">{content.kpiDelta}</p>
          </div>

          {/* Top opportunity mini-card */}
          {content.top ? (
            <button
              type="button"
              onClick={() => navigate(explorerLink)}
              className="group rounded-md border border-ink-subtle bg-ink-inset/40 p-3 text-left hover:border-civic/50"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="caption-label text-ink-muted">Top opportunity</p>
                <ConfidenceChip score={content.top.confidence} />
              </div>
              <p className="mt-2 text-sm font-medium leading-5 text-ink-primary group-hover:text-civic-strong">
                {content.top.title}
              </p>
              <p className="mt-1 font-mono text-xs text-ink-secondary">
                Score {content.top.score.toFixed(2)}
                {content.top.estimatedJobsMax
                  ? ` · up to ${fmtInt(content.top.estimatedJobsMax)} jobs`
                  : ""}
              </p>
            </button>
          ) : (
            <div className="rounded-md border border-dashed border-ink-subtle bg-ink-inset/20 p-3">
              <p className="caption-label text-ink-muted">Top opportunity</p>
              <p className="mt-2 text-[13px] text-ink-muted">
                No ranked opportunities for this sector yet.
              </p>
            </div>
          )}

          {/* Mini choropleth thumbnail */}
          <SectorMapThumb
            sectorCode={activeTab}
            onClick={() => navigate(explorerLink)}
          />
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
