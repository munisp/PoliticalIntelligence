import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  BookOpenText,
  ChevronDown,
  CircleGauge,
  FlaskConical,
  Link2,
  Loader2,
  Plus,
  Scale,
  Search,
  Sparkles,
  Unlink,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  hashSeed,
  seededRandom,
  templateById,
  TEMPLATES,
  type TemplateId,
} from "./brief-utils";

/* ------------------------------------------------------------------ */
/* Entity references + evidence pack                                   */
/* ------------------------------------------------------------------ */

export type EntityKind = "metric" | "opportunity" | "simulation" | "clause";

export interface EntityRef {
  id: string;
  kind: EntityKind;
  label: string;
}

export interface EvidencePackSource {
  id: string;
  title: string;
  issuer: string;
  date: string;
  relevance: number;
  entityId: string | null;
  detached?: { reason: string };
}

const ENTITY_TOOLS: {
  kind: EntityKind;
  label: string;
  Icon: typeof CircleGauge;
  samples: string[];
}[] = [
  {
    kind: "metric",
    label: "Metric",
    Icon: CircleGauge,
    samples: ["Jobs created YTD", "SME registrations", "School enrolment rate"],
  },
  {
    kind: "opportunity",
    label: "Opportunity",
    Icon: BarChart3,
    samples: ["SME credit facility", "Agro-processing corridor", "Digital services hub"],
  },
  {
    kind: "simulation",
    label: "Simulation run",
    Icon: FlaskConical,
    samples: ["Baseline forecast 2025–27", "Phased procurement scenario"],
  },
  {
    kind: "clause",
    label: "Clause citation",
    Icon: Scale,
    samples: ["Public Procurement Act 2007, s.16", "Education Regulations 2023, Sch. 2"],
  },
];

const ISSUERS = [
  "National Bureau of Statistics",
  "Kaduna State Bureau of Statistics",
  "Corporate Affairs Commission",
  "Kaduna State Planning & Budget Commission",
  "Federal Ministry of Industry, Trade & Investment",
];

/** Deterministic auto-attached source for an inserted entity. */
function autoSourceFor(entity: EntityRef): EvidencePackSource {
  const rand = seededRandom(hashSeed(entity.id));
  const issuer = ISSUERS[Math.floor(rand() * ISSUERS.length)];
  const monthsAgo = Math.floor(rand() * 10);
  const d = new Date(Date.now() - monthsAgo * 30 * 86400000);
  return {
    id: `evs:${entity.id}`,
    title: `${entity.label} — source extract`,
    issuer,
    date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    relevance: Math.round((0.62 + rand() * 0.36) * 100) / 100,
    entityId: entity.id,
  };
}

/** Deterministic local corpus used by the evidence-pack search. */
const CORPUS: Omit<EvidencePackSource, "entityId">[] = [
  { id: "evs:nbs-lfs-q4", title: "Labour Force Survey Q4 2024", issuer: "National Bureau of Statistics", date: "12 Dec 2024", relevance: 0.91 },
  { id: "evs:school-census", title: "State School Census 2024", issuer: "Kaduna SUBEB", date: "28 Nov 2024", relevance: 0.86 },
  { id: "evs:cac-extract", title: "CAC registry extract — new incorporations", issuer: "Corporate Affairs Commission", date: "05 Jan 2025", relevance: 0.83 },
  { id: "evs:grid3", title: "GRID3 ward boundaries v3.2", issuer: "GRID3 Nigeria", date: "17 Oct 2024", relevance: 0.74 },
  { id: "evs:proc-baseline", title: "Procurement spend baseline FY2024", issuer: "Kaduna PPA", date: "02 Jan 2025", relevance: 0.8 },
];

let entitySeq = 0;

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

export interface ComposerOutput {
  templateId: TemplateId;
  title: string;
  sections: { eyebrow: string; body: string }[];
  entities: EntityRef[];
  evidence: EvidencePackSource[];
}

export interface BriefComposerProps {
  onGenerate: (out: ComposerOutput) => void;
  generating: boolean;
  /** Job progress 0–100 while the async job runs. */
  progress: number | null;
  canGenerate: boolean;
  disabledReason?: string;
  /** LLM routing unavailable → deterministic template assembly. */
  offlineFallback: boolean;
}

const STEP_CAPTIONS: { below: number; caption: string }[] = [
  { below: 40, caption: "Assembling evidence…" },
  { below: 75, caption: "Drafting sections…" },
  { below: 101, caption: "Validating citations…" },
];

function generationStep(progress: number | null): string {
  const p = progress ?? 0;
  return (STEP_CAPTIONS.find((s) => p < s.below) ?? STEP_CAPTIONS[0]).caption;
}

export default function BriefComposer({
  onGenerate,
  generating,
  progress,
  canGenerate,
  disabledReason = "Requires the policy analyst role to generate briefs.",
  offlineFallback,
}: BriefComposerProps) {
  const [templateId, setTemplateId] = useState<TemplateId>("decision");
  const [title, setTitle] = useState("");
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ "0": true });
  const [entities, setEntities] = useState<EntityRef[]>([]);
  const [detached, setDetached] = useState<Record<string, { reason: string }>>({});
  const [detachFor, setDetachFor] = useState<string | null>(null);
  const [detachReason, setDetachReason] = useState("");
  const [added, setAdded] = useState<EvidencePackSource[]>([]);
  const [corpusQuery, setCorpusQuery] = useState("");
  const [packOpen, setPackOpen] = useState(true);

  const template = templateById(templateId);

  const pack = useMemo<EvidencePackSource[]>(() => {
    const auto = entities.map((e) => autoSourceFor(e));
    return [...auto, ...added].map((s) =>
      detached[s.id] ? { ...s, detached: detached[s.id] } : s,
    );
  }, [entities, added, detached]);

  const corpusResults = useMemo(() => {
    const q = corpusQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return CORPUS.filter(
      (c) =>
        (c.title.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q)) &&
        !added.some((a) => a.id === c.id),
    ).slice(0, 4);
  }, [corpusQuery, added]);

  const insertEntity = (kind: EntityKind, sample: string) => {
    entitySeq += 1;
    const entity: EntityRef = {
      id: `ent:${kind}:${Date.now().toString(36)}:${entitySeq}`,
      kind,
      label: sample,
    };
    setEntities((prev) => [...prev, entity]);
  };

  const submit = () => {
    if (!canGenerate || generating || title.trim().length < 3) return;
    onGenerate({
      templateId,
      title: title.trim(),
      sections: template.sections.map((s, i) => ({
        eyebrow: s.eyebrow,
        body: bodies[String(i)] ?? "",
      })),
      entities,
      evidence: pack.filter((s) => !s.detached),
    });
  };

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-print-hidden>
      <div className="min-w-0 flex-1">
        {/* Offline deterministic fallback banner */}
        {offlineFallback && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning"
          >
            <Unlink aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              LLM routing unavailable — briefs generated from structured template
              assembly only (no synthesized prose). Output is marked
              “Template-assembled · not AI-synthesized”.
            </span>
          </div>
        )}

        {/* Template picker */}
        <p className="caption-label text-ink-muted">Choose a template</p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {TEMPLATES.map((t, i) => {
            const active = t.id === templateId;
            return (
              <motion.button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                aria-pressed={active}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "rounded-md border p-3 text-left transition-colors",
                  active
                    ? "border-civic bg-civic/10"
                    : "border-ink-subtle bg-ink-surface hover:border-ink-strong",
                )}
              >
                <span className="block text-sm font-semibold text-ink-primary">
                  {t.name}
                </span>
                <span className="mt-0.5 block text-xs text-ink-secondary">
                  {t.tagline}
                </span>
                {/* Section skeleton preview */}
                <span aria-hidden className="mt-3 block space-y-1.5">
                  {t.sections.map((s) => (
                    <span key={s.eyebrow} className="block">
                      <span className="mb-1 block h-1.5 w-16 rounded bg-civic/40" />
                      <span className="block h-1.5 w-full rounded bg-ink-subtle" />
                      <span className="mt-1 block h-1.5 w-3/4 rounded bg-ink-subtle" />
                    </span>
                  ))}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* Title */}
        <label className="mt-5 block">
          <span className="caption-label text-ink-muted">Brief title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q1 2025 SME credit facility — decision brief"
            className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:border-civic"
          />
        </label>

        {/* Entity insertion toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Insert platform entities">
          <span className="caption-label mr-1 text-ink-muted">Insert:</span>
          {ENTITY_TOOLS.map(({ kind, label, Icon, samples }) => (
            <button
              key={kind}
              type="button"
              onClick={() => insertEntity(kind, samples[entities.length % samples.length])}
              className="inline-flex items-center gap-1 rounded-md border border-ink-subtle bg-ink-surface px-2 py-1 text-xs font-medium text-ink-secondary hover:border-civic-periwinkle/60 hover:text-ink-primary"
            >
              <Icon aria-hidden className="h-3.5 w-3.5 text-civic-periwinkle" />
              [{label}]
            </button>
          ))}
        </div>

        {/* Inserted entity chips (periwinkle, linked) */}
        {entities.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Inserted entities">
            <AnimatePresence>
              {entities.map((e) => (
                <motion.li
                  key={e.id}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  transition={{ duration: 0.16 }}
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-civic-periwinkle/50 bg-civic-periwinkle/15 py-0.5 pl-2.5 pr-1 text-xs font-medium text-civic-periwinkle">
                    <Link2 aria-hidden className="h-3 w-3" />
                    {e.label}
                    <button
                      type="button"
                      aria-label={`Remove ${e.label}`}
                      onClick={() => setEntities((prev) => prev.filter((x) => x.id !== e.id))}
                      className="rounded-full p-0.5 hover:bg-civic-periwinkle/20"
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        {/* Structured sections */}
        <div className="mt-4 space-y-2">
          {template.sections.map((s, i) => {
            const key = String(i);
            const open = openSections[key] ?? i === 0;
            return (
              <div
                key={`${templateId}-${key}`}
                className="overflow-hidden rounded-md border border-ink-subtle bg-ink-surface"
              >
                <button
                  type="button"
                  onClick={() => setOpenSections((p) => ({ ...p, [key]: !open }))}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <span className="caption-label text-civic">{s.eyebrow}</span>
                  <ChevronDown
                    aria-hidden
                    className={cn("h-4 w-4 text-ink-muted transition-transform", open && "rotate-180")}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                    >
                      <div className="px-3 pb-3">
                        <textarea
                          value={bodies[key] ?? ""}
                          onChange={(e) =>
                            setBodies((p) => ({ ...p, [key]: e.target.value }))
                          }
                          rows={4}
                          placeholder={s.placeholder}
                          aria-label={s.eyebrow}
                          className="w-full rounded-md border border-ink-subtle bg-ink-inset p-2 text-[13px] leading-5 text-ink-primary placeholder:text-ink-muted focus:border-civic"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Generation */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span title={canGenerate ? undefined : disabledReason}>
            <button
              type="button"
              onClick={submit}
              disabled={!canGenerate || generating || title.trim().length < 3}
              className={cn(
                "relative inline-flex min-w-[220px] items-center justify-center gap-2 overflow-hidden rounded-md px-4 py-2 text-sm font-medium transition-transform",
                canGenerate && !generating
                  ? "bg-civic text-ink-base hover:bg-civic-strong active:scale-[0.98]"
                  : "cursor-not-allowed bg-ink-elevated text-ink-muted",
              )}
            >
              {generating && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-civic/25 transition-[width] duration-300"
                  style={{ width: `${progress ?? 5}%` }}
                />
              )}
              {generating ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Sparkles aria-hidden className="h-4 w-4" />
              )}
              <span className="relative">{generating ? "Generating…" : "Generate brief"}</span>
            </button>
          </span>
          <span className="font-mono text-xs text-ink-muted">
            {offlineFallback ? "deterministic · template assembly" : "qwen3-32b · standard"}
          </span>
        </div>
        {/* Async job status — aria-live */}
        <p aria-live="polite" className="mt-2 min-h-[20px] text-[13px] text-ink-secondary">
          {generating ? generationStep(progress) : ""}
        </p>
      </div>

      {/* Evidence pack side panel */}
      <aside
        className={cn(
          "shrink-0 rounded-md border border-ink-subtle bg-ink-surface transition-[width]",
          packOpen ? "w-full xl:w-[320px]" : "w-full xl:w-11",
        )}
        aria-label="Evidence pack"
      >
        <button
          type="button"
          onClick={() => setPackOpen((o) => !o)}
          aria-expanded={packOpen}
          className="flex w-full items-center justify-between px-3 py-2"
        >
          <span className={cn("caption-label text-ink-muted", !packOpen && "xl:hidden")}>
            Evidence pack · {pack.filter((s) => !s.detached).length} sources
          </span>
          <BookOpenText aria-hidden className="h-4 w-4 text-ink-muted" />
        </button>
        {packOpen && (
          <div className="border-t border-ink-subtle p-3">
            <label className="relative block">
              <span className="sr-only">Search corpus to add sources</span>
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={corpusQuery}
                onChange={(e) => setCorpusQuery(e.target.value)}
                placeholder="Add sources via corpus search…"
                className="w-full rounded-md border border-ink-subtle bg-ink-inset py-1.5 pl-8 pr-2 text-xs text-ink-primary placeholder:text-ink-muted focus:border-civic"
              />
            </label>
            {corpusResults.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-md border border-ink-subtle bg-ink-elevated p-1.5">
                {corpusResults.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setAdded((p) => [...p, { ...c, entityId: null }]);
                        setCorpusQuery("");
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-ink-primary hover:bg-ink-surface"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{c.title}</span>
                        <span className="block truncate text-[11px] text-ink-muted">{c.issuer}</span>
                      </span>
                      <Plus aria-hidden className="h-3.5 w-3.5 shrink-0 text-civic" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <ul className="mt-3 space-y-2">
              {pack.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "rounded-md border p-2.5",
                    s.detached
                      ? "border-dashed border-ink-subtle opacity-60"
                      : "border-ink-subtle bg-ink-elevated",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink-primary">{s.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                        {s.issuer} · {s.date}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-civic">
                        relevance {s.relevance.toFixed(2)}
                      </p>
                      {s.detached && (
                        <p className="mt-1 text-[11px] text-status-warning">
                          Detached — {s.detached.reason}
                        </p>
                      )}
                    </div>
                    {!s.detached && (
                      <button
                        type="button"
                        onClick={() => {
                          setDetachFor(s.id);
                          setDetachReason("");
                        }}
                        aria-label={`Detach ${s.title}`}
                        className="shrink-0 rounded p-1 text-ink-muted hover:text-status-warning"
                      >
                        <Unlink aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {detachFor === s.id && !s.detached && (
                    <div className="mt-2 border-t border-ink-subtle pt-2">
                      <label className="block">
                        <span className="text-[11px] text-ink-secondary">Reason (required)</span>
                        <input
                          type="text"
                          value={detachReason}
                          onChange={(e) => setDetachReason(e.target.value)}
                          placeholder="Why is this source excluded?"
                          className="mt-1 w-full rounded border border-ink-subtle bg-ink-inset px-2 py-1 text-xs text-ink-primary placeholder:text-ink-muted focus:border-civic"
                        />
                      </label>
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          disabled={detachReason.trim().length === 0}
                          onClick={() => {
                            setDetached((p) => ({ ...p, [s.id]: { reason: detachReason.trim() } }));
                            setDetachFor(null);
                          }}
                          className={cn(
                            "rounded px-2 py-1 text-[11px] font-medium",
                            detachReason.trim().length
                              ? "bg-status-warning/15 text-status-warning"
                              : "cursor-not-allowed bg-ink-inset text-ink-muted",
                          )}
                        >
                          Detach
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetachFor(null)}
                          className="rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
              {pack.length === 0 && (
                <li className="rounded-md border border-dashed border-ink-subtle p-4 text-center text-xs text-ink-muted">
                  Insert entities to auto-attach evidence, or add sources from the corpus.
                </li>
              )}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
