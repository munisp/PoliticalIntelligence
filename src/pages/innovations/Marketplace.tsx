import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Store, Download, Upload, X, GitFork, ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { EmptyState, SkeletonCard } from "@/components/shared";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import { useT } from "@/lib/LocaleContext";
import { JURISDICTION_ID, unwrapData } from "@/components/dashboard/utils";

/**
 * I9 — Scenario marketplace: publish reproducible runs, fork them into your
 * jurisdiction, verify reproducibility hashes. (Design preserved from the
 * earlier template-marketplace mock; now backed by the `marketplace` router.)
 */

interface PublishedRow {
  published_id: string;
  scenario_run_id: string;
  title: string;
  summary: string | null;
  fork_count: number;
  reproducibility_hash: string | null;
  published_at: string | Date;
}

interface VerifyRow {
  badge: "valid" | "stale";
}

interface ScenarioRow {
  scenarioId?: string;
  scenario_id?: string;
  name?: string;
}

interface RunRow {
  simulationRunId?: string;
  simulation_run_id?: string;
  status?: string;
  reproducibilityHash?: string | null;
  reproducibility_hash?: string | null;
  engine?: string;
}

function VerifyBadge({ publishedId }: { publishedId: string }) {
  const q = trpc.marketplace.verify.useQuery({ published_id: publishedId });
  const v = unwrapData(q.data) as VerifyRow | undefined;
  if (!v) return null;
  const valid = v.badge === "valid";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]",
        valid
          ? "border-status-success/50 bg-status-success/10 text-status-success"
          : "border-status-warning/50 bg-status-warning/10 text-status-warning",
      )}
      title={valid ? "Reproducibility hash verified" : "Hash stale — run changed since publish"}
    >
      {valid ? (
        <ShieldCheck aria-hidden className="h-3 w-3" />
      ) : (
        <ShieldAlert aria-hidden className="h-3 w-3" />
      )}
      {valid ? "verified" : "stale"}
    </span>
  );
}

export default function Marketplace() {
  const t = useT();
  const utils = trpc.useUtils();
  const [installing, setInstalling] = useState<PublishedRow | null>(null);
  const [installedScenario, setInstalledScenario] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishScenario, setPublishScenario] = useState("");
  const [publishRun, setPublishRun] = useState("");
  const [publishName, setPublishName] = useState("");
  const [publishDesc, setPublishDesc] = useState("");

  const listQ = trpc.marketplace.list.useQuery({ limit: 25 });
  const published = useMemo(
    () => (unwrapData(listQ.data) as PublishedRow[] | undefined) ?? [],
    [listQ.data],
  );

  const scenariosQ = trpc.scenarios.list.useQuery(
    { jurisdiction_id: JURISDICTION_ID, limit: 25 },
    { enabled: publishOpen },
  );
  const scenarios = useMemo(
    () => (unwrapData(scenariosQ.data)?.items ?? []) as ScenarioRow[],
    [scenariosQ.data],
  );

  /* Runs for the scenario picked in the publish dialog. */
  const scenarioDetailQ = trpc.scenarios.get.useQuery(
    { scenario_id: publishScenario },
    { enabled: publishOpen && !!publishScenario },
  );
  const runs = useMemo(() => {
    const d = unwrapData(scenarioDetailQ.data) as { runs?: RunRow[] } | undefined;
    return (d?.runs ?? []).filter(
      (r) =>
        (r.status === "succeeded" || !r.status) &&
        (r.reproducibilityHash ?? r.reproducibility_hash),
    );
  }, [scenarioDetailQ.data]);

  const forkM = trpc.marketplace.fork.useMutation({
    onSuccess: (d) => {
      setInstalledScenario(unwrapData(d)?.scenario_id ?? null);
      setInstalling(null);
      void utils.marketplace.list.invalidate();
    },
  });
  const publishM = trpc.marketplace.publish.useMutation({
    onSuccess: () => {
      setPublishOpen(false);
      setPublishScenario("");
      setPublishRun("");
      setPublishName("");
      setPublishDesc("");
      void utils.marketplace.list.invalidate();
    },
  });

  return (
    <InnovationPage
      title={t.innovations.marketplaceTitle}
      description="Publish reproducible simulation runs for peer jurisdictions to fork, or fork a published scenario into your own jurisdiction. Every entry carries a verifiable reproducibility hash."
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
            Scenario forked.{" "}
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
      {!listQ.isLoading && !listQ.isError && published.length === 0 && (
        <EmptyState
          Icon={Store}
          showSpotArt={false}
          title="No scenarios published yet"
          guidance="Be the first — publish one of your reproducible runs for peer jurisdictions to fork."
        />
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {published.map((p) => (
          <li
            key={p.published_id}
            className="flex flex-col gap-2.5 rounded-md border border-ink-subtle bg-ink-surface p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-primary">{p.title}</h2>
              <VerifyBadge publishedId={p.published_id} />
            </div>
            <p className="flex-1 text-[12px] leading-4 text-ink-secondary">
              {p.summary ?? "—"}
            </p>
            <p className="font-mono text-[10px] text-ink-muted">
              run {p.scenario_run_id}
              {p.reproducibility_hash && (
                <> · hash {p.reproducibility_hash.slice(0, 12)}…</>
              )}
            </p>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted">
                <GitFork aria-hidden className="h-3 w-3" />
                {p.fork_count.toLocaleString()} forks
              </span>
            </div>
            <button
              type="button"
              onClick={() => setInstalling(p)}
              className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-civic/50 px-3 py-1.5 text-[13px] font-medium text-civic hover:bg-civic/10"
            >
              <Download aria-hidden className="h-4 w-4" /> Fork
            </button>
          </li>
        ))}
      </ul>

      {/* ----------------------- fork dialog ----------------------- */}
      {installing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fork ${installing.title}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-base/70 p-4"
          onClick={(e) => e.target === e.currentTarget && setInstalling(null)}
        >
          <div className="w-full max-w-sm rounded-md border border-ink-subtle bg-ink-elevated p-5">
            <h2 className="text-sm font-semibold text-ink-primary">
              Fork “{installing.title}”
            </h2>
            <p className="mt-1 text-[12px] text-ink-secondary">
              A new draft scenario will be created from the published assumptions in
              jurisdiction{" "}
              <span className="font-mono text-ink-primary">{JURISDICTION_ID}</span>.
            </p>
            <div aria-live="polite" className="mt-3">
              {forkM.isError && <InnovationError error={forkM.error} />}
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
                disabled={forkM.isPending}
                onClick={() =>
                  forkM.mutate({
                    published_id: installing.published_id,
                    jurisdiction_id: JURISDICTION_ID,
                  })
                }
                className="rounded-md bg-civic px-3 py-1.5 text-[13px] font-medium text-ink-base disabled:opacity-40"
              >
                {forkM.isPending ? "Forking…" : "Fork"}
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
              Only runs with a persisted reproducibility manifest + hash can be published.
            </p>
            <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
              Scenario
              <select
                value={publishScenario}
                onChange={(e) => {
                  setPublishScenario(e.target.value);
                  setPublishRun("");
                }}
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
            {publishScenario && (
              <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
                Reproducible run
                <select
                  value={publishRun}
                  onChange={(e) => setPublishRun(e.target.value)}
                  className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
                >
                  <option value="">Select a run…</option>
                  {runs.map((r) => {
                    const id = r.simulationRunId ?? r.simulation_run_id ?? "";
                    return (
                      <option key={id} value={id}>
                        {id} {r.engine ? `(${r.engine})` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
              Title
              <input
                value={publishName}
                onChange={(e) => setPublishName(e.target.value)}
                className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
              Summary
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
                disabled={!publishRun || !publishName || publishM.isPending}
                onClick={() =>
                  publishM.mutate({
                    simulation_run_id: publishRun,
                    title: publishName,
                    summary: publishDesc || undefined,
                  })
                }
                className="rounded-md bg-civic px-3 py-1.5 text-[13px] font-medium text-ink-base disabled:opacity-40"
              >
                {publishM.isPending ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </InnovationPage>
  );
}
