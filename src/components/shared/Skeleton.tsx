import { cn } from "@/lib/utils";

export interface SkeletonCardProps {
  /** Show a metric-sized shimmer block. */
  metric?: boolean;
  lines?: number;
  className?: string;
}

/** Shimmer placeholder matching ExecutiveStatCard layout exactly
 *  (no layout shift on load). */
export function SkeletonCard({
  metric = true,
  lines = 1,
  className,
}: SkeletonCardProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="skeleton-shimmer h-3 w-24" />
        <div className="skeleton-shimmer h-5 w-20 rounded-full" />
      </div>
      {metric && <div className="skeleton-shimmer mt-3 h-10 w-36" />}
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-shimmer mt-2 h-3 w-full max-w-[70%]" />
      ))}
    </div>
  );
}

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

/** Shimmer placeholder matching DataTable layout (header + rows). */
export function SkeletonTable({
  rows = 6,
  columns = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden rounded-md border border-ink-subtle bg-ink-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-ink-subtle px-3 py-2">
        <div className="skeleton-shimmer h-3 w-28" />
        <div className="skeleton-shimmer h-6 w-24" />
      </div>
      <div className="border-b border-ink-strong px-3 py-2.5">
        <div className="flex gap-6">
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-3 w-20" />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-6 border-b border-ink-subtle/60 px-3 py-2.5"
        >
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className="skeleton-shimmer h-3.5"
              style={{ width: `${14 + ((r + c) % 3) * 8}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
