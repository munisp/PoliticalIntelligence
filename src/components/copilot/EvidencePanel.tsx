import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ExternalLink,
  FileDown,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import StatusDot, { type StatusKind } from "@/components/shared/StatusDot";
import type { EvidenceItem } from "./types";
import { SOURCE_TYPE_CHIP } from "./types";

export type EvidenceTab = "bundle" | "context";

export interface ContextEntity {
  label: string;
  kind: "jurisdiction" | "sector" | "instrument" | "run";
}

export interface EvidencePanelProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  tab: EvidenceTab;
  onTabChange: (tab: EvidenceTab) => void;
  bundle: EvidenceItem[];
  requestId: string | null;
  pinnedIds: ReadonlySet<string>;
  onTogglePin: (id: string) => void;
  highlightId: string | null;
  entities: ContextEntity[];
  activeEntityFilter: string | null;
  onToggleEntityFilter: (label: string) => void;
  onExportMemo: () => void;
  canExport: boolean;
}

function freshness(createdAt: string | null): { status: StatusKind; note: string } {
  if (!createdAt) return { status: "stale", note: "freshness unknown" };
  const days = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 86_400_000,
  );
  if (days <= 7) return { status: "healthy", note: `${days}d old` };
  if (days <= 30) return { status: "stale", note: `${days}d old` };
  return { status: "failing", note: `${days}d old` };
}

function deepLink(item: EvidenceItem): { to: string; label: string } {
  if (item.sourceType === "graph" || item.retrievalPath?.includes("legislation"))
    return { to: "/legislation", label: "Open in Workbench" };
  if (item.sourceType === "document") return { to: "/documents", label: "Open in Documents" };
  return { to: "/opportunities", label: "Open in Explorer" };
}

function SourceCard({
  item,
  index,
  pinned,
  highlighted,
  onTogglePin,
}: {
  item: EvidenceItem;
  index: number;
  pinned: boolean;
  highlighted: boolean;
  onTogglePin: () => void;
}) {
  const fresh = freshness(item.createdAt);
  const link = deepLink(item);
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.45), duration: 0.2 }}
      className={cn(
        "rounded-md border bg-ink-surface p-3 transition-colors",
        highlighted ? "border-civic shadow-glow-teal" : "border-ink-subtle",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-5 text-ink-primary">
          <span className="mr-1 font-mono text-civic-periwinkle">[{index + 1}]</span>
          {item.citation}
        </p>
        <button
          type="button"
          onClick={onTogglePin}
          aria-pressed={pinned}
          aria-label={pinned ? "Unpin source" : "Pin source to ground follow-ups"}
          className={cn(
            "shrink-0 rounded p-1 transition-colors",
            pinned
              ? "bg-civic/15 text-civic"
              : "text-ink-muted hover:bg-ink-elevated hover:text-ink-primary",
          )}
        >
          {pinned ? (
            <PinOff aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <Pin aria-hidden className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-civic-periwinkle/40 bg-civic-periwinkle/10 px-2 py-0.5 text-[11px] font-medium text-civic-periwinkle">
          {SOURCE_TYPE_CHIP[item.sourceType]}
        </span>
        <StatusDot status={fresh.status} />
        <span className="font-mono text-[10px] text-ink-muted">{fresh.note}</span>
      </div>

      {/* Relevance bar */}
      <div className="mt-2">
        <div className="flex items-center justify-between font-mono text-[10px] text-ink-muted">
          <span>relevance</span>
          <span>{item.confidence.toFixed(2)}</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-inset">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(item.confidence * 100)}%` }}
            transition={{ duration: 0.4, delay: 0.1 + index * 0.05 }}
            className={cn(
              "h-full rounded-full",
              item.confidence >= 0.75
                ? "bg-status-success"
                : item.confidence >= 0.5
                  ? "bg-status-warning"
                  : "bg-status-danger",
            )}
          />
        </div>
      </div>

      {item.excerpt && (
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-secondary">
          {item.excerpt}
        </p>
      )}

      <Link
        to={link.to}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-civic hover:text-civic-strong"
      >
        {link.label}
        <ExternalLink aria-hidden className="h-3 w-3" />
      </Link>
    </motion.li>
  );
}

export default function EvidencePanel(props: EvidencePanelProps) {
  const {
    collapsed,
    onToggleCollapsed,
    tab,
    onTabChange,
    bundle,
    requestId,
    pinnedIds,
    onTogglePin,
    highlightId,
    entities,
    activeEntityFilter,
    onToggleEntityFilter,
    onExportMemo,
    canExport,
  } = props;
  const [exportNote, setExportNote] = useState(false);

  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-l border-ink-subtle bg-ink-surface py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand evidence panel"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          <PanelRightOpen aria-hidden className="h-4 w-4" />
        </button>
        <span
          aria-hidden
          className="mt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted [writing-mode:vertical-rl]"
        >
          Evidence
        </span>
      </div>
    );
  }

  return (
    <motion.aside
      aria-label="Evidence bundle and context"
      initial={false}
      animate={{ width: 360 }}
      transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-ink-subtle bg-ink-surface"
    >
      <div className="flex items-center gap-1 border-b border-ink-subtle p-2">
        <div role="tablist" aria-label="Evidence views" className="flex flex-1 gap-1">
          {(
            [
              { id: "bundle", label: `Evidence bundle (${bundle.length})` },
              { id: "context", label: "Context" },
            ] as { id: EvidenceTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={cn(
                "relative rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "text-civic"
                  : "text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary",
              )}
            >
              {t.label}
              {tab === t.id && (
                <motion.span
                  layoutId="evidence-tab-underline"
                  className="absolute inset-x-2 -bottom-[5px] h-[2px] rounded-full bg-civic"
                />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse evidence panel"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          <PanelRightClose aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {tab === "bundle" ? (
              <>
                <p className="mb-2 font-mono text-[10px] leading-4 text-ink-muted">
                  {requestId ? `request_id ${requestId} · ` : ""}
                  retrieval: hybrid (SQL+vector+graph)
                </p>
                {bundle.length === 0 ? (
                  <EmptyState
                    title="No sources retrieved"
                    guidance="Ask a question — every grounded answer lists its evidence bundle here."
                  />
                ) : (
                  <ul className="space-y-2" aria-label="Evidence sources">
                    {bundle.map((item, i) => (
                      <SourceCard
                        key={item.id}
                        item={item}
                        index={i}
                        pinned={pinnedIds.has(item.id)}
                        highlighted={highlightId === item.id}
                        onTogglePin={() => onTogglePin(item.id)}
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <section aria-labelledby="ctx-entities">
                  <h3 id="ctx-entities" className="caption-label mb-2 text-ink-muted">
                    Entities referenced
                  </h3>
                  {entities.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      Entities appear here as the conversation references
                      jurisdictions, sectors, and instruments.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {entities.map((e) => {
                        const active = activeEntityFilter === e.label;
                        return (
                          <li key={e.label}>
                            <button
                              type="button"
                              onClick={() => onToggleEntityFilter(e.label)}
                              aria-pressed={active}
                              title={`Pin ${e.label} as the entity filter for follow-ups`}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                active
                                  ? "border-civic bg-civic/15 text-civic"
                                  : "border-ink-subtle text-ink-secondary hover:border-civic/40 hover:text-ink-primary",
                              )}
                            >
                              <span className="mr-1 text-ink-muted">{e.kind}:</span>
                              {e.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {activeEntityFilter && (
                    <p className="mt-2 text-[11px] text-civic">
                      Follow-ups are scoped to “{activeEntityFilter}”.
                    </p>
                  )}
                </section>

                <section aria-labelledby="ctx-export">
                  <h3 id="ctx-export" className="caption-label mb-2 text-ink-muted">
                    Reuse
                  </h3>
                  <button
                    type="button"
                    disabled={!canExport}
                    onClick={() => {
                      onExportMemo();
                      setExportNote(true);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-transform",
                      canExport
                        ? "bg-civic text-ink-base hover:bg-civic-strong active:scale-[0.98]"
                        : "cursor-not-allowed bg-ink-elevated text-ink-muted",
                    )}
                  >
                    <FileDown aria-hidden className="h-3.5 w-3.5" />
                    Export conversation as memo section
                  </button>
                  <p className="mt-1.5 text-[11px] text-ink-muted">
                    Adds to the Brief composer with citations intact — records an
                    audit event.
                  </p>
                  {exportNote && (
                    <p role="status" className="mt-1.5 text-[11px] text-civic">
                      Memo section downloaded — citation list and request_id
                      appended.
                    </p>
                  )}
                </section>

                <section aria-labelledby="ctx-guardrail">
                  <h3 id="ctx-guardrail" className="caption-label mb-2 text-ink-muted">
                    Guardrails
                  </h3>
                  <p className="rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-xs leading-5 text-ink-secondary">
                    The copilot is read-only: it never publishes, approves, or
                    signs off. Approval and publishing route through the human
                    workflow in the Policy &amp; Legislation Workbench.
                  </p>
                </section>

                <div className="flex items-center gap-1.5 text-ink-muted">
                  <Layers aria-hidden className="h-3.5 w-3.5" />
                  <span className="font-mono text-[10px]">
                    {pinnedIds.size} source{pinnedIds.size === 1 ? "" : "s"} pinned
                    for grounding
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
