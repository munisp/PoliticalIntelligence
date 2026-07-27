import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  MessageSquareText,
  Plus,
  RotateCcw,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { approvalStateLabel } from "@/lib/trpc-data";
import { ProvenanceChipFromInfo } from "@/components/provenance";
import { useAuth } from "@/hooks/useAuth";
import {
  ExecutiveStatCard,
  EvidenceDrawer,
  ExportMenu,
  SkeletonCard,
  SkeletonTable,
  StatusDot,
  type EvidenceSource,
  type StatusKind,
} from "@/components/shared";
import JobTargetTracker, {
  type TrackerRun,
} from "@/components/dashboard/JobTargetTracker";
import TopRisks, { type RiskItem } from "@/components/dashboard/TopRisks";
import SectorHighlights from "@/components/dashboard/SectorHighlights";
import ScenarioStrip, {
  type ScenarioCardData,
} from "@/components/dashboard/ScenarioStrip";
import ActivityFeed, {
  type ActivityItem,
} from "@/components/dashboard/ActivityFeed";
import ApprovalsColumn, {
  type ApprovalItem,
} from "@/components/dashboard/ApprovalsColumn";
import {
  ApprovalsKpiCard,
  TrajectoryRingCard,
  UnemploymentCard,
} from "@/components/dashboard/KpiCards";
import {
  JOBS_TARGET,
  JURISDICTION_ID,
  deltaAt,
  envelopeMetaOf,
  finalDelta,
  monthsSinceBaseline,
  unwrapData,
  type RunResultLike,
} from "@/components/dashboard/utils";

/* ------------------------------------------------------------------ */

function QueryError({
  label,
  onRetry,
  className,
}: {
  label: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={
        "flex items-center justify-between gap-3 rounded-md border border-status-danger/40 bg-status-danger/5 p-4 " +
        (className ?? "")
      }
    >
      <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <AlertTriangle aria-hidden className="h-4 w-4 text-status-danger" />
        {label} couldn't be loaded — check your connection.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-2.5 py-1 text-xs font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
      >
        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

const itemAnim = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: {
    delay: i * 0.06,
    duration: 0.24,
    ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
  },
});

/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  /* ------------------------------ queries ------------------------------ */
  const profileQ = trpc.jurisdictions.profile.useQuery({
    jurisdiction_id: JURISDICTION_ID,
  });
  const freshQ = trpc.ops.freshnessSummary.useQuery();
  const sectorsQ = trpc.sectors.list.useQuery();
  const metricsQ = trpc.sectors.metrics.useQuery({
    jurisdiction_id: JURISDICTION_ID,
  });
  const oppsQ = trpc.opportunities.rankings.useQuery({
    jurisdiction_id: JURISDICTION_ID,
    limit: 25,
  });
  const scenariosQ = trpc.scenarios.list.useQuery({
    jurisdiction_id: JURISDICTION_ID,
    limit: 8,
  });
  const briefsQ = trpc.briefs.list.useQuery({
    jurisdiction_id: JURISDICTION_ID,
    limit: 25,
  });
  const jobsQ = trpc.ops.jobsList.useQuery(
    { limit: 10 },
    { enabled: isAuthenticated, retry: false },
  );

  const profile = unwrapData(profileQ.data);
  const profileMeta = envelopeMetaOf(profileQ.data);
  const freshness = unwrapData(freshQ.data);
  const sectors = unwrapData(sectorsQ.data) ?? [];
  const metrics = unwrapData(metricsQ.data) ?? [];
  const opportunities = unwrapData(oppsQ.data)?.items ?? [];
  const scenarioRows = useMemo(
    () => unwrapData(scenariosQ.data)?.items ?? [],
    [scenariosQ.data],
  );
  const briefRows = unwrapData(briefsQ.data)?.items ?? [];
  const jobRows = useMemo(
    () => (jobsQ.data ? (unwrapData(jobsQ.data) ?? []) : []),
    [jobsQ.data],
  );

  /* --------------------- scenario runs (chained) ---------------------- */
  const scenarioIds = useMemo(
    () => scenarioRows.map((s) => s.scenarioId),
    [scenarioRows],
  );
  const scenarioGets = trpc.useQueries((t) =>
    scenarioIds.map((id) => t.scenarios.get({ scenario_id: id })),
  );

  // First succeeded run per scenario.
  const scenarioRunRows = useMemo(
    () =>
      scenarioGets.map((g) => {
        const detail = unwrapData(g.data);
        const runs = detail?.runs ?? [];
        return (
          runs.find((r) => r.status === "succeeded") ?? runs[0] ?? null
        );
      }),
    [scenarioGets],
  );
  const runIds = useMemo(
    () =>
      scenarioRunRows
        .filter(
          (r): r is NonNullable<typeof r> => !!r && r.status === "succeeded",
        )
        .map((r) => r.simulationRunId),
    [scenarioRunRows],
  );
  const runResultQs = trpc.useQueries((t) =>
    runIds.map((id) => t.scenarios.runResults({ simulation_run_id: id })),
  );
  const runResultsById = useMemo(() => {
    const map = new Map<string, RunResultLike>();
    runResultQs.forEach((q) => {
      const d = unwrapData(q.data);
      if (d) map.set(d.simulation_run_id, d as RunResultLike);
    });
    return map;
  }, [runResultQs]);

  /* ---------------------------- derived data --------------------------- */
  const currentMonth = freshness?.asOf
    ? monthsSinceBaseline(new Date(freshness.asOf))
    : 12;

  const trackerRuns: TrackerRun[] = useMemo(
    () =>
      scenarioRows.flatMap((s, i) => {
        const runRow = scenarioRunRows[i];
        const result = runRow ? runResultsById.get(runRow.simulationRunId) : null;
        if (!runRow || !result) return [];
        return [
          {
            scenarioId: s.scenarioId,
            scenarioName: s.name,
            engine: runRow.engine,
            seed: runRow.seed,
            finishedAt: runRow.finishedAt,
            result,
          },
        ];
      }),
    [scenarioRows, scenarioRunRows, runResultsById],
  );

  const scenarioCards: ScenarioCardData[] = useMemo(
    () =>
      scenarioRows.map((s, i) => {
        const runRow = scenarioRunRows[i];
        const plan = Array.isArray(s.modelPlan) ? s.modelPlan : [];
        return {
          scenarioId: s.scenarioId,
          name: s.name,
          description: s.description,
          status: s.status,
          version: s.version,
          engines: plan
            .map((p) =>
              p && typeof p === "object" && "engine" in p
                ? String((p as { engine: unknown }).engine)
                : "",
            )
            .filter(Boolean),
          run: runRow
            ? (runResultsById.get(runRow.simulationRunId) ?? null)
            : null,
        };
      }),
    [scenarioRows, scenarioRunRows, runResultsById],
  );

  const runsLoading =
    scenariosQ.isLoading ||
    scenarioGets.some((q) => q.isLoading) ||
    runResultQs.some((q) => q.isLoading);

  // KPI derivations
  const runs = trackerRuns.map((t) => t.result);
  const jobsYtd = runs.reduce((sum, r) => sum + deltaAt(r, currentMonth), 0);
  const jobsYtdPrior = runs.reduce(
    (sum, r) => sum + deltaAt(r, Math.max(0, currentMonth - 3)),
    0,
  );
  const ytdDelta = jobsYtd > 0 ? (jobsYtd - jobsYtdPrior) / jobsYtd : 0;
  const sparkline = useMemo(() => {
    if (!runs.length) return undefined;
    const pts: number[] = [];
    for (let m = 0; m <= currentMonth; m++)
      pts.push(runs.reduce((s, r) => s + deltaAt(r, m), 0));
    return pts.length > 1 ? pts : undefined;
  }, [runs, currentMonth]);
  const onPace = trackerRuns.filter(
    (t) => finalDelta(t.result) >= JOBS_TARGET / Math.max(1, trackerRuns.length),
  ).length;
  const laborConfidence = profile?.scores?.labor?.confidence;

  // Youth unemployment from profile metrics (education sector series).
  const unemployment = useMemo(() => {
    const rows = (profile?.metrics ?? [])
      .filter((m) => m.metricKey === "unemployment")
      .sort((a, b) => a.period.localeCompare(b.period));
    const edu = rows.filter((m) => m.sectorCode === "edu");
    const series = edu.length ? edu : rows;
    const latest = series[series.length - 1];
    const prior = series[series.length - 2];
    return { latest, prior };
  }, [profile]);

  // Approvals
  const awaiting = briefRows.filter(
    (b) => b.reviewState === "in_review" || b.reviewState === "approved",
  );
  const approvalItems: ApprovalItem[] = awaiting.map((b) => {
    const content = b.content as
      | { sections?: { heading?: string; body?: string }[] }
      | null
      | undefined;
    const firstBody = content?.sections?.[0]?.body;
    return {
      briefId: b.briefId,
      title: b.title,
      reviewState: b.reviewState,
      updatedAt: b.updatedAt,
      summary: firstBody
        ? firstBody.length > 140
          ? `${firstBody.slice(0, 140)}…`
          : firstBody
        : undefined,
    };
  });

  // Activity feed
  const activityItems: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = [];
    for (const b of briefRows.slice(0, 6)) {
      items.push({
        id: `brief:${b.briefId}`,
        ts: b.updatedAt,
        category: "approvals",
        actor: "BRF",
        text: `Brief “${b.title}” — ${approvalStateLabel(b.reviewState).replace(/-/g, " ")}`,
      });
    }
    for (const r of scenarioRunRows) {
      if (!r) continue;
      items.push({
        id: `run:${r.simulationRunId}`,
        ts: r.finishedAt ?? r.createdAt,
        category: "runs",
        actor: "SIM",
        text: `Simulation run ${r.simulationRunId} ${r.status} (engine ${String(r.engine).replace(/_/g, " ")}${r.seed != null ? `, seed ${r.seed}` : ""})`,
      });
    }
    for (const j of jobRows.slice(0, 4)) {
      items.push({
        id: `job:${j.job_id}`,
        ts: j.finished_at ?? j.created_at,
        category: "runs",
        actor: "JOB",
        text: `Job ${j.type} — ${j.status}${j.progress != null ? ` (${j.progress}%)` : ""}`,
      });
    }
    for (const s of (profile?.data_sources ?? []).slice(0, 4)) {
      if (!s.lastRefresh) continue;
      items.push({
        id: `src:${s.sourceId}`,
        ts: s.lastRefresh,
        category: "data",
        actor: "SRC",
        text: `Dataset “${s.name}” refreshed`,
      });
    }
    return items.sort(
      (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
    );
  }, [briefRows, scenarioRunRows, jobRows, profile]);

  /* --------------------------- evidence drawer ------------------------- */
  const [drawer, setDrawer] = useState<{ open: boolean; title: string }>({
    open: false,
    title: "",
  });
  const openEvidence = (title: string) => setDrawer({ open: true, title });

  const evidenceSources: EvidenceSource[] = (profile?.evidence_sources ?? [])
    .slice(0, 6)
    .map((e) => ({
      id: e.evidenceSourceId,
      title:
        e.citation.length > 110 ? `${e.citation.slice(0, 110)}…` : e.citation,
      issuer: `${e.sourceType.toUpperCase()} evidence · ${e.evidenceSourceId}`,
      date: new Date(e.createdAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      relevance: e.confidence,
    }));
  const evidenceExcerpts = (profile?.evidence_sources ?? [])
    .filter((e) => e.contentExcerpt)
    .slice(0, 2)
    .map((e) => ({ sourceId: e.evidenceSourceId, text: e.contentExcerpt! }));

  const freshnessStatus: StatusKind =
    freshness?.status === "failing"
      ? "failing"
      : freshness?.status === "stale"
        ? "stale"
        : "healthy";

  /* -------------------------------- roles ------------------------------ */
  const platformRole = (user as { platformRole?: string | null } | null)
    ?.platformRole;
  const canApprove =
    isAuthenticated &&
    (user?.role === "admin" ||
      ["executive", "policy_analyst", "platform_admin"].includes(
        platformRole ?? "",
      ));
  const showAuditLink =
    user?.role === "admin" ||
    ["platform_admin", "data_steward"].includes(platformRole ?? "");

  const stale = freshnessStatus !== "healthy";

  /* -------------------------------- render ----------------------------- */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <p className="caption-label text-ink-muted">
            Kaduna State · Executive view
          </p>
          <h1 className="mt-1 text-[32px] font-semibold leading-10 tracking-[-0.02em] text-ink-primary">
            Executive Dashboard
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
            <StatusDot status={freshnessStatus} />
            <span>{freshness?.label ?? "Checking data freshness…"}</span>
            <span aria-hidden>·</span>
            <span>All figures evidence-traced</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            <ExportMenu
              key="export"
              requestId={profileMeta?.request_id}
            />,
            <button
              key="copilot"
              type="button"
              onClick={() =>
                navigate("/copilot", {
                  state: { from: "/dashboard", topic: "executive-dashboard" },
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:border-ink-strong hover:text-ink-primary"
            >
              <MessageSquareText aria-hidden className="h-4 w-4" />
              Ask Copilot about this page
            </button>,
            <button
              key="scenario"
              type="button"
              onClick={() => navigate("/simulation")}
              className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-sm font-medium text-ink-base transition-all duration-150 hover:bg-civic-strong active:scale-[0.98]"
            >
              <Plus aria-hidden className="h-4 w-4" />
              New scenario
            </button>,
          ].map((el, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.2 }}
            >
              {el}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Stale-data banner */}
      {stale && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-2.5 text-[13px] text-status-warning"
        >
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
          Figures older than 30 days — see{" "}
          <Link
            to="/data-health"
            className="font-medium underline underline-offset-2 hover:text-ink-primary"
          >
            Data Source Health
          </Link>
          . Last values are shown below with a stale flag.
        </div>
      )}

      {/* Section 1 — Executive KPI row */}
      {/* INNOVATIONS-PROVENANCE: jurisdiction provenance chip on the KPI row header */}
      {(profile as { provenance?: import("@/lib/innovations-client").ProvenanceInfo } | null)?.provenance && (
        <div className="flex items-center justify-end gap-2">
          <span className="caption-label text-ink-muted">Jurisdiction data</span>
          <ProvenanceChipFromInfo
            provenance={(profile as { provenance?: import("@/lib/innovations-client").ProvenanceInfo }).provenance}
          />
        </div>
      )}
      {profileQ.isLoading || runsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : profileQ.isError ? (
        <QueryError
          label="Executive KPIs"
          onRetry={() => profileQ.refetch()}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <motion.div {...itemAnim(0)}>
            <ExecutiveStatCard
              label="Jobs supported YTD"
              value={jobsYtd}
              delta={ytdDelta}
              deltaLabel="vs prior quarter"
              sparkline={sparkline}
              confidence={laborConfidence}
              evidenceCount={evidenceSources.length}
              onOpenEvidence={() => openEvidence("Jobs supported YTD")}
            />
          </motion.div>
          <motion.div {...itemAnim(1)}>
            <TrajectoryRingCard
              jobsSupported={jobsYtd}
              target={JOBS_TARGET}
              onPace={onPace}
              scenarioCount={trackerRuns.length}
              confidence={laborConfidence}
              onOpenEvidence={() => openEvidence("2027 target trajectory")}
            />
          </motion.div>
          <motion.div {...itemAnim(2)}>
            <UnemploymentCard
              value={unemployment.latest?.value ?? 0}
              deltaPts={
                unemployment.latest && unemployment.prior
                  ? (unemployment.latest.value - unemployment.prior.value) * 100
                  : 0
              }
              confidence={unemployment.latest?.confidence}
              evidenceCount={evidenceSources.length}
              caption="NBS LFS proxy · sector metrics"
              onOpenEvidence={() => openEvidence("Youth unemployment (15–34)")}
            />
          </motion.div>
          <motion.div {...itemAnim(3)}>
            <ApprovalsKpiCard
              count={awaiting.length}
              breakdown={[
                `${awaiting.filter((b) => b.reviewState === "approved").length} awaiting sign-off`,
                `${awaiting.filter((b) => b.reviewState === "in_review").length} in review`,
              ]}
              onOpenQueue={() =>
                document
                  .getElementById("approvals")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
          </motion.div>
        </div>
      )}
      {stale && (
        <p className="-mt-3 flex items-center gap-1.5 text-[11px] text-status-warning">
          <AlertTriangle aria-hidden className="h-3 w-3" />
          Stale — KPI cards show the last known values.
        </p>
      )}

      {/* Section 2 — Job target tracker + Top risks */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {runsLoading ? (
            <SkeletonTable rows={6} columns={3} />
          ) : scenariosQ.isError ? (
            <QueryError
              label="Scenario projections"
              onRetry={() => scenariosQ.refetch()}
            />
          ) : (
            <JobTargetTracker runs={trackerRuns} currentMonth={currentMonth} />
          )}
        </div>
        <div className="lg:col-span-5">
          <TopRisks
            onOpenEvidence={(risk: RiskItem) => openEvidence(risk.title)}
          />
        </div>
      </div>

      {/* Section 3 — Sector highlights */}
      {sectorsQ.isLoading || metricsQ.isLoading || oppsQ.isLoading ? (
        <SkeletonCard metric={false} lines={3} />
      ) : sectorsQ.isError || metricsQ.isError || oppsQ.isError ? (
        <QueryError
          label="Sector highlights"
          onRetry={() => {
            sectorsQ.refetch();
            metricsQ.refetch();
            oppsQ.refetch();
          }}
        />
      ) : (
        <SectorHighlights
          sectors={sectors}
          metrics={metrics}
          opportunities={opportunities}
        />
      )}

      {/* Section 4 — Scenario summaries */}
      {runsLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} className="w-[300px] shrink-0" />
          ))}
        </div>
      ) : (
        <ScenarioStrip scenarios={scenarioCards} />
      )}

      {/* Section 5 — Recent activity + Approvals */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {briefsQ.isLoading ? (
            <SkeletonTable rows={8} columns={2} />
          ) : (
            <ActivityFeed items={activityItems} showAuditLink={showAuditLink} />
          )}
        </div>
        <div className="lg:col-span-5">
          {briefsQ.isLoading ? (
            <SkeletonCard lines={3} />
          ) : (
            <ApprovalsColumn
              items={approvalItems}
              total={awaiting.length}
              canAct={canApprove}
              disabledReason="Sign in with an executive or policy-analyst role to act on approvals."
              approverName={user?.name ?? "Executive"}
            />
          )}
        </div>
      </div>

      {/* Evidence drawer (shared across all metric / risk / opportunity links) */}
      <EvidenceDrawer
        open={drawer.open}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        title={drawer.title}
        sources={evidenceSources}
        excerpts={evidenceExcerpts}
        freshness={{ status: freshnessStatus, label: freshness?.label ?? "—" }}
        requestId={profileMeta?.request_id}
      />

      {/* Print footer (design.md §6) */}
      <footer className="hidden text-xs text-neutral-600 print:block">
        Generated {new Date().toLocaleString("en-GB")} · Request ID{" "}
        {profileMeta?.request_id ?? "—"} · Approval state: executive view
      </footer>
    </div>
  );
}
