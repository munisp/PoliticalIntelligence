import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrapData } from "@/components/dashboard/utils";

type Status =
  | "not_started"
  | "in_assembly"
  | "passed"
  | "domesticated"
  | "rejected";

interface Cell {
  state: string;
  state_name: string;
  status: Status;
  bill_ref: string | null;
  evidence_ref: string | null;
  updated_at: string | Date | null;
}

const STATUS_STYLES: Record<Status, string> = {
  domesticated: "bg-emerald-500/80 text-white border-emerald-600",
  passed: "bg-emerald-300/60 text-emerald-950 border-emerald-400",
  in_assembly: "bg-amber-300/60 text-amber-950 border-amber-400",
  rejected: "bg-rose-400/70 text-white border-rose-500",
  not_started: "bg-ink-inset text-ink-muted border-ink-subtle",
};

/**
 * I7 — State domestication tracker: 37-cell heatmap grid per federal law
 * with a state detail popover.
 */
export default function Domestication() {
  const t = useT();
  const lawsQ = trpc.domestication.laws.useQuery();
  const laws = useMemo(
    () =>
      (unwrapData(lawsQ.data) as { law_ref: string; title: string }[] | undefined) ??
      [],
    [lawsQ.data],
  );
  const [lawRef, setLawRef] = useState<string | null>(null);
  const activeLaw = lawRef ?? laws[0]?.law_ref ?? "";
  const matrixQ = trpc.domestication.matrix.useQuery(
    { law_ref: activeLaw },
    { enabled: !!activeLaw },
  );
  const matrix = useMemo(
    () =>
      unwrapData(matrixQ.data) as
        | { cells: Cell[]; counts: Record<Status, number> }
        | undefined,
    [matrixQ.data],
  );
  const [selected, setSelected] = useState<Cell | null>(null);

  const statusLabel = (s: Status): string =>
    ({
      not_started: t.domestication.statusNotStarted,
      in_assembly: t.domestication.statusInAssembly,
      passed: t.domestication.statusPassed,
      domesticated: t.domestication.statusDomesticated,
      rejected: t.domestication.statusRejected,
    })[s];

  return (
    <div>
      <motion.header initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4">
        <p className="caption-label text-ink-muted">{t.domestication.caption}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary md:text-[32px]">
          {t.domestication.title}
        </h1>
      </motion.header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-[13px] text-ink-secondary">
          {t.domestication.selectLaw}
        </label>
        <select
          value={activeLaw}
          onChange={(e) => {
            setLawRef(e.target.value);
            setSelected(null);
          }}
          className="rounded-md border border-ink-subtle bg-ink-inset px-2 py-1.5 text-[13px] text-ink-primary focus:border-civic/60 focus:outline-none"
        >
          {laws.map((l) => (
            <option key={l.law_ref} value={l.law_ref}>
              {l.title}
            </option>
          ))}
        </select>
      </div>

      {/* Legend / counts */}
      {matrix && (
        <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-ink-secondary">
          {(Object.keys(STATUS_STYLES) as Status[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm border ${STATUS_STYLES[s]}`} />
              {statusLabel(s)} · <span className="font-mono">{matrix.counts[s]}</span>
            </span>
          ))}
        </div>
      )}

      {/* 37-cell heatmap grid */}
      {matrixQ.isLoading ? (
        <p className="text-[13px] text-ink-muted">…</p>
      ) : !matrix || matrix.cells.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{t.domestication.empty}</p>
      ) : (
        <div className="relative">
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {matrix.cells.map((c) => (
              <button
                key={c.state}
                type="button"
                onClick={() => setSelected(selected?.state === c.state ? null : c)}
                aria-label={`${c.state_name}: ${statusLabel(c.status)}`}
                className={`rounded-md border px-2 py-2 text-center font-mono text-[12px] font-medium transition hover:scale-105 ${STATUS_STYLES[c.status]}`}
              >
                {c.state}
              </button>
            ))}
          </div>

          {/* State detail popover */}
          {selected && (
            <div className="mt-3 max-w-md rounded-md border border-ink-subtle bg-ink-inset p-3 shadow-lg">
              <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-primary">
                <MapPin aria-hidden className="h-4 w-4 text-civic" />
                {selected.state_name}
              </p>
              <dl className="mt-2 space-y-1 text-[13px] text-ink-secondary">
                <div className="flex gap-2">
                  <dt className="w-24 text-ink-muted">Status</dt>
                  <dd>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLES[selected.status]}`}>
                      {statusLabel(selected.status)}
                    </span>
                  </dd>
                </div>
                {selected.bill_ref && (
                  <div className="flex gap-2">
                    <dt className="w-24 text-ink-muted">{t.domestication.billRef}</dt>
                    <dd className="font-mono text-[12px]">{selected.bill_ref}</dd>
                  </div>
                )}
                {selected.evidence_ref && (
                  <div className="flex gap-2">
                    <dt className="w-24 text-ink-muted">{t.domestication.evidence}</dt>
                    <dd className="break-all font-mono text-[12px]">{selected.evidence_ref}</dd>
                  </div>
                )}
                {selected.updated_at && (
                  <div className="flex gap-2">
                    <dt className="w-24 text-ink-muted">{t.domestication.updatedAt}</dt>
                    <dd className="font-mono text-[12px]">
                      {new Date(selected.updated_at).toISOString().slice(0, 10)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
