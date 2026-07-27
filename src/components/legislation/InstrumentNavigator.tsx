import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import type { IndexHealth, LawRow } from "./types";
import { corpusGroup } from "./types";

const HEALTH_META: Record<
  IndexHealth["status"],
  { dot: string; Icon: typeof CheckCircle2; color: string }
> = {
  healthy: { dot: "bg-status-success", Icon: CheckCircle2, color: "text-status-success" },
  stale: { dot: "bg-status-warning", Icon: AlertTriangle, color: "text-status-warning" },
  queued: { dot: "bg-ink-muted", Icon: Clock3, color: "text-ink-muted" },
};

export interface NavigatorEntry {
  law: LawRow;
  clauseCount: number | null;
  health: IndexHealth | null;
}

export interface InstrumentNavigatorProps {
  entries: NavigatorEntry[];
  loading: boolean;
  error: string | null;
  selectedLawId: string | null;
  onSelect: (lawId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function HealthChip({ health }: { health: IndexHealth }) {
  const meta = HEALTH_META[health.status];
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-1" role="status" aria-label={`Indexing: ${health.label}`}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      <Icon aria-hidden className={cn("h-3 w-3", meta.color)} />
      <span className={cn("text-[11px] font-medium", meta.color)}>{health.label}</span>
    </span>
  );
}

/** Pane A — instrument navigator tree with live search. */
export default function InstrumentNavigator({
  entries,
  loading,
  error,
  selectedLawId,
  onSelect,
  collapsed,
  onToggleCollapsed,
}: InstrumentNavigatorProps) {
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.law.title.toLowerCase().includes(q))
      : entries;
    const map = new Map<string, NavigatorEntry[]>();
    for (const e of filtered) {
      const g = corpusGroup(e.law.jurisdictionId);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(e);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries, query]);

  const isOpen = (g: string) =>
    query.trim() !== "" ? true : (openGroups[g] ?? true);

  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-ink-subtle bg-ink-surface py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand instrument navigator"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          <PanelLeftOpen aria-hidden className="h-4 w-4" />
        </button>
        <span
          aria-hidden
          className="mt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted [writing-mode:vertical-rl]"
        >
          Corpus
        </span>
      </div>
    );
  }

  return (
    <motion.aside
      aria-label="Instrument navigator"
      initial={false}
      animate={{ width: 280 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="flex h-full w-[280px] shrink-0 flex-col border-r border-ink-subtle bg-ink-surface"
    >
      <div className="flex items-center gap-2 border-b border-ink-subtle p-3">
        <label className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter instruments…"
            aria-label="Filter instruments"
            className="w-full rounded-md border border-ink-subtle bg-ink-inset py-1.5 pl-8 pr-2 text-[13px] text-ink-primary placeholder:text-ink-muted focus:border-civic"
          />
        </label>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse instrument navigator"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          <PanelLeftClose aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div aria-busy="true" aria-label="Loading instruments" className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            title="Corpus unavailable"
            guidance={error}
            showSpotArt={false}
            Icon={AlertTriangle}
          />
        ) : groups.length === 0 ? (
          <EmptyState
            title="No instruments match"
            guidance="Try a broader search term, or clear the filter to browse the full legal corpus."
          />
        ) : (
          groups.map(([group, items]) => (
            <div key={group} className="mb-1">
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((s) => ({ ...s, [group]: !isOpen(group) }))
                }
                aria-expanded={isOpen(group)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-ink-elevated"
              >
                <motion.span
                  animate={{ rotate: isOpen(group) ? 0 : -90 }}
                  transition={{ duration: 0.2 }}
                  className="text-ink-muted"
                >
                  <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                </motion.span>
                <span className="caption-label flex-1 text-ink-secondary">{group}</span>
                <span className="font-mono text-[11px] text-ink-muted">
                  {items.length}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen(group) && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                    className="overflow-hidden"
                  >
                    {items.map(({ law, clauseCount, health }) => {
                      const active = law.lawId === selectedLawId;
                      return (
                        <li key={law.lawId}>
                          <button
                            type="button"
                            onClick={() => onSelect(law.lawId)}
                            aria-current={active ? "true" : undefined}
                            className={cn(
                              "group flex w-full items-start gap-2 rounded-md border-l-[3px] px-2.5 py-2 text-left transition-colors",
                              active
                                ? "border-civic bg-ink-elevated"
                                : "border-transparent hover:bg-ink-elevated/60",
                            )}
                          >
                            <Scale
                              aria-hidden
                              className={cn(
                                "mt-0.5 h-3.5 w-3.5 shrink-0",
                                active ? "text-civic" : "text-ink-muted",
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-ink-primary">
                                {law.title}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="font-mono text-[11px] text-ink-muted">
                                  {law.year ?? "n.d."} ·{" "}
                                  {clauseCount !== null ? `${clauseCount} clauses` : "…"}
                                </span>
                                {health && <HealthChip health={health} />}
                              </span>
                            </span>
                            <ChevronRight
                              aria-hidden
                              className={cn(
                                "mt-1 h-3.5 w-3.5 shrink-0 transition-opacity",
                                active ? "text-civic opacity-100" : "opacity-0 group-hover:opacity-60",
                              )}
                            />
                          </button>
                        </li>
                      );
                    })}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    </motion.aside>
  );
}
