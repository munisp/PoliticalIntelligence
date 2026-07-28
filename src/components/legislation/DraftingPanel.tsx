import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSignature,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { unwrapData } from "@/components/legislation/types";

/**
 * G4 — evidence-grounded drafting wizard.
 * (1) purpose/outcomes → (2) evidence picker → (3) clause generation &
 * review with per-clause grounding badges → (4) RIA annex preview →
 * (5) Akoma Ntoso export.
 */

type DraftedClause = {
  section: string;
  section_path: string;
  heading: string;
  text: string;
  grounding: { kind: string; id: string; note: string }[];
};

type RiaAnnex = {
  simulation_run_id: string;
  engine: string;
  consensus_summary: string;
  point_estimates: {
    metric: string;
    unit: string;
    value: number;
    lower: number;
    upper: number;
    horizon_months: number;
  }[];
  assumptions: string[];
  reproducibility_hash: string;
  citations: { evidence_source_id: string; citation: string }[];
};

const STEPS = ["Purpose", "Evidence", "Clauses", "RIA annex", "Export"] as const;

const KIND_BADGE: Record<string, string> = {
  simulation_run: "bg-civic/15 text-civic",
  opportunity: "bg-emerald-500/15 text-emerald-400",
  citation: "bg-amber-500/15 text-amber-400",
};

export default function DraftingPanel({
  open,
  onClose,
  onNotice,
}: {
  open: boolean;
  onClose: () => void;
  onNotice: (msg: string) => void;
}) {
  const utils = trpc.useUtils();
  const [step, setStep] = useState(0);

  /* Step 1 — purpose */
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [outcomes, setOutcomes] = useState("");

  /* Step 2 — evidence */
  const [simulationRunId, setSimulationRunId] = useState("");
  const [opportunityIds, setOpportunityIds] = useState<string[]>([]);
  const [citationIds, setCitationIds] = useState("");
  const [lawId, setLawId] = useState<string | null>(null);

  /* Step 3 — clauses */
  const [clauses, setClauses] = useState<DraftedClause[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  /* Step 4 — RIA */
  const [ria, setRia] = useState<RiaAnnex | null>(null);

  const rankingsQuery = trpc.opportunities.rankings.useQuery(
    { limit: 20 },
    { enabled: open },
  );
  const opportunities = useMemo(() => {
    const d = unwrapData<{ items?: { opportunityId: string; title: string }[] } & Record<string, unknown>>(rankingsQuery.data);
    const items = (d?.items ?? (d as unknown as { opportunities?: { opportunityId: string; title: string }[] })?.opportunities ?? []) as { opportunityId: string; title: string }[];
    return items;
  }, [rankingsQuery.data]);

  const createMutation = trpc.legislation.createDraft.useMutation({
    onError: (e) => onNotice(`Draft creation failed: ${e.message}`),
  });
  const generateMutation = trpc.legislation.generateClauses.useMutation({
    onError: (e) => onNotice(`Clause generation failed: ${e.message}`),
  });
  const editMutation = trpc.legislation.updateDraftClause.useMutation({
    onError: (e) => onNotice(`Clause edit failed: ${e.message}`),
  });
  const riaMutation = trpc.legislation.attachRIA.useMutation({
    onError: (e) => onNotice(`RIA attach failed: ${e.message}`),
  });
  const exportMutation = trpc.legislation.exportDraftAkn.useMutation({
    onError: (e) => onNotice(`AKN export failed: ${e.message}`),
  });

  const busy =
    createMutation.isPending ||
    generateMutation.isPending ||
    riaMutation.isPending ||
    exportMutation.isPending;

  async function onNext() {
    if (step === 1) {
      // Create the draft, then generate clauses in one go.
      const created = await createMutation.mutateAsync({
        jurisdictionId: "jur:ng-kd",
        title,
        purpose,
        evidenceBase: {
          simulation_run_id: simulationRunId || undefined,
          opportunity_ids: opportunityIds.length ? opportunityIds : undefined,
          citation_ids: citationIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean).length
            ? citationIds.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        },
        targetOutcomes: outcomes
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      const draft = unwrapData<{ law_id: string }>(created);
      if (!draft) return;
      setLawId(draft.law_id);
      onNotice(`Draft ${draft.law_id} created — generating grounded clauses…`);
      const gen = await generateMutation.mutateAsync({ law_id: draft.law_id });
      const g = unwrapData<{ clauses: DraftedClause[] }>(gen);
      setClauses(g?.clauses ?? []);
      await utils.legislation.laws.invalidate();
      setStep(2);
      return;
    }
    if (step === 2 && lawId) {
      if (simulationRunId) {
        const res = await riaMutation.mutateAsync({ law_id: lawId });
        setRia(unwrapData<RiaAnnex>(res) ?? null);
      }
      setStep(3);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function regenerate(section?: string) {
    if (!lawId) return;
    const gen = await generateMutation.mutateAsync({
      law_id: lawId,
      only_sections: section ? [section as never] : undefined,
    });
    const g = unwrapData<{ clauses: DraftedClause[] }>(gen);
    if (!g) return;
    setClauses((cur) => {
      if (!section) return g.clauses;
      const replaced = g.clauses[0];
      return cur.map((c) => (c.section === section ? replaced : c));
    });
    onNotice(section ? `Section '${section}' regenerated.` : "Clause set regenerated.");
  }

  async function saveEdit(clause: DraftedClause) {
    if (!lawId) return;
    await editMutation.mutateAsync({
      clause_id: `cls:${lawId}:gen:${clause.section}`,
      text: editText,
    });
    setClauses((cur) =>
      cur.map((c) => (c.section === clause.section ? { ...c, text: editText } : c)),
    );
    setEditing(null);
    onNotice("Clause text saved.");
  }

  async function exportAkn() {
    if (!lawId) return;
    const res = await exportMutation.mutateAsync({ law_id: lawId });
    const d = unwrapData<{ akn_xml: string; filename: string; bridge: string }>(res);
    if (!d) return;
    const blob = new Blob([d.akn_xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = d.filename;
    a.click();
    URL.revokeObjectURL(url);
    onNotice(`AKN 3.0 exported (${d.bridge} renderer) — audit event recorded.`);
  }

  const canContinue =
    step === 0
      ? title.trim().length >= 3 && purpose.trim().length >= 10
      : step === 1
        ? !busy
        : step === 2
          ? clauses.length > 0 && !busy
          : true;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Evidence-grounded drafting wizard"
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-lg border border-ink-subtle bg-ink-elevated shadow-overlay"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-ink-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <FileSignature aria-hidden className="h-4 w-4 text-civic" />
                <h2 className="text-[15px] font-semibold text-ink-primary">
                  Evidence-grounded drafting
                </h2>
                <span className="rounded bg-ink-inset px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                  {STEPS[step]} · {step + 1}/{STEPS.length}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drafting wizard"
                className="rounded p-1 text-ink-muted hover:bg-ink-surface hover:text-ink-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {step === 0 && (
                <div className="space-y-3">
                  <label className="block">
                    <span className="caption-label text-ink-muted">Bill title</span>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Kaduna Skills Acceleration Bill"
                      className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 text-[13px] text-ink-primary outline-none focus:border-civic/60"
                    />
                  </label>
                  <label className="block">
                    <span className="caption-label text-ink-muted">Purpose</span>
                    <textarea
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      rows={3}
                      placeholder="What this Bill is for (min 10 characters)…"
                      className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 text-[13px] text-ink-primary outline-none focus:border-civic/60"
                    />
                  </label>
                  <label className="block">
                    <span className="caption-label text-ink-muted">
                      Target outcomes (one per line)
                    </span>
                    <textarea
                      value={outcomes}
                      onChange={(e) => setOutcomes(e.target.value)}
                      rows={3}
                      placeholder={"Create 5,000 apprenticeship placements\nRaise completion rate"}
                      className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 text-[13px] text-ink-primary outline-none focus:border-civic/60"
                    />
                  </label>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-3">
                  <label className="block">
                    <span className="caption-label text-ink-muted">
                      Simulation run ID (grounds the RIA)
                    </span>
                    <input
                      value={simulationRunId}
                      onChange={(e) => setSimulationRunId(e.target.value)}
                      placeholder="run:… (from a succeeded simulation)"
                      className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 font-mono text-[12px] text-ink-primary outline-none focus:border-civic/60"
                    />
                  </label>
                  <div>
                    <span className="caption-label text-ink-muted">
                      Link opportunities
                    </span>
                    <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-md border border-ink-subtle bg-ink-inset p-2">
                      {opportunities.length === 0 && (
                        <p className="px-1 py-2 text-[12px] text-ink-muted">
                          No ranked opportunities loaded.
                        </p>
                      )}
                      {opportunities.map((o) => (
                        <label
                          key={o.opportunityId}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-ink-secondary hover:bg-ink-surface"
                        >
                          <input
                            type="checkbox"
                            checked={opportunityIds.includes(o.opportunityId)}
                            onChange={(e) =>
                              setOpportunityIds((cur) =>
                                e.target.checked
                                  ? [...cur, o.opportunityId]
                                  : cur.filter((id) => id !== o.opportunityId),
                              )
                            }
                            className="accent-civic"
                          />
                          <span className="truncate">{o.title}</span>
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-muted">
                            {o.opportunityId.slice(0, 18)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="block">
                    <span className="caption-label text-ink-muted">
                      Citation / evidence-source ids (comma separated)
                    </span>
                    <input
                      value={citationIds}
                      onChange={(e) => setCitationIds(e.target.value)}
                      placeholder="ev:…, ev:…"
                      className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 font-mono text-[12px] text-ink-primary outline-none focus:border-civic/60"
                    />
                  </label>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] text-ink-muted">
                      {clauses.length} generated clauses — every clause records
                      its evidence grounding.
                    </p>
                    <button
                      type="button"
                      onClick={() => regenerate()}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-ink-subtle px-2 py-1 text-[11px] text-ink-secondary hover:border-civic/50 hover:text-civic"
                    >
                      <RefreshCw aria-hidden className="h-3 w-3" />
                      Regenerate all
                    </button>
                  </div>
                  {clauses.map((c) => (
                    <div
                      key={c.section}
                      className="rounded-md border border-ink-subtle bg-ink-inset p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-medium text-ink-primary">
                          {c.section_path} — {c.heading}
                        </p>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Edit ${c.section}`}
                            onClick={() => {
                              setEditing(c.section);
                              setEditText(c.text);
                            }}
                            className="rounded p-1 text-ink-muted hover:bg-ink-surface hover:text-ink-primary"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Regenerate ${c.section}`}
                            onClick={() => regenerate(c.section)}
                            disabled={busy}
                            className="rounded p-1 text-ink-muted hover:bg-ink-surface hover:text-civic"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.grounding.map((g, i) => (
                          <span
                            key={i}
                            title={g.note}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]",
                              KIND_BADGE[g.kind] ?? "bg-ink-surface text-ink-muted",
                            )}
                          >
                            <BadgeCheck aria-hidden className="h-2.5 w-2.5" />
                            {g.kind}:{g.id.slice(0, 20)}
                          </span>
                        ))}
                      </div>
                      {editing === c.section ? (
                        <div className="mt-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={5}
                            className="w-full rounded-md border border-civic/50 bg-ink-base px-2 py-1.5 text-[12px] text-ink-primary outline-none"
                          />
                          <div className="mt-1 flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(c)}
                              className="rounded-md bg-civic px-2.5 py-1 text-[11px] font-medium text-ink-base hover:bg-civic-strong"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="rounded-md border border-ink-subtle px-2.5 py-1 text-[11px] text-ink-secondary"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
                          {c.text}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  {ria ? (
                    <>
                      <p className="text-[13px] text-ink-secondary">
                        {ria.consensus_summary}
                      </p>
                      <div className="rounded-md border border-ink-subtle bg-ink-inset p-3">
                        <p className="caption-label text-ink-muted">
                          Point estimates (80% band)
                        </p>
                        {ria.point_estimates.map((p, i) => (
                          <p key={i} className="mt-1 font-mono text-[12px] text-ink-primary">
                            {p.metric}: {p.value.toLocaleString()} {p.unit}{" "}
                            <span className="text-ink-muted">
                              [{p.lower.toLocaleString()}–{p.upper.toLocaleString()}] @{" "}
                              {p.horizon_months}m
                            </span>
                          </p>
                        ))}
                      </div>
                      <div className="rounded-md border border-ink-subtle bg-ink-inset p-3">
                        <p className="caption-label text-ink-muted">Assumptions</p>
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[12px] text-ink-secondary">
                          {ria.assumptions.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </div>
                      <p className="font-mono text-[11px] text-ink-muted">
                        engine {ria.engine} · run {ria.simulation_run_id} · hash{" "}
                        {ria.reproducibility_hash.slice(0, 24)}…
                      </p>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-muted">
                      No simulation run linked — the RIA annex is skipped. Link a
                      run in the evidence step to generate it.
                    </p>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3">
                  <p className="text-[13px] text-ink-secondary">
                    Export the draft as Akoma Ntoso 3.0 XML. The RIA is embedded
                    as Annex A. Rendered by the documents service when reachable,
                    otherwise by the local deterministic builder.
                  </p>
                  <button
                    type="button"
                    onClick={exportAkn}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-md bg-civic px-4 py-2 text-[13px] font-medium text-ink-base hover:bg-civic-strong disabled:opacity-50"
                  >
                    {exportMutation.isPending ? (
                      <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download aria-hidden className="h-4 w-4" />
                    )}
                    Download AKN XML
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-ink-subtle px-4 py-3">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0 || busy}
                className="inline-flex items-center gap-1 rounded-md border border-ink-subtle px-3 py-1.5 text-[12px] text-ink-secondary disabled:opacity-40"
              >
                <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
                Back
              </button>
              {step < STEPS.length - 1 && (
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!canContinue}
                  className="inline-flex items-center gap-1 rounded-md bg-civic px-3 py-1.5 text-[12px] font-medium text-ink-base hover:bg-civic-strong disabled:opacity-40"
                >
                  {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                  {step === 1 ? "Create & generate" : step === 2 ? "Build RIA annex" : "Next"}
                  <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
