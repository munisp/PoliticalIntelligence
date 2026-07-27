import { useMemo, useState } from "react";
import { Wallet, Printer, AlertTriangle, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { EmptyState, SkeletonCard } from "@/components/shared";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import {
  useOptimizePortfolio,
  type OptimizePortfolioResult,
} from "@/lib/innovations-client";
import { JURISDICTION_ID, unwrapData } from "@/components/dashboard/utils";
import type { OpportunityItem } from "@/components/opportunities/types";

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-NG");

const RISK_OPTIONS = [
  { id: "low", label: "Low max risk", hint: "Only high-confidence interventions" },
  { id: "medium", label: "Medium max risk", hint: "Balanced confidence mix" },
  { id: "high", label: "High max risk", hint: "Include exploratory options" },
] as const;

const SECTOR_CAP_OPTIONS = [20, 30, 40, 50] as const;

export default function Optimizer() {
  const [budget, setBudget] = useState<string>("500000000");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [maxRisk, setMaxRisk] = useState<string>("medium");
  const [sectorCap, setSectorCap] = useState<number>(40);
  const [result, setResult] = useState<OptimizePortfolioResult | null>(null);

  const oppsQ = trpc.opportunities.rankings.useQuery({
    jurisdiction_id: JURISDICTION_ID,
    limit: 25,
  });
  const opportunities = useMemo(
    () => (unwrapData(oppsQ.data)?.items ?? []) as OpportunityItem[],
    [oppsQ.data],
  );

  const optimizeM = useOptimizePortfolio({
    onSuccess: (r) => setResult(r),
  });

  const budgetNgn = Number(budget.replace(/[^\d]/g, "")) || 0;

  const toggle = (id: string) =>
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const solve = () =>
    optimizeM.mutate({
      jurisdiction_id: JURISDICTION_ID,
      budget_ngn: budgetNgn,
      intervention_ids: Array.from(selectedIds),
      constraints: { max_risk: maxRisk, sector_cap_pct: sectorCap },
    });

  return (
    <InnovationPage
      title="Budget Portfolio Optimizer"
      description="Allocate a capital budget across candidate interventions under risk and sector-cap constraints. The solver returns the selected portfolio, totals, and the constraints that bound the solution."
      Icon={Wallet}
      actions={
        result ? (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] text-ink-secondary hover:border-ink-strong print:hidden"
          >
            <Printer aria-hidden className="h-4 w-4" /> Export / print
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* ------------------------- inputs ------------------------- */}
        <div className="space-y-4 print:hidden">
          <div className="rounded-md border border-ink-subtle bg-ink-surface p-4">
            <label htmlFor="budget" className="text-sm font-semibold text-ink-primary">
              Budget (₦)
            </label>
            <input
              id="budget"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="mt-2 w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 font-mono text-sm text-ink-primary outline-none focus:border-civic"
              aria-describedby="budget-preview"
            />
            <p id="budget-preview" className="mt-1 font-mono text-[12px] text-ink-muted">
              {naira.format(budgetNgn)}
            </p>

            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-ink-primary">Max risk</legend>
              <div className="mt-2 space-y-1.5">
                {RISK_OPTIONS.map((r) => (
                  <label
                    key={r.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2",
                      maxRisk === r.id
                        ? "border-civic bg-civic/5"
                        : "border-ink-subtle hover:border-ink-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="max-risk"
                      value={r.id}
                      checked={maxRisk === r.id}
                      onChange={() => setMaxRisk(r.id)}
                      className="mt-0.5 accent-civic"
                    />
                    <span>
                      <span className="block text-[13px] text-ink-primary">{r.label}</span>
                      <span className="block text-[11px] text-ink-muted">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-ink-primary">
                Sector cap (% of budget)
              </legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SECTOR_CAP_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={sectorCap === c}
                    onClick={() => setSectorCap(c)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-[12px]",
                      sectorCap === c
                        ? "border-civic bg-civic/10 text-civic"
                        : "border-ink-subtle text-ink-secondary hover:border-ink-strong",
                    )}
                  >
                    {c}%
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="rounded-md border border-ink-subtle bg-ink-surface p-4">
            <h2 className="text-sm font-semibold text-ink-primary">
              Candidate interventions
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Select the opportunities the solver may choose from ({selectedIds.size} selected).
            </p>
            {oppsQ.isLoading && <SkeletonCard className="mt-3" />}
            {oppsQ.isError && (
              <p className="mt-3 text-[12px] text-status-danger">{oppsQ.error.message}</p>
            )}
            <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {opportunities.map((o) => (
                <li key={o.opportunityId}>
                  <button
                    type="button"
                    aria-pressed={selectedIds.has(o.opportunityId)}
                    onClick={() => toggle(o.opportunityId)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left",
                      selectedIds.has(o.opportunityId)
                        ? "border-civic bg-civic/5"
                        : "border-ink-subtle hover:border-ink-strong",
                    )}
                  >
                    {selectedIds.has(o.opportunityId) ? (
                      <CheckSquare aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-civic" />
                    ) : (
                      <Square aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink-primary">{o.title}</span>
                      <span className="block font-mono text-[11px] text-ink-muted">
                        {o.sectorCode} · score {o.score.toFixed(2)} · est. jobs{" "}
                        {num.format(o.estimatedJobsMax ?? o.estimatedJobsMin ?? 0)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={selectedIds.size === 0 || budgetNgn <= 0 || optimizeM.isPending}
              onClick={solve}
              className="mt-3 w-full rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base transition-transform enabled:hover:bg-civic-strong enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {optimizeM.isPending ? "Solving…" : "Solve portfolio"}
            </button>
            <div aria-live="polite">
              {optimizeM.isError && (
                <div className="mt-3">
                  <InnovationError error={optimizeM.error} onRetry={solve} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ------------------------- results ------------------------- */}
        <div aria-live="polite" className="space-y-4">
          {!result && !optimizeM.isPending && (
            <EmptyState
              Icon={Wallet}
              showSpotArt={false}
              title="No solution yet"
              guidance="Set a budget, pick candidate interventions and constraints, then solve. The optimal portfolio appears here."
            />
          )}
          {optimizeM.isPending && <SkeletonCard />}
          {result && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-ink-subtle bg-ink-surface p-4">
                  <p className="caption-label text-ink-muted">Total cost</p>
                  <p className="mt-1 font-mono text-xl text-ink-primary">
                    {naira.format(result.total_cost)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                    of {naira.format(budgetNgn)} budget
                  </p>
                </div>
                <div className="rounded-md border border-ink-subtle bg-ink-surface p-4">
                  <p className="caption-label text-ink-muted">Expected jobs</p>
                  <p className="mt-1 font-mono text-xl text-ink-primary">
                    {num.format(result.total_jobs)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                    across {result.selected.length} interventions
                  </p>
                </div>
              </div>

              {result.binding_constraints.length > 0 && (
                <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3.5">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-primary">
                    <AlertTriangle aria-hidden className="h-4 w-4 text-status-warning" />
                    Binding constraints
                  </h3>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12px] text-ink-secondary">
                    {result.binding_constraints.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              <ul className="space-y-2">
                {result.selected.map((s) => (
                  <li
                    key={s.intervention_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-subtle bg-ink-surface p-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink-primary">{s.title}</p>
                      <p className="font-mono text-[10px] text-ink-muted">{s.intervention_id}</p>
                    </div>
                    <div className="flex gap-4 font-mono text-[12px] text-ink-secondary">
                      <span>
                        Cost <span className="text-ink-primary">{naira.format(s.cost_ngn)}</span>
                      </span>
                      <span>
                        Jobs <span className="text-ink-primary">{num.format(s.expected_jobs)}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </InnovationPage>
  );
}
