import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, CloudOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared";
import { isProcedureMissing } from "@/lib/innovations-client";

/**
 * Shared page scaffold for the innovations section: back link, title,
 * description and consistent spacing (dark civic-ink theme).
 */
export default function InnovationPage({
  title,
  description,
  Icon,
  actions,
  children,
  className,
}: {
  title: string;
  description: string;
  Icon: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5 pb-24", className)}>
      <Link
        to="/innovations"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-civic"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        Platform Innovations
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-ink-subtle bg-ink-elevated"
          >
            <Icon className="h-4.5 w-4.5 text-civic" strokeWidth={1.5} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
              {title}
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-secondary">
              {description}
            </p>
          </div>
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

/**
 * Standard graceful-degradation error block: distinguishes "procedure not on
 * this backend yet" from real failures.
 */
export function InnovationError({
  error,
  onRetry,
}: {
  error: { message: string };
  onRetry?: () => void;
}) {
  if (isProcedureMissing(error)) {
    return (
      <EmptyState
        Icon={CloudOff}
        showSpotArt={false}
        title="Service not deployed yet"
        guidance="This innovation's backend service is still being rolled out. The page is ready — check back once the API ships."
      />
    );
  }
  return (
    <EmptyState
      showSpotArt={false}
      title="Failed to load"
      guidance={error.message}
      action={onRetry ? { label: "Retry", onClick: onRetry } : undefined}
    />
  );
}
