import { useMemo } from "react";
import { Users } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrapData } from "./types";

interface SupplierRow {
  registration_id: string;
  name: string;
  rc_number: string | null;
  lga: string | null;
  entity_type: string | null;
  readiness_score: number;
  breakdown: {
    registration_age: number;
    sector_match: number;
    lga_proximity: number;
    size_class: number;
  };
}

/** I8 — Procurement match: ranked suppliers with readiness bars. */
export default function MatchedSuppliers({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const t = useT();
  const q = trpc.matchmaking.suppliers.useQuery(
    { opportunity_id: opportunityId, limit: 5 },
    { staleTime: 120_000 },
  );
  const payload = useMemo(
    () =>
      unwrapData(q.data) as { suppliers: SupplierRow[] } | undefined,
    [q.data],
  );

  return (
    <div className="mt-3 rounded-md border border-ink-subtle/60 bg-ink-inset p-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">
        <Users aria-hidden className="h-3.5 w-3.5 text-civic" />
        {t.matchmaking.title}
      </p>
      {q.isLoading ? (
        <p className="text-[11px] text-ink-muted">{t.matchmaking.loading}</p>
      ) : !payload || payload.suppliers.length === 0 ? (
        <p className="text-[11px] text-ink-muted">{t.matchmaking.empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {payload.suppliers.map((s) => (
            <li key={s.registration_id} className="text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-primary">
                  {s.name}
                  {s.lga && (
                    <span className="ml-1.5 font-mono text-[10px] text-ink-muted">
                      {s.lga}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[11px] text-ink-secondary">
                  {s.readiness_score.toFixed(0)}
                </span>
              </div>
              <div
                className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ink-subtle/40"
                role="img"
                aria-label={`${t.matchmaking.readiness}: ${s.readiness_score.toFixed(0)} / 100`}
              >
                <div
                  className="h-full rounded-full bg-civic"
                  style={{ width: `${Math.min(100, s.readiness_score)}%` }}
                />
              </div>
              <p className="mt-0.5 flex gap-2 font-mono text-[10px] text-ink-muted">
                <span title={t.matchmaking.regAge}>
                  {t.matchmaking.regAge} {(s.breakdown.registration_age * 100).toFixed(0)}
                </span>
                <span title={t.matchmaking.sectorMatch}>
                  {t.matchmaking.sectorMatch} {(s.breakdown.sector_match * 100).toFixed(0)}
                </span>
                <span title={t.matchmaking.proximity}>
                  {t.matchmaking.proximity} {(s.breakdown.lga_proximity * 100).toFixed(0)}
                </span>
                <span title={t.matchmaking.sizeClass}>
                  {t.matchmaking.sizeClass} {(s.breakdown.size_class * 100).toFixed(0)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
