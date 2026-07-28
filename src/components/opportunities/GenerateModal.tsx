import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { unwrapData, type OpportunityItem, type SectorRow } from "./types";
import { useFocusReturn } from "@/hooks/use-focus-return";

export interface GenerateModalProps {
  open: boolean;
  onClose: () => void;
  sectors: SectorRow[];
  /** Current ranking items — the async job re-scores an existing opportunity. */
  items: OpportunityItem[];
  onSubmitted: (jobId: string) => void;
}

interface GenerateResult {
  job_id: string;
  status: string;
  deduplicated?: boolean;
}

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `gen-${crypto.randomUUID()}`
    : `gen-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Generation modal: sector, opportunity, horizon, note → async job with
 *  idempotency key. The job appears in the topbar Jobs indicator and the
 *  page polls status → toast on completion. */
export default function GenerateModal({
  open,
  onClose,
  sectors,
  items,
  onSubmitted,
}: GenerateModalProps) {
  const [sectorCode, setSectorCode] = useState<string>("");
  const [opportunityId, setOpportunityId] = useState<string>("");
  const [horizon, setHorizon] = useState<1 | 3 | 5>(3);
  const [note, setNote] = useState("");
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const closeRef = useRef<HTMLButtonElement>(null);
  // a11y: restore focus to the triggering element when the modal closes.
  useFocusReturn(open);

  // Reset form each time the modal opens.
  useEffect(() => {
    if (open) {
      setSectorCode(sectors[0]?.sectorCode ?? "");
      setOpportunityId("");
      setHorizon(3);
      setNote("");
      setIdemKey(newIdempotencyKey());
      setTimeout(() => closeRef.current?.focus(), 50);
    }
  }, [open, sectors]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const candidates = useMemo(
    () =>
      items
        .filter((o) => !sectorCode || o.sectorCode === sectorCode)
        .sort((a, b) => b.score - a.score),
    [items, sectorCode],
  );

  // Default to the top-ranked opportunity of the chosen sector.
  useEffect(() => {
    if (candidates.length > 0 && !candidates.some((c) => c.opportunityId === opportunityId)) {
      setOpportunityId(candidates[0].opportunityId);
    }
  }, [candidates, opportunityId]);

  const generate = trpc.opportunities.generate.useMutation({
    onSuccess: (payload) => {
      const res = unwrapData<GenerateResult>(payload);
      if (!res) return;
      if (res.deduplicated) {
        toast.info("A matching generation job already exists — reusing it.", {
          description: `Job ${res.job_id}`,
        });
      } else {
        toast.success("Opportunity generation queued.", {
          description: `Job ${res.job_id} · you will be notified on completion.`,
        });
      }
      onSubmitted(res.job_id);
      onClose();
    },
    onError: (err) => {
      toast.error("Generation request failed.", { description: err.message });
    },
  });

  const submit = () => {
    if (!opportunityId || generate.isPending) return;
    generate.mutate({
      opportunity_id: opportunityId,
      idempotency_key: idemKey,
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="gen-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.6)]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="gen-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Generate opportunities"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-ink-subtle bg-ink-elevated shadow-overlay"
          >
            <header className="flex items-start justify-between gap-3 border-b border-ink-subtle p-4">
              <div>
                <p className="caption-label text-ink-muted">Async analysis</p>
                <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-ink-primary">
                  <Sparkles aria-hidden className="h-4 w-4 text-civic" />
                  Generate opportunities
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close generation modal"
                className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-surface hover:text-ink-primary"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-4 p-4">
              <p className="rounded-md border border-status-info/30 bg-status-info/10 px-3 py-2 text-[13px] leading-5 text-ink-secondary">
                Generation runs asynchronously against the scoring model.
                Typical run: <span className="font-medium text-ink-primary">4–8 minutes</span> —
                track progress in the Jobs indicator; you will be notified and
                the ranking list refreshes on completion.
              </p>

              <label className="block">
                <span className="caption-label text-ink-muted">Sector</span>
                <select
                  value={sectorCode}
                  onChange={(e) => setSectorCode(e.target.value)}
                  className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-surface px-2.5 py-2 text-sm text-ink-primary"
                >
                  {sectors.map((s) => (
                    <option key={s.sectorCode} value={s.sectorCode}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="caption-label text-ink-muted">
                  Opportunity to re-score
                </span>
                <select
                  value={opportunityId}
                  onChange={(e) => setOpportunityId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-surface px-2.5 py-2 text-sm text-ink-primary"
                >
                  {candidates.length === 0 && (
                    <option value="">No opportunities in this sector yet</option>
                  )}
                  {candidates.map((o) => (
                    <option key={o.opportunityId} value={o.opportunityId}>
                      {o.title} · score {o.score.toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend className="caption-label text-ink-muted">Horizon</legend>
                <div className="mt-1 flex gap-1.5">
                  {([1, 3, 5] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={horizon === h}
                      onClick={() => setHorizon(h)}
                      className={
                        horizon === h
                          ? "rounded-full border border-civic bg-civic/10 px-3 py-1 text-xs font-medium text-civic"
                          : "rounded-full border border-ink-subtle bg-ink-surface px-3 py-1 text-xs font-medium text-ink-secondary hover:border-ink-strong"
                      }
                    >
                      {h}-yr
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="caption-label text-ink-muted">
                  Analyst note (optional)
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={280}
                  placeholder="Context for this run, e.g. refresh after new NBS labour-force release…"
                  className="mt-1 w-full resize-none rounded-md border border-ink-subtle bg-ink-surface px-2.5 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
                />
              </label>

              <div className="flex items-center justify-between gap-2 rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2">
                <div className="min-w-0">
                  <p className="caption-label text-[10px] text-ink-muted">
                    Idempotency key
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink-secondary">
                    {idemKey}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIdemKey(newIdempotencyKey())}
                  aria-label="Regenerate idempotency key"
                  title="Regenerate idempotency key"
                  className="shrink-0 rounded-md p-1.5 text-ink-muted hover:bg-ink-surface hover:text-ink-primary"
                >
                  <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-ink-subtle p-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-sm font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!opportunityId || generate.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-civic px-3.5 py-1.5 text-sm font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles aria-hidden className="h-4 w-4" />
                {generate.isPending ? "Submitting…" : "Queue generation job"}
              </button>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
