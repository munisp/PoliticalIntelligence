import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Library, Plus } from "lucide-react";
import { toast, Toaster } from "sonner";
import { nanoid } from "nanoid";

import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/use-pwa";
import { approvalStateLabel, envelopeMeta, unwrap } from "@/lib/trpc-data";
import { useT } from "@/lib/LocaleContext";
import EmptyState from "@/components/shared/EmptyState";
import { SkeletonCard, SkeletonTable } from "@/components/shared/Skeleton";
import type { ExportKind } from "@/components/shared/ExportMenu";

import BriefListRail, { type StatusFilter } from "@/components/briefs/BriefListRail";
import BriefComposer, { type ComposerOutput } from "@/components/briefs/BriefComposer";
import BriefPreview from "@/components/briefs/BriefPreview";
import SlideStrip from "@/components/briefs/SlideStrip";
import {
  formatDate,
  formatDateTime,
  parseModelRouting,
  templateById,
  type BriefRow,
} from "@/components/briefs/brief-utils";

const JURISDICTION_ID = "jur:ng-kd";

const EXPORT_FORMAT: Record<ExportKind, "memo_docx" | "brief_pdf" | "presentation_pptx" | "print"> = {
  docx: "memo_docx",
  pdf: "brief_pdf",
  pptx: "presentation_pptx",
  print: "print",
};
const FORMAT_TO_KIND: Record<string, ExportKind> = {
  memo_docx: "docx",
  brief_pdf: "pdf",
  presentation_pptx: "pptx",
  print: "print",
};

interface JobWatch {
  jobId: string;
  briefId: string;
  title: string;
}

export default function Briefs() {
  const t = useT();
  const { user, isAuthenticated } = useAuth();
  const isOnline = useOnlineStatus();
  const role = user
    ? user.role === "admin"
      ? "executive"
      : ((user as { platformRole?: string }).platformRole ?? "policy_analyst")
    : "policy_analyst";
  const canGenerate = isAuthenticated && ["policy_analyst", "platform_admin"].includes(role);

  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [view, setView] = useState<"document" | "slides">("document");
  const [job, setJob] = useState<JobWatch | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "approve" | "return" | "signoff" | "resolve" | null
  >(null);
  const [lastExported, setLastExported] = useState<Partial<Record<ExportKind, string>>>({});
  const [exportingPptx, setExportingPptx] = useState(false);
  const handledJobs = useRef<Set<string>>(new Set());

  /* ------------------------------ queries ------------------------------ */
  const listQ = trpc.briefs.list.useQuery({ limit: 50 });
  const listMeta = envelopeMeta(listQ.data);
  const briefs = useMemo(() => {
    const data = unwrap(listQ.data) as { items?: BriefRow[] } | undefined;
    return data?.items ?? [];
  }, [listQ.data]);

  const getQ = trpc.briefs.get.useQuery(
    { brief_id: selectedId ?? "" },
    { enabled: selectedId !== null },
  );
  const getMeta = envelopeMeta(getQ.data);
  const brief = useMemo(
    () => (selectedId ? (unwrap(getQ.data) as BriefRow | undefined) : undefined),
    [getQ.data, selectedId],
  );

  const jobsQ = trpc.ops.jobsList.useQuery(
    { limit: 20 },
    { enabled: job !== null && isAuthenticated, refetchInterval: job ? 2000 : false },
  );
  const watchedJob = useMemo(() => {
    if (!job) return null;
    const rows = (unwrap(jobsQ.data) as { job_id: string; status: string; progress: number; error: string | null }[] | undefined) ?? [];
    return rows.find((r) => r.job_id === job.jobId) ?? null;
  }, [jobsQ.data, job]);

  /* --------------------------- mutations ------------------------------- */
  const invalidateBriefs = async () => {
    await Promise.all([
      utils.briefs.list.invalidate(),
      selectedId ? utils.briefs.get.invalidate({ brief_id: selectedId }) : Promise.resolve(),
    ]);
  };

  const generateM = trpc.briefs.generate.useMutation({
    onSuccess: (payload, vars) => {
      const data = unwrap(payload) as { brief_id: string; job_id: string };
      setJob({ jobId: data.job_id, briefId: data.brief_id, title: vars.title });
      toast.info(t.briefs.toastQueued, { description: t.briefs.toastQueuedDesc });
    },
    onError: (err) => {
      toast.error(t.briefs.toastGenStartError, { description: err.message });
      setJob(null);
    },
  });

  const approveM = trpc.briefs.approve.useMutation({
    onSuccess: async () => {
      toast.success(t.briefs.toastApproved);
      setPendingAction(null);
      await invalidateBriefs();
    },
    onError: (err) => {
      toast.error(t.briefs.toastApprovalFailed, { description: err.message });
      setPendingAction(null);
    },
  });
  const returnM = trpc.briefs.return.useMutation({
    onSuccess: async () => {
      toast.success(t.briefs.toastReturned);
      setPendingAction(null);
      await invalidateBriefs();
    },
    onError: (err) => {
      toast.error(t.briefs.toastReturnFailed, { description: err.message });
      setPendingAction(null);
    },
  });
  const signOffM = trpc.briefs.signOff.useMutation({
    onSuccess: async () => {
      toast.success(t.briefs.toastSignedOff);
      setPendingAction(null);
      await invalidateBriefs();
    },
    onError: (err) => {
      toast.error(t.briefs.toastSignoffFailed, { description: err.message });
      setPendingAction(null);
    },
  });

  const exportM = trpc.briefs.exportMeta.useMutation({
    onSuccess: (payload) => {
      const data = unwrap(payload) as {
        last_exports: { format: string; exported_at: Date | string }[];
      };
      const map: Partial<Record<ExportKind, string>> = {};
      for (const e of data.last_exports ?? []) {
        const kind = FORMAT_TO_KIND[e.format];
        if (kind && !map[kind]) map[kind] = formatDate(e.exported_at);
      }
      setLastExported(map);
      setExportingPptx(false);
    },
    onError: (err) => {
      toast.error(t.briefs.toastExportError, { description: err.message });
      setExportingPptx(false);
    },
  });

  // G5: rendered export (server-rendered HTML / Word .doc) → download.
  const exportRenderedM = trpc.briefs.exportRendered.useMutation({
    onSuccess: (payload) => {
      const data = unwrap(payload) as {
        filename: string;
        mime_type: string;
        content: string;
      };
      const blob = new Blob([data.content], { type: data.mime_type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export ready", { description: data.filename });
    },
    onError: (err) => {
      toast.error(t.briefs.toastExportError, { description: err.message });
    },
  });

  /* --------------------------- effects --------------------------------- */
  // Auto-select the first brief.
  useEffect(() => {
    if (selectedId === null && briefs.length > 0) setSelectedId(briefs[0].briefId);
  }, [briefs, selectedId]);

  // Load export history when the selection changes.
  useEffect(() => {
    if (selectedId && isAuthenticated) {
      exportM.mutate({ brief_id: selectedId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, isAuthenticated]);

  // Watch the async generation job.
  useEffect(() => {
    if (!job || !watchedJob || handledJobs.current.has(job.jobId)) return;
    if (watchedJob.status === "succeeded") {
      handledJobs.current.add(job.jobId);
      toast.success(t.briefs.toastGenerated, {
        description: t.briefs.toastGeneratedDesc.replace("{title}", job.title),
      });
      setJob(null);
      setComposing(false);
      setSelectedId(job.briefId);
      void utils.briefs.list.invalidate();
      void utils.briefs.get.invalidate({ brief_id: job.briefId });
    } else if (watchedJob.status === "failed" || watchedJob.status === "canceled") {
      handledJobs.current.add(job.jobId);
      toast.error(t.briefs.toastGenFailed, {
        description: watchedJob.error ?? t.briefs.toastGenFailedDesc,
      });
      setJob(null);
    }
  }, [job, watchedJob, utils]);

  // Print footer data attributes (design.md §6 footer pattern).
  useEffect(() => {
    const body = document.body;
    if (brief) {
      body.dataset.generatedAt = formatDateTime(new Date());
      body.dataset.requestId = getMeta?.request_id ?? brief.requestId ?? "—";
      body.dataset.approvalState = approvalStateLabel(brief.reviewState);
    }
    return () => {
      delete body.dataset.generatedAt;
      delete body.dataset.requestId;
      delete body.dataset.approvalState;
    };
  }, [brief, getMeta]);

  // Keyboard: ⌘E export menu, ⌘P print, ⌘Enter approve/re-submit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        window.print();
      } else if (key === "e") {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("[data-export-menu-trigger] button")?.click();
      } else if (key === "enter") {
        if (!brief || pendingAction !== null) return;
        e.preventDefault();
        if (brief.reviewState === "in_review") handleApprove("");
        else if (brief.reviewState === "returned") handleResolve();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, pendingAction, role, isAuthenticated]);

  /* --------------------------- handlers -------------------------------- */
  const handleGenerate = (out: ComposerOutput) => {
    const template = templateById(out.templateId);
    generateM.mutate({
      jurisdiction_id: JURISDICTION_ID,
      template: template.apiTemplate,
      title: out.title,
      opportunity_ids: [],
      idempotency_key: `brf-${nanoid(16)}`,
    });
  };

  const handleApprove = (comment: string) => {
    if (!brief) return;
    setPendingAction("approve");
    approveM.mutate({ brief_id: brief.briefId, comment: comment || undefined });
  };
  const handleReturn = (comment: string) => {
    if (!brief) return;
    if (!comment.trim()) {
      toast.error(t.briefs.commentRequired);
      return;
    }
    setPendingAction("return");
    returnM.mutate({ brief_id: brief.briefId, comment: comment.trim() });
  };
  const handleSignOff = (comment: string) => {
    if (!brief) return;
    setPendingAction("signoff");
    signOffM.mutate({ brief_id: brief.briefId, comment: comment || undefined });
  };
  /** Returned briefs have no re-submit endpoint — generate a revised draft. */
  const handleResolve = () => {
    if (!brief) return;
    setPendingAction("resolve");
    generateM.mutate(
      {
        jurisdiction_id: brief.jurisdictionId || JURISDICTION_ID,
        template: (["executive_memo", "sector_brief", "scenario_summary"].includes(brief.template)
          ? brief.template
          : "executive_memo") as "executive_memo" | "sector_brief" | "scenario_summary",
        title: `${brief.title.replace(/ \(rev \d+\)$/, "")} (rev ${(brief.title.match(/\(rev (\d+)\)$/)?.[1] ? Number(brief.title.match(/\(rev (\d+)\)$/)![1]) + 1 : 2)})`,
        opportunity_ids: [],
        idempotency_key: `brf-${nanoid(16)}`,
      },
      {
        onSettled: () => setPendingAction(null),
      },
    );
  };

  const handleExport = (kind: ExportKind) => {
    if (!brief) return;
    if (!isAuthenticated) {
      toast.error(t.briefs.signInToExport);
      return;
    }
    exportM.mutate({ brief_id: brief.briefId, format: EXPORT_FORMAT[kind] });
    if (kind !== "print") {
      toast.success(t.briefs.exportRecorded.replace("{format}", EXPORT_FORMAT[kind]), {
        description: t.briefs.exportRecordedDesc,
      });
    }
  };

  const handleExportPptx = () => {
    if (!brief) return;
    setExportingPptx(true);
    exportM.mutate({ brief_id: brief.briefId, format: "presentation_pptx" });
  };

  /* ---------------------------- derived -------------------------------- */
  const awaiting = briefs.filter((b) => ["in_review", "approved"].includes(b.reviewState)).length;
  const offlineFallback =
    !isOnline || briefs.some((b) => parseModelRouting(b.modelRouting)?.fallback === true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto w-full max-w-[1600px]"
    >
      <Toaster theme="dark" position="bottom-right" />

      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3" data-print-hidden>
        <div>
          <p className="caption-label text-ink-muted">{t.briefs.caption}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
            {t.briefs.title}
          </h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {listQ.isLoading
              ? t.briefs.loading
              : t.briefs.countLine
                  .replace("{count}", String(briefs.length))
                  .replace("{awaiting}", String(awaiting))}
            {listMeta && (
              <span className="ml-2 font-mono text-[11px] text-ink-muted">
                req {listMeta.request_id}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.04 }}
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-sm font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
          >
            <Library aria-hidden className="h-4 w-4" />
            {t.briefs.templateLibrary}
          </motion.button>
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08 }}
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-sm font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98]"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {t.briefs.newBrief}
          </motion.button>
        </div>
      </div>

      {/* Body */}
      <div className="mt-5 flex flex-col gap-4 xl:flex-row">
        {/* Rail — dropdown selector on <xl */}
        <div className="xl:hidden" data-print-hidden>
          <label className="block">
            <span className="caption-label text-ink-muted">{t.briefs.selectBrief}</span>
            <select
              value={selectedId ?? ""}
              onChange={(e) => {
                setSelectedId(e.target.value || null);
                setComposing(false);
              }}
              className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-sm text-ink-primary focus:border-civic"
            >
              {briefs.map((b) => (
                <option key={b.briefId} value={b.briefId}>
                  {b.title} — {approvalStateLabel(b.reviewState)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="hidden w-[340px] shrink-0 xl:block" data-print-hidden>
          {listQ.isLoading ? (
            <SkeletonTable rows={6} columns={2} />
          ) : (
            <BriefListRail
              briefs={briefs}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setComposing(false);
              }}
              filter={filter}
              onFilterChange={setFilter}
            />
          )}
        </div>

        {/* Working area */}
        <div className="min-w-0 flex-1">
          {listQ.isLoading ? (
            <div className="space-y-4">
              <SkeletonCard lines={2} />
              <SkeletonCard metric={false} lines={6} />
            </div>
          ) : listQ.isError ? (
            <EmptyState
              title={t.briefs.errorList}
              guidance={listQ.error.message}
              action={{ label: t.action.retry, onClick: () => void listQ.refetch() }}
            />
          ) : briefs.length === 0 && !composing ? (
            <EmptyState
              title={t.briefs.emptyTitle}
              guidance={t.briefs.emptyGuidance}
              action={{ label: t.briefs.newBrief, onClick: () => setComposing(true) }}
            />
          ) : composing ? (
            <BriefComposer
              onGenerate={handleGenerate}
              generating={generateM.isPending || job !== null}
              progress={watchedJob?.progress ?? (job ? 5 : null)}
              canGenerate={canGenerate}
              disabledReason={
                isAuthenticated
                  ? t.briefs.generateRoleReason
                  : t.briefs.generateSignInReason
              }
              offlineFallback={offlineFallback}
            />
          ) : getQ.isLoading ? (
            <div className="space-y-4">
              <SkeletonCard lines={2} />
              <SkeletonCard metric={false} lines={8} />
            </div>
          ) : getQ.isError ? (
            <EmptyState
              title={t.briefs.errorGet}
              guidance={getQ.error.message}
              action={{ label: t.action.retry, onClick: () => void getQ.refetch() }}
            />
          ) : brief ? (
            view === "slides" ? (
              <>
                <div className="mb-4" data-print-hidden>
                  <BriefViewToggle view={view} onViewChange={setView} />
                </div>
                <SlideStrip key={brief.briefId} brief={brief} onExportPptx={handleExportPptx} exporting={exportingPptx} />
              </>
            ) : (
              <BriefPreview
                brief={brief}
                requestId={getMeta?.request_id ?? null}
                view={view}
                onViewChange={setView}
                role={role}
                isAuthenticated={isAuthenticated}
                onApprove={handleApprove}
                onReturn={handleReturn}
                onSignOff={handleSignOff}
                onResolve={handleResolve}
                pendingAction={pendingAction}
                lastExported={lastExported}
                onExport={handleExport}
                onExportRendered={(format) => {
                  if (isAuthenticated && brief) {
                    exportRenderedM.mutate({ brief_id: brief.briefId, format });
                  }
                }}
                exportRenderedPending={exportRenderedM.isPending}
              />
            )
          ) : (
            <EmptyState
              title={t.briefs.pickTitle}
              guidance={t.briefs.pickGuidance}
              action={{ label: t.briefs.newBrief, onClick: () => setComposing(true) }}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Standalone toggle used above the slide strip to switch back to the document. */
function BriefViewToggle({
  view,
  onViewChange,
}: {
  view: "document" | "slides";
  onViewChange: (v: "document" | "slides") => void;
}) {
  const t = useT();
  return (
    <div className="inline-flex rounded-md border border-ink-subtle bg-ink-surface p-0.5" role="group" aria-label={t.briefs.previewMode}>
      {(
        [
          { id: "document", label: t.briefs.viewDocument },
          { id: "slides", label: t.briefs.viewSlides },
        ] as const
      ).map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onViewChange(id)}
          aria-pressed={view === id}
          className={
            view === id
              ? "rounded bg-civic/15 px-2.5 py-1 text-xs font-medium text-civic"
              : "rounded px-2.5 py-1 text-xs font-medium text-ink-secondary hover:text-ink-primary"
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
