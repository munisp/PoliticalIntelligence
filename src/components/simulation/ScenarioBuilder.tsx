import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  RotateCcw,
  Lock,
  Loader2,
  FlaskConical,
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import UncertaintyBandChart from "@/components/shared/UncertaintyBandChart";
import type { SimulationEngine } from "@contracts/entities";
import {
  ENGINES,
  TEMPLATES,
  engineMeta,
  type LeverDef,
  type TemplateDef,
} from "./engines";
import {
  JURISDICTION_ID,
  formatNumber,
  unwrapApi,
  type AssumptionSetLite,
  type RunRow,
} from "./studio";

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

type QueuePhase = "idle" | "creating" | "queueing";

export interface QueuedRunInfo {
  simulationRunId: string;
  scenarioName: string;
}

export interface ScenarioBuilderProps {
  executiveMode: boolean;
  assumptionSets: AssumptionSetLite[];
  /** Succeeded runs used as baseline context in the summary mini chart. */
  baselineRuns: RunRow[];
  onQueued: (info: QueuedRunInfo) => void;
  onOpenRegistry: () => void;
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function AccordionSection({
  id,
  title,
  step,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  step: number;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-ink-subtle bg-ink-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`section-${id}`}
        onClick={() => onToggle(id)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-ink-strong font-mono text-[10px] text-ink-muted">
          {step}
        </span>
        <span className="flex-1 text-sm font-semibold text-ink-primary">
          {title}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 text-ink-muted transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`section-${id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-ink-subtle px-4 py-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="caption-label mb-1.5 block text-ink-muted">
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:border-civic/60";

function LeverControl({
  lever,
  value,
  onChange,
  disabled,
}: {
  lever: LeverDef;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const delta = value - lever.baseline;
  return (
    <div className="rounded-md border border-ink-subtle bg-ink-inset/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-primary">
          {lever.label}
        </span>
        <span className="font-mono text-xs text-civic">
          {formatNumber(value)}
          {lever.unit ? <span className="text-ink-muted"> {lever.unit}</span> : null}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {lever.kind === "slider" ? (
          <input
            type="range"
            aria-label={lever.label}
            min={lever.min}
            max={lever.max}
            step={lever.step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-[#3FAE9E] transition-all duration-100"
          />
        ) : (
          <input
            type="number"
            aria-label={lever.label}
            min={lever.min}
            max={lever.max}
            step={lever.step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-36 rounded border border-ink-subtle bg-ink-inset px-2 py-1 font-mono text-xs text-ink-primary"
          />
        )}
        <button
          type="button"
          onClick={() => onChange(lever.baseline)}
          disabled={disabled || delta === 0}
          title="Reset to twin-state baseline"
          aria-label={`Reset ${lever.label} to baseline`}
          className="rounded p-1 text-ink-muted hover:text-civic disabled:opacity-30"
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 font-mono text-[11px] text-ink-muted">
        baseline {formatNumber(lever.baseline)}
        {lever.unit ? ` ${lever.unit}` : ""}
        {delta !== 0 && (
          <span className="text-status-warning">
            {"  ·  Δ "}
            {delta > 0 ? "+" : ""}
            {formatNumber(delta)}
          </span>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Queue hook shared by specialist + executive modes                   */
/* ------------------------------------------------------------------ */

function useQueueRun(onQueued: (info: QueuedRunInfo) => void) {
  const utils = trpc.useUtils();
  const createMut = trpc.scenarios.create.useMutation();
  const addRunMut = trpc.scenarios.addRun.useMutation();
  const [phase, setPhase] = useState<QueuePhase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function queueRun(args: {
    name: string;
    description?: string;
    engine: SimulationEngine;
    seed: number;
    assumptionsSetId?: string;
    modelParams: Record<string, unknown>;
    executionProfile: Record<string, unknown>;
  }) {
    setError(null);
    try {
      setPhase("creating");
      const created = await createMut.mutateAsync({
        jurisdiction_id: JURISDICTION_ID,
        name: args.name,
        description: args.description,
        intervention_ids: [],
        assumptions_set_id: args.assumptionsSetId,
        model_plan: [{ engine: args.engine, params: args.modelParams }],
      });
      const scenario = unwrapApi<{ scenarioId: string } | undefined>(created);
      if (!scenario?.scenarioId) throw new Error("Scenario create returned no id");
      setPhase("queueing");
      const res = await addRunMut.mutateAsync({
        scenario_id: scenario.scenarioId,
        engine: args.engine,
        seed: args.seed,
        execution_profile: args.executionProfile,
        idempotency_key: `web:${crypto.randomUUID()}`,
      });
      const handle = unwrapApi<{ simulation_run_id: string } | undefined>(res);
      await utils.scenarios.invalidate();
      setPhase("idle");
      onQueued({
        simulationRunId: handle?.simulation_run_id ?? "",
        scenarioName: args.name,
      });
    } catch (e) {
      setPhase("idle");
      const msg =
        e instanceof Error
          ? e.message
          : "Run could not be queued. The scenario engine may be unavailable.";
      setError(msg);
    }
  }

  return { queueRun, phase, error };
}

/* ------------------------------------------------------------------ */
/* Executive limited mode — template picker                            */
/* ------------------------------------------------------------------ */

function TemplateMode({
  onQueued,
}: {
  onQueued: (info: QueuedRunInfo) => void;
}) {
  const [selected, setSelected] = useState<TemplateDef>(TEMPLATES[0]);
  const [levers, setLevers] = useState<Record<string, number>>(() =>
    Object.fromEntries(TEMPLATES[0].levers.map((l) => [l.key, l.baseline])),
  );
  const { queueRun, phase, error } = useQueueRun(onQueued);

  const pick = (t: TemplateDef) => {
    setSelected(t);
    setLevers(Object.fromEntries(t.levers.map((l) => [l.key, l.baseline])));
  };

  const busy = phase !== "idle";

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-7">
        <p className="flex items-center gap-2 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-[13px] text-ink-secondary">
          <Lock aria-hidden className="h-3.5 w-3.5 text-gold" />
          Executive mode — pre-approved templates with locked assumptions and engines.
        </p>
        {TEMPLATES.map((t, i) => {
          const meta = engineMeta(t.engine);
          const active = selected.id === t.id;
          return (
            <motion.button
              key={t.id}
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: i * 0.05, ease: EASE }}
              onClick={() => pick(t)}
              aria-pressed={active}
              className={cn(
                "relative block w-full rounded-md border bg-ink-surface p-4 text-left transition-all duration-150 hover:-translate-y-[3px]",
                active
                  ? "border-civic/70 shadow-[inset_3px_0_0_#3FAE9E]"
                  : "border-ink-subtle hover:border-ink-strong",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-primary">{t.title}</span>
                <span className="rounded-full border border-ink-subtle px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                  {meta.tag}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{t.description}</p>
              <p className="mt-2 font-mono text-xs text-ink-muted">
                {t.preview.metric}:{" "}
                <span className="text-civic">
                  {formatNumber(t.preview.low)}–{formatNumber(t.preview.high)} {t.preview.unit}
                </span>{" "}
                <span className="text-ink-muted">(80% band)</span>
              </p>
            </motion.button>
          );
        })}
      </div>

      <div className="lg:col-span-5">
        <div className="sticky top-20 rounded-md border border-ink-subtle bg-ink-surface p-4">
          <h3 className="text-sm font-semibold text-ink-primary">{selected.title}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Lock aria-hidden className="h-3 w-3 text-gold" />
            Engine + assumptions locked by registry · {engineMeta(selected.engine).name}
          </p>
          <div className="mt-3 space-y-2.5">
            {selected.levers.map((lever) => (
              <LeverControl
                key={lever.key}
                lever={lever}
                value={levers[lever.key] ?? lever.baseline}
                onChange={(v) => setLevers((s) => ({ ...s, [lever.key]: v }))}
                disabled={busy}
              />
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 flex items-start gap-1.5 rounded border border-status-danger/40 bg-status-danger/10 px-2 py-1.5 text-xs text-status-danger">
              <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              queueRun({
                name: `${selected.title} — executive template`,
                description: selected.description,
                engine: selected.engine,
                seed: 42,
                assumptionsSetId: selected.assumptionsSetId,
                modelParams: { template: selected.id, ...levers },
                executionProfile: {
                  template: selected.id,
                  levers,
                  locked: true,
                  priority: "normal",
                },
              })
            }
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-civic px-3 py-2 text-sm font-medium text-ink-base transition-all duration-200 hover:bg-civic-strong active:scale-[0.98] disabled:opacity-60"
          >
            {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {phase === "creating"
              ? "Creating scenario…"
              : phase === "queueing"
                ? "Queueing run…"
                : "Queue run"}
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-muted">
            Seeded (seed 42) · auditable · appears in the Jobs indicator
          </p>
        </div>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Specialist mode — full scenario builder                             */
/* ------------------------------------------------------------------ */

const HORIZONS = [3, 5, 10] as const;

export default function ScenarioBuilder({
  executiveMode,
  assumptionSets,
  baselineRuns,
  onQueued,
  onOpenRegistry,
}: ScenarioBuilderProps) {
  if (executiveMode) {
    return <TemplateMode onQueued={onQueued} />;
  }
  return (
    <SpecialistBuilder
      assumptionSets={assumptionSets}
      baselineRuns={baselineRuns}
      onQueued={onQueued}
      onOpenRegistry={onOpenRegistry}
    />
  );
}

function SpecialistBuilder({
  assumptionSets,
  baselineRuns,
  onQueued,
  onOpenRegistry,
}: Omit<ScenarioBuilderProps, "executiveMode">) {
  /* Basics */
  const [name, setName] = useState("Teacher recruitment surge FY25");
  const [description, setDescription] = useState("");
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(5);
  const [scopeAll, setScopeAll] = useState(true);
  const [selectedLgas, setSelectedLgas] = useState<string[]>([]);

  const lgaQuery = trpc.jurisdictions.list.useQuery(
    { country_code: "NG", admin_level: "lga", limit: 100 },
    { staleTime: 60_000 },
  );
  const lgas = useMemo(() => {
    const items =
      unwrapApi<{ items: { jurisdictionId: string; name: string }[] } | undefined>(
        lgaQuery.data,
      )?.items ?? [];
    return items
      .filter((j) => j.jurisdictionId.startsWith("jur:ng-kd"))
      .map((j) => j.name);
  }, [lgaQuery.data]);

  /* Engine + levers */
  const [engineId, setEngineId] = useState<SimulationEngine>("forecast");
  const meta = engineMeta(engineId);
  const [levers, setLevers] = useState<Record<string, number>>(() =>
    Object.fromEntries(ENGINES[0].levers.map((l) => [l.key, l.baseline])),
  );
  const pickEngine = (id: SimulationEngine) => {
    setEngineId(id);
    setLevers(Object.fromEntries(engineMeta(id).levers.map((l) => [l.key, l.baseline])));
  };

  /* Assumptions */
  const [setId, setSetId] = useState<string>(assumptionSets[0]?.assumptionsSetId ?? "");
  useEffect(() => {
    if (!setId && assumptionSets.length > 0)
      setSetId(assumptionSets[0].assumptionsSetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumptionSets]);
  const activeSet = assumptionSets.find((s) => s.assumptionsSetId === setId);
  const [edits, setEdits] = useState<Record<string, number | string>>({});
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  /* Execution */
  const [seed, setSeed] = useState(42);
  const [versionPin, setVersionPin] = useState("twin-state:v3.2");
  const [priority, setPriority] = useState<"normal" | "high">("normal");
  const [notify, setNotify] = useState(true);

  /* Accordion */
  const [open, setOpen] = useState<Set<string>>(new Set(["basics", "engine"]));
  const toggleSection = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { queueRun, phase, error } = useQueueRun(onQueued);
  const busy = phase !== "idle";
  const nameValid = name.trim().length >= 3;

  const submit = () => {
    if (busy || !nameValid) return;
    const overrides = Object.fromEntries(
      [...confirmed].map((k) => [k, edits[k]]),
    );
    queueRun({
      name: name.trim(),
      description: description.trim() || undefined,
      engine: engineId,
      seed,
      assumptionsSetId: setId || undefined,
      modelParams: { horizon_years: horizon, levers },
      executionProfile: {
        horizon_years: horizon,
        geography_scope: scopeAll ? "all-23-lga" : selectedLgas,
        levers,
        assumption_overrides: overrides,
        model_version_pin: versionPin,
        priority,
        notify_on_completion: notify,
      },
    });
  };

  /* Baseline mini chart: latest succeeded run for the selected engine. */
  const baselineRun = baselineRuns.find(
    (r) => r.engine === engineId && r.resultSummary?.series?.length,
  );
  const leverDeltas = meta.levers
    .map((l) => ({ lever: l, value: levers[l.key] ?? l.baseline }))
    .filter(({ lever, value }) => value !== lever.baseline);
  const estCost = (meta.runtimeMinutes * (0.5 + leverDeltas.length * 0.25)).toFixed(1);

  let step = 0;

  return (
    <div
      className="grid gap-4 lg:grid-cols-12"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
    >
      {/* ---------------------- Form --------------------------- */}
      <motion.div
        className="space-y-3 lg:col-span-7"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.05 } } }}
      >
        {/* 1. Basics */}
        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.24, ease: EASE }}>
          <AccordionSection id="basics" title="Basics" step={++step} open={open.has("basics")} onToggle={toggleSection}>
            <div className="space-y-3">
              <div>
                <FieldLabel htmlFor="scn-name">Scenario name</FieldLabel>
                <input
                  id="scn-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Teacher recruitment surge FY25"
                  className={inputCls}
                />
                {!nameValid && (
                  <p className="mt-1 text-[11px] text-status-danger">
                    Name needs at least 3 characters.
                  </p>
                )}
              </div>
              <div>
                <FieldLabel htmlFor="scn-desc">Description</FieldLabel>
                <textarea
                  id="scn-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="What decision does this scenario inform?"
                  className={cn(inputCls, "resize-y")}
                />
              </div>
              <div>
                <FieldLabel>Horizon</FieldLabel>
                <div role="radiogroup" aria-label="Horizon" className="inline-flex overflow-hidden rounded-md border border-ink-subtle">
                  {HORIZONS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      role="radio"
                      aria-checked={horizon === h}
                      onClick={() => setHorizon(h)}
                      className={cn(
                        "px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                        horizon === h
                          ? "bg-civic/15 text-civic"
                          : "text-ink-secondary hover:text-ink-primary",
                      )}
                    >
                      {h}-yr
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel>Geography scope</FieldLabel>
                <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={scopeAll}
                    onChange={(e) => setScopeAll(e.target.checked)}
                    className="accent-[#3FAE9E]"
                  />
                  All 23 Kaduna LGAs (twin state v3.2)
                </label>
                {!scopeAll && (
                  <div className="mt-2 grid max-h-36 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-ink-subtle bg-ink-inset p-2">
                    {(lgas.length > 0 ? lgas : ["Kaduna North", "Kaduna South", "Chikun", "Igabi", "Zaria", "Kachia"]).map((lga) => (
                      <label key={lga} className="flex items-center gap-2 text-xs text-ink-secondary">
                        <input
                          type="checkbox"
                          checked={selectedLgas.includes(lga)}
                          onChange={(e) =>
                            setSelectedLgas((s) =>
                              e.target.checked ? [...s, lga] : s.filter((x) => x !== lga),
                            )
                          }
                          className="accent-[#3FAE9E]"
                        />
                        {lga}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </AccordionSection>
        </motion.div>

        {/* 2. Engine selection */}
        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.24, ease: EASE }}>
          <AccordionSection id="engine" title="Engine selection" step={++step} open={open.has("engine")} onToggle={toggleSection}>
            <div role="radiogroup" aria-label="Simulation engine" className="grid gap-2.5 sm:grid-cols-2">
              {ENGINES.map((e) => {
                const active = engineId === e.id;
                return (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickEngine(e.id)}
                    className={cn(
                      "rounded-md border bg-ink-inset/50 p-3 text-left transition-all duration-150 hover:-translate-y-[3px]",
                      active
                        ? "border-civic/70 shadow-[inset_3px_0_0_#3FAE9E]"
                        : "border-ink-subtle hover:border-ink-strong",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-ink-primary">{e.name}</span>
                      <span className="rounded-full border border-ink-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                        {e.tag}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-4 text-ink-secondary">{e.description}</p>
                    <p className="mt-1.5 font-mono text-[10px] text-ink-muted">
                      {e.runtime} · best for: {e.recommendedFor}
                    </p>
                  </button>
                );
              })}
            </div>
          </AccordionSection>
        </motion.div>

        {/* 3. Intervention levers */}
        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.24, ease: EASE }}>
          <AccordionSection id="levers" title="Intervention levers" step={++step} open={open.has("levers")} onToggle={toggleSection}>
            <div className="space-y-2.5">
              {meta.levers.map((lever) => (
                <LeverControl
                  key={lever.key}
                  lever={lever}
                  value={levers[lever.key] ?? lever.baseline}
                  onChange={(v) => setLevers((s) => ({ ...s, [lever.key]: v }))}
                />
              ))}
            </div>
          </AccordionSection>
        </motion.div>

        {/* 4. Assumptions */}
        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.24, ease: EASE }}>
          <AccordionSection id="assumptions" title="Assumptions" step={++step} open={open.has("assumptions")} onToggle={toggleSection}>
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-2">
                <div className="flex-1">
                  <FieldLabel htmlFor="asm-set">Assumption set</FieldLabel>
                  <select
                    id="asm-set"
                    value={setId}
                    onChange={(e) => {
                      setSetId(e.target.value);
                      setEdits({});
                      setConfirmed(new Set());
                    }}
                    className={inputCls}
                  >
                    {assumptionSets.length === 0 && <option value="">No registry sets loaded</option>}
                    {assumptionSets.map((s) => (
                      <option key={s.assumptionsSetId} value={s.assumptionsSetId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={onOpenRegistry}
                  className="rounded-md border border-ink-subtle px-2.5 py-2 text-xs text-ink-secondary hover:border-civic/50 hover:text-ink-primary"
                >
                  Full registry
                </button>
              </div>
              {activeSet ? (
                <ul className="divide-y divide-ink-subtle/60 rounded-md border border-ink-subtle">
                  {activeSet.entries.map((entry) => {
                    const edited = entry.key in edits;
                    const isConfirmed = confirmed.has(entry.key);
                    return (
                      <li key={entry.key} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-40 flex-1 text-[13px] text-ink-primary">
                            {entry.label}
                          </span>
                          <input
                            type="number"
                            aria-label={`Edit ${entry.label}`}
                            value={edited ? String(edits[entry.key]) : String(entry.value)}
                            onChange={(e) =>
                              setEdits((s) => ({ ...s, [entry.key]: Number(e.target.value) }))
                            }
                            className="w-24 rounded border border-ink-subtle bg-ink-inset px-2 py-1 font-mono text-xs text-ink-primary"
                          />
                          <span className="font-mono text-[11px] text-ink-muted">{entry.unit}</span>
                          {edited && !isConfirmed && (
                            <>
                              <span className="rounded-full border border-status-warning/50 bg-status-warning/10 px-2 py-0.5 text-[10px] font-medium text-status-warning">
                                Modified from registry
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmed((s) => new Set(s).add(entry.key))
                                }
                                className="rounded border border-civic/50 px-2 py-0.5 text-[10px] font-medium text-civic hover:bg-civic/10"
                              >
                                Confirm
                              </button>
                            </>
                          )}
                          {edited && isConfirmed && (
                            <span className="rounded-full border border-civic/50 bg-civic/10 px-2 py-0.5 text-[10px] font-medium text-civic">
                              Override confirmed
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-ink-muted">
                          source {entry.source_id ?? "registry"} · set by Assumptions registry · validated 09 Jan 2025
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-muted">
                  Select an assumption set to review registry values.
                </p>
              )}
            </div>
          </AccordionSection>
        </motion.div>

        {/* 5. Execution */}
        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.24, ease: EASE }}>
          <AccordionSection id="execution" title="Execution" step={++step} open={open.has("execution")} onToggle={toggleSection}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="scn-seed">Seed</FieldLabel>
                <input
                  id="scn-seed"
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Math.trunc(Number(e.target.value)))}
                  className={cn(inputCls, "font-mono")}
                />
              </div>
              <div>
                <FieldLabel htmlFor="scn-pin">Model version pin</FieldLabel>
                <input
                  id="scn-pin"
                  value={versionPin}
                  onChange={(e) => setVersionPin(e.target.value)}
                  className={cn(inputCls, "font-mono")}
                />
              </div>
              <div>
                <FieldLabel>Priority</FieldLabel>
                <div role="radiogroup" aria-label="Priority" className="inline-flex overflow-hidden rounded-md border border-ink-subtle">
                  {(["normal", "high"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={priority === p}
                      onClick={() => setPriority(p)}
                      className={cn(
                        "px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors duration-150",
                        priority === p
                          ? "bg-civic/15 text-civic"
                          : "text-ink-secondary hover:text-ink-primary",
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-secondary">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="accent-[#3FAE9E]"
                />
                Notify on completion
              </label>
            </div>
          </AccordionSection>
        </motion.div>
      </motion.div>

      {/* ---------------------- Live summary card ---------------------- */}
      <div className="order-first lg:order-none lg:col-span-5">
        <div className="rounded-md border border-ink-subtle bg-ink-surface p-4 lg:sticky lg:top-20">
          <div className="flex items-center gap-2">
            <FlaskConical aria-hidden className="h-4 w-4 text-civic" />
            <h3 className="truncate text-sm font-semibold text-ink-primary">
              {name.trim() || "Untitled scenario"}
            </h3>
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            {meta.name} · {meta.tag} · seed {seed} · {horizon}-yr horizon
          </p>

          <div className="mt-3">
            <p className="caption-label text-ink-muted">Lever deltas vs baseline</p>
            {leverDeltas.length === 0 ? (
              <p className="mt-1 text-xs text-ink-muted">All levers at twin-state baseline.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {leverDeltas.map(({ lever, value }) => (
                  <li key={lever.key} className="font-mono text-xs text-ink-secondary">
                    {lever.label}{" "}
                    <span className="text-civic">
                      {value - lever.baseline > 0 ? "+" : ""}
                      {formatNumber(value - lever.baseline)}
                    </span>{" "}
                    <span className="text-ink-muted">vs baseline {formatNumber(lever.baseline)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md border border-ink-subtle bg-ink-inset px-2 py-1.5">
              <p className="caption-label text-[10px] text-ink-muted">Est. runtime</p>
              <p className="font-mono text-sm text-ink-primary">{meta.runtime}</p>
            </div>
            <div className="rounded-md border border-ink-subtle bg-ink-inset px-2 py-1.5">
              <p className="caption-label text-[10px] text-ink-muted">Est. compute</p>
              <p className="font-mono text-sm text-ink-primary">{estCost} cu</p>
            </div>
          </div>

          {baselineRun?.resultSummary && (
            <div className="mt-3">
              <UncertaintyBandChart
                height={150}
                yLabel={`Baseline context — ${shortLabel(baselineRun.simulationRunId)} (${baselineRun.resultSummary.unit})`}
                series={[
                  {
                    id: baselineRun.simulationRunId,
                    label: shortLabel(baselineRun.simulationRunId),
                    points: baselineRun.resultSummary.series.map((p) => ({
                      x: `M${p.month}`,
                      value: p.mean,
                      lower: p.lower,
                      upper: p.upper,
                    })),
                  },
                ]}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 flex items-start gap-1.5 rounded border border-status-danger/40 bg-status-danger/10 px-2 py-1.5 text-xs text-status-danger">
              <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={busy || !nameValid}
            onClick={submit}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-civic px-3 py-2 text-sm font-medium text-ink-base transition-all duration-200 hover:bg-civic-strong active:scale-[0.98] disabled:opacity-60"
          >
            {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {phase === "creating"
              ? "Creating scenario…"
              : phase === "queueing"
                ? "Queued → submitting to engine…"
                : "Queue run"}
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-muted">
            ⌘Enter queues the run · tracked in the Jobs indicator
          </p>
        </div>
      </div>
    </div>
  );
}

function shortLabel(runId: string): string {
  const raw = runId.replace(/^sim:/, "");
  return `#${raw.slice(0, 6).toUpperCase()}`;
}
