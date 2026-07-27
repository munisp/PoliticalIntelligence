import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Stamp } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import {
  ApprovalHandoffCard,
  EmptyState,
  type ApprovalState,
} from "@/components/shared";
import { approvalStateLabel } from "@/lib/trpc-data";
import { fmtDate } from "./utils";

export interface ApprovalItem {
  briefId: string;
  title: string;
  /** DB snake_case review state. */
  reviewState: string;
  updatedAt: Date | string;
  summary?: string;
}

interface HandoffRowProps {
  item: ApprovalItem;
  canAct: boolean;
  disabledReason?: string;
  approverName: string;
  onDone: (briefId: string) => void;
}

function HandoffRow({
  item,
  canAct,
  disabledReason,
  approverName,
  onDone,
}: HandoffRowProps) {
  const utils = trpc.useUtils();
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = async () => {
    await Promise.all([
      utils.briefs.list.invalidate(),
      utils.briefs.get.invalidate({ brief_id: item.briefId }),
    ]);
  };

  const onSuccess = async () => {
    // Gold seal stamp micro-animation, then the card collapses out.
    setSealing(true);
    await invalidate();
    window.setTimeout(() => onDone(item.briefId), 640);
  };
  const onError = (e: { message: string }) => setError(e.message);

  const approveMut = trpc.briefs.approve.useMutation({ onSuccess, onError });
  const signOffMut = trpc.briefs.signOff.useMutation({ onSuccess, onError });
  const returnMut = trpc.briefs.return.useMutation({ onSuccess, onError });

  const busy =
    approveMut.isPending || signOffMut.isPending || returnMut.isPending;

  const state = approvalStateLabel(item.reviewState) as ApprovalState;
  const awaitingSignOff = item.reviewState === "approved";

  return (
    <motion.div
      layout="position"
      exit={{ height: 0, opacity: 0, marginBottom: 0 }}
      transition={{ duration: 0.32, ease: [0.7, 0, 0.84, 0] }}
      className="relative overflow-hidden"
    >
      <ApprovalHandoffCard
        title={item.title}
        summary={
          item.summary ??
          `Updated ${fmtDate(item.updatedAt)} · ${
            awaitingSignOff ? "awaiting executive sign-off" : "in review"
          }`
        }
        state={state}
        nextApprover={{
          name: approverName,
          role: awaitingSignOff ? "Executive sign-off" : "Executive approval",
        }}
        canAct={canAct && !busy}
        disabledReason={disabledReason}
        onApprove={(comment) => {
          setError(null);
          if (awaitingSignOff)
            signOffMut.mutate({ brief_id: item.briefId, comment: comment || undefined });
          else
            approveMut.mutate({ brief_id: item.briefId, comment: comment || undefined });
        }}
        onReturn={(comment) => {
          setError(null);
          if (!comment.trim()) {
            setError("A comment is required to return an item.");
            return;
          }
          returnMut.mutate({ brief_id: item.briefId, comment });
        }}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-status-danger">
          {error}
        </p>
      )}
      <AnimatePresence>
        {sealing && (
          <motion.div
            key="seal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-ink-base/60 backdrop-blur-[1px]"
            aria-hidden
          >
            <motion.span
              initial={{ scale: 0.8 }}
              animate={{ scale: [0.8, 1.15, 1] }}
              transition={{
                duration: 0.24,
                times: [0, 0.6, 1],
                ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
              }}
              className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold bg-gold/15"
            >
              <Stamp className="h-7 w-7 text-gold" />
              <motion.span
                initial={{ opacity: 0.8, scale: 1 }}
                animate={{ opacity: 0, scale: 1.6 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="absolute inset-0 rounded-full border border-gold"
              />
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export interface ApprovalsColumnProps {
  items: ApprovalItem[];
  total: number;
  canAct: boolean;
  disabledReason?: string;
  approverName: string;
  className?: string;
}

/** "Awaiting your sign-off" — ApprovalHandoffCard stack (max 3 + view all). */
export default function ApprovalsColumn({
  items,
  total,
  canAct,
  disabledReason,
  approverName,
  className,
}: ApprovalsColumnProps) {
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !doneIds.has(i.briefId)).slice(0, 3);

  return (
    <section
      id="approvals"
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
      aria-labelledby="approvals-title"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="approvals-title" className="text-lg font-semibold text-ink-primary">
          Awaiting your sign-off
        </h2>
        {total > 0 && (
          <span className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 font-mono text-xs text-gold">
            {total}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {visible.map((item, i) => (
            <motion.div
              key={item.briefId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: i * 0.07,
                duration: 0.24,
                ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
              }}
            >
              <HandoffRow
                item={item}
                canAct={canAct}
                disabledReason={disabledReason}
                approverName={approverName}
                onDone={(id) => setDoneIds((prev) => new Set(prev).add(id))}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {visible.length === 0 && (
          <EmptyState
            title="Nothing awaiting sign-off"
            guidance="Approved briefs and reviews will appear here when they reach the executive desk."
            showSpotArt={false}
          />
        )}
      </div>

      {total > 3 && (
        <div className="mt-3 border-t border-ink-subtle pt-3">
          <Link
            to="/briefs"
            className="text-xs font-medium text-civic hover:text-civic-strong"
          >
            View all {total} →
          </Link>
        </div>
      )}
    </section>
  );
}
