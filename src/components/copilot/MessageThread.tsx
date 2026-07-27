import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  Layers,
  Scale,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import ConfidenceChip from "@/components/shared/ConfidenceChip";
import type { AnswerMeta, ChatMessage, EvidenceItem } from "./types";
import { modelTierLabel, SOURCE_TYPE_LABELS } from "./types";

/* ---------------------------------------------------------------- */
/* Inline citation marker with popover                               */
/* ---------------------------------------------------------------- */

function CitationMarker({
  index,
  item,
  onPin,
}: {
  index: number;
  item: EvidenceItem | undefined;
  onPin: (item: EvidenceItem) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!item) return <span className="text-civic-periwinkle">[{index}]</span>;
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => onPin(item)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`Citation ${index}: ${item.citation}. Activate to pin in evidence panel.`}
        className="align-super font-mono text-[11px] font-medium text-civic-periwinkle hover:text-civic"
      >
        [{index}]
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-full z-40 mt-1.5 block w-72 rounded-md border border-ink-subtle bg-ink-elevated p-3 text-left shadow-overlay"
          >
            <span className="caption-label block text-civic-periwinkle">
              Source {index} · {SOURCE_TYPE_LABELS[item.sourceType]} retrieval
            </span>
            <span className="mt-1 block text-[13px] font-medium leading-5 text-ink-primary">
              {item.citation}
            </span>
            <span className="mt-1 block font-mono text-[11px] text-ink-muted">
              relevance {item.confidence.toFixed(2)}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Render answer prose with [n] citation markers wired to the bundle. */
function AnswerBody({
  content,
  evidence,
  onPin,
}: {
  content: string;
  evidence: EvidenceItem[];
  onPin: (item: EvidenceItem) => void;
}) {
  const parts = useMemo(() => content.split(/(\[\d+\])/g), [content]);
  return (
    <p className="whitespace-pre-wrap text-sm leading-[22px] text-ink-primary">
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const n = Number(m[1]);
        return (
          <CitationMarker
            key={i}
            index={n}
            item={evidence[n - 1]}
            onPin={onPin}
          />
        );
      })}
    </p>
  );
}

/* ---------------------------------------------------------------- */
/* Uncertainty banner                                                */
/* ---------------------------------------------------------------- */

function UncertaintyBanner({ answer }: { answer: AnswerMeta }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const u = answer.uncertainty;
  const factors = [
    u.lowConfidenceSources > 0
      ? `${u.lowConfidenceSources} of ${u.totalSources} sources have low confidence or are stale`
      : null,
    u.modelAgreement < 0.6
      ? `Model agreement is low (${u.modelAgreement.toFixed(2)})`
      : null,
    u.fallbackEngine
      ? "Answer assembled by the offline fallback engine — connect the AI service for full synthesis"
      : null,
    u.totalSources === 0 ? "No grounded evidence was retrieved in scope" : null,
  ].filter(Boolean) as string[];

  return (
    <div
      role="alert"
      className="mb-3 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2"
    >
      <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-status-warning">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
        Low certainty — treat this answer as directional only.
        <button
          type="button"
          onClick={() => setWhyOpen((v) => !v)}
          aria-expanded={whyOpen}
          className="inline-flex items-center gap-0.5 rounded border border-status-warning/40 px-1.5 py-0.5 text-xs hover:bg-status-warning/10"
        >
          Why?
          <ChevronDown
            aria-hidden
            className={cn("h-3 w-3 transition-transform", whyOpen && "rotate-180")}
          />
        </button>
      </p>
      <AnimatePresence>
        {whyOpen && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="ml-6 mt-1.5 list-disc space-y-0.5 overflow-hidden text-xs text-status-warning/90"
          >
            {factors.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Answer footer strip (signature element)                           */
/* ---------------------------------------------------------------- */

function AnswerFooter({
  answer,
  onOpenBundle,
  onFeedback,
}: {
  answer: AnswerMeta;
  onOpenBundle: () => void;
  onFeedback: (v: "up" | "down") => void;
}) {
  const counts = useMemo(() => {
    const c = { sql: 0, vector: 0, graph: 0, document: 0 };
    for (const e of answer.evidence) c[e.sourceType] += 1;
    return c;
  }, [answer.evidence]);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-subtle pt-2.5">
      <ConfidenceChip
        score={answer.confidence}
        evidenceCount={answer.evidence.length}
        modelAgreement={answer.uncertainty.modelAgreement}
      />
      <span className="font-mono text-[11px] text-ink-muted">
        SQL {counts.sql} · Vector {counts.vector} · Graph {counts.graph}
        {counts.document > 0 && ` · Docs ${counts.document}`}
      </span>
      <span className="rounded-full border border-ink-subtle px-2 py-0.5 font-mono text-[11px] text-civic-periwinkle">
        {modelTierLabel(answer.bridge, answer.deepAnalysis)}
      </span>
      <button
        type="button"
        onClick={onOpenBundle}
        className="inline-flex items-center gap-1 rounded-md border border-civic/40 px-2 py-0.5 text-xs font-medium text-civic hover:bg-civic/10"
      >
        <Layers aria-hidden className="h-3 w-3" />
        Evidence bundle ({answer.evidence.length})
      </button>
      <span className="ml-auto inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onFeedback("up")}
          aria-label="Mark answer helpful — records an audit event"
          aria-pressed={answer.feedback === "up"}
          className={cn(
            "rounded p-1 transition-colors",
            answer.feedback === "up"
              ? "bg-civic/15 text-civic"
              : "text-ink-muted hover:bg-ink-elevated hover:text-ink-primary",
          )}
        >
          <ThumbsUp aria-hidden className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onFeedback("down")}
          aria-label="Mark answer not helpful — records an audit event"
          aria-pressed={answer.feedback === "down"}
          className={cn(
            "rounded p-1 transition-colors",
            answer.feedback === "down"
              ? "bg-status-danger/15 text-status-danger"
              : "text-ink-muted hover:bg-ink-elevated hover:text-ink-primary",
          )}
        >
          <ThumbsDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Message thread                                                    */
/* ---------------------------------------------------------------- */

export interface MessageThreadProps {
  messages: ChatMessage[];
  phaseCaption: string | null;
  onPinSource: (item: EvidenceItem) => void;
  onOpenBundle: (messageId: string) => void;
  onFeedback: (messageId: string, v: "up" | "down") => void;
}

export default function MessageThread({
  messages,
  phaseCaption,
  onPinSource,
  onOpenBundle,
  onFeedback,
}: MessageThreadProps) {
  return (
    <ol className="space-y-6" aria-label="Conversation thread" aria-live="polite">
      {messages.map((m) => (
        <motion.li
          key={m.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(m.role === "user" && "flex justify-end")}
        >
          {m.role === "user" ? (
            <div className="max-w-[70%] rounded-md bg-ink-elevated px-4 py-2.5">
              <p className="whitespace-pre-wrap text-sm leading-[22px] text-ink-primary">
                {m.content}
              </p>
              <p className="mt-1 text-right font-mono text-[10px] text-ink-muted">
                {new Date(m.createdAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ) : m.refusal ? (
            /* Guardrail refusal-pattern card */
            <div className="max-w-[85%] rounded-md border border-gold/40 bg-gold/5 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-gold">
                <Ban aria-hidden className="h-4 w-4" />
                I can&apos;t approve outputs
              </p>
              <p className="mt-1.5 text-sm leading-[22px] text-ink-primary">
                {m.content}
              </p>
              <Link
                to="/legislation"
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-gold/50 px-2.5 py-1 text-xs font-medium text-gold hover:bg-gold/10"
              >
                <Scale aria-hidden className="h-3.5 w-3.5" />
                Open the approval workflow in the Workbench →
              </Link>
            </div>
          ) : (
            /* Assistant answer — document-style block, no bubble */
            <article className="max-w-full">
              {m.streaming ? (
                <div className="mb-3">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={phaseCaption ?? "thinking"}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="text-[13px] font-medium text-civic"
                    >
                      {phaseCaption ?? "Assembling answer…"}
                    </motion.p>
                  </AnimatePresence>
                  <span
                    aria-hidden
                    className="mt-1.5 block h-px w-full origin-left animate-pulse bg-civic/60"
                  />
                </div>
              ) : (
                m.answer &&
                (m.answer.confidence < 0.5 || m.answer.bridge === "fallback") && (
                  <UncertaintyBanner answer={m.answer} />
                )
              )}

              {m.content && (
                <AnswerBody
                  content={m.content}
                  evidence={m.answer?.evidence ?? []}
                  onPin={onPinSource}
                />
              )}

              {!m.streaming && m.answer && (
                <AnswerFooter
                  answer={m.answer}
                  onOpenBundle={() => onOpenBundle(m.id)}
                  onFeedback={(v) => onFeedback(m.id, v)}
                />
              )}

              {!m.streaming && m.answer?.requestId && (
                <p className="mt-1.5 font-mono text-[10px] text-ink-muted">
                  request_id {m.answer.requestId}
                </p>
              )}
            </article>
          )}
        </motion.li>
      ))}
    </ol>
  );
}
