import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  History,
  BookOpenCheck,
  Plus,
  FlaskConical,
  ListOrdered,
  GitCompareArrows,
  FolderOpen,
  X,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import ScenarioBuilder, {
  type QueuedRunInfo,
} from "@/components/simulation/ScenarioBuilder";
import RunsMonitor from "@/components/simulation/RunsMonitor";
import CompareRuns from "@/components/simulation/CompareRuns";
import ArtifactsGrid from "@/components/simulation/ArtifactsGrid";
import {
  shortRunId,
  useStudioData,
  type AssumptionSetLite,
} from "@/components/simulation/studio";

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const TABS = [
  { id: "builder", label: "Builder", Icon: FlaskConical },
  { id: "runs", label: "Runs", Icon: ListOrdered },
  { id: "compare", label: "Compare", Icon: GitCompareArrows },
  { id: "artifacts", label: "Artifacts", Icon: FolderOpen },
] as const;
type TabId = (typeof TABS)[number]["id"];

function isTab(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v);
}

export default function Simulation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabId = isTab(searchParams.get("tab"))
    ? (searchParams.get("tab") as TabId)
    : "builder";
  const setTab = (t: TabId) => {
    const next = new URLSearchParams(searchParams);
    if (t === "builder") next.delete("tab");
    else next.set("tab", t);
    setSearchParams(next, { replace: false });
  };

  const { user } = useAuth();
  const executiveMode =
    user?.platformRole === "executive" ||
    (user?.role === "admin" && !user?.platformRole);

  const studio = useStudioData();
  const { runs, assumptionSets, isLoading, isError, activeRunCount } = studio;

  const [sessionRunIds, setSessionRunIds] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [registryOpen, setRegistryOpen] = useState(false);

  /* ---------------- aria-live announcements + toast ---------------- */
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setAnnouncement(message);
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  /* Announce run status transitions (aria-live polite). */
  const prevStatuses = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const r of runs) {
      const prev = prevStatuses.current.get(r.simulationRunId);
      if (prev && prev !== r.status) {
        if (r.status === "succeeded") {
          notify(
            `Run ${shortRunId(r.simulationRunId)} (${r.scenarioName}) succeeded — artifacts sealed.`,
          );
        } else if (r.status === "failed") {
          notify(`Run ${shortRunId(r.simulationRunId)} failed — see engine logs.`);
        } else if (prev === "queued" && r.status === "running") {
          setAnnouncement(`Run ${shortRunId(r.simulationRunId)} is now running.`);
        }
      }
      prevStatuses.current.set(r.simulationRunId, r.status);
    }
  }, [runs, notify]);

  const onQueued = useCallback(
    (info: QueuedRunInfo) => {
      if (info.simulationRunId) {
        setSessionRunIds((s) => new Set(s).add(info.simulationRunId));
      }
      notify(
        `Run queued for “${info.scenarioName}” — tracking ${shortRunId(info.simulationRunId || "sim:pending")} in the Runs tab.`,
      );
      setTab("runs");
    },
    [notify],
  );

  const addToCompare = useCallback(
    (runId: string) => {
      setCompareIds((ids) => (ids.includes(runId) ? ids : [...ids, runId].slice(0, 4)));
      setTab("compare");
    },
    [],
  );

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* Screen-reader live region for async run status */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {/* ---------------------------- Header ---------------------------- */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div>
          <p className="caption-label text-ink-muted">Kaduna State · Scenario engine</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
            Simulation Studio
          </h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Twin state v3.2 · Last calibration 09 Jan 2025 · Engines: 6 available
          </p>
        </div>
        <motion.div
          className="flex items-center gap-2"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.04 } } }}
        >
          {[
            {
              label: "Run history",
              Icon: History,
              onClick: () => setTab("runs"),
              primary: false,
            },
            {
              label: "Assumptions registry",
              Icon: BookOpenCheck,
              onClick: () => setRegistryOpen(true),
              primary: false,
            },
            {
              label: "New scenario",
              Icon: Plus,
              onClick: () => setTab("builder"),
              primary: true,
            },
          ].map(({ label, Icon, onClick, primary }) => (
            <motion.button
              key={label}
              type="button"
              variants={{
                hidden: { opacity: 0, y: 6 },
                show: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.2, ease: EASE }}
              onClick={onClick}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-150 active:scale-[0.98]",
                primary
                  ? "bg-civic text-ink-base hover:bg-civic-strong"
                  : "border border-ink-subtle text-ink-secondary hover:border-civic/50 hover:text-ink-primary",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </motion.button>
          ))}
        </motion.div>
      </motion.header>

      {/* ------------------- Degraded service banner ------------------- */}
      {isError && (
        <p
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning"
        >
          <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
          Scenario engine unavailable — queued runs will resume automatically. You can
          still build and queue scenarios; jobs persist.
        </p>
      )}

      {/* ---------------------------- Tab bar ---------------------------- */}
      <div
        role="tablist"
        aria-label="Simulation studio sections"
        className="mt-4 flex gap-1 overflow-x-auto border-b border-ink-subtle"
      >
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${id}`}
              id={`tab-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium transition-colors duration-150",
                active ? "text-civic" : "text-ink-secondary hover:text-ink-primary",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
              {id === "runs" && activeRunCount > 0 && (
                <span
                  aria-label={`${activeRunCount} active runs`}
                  className="flex h-4 min-w-4 items-center justify-center rounded-full bg-status-info/20 px-1 font-mono text-[10px] text-status-info"
                >
                  {activeRunCount}
                </span>
              )}
              {active && (
                <motion.span
                  layoutId="sim-tab-underline"
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-civic"
                  transition={{ duration: 0.2, ease: EASE }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ------------------------- Tabbed content ------------------------- */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          id={`panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="py-4"
        >
          {tab === "builder" && (
            <ScenarioBuilder
              executiveMode={!!executiveMode}
              assumptionSets={assumptionSets}
              baselineRuns={runs.filter((r) => r.status === "succeeded")}
              onQueued={onQueued}
              onOpenRegistry={() => setRegistryOpen(true)}
            />
          )}
          {tab === "runs" && (
            <RunsMonitor
              runs={runs}
              isLoading={isLoading}
              readOnly={!!executiveMode}
              sessionRunIds={sessionRunIds}
              currentUserId={user?.id ?? null}
              onAddToCompare={addToCompare}
              onRerunQueued={onQueued}
            />
          )}
          {tab === "compare" && (
            <CompareRuns
              runs={runs}
              assumptionSets={assumptionSets}
              selectedIds={compareIds}
              onSelectionChange={setCompareIds}
            />
          )}
          {tab === "artifacts" && (
            <ArtifactsGrid runs={runs} isLoading={isLoading} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ----------------------------- Toast ----------------------------- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-2 rounded-md border border-civic/40 bg-ink-elevated px-3.5 py-2.5 shadow-[0_8px_32px_rgba(2,6,16,0.5)]"
          >
            <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-civic" />
            <p className="text-[13px] leading-5 text-ink-primary">{toast}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-ink-muted hover:text-ink-primary"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------- Assumptions registry modal ------------------- */}
      <AssumptionsRegistryModal
        open={registryOpen}
        onClose={() => setRegistryOpen(false)}
        sets={assumptionSets}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assumptions registry modal                                          */
/* ------------------------------------------------------------------ */

function AssumptionsRegistryModal({
  open,
  onClose,
  sets,
}: {
  open: boolean;
  onClose: () => void;
  sets: AssumptionSetLite[];
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,8,18,0.6)] p-4"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Assumptions registry"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-ink-subtle bg-ink-elevated p-5 shadow-[0_8px_32px_rgba(2,6,16,0.5)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink-primary">
                  Assumptions registry
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-secondary">
                  Versioned baseline assumptions behind every scenario run. Overrides
                  are recorded per run in the execution profile.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close registry"
                autoFocus
                className="rounded p-1 text-ink-muted hover:text-ink-primary"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>
            {sets.length === 0 ? (
              <p className="mt-4 text-[13px] text-ink-muted">
                No assumption sets loaded for this jurisdiction.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {sets.map((s) => (
                  <section
                    key={s.assumptionsSetId}
                    className="rounded-md border border-ink-subtle bg-ink-surface"
                  >
                    <header className="border-b border-ink-subtle px-3 py-2">
                      <p className="text-sm font-semibold text-ink-primary">{s.name}</p>
                      <p className="font-mono text-[10px] text-ink-muted">
                        {s.assumptionsSetId}
                        {s.description ? ` · ${s.description}` : ""}
                      </p>
                    </header>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-ink-subtle/60">
                          <th scope="col" className="caption-label px-3 py-1.5 text-ink-muted">
                            Assumption
                          </th>
                          <th scope="col" className="caption-label px-3 py-1.5 text-right text-ink-muted">
                            Value
                          </th>
                          <th scope="col" className="caption-label px-3 py-1.5 text-right text-ink-muted">
                            Source
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.entries.map((e) => (
                          <tr key={e.key} className="border-b border-ink-subtle/40">
                            <td className="px-3 py-1.5 text-ink-secondary">{e.label}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-ink-primary">
                              {String(e.value)}
                              {e.unit ? (
                                <span className="text-ink-muted"> {e.unit}</span>
                              ) : null}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-ink-muted">
                              {e.source_id ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
