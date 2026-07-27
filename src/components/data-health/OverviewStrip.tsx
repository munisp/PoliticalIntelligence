import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import StatusDot from "@/components/shared/StatusDot";
import { hashSeed, seededRandom } from "@/components/briefs/brief-utils";
import { conformancePct, type DataSourceRow } from "./health-utils";

/* ------------------------------------------------------------------ */
/* Count-up (600ms ease-out, static afterwards; reduced-motion safe)   */
/* ------------------------------------------------------------------ */

function useCountUp(target: number, decimals = 0): string {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      setValue(target);
      return;
    }
    started.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const t0 = performance.now();
    const dur = 600;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value.toFixed(decimals);
}

/* ------------------------------------------------------------------ */
/* Sparkline — deterministic 7-day series, 500ms draw-in               */
/* ------------------------------------------------------------------ */

function Sparkline({ seed, color }: { seed: string; color: string }) {
  const rand = seededRandom(hashSeed(seed));
  const pts = Array.from({ length: 7 }, (_, i) => {
    const base = 0.45 + 0.25 * Math.sin(i * 1.1 + rand() * 2);
    return { x: i * 10, y: 26 - (base + rand() * 0.3) * 24 };
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg width="60" height="28" viewBox="0 0 60 28" aria-hidden className="shrink-0">
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Overview strip                                                      */
/* ------------------------------------------------------------------ */

export interface OverviewStripProps {
  sources: DataSourceRow[];
}

export default function OverviewStrip({ sources }: OverviewStripProps) {
  const healthy = sources.filter((s) => s.health === "healthy").length;
  const stale = sources.filter((s) => s.health === "stale").length;
  const failing = sources.filter((s) => s.health === "failing").length;
  const avgFresh =
    sources.length > 0
      ? sources.reduce((acc, s) => acc + s.freshnessDays, 0) / sources.length
      : 0;
  const pcts = sources
    .map((s) => conformancePct(s.contractCompliance))
    .filter((v): v is number => v !== null);
  const compliance = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;

  const [acknowledged, setAcknowledged] = useState(false);

  const cards: {
    id: string;
    label: string;
    value: number;
    decimals: number;
    suffix: string;
    color: string;
    pulse?: boolean;
  }[] = [
    { id: "healthy", label: "Sources healthy", value: healthy, decimals: 0, suffix: "", color: "#4FAE8C" },
    { id: "stale", label: "Stale", value: stale, decimals: 0, suffix: "", color: "#D9A441" },
    { id: "failing", label: "Failing", value: failing, decimals: 0, suffix: "", color: "#D9635F", pulse: failing > 0 && !acknowledged },
    { id: "freshness", label: "Avg freshness", value: avgFresh, decimals: 1, suffix: " days", color: "#5E93CF" },
    { id: "compliance", label: "Contract compliance", value: compliance, decimals: 1, suffix: "%", color: "#3FAE9E" },
  ];

  return (
    <section aria-label="Health overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {cards.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-md border border-ink-subtle bg-ink-surface p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="caption-label text-ink-muted">{c.label}</p>
              {c.pulse && (
                <span className="relative flex h-2 w-2" aria-label="Unacknowledged failures">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-danger opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-status-danger" />
                </span>
              )}
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="font-mono text-[28px] leading-8 text-ink-primary">
                <CountUpText value={c.value} decimals={c.decimals} />
                {c.suffix && (
                  <span className="ml-0.5 text-sm text-ink-secondary">{c.suffix}</span>
                )}
              </p>
              <Sparkline seed={`${c.id}-${sources.length}`} color={c.color} />
            </div>
            {c.id === "failing" && failing > 0 && !acknowledged && (
              <button
                type="button"
                onClick={() => setAcknowledged(true)}
                className="mt-2 rounded border border-status-danger/40 px-2 py-0.5 text-[11px] font-medium text-status-danger hover:bg-status-danger/10"
              >
                Acknowledge
              </button>
            )}
          </motion.div>
        ))}
      </div>
      {/* Status legend — never color-only */}
      <div className="mt-3 flex flex-wrap items-center gap-4" role="list" aria-label="Status legend">
        <StatusDot status="healthy" />
        <StatusDot status="stale" />
        <StatusDot status="failing" />
        <StatusDot status="running" />
      </div>
    </section>
  );
}

function CountUpText({ value, decimals }: { value: number; decimals: number }) {
  return <>{useCountUp(value, decimals)}</>;
}
