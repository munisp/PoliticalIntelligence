import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Compass,
  Scale,
  FlaskConical,
  FileText,
  Sparkles,
  MessageSquareText,
} from "lucide-react";

export interface CommandItemDef {
  id: string;
  label: string;
  /** Extra keywords for fuzzy matching. */
  keywords?: string[];
  group: "Pages" | "Opportunities" | "Legislation" | "Briefs" | "Runs";
  href?: string;
}

const DEFAULT_ITEMS: CommandItemDef[] = [
  { id: "dashboard", label: "Executive Dashboard", group: "Pages", href: "/dashboard", keywords: ["kpi", "governor"] },
  { id: "opportunities", label: "Opportunity Explorer", group: "Pages", href: "/opportunities", keywords: ["ranked", "sectors"] },
  { id: "legislation", label: "Policy & Legislation Workbench", group: "Pages", href: "/legislation", keywords: ["clauses", "laws"] },
  { id: "simulation", label: "Simulation Studio", group: "Pages", href: "/simulation", keywords: ["scenario", "forecast"] },
  { id: "briefs", label: "Executive Briefs", group: "Pages", href: "/briefs", keywords: ["memo", "export"] },
  { id: "data-health", label: "Data Source Health", group: "Pages", href: "/data-health", keywords: ["pipelines", "freshness"] },
  { id: "copilot", label: "Copilot", group: "Pages", href: "/copilot", keywords: ["ask", "chat"] },
];

const GROUP_ICONS: Record<CommandItemDef["group"], typeof LayoutDashboard> = {
  Pages: LayoutDashboard,
  Opportunities: Compass,
  Legislation: Scale,
  Briefs: FileText,
  Runs: FlaskConical,
};

export interface CommandPaletteProps {
  /** Extra entity results supplied by pages (opportunities, clauses, briefs, runs). */
  items?: CommandItemDef[];
}

/**
 * ⌘K command palette: fuzzy search across opportunities, laws, clauses,
 * briefs, runs + "Ask Copilot…" affordance at the bottom.
 */
export default function CommandPalette({ items = [] }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("meridian:open-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("meridian:open-palette", onOpen);
    };
  }, []);

  const all = useMemo(() => [...DEFAULT_ITEMS, ...items], [items]);
  const groups = useMemo(() => {
    const order: CommandItemDef["group"][] = [
      "Pages",
      "Opportunities",
      "Legislation",
      "Briefs",
      "Runs",
    ];
    return order
      .map((g) => ({ group: g, items: all.filter((i) => i.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [all]);

  const go = (item: CommandItemDef) => {
    setOpen(false);
    if (item.href) navigate(item.href);
  };

  const askCopilot = () => {
    setOpen(false);
    navigate(`/copilot${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search opportunities, laws, clauses, briefs and runs, or ask Copilot."
      className="border-ink-subtle bg-ink-elevated"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search opportunities, laws, clauses, briefs, runs…"
      />
      <CommandList>
        <CommandEmpty>No results — try asking Copilot below.</CommandEmpty>
        {groups.map(({ group, items: groupItems }) => {
          const GroupIcon = GROUP_ICONS[group];
          return (
            <CommandGroup key={group} heading={group}>
              {groupItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${(item.keywords ?? []).join(" ")}`}
                  onSelect={() => go(item)}
                >
                  <GroupIcon aria-hidden className="mr-2 h-4 w-4 text-civic" />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        <CommandSeparator />
        <CommandGroup heading="Copilot">
          <CommandItem
            value={`ask copilot ${query}`}
            onSelect={askCopilot}
            className="text-civic"
          >
            <MessageSquareText aria-hidden className="mr-2 h-4 w-4" />
            Ask Copilot{query ? `: “${query}”` : "…"}
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between border-t border-ink-subtle px-3 py-2">
        <span className="flex items-center gap-1 text-[11px] text-ink-muted">
          <Sparkles aria-hidden className="h-3 w-3" />
          Grounded answers with citations
        </span>
        <kbd className="rounded border border-ink-subtle bg-ink-inset px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
          ⌘K
        </kbd>
      </div>
    </CommandDialog>
  );
}

/** Imperative helper — open the palette from anywhere (e.g. topbar button). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("meridian:open-palette"));
}
