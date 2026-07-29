import { useState } from "react";
import { Code2, Copy, Check, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrap } from "@/lib/trpc-data";

/**
 * I2 — "Embed" button for an opportunity row: fetches the sanitized
 * iframe-safe snippet (embed.scriptTag, docs/EMBED.md) and copies it to the
 * clipboard.
 */
export default function EmbedButton({ opportunityId }: { opportunityId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const snippetQuery = trpc.embed.scriptTag.useQuery(
    { opportunity_id: opportunityId },
    { enabled: open },
  );
  const snippet = unwrap<{ html: string }>(snippetQuery.data)?.html ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (non-secure context) — user can select text */
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={t.embed.button}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-md border border-ink-subtle bg-ink-surface/90 px-2 py-1 text-[11px] font-medium text-ink-secondary hover:border-civic/50 hover:text-civic"
      >
        <Code2 className="h-3 w-3" aria-hidden />
        {t.embed.button}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t.embed.dialogTitle}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-base/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-md border border-ink-subtle bg-ink-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-ink-primary">
                {t.embed.dialogTitle}
              </h3>
              <button
                type="button"
                aria-label={t.embed.close}
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink-primary"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-ink-muted">{t.embed.hint}</p>
            {snippetQuery.isLoading ? (
              <p className="mt-3 text-[12px] text-ink-muted">{t.embed.loading}</p>
            ) : snippetQuery.isError ? (
              <p role="alert" className="mt-3 text-[12px] text-status-danger">
                {t.embed.error}
              </p>
            ) : (
              <textarea
                readOnly
                value={snippet}
                rows={8}
                onFocus={(e) => e.target.select()}
                className="mt-3 w-full rounded-md border border-ink-subtle bg-ink-inset p-2 font-mono text-[11px] text-ink-secondary"
              />
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={copy}
                disabled={!snippet}
                className="inline-flex items-center gap-1.5 rounded-md border border-civic/40 bg-civic/10 px-3 py-1.5 text-[12px] font-medium text-civic hover:bg-civic/20 disabled:opacity-50"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
                {copied ? t.embed.copied : t.embed.copy}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
