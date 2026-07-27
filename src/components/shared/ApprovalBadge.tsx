import {
  FileEdit,
  Eye,
  CheckCircle2,
  Stamp,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ApprovalState =
  | "draft"
  | "in-review"
  | "approved"
  | "signed-off"
  | "returned";

const STATE_META: Record<
  ApprovalState,
  { label: string; Icon: LucideIcon; classes: string }
> = {
  draft: {
    label: "Draft",
    Icon: FileEdit,
    classes: "border-ink-subtle bg-ink-elevated text-ink-secondary",
  },
  "in-review": {
    label: "In review",
    Icon: Eye,
    classes: "border-status-info/40 bg-status-info/10 text-status-info",
  },
  approved: {
    label: "Approved",
    Icon: CheckCircle2,
    classes: "border-status-success/40 bg-status-success/10 text-status-success",
  },
  "signed-off": {
    label: "Signed off",
    Icon: Stamp,
    classes: "border-gold/50 bg-gold/10 text-gold",
  },
  returned: {
    label: "Returned",
    Icon: Undo2,
    classes: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  },
};

export interface ApprovalBadgeProps {
  state: ApprovalState;
  className?: string;
}

/** Approval state badge — always icon + text, never color-only. */
export default function ApprovalBadge({ state, className }: ApprovalBadgeProps) {
  const meta = STATE_META[state];
  const { Icon } = meta;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        meta.classes,
        className,
      )}
      aria-label={`Approval state: ${meta.label}`}
    >
      <Icon aria-hidden className="h-3 w-3" />
      {meta.label}
    </span>
  );
}
