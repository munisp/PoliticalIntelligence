import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, FileText, Database, ExternalLink, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusDot, { type StatusKind } from "./StatusDot";
import { useT } from "@/lib/LocaleContext";
import { useFocusReturn } from "@/hooks/use-focus-return";

export interface EvidenceSource {
  id: string;
  title: string;
  issuer: string;
  date: string;
  /** 0–1 relevance score. */
  relevance: number;
  url?: string;
}

export interface EvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  sources: EvidenceSource[];
  /** Clause excerpts tied to the cited sources. */
  excerpts?: { sourceId?: string; text: string }[];
  /** Dataset freshness status. */
  freshness?: { status: StatusKind; label: string };
  /** tRPC envelope request id, shown for traceability. */
  requestId?: string;
  onOpenDocument?: (source: EvidenceSource) => void;
}

/**
 * Right drawer (480px) with cited sources, clause excerpts, lineage mini-view
 * and dataset freshness. ESC / backdrop close; focus moves into drawer.
 */
export default function EvidenceDrawer({
  open,
  onClose,
  title,
  sources,
  excerpts,
  freshness,
  requestId,
  onOpenDocument,
}: EvidenceDrawerProps) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  // a11y: restore focus to the triggering element when the drawer closes.
  useFocusReturn(open);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.6)]"
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Evidence for ${title}`}
            initial={{ x: 480 + 24 }}
            animate={{ x: 0 }}
            exit={{ x: 480 + 24 }}
            transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
            className={cn(
              "fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col",
              "border-l border-ink-subtle bg-ink-elevated shadow-overlay",
            )}
          >
            <header className="flex items-start justify-between gap-3 border-b border-ink-subtle p-4">
              <div>
                <p className="caption-label text-ink-muted">{t.evidence.caption}</p>
                <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                  {title}
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label={t.evidence.close}
                className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-surface hover:text-ink-primary"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              <section aria-labelledby="evidence-sources">
                <h3
                  id="evidence-sources"
                  className="caption-label flex items-center gap-1.5 text-ink-muted"
                >
                  <FileText aria-hidden className="h-3.5 w-3.5" />
                  {t.evidence.citedSources.replace("{count}", String(sources.length))}
                </h3>
                <ul className="mt-2 space-y-2">
                  {sources.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-md border border-ink-subtle bg-ink-surface p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-ink-primary">
                          {s.title}
                        </p>
                        <span className="shrink-0 font-mono text-xs text-civic">
                          {s.relevance.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-secondary">
                        {s.issuer} · {s.date}
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <span
                          className="h-1 flex-1 rounded-full bg-ink-inset"
                          aria-hidden
                        >
                          <span
                            className="block h-1 rounded-full bg-civic"
                            style={{ width: `${Math.round(s.relevance * 100)}%` }}
                          />
                        </span>
                        {(onOpenDocument || s.url) && (
                          <button
                            type="button"
                            onClick={() => onOpenDocument?.(s)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-civic hover:text-civic-strong"
                          >
                            <ExternalLink aria-hidden className="h-3 w-3" />
                            {t.evidence.openDocument}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {excerpts && excerpts.length > 0 && (
                <section aria-labelledby="evidence-excerpts" className="mt-5">
                  <h3
                    id="evidence-excerpts"
                    className="caption-label text-ink-muted"
                  >
                    {t.evidence.excerpts}
                  </h3>
                  <div className="mt-2 space-y-2">
                    {excerpts.map((ex, i) => (
                      <blockquote
                        key={i}
                        className="border-l-2 border-civic bg-ink-inset p-3 font-serif text-[15px] leading-[26px] text-ink-secondary"
                      >
                        {ex.text}
                      </blockquote>
                    ))}
                  </div>
                </section>
              )}

              <section aria-labelledby="evidence-lineage" className="mt-5">
                <h3
                  id="evidence-lineage"
                  className="caption-label flex items-center gap-1.5 text-ink-muted"
                >
                  <GitBranch aria-hidden className="h-3.5 w-3.5" />
                  {t.evidence.lineage}
                </h3>
                <div className="mt-2 flex items-center gap-1.5 overflow-x-auto rounded-md border border-ink-subtle bg-ink-inset p-3">
                  {[t.evidence.stepSource, t.evidence.stepIngest, t.evidence.stepModel, t.evidence.stepReview, t.evidence.stepOutput].map(
                    (step, i, arr) => (
                      <span key={step} className="flex items-center gap-1.5">
                        <span className="whitespace-nowrap rounded-full border border-ink-strong px-2 py-0.5 font-mono text-[11px] text-ink-secondary">
                          {step}
                        </span>
                        {i < arr.length - 1 && (
                          <span aria-hidden className="text-ink-muted">
                            →
                          </span>
                        )}
                      </span>
                    ),
                  )}
                </div>
              </section>

              {freshness && (
                <section aria-labelledby="evidence-freshness" className="mt-5">
                  <h3
                    id="evidence-freshness"
                    className="caption-label flex items-center gap-1.5 text-ink-muted"
                  >
                    <Database aria-hidden className="h-3.5 w-3.5" />
                    {t.evidence.freshness}
                  </h3>
                  <div className="mt-2 flex items-center justify-between rounded-md border border-ink-subtle bg-ink-surface p-3">
                    <span className="text-sm text-ink-secondary">
                      {freshness.label}
                    </span>
                    <StatusDot status={freshness.status} />
                  </div>
                </section>
              )}
            </div>

            {requestId && (
              <footer className="border-t border-ink-subtle p-3">
                <p className="font-mono text-xs text-ink-muted">
                  {t.evidence.requestId} {requestId}
                </p>
              </footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
