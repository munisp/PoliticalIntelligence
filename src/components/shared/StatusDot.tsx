import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Clock3,
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusKind =
  | "healthy"
  | "stale"
  | "failing"
  | "running"
  | "queued"
  | "succeeded";

const STATUS_META: Record<
  StatusKind,
  { label: string; color: string; Icon: typeof CheckCircle2; pulse?: boolean }
> = {
  healthy: { label: "Healthy", color: "text-status-success", Icon: CheckCircle2 },
  stale: { label: "Stale", color: "text-status-warning", Icon: AlertTriangle },
  failing: { label: "Failing", color: "text-status-danger", Icon: XCircle },
  running: {
    label: "Running",
    color: "text-status-info",
    Icon: Loader2,
    pulse: true,
  },
  queued: { label: "Queued", color: "text-ink-muted", Icon: Clock3 },
  succeeded: { label: "Succeeded", color: "text-status-success", Icon: BadgeCheck },
};

const DOT_COLOR: Record<StatusKind, string> = {
  healthy: "bg-status-success",
  stale: "bg-status-warning",
  failing: "bg-status-danger",
  running: "bg-status-info",
  queued: "bg-ink-muted",
  succeeded: "bg-status-success",
};

export interface StatusDotProps {
  status: StatusKind;
  /** Show the text label next to dot + icon (status is never color-only). */
  showLabel?: boolean;
  className?: string;
}

/** Pipeline/job status: dot + icon + text label. Running status pulses (1.8s). */
export default function StatusDot({
  status,
  showLabel = true,
  className,
}: StatusDotProps) {
  const meta = STATUS_META[status];
  const { Icon } = meta;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      role="status"
      aria-label={`Status: ${meta.label}`}
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 rounded-full",
          DOT_COLOR[status],
          meta.pulse && "animate-pulse-dot motion-reduce:animate-none",
        )}
      />
      <Icon
        aria-hidden
        className={cn(
          "h-3.5 w-3.5",
          meta.color,
          status === "running" && "animate-spin motion-reduce:animate-none",
        )}
      />
      {showLabel && (
        <span className={cn("text-xs font-medium", meta.color)}>{meta.label}</span>
      )}
    </span>
  );
}
