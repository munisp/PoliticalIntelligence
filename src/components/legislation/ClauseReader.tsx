import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BookOpenText,
  FilePlus2,
  Flag,
  GitBranch,
  Link2,
  MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ApprovalBadge from "@/components/shared/ApprovalBadge";
import ConfidenceChip from "@/components/shared/ConfidenceChip";
import EmptyState from "@/components/shared/EmptyState";
import type { ClauseRow, LawDetail } from "./types";
import { toApprovalState } from "./types";

export type ClauseAction = "cite" | "trace" | "draft" | "flag" | "copilot";

export interface CrossRef {
  targetClauseId: string;
  section: string;
  text: string;
  relation: string;
}

export interface ClauseReaderProps {
  law: LawDetail | null;
  clauses: ClauseRow[];
  loading: boolean;
  activeClauseId: string | null;
  onActivate: (clauseId: string) => void;
  /** Clause ids referenced by the active clause's dependency graph. */
  relatedIds: ReadonlySet<string>;
  /** Outbound cross-references for the active clause. */
  crossRefs: CrossRef[];
  onAction: (action: ClauseAction, clauseId: string) => void;
}

const TOOLBAR: { action: ClauseAction; label: string; Icon: typeof Link2 }[] = [
  { action: "cite", label: "Cite", Icon: Link2 },
  { action: "trace", label: "Trace dependencies", Icon: GitBranch },
  { action: "draft", label: "Add to draft", Icon: FilePlus2 },
  { action: "flag", label: "Flag for review", Icon: Flag },
  { action: "copilot", label: "Ask Copilot", Icon: MessageSquareText },
];

function instrumentNumber(lawId: string, year: number | null): string {
  const parts = lawId.replace(/^law:/, "").split(":");
  const stem = (parts[parts.length - 1] ?? "instrument")
    .replace(/-/g, "/")
    .toUpperCase();
  return `${parts[0]?.toUpperCase() ?? "NG"}/${stem}${year ? `/${year}` : ""}`;
}

function issuer(jurisdictionId: string): string {
  if (jurisdictionId.endsWith(":ng-kd")) return "Kaduna State Government";
  if (jurisdictionId.endsWith(":ng")) return "Federal Republic of Nigeria";
  return jurisdictionId;
}

/** Cross-reference link with hover popover showing the referenced clause. */
function CrossRefLink({ xref }: { xref: CrossRef }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`Cross-reference ${xref.section}: show referenced clause`}
        className="border-b border-dashed border-civic-periwinkle/70 font-medium text-civic-periwinkle"
      >
        {xref.section}
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-full z-40 mt-2 block w-[300px] rounded-md border border-ink-subtle bg-ink-elevated p-3 shadow-overlay"
          >
            <span className="caption-label block text-civic-periwinkle">
              {xref.relation} · {xref.section}
            </span>
            <span className="mt-1.5 block font-serif text-[13px] leading-5 text-ink-primary">
              {xref.text}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Clause toolbar shown for the active clause. */
function ClauseToolbar({
  clauseId,
  onAction,
}: {
  clauseId: string;
  onAction: (action: ClauseAction, clauseId: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.18 }}
      className="mt-3 flex flex-wrap items-center gap-1.5"
      role="toolbar"
      aria-label="Clause actions"
    >
      {TOOLBAR.map(({ action, label, Icon }) => (
        <button
          key={action}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction(action, clauseId);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-ink-subtle bg-ink-surface px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:border-civic/50 hover:text-civic"
        >
          <Icon aria-hidden className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </motion.div>
  );
}

/** Pane B — the clause reader (serif document register). */
export default function ClauseReader({
  law,
  clauses,
  loading,
  activeClauseId,
  onActivate,
  relatedIds,
  crossRefs,
  onAction,
}: ClauseReaderProps) {
  const itemRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!activeClauseId) return;
    itemRefs.current
      .get(activeClauseId)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeClauseId]);

  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading clauses"
        className="flex-1 space-y-4 overflow-y-auto bg-ink-surface p-8"
      >
        <div className="skeleton-shimmer h-7 w-2/3" />
        <div className="skeleton-shimmer h-3 w-1/3" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!law) {
    return (
      <div className="flex flex-1 items-center justify-center bg-ink-surface p-8">
        <EmptyState
          title="Select an instrument"
          guidance="Choose a law, act, or regulation from the navigator to read its clauses and trace dependencies."
          Icon={BookOpenText}
          showSpotArt={false}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-ink-surface">
      {/* Instrument title-page header */}
      <header className="border-b border-ink-subtle px-8 pb-6 pt-7">
        <p className="caption-label text-ink-muted">
          {issuer(law.jurisdictionId)}
        </p>
        <h1 className="mt-1 font-serif text-[26px] font-semibold leading-8 text-ink-primary">
          {law.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-secondary">
          <span className="font-mono">
            Instrument № {instrumentNumber(law.lawId, law.year)}
          </span>
          {law.year && <span>Commenced {law.year}</span>}
          <span className="font-mono">{law.clause_count} clauses indexed</span>
          {/* Version selector — single consolidated version in the corpus */}
          <label className="ml-auto inline-flex items-center gap-1.5">
            <span className="caption-label text-ink-muted">Version</span>
            <select
              aria-label="Instrument version"
              className="rounded-md border border-ink-subtle bg-ink-inset px-2 py-1 text-xs text-ink-primary"
              defaultValue="consolidated"
            >
              <option value="consolidated">Consolidated · in force</option>
            </select>
          </label>
        </div>
      </header>

      {/* Clause blocks */}
      <ol className="px-8 py-6" aria-label={`Clauses of ${law.title}`}>
        {clauses.map((clause) => {
          const active = clause.clauseId === activeClauseId;
          const related = relatedIds.has(clause.clauseId);
          const unverified = clause.confidence < 0.75;
          return (
            <li key={clause.clauseId}>
              <article
                ref={(el) => {
                  if (el) itemRefs.current.set(clause.clauseId, el);
                  else itemRefs.current.delete(clause.clauseId);
                }}
                tabIndex={0}
                onClick={() => onActivate(clause.clauseId)}
                onFocus={() => onActivate(clause.clauseId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onActivate(clause.clauseId);
                }}
                aria-label={`Clause ${clause.sectionPath}`}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "relative mb-3 cursor-pointer rounded-md border border-transparent border-l-[3px] px-4 py-3 transition-colors",
                  active
                    ? "border-civic border-l-civic bg-ink-elevated"
                    : related
                      ? "border-l-civic-periwinkle/60 hover:bg-ink-elevated/50"
                      : "border-l-transparent hover:bg-ink-elevated/50",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    className={cn(
                      "font-serif text-[15px] font-semibold text-ink-primary",
                      related &&
                        !active &&
                        "underline decoration-civic-periwinkle/60 decoration-dotted underline-offset-4",
                    )}
                  >
                    Section {clause.sectionPath}
                  </h2>
                  <ConfidenceChip score={clause.confidence} />
                  <ApprovalBadge state={toApprovalState(clause.reviewState)} />
                  {unverified && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-status-warning/40 bg-status-warning/10 px-2 py-0.5 text-xs font-medium text-status-warning">
                      <AlertTriangle aria-hidden className="h-3 w-3" />
                      Unverified
                    </span>
                  )}
                </div>

                {active && unverified && (
                  <p
                    role="alert"
                    className="mt-2 flex items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-1.5 text-xs font-medium text-status-warning"
                  >
                    <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    Extraction pending — QA review required before this clause can be cited.
                  </p>
                )}

                <p className="font-document mt-2 text-ink-primary">{clause.text}</p>

                {active && crossRefs.length > 0 && (
                  <p className="mt-2 text-[13px] text-ink-secondary">
                    Cross-references:{" "}
                    {crossRefs.map((xr, i) => (
                      <span key={xr.targetClauseId}>
                        {i > 0 && ", "}
                        <CrossRefLink xref={xr} />
                      </span>
                    ))}
                  </p>
                )}

                <AnimatePresence>
                  {active && (
                    <ClauseToolbar clauseId={clause.clauseId} onAction={onAction} />
                  )}
                </AnimatePresence>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
