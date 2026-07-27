import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fmtTime } from "./utils";

export interface ActivityItem {
  id: string;
  ts: Date | string;
  category: "approvals" | "runs" | "data";
  /** Short monogram shown in the actor chip (initials / system tag). */
  actor: string;
  text: string;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "approvals", label: "Approvals" },
  { id: "runs", label: "Runs" },
  { id: "data", label: "Data" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

export interface ActivityFeedProps {
  items: ActivityItem[];
  /** "View full audit log →" is admin/steward-only. */
  showAuditLink: boolean;
  className?: string;
}

/** Compact audit tail — most recent platform activity, filterable. */
export default function ActivityFeed({
  items,
  showAuditLink,
  className,
}: ActivityFeedProps) {
  const [filter, setFilter] = useState<FilterId>("all");

  const visible = useMemo(
    () =>
      items
        .filter((i) => filter === "all" || i.category === filter)
        .slice(0, 8),
    [items, filter],
  );

  return (
    <section
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
      aria-labelledby="activity-title"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="activity-title" className="text-lg font-semibold text-ink-primary">
          Recent platform activity
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          Filter
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterId)}
            className="rounded-md border border-ink-subtle bg-ink-inset px-2 py-1 text-xs text-ink-primary focus:border-civic"
            aria-label="Filter activity"
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="mt-3 space-y-1" aria-live="polite">
        <AnimatePresence initial={false}>
          {visible.map((item) => (
            <motion.li
              key={item.id}
              layout="position"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-ink-elevated"
            >
              <span className="mt-0.5 w-[74px] shrink-0 font-mono text-[11px] text-ink-muted">
                {fmtTime(item.ts)}
              </span>
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-civic/15 font-mono text-[9px] font-medium text-civic"
              >
                {item.actor}
              </span>
              <span className="text-[13px] leading-5 text-ink-secondary">
                {item.text}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
        {visible.length === 0 && (
          <li className="px-2 py-6 text-center text-[13px] text-ink-muted">
            No activity in this category yet.
          </li>
        )}
      </ul>

      {showAuditLink && (
        <div className="mt-3 border-t border-ink-subtle pt-3">
          <Link
            to="/audit-log"
            className="text-xs font-medium text-civic hover:text-civic-strong"
          >
            View full audit log →
          </Link>
        </div>
      )}
    </section>
  );
}
