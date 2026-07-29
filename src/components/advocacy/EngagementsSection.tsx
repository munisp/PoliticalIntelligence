import { useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrap } from "@/lib/trpc-data";

/**
 * I5 — Advocacy CRM: engagement log form + history + next-action badge,
 * embedded in the StakeholderMap detail drawer (own-user scoped data).
 */

interface Engagement {
  id: number;
  engagedAt: string | Date;
  channel: string;
  outcome: string | null;
  commitments: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
}

const CHANNELS = ["meeting", "call", "email", "roundtable", "site_visit", "other"] as const;

export default function EngagementsSection({ stakeholderId }: { stakeholderId: string }) {
  const t = useT();
  const engagementsQuery = trpc.advocacy.engagements.useQuery({ stakeholderId });
  const logMutation = trpc.advocacy.logEngagement.useMutation({
    onSuccess: () => {
      engagementsQuery.refetch();
      setChannel("meeting");
      setOutcome("");
      setCommitments("");
      setNextAction("");
      setNextActionDate("");
      setFormOpen(false);
    },
  });

  const [formOpen, setFormOpen] = useState(false);
  const [channel, setChannel] = useState<string>("meeting");
  const [outcome, setOutcome] = useState("");
  const [commitments, setCommitments] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");

  const engagements: Engagement[] =
    unwrap<{ engagements: Engagement[] }>(engagementsQuery.data)?.engagements ?? [];

  // Next-action badge: nearest future (or overdue) dated action.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dated = engagements
    .filter((e) => e.nextAction && e.nextActionDate)
    .map((e) => ({ e, d: new Date(`${e.nextActionDate}T00:00:00`) }))
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  const next = dated.find((x) => x.d.getTime() >= today.getTime()) ?? dated[dated.length - 1];
  const overdue = next ? next.d.getTime() < today.getTime() : false;

  return (
    <section aria-label={t.engagements.title}>
      <h3 className="caption-label flex items-center justify-between text-ink-muted">
        <span>{t.engagements.title}</span>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-civic/40 bg-civic/10 px-2 py-0.5 text-[11px] font-medium text-civic hover:bg-civic/20"
        >
          <Plus className="h-3 w-3" aria-hidden />
          {t.engagements.log}
        </button>
      </h3>

      {next && (
        <p
          className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            overdue
              ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
              : "border-status-info/40 bg-status-info/10 text-status-info"
          }`}
        >
          <CalendarClock className="h-3 w-3" aria-hidden />
          {overdue ? t.engagements.overdue : t.engagements.nextActionBadge}:{" "}
          {next.e.nextAction} ({next.e.nextActionDate})
        </p>
      )}

      {formOpen && (
        <form
          className="mt-2 space-y-2 rounded-md border border-ink-subtle bg-ink-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            logMutation.mutate({
              stakeholderId,
              channel: channel as (typeof CHANNELS)[number],
              outcome: outcome || undefined,
              commitments: commitments || undefined,
              nextAction: nextAction || undefined,
              nextActionDate: nextActionDate || undefined,
            });
          }}
        >
          <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
            {t.engagements.channel}
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary"
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
            {t.engagements.outcome}
            <textarea
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              rows={2}
              className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
            {t.engagements.commitments}
            <textarea
              value={commitments}
              onChange={(e) => setCommitments(e.target.value)}
              rows={2}
              className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary"
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-ink-muted">
              {t.engagements.nextAction}
              <input
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              {t.engagements.nextActionDate}
              <input
                type="date"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
                className="rounded-md border border-ink-subtle bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary"
              />
            </label>
          </div>
          {logMutation.isError && (
            <p role="alert" className="text-[11px] text-status-danger">
              {t.engagements.error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={logMutation.isPending}
              className="rounded-md border border-civic/40 bg-civic/10 px-3 py-1.5 text-[12px] font-medium text-civic hover:bg-civic/20 disabled:opacity-50"
            >
              {t.engagements.save}
            </button>
          </div>
        </form>
      )}

      {engagementsQuery.isLoading ? (
        <p aria-busy="true" className="mt-2 text-[12px] text-ink-muted">
          {t.engagements.loading}
        </p>
      ) : engagements.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-muted">{t.engagements.empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {engagements.map((e) => (
            <li
              key={e.id}
              className="rounded-md border border-ink-subtle bg-ink-surface px-2.5 py-2"
            >
              <p className="text-[12px] text-ink-primary">
                <span className="font-medium uppercase">{e.channel}</span> ·{" "}
                {new Date(e.engagedAt).toLocaleDateString()}
              </p>
              {e.outcome && (
                <p className="mt-0.5 text-[12px] text-ink-secondary">{e.outcome}</p>
              )}
              {e.commitments && (
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {t.engagements.commitments}: {e.commitments}
                </p>
              )}
              {e.nextAction && (
                <p className="mt-0.5 text-[11px] text-status-info">
                  {t.engagements.nextAction}: {e.nextAction}
                  {e.nextActionDate ? ` (${e.nextActionDate})` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
