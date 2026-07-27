import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  FileDown,
  Presentation,
  Printer,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ExportKind = "docx" | "pdf" | "pptx" | "print";

export interface ExportMenuProps {
  /** Called for each export; records an audit event downstream. */
  onExport?: (kind: ExportKind) => void;
  /** Last export timestamps per kind (displayed on the menu item). */
  lastExported?: Partial<Record<ExportKind, string>>;
  /** tRPC request id recorded with the audit event. */
  requestId?: string;
  className?: string;
}

const ITEMS: {
  kind: ExportKind;
  label: string;
  hint: string;
  Icon: typeof FileText;
}[] = [
  { kind: "docx", label: "Memo", hint: "DOCX", Icon: FileText },
  { kind: "pdf", label: "Executive brief", hint: "PDF", Icon: FileDown },
  { kind: "pptx", label: "Presentation", hint: "PPTX", Icon: Presentation },
  { kind: "print", label: "Print", hint: "Citations appended", Icon: Printer },
];

/** Export menu — Memo (DOCX), Executive brief (PDF), Presentation (PPTX),
 *  Print. Every export records an audit event. */
export default function ExportMenu({
  onExport,
  lastExported = {},
  requestId,
  className,
}: ExportMenuProps) {
  const handle = (kind: ExportKind) => {
    // Audit event stub — replaced by tRPC mutation post-graft.
    console.info(
      `[audit] export:${kind}`,
      requestId ? { request_id: requestId } : {},
    );
    if (kind === "print") {
      window.print();
    }
    onExport?.(kind);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-sm font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary",
            className,
          )}
        >
          <FileDown aria-hidden className="h-4 w-4" />
          Export
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 border-ink-subtle bg-ink-elevated text-ink-primary"
      >
        <DropdownMenuLabel className="caption-label text-ink-muted">
          Export — each action is audited
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-ink-subtle" />
        {ITEMS.map(({ kind, label, hint, Icon }) => (
          <DropdownMenuItem
            key={kind}
            onSelect={() => handle(kind)}
            className="flex items-center justify-between gap-2 focus:bg-ink-surface"
          >
            <span className="flex items-center gap-2">
              <Icon aria-hidden className="h-4 w-4 text-civic" />
              <span>
                {label}
                <span className="ml-1.5 font-mono text-[10px] uppercase text-ink-muted">
                  {hint}
                </span>
              </span>
            </span>
            {lastExported[kind] && (
              <span className="font-mono text-[10px] text-ink-muted">
                {lastExported[kind]}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
