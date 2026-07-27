import { useRef, useState } from "react";
import { Brain, MapPin, Paperclip, SendHorizonal, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComposerProps {
  /** Pre-filled text (e.g. deep-linked "Ask Copilot…"). */
  initialText?: string;
  online: boolean;
  sending: boolean;
  pinnedCount: number;
  onSend: (text: string, deepAnalysis: boolean) => void;
}

/**
 * Sticky composer: multiline input (Enter send / Shift+Enter newline),
 * jurisdiction scope chip, deep-analysis toggle, guardrail caption.
 */
export default function Composer({
  initialText,
  online,
  sending,
  pinnedCount,
  onSend,
}: ComposerProps) {
  const [text, setText] = useState(initialText ?? "");
  const [deep, setDeep] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = !online || sending;
  const canSend = text.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), deep);
    setText("");
    areaRef.current?.focus();
  };

  return (
    <div className="border-t border-ink-subtle bg-ink-surface px-4 pb-3 pt-2.5">
      <div
        className={cn(
          "rounded-md border bg-ink-inset transition-colors",
          disabled ? "border-ink-subtle opacity-80" : "border-ink-subtle focus-within:border-civic",
        )}
      >
        <div className="flex items-end gap-2 p-2">
          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(4, Math.max(1, text.split("\n").length))}
            disabled={disabled}
            placeholder={
              online
                ? "Ask a grounded question about Kaduna State policy…"
                : "Copilot requires connectivity"
            }
            aria-label="Message the copilot"
            className="max-h-32 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-[22px] text-ink-primary placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
          />
          <span
            title={
              !online
                ? "Copilot requires connectivity — cached conversations remain readable."
                : sending
                  ? "Waiting for the current answer…"
                  : undefined
            }
          >
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
              className={cn(
                "rounded-md p-2 transition-transform",
                canSend
                  ? "bg-civic text-ink-base hover:bg-civic-strong active:scale-[0.98]"
                  : "cursor-not-allowed bg-ink-elevated text-ink-muted",
              )}
            >
              {!online ? (
                <WifiOff aria-hidden className="h-4 w-4" />
              ) : (
                <SendHorizonal aria-hidden className="h-4 w-4" />
              )}
            </button>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-subtle px-3 py-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-civic/30 bg-civic/5 px-2 py-0.5 text-[11px] font-medium text-civic">
            <MapPin aria-hidden className="h-3 w-3" />
            Kaduna State · Nigeria
          </span>
          <span
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted"
            title={
              pinnedCount > 0
                ? `Grounding against ${pinnedCount} pinned evidence source(s)`
                : "Pin sources from an evidence bundle to ground follow-ups"
            }
          >
            <Paperclip aria-hidden className="h-3 w-3" />
            {pinnedCount > 0 ? `${pinnedCount} pinned` : "No attachment"}
          </span>
          <button
            type="button"
            onClick={() => setDeep((v) => !v)}
            aria-pressed={deep}
            title="Deep analysis — routes to the specialist tier (slower, for hard analysis)"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
              deep
                ? "border-civic-periwinkle/60 bg-civic-periwinkle/10 text-civic-periwinkle"
                : "border-ink-subtle text-ink-muted hover:text-ink-primary",
            )}
          >
            <Brain aria-hidden className="h-3 w-3" />
            Deep analysis
          </button>
          {deep && (
            <span className="text-[11px] text-ink-muted">
              slower, for hard analysis
            </span>
          )}
        </div>
      </div>

      {/* Persistent guardrail caption */}
      <p className="mt-2 text-center text-[11px] leading-4 text-ink-muted">
        Copilot answers are advisory. Policy and legal actions require human
        review in the Workbench. Rate and scope limits are shown when reached —
        nothing fails silently.
      </p>
    </div>
  );
}
