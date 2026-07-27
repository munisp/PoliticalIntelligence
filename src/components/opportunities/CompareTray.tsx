import { motion, AnimatePresence } from "framer-motion";
import { X, GitCompareArrows } from "lucide-react";
import type { OpportunityItem } from "./types";
import { sectorColor } from "./RankingRow";

export interface CompareTrayProps {
  items: OpportunityItem[];
  onRemove: (id: string) => void;
  onCompareNow: () => void;
  onClear: () => void;
}

/** Bottom compare tray (64px): pinned mini-cards + "Compare now →". */
export default function CompareTray({
  items,
  onRemove,
  onCompareNow,
  onClear,
}: CompareTrayProps) {
  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          initial={{ y: 88, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 88, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
          role="region"
          aria-label={`Compare tray, ${items.length} of 3 slots used`}
          className="fixed inset-x-0 bottom-16 z-30 border-t border-ink-subtle bg-ink-elevated/95 backdrop-blur lg:bottom-0"
        >
          <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 lg:px-8">
            <span className="caption-label hidden shrink-0 text-ink-muted sm:inline">
              Compare ({items.length}/3)
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              <AnimatePresence initial={false}>
                {items.map((o) => (
                  <motion.span
                    key={o.opportunityId}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.16 }}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-ink-subtle bg-ink-surface py-1 pl-3 pr-1.5"
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: sectorColor(o.sectorCode) }}
                    />
                    <span className="max-w-44 truncate text-xs font-medium text-ink-primary">
                      {o.title}
                    </span>
                    <span className="font-mono text-[11px] text-ink-muted">
                      {o.score.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(o.opportunityId)}
                      aria-label={`Remove ${o.title} from compare`}
                      className="rounded-full p-0.5 text-ink-muted hover:bg-ink-elevated hover:text-ink-primary"
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-xs font-medium text-ink-muted hover:text-ink-primary"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onCompareNow}
              disabled={items.length < 2}
              title={
                items.length < 2
                  ? "Select at least 2 opportunities to compare"
                  : "Open side-by-side comparison"
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-xs font-medium text-ink-base transition-all hover:bg-civic-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitCompareArrows aria-hidden className="h-3.5 w-3.5" />
              Compare now →
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
