import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  Copy,
  ListChecks,
  Plus,
  ScrollText,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { nanoid } from "nanoid";

import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { envelopeMeta, unwrap } from "@/lib/trpc-data";
import { useT } from "@/lib/LocaleContext";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import { SkeletonCard, SkeletonTable } from "@/components/shared/Skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import OverviewStrip from "@/components/data-health/OverviewStrip";
import PipelineBoard, {
  buildPipelineRows,
  type PipelineRow,
} from "@/components/data-health/PipelineBoard";
import ReviewQueue from "@/components/data-health/ReviewQueue";
import SourceRegistry from "@/components/data-health/SourceRegistry";
import FreshnessHeatmap from "@/components/data-health/FreshnessHeatmap";
import {
  ageDays,
  parseCompliance,
  relativeTime,
  slaStatus,
  type DataSourceRow,
  type PipelineRunRow,
  type ReviewTaskRow,
} from "@/components/data-health/health-utils";
import { formatDateTime } from "@/components/briefs/brief-utils";

type Range = "24h" | "7d" | "30d";
const RANGE_DAYS: Record<Range, number> = { "24h": 1, "7d": 7, "30d": 30 };

export default function DataHealth() {
  const t = useT();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const role = user
    ? user.role === "admin"
      ? "executive"
      : ((user as { platformRole?: string }).platformRole ?? "policy_analyst")
    : "policy_analyst";
  const canSteward = isAuthenticated && ["data_steward", "platform_admin"].includes(role);

  const utils = trpc.useUtils();
  const [range, setRange] = useState<Range>("30d");
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [reRunRow, setReRunRow] = useState<PipelineRow | null>(null);
  const [triageRow, setTriageRow] = useState<PipelineRow | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [triagingId, setTriagingId] = useState<string | null>(null);
  const [signingOffId, setSigningOffId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [auditOpen, setAuditOpen] = useState(false);
  const idempotencyKey = useRef(`rerun-${nanoid(16)}`);

  /* ------------------------------ queries ------------------------------ */
  const stewardEnabled = isAuthenticated;
  const sourcesQ = trpc.admin.dataSources.useQuery({}, { enabled: stewardEnabled, retry: false });
  const runsQ = trpc.admin.pipelineRuns.useQuery({ limit: 100 }, { enabled: stewardEnabled, retry: false });
  const tasksQ = trpc.admin.reviewTasks.useQuery({ limit: 100 }, { enabled: stewardEnabled, retry: false });
  const complianceQ = trpc.admin.contractsCompliance.useQuery(undefined, {
    enabled: stewardEnabled,
    retry: false,
  });
  const freshnessQ = trpc.ops.freshnessSummary.useQuery();
  const auditQ = trpc.ops.auditLog.useQuery(
    { entity_type: "data_source", limit: 8 },
    { enabled: stewardEnabled && auditOpen && canSteward, retry: false },
  );
  const sourceRunsQ = trpc.admin.pipelineRuns.useQuery(
    { source_id: runsFor ?? "", limit: 20 },
    { enabled: stewardEnabled && runsFor !== null, retry: false },
  );

  const sources = useMemo(
    () => (unwrap(sourcesQ.data) as DataSourceRow[] | undefined) ?? [],
    [sourcesQ.data],
  );
  const runs = useMemo(
    () => (unwrap(runsQ.data) as PipelineRunRow[] | undefined) ?? [],
    [runsQ.data],
  );
  const tasks = useMemo(
    () => (unwrap(tasksQ.data) as ReviewTaskRow[] | undefined) ?? [],
    [tasksQ.data],
  );
  const freshness = unwrap(freshnessQ.data) as
    | { asOf: Date | null; status: string; sources: number; label: string }
    | undefined;
  const complianceMeta = envelopeMeta(complianceQ.data);

  const forbidden =
    !isAuthenticated ||
    [sourcesQ, runsQ, tasksQ].some((q) =>
      q.error?.data?.code === "FORBIDDEN" || q.error?.data?.code === "UNAUTHORIZED",
    );

  /* ----------------------------- mutations ------------------------------ */
  const triageM = trpc.admin.triageReviewTask.useMutation({
    onSuccess: async (_p, vars) => {
      toast.success(`Review task ${vars.status.replace(/_/g, " ")}`, {
        description: "Triage recorded with actor id — audit event written.",
      });
      setTriagingId(null);
      await utils.admin.reviewTasks.invalidate();
    },
    onError: (err) => {
      toast.error(t.common.errorGeneric, { description: err.message });
      setTriagingId(null);
    },
  });

  const updateSourceM = trpc.admin.updateDataSource.useMutation({
    onSuccess: async (_p, vars) => {
      if (vars.contract_compliance) {
        toast.success("Contract change approved", {
          description: "Drift sign-off recorded with actor + timestamp (audit).",
        });
      } else {
        toast.success("Source updated", { description: "Audit event recorded." });
      }
      setSigningOffId(null);
      await Promise.all([
        utils.admin.dataSources.invalidate(),
        utils.admin.contractsCompliance.invalidate(),
      ]);
    },
    onError: (err) => {
      toast.error(t.common.errorGeneric, { description: err.message });
      setSigningOffId(null);
    },
  });

  /* ------------------------------ derived ------------------------------- */
  const healthy = sources.filter((s) => s.health === "healthy").length;
  const stale = sources.filter((s) => s.health === "stale").length;
  const failing = sources.filter((s) => s.health === "failing").length;

  const breaches = useMemo(
    () =>
      sources.filter(
        (s) =>
          slaStatus(s.freshnessDays, s.refreshCadence) === "breached" &&
          !acknowledged.has(s.sourceId),
      ),
    [sources, acknowledged],
  );

  const rangeRuns = useMemo(() => {
    const cutoff = Date.now() - RANGE_DAYS[range] * 86400000;
    return runs.filter((r) => {
      const t = r.startedAt ? new Date(r.startedAt).getTime() : new Date(r.createdAt).getTime();
      return Number.isNaN(t) ? true : t >= cutoff;
    });
  }, [runs, range]);

  const boardRows = useMemo(() => buildPipelineRows(sources, rangeRuns), [sources, rangeRuns]);

  const acknowledgeBreach = (s: DataSourceRow) => {
    if (!canSteward) return;
    const compliance = parseCompliance(s.contractCompliance) ?? {};
    updateSourceM.mutate({
      source_id: s.sourceId,
      contract_compliance: {
        schema_ok: compliance.schema_ok ?? true,
        sla_ok: compliance.sla_ok ?? false,
        license_ok: compliance.license_ok ?? true,
        notes: `Freshness SLA breach acknowledged by ${role} (user #${user?.id ?? "?"}) at ${formatDateTime(new Date())}.`,
      },
    });
    setAcknowledged((prev) => new Set(prev).add(s.sourceId));
  };

  const signOffDrift = (source: DataSourceRow, comment: string) => {
    setSigningOffId(source.sourceId);
    updateSourceM.mutate({
      source_id: source.sourceId,
      contract_compliance: {
        schema_ok: true,
        sla_ok: true,
        license_ok: true,
        notes: `Contract drift accepted by ${role}: ${comment || "no comment"}`,
      },
    });
  };

  const onTriage = (task: ReviewTaskRow, status: "in_progress" | "resolved" | "dismissed") => {
    setTriagingId(task.taskId);
    triageM.mutate({ task_id: task.taskId, status });
  };

  const openContext = (task: ReviewTaskRow) => {
    if (task.type === "ocr_low_confidence" || task.type === "legal_extract") {
      navigate("/legislation");
    } else {
      document.getElementById("source-registry")?.scrollIntoView({ behavior: "smooth" });
      toast.info(t.dataHealth.issueLocated);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t.dataHealth.copiedToClipboard.replace("{label}", label));
    } catch {
      toast.error(t.dataHealth.clipboardUnavailable, { description: text });
    }
  };

  /* --------------------------- print attrs ------------------------------ */
  useEffect(() => {
    const body = document.body;
    body.dataset.generatedAt = formatDateTime(new Date());
    body.dataset.requestId = complianceMeta?.request_id ?? "—";
    body.dataset.approvalState = "operational";
    return () => {
      delete body.dataset.generatedAt;
      delete body.dataset.requestId;
      delete body.dataset.approvalState;
    };
  }, [complianceMeta]);

  const isLoading = stewardEnabled && sourcesQ.isLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto w-full max-w-[1600px]"
    >
      <Toaster theme="dark" position="bottom-right" />

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3" data-print-hidden>
        <div>
          <p className="caption-label text-ink-muted">{t.dataHealth.caption}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
            {t.dataHealth.title}
          </h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {isLoading
              ? t.dataHealth.loading
              : t.dataHealth.summary
                  .replace("{total}", String(sources.length))
                  .replace("{healthy}", String(healthy))
                  .replace("{stale}", String(stale))
                  .replace("{failing}", String(failing))}
            {freshness?.label && (
              <span className="ml-2 text-ink-muted">· {freshness.label}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={t.dataHealth.timeRange}
            className="flex rounded-md border border-ink-subtle bg-ink-surface p-0.5"
          >
            {(["24h", "7d", "30d"] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  range === r ? "bg-civic/15 text-civic" : "text-ink-secondary hover:text-ink-primary",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              document.getElementById("pipeline-board")?.scrollIntoView({ behavior: "smooth" })
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-sm font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
          >
            <ScrollText aria-hidden className="h-4 w-4" />
            {t.dataHealth.pipelineRuns}
          </button>
          <span title={canSteward ? undefined : t.dataHealth.stewardRoleRequired}>
            <button
              type="button"
              disabled={!canSteward}
              onClick={() => setRegisterOpen(true)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-transform",
                canSteward
                  ? "bg-civic text-ink-base hover:bg-civic-strong active:scale-[0.98]"
                  : "cursor-not-allowed bg-ink-elevated text-ink-muted",
              )}
            >
              <Plus aria-hidden className="h-4 w-4" />
              {t.dataHealth.registerSource}
            </button>
          </span>
        </div>
      </div>

      {/* SLA breach banner */}
      <AnimatePresence>
        {breaches.length > 0 && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px]"
            data-print-hidden
          >
            <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-status-danger" />
            <span className="font-medium text-status-danger">
              {t.dataHealth.breachBanner.replace("{count}", String(breaches.length))}
            </span>
            <span className="text-ink-secondary">
              —{" "}
              {breaches
                .map((b) => `${b.name} (${Math.max(1, ageDays(b.lastRefresh))}d overdue)`)
                .join(", ")}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  document.getElementById("source-registry")?.scrollIntoView({ behavior: "smooth" })
                }
                className="rounded border border-status-danger/40 px-2 py-0.5 text-xs text-status-danger hover:bg-status-danger/10"
              >
                {t.dataHealth.view}
              </button>
              {canSteward && (
                <button
                  type="button"
                  onClick={() => breaches.forEach(acknowledgeBreach)}
                  className="rounded bg-status-danger/20 px-2 py-0.5 text-xs font-medium text-status-danger hover:bg-status-danger/30"
                >
                  {t.dataHealth.acknowledge}
                </button>
              )}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body */}
      {!isAuthenticated || forbidden ? (
        <div className="mt-5">
          <EmptyState
            title={t.dataHealth.accessTitle}
            guidance={
              isAuthenticated
                ? t.dataHealth.accessGuidanceRole
                : t.dataHealth.accessGuidanceSignIn
            }
          />
        </div>
      ) : isLoading ? (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <SkeletonTable rows={8} columns={6} />
        </div>
      ) : sourcesQ.isError ? (
        <div className="mt-5">
          <EmptyState
            title={t.dataHealth.errorSources}
            guidance={sourcesQ.error.message}
            action={{ label: t.action.retry, onClick: () => void sourcesQ.refetch() }}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <OverviewStrip sources={sources} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-7">
              {runsQ.isLoading ? (
                <SkeletonTable rows={8} columns={6} />
              ) : (
                <PipelineBoard
                  rows={boardRows}
                  onViewRuns={(id) => setRunsFor(id)}
                  onReRun={(row) => {
                    idempotencyKey.current = `rerun-${nanoid(16)}`;
                    setReRunRow(row);
                  }}
                  onCreateTriage={(row) => setTriageRow(row)}
                />
              )}
            </div>
            <div className="xl:col-span-5">
              {tasksQ.isLoading ? (
                <SkeletonTable rows={5} columns={3} />
              ) : (
                <ReviewQueue
                  tasks={tasks}
                  onTriage={onTriage}
                  triagingId={triagingId}
                  onOpenContext={openContext}
                />
              )}
            </div>
          </div>

          <div id="source-registry">
            <SourceRegistry
              sources={sources}
              onSignOffDrift={signOffDrift}
              signingOffId={signingOffId}
              canSignOff={canSteward}
            />
          </div>

          <FreshnessHeatmap sources={sources} days={30} />

          {/* Recent audit events (collapsible, steward/admin) */}
          {canSteward && (
            <section
              aria-label="Recent data-source audit events"
              className="rounded-md border border-ink-subtle bg-ink-surface"
              data-print-hidden
            >
              <button
                type="button"
                onClick={() => setAuditOpen((o) => !o)}
                aria-expanded={auditOpen}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <span className="caption-label inline-flex items-center gap-1.5 text-ink-muted">
                  <ListChecks aria-hidden className="h-3.5 w-3.5" />
                  {t.dataHealth.auditEvents}
                </span>
                <span className="text-xs text-ink-secondary">{auditOpen ? t.dataHealth.hide : t.dataHealth.show}</span>
              </button>
              <AnimatePresence initial={false}>
                {auditOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-ink-subtle px-3 py-2">
                      {auditQ.isLoading ? (
                        <SkeletonTable rows={4} columns={3} />
                      ) : auditQ.isError ? (
                        <p className="py-2 text-xs text-ink-muted">
                          {t.dataHealth.auditUnavailable.replace("{message}", auditQ.error.message)}
                        </p>
                      ) : (
                        <AuditList payload={auditQ.data} />
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}
        </div>
      )}

      {/* Runs drawer */}
      <AnimatePresence>
        {runsFor !== null && (
          <>
            <motion.div
              key="runs-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.6)]"
              onClick={() => setRunsFor(null)}
              aria-hidden
            />
            <motion.aside
              key="runs-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={t.dataHealth.pipelineRuns}
              initial={{ x: 480 }}
              animate={{ x: 0 }}
              exit={{ x: 480 }}
              transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-ink-subtle bg-ink-elevated shadow-overlay"
            >
              <div className="flex items-center justify-between border-b border-ink-subtle px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink-primary">{t.dataHealth.pipelineRuns}</h2>
                  <p className="font-mono text-[11px] text-ink-muted">{runsFor}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRunsFor(null)}
                  aria-label={t.dataHealth.closeRunHistory}
                  className="rounded p-1 text-ink-muted hover:text-ink-primary"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {sourceRunsQ.isLoading ? (
                  <SkeletonTable rows={6} columns={3} />
                ) : (
                  <ul className="space-y-2">
                    {((unwrap(sourceRunsQ.data) as PipelineRunRow[] | undefined) ?? []).map((r) => (
                      <li
                        key={r.pipelineId}
                        className="rounded-md border border-ink-subtle bg-ink-surface p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              "font-medium",
                              r.status === "succeeded"
                                ? "text-status-success"
                                : r.status === "failed"
                                  ? "text-status-danger"
                                  : "text-status-info",
                            )}
                          >
                            {r.status}
                          </span>
                          <span className="font-mono text-[10px] text-ink-muted">
                            {relativeTime(r.startedAt ?? r.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-ink-muted">
                          {r.pipelineId} · {r.rowsProcessed.toLocaleString()} {t.dataHealth.rows}
                        </p>
                        {r.error && (
                          <pre className="mt-1.5 overflow-x-auto rounded border border-status-danger/30 bg-ink-inset p-1.5 font-mono text-[10px] text-status-danger">
                            {r.error}
                          </pre>
                        )}
                      </li>
                    ))}
                    {((unwrap(sourceRunsQ.data) as PipelineRunRow[] | undefined) ?? []).length ===
                      0 && (
                      <li className="rounded-md border border-dashed border-ink-subtle p-6 text-center text-xs text-ink-muted">
                        {t.dataHealth.noRuns}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Re-run confirm modal */}
      <Dialog open={reRunRow !== null} onOpenChange={(o) => !o && setReRunRow(null)}>
        <DialogContent className="border-ink-subtle bg-ink-elevated text-ink-primary">
          <DialogHeader>
            <DialogTitle>{t.dataHealth.rerunTitle}</DialogTitle>
            <DialogDescription className="text-ink-secondary">
              {t.dataHealth.rerunDesc.replace("{name}", reRunRow?.source.name ?? "")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-[13px] text-ink-secondary">
            <p>
              {t.dataHealth.idempotencyKey}{" "}
              <span className="font-mono text-xs text-civic">{idempotencyKey.current}</span>
            </p>
            <p className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
              {t.dataHealth.rerunNote}
            </p>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setReRunRow(null)}
              className="rounded-md border border-ink-subtle px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary"
            >
              {t.action.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                void copyToClipboard(
                  JSON.stringify(
                    {
                      action: "pipeline.rerun",
                      source_id: reRunRow?.source.sourceId,
                      idempotency_key: idempotencyKey.current,
                      requested_by: user?.id ?? null,
                      requested_at: new Date().toISOString(),
                    },
                    null,
                    2,
                  ),
                  t.dataHealth.rerunTitle,
                );
                setReRunRow(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-sm font-medium text-ink-base hover:bg-civic-strong"
            >
              <Copy aria-hidden className="h-4 w-4" />
              {t.dataHealth.copyRerun}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create triage task modal */}
      <Dialog open={triageRow !== null} onOpenChange={(o) => !o && setTriageRow(null)}>
        <DialogContent className="border-ink-subtle bg-ink-elevated text-ink-primary">
          <DialogHeader>
            <DialogTitle>{t.dataHealth.triageTitle}</DialogTitle>
            <DialogDescription className="text-ink-secondary">
              {t.dataHealth.triageDesc.replace("{name}", triageRow?.source.name ?? "")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-[13px] text-ink-secondary">
            <p className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
              {t.dataHealth.triageNote}
            </p>
            {triageRow?.latestRun?.error && (
              <pre className="overflow-x-auto rounded-md border border-status-danger/30 bg-ink-inset p-2 font-mono text-xs text-status-danger">
                {triageRow.latestRun.error}
              </pre>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setTriageRow(null)}
              className="rounded-md border border-ink-subtle px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary"
            >
              {t.action.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                void copyToClipboard(
                  JSON.stringify(
                    {
                      action: "review_task.create",
                      type: "data_quality",
                      entity_ref: triageRow?.source.sourceId,
                      assignee_role: "data_steward",
                      error: triageRow?.latestRun?.error ?? null,
                      requested_by: user?.id ?? null,
                    },
                    null,
                    2,
                  ),
                  t.dataHealth.triageTitle,
                );
                setTriageRow(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-sm font-medium text-ink-base hover:bg-civic-strong"
            >
              <Copy aria-hidden className="h-4 w-4" />
              {t.dataHealth.copyTask}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Register source dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="border-ink-subtle bg-ink-elevated text-ink-primary">
          <DialogHeader>
            <DialogTitle>{t.dataHealth.registerTitle}</DialogTitle>
            <DialogDescription className="text-ink-secondary">
              {t.dataHealth.registerDesc}
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-ink-secondary">
            <li>{t.dataHealth.registerStep1}</li>
            <li>{t.dataHealth.registerStep2}</li>
            <li>{t.dataHealth.registerStep3}</li>
            <li>{t.dataHealth.registerStep4}</li>
          </ol>
          <p className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
            {t.dataHealth.registerNote}
          </p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRegisterOpen(false)}
              className="rounded-md border border-ink-subtle px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary"
            >
              {t.action.close}
            </button>
            <button
              type="button"
              onClick={() => {
                void copyToClipboard(
                  JSON.stringify(
                    {
                      action: "data_source.register",
                      jurisdiction_id: "jur:ng-kd",
                      requested_by: user?.id ?? null,
                      requested_at: new Date().toISOString(),
                      contract: { schema: "TBD", delivery_sla: "daily 02:00", licence: "TBD" },
                    },
                    null,
                    2,
                  ),
                  t.dataHealth.registerTitle,
                );
                setRegisterOpen(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-sm font-medium text-ink-base hover:bg-civic-strong"
            >
              <Copy aria-hidden className="h-4 w-4" />
              {t.dataHealth.copyRegistration}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function AuditList({ payload }: { payload: unknown }) {
  const t = useT();
  const rows = (unwrap(payload) as
    | { items?: { eventId: number; action: string; entityId: string; actorId: number | null; createdAt: Date | string }[] }
    | { eventId: number; action: string; entityId: string; actorId: number | null; createdAt: Date | string }[]
    | undefined) as
    | { items?: { eventId: number; action: string; entityId: string; actorId: number | null; createdAt: Date | string }[] }
    | { eventId: number; action: string; entityId: string; actorId: number | null; createdAt: Date | string }[]
    | undefined;
  const items = Array.isArray(rows) ? rows : (rows?.items ?? []);
  if (items.length === 0) {
    return <p className="py-2 text-xs text-ink-muted">{t.dataHealth.noAuditEvents}</p>;
  }
  return (
    <ul className="divide-y divide-ink-subtle/60">
      {items.map((e) => (
        <li key={e.eventId} className="flex flex-wrap items-center gap-x-3 py-1.5 text-xs">
          <span className="font-mono text-[10px] text-ink-muted">{formatDateTime(e.createdAt)}</span>
          <span className="font-medium text-ink-primary">{e.action}</span>
          <span className="font-mono text-[10px] text-ink-secondary">{e.entityId}</span>
          <span className="text-ink-muted">actor #{e.actorId ?? t.dataHealth.actorSystem}</span>
        </li>
      ))}
    </ul>
  );
}
