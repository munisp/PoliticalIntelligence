import type { ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-pwa";
import { useT } from "@/lib/LocaleContext";

/**
 * Offline-quality guard for heavy queries: when the device is fully offline
 * and a query has no cached data to show (still pending), render the designed
 * offline empty state instead of an infinite skeleton/spinner. When cached
 * data exists (react-query persistence / SW-fed refetch) or the device is
 * online, children render unchanged.
 */
export default function OfflineBoundary({
  isLoading,
  hasData,
  onRetry,
  label,
  children,
}: {
  /** True while the underlying query is pending with no data yet. */
  isLoading: boolean;
  /** True when any cached/seed data is available to render. */
  hasData?: boolean;
  /** Optional refetch — offered so users can retry after reconnecting. */
  onRetry?: () => void;
  /** Optional accessible label for the offline region. */
  label?: string;
  children: ReactNode;
}) {
  const online = useOnlineStatus();
  const t = useT();

  if (!online && isLoading && !hasData) {
    return (
      <div
        role="status"
        aria-label={label ?? t.common.offlineTitle}
        className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-ink-subtle bg-ink-surface px-6 py-12 text-center"
      >
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full border border-status-warning/40 bg-status-warning/10"
        >
          <WifiOff className="h-5 w-5 text-status-warning" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-primary">
            {t.common.offlineTitle}
          </p>
          <p className="mt-1 max-w-md text-[13px] leading-5 text-ink-secondary">
            {t.common.offlineBody}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-ink-strong hover:text-ink-primary"
          >
            {t.action.retry}
          </button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
