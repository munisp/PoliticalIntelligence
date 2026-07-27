import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import {
  ageDays,
  QUEUE_TABS,
  taskSeverity,
  taskTitle,
  type QueueTab,
  type ReviewTaskRow,
  type Severity,
} from "./health-utils";

const SEVERITY_META: Record<Severity, { label: string; Icon: typeof AlertTriangle; classes: string }> = {
  high: { label: "High", Icon: AlertOctagon, classes: "text-status-danger" },
  medium: { label: "Medium", Icon: AlertTriangle, classes: "text-status-warning" },
  low: { label: "Low", Icon: Info, classes: "text-status-info" },
};

function assigneeInitials(role: string): string {
  return role
    .split(/[_\s]+/)
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export interface ReviewQueueProps {
  tasks: ReviewTaskRow[];
  onTriage: (task: ReviewTaskRow, status: "in_progress" | "resolved" | "dismissed") => void;
  triagingId: string | null;
  /** Navigate into the linked workbench context. */
  onOpenContext: (task: ReviewTaskRow) => void;
}

export default function ReviewQueue({
  tasks,
  onTriage,
  triagingId,
  onOpenContext,
}: ReviewQueueProps) {
  const [tab, setTab] = useState<QueueTab>("extraction");

  const open = useMemo(() => tasks.filter((t) => t.status === "open" || t.status === "in_progress"), [tasks]);
  const counts = useMemo(() => {
    const m = new Map<QueueTab, number>();
    for (const qt of QUEUE_TABS) {
      m.set(qt.id, open.filter((t) => t.type === qt.taskType).length);
    }
    return m;
  }, [open]);

  const activeTab = QUEUE_TABS.find((t) => t.id === tab) ?? QUEUE_TABS[0];
  const visible = open.filter((t) => t.type === activeTab.taskType);

  return (
    <section
      aria-label="Review queue"
      className="flex h-full flex-col rounded-md border border-ink-subtle bg-ink-surface"
    >
      <div className="border-b border-ink-subtle px-3 py-2">
        <p className="caption-label text-ink-muted">Review queue</p>
        <div className="mt-2 flex gap-1" role="tablist" aria-label="Queue categories">
          {QUEUE_TABS.map((qt) => {
            const active = qt.id === tab;
            const count = counts.get(qt.id) ?? 0;
            return (
              <button
                key={qt.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(qt.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150",
                  active
                    ? "bg-civic/15 text-civic"
                    : "text-ink-secondary hover:text-ink-primary",
                )}
              >
                {qt.label}
                <motion.span
                  key={count}
                  initial={{ scale: 1.4 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.16 }}
                  className={cn(
                    "rounded-full px-1.5 py-px font-mono text-[10px]",
                    count > 0 ? "bg-ink-elevated text-ink-secondary" : "bg-status-success/15 text-status-success",
                  )}
                >
                  {count}
                </motion.span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-[420px] flex-1 overflow-y-auto p-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((t, i) => {
            const sev = SEVERITY_META[taskSeverity(t)];
            return (
              <motion.div
                key={t.taskId}
                layout="position"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
                transition={{ duration: 0.24, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="mb-1.5 rounded-md border border-ink-subtle bg-ink-elevated p-2.5"
              >
                <div className="flex items-start gap-2">
                  <sev.Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", sev.classes)} />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenContext(t)}
                      className="block w-full truncate text-left text-[13px] font-medium text-ink-primary hover:text-civic"
                      title="Open in context"
                    >
                      {taskTitle(t)}
                    </button>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-muted">
                      <span className="rounded-full border border-civic-periwinkle/40 bg-civic-periwinkle/10 px-1.5 py-px text-[10px] text-civic-periwinkle">
                        {t.type.replace(/_/g, " ")}
                      </span>
                      <span>{sev.label} severity</span>
                      <span className="font-mono">{ageDays(t.createdAt)}d old</span>
                      {t.status === "in_progress" && (
                        <span className="text-status-info">in progress</span>
                      )}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-civic/15 font-mono text-[10px] font-medium text-civic"
                    title={`Assignee role: ${t.assigneeRole}`}
                  >
                    {assigneeInitials(t.assigneeRole)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenContext(t)}
                    className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-0.5 text-[11px] text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
                  >
                    Open
                    <ArrowRight aria-hidden className="h-3 w-3" />
                  </button>
                  {t.status === "open" && (
                    <button
                      type="button"
                      disabled={triagingId === t.taskId}
                      onClick={() => onTriage(t, "in_progress")}
                      className="rounded border border-status-info/40 px-2 py-0.5 text-[11px] text-status-info hover:bg-status-info/10 disabled:opacity-50"
                    >
                      Start review
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={triagingId === t.taskId}
                    onClick={() => onTriage(t, "resolved")}
                    className="inline-flex items-center gap-1 rounded border border-status-success/40 px-2 py-0.5 text-[11px] text-status-success hover:bg-status-success/10 disabled:opacity-50"
                  >
                    <CheckCircle2 aria-hidden className="h-3 w-3" />
                    Resolve
                  </button>
                  <button
                    type="button"
                    disabled={triagingId === t.taskId}
                    onClick={() => onTriage(t, "dismissed")}
                    className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink-primary disabled:opacity-50"
                  >
                    <XCircle aria-hidden className="h-3 w-3" />
                    Dismiss
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {visible.length === 0 && (
          <EmptyState
            title="Queue clear"
            guidance="Nothing awaiting review in this queue."
            className="my-3 border-0 bg-transparent py-8"
          />
        )}
      </div>
    </section>
  );
}
