import { useState } from "react";
import { Check, ChevronDown, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/LocaleContext";

export interface FilterBarValue {
  sectors: string[];
  geography: string;
  horizon: 1 | 3 | 5;
  /** Confidence floor 0–1. */
  confidenceFloor: number;
  savedView?: string;
}

export interface FilterBarProps {
  sectors: string[];
  geographies: { id: string; label: string }[];
  savedViews?: { id: string; label: string }[];
  value: FilterBarValue;
  onChange: (next: FilterBarValue) => void;
  className?: string;
}

const chipBase =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";

/** Sticky filter bar: sector multi-select, geography tree-select, horizon,
 *  confidence floor slider, saved views. */
export default function FilterBar({
  sectors,
  geographies,
  savedViews = [],
  value,
  onChange,
  className,
}: FilterBarProps) {
  const t = useT();
  const [viewsOpen, setViewsOpen] = useState(false);

  const toggleSector = (s: string) => {
    const next = value.sectors.includes(s)
      ? value.sectors.filter((x) => x !== s)
      : [...value.sectors, s];
    onChange({ ...value, sectors: next });
  };

  return (
    <div
      className={cn(
        "sticky top-16 z-20 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-ink-subtle bg-ink-base/90 px-1 py-2.5 backdrop-blur",
        className,
      )}
      role="region"
      aria-label={t.filter.filtersAria}
    >
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">{t.filter.sectors}</legend>
        <span className="caption-label mr-1 text-ink-muted">{t.filter.sector}</span>
        {sectors.map((s) => {
          const active = value.sectors.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => toggleSector(s)}
              className={cn(
                chipBase,
                active
                  ? "border-civic bg-civic/10 text-civic"
                  : "border-ink-subtle bg-ink-surface text-ink-secondary hover:border-ink-strong",
              )}
            >
              {active && <Check aria-hidden className="h-3 w-3" />}
              {s}
            </button>
          );
        })}
      </fieldset>

      <label className="flex items-center gap-2">
        <span className="caption-label text-ink-muted">{t.filter.geography}</span>
        <select
          value={value.geography}
          onChange={(e) => onChange({ ...value, geography: e.target.value })}
          className="rounded-md border border-ink-subtle bg-ink-surface px-2 py-1 text-xs text-ink-primary"
        >
          {geographies.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex items-center gap-1.5">
        <legend className="sr-only">{t.filter.horizon}</legend>
        <span className="caption-label text-ink-muted">{t.filter.horizon}</span>
        {([1, 3, 5] as const).map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={value.horizon === h}
            onClick={() => onChange({ ...value, horizon: h })}
            className={cn(
              chipBase,
              value.horizon === h
                ? "border-civic bg-civic/10 text-civic"
                : "border-ink-subtle bg-ink-surface text-ink-secondary hover:border-ink-strong",
            )}
          >
            {h}-yr
          </button>
        ))}
      </fieldset>

      <label className="flex items-center gap-2">
        <span className="caption-label text-ink-muted">{t.filter.confidence}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.confidenceFloor}
          onChange={(e) =>
            onChange({ ...value, confidenceFloor: Number(e.target.value) })
          }
          aria-valuetext={t.filter.confidenceFloorAria.replace("{value}", value.confidenceFloor.toFixed(2))}
          className="h-1 w-28 accent-civic"
        />
        <span className="w-8 font-mono text-xs text-ink-secondary">
          {value.confidenceFloor.toFixed(2)}
        </span>
      </label>

      {savedViews.length > 0 && (
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setViewsOpen((v) => !v)}
            aria-expanded={viewsOpen}
            aria-haspopup="listbox"
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-2.5 py-1 text-xs font-medium text-ink-secondary hover:border-ink-strong"
          >
            <Save aria-hidden className="h-3.5 w-3.5" />
            {savedViews.find((v) => v.id === value.savedView)?.label ??
              "Saved views"}
            <ChevronDown aria-hidden className="h-3.5 w-3.5" />
          </button>
          {viewsOpen && (
            <ul
              role="listbox"
              aria-label="Saved views"
              className="absolute right-0 top-full z-30 mt-1 w-48 rounded-md border border-ink-subtle bg-ink-elevated p-1 shadow-overlay"
            >
              {savedViews.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value.savedView === v.id}
                    onClick={() => {
                      onChange({ ...value, savedView: v.id });
                      setViewsOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-ink-secondary hover:bg-ink-surface hover:text-ink-primary"
                  >
                    {v.label}
                    {value.savedView === v.id && (
                      <Check aria-hidden className="h-3.5 w-3.5 text-civic" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
