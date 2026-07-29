import { useMemo, useState } from "react";
import { ExternalLink, Radar as RadarIcon, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrap } from "@/lib/trpc-data";

/**
 * I1 — Policy Radar: weekly digest feed of new bills/regulations/budget
 * lines scored by the deterministic impact rubric (api/radar.ts).
 */

interface RadarAlert {
  alertId: string;
  jurisdictionId: string | null;
  sector: string;
  sourceEntity: "bill" | "regulation" | "budget";
  sourceRef: string;
  title: string;
  summary: string | null;
  impactScore: number;
  matchedStakeholders: { stakeholderId: string; name: string; kind: string }[];
  createdAt: string | Date;
  origin: string;
}

function impactBadge(score: number): { label: string; cls: string } {
  if (score >= 60)
    return { label: "high", cls: "bg-status-danger/15 text-status-danger border-status-danger/40" };
  if (score >= 35)
    return { label: "medium", cls: "bg-status-warning/15 text-status-warning border-status-warning/40" };
  return { label: "low", cls: "bg-status-success/15 text-status-success border-status-success/40" };
}

export default function Radar() {
  const t = useT();
  const [sector, setSector] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [sinceDays, setSinceDays] = useState(30);

  const since = useMemo(
    () => new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString(),
    [sinceDays],
  );
  const alertsQuery = trpc.radar.alerts.useQuery({
    sector: sector || undefined,
    jurisdiction_id: jurisdiction || undefined,
    since,
    limit: 100,
  });
  const scanMutation = trpc.radar.scan.useMutation({
    onSuccess: () => alertsQuery.refetch(),
  });

  const alerts: RadarAlert[] = useMemo(() => {
    const d = unwrap<{ alerts: RadarAlert[] }>(alertsQuery.data);
    return d?.alerts ?? [];
  }, [alertsQuery.data]);

  const sectors = useMemo(
    () => [...new Set(alerts.map((a) => a.sector))].sort(),
    [alerts],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-primary">
            <RadarIcon className="h-5 w-5 text-accent" aria-hidden />
            {t.radar.title}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">{t.radar.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => scanMutation.mutate({ days: 7 })}
          disabled={scanMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[13px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", scanMutation.isPending && "animate-spin")} aria-hidden />
          {t.radar.scanNow}
        </button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-ink-subtle bg-ink-surface/60 p-4">
        <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
          {t.radar.filterSector}
          <input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            list="radar-sectors"
            placeholder={t.radar.allSectors}
            className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[13px] text-ink-primary"
          />
          <datalist id="radar-sectors">
            {sectors.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
          {t.radar.filterJurisdiction}
          <input
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            placeholder="kaduna"
            className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[13px] text-ink-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
          {t.radar.filterSince}
          <select
            value={sinceDays}
            onChange={(e) => setSinceDays(Number(e.target.value))}
            className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[13px] text-ink-primary"
          >
            <option value={7}>7</option>
            <option value={30}>30</option>
            <option value={90}>90</option>
          </select>
        </label>
      </div>

      {scanMutation.isError && (
        <p role="alert" className="rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-[13px] text-status-danger">
          {t.radar.scanError}
        </p>
      )}

      {/* Feed */}
      {alertsQuery.isLoading ? (
        <div aria-busy="true" className="rounded-md border border-ink-subtle bg-ink-surface/60 p-8 text-center text-[13px] text-ink-muted">
          {t.radar.loading}
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-md border border-ink-subtle bg-ink-surface/60 p-8 text-center text-[13px] text-ink-muted">
          {t.radar.empty}
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t.radar.feedLabel}>
          {alerts.map((a) => {
            const badge = impactBadge(a.impactScore);
            return (
              <li
                key={a.alertId}
                className="rounded-md border border-ink-subtle bg-ink-surface/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink-primary">{a.title}</p>
                    <p className="mt-1 text-[13px] text-ink-muted">{a.summary}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                      <span className="rounded border border-ink-subtle px-1.5 py-0.5 uppercase tracking-wide">
                        {a.sourceEntity}
                      </span>
                      <span className="rounded border border-ink-subtle px-1.5 py-0.5">
                        {a.sector}
                      </span>
                      {a.jurisdictionId && <span>{a.jurisdictionId}</span>}
                      <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                      <a
                        href={`/legislation?ref=${encodeURIComponent(a.sourceRef)}`}
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        {t.radar.evidence}
                      </a>
                    </div>
                    {a.matchedStakeholders.length > 0 && (
                      <p className="mt-2 text-[12px] text-ink-muted">
                        {t.radar.matched}:{" "}
                        {a.matchedStakeholders.map((s) => s.name).join(", ")}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-semibold",
                      badge.cls,
                    )}
                    aria-label={`${t.radar.impact}: ${a.impactScore} (${badge.label})`}
                  >
                    {a.impactScore.toFixed(1)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
