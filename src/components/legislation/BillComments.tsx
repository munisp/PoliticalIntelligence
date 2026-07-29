import { useMemo, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrapData } from "@/components/dashboard/utils";

interface ThemeBucket {
  theme: string;
  total: number;
  support: number;
  oppose: number;
  neutral: number;
  suggestion: number;
}

interface CommentRow {
  comment_id: string;
  pseudonym: string;
  body: string;
  sentiment_hint: string;
  theme_tags: string[];
  created_at: string | Date;
}

const SENTIMENT_COLORS: Record<string, string> = {
  support: "bg-emerald-500",
  oppose: "bg-rose-500",
  neutral: "bg-ink-subtle",
  suggestion: "bg-amber-500",
};

/**
 * I6 — Public participation: theme-summary bar + visible comments + a
 * comment form (anonymous allowed with a pseudonym).
 */
export default function BillComments({ lawId }: { lawId: string }) {
  const t = useT();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [sentiment, setSentiment] = useState<
    "support" | "oppose" | "neutral" | "suggestion"
  >("neutral");

  const listQ = trpc.participation.list.useQuery(
    { law_id: lawId },
    { enabled: open },
  );
  const themesQ = trpc.participation.themes.useQuery(
    { law_id: lawId },
    { enabled: open },
  );
  const commentM = trpc.participation.comment.useMutation({
    onSuccess: () => {
      setBody("");
      void utils.participation.list.invalidate({ law_id: lawId });
      void utils.participation.themes.invalidate({ law_id: lawId });
    },
  });

  const comments: CommentRow[] = useMemo(
    () => (unwrapData(listQ.data) as CommentRow[] | undefined) ?? [],
    [listQ.data],
  );
  const themes = useMemo(
    () =>
      unwrapData(themesQ.data) as
        | { total_comments: number; themes: ThemeBucket[] }
        | undefined,
    [themesQ.data],
  );

  return (
    <section className="mt-3 rounded-md border border-ink-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-ink-secondary hover:text-ink-primary"
      >
        <MessageSquare aria-hidden className="h-4 w-4 text-civic" />
        {t.participation.title}
        <span className="ml-auto font-mono text-[11px] text-ink-muted">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="border-t border-ink-subtle px-3 py-3">
          {/* Theme summary bar */}
          {themes && themes.themes.length > 0 && (
            <div className="mb-3">
              <p className="caption-label mb-1.5 text-ink-muted">
                {t.participation.themeSummary} · {themes.total_comments}
              </p>
              <div className="space-y-1.5">
                {themes.themes.slice(0, 6).map((b) => {
                  const segments = (["support", "neutral", "suggestion", "oppose"] as const).filter(
                    (s) => b[s] > 0,
                  );
                  return (
                    <div key={b.theme} className="flex items-center gap-2">
                      <span className="w-32 truncate font-mono text-[11px] text-ink-muted">
                        {b.theme}
                      </span>
                      <div
                        className="flex h-2 flex-1 overflow-hidden rounded-full bg-ink-inset"
                        role="img"
                        aria-label={`${b.theme}: ${b.total} comments`}
                      >
                        {segments.map((s) => (
                          <div
                            key={s}
                            className={SENTIMENT_COLORS[s]}
                            style={{ width: `${(b[s] / b.total) * 100}%` }}
                          />
                        ))}
                      </div>
                      <span className="w-8 text-right font-mono text-[11px] text-ink-muted">
                        {b.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Comment form */}
          <form
            className="mb-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim().length < 3) return;
              commentM.mutate({
                law_id: lawId,
                body: body.trim(),
                sentiment_hint: sentiment,
                pseudonym: pseudonym.trim() || undefined,
              });
            }}
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder={t.participation.placeholder}
              className="w-full rounded-md border border-ink-subtle bg-ink-inset px-2 py-1.5 text-[13px] text-ink-primary placeholder:text-ink-muted focus:border-civic/60 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={pseudonym}
                onChange={(e) => setPseudonym(e.target.value)}
                maxLength={128}
                placeholder={t.participation.pseudonym}
                className="rounded-md border border-ink-subtle bg-ink-inset px-2 py-1 text-[12px] text-ink-primary placeholder:text-ink-muted focus:border-civic/60 focus:outline-none"
              />
              <select
                value={sentiment}
                onChange={(e) =>
                  setSentiment(e.target.value as typeof sentiment)
                }
                className="rounded-md border border-ink-subtle bg-ink-inset px-2 py-1 text-[12px] text-ink-primary focus:border-civic/60 focus:outline-none"
              >
                <option value="support">{t.participation.sentimentSupport}</option>
                <option value="oppose">{t.participation.sentimentOppose}</option>
                <option value="neutral">{t.participation.sentimentNeutral}</option>
                <option value="suggestion">{t.participation.sentimentSuggestion}</option>
              </select>
              <button
                type="submit"
                disabled={commentM.isPending || body.trim().length < 3}
                className="inline-flex items-center gap-1 rounded-md border border-civic/40 bg-civic/10 px-2.5 py-1 text-[12px] font-medium text-civic hover:bg-civic/20 disabled:opacity-50"
              >
                <Send aria-hidden className="h-3 w-3" />
                {t.participation.submit}
              </button>
              {commentM.isError && (
                <span className="text-[12px] text-rose-500">
                  {t.participation.submitError}
                </span>
              )}
            </div>
          </form>

          {/* Comment list */}
          {listQ.isLoading ? (
            <p className="text-[12px] text-ink-muted">{t.participation.loading}</p>
          ) : comments.length === 0 ? (
            <p className="text-[12px] text-ink-muted">{t.participation.empty}</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li
                  key={c.comment_id}
                  className="rounded-md border border-ink-subtle/60 bg-ink-inset px-2.5 py-2"
                >
                  <p className="text-[13px] text-ink-primary">{c.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                    <span className="font-medium">{c.pseudonym}</span>
                    <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] text-white ${SENTIMENT_COLORS[c.sentiment_hint] ?? "bg-ink-subtle"}`}>
                      {c.sentiment_hint}
                    </span>
                    {c.theme_tags.map((tag) => (
                      <span key={tag} className="font-mono text-[10px]">
                        #{tag}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
