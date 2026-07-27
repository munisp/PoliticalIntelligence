import { Link } from "react-router";
import { motion } from "framer-motion";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApprovalBadge, EmptyState, type ApprovalState } from "@/components/shared";
import {
  deltaBandAt,
  engineLabel,
  finalDelta,
  fmtInt,
  fmtSigned,
  humanize,
  type RunResultLike,
} from "./utils";

export interface ScenarioCardData {
  scenarioId: string;
  name: string;
  description?: string | null;
  status: string;
  engines: string[];
  version?: number;
  /** First succeeded run result (unwrapped scenarios.runResults payload). */
  run?: RunResultLike | null;
}

/** Map scenario lifecycle to the shared approval badge states. */
function scenarioApprovalState(status: string): ApprovalState {
  switch (status) {
    case "active":
      return "approved";
    case "archived":
      return "returned";
    case "review":
      return "in-review";
    default:
      return "draft";
  }
}

function ScenarioCard({ data, index }: { data: ScenarioCardData; index: number }) {
  const engine = data.run?.engine ?? data.engines[0];
  const horizonEnd = data.run ? data.run.series.length - 1 : 0;
  const band = data.run ? deltaBandAt(data.run, horizonEnd) : null;
  const year = 2024 + Math.ceil(horizonEnd / 12);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.06,
        duration: 0.24,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      whileHover={{ y: -3 }}
      className="w-[300px] shrink-0 snap-start rounded-md border border-ink-subtle bg-ink-surface p-4"
      aria-label={`Scenario: ${humanize(data.name)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-5 text-ink-primary">
          {humanize(data.name)}
        </h3>
        <ApprovalBadge state={scenarioApprovalState(data.status)} />
      </div>
      {engine && (
        <p className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-ink-subtle bg-ink-inset px-2 py-0.5 font-mono text-[11px] text-ink-secondary">
            <FlaskConical aria-hidden className="h-3 w-3 text-civic" />
            {engineLabel(engine)}
            {data.engines.length > 1 && (
              <span className="text-ink-muted">+{data.engines.length - 1}</span>
            )}
          </span>
        </p>
      )}
      <p className="mt-3 font-mono text-[13px] leading-5 text-ink-primary">
        {data.run && band ? (
          <>
            {fmtSigned(finalDelta(data.run))} jobs by {year}
            <span className="block text-[11px] text-ink-muted">
              80% CI [{fmtInt(Math.max(0, band.low))} – {fmtInt(band.high)}]
            </span>
          </>
        ) : (
          <span className="text-ink-muted">No completed run yet</span>
        )}
      </p>
      {data.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-4 text-ink-secondary">
          {data.description}
        </p>
      )}
      <Link
        to={`/simulation?scenario=${encodeURIComponent(data.scenarioId)}`}
        className="mt-3 inline-block text-xs font-medium text-civic hover:text-civic-strong"
      >
        View run →
      </Link>
    </motion.article>
  );
}

export interface ScenarioStripProps {
  scenarios: ScenarioCardData[];
  className?: string;
}

/** Horizontal snap strip of scenario summaries with edge fade masks. */
export default function ScenarioStrip({
  scenarios,
  className,
}: ScenarioStripProps) {
  if (scenarios.length === 0) {
    return (
      <EmptyState
        title="No scenarios yet"
        guidance="Build a scenario in the Simulation Studio to compare policy paths toward the 2027 jobs target."
        className={className}
      />
    );
  }
  return (
    <section className={className} aria-labelledby="scenario-strip-title">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="scenario-strip-title"
          className="text-lg font-semibold text-ink-primary"
        >
          Scenario summaries
        </h2>
        <Link
          to="/simulation"
          className="text-xs font-medium text-civic hover:text-civic-strong"
        >
          Compare all →
        </Link>
      </div>
      <div
        className={cn(
          "mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2",
          "[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]",
          "max-md:flex-col max-md:overflow-visible max-md:[mask-image:none]",
        )}
      >
        {scenarios.map((s, i) => (
          <ScenarioCard key={s.scenarioId} data={s} index={i} />
        ))}
      </div>
    </section>
  );
}
