import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  PenLine,
  Search,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import StatusDot from "@/components/shared/StatusDot";
import { hashSeed, seededRandom } from "@/components/briefs/brief-utils";
import {
  conformancePct,
  parseCompliance,
  relativeTime,
  type DataSourceRow,
} from "./health-utils";

/* ------------------------------------------------------------------ */
/* Deterministic contract field model                                   */
/* ------------------------------------------------------------------ */

type FieldStatus = "matched" | "drifted" | "missing";

interface ContractField {
  name: string;
  expected: string;
  observed: string | null;
  status: FieldStatus;
  note?: string;
}

const FIELD_POOL: { name: string; type: string }[] = [
  { name: "record_id", type: "string" },
  { name: "lga_code", type: "string" },
  { name: "period", type: "date" },
  { name: "enrollment_count", type: "int" },
  { name: "value_ngn", type: "decimal" },
  { name: "geo_point", type: "point" },
  { name: "source_url", type: "string" },
];

function contractFields(source: DataSourceRow): ContractField[] {
  const rand = seededRandom(hashSeed(`contract:${source.sourceId}`));
  const count = 4 + Math.floor(rand() * 3);
  const fields: ContractField[] = [];
  const compliance = parseCompliance(source.contractCompliance);
  const schemaOk = compliance?.schema_ok ?? source.health !== "failing";
  for (let i = 0; i < count; i++) {
    const f = FIELD_POOL[Math.floor(rand() * FIELD_POOL.length)];
    if (fields.some((x) => x.name === f.name)) continue;
    let status: FieldStatus = "matched";
    if (!schemaOk && i === 1) status = rand() > 0.5 ? "drifted" : "missing";
    else if (source.health === "stale" && i === count - 1 && rand() > 0.6) status = "drifted";
    fields.push({
      name: f.name,
      expected: f.type,
      observed:
        status === "missing" ? null : status === "drifted" ? (f.type === "int" ? "float" : "string") : f.type,
      status,
      note:
        status === "drifted"
          ? `type drift: ${f.name} ${f.type}→${f.type === "int" ? "float" : "string"}`
          : status === "missing"
            ? "missing from latest delivery"
            : undefined,
    });
  }
  return fields;
}

function contractVersion(source: DataSourceRow): string {
  const v = (hashSeed(`version:${source.sourceId}`) % 6) + 1;
  return `v1.${v}`;
}

function classification(source: DataSourceRow): { label: string; classes: string } {
  const cat = (source.category ?? "").toLowerCase();
  if (cat.includes("geo") || cat.includes("public"))
    return { label: "Public", classes: "border-status-success/40 bg-status-success/10 text-status-success" };
  if (cat.includes("procurement") || cat.includes("finance") || cat.includes("restricted"))
    return { label: "Restricted", classes: "border-status-danger/40 bg-status-danger/10 text-status-danger" };
  return { label: "Official", classes: "border-status-info/40 bg-status-info/10 text-status-info" };
}

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

export interface SourceRegistryProps {
  sources: DataSourceRow[];
  onSignOffDrift: (source: DataSourceRow, comment: string) => void;
  signingOffId: string | null;
  canSignOff: boolean;
}

export default function SourceRegistry({
  sources,
  onSignOffDrift,
  signingOffId,
  canSignOff,
}: SourceRegistryProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [signComment, setSignComment] = useState<Record<string, string>>({});

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q) ||
        (s.owner ?? "").toLowerCase().includes(q),
    );
  }, [sources, query]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      aria-label="Source registry and contract compliance"
      className="overflow-hidden rounded-md border border-ink-subtle bg-ink-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-subtle px-3 py-2">
        <p className="caption-label text-ink-muted">Source registry & contract compliance</p>
        <label className="relative block">
          <span className="sr-only">Search sources</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sources…"
            className="rounded-md border border-ink-subtle bg-ink-inset py-1.5 pl-8 pr-2 text-[13px] text-ink-primary placeholder:text-ink-muted focus:border-civic"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] leading-5">
          <thead>
            <tr className="border-b border-ink-strong">
              <th scope="col" className="w-8 px-2 py-2" />
              {["Source", "Domain", "Classification", "Contract", "Schema conformance", "Freshness", "Owner", "Status"].map((h) => (
                <th key={h} scope="col" className="caption-label whitespace-nowrap px-3 py-2 text-ink-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const isOpen = expanded.has(s.sourceId);
              const cls = classification(s);
              const pct = conformancePct(s.contractCompliance);
              const fields = isOpen ? contractFields(s) : null;
              const hasDrift = fields?.some((f) => f.status !== "matched") ?? false;
              return (
                <FragmentRow
                  key={s.sourceId}
                  isOpen={isOpen}
                  onToggle={() => toggle(s.sourceId)}
                  cells={
                    <>
                      <td className="max-w-[260px] truncate px-3 py-2.5 font-medium text-ink-primary">
                        {s.name}
                      </td>
                      <td className="px-3 py-2.5 capitalize text-ink-secondary">{s.category ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", cls.classes)}>
                          {cls.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-secondary">{contractVersion(s)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-primary">
                        {pct !== null ? `${pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-ink-secondary">
                        {s.freshnessDays}d · {relativeTime(s.lastRefresh)}
                      </td>
                      <td className="px-3 py-2.5 text-ink-secondary">{s.owner ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <StatusDot status={s.health} />
                      </td>
                    </>
                  }
                  detail={
                    fields && (
                      <div className="space-y-3 px-4 py-3">
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          <div>
                            <p className="caption-label text-ink-muted">
                              Expected schema vs observed
                            </p>
                            <ul className="mt-2 space-y-1">
                              {fields.map((f, i) => (
                                <motion.li
                                  key={f.name}
                                  initial={{ opacity: 0, x: -6, backgroundColor: f.status === "drifted" ? "rgba(217,164,65,0.18)" : "rgba(0,0,0,0)" }}
                                  animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }}
                                  transition={{ duration: 0.3, delay: i * 0.03 }}
                                  className="flex items-center gap-2 rounded border border-ink-subtle/60 bg-ink-elevated px-2 py-1.5 text-xs"
                                >
                                  {f.status === "matched" ? (
                                    <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-status-success" />
                                  ) : f.status === "drifted" ? (
                                    <CircleAlert aria-hidden className="h-3.5 w-3.5 shrink-0 text-status-warning" />
                                  ) : (
                                    <XCircle aria-hidden className="h-3.5 w-3.5 shrink-0 text-status-danger" />
                                  )}
                                  <span className="font-mono text-ink-primary">{f.name}</span>
                                  <span className="text-ink-muted">
                                    expected <span className="font-mono">{f.expected}</span>
                                    {f.observed !== null && f.status !== "matched" && (
                                      <>
                                        {" "}· observed <span className="font-mono">{f.observed}</span>
                                      </>
                                    )}
                                  </span>
                                  {f.note && (
                                    <span
                                      className={cn(
                                        "ml-auto font-mono text-[10px]",
                                        f.status === "drifted" ? "text-status-warning" : "text-status-danger",
                                      )}
                                    >
                                      {f.note}
                                    </span>
                                  )}
                                </motion.li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-2 text-xs text-ink-secondary">
                            <p>
                              <span className="caption-label text-ink-muted">Delivery SLA</span>
                              <br />
                              {s.refreshCadence ?? "Not specified"} · last validation{" "}
                              {relativeTime(s.lastRefresh)}
                            </p>
                            <p className="font-mono text-[11px] text-ink-muted">
                              contract {contractVersion(s)} · {s.sourceId}
                            </p>
                            {parseCompliance(s.contractCompliance)?.notes && (
                              <p className="rounded border border-ink-subtle bg-ink-elevated p-2 text-[11px] italic">
                                “{parseCompliance(s.contractCompliance)?.notes}”
                              </p>
                            )}
                            {hasDrift && (
                              <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-2.5">
                                <p className="text-[11px] text-status-warning">
                                  Contract drift proposed — steward sign-off required to accept the
                                  changed schema.
                                </p>
                                <label className="mt-2 block">
                                  <span className="caption-label text-ink-muted">Sign-off comment</span>
                                  <textarea
                                    value={signComment[s.sourceId] ?? ""}
                                    onChange={(e) =>
                                      setSignComment((p) => ({ ...p, [s.sourceId]: e.target.value }))
                                    }
                                    rows={2}
                                    placeholder="Record why this drift is acceptable…"
                                    className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset p-2 text-xs text-ink-primary placeholder:text-ink-muted focus:border-civic"
                                  />
                                </label>
                                <span title={canSignOff ? undefined : "Requires the data steward role"}>
                                  <button
                                    type="button"
                                    disabled={!canSignOff || signingOffId === s.sourceId}
                                    onClick={() => onSignOffDrift(s, signComment[s.sourceId] ?? "")}
                                    className={cn(
                                      "mt-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                                      canSignOff
                                        ? "bg-civic text-ink-base hover:bg-civic-strong"
                                        : "cursor-not-allowed bg-ink-elevated text-ink-muted",
                                    )}
                                  >
                                    <PenLine aria-hidden className="h-3.5 w-3.5" />
                                    {signingOffId === s.sourceId
                                      ? "Recording sign-off…"
                                      : "Approve contract change"}
                                  </button>
                                </span>
                                {!canSignOff && (
                                  <p className="mt-1 text-[10px] text-ink-muted">
                                    Sign-off requires the data steward role; the action records an audit event.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  }
                />
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[13px] text-ink-muted">
                  No sources match this search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FragmentRow({
  isOpen,
  onToggle,
  cells,
  detail,
}: {
  isOpen: boolean;
  onToggle: () => void;
  cells: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <>
      <tr className={cn("border-b border-ink-subtle/60 transition-colors hover:bg-ink-elevated", isOpen && "bg-ink-elevated")}>
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse contract detail" : "Expand contract detail"}
            className="rounded p-0.5 text-ink-muted hover:text-ink-primary"
          >
            {isOpen ? (
              <ChevronDown aria-hidden className="h-4 w-4" />
            ) : (
              <ChevronRight aria-hidden className="h-4 w-4" />
            )}
          </button>
        </td>
        {cells}
      </tr>
      <AnimatePresence>
        {isOpen && (
          <tr>
            <td colSpan={9} className="border-b border-ink-subtle/60 bg-ink-inset/50 p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                className="overflow-hidden"
              >
                {detail}
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}
