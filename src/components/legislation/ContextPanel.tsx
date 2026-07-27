import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  CornerUpLeft,
  FileDown,
  GitBranch,
  GripVertical,
  Landmark,
  PanelRightClose,
  PanelRightOpen,
  Quote,
  ScanSearch,
  Stamp,
  Trash2,
  Undo2,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ApprovalBadge from "@/components/shared/ApprovalBadge";
import ConfidenceChip from "@/components/shared/ConfidenceChip";
import EmptyState from "@/components/shared/EmptyState";
import type {
  ClauseDetail,
  GraphData,
  OcrReviewTask,
  ReviewQueueItem,
} from "./types";
import {
  charConfidence,
  RELATION_LABELS,
  REVIEW_TRANSITIONS,
  toApprovalState,
  TRANSITION_LABELS,
} from "./types";

export type ContextTab = "dependencies" | "citations" | "review" | "drafts";

export interface DraftSection {
  clauseId: string;
  lawId: string;
  lawTitle: string;
  section: string;
  text: string;
  citationCount: number;
}

export interface PlatformCitation {
  kind: "opportunity" | "law" | "clause" | "brief";
  id: string;
  title: string;
  snippet: string | null;
}

export interface ContextPanelProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeTab: ContextTab;
  onTabChange: (tab: ContextTab) => void;
  clause: ClauseDetail | null;
  graph: GraphData | null;
  graphLoading: boolean;
  graphError: boolean;
  graphSnapshotAt: string | null;
  depth: number;
  onDepthChange: (depth: number) => void;
  onLoadClause: (clauseId: string, lawId: string) => void;
  trail: string[];
  platformCitations: PlatformCitation[] | null;
  citationsLoading: boolean;
  onOpenPlatformCitation: (c: PlatformCitation) => void;
  reviewQueue: ReviewQueueItem[] | null;
  reviewError: string | null;
  ocrTasks: OcrReviewTask[] | null;
  ocrError: string | null;
  canReview: boolean;
  transitionPending: boolean;
  onTransition: (toState: string, comment: string) => void;
  draft: DraftSection[];
  onMoveDraft: (clauseId: string, dir: -1 | 1) => void;
  onRemoveDraft: (clauseId: string) => void;
  onExportDraft: (format: "docx" | "pdf") => void;
  requestId: string | null;
}

const TABS: { id: ContextTab; label: string }[] = [
  { id: "dependencies", label: "Dependencies" },
  { id: "citations", label: "Citations" },
  { id: "review", label: "Review" },
  { id: "drafts", label: "Drafts" },
];

/* ---------------------------------------------------------------- */
/* Dependencies tab                                                  */
/* ---------------------------------------------------------------- */

function GraphNodeRow({
  section,
  lawId,
  edgeLabel,
  direction,
  onLoad,
}: {
  section: string;
  lawId: string;
  edgeLabel: string;
  direction: "up" | "down";
  onLoad: () => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <button
        type="button"
        onClick={onLoad}
        className="flex w-full items-center gap-2 rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-left transition-colors hover:border-civic/50 hover:bg-ink-elevated"
      >
        <span
          aria-hidden
          className={cn(
            "h-6 w-[2px] shrink-0 rounded-full",
            direction === "up" ? "bg-civic-periwinkle" : "bg-civic",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink-primary">
            {section}
          </span>
          <span className="block truncate font-mono text-[11px] text-ink-muted">
            {lawId}
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-ink-subtle px-1.5 py-0.5 font-mono text-[10px] text-civic-periwinkle">
          {edgeLabel}
        </span>
        <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
      </button>
    </motion.li>
  );
}

function DependenciesTab({
  clause,
  graph,
  graphLoading,
  graphError,
  graphSnapshotAt,
  depth,
  onDepthChange,
  onLoadClause,
  trail,
}: Pick<
  ContextPanelProps,
  | "clause"
  | "graph"
  | "graphLoading"
  | "graphError"
  | "graphSnapshotAt"
  | "depth"
  | "onDepthChange"
  | "onLoadClause"
  | "trail"
>) {
  if (!clause) {
    return (
      <EmptyState
        title="No clause selected"
        guidance="Select a clause in the reader to inspect its legal dependency graph."
        Icon={GitBranch}
        showSpotArt={false}
      />
    );
  }

  const nodeById = new Map((graph?.nodes ?? []).map((n) => [n.clauseId, n]));
  // Downstream: direct outbound edges from graph paths.
  const downstream = new Map<string, { relation: string }>();
  for (const path of graph?.paths ?? []) {
    const first = path[0];
    if (first && first.from === clause.clauseId && !downstream.has(first.to)) {
      downstream.set(first.to, { relation: first.relation });
    }
  }
  // Upstream: inbound citation edges on the clause detail.
  const upstream = clause.citation_trace.inbound;

  return (
    <div className="space-y-4">
      {trail.length > 0 && (
        <p
          aria-label="Dependency path"
          className="flex flex-wrap items-center gap-1 rounded-md border border-gold/30 bg-gold/5 px-2.5 py-1.5 font-mono text-[11px] text-gold"
        >
          <Landmark aria-hidden className="h-3 w-3" />
          {trail.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <span aria-hidden>←</span>}
              {t}
            </span>
          ))}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="caption-label text-ink-muted">Path depth</p>
        <div
          role="group"
          aria-label="Graph traversal depth"
          className="flex overflow-hidden rounded-md border border-ink-subtle"
        >
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDepthChange(d)}
              aria-pressed={depth === d}
              className={cn(
                "px-2.5 py-1 font-mono text-xs transition-colors",
                depth === d
                  ? "bg-civic text-ink-base"
                  : "bg-ink-inset text-ink-secondary hover:text-ink-primary",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {graphError && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-1.5 text-xs font-medium text-status-warning"
        >
          <WifiOff aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {graph
            ? `Snapshot from ${graphSnapshotAt ?? "last session"} · live graph unavailable`
            : "Live graph unavailable — no cached snapshot for this clause."}
        </p>
      )}

      {graphLoading ? (
        <div aria-busy="true" className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          <section aria-labelledby="dep-upstream">
            <h3 id="dep-upstream" className="caption-label mb-2 text-ink-muted">
              Upstream — cited by ({upstream.length})
            </h3>
            {upstream.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No inbound citations recorded for this clause.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {upstream.map((edge) => {
                  const node = nodeById.get(edge.fromClauseId);
                  return (
                    <GraphNodeRow
                      key={edge.id}
                      section={node ? `Section ${node.sectionPath}` : edge.fromClauseId}
                      lawId={node?.lawId ?? ""}
                      edgeLabel={RELATION_LABELS[edge.relation] ?? edge.relation}
                      direction="up"
                      onLoad={() =>
                        node && onLoadClause(node.clauseId, node.lawId)
                      }
                    />
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="dep-downstream">
            <h3 id="dep-downstream" className="caption-label mb-2 text-ink-muted">
              Downstream — depends on ({downstream.size})
            </h3>
            {downstream.size === 0 ? (
              <p className="text-xs text-ink-muted">
                This clause has no outbound dependencies at depth {depth}.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {[...downstream.entries()].map(([toId, { relation }]) => {
                  const node = nodeById.get(toId);
                  return (
                    <GraphNodeRow
                      key={toId}
                      section={node ? `Section ${node.sectionPath}` : toId}
                      lawId={node?.lawId ?? ""}
                      edgeLabel={RELATION_LABELS[relation] ?? relation}
                      direction="down"
                      onLoad={() => node && onLoadClause(node.clauseId, node.lawId)}
                    />
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Citations tab                                                     */
/* ---------------------------------------------------------------- */

const KIND_LINK_STYLE: Record<PlatformCitation["kind"], string> = {
  opportunity: "text-civic",
  brief: "text-gold",
  law: "text-civic-periwinkle",
  clause: "text-ink-secondary",
};

function CitationsTab({
  clause,
  platformCitations,
  citationsLoading,
  onOpenPlatformCitation,
}: Pick<
  ContextPanelProps,
  "clause" | "platformCitations" | "citationsLoading" | "onOpenPlatformCitation"
>) {
  if (!clause) {
    return (
      <EmptyState
        title="No clause selected"
        guidance="Select a clause to see where it is cited across the platform."
        Icon={Quote}
        showSpotArt={false}
      />
    );
  }
  return (
    <div className="space-y-4">
      <section aria-labelledby="cit-platform">
        <h3 id="cit-platform" className="caption-label mb-2 text-ink-muted">
          Cited across the platform
        </h3>
        {citationsLoading ? (
          <div aria-busy="true" className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-12 w-full" />
            ))}
          </div>
        ) : !platformCitations || platformCitations.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No platform artifacts cite this instrument yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {platformCitations.map((c) => (
              <li key={`${c.kind}:${c.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenPlatformCitation(c)}
                  className="w-full rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-left transition-colors hover:border-civic/50 hover:bg-ink-elevated"
                >
                  <span className={cn("caption-label", KIND_LINK_STYLE[c.kind])}>
                    {c.kind}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] font-medium text-ink-primary">
                    {c.title}
                  </span>
                  {c.snippet && (
                    <span className="block truncate text-xs text-ink-muted">
                      {c.snippet}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cit-history">
        <h3 id="cit-history" className="caption-label mb-2 text-ink-muted">
          Citation edges ({clause.citation_trace.outbound.length} out ·{" "}
          {clause.citation_trace.inbound.length} in)
        </h3>
        {clause.citation_trace.outbound.length === 0 &&
        clause.citation_trace.inbound.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No citation edges recorded in the legal graph.
          </p>
        ) : (
          <ul className="space-y-1 font-mono text-[11px] text-ink-secondary">
            {clause.citation_trace.outbound.map((e) => (
              <li key={e.id} className="truncate">
                → {e.toClauseId}{" "}
                <span className="text-civic-periwinkle">
                  ({RELATION_LABELS[e.relation] ?? e.relation})
                </span>
              </li>
            ))}
            {clause.citation_trace.inbound.map((e) => (
              <li key={e.id} className="truncate">
                ← {e.fromClauseId}{" "}
                <span className="text-civic-periwinkle">
                  ({RELATION_LABELS[e.relation] ?? e.relation})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Review tab                                                        */
/* ---------------------------------------------------------------- */

/** OCR extraction QA: source text with a per-character confidence heatmap. */
function ExtractionQa({ clause }: { clause: ClauseDetail }) {
  const [heatmap, setHeatmap] = useState(false);
  return (
    <section
      aria-labelledby="ocr-qa"
      className="rounded-md border border-ink-subtle bg-ink-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="ocr-qa"
          className="caption-label flex items-center gap-1.5 text-ink-muted"
        >
          <ScanSearch aria-hidden className="h-3.5 w-3.5" />
          Extraction QA
        </h3>
        <button
          type="button"
          onClick={() => setHeatmap((v) => !v)}
          aria-pressed={heatmap}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
            heatmap
              ? "border-civic/50 bg-civic/10 text-civic"
              : "border-ink-subtle text-ink-secondary hover:text-ink-primary",
          )}
        >
          Confidence heatmap {heatmap ? "on" : "off"}
        </button>
      </div>
      <p className="mt-2 rounded-md bg-ink-inset p-2.5 font-serif text-[13px] leading-6 text-ink-primary">
        {heatmap
          ? clause.text.split("").map((ch, i) => {
              const c = charConfidence(clause.clauseId, i, clause.confidence);
              const bg =
                c >= 0.75
                  ? "transparent"
                  : c >= 0.5
                    ? "rgba(217,164,65,0.22)"
                    : "rgba(217,99,95,0.30)";
              return (
                <span key={i} style={{ backgroundColor: bg }} title={`Confidence ${c.toFixed(2)}`}>
                  {ch}
                </span>
              );
            })
          : clause.text}
      </p>
      <p className="mt-1.5 text-[11px] text-ink-muted">
        Mean OCR confidence{" "}
        <span className="font-mono">{clause.confidence.toFixed(2)}</span>
        {heatmap && " — amber/red spans need human verification against the source scan."}
      </p>
    </section>
  );
}

function TransitionIcon({ to }: { to: string }) {
  if (to === "approved") return <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />;
  if (to === "signed_off") return <Stamp aria-hidden className="h-3.5 w-3.5" />;
  if (to === "returned") return <Undo2 aria-hidden className="h-3.5 w-3.5" />;
  return <CornerUpLeft aria-hidden className="h-3.5 w-3.5" />;
}

function ReviewTab({
  clause,
  reviewQueue,
  reviewError,
  ocrTasks,
  ocrError,
  canReview,
  transitionPending,
  onTransition,
  onLoadClause,
}: Pick<
  ContextPanelProps,
  | "clause"
  | "reviewQueue"
  | "reviewError"
  | "ocrTasks"
  | "ocrError"
  | "canReview"
  | "transitionPending"
  | "onTransition"
  | "onLoadClause"
>) {
  const [comment, setComment] = useState("");
  const allowed = clause ? (REVIEW_TRANSITIONS[clause.reviewState] ?? []) : [];
  const queueEmpty =
    !reviewError && reviewQueue !== null && reviewQueue.length === 0;

  return (
    <div className="space-y-4">
      {/* Active clause review task card */}
      {clause ? (
        <section
          aria-labelledby="review-active"
          className="rounded-md border border-ink-subtle bg-ink-surface p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 id="review-active" className="text-sm font-semibold text-ink-primary">
              Validate extraction — Section {clause.sectionPath}
            </h3>
            <ApprovalBadge state={toApprovalState(clause.reviewState)} />
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            Assigned: legal analyst panel · Clause{" "}
            <span className="font-mono">{clause.clauseId}</span>
          </p>

          <ExtractionQa clause={clause} />

          <label className="mt-3 block">
            <span className="caption-label text-ink-muted">Review comment</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Comment for the approval record…"
              className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset p-2 text-[13px] leading-5 text-ink-primary placeholder:text-ink-muted focus:border-civic"
            />
          </label>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {allowed.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-gold">
                <Stamp aria-hidden className="h-3.5 w-3.5" />
                Signed off — no further transitions.
              </p>
            ) : (
              allowed.map((to) => (
                <span
                  key={to}
                  title={
                    canReview
                      ? undefined
                      : "Sign in as a legal analyst to change review state."
                  }
                >
                  <button
                    type="button"
                    disabled={!canReview || transitionPending}
                    onClick={() => onTransition(to, comment)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-transform",
                      canReview && !transitionPending
                        ? to === "approved" || to === "signed_off"
                          ? "border-status-success/50 text-status-success hover:bg-status-success/10 active:scale-[0.98]"
                          : to === "returned"
                            ? "border-status-warning/50 text-status-warning hover:bg-status-warning/10 active:scale-[0.98]"
                            : "border-civic/50 text-civic hover:bg-civic/10 active:scale-[0.98]"
                        : "cursor-not-allowed border-ink-subtle text-ink-muted",
                    )}
                  >
                    <TransitionIcon to={to} />
                    {TRANSITION_LABELS[to] ?? to}
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Approval history thread */}
          {clause.approval_history.length > 0 && (
            <ol
              aria-label="Approval history"
              className="mt-3 space-y-1.5 border-t border-ink-subtle pt-2.5"
            >
              {clause.approval_history.map((ev) => (
                <li key={ev.id} className="text-xs text-ink-secondary">
                  <span className="font-mono text-[11px] text-ink-muted">
                    {new Date(ev.createdAt).toLocaleString()}
                  </span>{" "}
                  <ApprovalBadge
                    state={toApprovalState(ev.fromState)}
                    className="mx-0.5 px-1.5 py-0 text-[10px]"
                  />
                  →{" "}
                  <ApprovalBadge
                    state={toApprovalState(ev.toState)}
                    className="mx-0.5 px-1.5 py-0 text-[10px]"
                  />
                  {ev.comment && (
                    <span className="block pl-1 italic text-ink-muted">
                      “{ev.comment}”
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <EmptyState
          title="No clause selected"
          guidance="Select a clause to review its extraction and approval state."
          Icon={ScanSearch}
          showSpotArt={false}
        />
      )}

      {/* Review queues */}
      {reviewError ? (
        <p className="rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-xs text-ink-muted">
          {reviewError}
        </p>
      ) : queueEmpty && (!ocrTasks || ocrTasks.length === 0) ? (
        <EmptyState
          title="Review queue clear"
          guidance="All extractions verified — no clauses or documents are waiting on legal review."
          action={undefined}
        />
      ) : (
        <>
          {reviewQueue && reviewQueue.length > 0 && (
            <section aria-labelledby="review-queue">
              <h3 id="review-queue" className="caption-label mb-2 text-ink-muted">
                Clause review queue ({reviewQueue.length})
              </h3>
              <ul className="space-y-1.5">
                {reviewQueue.map((item) => (
                  <li key={item.clauseId}>
                    <button
                      type="button"
                      onClick={() => onLoadClause(item.clauseId, item.lawId)}
                      className="flex w-full items-center gap-2 rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-left hover:border-civic/50 hover:bg-ink-elevated"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink-primary">
                          {item.lawId} · Section {item.sectionPath}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {item.text.slice(0, 90)}
                        </span>
                      </span>
                      <ConfidenceChip score={item.confidence} />
                      <ApprovalBadge state={toApprovalState(item.reviewState)} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {ocrError ? (
            <p className="rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-xs text-ink-muted">
              {ocrError}
            </p>
          ) : (
            ocrTasks &&
            ocrTasks.length > 0 && (
              <section aria-labelledby="ocr-queue">
                <h3 id="ocr-queue" className="caption-label mb-2 text-ink-muted">
                  OCR document queue ({ocrTasks.length})
                </h3>
                <ul className="space-y-1.5">
                  {ocrTasks.map((task) => (
                    <li
                      key={task.taskId}
                      className="rounded-md border border-ink-subtle bg-ink-surface px-3 py-2"
                    >
                      <span className="block truncate text-[13px] font-medium text-ink-primary">
                        {task.entityRef}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                        {task.type} · {task.status} · assigned {task.assigneeRole}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Drafts tab                                                        */
/* ---------------------------------------------------------------- */

function DraftsTab({
  draft,
  onMoveDraft,
  onRemoveDraft,
  onExportDraft,
  requestId,
}: Pick<
  ContextPanelProps,
  "draft" | "onMoveDraft" | "onRemoveDraft" | "onExportDraft" | "requestId"
>) {
  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-ink-muted">
        Working draft assembled from clauses. Export embeds the citation list as
        an annex and records an audit event.
      </p>
      {draft.length === 0 ? (
        <EmptyState
          title="Draft is empty"
          guidance="Use “Add to draft” on a clause (keyboard: D) to assemble a working draft."
        />
      ) : (
        <ol className="flex-1 space-y-1.5" aria-label="Draft sections">
          <AnimatePresence initial={false}>
            {draft.map((s, i) => (
              <motion.li
                key={s.clauseId}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="rounded-md border border-ink-subtle bg-ink-surface px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <GripVertical aria-hidden className="h-3.5 w-3.5 text-ink-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-primary">
                      {i + 1}. {s.lawTitle} — Section {s.section}
                    </span>
                    <span className="font-mono text-[11px] text-ink-muted">
                      {s.citationCount} citation
                      {s.citationCount === 1 ? "" : "s"} in chain
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onMoveDraft(s.clauseId, -1)}
                    disabled={i === 0}
                    aria-label={`Move section ${s.section} up`}
                    className="rounded p-1 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary disabled:opacity-30"
                  >
                    <ArrowUp aria-hidden className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveDraft(s.clauseId, 1)}
                    disabled={i === draft.length - 1}
                    aria-label={`Move section ${s.section} down`}
                    className="rounded p-1 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary disabled:opacity-30"
                  >
                    <ArrowDown aria-hidden className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveDraft(s.clauseId)}
                    aria-label={`Remove section ${s.section} from draft`}
                    className="rounded p-1 text-ink-secondary hover:bg-status-danger/10 hover:text-status-danger"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      <footer className="border-t border-ink-subtle pt-3">
        <p className="caption-label mb-1.5 text-ink-muted">Export draft</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={draft.length === 0}
            onClick={() => onExportDraft("docx")}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-xs font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-ink-elevated disabled:text-ink-muted"
          >
            <FileDown aria-hidden className="h-3.5 w-3.5" />
            DOCX
          </button>
          <button
            type="button"
            disabled={draft.length === 0}
            onClick={() => onExportDraft("pdf")}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-civic/50 px-3 py-1.5 text-xs font-medium text-civic transition-transform hover:bg-civic/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-ink-subtle disabled:text-ink-muted"
          >
            <FileDown aria-hidden className="h-3.5 w-3.5" />
            PDF / Print
          </button>
        </div>
        {requestId && (
          <p className="mt-2 font-mono text-[10px] text-ink-muted">
            request_id {requestId}
          </p>
        )}
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Panel shell                                                       */
/* ---------------------------------------------------------------- */

export default function ContextPanel(props: ContextPanelProps) {
  const {
    collapsed,
    onToggleCollapsed,
    activeTab,
    onTabChange,
    draft,
  } = props;

  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-l border-ink-subtle bg-ink-surface py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand context panel"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          <PanelRightOpen aria-hidden className="h-4 w-4" />
        </button>
        <span
          aria-hidden
          className="mt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted [writing-mode:vertical-rl]"
        >
          Context
        </span>
      </div>
    );
  }

  return (
    <motion.aside
      aria-label="Clause context panel"
      initial={false}
      animate={{ width: 360 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-ink-subtle bg-ink-surface"
    >
      <div className="flex items-center gap-1 border-b border-ink-subtle p-2">
        <div role="tablist" aria-label="Context views" className="flex flex-1 gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "text-civic"
                  : "text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary",
              )}
            >
              {tab.label}
              {tab.id === "drafts" && draft.length > 0 && (
                <span className="ml-1 rounded-full bg-civic/15 px-1 font-mono text-[10px] text-civic">
                  {draft.length}
                </span>
              )}
              {activeTab === tab.id && (
                <motion.span
                  layoutId="context-tab-underline"
                  className="absolute inset-x-2 -bottom-[5px] h-[2px] rounded-full bg-civic"
                />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse context panel"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          <PanelRightClose aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="h-full"
          >
            {activeTab === "dependencies" && <DependenciesTab {...props} />}
            {activeTab === "citations" && <CitationsTab {...props} />}
            {activeTab === "review" && <ReviewTab {...props} />}
            {activeTab === "drafts" && <DraftsTab {...props} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
