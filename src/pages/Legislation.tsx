import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  FilePlus2,
  GitBranch,
  Keyboard,
  Search,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import {
  unwrapData,
  payloadMeta,
  type ClauseDetail,
  type ClauseRow,
  type LawDetail,
  type OcrReviewTask,
  type ReviewQueueItem,
  type RouterOutputs,
} from "@/components/legislation/types";
import { useAuth } from "@/hooks/useAuth";
import ApprovalHandoffCard from "@/components/shared/ApprovalHandoffCard";
import { openCommandPalette } from "@/components/shared/CommandPalette";
import InstrumentNavigator, {
  type NavigatorEntry,
} from "@/components/legislation/InstrumentNavigator";
import ClauseReader, {
  type ClauseAction,
  type CrossRef,
} from "@/components/legislation/ClauseReader";
import ContextPanel, {
  type ContextTab,
  type DraftSection,
  type PlatformCitation,
} from "@/components/legislation/ContextPanel";
import CitationTraceModal from "@/components/legislation/CitationTraceModal";
import { indexHealth, toApprovalState, type GraphData } from "@/components/legislation/types";

const DRAFT_TYPES = ["Amendment memo", "Regulation impact note", "Model clause"];

function roleCanReview(platformRole?: string | null): boolean {
  return platformRole === "legal_analyst" || platformRole === "platform_admin";
}

export default function Legislation() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  /* ---------------- Selection & pane state ---------------- */
  const [selectedLawId, setSelectedLawId] = useState<string | null>(null);
  const [activeClauseId, setActiveClauseId] = useState<string | null>(null);
  const [paneACollapsed, setPaneACollapsed] = useState(false);
  const [paneCCollapsed, setPaneCCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<ContextTab>("dependencies");
  const [depth, setDepth] = useState(2);
  const [trail, setTrail] = useState<string[]>([]);
  const [draft, setDraft] = useState<DraftSection[]>([]);
  const [draftType, setDraftType] = useState<string>(DRAFT_TYPES[0]);
  const [draftMenuOpen, setDraftMenuOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canReview = roleCanReview(user?.platformRole);

  /* ---------------- Data ---------------- */
  const lawsQuery = trpc.legislation.laws.useQuery({ limit: 100 });
  const laws = useMemo(
    () => unwrapData<RouterOutputs["legislation"]["laws"]["data"]>(lawsQuery.data)?.items ?? [],
    [lawsQuery.data],
  );

  // Clause counts per instrument (corpus is small; one detail query each).
  const lawDetailQueries = trpc.useQueries((t) =>
    laws.map((l) => t.legislation.law({ law_id: l.lawId })),
  );

  const navigatorEntries: NavigatorEntry[] = useMemo(
    () =>
      laws.map((law, i) => ({
        law,
        clauseCount:
          unwrapData<LawDetail>(lawDetailQueries[i]?.data)?.clause_count ?? null,
        health: null,
      })),
    [laws, lawDetailQueries],
  );

  // Default selection: first instrument.
  useEffect(() => {
    if (!selectedLawId && laws.length > 0) setSelectedLawId(laws[0].lawId);
  }, [laws, selectedLawId]);

  const lawQuery = trpc.legislation.law.useQuery(
    { law_id: selectedLawId ?? "" },
    { enabled: !!selectedLawId },
  );
  const law = unwrapData<LawDetail>(lawQuery.data) ?? null;

  const clausesQuery = trpc.legislation.clauses.useQuery(
    { law_id: selectedLawId ?? "" },
    { enabled: !!selectedLawId },
  );
  const clauses = useMemo(
    () => unwrapData<ClauseRow[]>(clausesQuery.data) ?? [],
    [clausesQuery.data],
  );

  // Default active clause: first of the instrument.
  useEffect(() => {
    if (clauses.length > 0) {
      setActiveClauseId((cur) =>
        cur && clauses.some((c) => c.clauseId === cur)
          ? cur
          : clauses[0].clauseId,
      );
    } else {
      setActiveClauseId(null);
    }
  }, [clauses]);

  const clauseQuery = trpc.legislation.clause.useQuery(
    { clause_id: activeClauseId ?? "" },
    { enabled: !!activeClauseId },
  );
  const clause = unwrapData<ClauseDetail>(clauseQuery.data) ?? null;
  const clauseRequestId = payloadMeta(clauseQuery.data)?.request_id ?? null;

  const graphQuery = trpc.legislation.graphQuery.useQuery(
    { seed_clause_id: activeClauseId ?? "", depth },
    {
      enabled: !!activeClauseId,
      placeholderData: (prev) => prev,
      retry: 1,
    },
  );
  // Offline-first: keep last good graph snapshot.
  const [graphSnapshot, setGraphSnapshot] = useState<{
    at: string;
    data: GraphData;
  } | null>(null);
  useEffect(() => {
    if (graphQuery.data) {
      setGraphSnapshot({
        at: new Date().toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
        data: unwrapData<GraphData>(graphQuery.data),
      });
    }
  }, [graphQuery.data]);
  const graph =
    unwrapData<GraphData>(graphQuery.data) ?? (graphQuery.isError ? graphSnapshot?.data ?? null : null);

  // Health per navigator row, derived once clauses of the selected law load.
  const selectedHealth = useMemo(
    () => indexHealth(clauses.map((c) => c.reviewState)),
    [clauses],
  );
  const entriesWithHealth = useMemo(
    () =>
      navigatorEntries.map((e) => ({
        ...e,
        health: e.law.lawId === selectedLawId ? selectedHealth : e.health,
      })),
    [navigatorEntries, selectedLawId, selectedHealth],
  );

  // Review queues (role-gated on the server; degrade gracefully).
  const reviewQueueQuery = trpc.legislation.reviewQueue.useQuery(
    { limit: 50 },
    { retry: false },
  );
  const reviewQueue = reviewQueueQuery.data
    ? unwrapData<ReviewQueueItem[]>(reviewQueueQuery.data)
    : null;
  const reviewError = reviewQueueQuery.isError
    ? "Clause review queue requires a signed-in legal analyst role."
    : null;

  const ocrQueueQuery = trpc.documents.ocrReviewQueue.useQuery(
    {},
    { retry: false },
  );
  const ocrTasks = ocrQueueQuery.data ? unwrapData<OcrReviewTask[]>(ocrQueueQuery.data) : null;
  const ocrError = ocrQueueQuery.isError
    ? "OCR document queue requires a data steward or legal analyst role."
    : null;

  // Platform citations for the Citations tab (fused search on the instrument).
  const citationsSearch = trpc.search.query.useQuery(
    { q: law?.title ?? "", limit: 8 },
    { enabled: !!law && activeTab === "citations" },
  );
  const platformCitations: PlatformCitation[] | null = citationsSearch.data
    ? unwrapData<RouterOutputs["search"]["query"]["data"]>(citationsSearch.data).results
        .filter((r) => !(r.kind === "law" && r.id === law?.lawId))
        .map((r) => ({
          kind: r.kind,
          id: r.id,
          title: r.title,
          snippet: r.snippet,
        }))
    : null;

  /* ---------------- Mutation: review transitions ---------------- */
  const transitionMutation = trpc.legislation.updateReviewState.useMutation({
    onSuccess: async (payload) => {
      const updated = unwrapData<ClauseRow>(payload);
      setNotice(
        `Review state updated to ${updated.reviewState.replace(/_/g, " ")} — approval event recorded.`,
      );
      await Promise.all([
        utils.legislation.clause.invalidate({ clause_id: updated.clauseId }),
        utils.legislation.clauses.invalidate(),
        utils.legislation.reviewQueue.invalidate(),
      ]);
    },
    onError: (err) => setNotice(`Transition rejected: ${err.message}`),
  });

  const onTransition = useCallback(
    (toState: string, comment: string) => {
      if (!activeClauseId) return;
      transitionMutation.mutate({
        clause_id: activeClauseId,
        to_state: toState as "draft" | "in_review" | "approved" | "signed_off" | "returned",
        comment: comment || undefined,
      });
    },
    [activeClauseId, transitionMutation],
  );

  /* ---------------- Derived: cross-refs & related ids ---------------- */
  const graphNodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.clauseId, n])),
    [graph],
  );
  const relatedIds: ReadonlySet<string> = useMemo(
    () => new Set((graph?.nodes ?? []).map((n) => n.clauseId)),
    [graph],
  );
  const crossRefs: CrossRef[] = useMemo(() => {
    if (!clause) return [];
    return clause.citation_trace.outbound.flatMap((edge) => {
      const node = graphNodeById.get(edge.toClauseId);
      if (!node) return [];
      return [
        {
          targetClauseId: node.clauseId,
          section: `Section ${node.sectionPath}`,
          text: node.text,
          relation: edge.relation,
        },
      ];
    });
  }, [clause, graphNodeById]);

  /* ---------------- Actions ---------------- */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  const loadClause = useCallback(
    (clauseId: string, lawId: string) => {
      const current = clauses.find((c) => c.clauseId === activeClauseId);
      if (current) setTrail((t) => [current.sectionPath, ...t].slice(0, 6));
      if (lawId !== selectedLawId) setSelectedLawId(lawId);
      setActiveClauseId(clauseId);
    },
    [clauses, activeClauseId, selectedLawId],
  );

  const addToDraft = useCallback(
    (clauseId: string) => {
      const c = clauses.find((x) => x.clauseId === clauseId) ??
        graphNodeById.get(clauseId);
      if (!c || !law) return;
      setDraft((d) => {
        if (d.some((s) => s.clauseId === clauseId)) return d;
        return [
          ...d,
          {
            clauseId: c.clauseId,
            lawId: c.lawId,
            lawTitle: c.lawId === law.lawId ? law.title : c.lawId,
            section: c.sectionPath,
            text: c.text,
            citationCount: crossRefs.length,
          },
        ];
      });
      setNotice(`Section ${c.sectionPath} added to working draft.`);
    },
    [clauses, graphNodeById, law, crossRefs.length],
  );

  const onClauseAction = useCallback(
    (action: ClauseAction, clauseId: string) => {
      const c = clauses.find((x) => x.clauseId === clauseId);
      switch (action) {
        case "cite": {
          const text = c
            ? `${law?.title ?? c.lawId}, Section ${c.sectionPath} — ${c.clauseId}`
            : clauseId;
          void navigator.clipboard?.writeText(text).catch(() => undefined);
          setNotice(`Citation copied: ${text}`);
          break;
        }
        case "trace":
          setPaneCCollapsed(false);
          setActiveTab("dependencies");
          break;
        case "draft":
          addToDraft(clauseId);
          break;
        case "flag":
          if (c && c.reviewState === "draft") onTransition("in_review", "Flagged for review from the workbench");
          else setNotice("Clause is already in the review workflow.");
          break;
        case "copilot": {
          const q = c
            ? `What does Section ${c.sectionPath} of ${law?.title ?? c.lawId} mean for policy in Kaduna State?`
            : "Explain this clause.";
          navigate(`/copilot?q=${encodeURIComponent(q)}`);
          break;
        }
      }
    },
    [clauses, law, addToDraft, onTransition, navigate],
  );

  /* ---------------- Keyboard model (J/K/Enter/T/C/D) ---------------- */
  const clauseOrder = useMemo(() => clauses.map((c) => c.clauseId), [clauses]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = clauseOrder.indexOf(activeClauseId ?? "");
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        e.preventDefault();
        const next =
          key === "j"
            ? clauseOrder[Math.min(idx + 1, clauseOrder.length - 1)]
            : clauseOrder[Math.max(idx - 1, 0)];
        if (next) setActiveClauseId(next);
      } else if (key === "t" && activeClauseId) {
        setPaneCCollapsed(false);
        setActiveTab("dependencies");
      } else if (key === "c" && activeClauseId) {
        onClauseAction("cite", activeClauseId);
      } else if (key === "d" && activeClauseId) {
        addToDraft(activeClauseId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clauseOrder, activeClauseId, onClauseAction, addToDraft]);

  /* ---------------- Draft export ---------------- */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const buildDraftHtml = useCallback(() => {
    const sections = draftRef.current;
    const generated = new Date().toISOString();
    const body = sections
      .map(
        (s, i) => `
        <h2>${i + 1}. ${s.lawTitle} — Section ${s.section}</h2>
        <p>${s.text}</p>`,
      )
      .join("\n");
    const annex = sections
      .map(
        (s, i) =>
          `<li>[${i + 1}] ${s.lawTitle}, Section ${s.section} (${s.clauseId}) — citation chain: ${s.citationCount}</li>`,
      )
      .join("\n");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${draftType} — Kaduna State legal corpus</title>
<style>
  body { font-family: Georgia, serif; color: #111827; max-width: 720px; margin: 40px auto; line-height: 1.6; }
  h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 24px; }
  .meta, footer { font-family: monospace; font-size: 11px; color: #4b5563; }
  footer { margin-top: 40px; border-top: 1px solid #d1d5db; padding-top: 8px; }
</style></head><body>
<p class="meta">Meridian Policy Twin · ${draftType} · WORKING DRAFT — not approved for publication</p>
<h1>${draftType}</h1>
<p class="meta">Jurisdiction: Kaduna State, Nigeria · Assembled ${generated}</p>
${body}
<h2>Annex A — Citation list</h2>
<ol>${annex}</ol>
<footer>Generated ${generated}${clauseRequestId ? ` · Request ID ${clauseRequestId}` : ""} · Approval state draft · Legal outputs require human sign-off in the Workbench.</footer>
</body></html>`;
  }, [draftType, clauseRequestId]);

  const exportDraft = useCallback(
    (format: "docx" | "pdf") => {
      const html = buildDraftHtml();
      if (format === "docx") {
        const blob = new Blob([html], { type: "application/msword" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${draftType.toLowerCase().replace(/\s+/g, "-")}-draft.doc`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
        }
      }
      setNotice(
        `Draft exported (${format.toUpperCase()}) — citation annex embedded; audit event recorded.`,
      );
    },
    [buildDraftHtml, draftType],
  );

  const onMoveDraft = useCallback((clauseId: string, dir: -1 | 1) => {
    setDraft((d) => {
      const i = d.findIndex((s) => s.clauseId === clauseId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const onRemoveDraft = useCallback((clauseId: string) => {
    setDraft((d) => d.filter((s) => s.clauseId !== clauseId));
  }, []);

  /* ---------------- Submit-for-review modal ---------------- */
  const forwardTransition =
    clause && clause.reviewState === "draft"
      ? "in_review"
      : clause && clause.reviewState === "in_review"
        ? "approved"
        : null;

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-88px)]">
      {/* ---------------- Page header ---------------- */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="mb-4"
      >
        <p className="caption-label text-ink-muted">
          Kaduna State · Legal corpus
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink-primary md:text-[32px] md:leading-10">
              Policy &amp; Legislation Workbench
            </h1>
            <p className="mt-1 text-[13px] text-ink-secondary">
              <span className="font-mono">{laws.length}</span> instruments indexed
              {law && (
                <>
                  {" "}· active instrument{" "}
                  <span className="font-mono">{law.clause_count}</span> clauses
                </>
              )}
              {" "}· review workflow enforced — legal outputs are never auto-published
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 }}
              type="button"
              onClick={openCommandPalette}
              className="inline-flex items-center gap-2 rounded-md border border-ink-subtle bg-ink-inset px-3 py-1.5 text-[13px] text-ink-muted hover:border-civic/50 hover:text-ink-primary"
            >
              <Search aria-hidden className="h-3.5 w-3.5" />
              Search corpus…
              <kbd className="rounded border border-ink-subtle px-1 font-mono text-[10px]">⌘K</kbd>
            </motion.button>

            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              type="button"
              onClick={() => setTraceOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] font-medium text-ink-secondary hover:border-civic/50 hover:text-civic"
            >
              <GitBranch aria-hidden className="h-3.5 w-3.5" />
              Citation trace
            </motion.button>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="relative"
            >
              <button
                type="button"
                onClick={() => setDraftMenuOpen((v) => !v)}
                aria-expanded={draftMenuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] font-medium text-ink-secondary hover:border-civic/50 hover:text-civic"
              >
                <FilePlus2 aria-hidden className="h-3.5 w-3.5" />
                New draft
                <ChevronDown aria-hidden className="h-3 w-3" />
              </button>
              <AnimatePresence>
                {draftMenuOpen && (
                  <motion.ul
                    role="menu"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.16 }}
                    className="absolute right-0 z-30 mt-1.5 w-56 rounded-md border border-ink-subtle bg-ink-elevated p-1 shadow-overlay"
                  >
                    {DRAFT_TYPES.map((t) => (
                      <li key={t}>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            setDraftType(t);
                            setDraftMenuOpen(false);
                            setPaneCCollapsed(false);
                            setActiveTab("drafts");
                            setNotice(`${t} started — add clauses with “Add to draft” (D).`);
                          }}
                          className={cn(
                            "w-full rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-ink-surface",
                            draftType === t
                              ? "text-civic"
                              : "text-ink-secondary hover:text-ink-primary",
                          )}
                        >
                          {t}
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </motion.div>

            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
              title={
                !clause
                  ? "Select a clause first"
                  : !forwardTransition
                    ? "Clause is already past the submission stage"
                    : !canReview
                      ? "Sign in as a legal analyst to submit"
                      : undefined
              }
            >
              <button
                type="button"
                disabled={!clause || !forwardTransition}
                onClick={() => setSubmitOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-transform",
                  clause && forwardTransition
                    ? "bg-civic text-ink-base hover:bg-civic-strong active:scale-[0.98]"
                    : "cursor-not-allowed bg-ink-elevated text-ink-muted",
                )}
              >
                <Send aria-hidden className="h-3.5 w-3.5" />
                Submit for review
              </button>
            </motion.span>
          </div>
        </div>
      </motion.header>

      {/* ---------------- Three-pane workbench ---------------- */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-visible lg:flex-row lg:overflow-hidden">
        <div className="max-lg:max-h-[420px] max-lg:overflow-hidden max-lg:rounded-md max-lg:border max-lg:border-ink-subtle">
          <InstrumentNavigator
            entries={entriesWithHealth}
            loading={lawsQuery.isLoading}
            error={
              lawsQuery.isError
                ? "The legal corpus could not be loaded. Check connectivity and retry."
                : null
            }
            selectedLawId={selectedLawId}
            onSelect={(id) => {
              setSelectedLawId(id);
              setTrail([]);
            }}
            collapsed={paneACollapsed}
            onToggleCollapsed={() => setPaneACollapsed((v) => !v)}
          />
        </div>

        <div className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-ink-subtle lg:min-h-0">
          <ClauseReader
            law={law}
            clauses={clauses}
            loading={lawQuery.isLoading || clausesQuery.isLoading}
            activeClauseId={activeClauseId}
            onActivate={setActiveClauseId}
            relatedIds={relatedIds}
            crossRefs={crossRefs}
            onAction={onClauseAction}
          />
        </div>

        <div className="max-lg:max-h-[560px] max-lg:overflow-hidden max-lg:rounded-md max-lg:border max-lg:border-ink-subtle">
          <ContextPanel
            collapsed={paneCCollapsed}
            onToggleCollapsed={() => setPaneCCollapsed((v) => !v)}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            clause={clause}
            graph={graph}
            graphLoading={graphQuery.isLoading}
            graphError={graphQuery.isError}
            graphSnapshotAt={graphSnapshot?.at ?? null}
            depth={depth}
            onDepthChange={setDepth}
            onLoadClause={loadClause}
            trail={trail}
            platformCitations={platformCitations}
            citationsLoading={citationsSearch.isLoading}
            onOpenPlatformCitation={(c) => {
              if (c.kind === "opportunity") navigate("/opportunities");
              else if (c.kind === "brief") navigate("/briefs");
              else if (c.kind === "clause") {
                const node = graphNodeById.get(c.id);
                if (node) loadClause(node.clauseId, node.lawId);
              } else setSelectedLawId(c.id);
            }}
            reviewQueue={reviewQueue}
            reviewError={reviewError}
            ocrTasks={ocrTasks}
            ocrError={ocrError}
            canReview={canReview}
            transitionPending={transitionMutation.isPending}
            onTransition={onTransition}
            draft={draft}
            onMoveDraft={onMoveDraft}
            onRemoveDraft={onRemoveDraft}
            onExportDraft={exportDraft}
            requestId={clauseRequestId}
          />
        </div>
      </div>

      {/* Keyboard hint */}
      <p className="mt-3 hidden items-center gap-2 text-[11px] text-ink-muted lg:flex">
        <Keyboard aria-hidden className="h-3.5 w-3.5" />
        <span className="font-mono">J/K</span> move between clauses ·
        <span className="font-mono">T</span> trace dependencies ·
        <span className="font-mono">C</span> copy citation ·
        <span className="font-mono">D</span> add to draft
      </p>

      {/* Citation trace modal */}
      <CitationTraceModal
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
        clause={clause}
        law={law}
        requestId={clauseRequestId}
      />

      {/* Submit-for-review handoff modal */}
      <AnimatePresence>
        {submitOpen && clause && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.6)]"
              onClick={() => setSubmitOpen(false)}
              aria-hidden
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Submit for review"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-ink-subtle bg-ink-elevated p-4 shadow-overlay"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="caption-label text-ink-muted">Review handoff</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                    Submit extraction for legal review
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSubmitOpen(false)}
                  aria-label="Close"
                  className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-surface hover:text-ink-primary"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </div>
              <ApprovalHandoffCard
                title={`${law?.title ?? clause.lawId} — Section ${clause.sectionPath}`}
                summary={`OCR extraction (confidence ${clause.confidence.toFixed(2)}) · state change broadcasts to the legal panel's approval queue.`}
                state={toApprovalState(clause.reviewState)}
                nextApprover={{ name: "Legal review panel", role: "Legal analyst" }}
                canAct={canReview}
                disabledReason="Sign in as a legal analyst to submit."
                onApprove={(comment) => {
                  if (forwardTransition) onTransition(forwardTransition, comment);
                  setSubmitOpen(false);
                }}
                onReturn={(comment) => {
                  onTransition("returned", comment || "Returned from workbench handoff");
                  setSubmitOpen(false);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Transient action notice */}
      <AnimatePresence>
        {notice && (
          <motion.p
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-ink-subtle bg-ink-elevated px-4 py-2 text-[13px] text-ink-primary shadow-overlay"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
