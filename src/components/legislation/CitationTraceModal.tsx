import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, FileScan, GitBranch, Landmark, Quote, ScrollText, X } from "lucide-react";
import type { ClauseDetail, LawDetail } from "./types";
import { RELATION_LABELS } from "./types";

export interface CitationTraceModalProps {
  open: boolean;
  onClose: () => void;
  clause: ClauseDetail | null;
  law: LawDetail | null;
  requestId: string | null;
}

interface ChainNode {
  key: string;
  eyebrow: string;
  title: string;
  detail: string;
  mono?: string;
  Icon: typeof Quote;
  edgeIn?: string; // transform label on the edge from the previous node
}

/**
 * Full-screen citation trace: horizontal provenance chain
 * clause → supporting clauses → source instrument → ingestion → original scan.
 */
export default function CitationTraceModal({
  open,
  onClose,
  clause,
  law,
  requestId,
}: CitationTraceModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const outbound = clause?.citation_trace.outbound ?? [];
  const nodes: ChainNode[] = clause
    ? [
        {
          key: "clause",
          eyebrow: "Selected clause",
          title: `Section ${clause.sectionPath}`,
          detail: clause.text.slice(0, 160),
          mono: clause.clauseId,
          Icon: Quote,
        },
        {
          key: "supports",
          eyebrow: "Supporting clauses",
          title: `${outbound.length} outbound citation${outbound.length === 1 ? "" : "s"}`,
          detail:
            outbound.length > 0
              ? outbound
                  .slice(0, 4)
                  .map(
                    (e) =>
                      `${e.toClauseId} (${RELATION_LABELS[e.relation] ?? e.relation})`,
                  )
                  .join(" · ")
              : "No outbound citations recorded for this clause.",
          Icon: GitBranch,
          edgeIn: "retrieved via legal graph",
        },
        {
          key: "instrument",
          eyebrow: "Source instrument",
          title: law?.title ?? clause.lawId,
          detail: law
            ? `${law.category ?? "legislation"} · ${law.year ?? "n.d."} · status ${law.status.replace(/_/g, " ")}`
            : "Instrument record",
          mono: clause.lawId,
          Icon: Landmark,
          edgeIn: "parsed by LexNLP v1.3",
        },
        {
          key: "ingestion",
          eyebrow: "Ingestion job",
          title: "documents.register → clause extraction",
          detail: `OCR + NLP pipeline · extraction confidence ${clause.confidence.toFixed(2)} · review state ${clause.reviewState.replace(/_/g, " ")}`,
          Icon: FileScan,
          edgeIn: "embedded qwen3-emb",
        },
        {
          key: "scan",
          eyebrow: "Original document",
          title: law?.sourceUri ? "Source scan on record" : "Scan in document store",
          detail: law?.sourceUri ?? "Original scan reference unavailable — see Documents library.",
          mono: law?.sourceUri ? undefined : "source_uri: not indexed",
          Icon: ScrollText,
          edgeIn: "ingested from source",
        },
      ]
    : [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Citation trace"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
          className="fixed inset-0 z-50 flex flex-col bg-ink-base/95 p-6 backdrop-blur-sm md:p-10"
        >
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="caption-label text-ink-muted">Provenance chain</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
                Citation trace
              </h2>
              <p className="mt-1 text-[13px] text-ink-secondary">
                {clause
                  ? `How Section ${clause.sectionPath} grounds platform outputs — from clause to original scan.`
                  : "Select a clause to trace its provenance."}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close citation trace"
              className="rounded-md p-2 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
          </header>

          <div className="mt-8 flex-1 overflow-x-auto overflow-y-hidden">
            {nodes.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No clause selected — open the trace from a clause in the reader.
              </p>
            ) : (
              <ol className="flex min-w-max items-stretch gap-0 pb-4" aria-label="Provenance chain">
                {nodes.map((node, i) => (
                  <li key={node.key} className="flex items-center">
                    {i > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scaleX: 0 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        transition={{ delay: 0.1 + i * 0.06, duration: 0.4 }}
                        className="flex w-28 origin-left flex-col items-center gap-1 px-2"
                        aria-hidden
                      >
                        <span className="whitespace-nowrap font-mono text-[10px] text-civic-periwinkle">
                          {node.edgeIn}
                        </span>
                        <span className="flex w-full items-center">
                          <span className="h-px flex-1 bg-civic-periwinkle/50" />
                          <ArrowRight className="h-3.5 w-3.5 text-civic-periwinkle" />
                        </span>
                      </motion.div>
                    )}
                    <motion.article
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: i * 0.06, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      className="w-64 rounded-[10px] border border-ink-subtle bg-ink-surface p-4"
                    >
                      <p className="caption-label flex items-center gap-1.5 text-civic">
                        <node.Icon aria-hidden className="h-3.5 w-3.5" />
                        {node.eyebrow}
                      </p>
                      <h3 className="mt-2 text-sm font-semibold text-ink-primary">
                        {node.title}
                      </h3>
                      <p className="mt-1 line-clamp-4 text-xs leading-5 text-ink-secondary">
                        {node.detail}
                      </p>
                      {node.mono && (
                        <p className="mt-2 truncate font-mono text-[10px] text-ink-muted">
                          {node.mono}
                        </p>
                      )}
                    </motion.article>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <footer className="border-t border-ink-subtle pt-3 font-mono text-[11px] text-ink-muted">
            Generated {new Date().toISOString()}
            {requestId && <> · request_id {requestId}</>} · Approval state{" "}
            {clause ? clause.reviewState.replace(/_/g, " ") : "—"}
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
