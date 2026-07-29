import { useEffect, useMemo } from "react";
import { FileText, Landmark, ScrollText, ShieldAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import {
  unwrapData,
  type PathwayDetail,
  type PathwaySummary,
} from "./types";

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s.includes("high") || s.includes("critical"))
    return "border-status-danger/40 bg-status-danger/10 text-status-danger";
  if (s.includes("med"))
    return "border-status-warning/40 bg-status-warning/10 text-status-warning";
  return "border-status-info/40 bg-status-info/10 text-status-info";
}

function scopeBadge(scope: string): string {
  return scope === "both"
    ? "Federal + State"
    : scope.charAt(0).toUpperCase() + scope.slice(1);
}

export default function PathwaysTab({
  selectedPathwayId,
  onSelectPathway,
}: {
  selectedPathwayId: string | null;
  onSelectPathway: (id: string | null) => void;
}) {
  const t = useT();

  const listQuery = trpc.advocacy.listPathways.useQuery();
  const pathways: PathwaySummary[] = useMemo(
    () => (listQuery.data ? unwrapData<{ pathways: PathwaySummary[] }>(listQuery.data).pathways : []),
    [listQuery.data],
  );

  // Default selection: first pathway.
  useEffect(() => {
    if (!selectedPathwayId && pathways.length > 0)
      onSelectPathway(pathways[0].pathwayId);
  }, [pathways, selectedPathwayId, onSelectPathway]);

  const detailQuery = trpc.advocacy.getPathway.useQuery(
    { pathwayId: selectedPathwayId ?? "" },
    { enabled: !!selectedPathwayId },
  );
  const detail: PathwayDetail | null = detailQuery.data
    ? unwrapData<{ pathway: PathwayDetail }>(detailQuery.data).pathway
    : null;

  if (listQuery.isLoading) {
    return (
      <div aria-busy="true" className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-md border border-ink-subtle bg-ink-elevated"
          />
        ))}
      </div>
    );
  }

  if (listQuery.isError) {
    return (
      <p role="alert" className="rounded-md border border-status-danger/40 bg-status-danger/10 p-4 text-[13px] text-status-danger">
        {t.advocacy.pathwaysError}
      </p>
    );
  }

  if (pathways.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center rounded-md border border-dashed border-ink-subtle p-6 text-center">
        <Landmark aria-hidden className="h-8 w-8 text-ink-muted" />
        <p className="mt-3 text-[13px] text-ink-secondary">{t.advocacy.pathwaysEmpty}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
      {/* Pathway cards */}
      <ul className="space-y-2" aria-label={t.advocacy.tabPathways}>
        {pathways.map((p) => {
          const active = p.pathwayId === selectedPathwayId;
          return (
            <li key={p.pathwayId}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelectPathway(p.pathwayId)}
                className={cn(
                  "w-full rounded-md border p-3 text-left transition-colors",
                  active
                    ? "border-civic/60 bg-civic/10"
                    : "border-ink-subtle bg-ink-elevated hover:border-ink-strong",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink-primary">
                    {p.title}
                  </span>
                  <span className="shrink-0 rounded-full border border-ink-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                    {scopeBadge(p.jurisdictionScope)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-civic">
                  {p.sector}
                </p>
                <p className="mt-1 line-clamp-2 text-[12px] text-ink-secondary">
                  {p.summary}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Detail */}
      <div className="min-w-0">
        {detailQuery.isLoading && (
          <div aria-busy="true" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-md border border-ink-subtle bg-ink-elevated" />
            ))}
          </div>
        )}
        {detailQuery.isError && (
          <p role="alert" className="rounded-md border border-status-danger/40 bg-status-danger/10 p-4 text-[13px] text-status-danger">
            {t.advocacy.pathwaysError}
          </p>
        )}
        {!detailQuery.isLoading && !detailQuery.isError && !detail && (
          <p className="text-[13px] text-ink-muted">{t.advocacy.selectPathway}</p>
        )}
        {detail && (
          <div className="space-y-3">
            <header className="rounded-md border border-ink-subtle bg-ink-elevated p-4">
              <p className="caption-label text-civic">{detail.sector}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                {detail.title}
              </h2>
              <p className="mt-1 text-[13px] text-ink-secondary">{detail.summary}</p>
            </header>

            {/* Licenses table */}
            <section className="rounded-md border border-ink-subtle bg-ink-elevated p-3">
              <h3 className="caption-label flex items-center gap-1.5 text-ink-muted">
                <FileText aria-hidden className="h-3.5 w-3.5" />
                {t.advocacy.licenses}
              </h3>
              {detail.licenses.length === 0 ? (
                <p className="mt-2 text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-ink-subtle text-[11px] uppercase tracking-wide text-ink-muted">
                        <th className="py-1.5 pr-3 font-medium">{t.advocacy.licenses}</th>
                        <th className="py-1.5 pr-3 font-medium">{t.advocacy.issuer}</th>
                        <th className="py-1.5 pr-3 font-medium">{t.advocacy.requirement}</th>
                        <th className="py-1.5 pr-3 font-medium">{t.advocacy.typicalTimeline}</th>
                        <th className="py-1.5 font-medium">{t.advocacy.costNote}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.licenses.map((l) => (
                        <tr key={l.name} className="border-b border-ink-subtle/60 last:border-0">
                          <td className="py-2 pr-3 font-medium text-ink-primary">{l.name}</td>
                          <td className="py-2 pr-3 text-ink-secondary">{l.issuer}</td>
                          <td className="py-2 pr-3 text-ink-secondary">{l.requirement}</td>
                          <td className="py-2 pr-3 font-mono text-xs text-ink-secondary">{l.typical_timeline}</td>
                          <td className="py-2 text-ink-secondary">{l.cost_note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="grid gap-3 md:grid-cols-2">
              {/* Constraints */}
              <section className="rounded-md border border-ink-subtle bg-ink-elevated p-3">
                <h3 className="caption-label flex items-center gap-1.5 text-ink-muted">
                  <ShieldAlert aria-hidden className="h-3.5 w-3.5" />
                  {t.advocacy.constraints}
                </h3>
                {detail.constraints.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.constraints.map((c, i) => (
                      <li key={`${c.type}-${i}`} className="text-[13px]">
                        <span
                          className={cn(
                            "mr-1.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            severityClass(c.severity),
                          )}
                        >
                          {c.severity}
                        </span>
                        <span className="font-medium text-ink-primary">{c.type}</span>
                        <p className="text-[12px] text-ink-secondary">{c.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Supporting laws */}
              <section className="rounded-md border border-ink-subtle bg-ink-elevated p-3">
                <h3 className="caption-label flex items-center gap-1.5 text-ink-muted">
                  <ScrollText aria-hidden className="h-3.5 w-3.5" />
                  {t.advocacy.supportingLaws}
                </h3>
                {detail.supportingLawRefs.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.supportingLawRefs.map((l) => (
                      <li key={l.ref} className="text-[13px]">
                        <span className="font-mono text-xs text-civic">{l.ref}</span>{" "}
                        <span className="font-medium text-ink-primary">{l.title}</span>
                        <p className="text-[12px] text-ink-secondary">{l.relevance}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Steps */}
            {detail.steps.length > 0 && (
              <section className="rounded-md border border-ink-subtle bg-ink-elevated p-3">
                <h3 className="caption-label text-ink-muted">{t.advocacy.steps}</h3>
                <ol className="mt-2 space-y-2">
                  {detail.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-[13px]">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-civic/15 font-mono text-[11px] text-civic">
                        {i + 1}
                      </span>
                      <div>
                        <span className="font-medium text-ink-primary">{s.step}</span>
                        <span className="text-ink-muted"> · {s.owner} · {s.est_duration}</span>
                        <p className="text-[12px] text-ink-secondary">{s.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Associations */}
            <section className="rounded-md border border-ink-subtle bg-ink-elevated p-3">
              <h3 className="caption-label flex items-center gap-1.5 text-ink-muted">
                <Users aria-hidden className="h-3.5 w-3.5" />
                {t.advocacy.associationRefs}
              </h3>
              {detail.associationRefs.length === 0 ? (
                <p className="mt-2 text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {detail.associationRefs.map((a) => (
                    <li
                      key={a}
                      className="rounded-full border border-ink-subtle bg-ink-surface px-2.5 py-1 text-xs text-ink-secondary"
                    >
                      {a}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
