import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardList, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import {
  unwrapData,
  type ChecklistStep,
  type PathwaySummary,
} from "./types";

const storageKey = (pathwayId: string) => `meridian.advocacy.checklist.${pathwayId}`;

function readChecks(pathwayId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(storageKey(pathwayId));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeChecks(pathwayId: string, checks: Record<string, boolean>) {
  try {
    localStorage.setItem(storageKey(pathwayId), JSON.stringify(checks));
  } catch {
    /* storage unavailable */
  }
}

/** Ordered checklist rows with localStorage-persisted toggles. Exported for tests. */
export function ChecklistItems({
  pathwayId,
  steps,
}: {
  pathwayId: string;
  steps: ChecklistStep[];
}) {
  const t = useT();
  const [state, setState] = useState(() => ({
    pathwayId,
    checks: readChecks(pathwayId),
  }));
  // Reload persisted state when the pathway changes (render-time adjustment).
  if (state.pathwayId !== pathwayId) {
    setState({ pathwayId, checks: readChecks(pathwayId) });
  }
  const checks = state.checks;
  const setChecks = (updater: (cur: Record<string, boolean>) => Record<string, boolean>) =>
    setState((s) => ({ ...s, checks: updater(s.checks) }));

  const done = steps.filter((s) => checks[s.step]).length;

  const toggle = (step: string) => {
    setChecks((cur) => {
      const next = { ...cur, [step]: !cur[step] };
      writeChecks(pathwayId, next);
      return next;
    });
  };

  const reset = () => {
    setChecks(() => ({}));
    writeChecks(pathwayId, {});
  };

  return (
    <div className="rounded-md border border-ink-subtle bg-ink-elevated p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-secondary">
          {t.advocacy.checklistProgress
            .replace("{done}", String(done))
            .replace("{total}", String(steps.length))}
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 rounded-md border border-ink-subtle px-2 py-1 text-xs text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
        >
          <RotateCcw aria-hidden className="h-3 w-3" />
          {t.advocacy.resetChecklist}
        </button>
      </div>
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-inset"
      >
        <div
          className="h-full rounded-full bg-civic transition-[width]"
          style={{ width: steps.length ? `${(done / steps.length) * 100}%` : "0%" }}
        />
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((s, i) => {
          const checked = !!checks[s.step];
          return (
            <li key={s.step}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                  checked
                    ? "border-civic/40 bg-civic/5"
                    : "border-ink-subtle bg-ink-surface hover:border-ink-strong",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.step)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                    checked
                      ? "border-civic bg-civic text-ink-base"
                      : "border-ink-strong text-transparent",
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-ink-muted">{i + 1}.</span>
                    <span
                      className={cn(
                        "text-[13px] font-medium",
                        checked ? "text-ink-muted line-through" : "text-ink-primary",
                      )}
                    >
                      {s.step}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-secondary">
                    {s.description}
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-muted">
                    {t.advocacy.owner}: {s.owner} · {t.advocacy.estDuration}:{" "}
                    <span className="font-mono">{s.est_duration}</span>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ChecklistTab({
  selectedPathwayId,
  onSelectPathway,
}: {
  selectedPathwayId: string | null;
  onSelectPathway: (id: string | null) => void;
}) {
  const t = useT();

  const listQuery = trpc.advocacy.listPathways.useQuery();
  const pathways: PathwaySummary[] = useMemo(
    () => (listQuery.data ? unwrapData<PathwaySummary[]>(listQuery.data) : []),
    [listQuery.data],
  );

  useEffect(() => {
    if (!selectedPathwayId && pathways.length > 0)
      onSelectPathway(pathways[0].pathwayId);
  }, [pathways, selectedPathwayId, onSelectPathway]);

  const checklistQuery = trpc.advocacy.pathwayChecklist.useQuery(
    { pathwayId: selectedPathwayId ?? "" },
    { enabled: !!selectedPathwayId },
  );
  const steps: ChecklistStep[] = useMemo(
    () => (checklistQuery.data ? unwrapData<ChecklistStep[]>(checklistQuery.data) : []),
    [checklistQuery.data],
  );

  return (
    <div className="max-w-3xl space-y-4">
      <label className="block max-w-md">
        <span className="caption-label text-ink-muted">{t.advocacy.tabPathways}</span>
        <select
          value={selectedPathwayId ?? ""}
          onChange={(e) => onSelectPathway(e.target.value || null)}
          className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-[13px] text-ink-primary"
        >
          <option value="">{t.advocacy.checklistEmpty}</option>
          {pathways.map((p) => (
            <option key={p.pathwayId} value={p.pathwayId}>
              {p.title}
            </option>
          ))}
        </select>
      </label>

      {!selectedPathwayId ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-md border border-dashed border-ink-subtle p-6 text-center">
          <ClipboardList aria-hidden className="h-8 w-8 text-ink-muted" />
          <p className="mt-3 text-[13px] text-ink-secondary">{t.advocacy.checklistEmpty}</p>
        </div>
      ) : checklistQuery.isLoading ? (
        <div aria-busy="true" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md border border-ink-subtle bg-ink-elevated" />
          ))}
        </div>
      ) : checklistQuery.isError ? (
        <p role="alert" className="rounded-md border border-status-danger/40 bg-status-danger/10 p-4 text-[13px] text-status-danger">
          {t.advocacy.checklistError}
        </p>
      ) : steps.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{t.advocacy.checklistNone}</p>
      ) : (
        <ChecklistItems pathwayId={selectedPathwayId} steps={steps} />
      )}
    </div>
  );
}
