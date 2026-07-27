import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  /** One-line guidance. */
  guidance: string;
  /** Optional lucide icon; default spot art is /empty-evidence.svg. */
  Icon?: LucideIcon;
  /** Use the evidence spot illustration. */
  showSpotArt?: boolean;
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** Low-saturation empty state: spot art or mono icon, one-line guidance,
 *  single primary action. */
export default function EmptyState({
  title,
  guidance,
  Icon,
  showSpotArt = true,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-ink-subtle bg-ink-surface/50 px-6 py-12 text-center",
        className,
      )}
    >
      {showSpotArt && !Icon ? (
        <img
          src="/empty-evidence.svg"
          alt=""
          width={160}
          height={120}
          className="opacity-80"
        />
      ) : Icon ? (
        <Icon aria-hidden className="h-10 w-10 text-ink-muted" strokeWidth={1.25} />
      ) : null}
      <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
      <p className="max-w-sm text-[13px] leading-5 text-ink-muted">{guidance}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 rounded-md bg-civic px-3 py-1.5 text-sm font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
