import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExternalLink } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrap } from "@/lib/trpc-data";

/**
 * I3 — Corridor Twin panel: milestone timeline with deterministic
 * schedule/funding variance bars (docs/INNOVATIONS.md §I3).
 */

interface Milestone {
  milestoneId: string;
  title: string;
  plannedDate: string;
  actualDate: string | null;
  status: "planned" | "in_progress" | "done" | "delayed";
  pctComplete: number;
  fundingDisbursedNgn: number | null;
  evidenceRef: string | null;
}
interface Progress {
  corridorId: string;
  milestones: Milestone[];
  aggregate: {
    aggregatePct: number;
    done: number;
    inProgress: number;
    delayed: number;
    planned: number;
    totalDisbursedNgn: number;
    totalPlannedNgn: number;
    disbursedVsPlanned: number;
  };
}
interface Variance {
  variances: {
    milestoneId: string;
    title: string;
    scheduleVarianceDays: number | null;
    daysOverdue: number;
    fundingVarianceNgn: number | null;
  }[];
}

const STATUS_COLOR: Record<Milestone["status"], string> = {
  done: "#4FAE8C",
  in_progress: "#5E93CF",
  planned: "#5E6D87",
  delayed: "#D9635F",
};

function ngnShort(n: number): string {
  if (n >= 1e12) return `₦${(n / 1e12).toFixed(2)}trn`;
  if (n >= 1e9) return `₦${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(0)}m`;
  return `₦${n.toLocaleString()}`;
}

export default function CorridorPanel({ corridorId }: { corridorId: string }) {
  const t = useT();
  const progressQuery = trpc.corridors.progress.useQuery({ corridor_id: corridorId });
  const varianceQuery = trpc.corridors.variance.useQuery({ corridor_id: corridorId });

  const progress = useMemo(() => unwrap<Progress>(progressQuery.data), [progressQuery.data]);
  const variance = useMemo(() => unwrap<Variance>(varianceQuery.data), [varianceQuery.data]);

  const chartData = useMemo(() => {
    if (!progress) return [];
    const varById = new Map((variance?.variances ?? []).map((v) => [v.milestoneId, v]));
    return progress.milestones.map((m) => {
      const v = varById.get(m.milestoneId);
      return {
        name: m.title.length > 28 ? `${m.title.slice(0, 28)}…` : m.title,
        pct: m.pctComplete,
        scheduleSlip: v?.scheduleVarianceDays ?? 0,
        overdue: v?.daysOverdue ?? 0,
        status: m.status,
      };
    });
  }, [progress, variance]);

  if (progressQuery.isLoading) {
    return (
      <div aria-busy="true" className="rounded-md border border-ink-subtle bg-ink-surface/60 p-8 text-center text-[13px] text-ink-muted">
        {t.corridors.loading}
      </div>
    );
  }
  if (!progress || progress.milestones.length === 0) {
    return (
      <div className="rounded-md border border-ink-subtle bg-ink-surface/60 p-8 text-center text-[13px] text-ink-muted">
        {t.corridors.empty}
      </div>
    );
  }

  const a = progress.aggregate;
  return (
    <div className="space-y-4">
      {/* Aggregate strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t.corridors.aggregatePct, value: `${a.aggregatePct.toFixed(1)}%` },
          { label: t.corridors.doneLabel, value: `${a.done} / ${progress.milestones.length}` },
          { label: t.corridors.disbursed, value: ngnShort(a.totalDisbursedNgn) },
          {
            label: t.corridors.disbursedVsPlanned,
            value: `${(a.disbursedVsPlanned * 100).toFixed(1)}%`,
          },
        ].map((c) => (
          <div key={c.label} className="rounded-md border border-ink-subtle bg-ink-surface/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-muted">{c.label}</p>
            <p className="mt-1 text-[18px] font-semibold text-ink-primary">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Timeline: % complete with status colors */}
      <div className="rounded-md border border-ink-subtle bg-ink-surface/60 p-4">
        <h3 className="text-[13px] font-semibold text-ink-primary">{t.corridors.timeline}</h3>
        <div className="mt-2 h-56" role="img" aria-label={t.corridors.timeline}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 40, left: 0 }}>
              <CartesianGrid stroke="#1E2C47" vertical={false} />
              <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 10, fill: "#9AA8BF" }} />
              <YAxis tick={{ fontSize: 10, fill: "#9AA8BF" }} unit="%" />
              <Tooltip
                contentStyle={{ background: "#101A2E", border: "1px solid #1E2C47", fontSize: 12 }}
                labelStyle={{ color: "#E6ECF5" }}
              />
              <Bar dataKey="pct" name={t.corridors.pctComplete} radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={STATUS_COLOR[d.status as Milestone["status"]]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Variance bars: schedule slip (days) */}
      <div className="rounded-md border border-ink-subtle bg-ink-surface/60 p-4">
        <h3 className="text-[13px] font-semibold text-ink-primary">{t.corridors.variance}</h3>
        <div className="mt-2 h-56" role="img" aria-label={t.corridors.variance}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 40, left: 0 }}>
              <CartesianGrid stroke="#1E2C47" vertical={false} />
              <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 10, fill: "#9AA8BF" }} />
              <YAxis tick={{ fontSize: 10, fill: "#9AA8BF" }} />
              <Tooltip
                contentStyle={{ background: "#101A2E", border: "1px solid #1E2C47", fontSize: 12 }}
                labelStyle={{ color: "#E6ECF5" }}
              />
              <Bar dataKey="scheduleSlip" name={t.corridors.scheduleSlip} fill="#D9A441" radius={[3, 3, 0, 0]} />
              <Bar dataKey="overdue" name={t.corridors.daysOverdue} fill="#D9635F" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Milestone list with evidence links */}
      <ul className="space-y-2" aria-label={t.corridors.milestones}>
        {progress.milestones.map((m) => (
          <li key={m.milestoneId} className="rounded-md border border-ink-subtle bg-ink-surface/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink-primary">{m.title}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {t.corridors.planned}: {m.plannedDate}
                  {m.actualDate ? ` · ${t.corridors.actual}: ${m.actualDate}` : ""}
                  {m.fundingDisbursedNgn != null ? ` · ${ngnShort(m.fundingDisbursedNgn)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                  style={{ color: STATUS_COLOR[m.status], borderColor: STATUS_COLOR[m.status] }}
                >
                  {m.status.replace("_", " ")}
                </span>
                {m.evidenceRef && (
                  <a
                    href={`/legislation?ref=${encodeURIComponent(m.evidenceRef)}`}
                    className="inline-flex items-center gap-1 text-[11px] text-civic hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    {t.radar.evidence}
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
