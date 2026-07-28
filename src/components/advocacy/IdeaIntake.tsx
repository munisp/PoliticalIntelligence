import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  FileText,
  Landmark,
  Lightbulb,
  ListOrdered,
  ScrollText,
  Send,
  ShieldAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrapData, type AnalyzeIdeaResult } from "./types";

const SECTORS = [
  "Agriculture",
  "Digital Economy",
  "Education",
  "Energy",
  "Finance",
  "Health",
  "Land & Housing",
  "Solid Minerals",
  "Tourism & Culture",
  "Trade & Industry",
  "Transport",
  "Water & Sanitation",
];

type Scope = "federal" | "state" | "both";

const EXAMPLES: {
  id: string;
  title: string;
  description: string;
  sector: string;
  scope: Scope;
}[] = [
  {
    id: "tourism",
    title: "Tourism payment platform",
    description:
      "A unified digital payment and booking platform for tourism sites in Kaduna State — park entry fees, guided tours, and craft-market vendor settlement, with revenue sharing to host communities.",
    sector: "Tourism & Culture",
    scope: "state",
  },
  {
    id: "land",
    title: "Land management platform",
    description:
      "Digitised land registry and cadastral management for Kaduna State — title search, C-of-O processing workflow, ground-rent billing, and dispute referral tracking across LGAs.",
    sector: "Land & Housing",
    scope: "both",
  },
];

function SectionCard({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-elevated p-3",
        className,
      )}
    >
      <h3 className="caption-label flex items-center gap-1.5 text-ink-muted">
        <Icon aria-hidden className="h-3.5 w-3.5" />
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s.includes("high") || s.includes("critical"))
    return "border-status-danger/40 bg-status-danger/10 text-status-danger";
  if (s.includes("med"))
    return "border-status-warning/40 bg-status-warning/10 text-status-warning";
  return "border-status-info/40 bg-status-info/10 text-status-info";
}

export default function IdeaIntake() {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sector, setSector] = useState(SECTORS[0]);
  const [scope, setScope] = useState<Scope>("both");
  const [result, setResult] = useState<AnalyzeIdeaResult | null>(null);

  const analyze = trpc.advocacy.analyzeIdea.useMutation({
    onSuccess: (payload) => setResult(unwrapData<AnalyzeIdeaResult>(payload)),
  });

  const canSubmit =
    title.trim().length > 0 && description.trim().length > 0 && !analyze.isPending;

  const fillExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setTitle(ex.title);
    setDescription(ex.description);
    setSector(ex.sector);
    setScope(ex.scope);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    analyze.mutate({ title, description, sector, jurisdictionScope: scope });
  };

  const inputCls =
    "w-full rounded-md border border-ink-subtle bg-ink-surface px-3 py-2 text-[13px] text-ink-primary placeholder:text-ink-muted focus:border-civic/60 focus:outline-none";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
      {/* ---------------- Intake form ---------------- */}
      <form
        onSubmit={submit}
        className="rounded-md border border-ink-subtle bg-ink-elevated p-4"
        aria-label={t.advocacy.intakeTitle}
      >
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-primary">
          <Lightbulb aria-hidden className="h-4 w-4 text-civic" />
          {t.advocacy.intakeTitle}
        </h2>

        <label className="mt-3 block">
          <span className="caption-label text-ink-muted">{t.advocacy.fieldTitle}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={cn(inputCls, "mt-1")}
            placeholder={EXAMPLES[0].title}
          />
        </label>

        <label className="mt-3 block">
          <span className="caption-label text-ink-muted">
            {t.advocacy.fieldDescription}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={6}
            className={cn(inputCls, "mt-1 resize-y")}
          />
        </label>

        <label className="mt-3 block">
          <span className="caption-label text-ink-muted">{t.advocacy.fieldSector}</span>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className={cn(inputCls, "mt-1")}
          >
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="mt-3">
          <legend className="caption-label text-ink-muted">
            {t.advocacy.fieldScope}
          </legend>
          <div className="mt-1 flex gap-1.5">
            {(
              [
                ["federal", t.advocacy.scopeFederal],
                ["state", t.advocacy.scopeState],
                ["both", t.advocacy.scopeBoth],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                  scope === value
                    ? "border-civic bg-civic/10 text-civic"
                    : "border-ink-subtle bg-ink-surface text-ink-secondary hover:border-ink-strong",
                )}
              >
                <input
                  type="radio"
                  name="jurisdiction-scope"
                  value={value}
                  checked={scope === value}
                  onChange={() => setScope(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "mt-4 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium",
            canSubmit
              ? "bg-civic text-ink-base hover:bg-civic-strong active:scale-[0.98]"
              : "cursor-not-allowed bg-ink-surface text-ink-muted",
          )}
        >
          <Send aria-hidden className="h-3.5 w-3.5" />
          {analyze.isPending ? t.advocacy.analyzing : t.advocacy.analyzeCta}
        </button>

        {analyze.isError && (
          <p role="alert" className="mt-3 text-[13px] text-status-danger">
            {t.advocacy.analyzeError}
          </p>
        )}
      </form>

      {/* ---------------- Results / empty state ---------------- */}
      <div aria-live="polite">
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-ink-subtle bg-ink-surface/40 p-6 text-center"
            >
              <Lightbulb aria-hidden className="h-8 w-8 text-ink-muted" />
              <h2 className="mt-3 text-[15px] font-semibold text-ink-primary">
                {t.advocacy.intakeEmptyTitle}
              </h2>
              <p className="mt-1 max-w-md text-[13px] text-ink-secondary">
                {t.advocacy.intakeEmptyBody}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => fillExample(ex.id)}
                    className="rounded-full border border-civic/40 bg-civic/10 px-3 py-1.5 text-[13px] font-medium text-civic hover:bg-civic/20"
                  >
                    {ex.id === "tourism"
                      ? t.advocacy.exampleTourism
                      : t.advocacy.exampleLand}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-ink-muted">
                {t.advocacy.noResults}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <h2 className="text-[15px] font-semibold text-ink-primary">
                {t.advocacy.resultsTitle}
              </h2>

              <SectionCard icon={Landmark} title={t.advocacy.matchedPathways}>
                {result.matchedPathways.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">
                    {t.common.emptyGeneric}
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {result.matchedPathways.map((m) => (
                      <li key={m.pathwayId}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[13px] font-medium text-ink-primary">
                            {m.title}
                          </span>
                          <span className="font-mono text-xs text-civic">
                            {Math.round(m.fitScore * 100)}%
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuenow={Math.round(m.fitScore * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${t.advocacy.fitScore} — ${m.title}`}
                          className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-inset"
                        >
                          <div
                            className="h-full rounded-full bg-civic"
                            style={{ width: `${Math.round(m.fitScore * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[12px] text-ink-secondary">
                          {m.rationale}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <div className="grid gap-3 md:grid-cols-2">
                <SectionCard icon={ScrollText} title={t.advocacy.supportingLaws}>
                  {result.supportingLaws.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                  ) : (
                    <ul className="space-y-2">
                      {result.supportingLaws.map((l) => (
                        <li key={l.ref} className="text-[13px]">
                          <span className="font-mono text-xs text-civic">{l.ref}</span>{" "}
                          <span className="font-medium text-ink-primary">{l.title}</span>
                          <p className="text-[12px] text-ink-secondary">{l.relevance}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard icon={AlertTriangle} title={t.advocacy.gaps}>
                  {result.gaps.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-secondary">
                      {result.gaps.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard icon={FileText} title={t.advocacy.licenses}>
                  {result.licenses.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                  ) : (
                    <ul className="space-y-2">
                      {result.licenses.map((l) => (
                        <li key={l.name} className="text-[13px]">
                          <span className="font-medium text-ink-primary">{l.name}</span>
                          <span className="text-ink-muted"> · {l.issuer}</span>
                          <p className="text-[12px] text-ink-secondary">
                            {l.requirement} — {l.typical_timeline}; {l.cost_note}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard icon={ShieldAlert} title={t.advocacy.constraints}>
                  {result.constraints.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                  ) : (
                    <ul className="space-y-2">
                      {result.constraints.map((c, i) => (
                        <li key={`${c.type}-${i}`} className="text-[13px]">
                          <span
                            className={cn(
                              "mr-1.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                              severityClass(c.severity),
                            )}
                          >
                            {c.severity}
                          </span>
                          <span className="font-medium text-ink-primary">{c.type}</span>
                          <p className="text-[12px] text-ink-secondary">{c.description}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </div>

              <SectionCard icon={Users} title={t.advocacy.recommendedStakeholders}>
                {result.recommendedStakeholders.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {result.recommendedStakeholders.map((s) => (
                      <li
                        key={s.stakeholderId}
                        title={s.lobbyAngle ?? undefined}
                        className="rounded-full border border-ink-subtle bg-ink-surface px-2.5 py-1 text-xs text-ink-secondary"
                      >
                        <span className="font-medium text-ink-primary">{s.name}</span>
                        <span className="text-ink-muted"> · {s.kind.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard icon={ListOrdered} title={t.advocacy.nextSteps}>
                {result.nextSteps.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">{t.common.emptyGeneric}</p>
                ) : (
                  <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-secondary">
                    {result.nextSteps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                )}
              </SectionCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
