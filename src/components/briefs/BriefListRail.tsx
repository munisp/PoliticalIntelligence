import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import ApprovalBadge, { type ApprovalState } from "@/components/shared/ApprovalBadge";
import { approvalStateLabel } from "@/lib/trpc-data";
import {
  authorInitials,
  formatDate,
  typeChipLabel,
  type BriefRow,
} from "./brief-utils";

export type StatusFilter =
  | "all"
  | "draft"
  | "in_review"
  | "approved"
  | "signed_off"
  | "returned";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "in_review", label: "In review" },
  { id: "approved", label: "Approved" },
  { id: "signed_off", label: "Signed off" },
  { id: "returned", label: "Returned" },
];

export interface BriefListRailProps {
  briefs: BriefRow[];
  selectedId: string | null;
  onSelect: (briefId: string) => void;
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  className?: string;
}

/** Left rail (340px): search + status filter chips + brief rows (72px). */
export default function BriefListRail({
  briefs,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  className,
}: BriefListRailProps) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return briefs.filter((b) => {
      if (filter !== "all" && b.reviewState !== filter) return false;
      if (q && !b.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [briefs, filter, query]);

  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-md border border-ink-subtle bg-ink-surface",
        className,
      )}
      aria-label="Brief list"
    >
      <div className="border-b border-ink-subtle p-3">
        <label className="relative block">
          <span className="sr-only">Search briefs</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search briefs…"
            className="w-full rounded-md border border-ink-subtle bg-ink-inset py-1.5 pl-8 pr-2 text-[13px] text-ink-primary placeholder:text-ink-muted focus:border-civic"
          />
        </label>
        <div
          className="mt-2 flex flex-wrap gap-1"
          role="group"
          aria-label="Filter by approval state"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilterChange(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                filter === f.id
                  ? "border-civic bg-civic/15 text-civic"
                  : "border-ink-subtle text-ink-secondary hover:border-ink-strong hover:text-ink-primary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="max-h-[62vh] overflow-y-auto p-1.5" aria-label="Briefs">
        {visible.map((b, i) => {
          const active = b.briefId === selectedId;
          return (
            <motion.li
              key={b.briefId}
              layout="position"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.2,
                delay: Math.min(i * 0.05, 0.4),
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(b.briefId)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "relative flex h-[72px] w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors",
                  active ? "bg-ink-elevated" : "hover:bg-ink-elevated/60",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-civic"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink-primary">
                      {b.title}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-1.5">
                    <span className="rounded-full border border-civic-periwinkle/40 bg-civic-periwinkle/10 px-1.5 py-px text-[10px] font-medium text-civic-periwinkle">
                      {typeChipLabel(b.template)}
                    </span>
                    <ApprovalBadge
                      state={approvalStateLabel(b.reviewState) as ApprovalState}
                    />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    aria-hidden
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-civic/15 font-mono text-[10px] font-medium text-civic"
                  >
                    {authorInitials(b.createdBy)}
                  </span>
                  <span className="font-mono text-[10px] text-ink-muted">
                    {formatDate(b.createdAt)}
                  </span>
                </span>
              </button>
            </motion.li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-8 text-center text-[13px] text-ink-muted">
            No briefs match this filter.
          </li>
        )}
      </ul>
    </div>
  );
}
