import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Download,
  Rows3,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  id: string;
  header: string;
  accessor: (row: T) => ReactNode;
  /** Raw value used for sorting + CSV export (falls back to accessor text). */
  sortValue?: (row: T) => string | number;
  numeric?: boolean;
}

export interface DataTableProps<T extends { id: string | number }> {
  columns: DataTableColumn<T>[];
  rows: T[];
  caption?: string;
  /** Expandable row: evidence preview renderer. */
  renderExpanded?: (row: T) => ReactNode;
  /** Initial compact density. */
  defaultCompact?: boolean;
  exportFileName?: string;
  className?: string;
}

function toCsv<T extends { id: string | number }>(
  columns: DataTableColumn<T>[],
  rows: T[],
): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) =>
    columns
      .map((c) => {
        const v = c.sortValue ? c.sortValue(r) : String(c.accessor(r) ?? "");
        return esc(String(v));
      })
      .join(","),
  );
  return [head, ...body].join("\n");
}

/** Sortable data table: mono numerals, row hover, expandable rows,
 *  compact density toggle, CSV export. */
export default function DataTable<T extends { id: string | number }>({
  columns,
  rows,
  caption,
  renderExpanded,
  defaultCompact = false,
  exportFileName = "export.csv",
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(
    null,
  );
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  const [compact, setCompact] = useState(defaultCompact);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const toggleSort = (id: string) =>
    setSort((s) =>
      s?.id === id
        ? s.dir === "asc"
          ? { id, dir: "desc" }
          : null
        : { id, dir: "asc" },
    );

  const toggleRow = (id: string | number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportCsv = () => {
    const blob = new Blob([toCsv(columns, sorted)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-ink-subtle bg-ink-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-ink-subtle px-3 py-2">
        {caption ? (
          <p className="caption-label text-ink-muted">{caption}</p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCompact((c) => !c)}
            aria-pressed={compact}
            className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-xs text-ink-secondary hover:border-ink-strong"
          >
            <Rows3 aria-hidden className="h-3.5 w-3.5" />
            {compact ? "Compact" : "Comfortable"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 rounded border border-ink-subtle px-2 py-1 text-xs text-ink-secondary hover:border-ink-strong"
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] leading-5">
          <thead>
            <tr className="border-b border-ink-strong">
              {renderExpanded && <th scope="col" className="w-8 px-2 py-2" />}
              {columns.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={
                      active
                        ? sort!.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      "caption-label whitespace-nowrap px-3 py-2 text-ink-muted",
                      c.numeric && "text-right",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.id)}
                      className="inline-flex items-center gap-1 hover:text-ink-primary"
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === "asc" ? (
                          <ArrowUp aria-hidden className="h-3 w-3" />
                        ) : (
                          <ArrowDown aria-hidden className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown
                          aria-hidden
                          className="h-3 w-3 opacity-40"
                        />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isOpen = expanded.has(row.id);
              return (
                <Fragment key={row.id}>
                  <tr
                    className={cn(
                      "border-b border-ink-subtle/60 transition-colors hover:bg-ink-elevated",
                      isOpen && "bg-ink-elevated",
                    )}
                  >
                    {renderExpanded && (
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => toggleRow(row.id)}
                          aria-expanded={isOpen}
                          aria-label={
                            isOpen ? "Collapse evidence" : "Expand evidence"
                          }
                          className="rounded p-0.5 text-ink-muted hover:text-ink-primary"
                        >
                          {isOpen ? (
                            <ChevronDown aria-hidden className="h-4 w-4" />
                          ) : (
                            <ChevronRight aria-hidden className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.id}
                        className={cn(
                          "px-3 text-ink-secondary",
                          compact ? "py-1.5" : "py-2.5",
                          c.numeric && "text-right font-mono text-ink-primary",
                        )}
                      >
                        {c.accessor(row)}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && isOpen && (
                    <tr className="border-b border-ink-subtle/60 bg-ink-inset">
                      <td
                        colSpan={columns.length + 1}
                        className="px-4 py-3 text-ink-secondary"
                      >
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (renderExpanded ? 1 : 0)}
                  className="px-3 py-8 text-center text-sm text-ink-muted"
                >
                  No records match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
