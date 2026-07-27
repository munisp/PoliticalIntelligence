import { useEffect, useRef, useState } from "react";
import { Globe, Sigma, Package, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProvenanceInfo, ProvenanceOrigin } from "@/lib/innovations-client";
import { useT } from "@/lib/LocaleContext";

const META: Record<
  ProvenanceOrigin,
  { Icon: LucideIcon; classes: string; labelKey: "live" | "derived" | "seed"; descKey: "liveDesc" | "derivedDesc" | "seedDesc" }
> = {
  live: {
    Icon: Globe,
    classes: "border-civic/50 bg-civic/10 text-civic",
    labelKey: "live",
    descKey: "liveDesc",
  },
  derived: {
    Icon: Sigma,
    classes: "border-civic-periwinkle/50 bg-civic-periwinkle/10 text-civic-periwinkle",
    labelKey: "derived",
    descKey: "derivedDesc",
  },
  seed: {
    Icon: Package,
    classes: "border-ink-subtle bg-ink-elevated text-ink-muted",
    labelKey: "seed",
    descKey: "seedDesc",
  },
};

export interface ProvenanceChipProps {
  origin: ProvenanceOrigin;
  sourceUrl?: string | null;
  fetchedAt?: string | Date | null;
  className?: string;
}

/**
 * Data-provenance chip: icon + text label (NEVER color-only, design.md §1.3)
 * with a hover/focus tooltip showing description, source URL and fetch time.
 * Live = teal globe, Derived = periwinkle sigma, Seed demo = muted package.
 */
export default function ProvenanceChip({
  origin,
  sourceUrl,
  fetchedAt,
  className,
}: ProvenanceChipProps) {
  const t = useT();
  const meta = META[origin] ?? META.seed;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const fetched =
    fetchedAt != null
      ? new Date(fetchedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

  return (
    <span ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${t.provenance[meta.labelKey]} — ${t.provenance[meta.descKey]}`}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
          meta.classes,
        )}
      >
        <meta.Icon aria-hidden className="h-3 w-3" />
        {t.provenance[meta.labelKey]}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute right-0 top-full z-40 mt-1.5 block w-64 rounded-md border border-ink-subtle bg-ink-elevated p-2.5 text-left shadow-lg"
        >
          <span className="block text-[12px] font-medium text-ink-primary">
            {t.provenance[meta.labelKey]}
          </span>
          <span className="mt-0.5 block text-[11px] leading-4 text-ink-secondary">
            {t.provenance[meta.descKey]}
          </span>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate font-mono text-[10px] text-civic hover:underline"
            >
              {t.provenance.sourceUrl}: {sourceUrl}
            </a>
          )}
          {fetched && (
            <span className="mt-0.5 block font-mono text-[10px] text-ink-muted">
              {t.provenance.fetchedAt}: {fetched}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** Convenience: render a chip from an optional provenance payload; null when absent. */
export function ProvenanceChipFromInfo({
  provenance,
  className,
}: {
  provenance?: ProvenanceInfo | null;
  className?: string;
}) {
  if (!provenance) return null;
  return (
    <ProvenanceChip
      origin={provenance.origin}
      sourceUrl={provenance.source_url}
      fetchedAt={provenance.fetched_at}
      className={className}
    />
  );
}
