import { useMemo, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrap } from "@/lib/trpc-data";

/**
 * I4 — "Parameter impact" section: diffs two instruments (A vs B) via
 * legislation.diffImpact and shows obligation changes + parameter deltas
 * (instrument/scale) with per-change impact notes.
 */

interface LawItem {
  lawId: string;
  title: string;
}

interface DiffImpactData {
  engine: "documents-service" | "fallback";
  aligned_pairs: number;
  obligations_added: number;
  obligations_removed: number;
  obligations_changed: number;
  obligation_changes: {
    change: "added" | "removed" | "changed";
    section_path: string;
    kind: string;
    actor: string | null;
    action_a: string | null;
    action_b: string | null;
    impact_note: string;
  }[];
  parameter_deltas: {
    instrument: string;
    field: string;
    change: "added" | "removed" | "changed";
    value_a: number | string | null;
    value_b: number | string | null;
    delta: number | null;
    impact_note: string;
  }[];
}

const CHANGE_COLOR = {
  added: "#4FAE8C",
  removed: "#D9635F",
  changed: "#D9A441",
} as const;

export default function DiffImpactPanel({ laws }: { laws: LawItem[] }) {
  const t = useT();
  const [fromLawId, setFromLawId] = useState("");
  const [toLawId, setToLawId] = useState("");
  const enabled = !!fromLawId && !!toLawId && fromLawId !== toLawId;

  const diffQuery = trpc.legislation.diffImpact.useQuery(
    { fromLawId, toLawId },
    { enabled },
  );
  const data = useMemo(
    () => unwrap<DiffImpactData>(diffQuery.data),
    [diffQuery.data],
  );

  return (
    <section
      aria-label={t.diffImpact.title}
      className="mt-4 rounded-md border border-ink-subtle bg-ink-surface/60 p-4"
    >
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink-primary">
        <GitCompareArrows className="h-4 w-4 text-civic" aria-hidden />
        {t.diffImpact.title}
      </h2>
      <p className="mt-1 text-[12px] text-ink-muted">{t.diffImpact.subtitle}</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-[11px] text-ink-muted">
          {t.diffImpact.fromLaw}
          <select
            value={fromLawId}
            onChange={(e) => setFromLawId(e.target.value)}
            className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary"
          >
            <option value="">{t.diffImpact.pick}</option>
            {laws.map((l) => (
              <option key={l.lawId} value={l.lawId}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-[11px] text-ink-muted">
          {t.diffImpact.toLaw}
          <select
            value={toLawId}
            onChange={(e) => setToLawId(e.target.value)}
            className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary"
          >
            <option value="">{t.diffImpact.pick}</option>
            {laws.map((l) => (
              <option key={l.lawId} value={l.lawId}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {enabled && diffQuery.isLoading && (
        <p aria-busy="true" className="mt-3 text-[12px] text-ink-muted">
          {t.diffImpact.loading}
        </p>
      )}
      {enabled && diffQuery.isError && (
        <p role="alert" className="mt-3 text-[12px] text-status-danger">
          {t.diffImpact.error}
        </p>
      )}

      {enabled && data && (
        <div className="mt-4 space-y-4">
          <p className="text-[11px] text-ink-muted">
            {t.diffImpact.summary
              .replace("{added}", String(data.obligations_added))
              .replace("{removed}", String(data.obligations_removed))
              .replace("{changed}", String(data.obligations_changed))
              .replace("{aligned}", String(data.aligned_pairs))}{" "}
            · {t.diffImpact.engine}: {data.engine}
          </p>

          {/* Parameter impact */}
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">
              {t.diffImpact.parameterImpact}
            </h3>
            {data.parameter_deltas.length === 0 ? (
              <p className="mt-1 text-[12px] text-ink-muted">{t.diffImpact.noDeltas}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {data.parameter_deltas.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded border border-ink-subtle/60 bg-ink-base/40 px-2.5 py-1.5 text-[12px]"
                  >
                    <span
                      className="mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase"
                      style={{ color: CHANGE_COLOR[d.change], borderColor: CHANGE_COLOR[d.change] }}
                    >
                      {d.change}
                    </span>
                    <span className="text-ink-secondary">
                      <span className="font-medium text-ink-primary">{d.instrument}</span>
                      {" · "}
                      {d.impact_note}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Obligation changes */}
          {data.obligation_changes.length > 0 && (
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">
                {t.diffImpact.obligationChanges}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {data.obligation_changes.slice(0, 12).map((c, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded border border-ink-subtle/60 bg-ink-base/40 px-2.5 py-1.5 text-[12px]"
                  >
                    <span
                      className="mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase"
                      style={{ color: CHANGE_COLOR[c.change], borderColor: CHANGE_COLOR[c.change] }}
                    >
                      {c.change}
                    </span>
                    <span className="text-ink-secondary">
                      <span className="font-mono text-ink-primary">{c.section_path}</span>{" "}
                      {c.impact_note}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
