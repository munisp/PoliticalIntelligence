import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Store, Star, Download, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { ApprovalBadge, EmptyState, SkeletonCard, type ApprovalState } from "@/components/shared";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import {
  useMarketplaceList,
  useMarketplaceInstall,
  useMarketplacePublish,
  type MarketplaceTemplate,
} from "@/lib/innovations-client";
import { approvalStateLabel } from "@/lib/trpc-data";
import { JURISDICTION_ID, unwrapData } from "@/components/dashboard/utils";

const APPROVAL_STATES: ApprovalState[] = ["draft", "in-review", "approved", "signed-off", "returned"];

function toBadgeState(dbState: string): ApprovalState {
  const label = approvalStateLabel(dbState) as ApprovalState;
  return APPROVAL_STATES.includes(label) ? label : "draft";
}

function Stars({ rating }: { rating: number }) {
  const full = Math.round(Math.min(5, Math.max(0, rating)));
  return (
    <span
      role="img"
      aria-label={`Rated ${rating.toFixed(1)} out of 5`}
      className="inline-flex items-center gap-0.5"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn(
            "h-3.5 w-3.5",
            i <= full ? "fill-gold text-gold" : "text-ink-subtle",
          )}
        />
      ))}
      <span className="ml-1 font-mono text-[11px] text-ink-muted">{rating.toFixed(1)}</span>
    </span>
  );
}

interface ScenarioRow {
  scenarioId?: string;
  scenario_id?: string;
  name?: string;
}

export default function Marketplace() {
  const [installing, setInstalling] = useState<MarketplaceTemplate | null>(null);
  const [installedScenario, setInstalledScenario] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishScenario, setPublishScenario] = useState("");
  const [publishName, setPublishName] = useState("");
  const [publishDesc, setPublishDesc] = useState("");

  const listQ = useMarketplaceList();
  const scenariosQ = trpc.scenarios.list.useQuery(
    { jurisdiction_id: JURISDICTION_ID, limit: 25 },
    { enabled: publishOpen },
  );
  const scenarios = useMemo(
    () => (unwrapData(scenariosQ.data)?.items ?? []) as ScenarioRow[],
    [scenariosQ.data],
  );

  const installM = useMarketplaceInstall({
    onSuccess: (d) => {
      setInstalledScenario(d.scenario_id);
      setInstalling(null);
    },
  });
  const publishM = useMarketplacePublish({
    onSuccess: () => {
      setPublishOpen(false);
      void listQ.refetch();
    },
  });

  return (
    <InnovationPage
      title="Scenario Marketplace"
      description="Install reviewed scenario templates shared by other jurisdictions, or publish your own. Publishing goes through a human-review gate before templates become visible to others."
      Icon={Store}
      actions={
        <button
          type="button"
          onClick={() => setPublishOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-[13px] font-medium text-ink-base hover:bg-civic-strong"
        >
          <Upload aria-hidden className="h-4 w-4" /> Publish a scenario
        </button>
      }
    >
      <div aria-live="polite">
        {installedScenario && (
          <p className="rounded-md border border-status-success/40 bg-status-success/10 px-3.5 py-2.5 text-[13px] text-ink-primary">
            Template installed.{" "}
            <Link to="/simulation" className="font-medium text-civic hover:underline">
              Open in Simulation Studio →
            </Link>{" "}
            <span className="font-mono text-[11px] text-ink-muted">({installedScenario})</span>
          </p>
        )}
      </div>

      {listQ.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {listQ.isError && <InnovationError error={listQ.error} onRetry={() => void listQ.refetch()} />}
      {listQ.data && listQ.data.length === 0 && (
        <EmptyState
          Icon={Store}
          showSpotArt={false}
          title="No templates published yet"
          guidance="Be the first — publish one of your scenarios for peer jurisdictions to reuse (subject to human review)."
        />
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {listQ.data?.map((t) => (
          <li
            key={t.template_id}
            className="flex flex-col gap-2.5 rounded-md border border-ink-subtle bg-ink-surface p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-primary">{t.name}</h2>
              <ApprovalBadge state={toBadgeState(t.published_state)} />
            </div>
            <p className="flex-1 text-[12px] leading-4 text-ink-secondary">{t.description}</p>
            <p className="text-[11px] text-ink-muted">
              by <span className="font-medium text-ink-secondary">{t.author_jurisdiction}</span>
            </p>
            <div className="flex items-center justify-between">
              <Stars rating={t.rating} />
              <span className="font-mono text-[11px] text-ink-muted">
                {t.installs.toLocaleString()} installs
              </span>
            </div>
            <button
              type="button"
              onClick={() => setInstalling(t)}
              className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-civic/50 px-3 py-1.5 text-[13px] font-medium text-civic hover:bg-civic/10"
            >
              <Download aria-hidden className="h-4 w-4" /> Install
            </button>
          </li>
        ))}
      </ul>

      {/* ----------------------- install dialog ----------------------- */}
      {installing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Install ${installing.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-base/70 p-4"
          onClick={(e) => e.target === e.currentTarget && setInstalling(null)}
        >
          <div className="w-full max-w-sm rounded-md border border-ink-subtle bg-ink-elevated p-5">
            <h2 className="text-sm font-semibold text-ink-primary">
              Install “{installing.name}”
            </h2>
            <p className="mt-1 text-[12px] text-ink-secondary">
              The template will be installed as a new scenario into jurisdiction{" "}
              <span className="font-mono text-ink-primary">{JURISDICTION_ID}</span>.
            </p>
            <div aria-live="polite" className="mt-3">
              {installM.isError && <InnovationError error={installM.error} />}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInstalling(null)}
                className="rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] text-ink-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={installM.isPending}
                onClick={() =>
                  installM.mutate({
                    template_id: installing.template_id,
                    jurisdiction_id: JURISDICTION_ID,
                  })
                }
                className="rounded-md bg-civic px-3 py-1.5 text-[13px] font-medium text-ink-base disabled:opacity-40"
              >
                {installM.isPending ? "Installing…" : "Install"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------- publish dialog ----------------------- */}
      {publishOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Publish a scenario"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-base/70 p-4"
          onClick={(e) => e.target === e.currentTarget && setPublishOpen(false)}
        >
          <div className="w-full max-w-md rounded-md border border-ink-subtle bg-ink-elevated p-5">
            <div className="flex items-start justify-between">
              <h2 className="text-sm font-semibold text-ink-primary">Publish a scenario</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPublishOpen(false)}
                className="rounded p-1 text-ink-muted hover:text-ink-primary"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 rounded-md border border-status-warning/40 bg-status-warning/10 px-2.5 py-1.5 text-[11px] text-ink-secondary">
              Human-review gate: published templates are reviewed by platform stewards before
              becoming visible to other jurisdictions.
            </p>
            <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
              Scenario
              <select
                value={publishScenario}
                onChange={(e) => setPublishScenario(e.target.value)}
                className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
              >
                <option value="">Select a scenario…</option>
                {scenarios.map((s) => {
                  const id = s.scenarioId ?? s.scenario_id ?? "";
                  return (
                    <option key={id} value={id}>
                      {s.name ?? id}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
              Template name
              <input
                value={publishName}
                onChange={(e) => setPublishName(e.target.value)}
                className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
              Description
              <textarea
                value={publishDesc}
                onChange={(e) => setPublishDesc(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
              />
            </label>
            <div aria-live="polite" className="mt-3">
              {publishM.isError && <InnovationError error={publishM.error} />}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] text-ink-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!publishScenario || !publishName || publishM.isPending}
                onClick={() =>
                  publishM.mutate({
                    scenario_id: publishScenario,
                    name: publishName,
                    description: publishDesc,
                  })
                }
                className="rounded-md bg-civic px-3 py-1.5 text-[13px] font-medium text-ink-base disabled:opacity-40"
              >
                {publishM.isPending ? "Submitting…" : "Submit for review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </InnovationPage>
  );
}
