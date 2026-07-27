import { Link } from "react-router";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/LocaleContext";
import type { JurisdictionProvenanceSummary } from "@/lib/innovations-client";

export interface ProvenanceBannerProps {
  /** Jurisdiction provenance counts; banner shows when seed share ≥ 80%. */
  provenance?: { live: number; derived: number; seed: number } | null;
  className?: string;
}

export function seedShare(p: { live: number; derived: number; seed: number }): number {
  const total = p.live + p.derived + p.seed;
  return total === 0 ? 0 : p.seed / total;
}

/**
 * Honest "Demo data" notice for pages whose jurisdiction is ≥80% seed data,
 * linking to Data Source Health to connect live sources.
 */
export default function ProvenanceBanner({ provenance, className }: ProvenanceBannerProps) {
  const t = useT();
  if (!provenance || seedShare(provenance) < 0.8) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border border-status-warning/40 bg-status-warning/10 px-3.5 py-2.5",
        className,
      )}
    >
      <Package aria-hidden className="h-4 w-4 shrink-0 text-status-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink-primary">{t.provenance.bannerTitle}</p>
        <p className="text-[12px] leading-4 text-ink-secondary">{t.provenance.bannerBody}</p>
      </div>
      <Link
        to="/data-health"
        className="rounded-md border border-status-warning/50 px-2.5 py-1 text-[12px] font-medium text-status-warning hover:bg-status-warning/10"
      >
        {t.provenance.bannerCta}
      </Link>
    </div>
  );
}

/** Helper: find a jurisdiction's provenance summary by id. */
export function findProvenance(
  list: JurisdictionProvenanceSummary[] | null | undefined,
  jurisdictionId: string | null | undefined,
) {
  if (!list || !jurisdictionId) return null;
  return list.find((j) => j.jurisdiction_id === jurisdictionId)?.provenance ?? null;
}
