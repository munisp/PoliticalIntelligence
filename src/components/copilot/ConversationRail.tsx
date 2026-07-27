import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import type { Conversation } from "./types";

export interface ConversationRailProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** Rail — prior conversations with live search + new conversation. */
export default function ConversationRail({
  conversations,
  activeId,
  onSelect,
  onNew,
  collapsed,
  onToggleCollapsed,
}: ConversationRailProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [conversations, query]);

  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-ink-subtle bg-ink-surface py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand conversations"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          <PanelLeftOpen aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNew}
          aria-label="New conversation"
          className="rounded-md p-1.5 text-civic hover:bg-ink-elevated"
        >
          <Plus aria-hidden className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <motion.aside
      aria-label="Conversations"
      initial={false}
      animate={{ width: 280 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="flex h-full w-[280px] shrink-0 flex-col border-r border-ink-subtle bg-ink-surface"
    >
      <div className="space-y-2 border-b border-ink-subtle p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-civic px-3 py-1.5 text-[13px] font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98]"
          >
            <Plus aria-hidden className="h-4 w-4" />
            New conversation
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse conversations"
            className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
          >
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <label className="relative block">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full rounded-md border border-ink-subtle bg-ink-inset py-1.5 pl-8 pr-2 text-[13px] text-ink-primary placeholder:text-ink-muted focus:border-civic"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <EmptyState
            title={conversations.length === 0 ? "No prior conversations" : "No matches"}
            guidance={
              conversations.length === 0
                ? "Start a conversation — answers cite their sources and show confidence."
                : "Try a different search term."
            }
          />
        ) : (
          <ul className="space-y-1">
            {filtered.map((c, i) => (
              <motion.li
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.2 }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={c.id === activeId ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md border-l-[3px] px-2.5 py-2 text-left transition-colors",
                    c.id === activeId
                      ? "border-civic bg-ink-elevated"
                      : "border-transparent hover:bg-ink-elevated/60",
                  )}
                >
                  <MessageSquareText
                    aria-hidden
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      c.id === activeId ? "text-civic" : "text-ink-muted",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-primary">
                      {c.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono text-[11px] text-ink-muted">
                        {new Date(c.createdAt).toLocaleString(undefined, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="rounded-full border border-ink-subtle px-1.5 font-mono text-[10px] text-ink-muted">
                        {c.messages.length} msg
                      </span>
                    </span>
                    <span className="mt-1 inline-block rounded-full border border-civic/30 bg-civic/5 px-1.5 py-px text-[10px] font-medium text-civic">
                      {c.jurisdiction}
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </motion.aside>
  );
}
