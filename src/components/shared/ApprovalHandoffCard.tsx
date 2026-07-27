import { useState } from "react";
import { CheckCircle2, Undo2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import ApprovalBadge, { type ApprovalState } from "./ApprovalBadge";

export interface ApprovalHandoffCardProps {
  /** Item summary (title). */
  title: string;
  /** One-line description of what is being approved. */
  summary?: string;
  state: ApprovalState;
  nextApprover: { name: string; role: string };
  /** Whether the current user may act on this item. */
  canAct: boolean;
  /** Why the buttons are disabled (shown in tooltip) when canAct is false. */
  disabledReason?: string;
  onApprove?: (comment: string) => void;
  onReturn?: (comment: string) => void;
  className?: string;
}

/** Approval handoff: summary, current state, next approver, comment field,
 *  Approve / Return with comments. Disabled with tooltip for unauthorized roles. */
export default function ApprovalHandoffCard({
  title,
  summary,
  state,
  nextApprover,
  canAct,
  disabledReason = "Your role cannot act on this item.",
  onApprove,
  onReturn,
  className,
}: ApprovalHandoffCardProps) {
  const [comment, setComment] = useState("");

  return (
    <section
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
      aria-label={`Approval handoff: ${title}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
          {summary && (
            <p className="mt-0.5 text-[13px] leading-5 text-ink-secondary">
              {summary}
            </p>
          )}
        </div>
        <ApprovalBadge state={state} />
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-secondary">
        <UserRound aria-hidden className="h-3.5 w-3.5 text-ink-muted" />
        Next approver:{" "}
        <span className="font-medium text-ink-primary">{nextApprover.name}</span>
        <span className="text-ink-muted">· {nextApprover.role}</span>
      </p>

      <label className="mt-3 block">
        <span className="caption-label text-ink-muted">Comment</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Add a comment for the record (optional for approval, required for return)…"
          className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset p-2 text-[13px] leading-5 text-ink-primary placeholder:text-ink-muted focus:border-civic"
        />
      </label>

      <div className="mt-3 flex items-center gap-2">
        <span title={canAct ? undefined : disabledReason}>
          <button
            type="button"
            disabled={!canAct}
            onClick={() => onApprove?.(comment)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-transform",
              canAct
                ? "bg-civic text-ink-base hover:bg-civic-strong active:scale-[0.98]"
                : "cursor-not-allowed bg-ink-elevated text-ink-muted",
            )}
          >
            <CheckCircle2 aria-hidden className="h-4 w-4" />
            Approve
          </button>
        </span>
        <span title={canAct ? undefined : disabledReason}>
          <button
            type="button"
            disabled={!canAct}
            onClick={() => onReturn?.(comment)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-transform",
              canAct
                ? "border-status-warning/50 text-status-warning hover:bg-status-warning/10 active:scale-[0.98]"
                : "cursor-not-allowed border-ink-subtle text-ink-muted",
            )}
          >
            <Undo2 aria-hidden className="h-4 w-4" />
            Return with comments
          </button>
        </span>
      </div>
    </section>
  );
}
