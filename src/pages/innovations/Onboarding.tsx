import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Compass,
  CheckCircle2,
  Globe,
  Package,
  Sigma,
  FileQuestion,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, SkeletonCard, StatusDot } from "@/components/shared";
import { useT } from "@/lib/LocaleContext";
import LanguageSwitcher from "@/components/innovations/LanguageSwitcher";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import {
  useOnboardingPacks,
  useOnboardingPack,
  useOnboardMutation,
  useOnboardingStatus,
  useOnboardingJurisdictions,
  type OnboardingPackSummary,
} from "@/lib/innovations-client";

type Step = 0 | 1 | 2 | 3;

function Stepper({ step, labels }: { step: Step; labels: string[] }) {
  return (
    <ol aria-label="Onboarding progress" className="flex flex-wrap items-center gap-2">
      {labels.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[11px]",
              i < step
                ? "border-status-success/50 bg-status-success/10 text-status-success"
                : i === step
                  ? "border-civic bg-civic/10 text-civic"
                  : "border-ink-subtle bg-ink-elevated text-ink-muted",
            )}
          >
            {i < step ? <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              "text-[12px]",
              i === step ? "font-medium text-ink-primary" : "text-ink-muted",
            )}
          >
            {label}
          </span>
          {i < labels.length - 1 && <span aria-hidden className="h-px w-6 bg-ink-subtle" />}
        </li>
      ))}
    </ol>
  );
}

function HierarchyTree({ nodes }: { nodes: { level: string; name: string; children?: unknown[] }[] }) {
  return (
    <ul className="space-y-1 border-l border-ink-subtle pl-3">
      {nodes.map((n, i) => (
        <li key={`${n.level}-${n.name}-${i}`}>
          <p className="text-[13px] text-ink-primary">
            {n.name}{" "}
            <span className="font-mono text-[10px] uppercase text-ink-muted">{n.level}</span>
          </p>
          {Array.isArray(n.children) && n.children.length > 0 && (
            <HierarchyTree
              nodes={n.children as { level: string; name: string; children?: unknown[] }[]}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Onboarding() {
  const t = useT();
  const [step, setStep] = useState<Step>(0);
  const [selected, setSelected] = useState<OnboardingPackSummary | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const logRef = useRef<HTMLDivElement>(null);

  const packsQ = useOnboardingPacks();
  const packQ = useOnboardingPack(selected?.pack_code ?? null, { enabled: step === 1 });
  const onboardM = useOnboardMutation({
    onSuccess: (d) => {
      setJobId(d.job_id);
      idempotencyKey.current = crypto.randomUUID();
    },
  });
  const statusQ = useOnboardingStatus(jobId, { enabled: step === 2 });
  const jurisdictionsQ = useOnboardingJurisdictions({ enabled: step === 3 });

  const status = statusQ.data;
  useEffect(() => {
    if (status?.status === "succeeded" || status?.status === "failed") setStep(3);
  }, [status?.status]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [status?.log?.length]);

  const stepLabels = [t.onboarding.stepPack, t.onboarding.stepReview, t.onboarding.stepRun, t.onboarding.stepDone];

  const doneProvenance = useMemo(() => {
    const jid = status?.result?.jurisdiction_id;
    if (!jid || !jurisdictionsQ.data) return null;
    return jurisdictionsQ.data.find((j) => j.jurisdiction_id === jid) ?? null;
  }, [status?.result?.jurisdiction_id, jurisdictionsQ.data]);

  return (
    <InnovationPage
      title={t.onboarding.title}
      description="Import a jurisdiction from a config pack. This imports REAL data from live sources where available — everything else is clearly labeled as seed demo data."
      Icon={Compass}
      actions={<LanguageSwitcher />}
    >
      <Stepper step={step} labels={stepLabels} />

      {/* ---------------- Step 0: pick pack ---------------- */}
      {step === 0 && (
        <section aria-label={t.onboarding.stepPack} className="space-y-3">
          {packsQ.isLoading && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}
          {packsQ.isError && (
            <InnovationError error={packsQ.error} onRetry={() => void packsQ.refetch()} />
          )}
          {packsQ.data && packsQ.data.length === 0 && (
            <EmptyState
              title="No config packs available"
              guidance="Config packs define a jurisdiction's hierarchy, connectors, and seed policy. Ask a platform steward to publish one."
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {packsQ.data?.map((p) => (
              <button
                key={p.pack_code}
                type="button"
                aria-pressed={selected?.pack_code === p.pack_code}
                onClick={() => setSelected(p)}
                className={cn(
                  "flex flex-col gap-2 rounded-md border p-4 text-left transition-colors",
                  selected?.pack_code === p.pack_code
                    ? "border-civic bg-civic/5"
                    : "border-ink-subtle bg-ink-surface hover:border-ink-strong",
                )}
              >
                <span className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-primary">{p.name}</span>
                  <span className="font-mono text-[10px] uppercase text-ink-muted">
                    {p.country_iso3}
                  </span>
                </span>
                <span className="text-[12px] text-ink-secondary">
                  {p.admin_levels.length} admin levels · {p.live_connectors.length} live connectors
                </span>
                <span className="flex flex-wrap gap-1">
                  {p.live_connectors.slice(0, 3).map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 rounded-full border border-civic/50 bg-civic/10 px-1.5 py-0.5 text-[10px] text-civic"
                    >
                      <Globe aria-hidden className="h-2.5 w-2.5" /> LIVE {c}
                    </span>
                  ))}
                </span>
              </button>
            ))}
            <a
              href="https://docs.meridian.example/config-packs"
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-start justify-center gap-2 rounded-md border border-dashed border-ink-subtle bg-ink-surface/50 p-4 text-left hover:border-civic/40"
            >
              <FileQuestion aria-hidden className="h-5 w-5 text-ink-muted" />
              <span className="text-sm font-medium text-ink-primary">Need a custom pack?</span>
              <span className="text-[12px] text-ink-secondary">
                Read the config-pack authoring guide to onboard any jurisdiction.
              </span>
            </a>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!selected}
              onClick={() => setStep(1)}
              className="rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base transition-transform enabled:hover:bg-civic-strong enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.action.next}
            </button>
          </div>
        </section>
      )}

      {/* ---------------- Step 1: review ---------------- */}
      {step === 1 && selected && (
        <section aria-label={t.onboarding.stepReview} className="space-y-4">
          {packQ.isLoading && <SkeletonCard />}
          {packQ.isError && (
            <InnovationError error={packQ.error} onRetry={() => void packQ.refetch()} />
          )}
          {packQ.data && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-ink-subtle bg-ink-surface p-4">
                <h2 className="text-sm font-semibold text-ink-primary">Administrative hierarchy</h2>
                <div className="mt-3">
                  {packQ.data.hierarchy && packQ.data.hierarchy.length > 0 ? (
                    <HierarchyTree nodes={packQ.data.hierarchy} />
                  ) : (
                    <p className="text-[12px] text-ink-muted">
                      {packQ.data.admin_levels.join(" → ")}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-md border border-ink-subtle bg-ink-surface p-4">
                  <h2 className="text-sm font-semibold text-ink-primary">Live connectors</h2>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {packQ.data.live_connectors.map((c) => (
                      <li
                        key={c}
                        className="inline-flex items-center gap-1 rounded-full border border-civic/50 bg-civic/10 px-2 py-0.5 text-[11px] text-civic"
                      >
                        <Globe aria-hidden className="h-3 w-3" /> LIVE · {c}
                      </li>
                    ))}
                    {packQ.data.live_connectors.length === 0 && (
                      <li className="text-[12px] text-ink-muted">No live connectors in this pack.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-4">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-primary">
                    <Package aria-hidden className="h-4 w-4 text-status-warning" />
                    Seed policy — what will be labeled seed
                  </h2>
                  {packQ.data.seed_policy?.seeded_datasets &&
                  packQ.data.seed_policy.seeded_datasets.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-ink-secondary">
                      {packQ.data.seed_policy.seeded_datasets.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[12px] text-ink-secondary">
                      {packQ.data.seed_policy?.notes ??
                        "Datasets without a live connector are imported as clearly-labeled seed demo data — never silently presented as real."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-md border border-ink-subtle px-4 py-2 text-sm text-ink-secondary hover:border-ink-strong"
            >
              {t.action.back}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(2);
                onboardM.mutate({ pack_code: selected.pack_code, idempotency_key: idempotencyKey.current });
              }}
              className="rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base hover:bg-civic-strong"
            >
              Start import
            </button>
          </div>
        </section>
      )}

      {/* ---------------- Step 2: run ---------------- */}
      {step === 2 && (
        <section aria-label={t.onboarding.stepRun} className="space-y-4">
          {onboardM.isError && (
            <InnovationError
              error={onboardM.error}
              onRetry={() =>
                selected &&
                onboardM.mutate({ pack_code: selected.pack_code, idempotency_key: idempotencyKey.current })
              }
            />
          )}
          {statusQ.isError && (
            <InnovationError error={statusQ.error} onRetry={() => void statusQ.refetch()} />
          )}
          <div className="rounded-md border border-ink-subtle bg-ink-surface p-4">
            <div aria-live="polite" className="flex items-center gap-2">
              <StatusDot
                status={
                  status?.status === "succeeded"
                    ? "succeeded"
                    : status?.status === "failed"
                      ? "failing"
                      : status?.status === "queued"
                        ? "queued"
                        : "running"
                }
              />
              <span className="text-sm font-medium text-ink-primary">
                {status?.status ?? (onboardM.isPending ? "Starting…" : "Queued")}
              </span>
              {status?.progress != null && (
                <span className="font-mono text-[12px] text-ink-muted">{status.progress}%</span>
              )}
            </div>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-inset"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status?.progress ?? 0}
            >
              <div
                className="h-full rounded-full bg-civic transition-all"
                style={{ width: `${status?.progress ?? 0}%` }}
              />
            </div>
            <div
              ref={logRef}
              aria-live="polite"
              aria-label="Import log"
              className="mt-3 max-h-56 overflow-y-auto rounded-md border border-ink-subtle bg-ink-inset p-3 font-mono text-[11px] leading-5 text-ink-secondary"
            >
              {(status?.log ?? []).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {(!status?.log || status.log.length === 0) && <p>Waiting for job output…</p>}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- Step 3: done ---------------- */}
      {step === 3 && (
        <section aria-label={t.onboarding.stepDone} className="space-y-4">
          {status?.status === "failed" ? (
            <EmptyState
              showSpotArt={false}
              title="Import failed"
              guidance="The onboarding job did not complete. Review the log above and retry, or contact a platform steward."
              action={{ label: "Start over", onClick: () => { setJobId(null); setStep(0); } }}
            />
          ) : (
            <div className="rounded-md border border-status-success/40 bg-status-success/5 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
                <CheckCircle2 aria-hidden className="h-4 w-4 text-status-success" />
                Jurisdiction imported
              </h2>
              <p className="mt-1 font-mono text-[12px] text-ink-muted">
                {status?.result?.jurisdiction_id ?? "—"}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {(
                  [
                    { label: "Live source", n: doneProvenance?.provenance.live, Icon: Globe, cls: "text-civic border-civic/50 bg-civic/10" },
                    { label: "Derived", n: doneProvenance?.provenance.derived, Icon: Sigma, cls: "text-civic-periwinkle border-civic-periwinkle/50 bg-civic-periwinkle/10" },
                    { label: "Seed demo", n: doneProvenance?.provenance.seed, Icon: Package, cls: "text-ink-muted border-ink-subtle bg-ink-elevated" },
                  ] as const
                ).map(({ label, n, Icon, cls }) => (
                  <span
                    key={label}
                    className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", cls)}
                  >
                    <Icon aria-hidden className="h-3.5 w-3.5" />
                    {label}: <span className="font-mono">{n ?? "…"}</span>
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-ink-secondary">
                Seed-labeled data is illustrative. Connect live sources in Data Source Health to
                replace it with measured data.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center gap-1.5 rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base hover:bg-civic-strong"
                >
                  <ArrowRightLeft aria-hidden className="h-4 w-4" />
                  Switch jurisdiction
                </Link>
                <Link
                  to="/data-health"
                  className="rounded-md border border-ink-subtle px-4 py-2 text-sm text-ink-secondary hover:border-ink-strong"
                >
                  Data Source Health
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
    </InnovationPage>
  );
}
