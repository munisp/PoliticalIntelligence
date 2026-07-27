import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FileDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseBriefContent, type BriefRow } from "./brief-utils";

export interface SlideStripProps {
  brief: BriefRow;
  onExportPptx: () => void;
  exporting: boolean;
}

interface Slide {
  id: string;
  title: string;
  bullets: string[];
  /** deterministic 0–1 chart series for the slide mini-chart */
  series: number[];
}

const SLIDE_BLUEPRINTS = [
  { id: "title", title: "Title", hint: "Brief title, date and classification" },
  { id: "situation", title: "Situation", hint: "Status and context" },
  { id: "options", title: "Options", hint: "Options compared" },
  { id: "recommendation", title: "Recommendation", hint: "Recommended course of action" },
  { id: "evidence", title: "Evidence", hint: "Cited sources and provenance" },
  { id: "ask", title: "Decision ask", hint: "What the executive is asked to approve" },
] as const;

function buildSlides(brief: BriefRow): Slide[] {
  const content = parseBriefContent(brief.content);
  const sectionBody = (name: string) =>
    content?.sections.find((s) => s.heading.toLowerCase().includes(name))?.body ?? "";
  const texts: Record<string, string[]> = {
    title: [brief.title, `Kaduna State · ${new Date(brief.createdAt).getFullYear()}`],
    situation: [sectionBody("situation") || "Sector metrics and pipeline freshness indicate a viable intervention window."],
    options: [sectionBody("options") || "Options ranked by opportunity score, estimated jobs and legal readiness."],
    recommendation: [sectionBody("recommendation") || "Proceed with the top-ranked option under phased procurement."],
    evidence:
      content && content.citations_rail.length > 0
        ? content.citations_rail.slice(0, 3).map((c) => c.citation)
        : ["Evidence rail attaches as generation matures.", "All exports annex the numbered source list."],
    ask: [sectionBody("recommendation") || "Approve the recommended option and phased procurement plan."],
  };
  return SLIDE_BLUEPRINTS.map((b, i) => ({
    id: b.id,
    title: b.title,
    bullets: (texts[b.id] ?? [b.hint]).map((t) =>
      t.length > 110 ? `${t.slice(0, 107)}…` : t,
    ),
    series: Array.from({ length: 5 }, (_, k) => {
      const r = Math.abs(Math.sin((i + 1) * (k + 2) * 1.7 + brief.title.length));
      return 0.25 + r * 0.7;
    }),
  }));
}

function MiniChart({ series, large }: { series: number[]; large?: boolean }) {
  const h = large ? 64 : 24;
  const w = large ? 160 : 64;
  const max = Math.max(...series, 0.01);
  const bw = w / series.length;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
      className="shrink-0"
    >
      {series.map((v, i) => (
        <rect
          key={i}
          x={i * bw + bw * 0.2}
          y={h - (v / max) * h}
          width={bw * 0.6}
          height={(v / max) * h}
          rx={1.5}
          fill={i === series.length - 1 ? "#C9A24B" : "#3FAE9E"}
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

/** Presentation preview: 6-slide strip (16:9), drag to reorder, large viewer. */
export default function SlideStrip({ brief, onExportPptx, exporting }: SlideStripProps) {
  const initial = useMemo(() => buildSlides(brief), [brief]);
  const [slides, setSlides] = useState<Slide[]>(initial);
  const [activeId, setActiveId] = useState(initial[0]?.id ?? "title");
  const [dragId, setDragId] = useState<string | null>(null);

  const active = slides.find((s) => s.id === activeId) ?? slides[0];

  const reorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setSlides((prev) => {
      const next = [...prev];
      const from = next.findIndex((s) => s.id === dragId);
      const to = next.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      {/* Large viewer */}
      {active && (
        <div
          aria-label={`Slide: ${active.title}`}
          className="aspect-video w-full rounded-md border border-civic/50 bg-ink-elevated p-6 sm:p-10"
        >
          <p className="caption-label text-civic">
            Slide {slides.findIndex((s) => s.id === active.id) + 1} of {slides.length}
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold text-ink-primary sm:text-3xl">
            {active.id === "title" ? brief.title : active.title}
          </h3>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <ul className="max-w-xl list-disc space-y-2 pl-5 font-serif text-[15px] leading-6 text-ink-secondary">
              {active.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <MiniChart series={active.series} large />
          </div>
        </div>
      )}

      {/* Thumbnail strip — drag to reorder */}
      <div
        className="mt-4 flex gap-3 overflow-x-auto pb-2"
        role="list"
        aria-label="Slide thumbnails — drag to reorder"
      >
        {slides.map((s, i) => {
          const isActive = s.id === activeId;
          return (
            <motion.button
              key={s.id}
              type="button"
              layout="position"
              transition={{ duration: 0.2 }}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                e.preventDefault();
                reorder(s.id);
              }}
              onClick={() => setActiveId(s.id)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, scale: isActive ? 1.02 : 1 }}
              whileTap={{ scale: 0.98 }}
              style={{ transitionDelay: `${i * 0.05}s` }}
              aria-pressed={isActive}
              aria-label={`Slide ${i + 1}: ${s.title}`}
              className={cn(
                "aspect-video w-40 shrink-0 cursor-grab rounded-md border bg-ink-elevated p-2.5 text-left active:cursor-grabbing",
                isActive ? "border-civic shadow-glow-teal" : "border-ink-subtle hover:border-ink-strong",
                dragId === s.id && "opacity-50",
              )}
            >
              <span className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-ink-muted">{i + 1}</span>
                <GripVertical aria-hidden className="h-3 w-3 text-ink-muted" />
              </span>
              <span className="mt-1 block truncate text-[11px] font-semibold text-ink-primary">
                {s.title}
              </span>
              <span aria-hidden className="mt-1 block space-y-1">
                <span className="block h-1 w-full rounded bg-ink-subtle" />
                <span className="block h-1 w-4/5 rounded bg-ink-subtle" />
                <span className="block h-1 w-3/5 rounded bg-ink-subtle" />
              </span>
              <span className="mt-1.5 block">
                <MiniChart series={s.series} />
              </span>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onExportPptx}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base transition-transform hover:bg-civic-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileDown aria-hidden className="h-4 w-4" />
          {exporting ? "Recording export…" : "Export PPTX"}
        </button>
        <p className="text-xs text-ink-muted">
          6-slide deck: title, situation, options, recommendation, evidence, decision ask. The
          evidence slide annexes the numbered source list.
        </p>
      </div>
    </motion.div>
  );
}
