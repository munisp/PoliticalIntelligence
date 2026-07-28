import { useMemo, useState } from "react";
import { Scale, UserCheck, GitPullRequestArrow } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { ApprovalBadge, EmptyState, SkeletonTable, type ApprovalState } from "@/components/shared";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import { useT } from "@/lib/LocaleContext";
import { approvalStateLabel, unwrap } from "@/lib/trpc-data";
import { useAuth } from "@/hooks/useAuth";

interface ClauseRow {
  clauseId: string;
  lawId: string;
  sectionPath: string;
  text: string;
  language: string;
  confidence: number;
  reviewState: string | null;
  /** Optional dual-annotation payloads when two annotators labelled the clause. */
  annotations?: { annotator: string; label: string }[] | null;
}

type Agreement = "agree" | "disagree" | "partial" | "single";

/** Client-side two-annotator agreement from dual entries when present. */
function agreementOf(annotations: ClauseRow["annotations"]): Agreement {
  if (!annotations || annotations.length < 2) return "single";
  const labels = annotations.map((a) => a.label.trim().toLowerCase());
  if (labels[0] === labels[1]) return "agree";
  // partial: one label is a prefix/subset of the other (e.g. obligation vs obligation+penalty)
  if (labels[0].includes(labels[1]) || labels[1].includes(labels[0])) return "partial";
  return "disagree";
}

const AGREEMENT_META: Record<Agreement, { label: string; classes: string }> = {
  agree: { label: "Agree", classes: "border-status-success/50 bg-status-success/10 text-status-success" },
  disagree: { label: "Disagree", classes: "border-status-danger/50 bg-status-danger/10 text-status-danger" },
  partial: { label: "Partial", classes: "border-status-warning/50 bg-status-warning/10 text-status-warning" },
  single: { label: "Single annotator", classes: "border-ink-subtle bg-ink-elevated text-ink-muted" },
};

function heatClass(confidence: number): string {
  if (confidence >= 0.75) return "bg-status-success";
  if (confidence >= 0.5) return "bg-status-warning";
  return "bg-status-danger";
}

const APPROVAL_STATES: ApprovalState[] = ["draft", "in-review", "approved", "signed-off", "returned"];

function toBadgeState(dbState: string | null): ApprovalState {
  const label = approvalStateLabel(dbState ?? "draft") as ApprovalState;
  return APPROVAL_STATES.includes(label) ? label : "draft";
}

export default function LegalQa() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const [lowConfOnly, setLowConfOnly] = useState(false);

  const queueQ = trpc.legislation.reviewQueue.useQuery(
    { limit: 50, low_confidence_only: lowConfOnly },
    { enabled: isAuthenticated, retry: false },
  );

  const rows = useMemo(
    () => unwrap<ClauseRow[]>(queueQ.data as unknown as null) ?? [],
    [queueQ.data],
  );

  const agreementCounts = useMemo(() => {
    const counts = { agree: 0, disagree: 0, partial: 0, single: 0 };
    for (const r of rows) counts[agreementOf(r.annotations)]++;
    return counts;
  }, [rows]);

  return (
    <InnovationPage
      title={t.innovations.legalQaTitle}
      description="Legislation clause review queue with inter-annotator agreement. Two-annotator agreement is computed client-side from dual annotation entries when present."
      Icon={Scale}
      actions={
        <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <input
            type="checkbox"
            checked={lowConfOnly}
            onChange={(e) => setLowConfOnly(e.target.checked)}
            className="h-4 w-4 accent-civic"
          />
          Low-confidence only
        </label>
      }
    >
      {/* agreement summary */}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(AGREEMENT_META) as Agreement[]).map((k) => (
            <span
              key={k}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                AGREEMENT_META[k].classes,
              )}
            >
              <UserCheck aria-hidden className="h-3 w-3" />
              {AGREEMENT_META[k].label}: <span className="font-mono">{agreementCounts[k]}</span>
            </span>
          ))}
        </div>
      )}

      {queueQ.isLoading && <SkeletonTable rows={6} />}
      {queueQ.isError && (
        <InnovationError error={queueQ.error} onRetry={() => void queueQ.refetch()} />
      )}
      {!queueQ.isLoading && !queueQ.isError && rows.length === 0 && (
        <EmptyState
          Icon={Scale}
          showSpotArt={false}
          title="Review queue is clear"
          guidance="No clauses are waiting for legal review. Requires a signed-in legal analyst role."
        />
      )}

      <div className="overflow-x-auto rounded-md border border-ink-subtle">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-ink-subtle bg-ink-elevated text-[11px] uppercase tracking-wide text-ink-muted">
              <th scope="col" className="px-3 py-2 font-medium">Clause</th>
              <th scope="col" className="px-3 py-2 font-medium">State</th>
              <th scope="col" className="px-3 py-2 font-medium">Confidence</th>
              <th scope="col" className="px-3 py-2 font-medium">2-annotator agreement</th>
              <th scope="col" className="px-3 py-2 font-medium">Reassign</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ag = agreementOf(r.annotations);
              return (
                <tr key={r.clauseId} className="border-b border-ink-subtle/60 bg-ink-surface align-top">
                  <td className="max-w-md px-3 py-2.5">
                    <p className="font-mono text-[10px] text-ink-muted">
                      {r.lawId} · {r.sectionPath}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-ink-primary">{r.text}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <ApprovalBadge state={toBadgeState(r.reviewState)} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        role="img"
                        aria-label={`Confidence ${(r.confidence * 100).toFixed(0)} percent`}
                        className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-inset"
                      >
                        <span
                          className={cn("block h-full rounded-full", heatClass(r.confidence))}
                          style={{ width: `${Math.min(100, r.confidence * 100)}%` }}
                        />
                      </span>
                      <span className="font-mono text-[11px] text-ink-secondary">
                        {r.confidence.toFixed(2)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                        AGREEMENT_META[ag].classes,
                      )}
                    >
                      <GitPullRequestArrow aria-hidden className="h-3 w-3" />
                      {AGREEMENT_META[ag].label}
                    </span>
                    {r.annotations && r.annotations.length >= 2 && (
                      <p className="mt-1 font-mono text-[10px] text-ink-muted">
                        {r.annotations.map((a) => `${a.annotator}: ${a.label}`).join(" · ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span title="Reassignment endpoint is not deployed yet — coming with the legal workflow service.">
                      <select
                        disabled
                        aria-label="Reassign reviewer (not available yet)"
                        className="cursor-not-allowed rounded-md border border-ink-subtle bg-ink-inset px-2 py-1 text-[11px] text-ink-muted"
                      >
                        <option>Reassign…</option>
                      </select>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </InnovationPage>
  );
}
