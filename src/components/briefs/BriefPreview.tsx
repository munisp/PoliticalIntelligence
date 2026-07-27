import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  History,
  Presentation,
  ScrollText,
  Stamp,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ApprovalBadge, { type ApprovalState } from "@/components/shared/ApprovalBadge";
import ApprovalHandoffCard from "@/components/shared/ApprovalHandoffCard";
import ExportMenu, { type ExportKind } from "@/components/shared/ExportMenu";
import { approvalStateLabel } from "@/lib/trpc-data";
import {
  formatDate,
  formatDateTime,
  parseBriefContent,
  parseModelRouting,
  type BriefRow,
} from "./brief-utils";

export interface BriefPreviewProps {
  brief: BriefRow;
  /** Envelope request id for the briefs.get call (export footers). */
  requestId: string | null;
  view: "document" | "slides";
  onViewChange: (v: "document" | "slides") => void;
  /** Resolved platform role of the current user. */
  role: string;
  isAuthenticated: boolean;
  onApprove: (comment: string) => void;
  onReturn: (comment: string) => void;
  onSignOff: (comment: string) => void;
  /** Returned briefs: re-submit a revised draft to the same reviewer. */
  onResolve: () => void;
  pendingAction: "approve" | "return" | "signoff" | "resolve" | null;
  lastExported: Partial<Record<ExportKind, string>>;
  onExport: (kind: ExportKind) => void;
}

const CHAIN: { role: string; states: string[] }[] = [
  { role: "Analyst", states: ["draft", "returned"] },
  { role: "Chief of Staff", states: ["in_review"] },
  { role: "Governor", states: ["approved", "signed_off"] },
];

function nextApproverFor(state: string): { name: string; role: string } {
  if (state === "in_review") return { name: "Chief of Staff", role: "Executive office" };
  if (state === "approved") return { name: "Governor", role: "Executive sign-off" };
  if (state === "returned") return { name: "Originating analyst", role: "Policy analyst" };
  return { name: "Chief of Staff", role: "Executive office" };
}

/** Gold seal stamp (design: spring 0.8→1.15→1, 300ms shimmer). */
function GoldSeal() {
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0, rotate: -14 }}
      animate={{ scale: [0.8, 1.15, 1], opacity: 1, rotate: -8 }}
      transition={{ duration: 0.6, times: [0, 0.55, 1], ease: [0.16, 1, 0.3, 1] }}
      aria-hidden
      className="relative inline-flex h-20 w-20 items-center justify-center rounded-full border-2 border-gold/80"
    >
      <span className="absolute inset-1 rounded-full border border-gold/50" />
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.4] }}
        transition={{ duration: 0.3, delay: 0.35 }}
        className="absolute inset-0 rounded-full bg-gold/15"
      />
      <span className="flex flex-col items-center text-gold">
        <Stamp aria-hidden className="h-5 w-5" />
        <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.12em]">
          Signed off
        </span>
      </span>
    </motion.span>
  );
}

export default function BriefPreview({
  brief,
  requestId,
  view,
  onViewChange,
  role,
  isAuthenticated,
  onApprove,
  onReturn,
  onSignOff,
  onResolve,
  pendingAction,
  lastExported,
  onExport,
}: BriefPreviewProps) {
  const content = useMemo(() => parseBriefContent(brief.content), [brief.content]);
  const routing = useMemo(() => parseModelRouting(brief.modelRouting), [brief.modelRouting]);
  const state = approvalStateLabel(brief.reviewState) as ApprovalState;
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [signComment, setSignComment] = useState("");
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const citations = content?.citations_rail ?? [];
  const history = brief.approval_history ?? [];
  const lastReturn = [...history].reverse().find((e) => (e.toState ?? e.to_state) === "returned");

  const canReview =
    isAuthenticated && ["policy_analyst", "executive", "platform_admin"].includes(role);
  const canSign = isAuthenticated && role === "executive";

  /* Scroll spy: highlight the section in view + citation rail indicator. */
  useEffect(() => {
    const els = sectionRefs.current.filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            const idx = Number((en.target as HTMLElement).dataset.sectionIdx ?? 0);
            setActiveSection(idx);
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [content]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-4"
    >
      {/* Returned banner */}
      {brief.reviewState === "returned" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning"
        >
          <Undo2 aria-hidden className="h-4 w-4 shrink-0" />
          <span className="font-medium">Returned with comments</span>
          {lastReturn?.comment && (
            <span className="text-ink-secondary">— “{lastReturn.comment}”</span>
          )}
          <button
            type="button"
            onClick={onResolve}
            disabled={pendingAction !== null || !canReview}
            className={cn(
              "ml-auto rounded-md px-2.5 py-1 text-xs font-medium",
              canReview
                ? "bg-status-warning/20 text-status-warning hover:bg-status-warning/30"
                : "cursor-not-allowed bg-ink-elevated text-ink-muted",
            )}
            title={canReview ? "Re-submit a revised draft to the same reviewer" : "Requires analyst or executive role"}
          >
            {pendingAction === "resolve" ? "Re-submitting…" : "Resolve"}
          </button>
        </div>
      )}

      {/* Output bar */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-ink-subtle bg-ink-surface px-3 py-2"
        data-print-hidden
      >
        <div
          role="group"
          aria-label="Preview mode"
          className="flex rounded-md border border-ink-subtle p-0.5"
        >
          {(
            [
              { id: "document", label: "Document", Icon: ScrollText },
              { id: "slides", label: "Presentation", Icon: Presentation },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onViewChange(id)}
              aria-pressed={view === id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                view === id
                  ? "bg-civic/15 text-civic"
                  : "text-ink-secondary hover:text-ink-primary",
              )}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden font-mono text-[10px] text-ink-muted sm:inline">
          req {requestId ?? brief.requestId ?? "—"}
        </span>
        <span data-export-menu-trigger className="contents">
          <ExportMenu
            onExport={onExport}
            lastExported={lastExported}
            requestId={requestId ?? brief.requestId ?? undefined}
          />
        </span>
      </div>

      {routing?.fallback && (
        <p role="status" className="rounded-md border border-ink-subtle bg-ink-elevated px-3 py-1.5 text-xs text-ink-secondary" data-print-hidden>
          <span className="font-medium text-status-warning">Template-assembled · not AI-synthesized</span>
          {" "}— generated by deterministic template assembly (routing tier: {routing.tier ?? "offline-fallback"}).
        </p>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* Document */}
        <article
          aria-label={`Brief preview: ${brief.title}`}
          className="min-w-0 flex-1 rounded-md border border-ink-subtle bg-ink-surface p-6 sm:p-8"
        >
          {/* Formal memo header */}
          <header className="border-b-2 border-gold/40 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <img src="/logo-mark.svg" alt="" width={44} height={44} />
                <div>
                  <p className="caption-label text-gold">Kaduna State — Office of the Governor</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                    Meridian Policy Twin · Executive brief
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {brief.reviewState === "signed_off" && <GoldSeal />}
                <span className="rounded-full border border-ink-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                  Official — Internal
                </span>
              </div>
            </div>
            <h2 className="mt-4 font-serif text-[20px] font-semibold leading-[30px] text-ink-primary">
              {content?.title ?? brief.title}
            </h2>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-secondary">
              <div className="flex gap-1.5">
                <dt className="text-ink-muted">Date:</dt>
                <dd>{formatDate(brief.createdAt)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-muted">Ref:</dt>
                <dd className="font-mono">{brief.briefId}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-muted">State:</dt>
                <dd>
                  <ApprovalBadge state={state} />
                </dd>
              </div>
              {brief.signedOffAt && (
                <div className="flex gap-1.5">
                  <dt className="text-ink-muted">Signed off:</dt>
                  <dd className="text-gold">{formatDateTime(brief.signedOffAt)}</dd>
                </div>
              )}
            </dl>
          </header>

          {/* Serif body sections with superscript citation markers */}
          {content && content.sections.length > 0 ? (
            content.sections.map((s, i) => (
              <section
                key={`${s.heading}-${i}`}
                data-section-idx={i}
                ref={(el) => {
                  sectionRefs.current[i] = el;
                }}
                className="mt-6"
              >
                <h3
                  className={cn(
                    "font-serif text-[20px] font-semibold leading-[30px] transition-colors",
                    activeSection === i ? "text-civic" : "text-ink-primary",
                  )}
                >
                  {s.heading}
                </h3>
                <p className="mt-2 font-serif text-[15px] leading-[26px] text-ink-secondary">
                  {s.body}
                  {citations.length > 0 &&
                    Array.from({
                      length: Math.min(2, citations.length),
                    }).map((_, k) => {
                      const n = (i * 2 + k) % citations.length;
                      return (
                        <sup key={k}>
                          <button
                            type="button"
                            onMouseEnter={() => setActiveCitation(n)}
                            onMouseLeave={() => setActiveCitation(null)}
                            onFocus={() => setActiveCitation(n)}
                            onBlur={() => setActiveCitation(null)}
                            aria-label={`Citation ${n + 1}: ${citations[n].citation}`}
                            className={cn(
                              "ml-0.5 rounded px-0.5 font-mono text-[11px] transition-colors",
                              activeCitation === n
                                ? "bg-civic/20 text-civic"
                                : "text-civic-periwinkle hover:text-civic",
                            )}
                          >
                            [{n + 1}]
                          </button>
                        </sup>
                      );
                    })}
                </p>
              </section>
            ))
          ) : (
            <p className="mt-6 font-serif text-[15px] leading-[26px] text-ink-muted">
              {brief.reviewState === "draft"
                ? "This brief is a draft shell — generation has not completed yet. Run “Generate brief” to assemble the document."
                : "No structured content is attached to this brief."}
            </p>
          )}

          {/* Printed citation annex (also visible on screen at the foot) */}
          {citations.length > 0 && (
            <footer className="mt-8 border-t border-ink-subtle pt-4">
              <h4 className="caption-label text-ink-muted">Cited sources</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-5 font-serif text-[13px] leading-6 text-ink-secondary">
                {citations.map((c, i) => (
                  <li
                    key={`${c.evidence_source_id}-${i}`}
                    className={cn(activeCitation === i && "text-civic")}
                  >
                    {c.citation}
                    <span className="ml-2 font-mono text-[10px] text-ink-muted">
                      {c.evidence_source_id}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 font-mono text-[10px] text-ink-muted">
                Generated {formatDateTime(brief.updatedAt)} · Request ID{" "}
                {requestId ?? brief.requestId ?? "—"} · Approval state{" "}
                {approvalStateLabel(brief.reviewState)}
              </p>
            </footer>
          )}
        </article>

        {/* Margin rail: citation rail + approval sidebar */}
        <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[360px]" data-print-hidden>
          {/* Citation rail */}
          <section
            aria-label="Citation rail"
            className="rounded-md border border-ink-subtle bg-ink-surface p-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="caption-label text-ink-muted">Citation rail</h3>
              <span
                aria-hidden
                className="h-4 w-[3px] rounded-full transition-colors"
                style={{ backgroundColor: "var(--civic, #3FAE9E)", opacity: 0.4 + activeSection * 0.15 }}
              />
            </div>
            {citations.length > 0 ? (
              <ol className="mt-2 space-y-2">
                {citations.map((c, i) => (
                  <li
                    key={`${c.evidence_source_id}-rail-${i}`}
                    onMouseEnter={() => setActiveCitation(i)}
                    onMouseLeave={() => setActiveCitation(null)}
                    className={cn(
                      "rounded-md border p-2 transition-colors duration-150",
                      activeCitation === i
                        ? "border-civic bg-civic/10"
                        : "border-ink-subtle bg-ink-elevated",
                    )}
                  >
                    <p className="font-mono text-[10px] text-civic">[{i + 1}]</p>
                    <p className="mt-0.5 text-xs leading-4 text-ink-secondary">{c.citation}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-ink-muted">
                      {c.evidence_source_id}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 rounded-md border border-dashed border-ink-subtle p-3 text-xs text-ink-muted">
                No citations attached to this generated draft. Citations appear here once the
                evidence rail is populated.
              </p>
            )}
          </section>

          {/* Approval sidebar */}
          <section aria-label="Approval" className="rounded-md border border-ink-subtle bg-ink-surface p-3">
            <h3 className="caption-label text-ink-muted">Approval chain</h3>
            <ol className="mt-2 space-y-1.5">
              {CHAIN.map((step) => {
                const current = step.states.includes(brief.reviewState);
                return (
                  <li key={step.role} className="flex items-center gap-2 text-xs">
                    <span
                      aria-hidden
                      className={cn(
                        "h-2 w-2 rounded-full",
                        current ? "bg-civic" : "bg-ink-subtle",
                      )}
                    />
                    <span className={current ? "font-medium text-ink-primary" : "text-ink-muted"}>
                      {step.role}
                    </span>
                    {current && (
                      <span className="rounded-full bg-civic/15 px-1.5 py-px text-[10px] font-medium text-civic">
                        current
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>

            <div className="mt-3">
              {brief.reviewState === "approved" ? (
                <div className="rounded-md border border-gold/40 bg-gold/5 p-3">
                  <p className="text-xs text-ink-secondary">
                    Approved by the Chief of Staff. Executive sign-off applies the gold seal.
                  </p>
                  <label className="mt-2 block">
                    <span className="caption-label text-ink-muted">Sign-off comment</span>
                    <textarea
                      value={signComment}
                      onChange={(e) => setSignComment(e.target.value)}
                      rows={2}
                      placeholder="Optional comment for the record…"
                      className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset p-2 text-xs text-ink-primary placeholder:text-ink-muted focus:border-gold"
                    />
                  </label>
                  <span title={canSign ? undefined : "Sign-off requires the executive role"}>
                    <button
                      type="button"
                      disabled={!canSign || pendingAction !== null}
                      onClick={() => onSignOff(signComment)}
                      className={cn(
                        "mt-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-transform",
                        canSign
                          ? "bg-gold text-ink-base hover:brightness-110 active:scale-[0.98]"
                          : "cursor-not-allowed bg-ink-elevated text-ink-muted",
                      )}
                    >
                      <Stamp aria-hidden className="h-4 w-4" />
                      {pendingAction === "signoff" ? "Signing off…" : "Sign off"}
                    </button>
                  </span>
                  {!canSign && (
                    <p className="mt-1.5 text-[11px] text-ink-muted">
                      Sign-off requires the executive role.
                    </p>
                  )}
                </div>
              ) : brief.reviewState === "signed_off" ? (
                <p className="rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-gold">
                  Signed off {formatDateTime(brief.signedOffAt)}. This brief is final and carries
                  the executive gold seal.
                </p>
              ) : brief.reviewState === "draft" ? (
                <p className="rounded-md border border-ink-subtle bg-ink-elevated p-3 text-xs text-ink-muted">
                  Draft — the approval chain activates once generation completes and the brief
                  enters review.
                </p>
              ) : (
                <ApprovalHandoffCard
                  title={brief.title}
                  summary={
                    brief.reviewState === "returned"
                      ? "Resolve the reviewer's comments, then re-submit."
                      : "Review the generated brief and evidence rail before approving."
                  }
                  state={state}
                  nextApprover={nextApproverFor(brief.reviewState)}
                  canAct={canReview && pendingAction === null}
                  disabledReason="Requires the policy analyst or executive role."
                  onApprove={onApprove}
                  onReturn={onReturn}
                />
              )}
            </div>

            {/* State history timeline */}
            {history.length > 0 && (
              <div className="mt-3 border-t border-ink-subtle pt-2">
                <button
                  type="button"
                  onClick={() => setTimelineOpen((o) => !o)}
                  aria-expanded={timelineOpen}
                  className="flex w-full items-center justify-between py-1 text-xs font-medium text-ink-secondary hover:text-ink-primary"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <History aria-hidden className="h-3.5 w-3.5" />
                    State history ({history.length})
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={cn("h-3.5 w-3.5 transition-transform", timelineOpen && "rotate-180")}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {timelineOpen && (
                    <motion.ol
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24 }}
                      className="overflow-hidden"
                    >
                      {history.map((e, i) => {
                        const to = e.toState ?? e.to_state ?? "?";
                        const from = e.fromState ?? e.from_state ?? "—";
                        const at = e.createdAt ?? e.created_at;
                        const actor = e.actorId ?? e.actor_id;
                        return (
                          <li
                            key={String(e.eventId ?? i)}
                            className="border-l-2 border-ink-subtle py-1.5 pl-3 text-[11px]"
                          >
                            <p className="text-ink-secondary">
                              <span className="font-mono text-ink-muted">{approvalStateLabel(from)}</span>
                              {" → "}
                              <span className="font-medium text-ink-primary">{approvalStateLabel(to)}</span>
                              {actor != null && (
                                <span className="text-ink-muted"> · actor #{actor}</span>
                              )}
                            </p>
                            <p className="font-mono text-[10px] text-ink-muted">{formatDateTime(at)}</p>
                            {e.comment && (
                              <p className="mt-0.5 italic text-ink-secondary">“{e.comment}”</p>
                            )}
                          </li>
                        );
                      })}
                    </motion.ol>
                  )}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>
      </div>
    </motion.div>
  );
}
