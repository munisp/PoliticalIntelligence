import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  Gavel,
  Globe2,
  MapPin,
  Search,
  Shield,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/LocaleContext";
import { useFocusReturn } from "@/hooks/use-focus-return";
import type { StakeholderEdge, StakeholderKind, StakeholderNode } from "./types";

/* ------------------------------------------------------------------ */
/* Kind visual model                                                   */
/* ------------------------------------------------------------------ */

const KIND_STYLE: Record<StakeholderKind, { color: string; Icon: LucideIcon }> = {
  individual: { color: "#6C8BD4", Icon: UserRound },
  committee: { color: "#C9A24B", Icon: Gavel },
  ministry: { color: "#3FAE9E", Icon: Building2 },
  agency: { color: "#8B7BC7", Icon: Shield },
  association: { color: "#7FAE6E", Icon: Users },
  state_body: { color: "#D9A441", Icon: MapPin },
  development_partner: { color: "#5E93CF", Icon: Globe2 },
};

const ALL_KINDS = Object.keys(KIND_STYLE) as StakeholderKind[];

/* ------------------------------------------------------------------ */
/* Hand-rolled force simulation (no deps)                              */
/* ------------------------------------------------------------------ */

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
}

function initPositions(ids: string[], prev: Map<string, SimNode>): Map<string, SimNode> {
  const next = new Map<string, SimNode>();
  ids.forEach((id, i) => {
    const existing = prev.get(id);
    if (existing) {
      next.set(id, existing);
      return;
    }
    // Deterministic seed on a phyllotaxis spiral — avoids random layout in tests.
    const angle = i * 2.39996;
    const radius = 30 + 14 * Math.sqrt(i);
    next.set(id, {
      id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      pinned: false,
    });
  });
  return next;
}

function tick(
  sim: Map<string, SimNode>,
  edges: { fromId: string; toId: string }[],
  alpha: number,
) {
  const nodes = [...sim.values()];
  // Repulsion (O(n²), n ≤ ~120).
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = (i - j) * 0.5;
        dy = 0.5;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const f = Math.min((900 * alpha) / d2, 4);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
  // Springs along edges.
  for (const e of edges) {
    const a = sim.get(e.fromId);
    const b = sim.get(e.toId);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const f = ((d - 110) / d) * 0.06 * alpha;
    a.vx += dx * f;
    a.vy += dy * f;
    b.vx -= dx * f;
    b.vy -= dy * f;
  }
  // Weak centering + integrate.
  for (const n of nodes) {
    n.vx += -n.x * 0.008 * alpha;
    n.vy += -n.y * 0.008 * alpha;
    n.vx *= 0.82;
    n.vy *= 0.82;
    if (!n.pinned) {
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function StakeholderMap({
  nodes,
  edges,
  className,
}: {
  nodes: StakeholderNode[];
  edges: StakeholderEdge[];
  className?: string;
}) {
  const t = useT();

  /* ---------- Filters ---------- */
  const [kindFilter, setKindFilter] = useState<StakeholderKind | "">("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [search, setSearch] = useState("");

  const sectors = useMemo(
    () => [...new Set(nodes.flatMap((n) => n.sectorTags))].sort(),
    [nodes],
  );
  const states = useMemo(
    () => [...new Set(nodes.map((n) => n.state).filter((s): s is string => Boolean(s)))].sort(),
    [nodes],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const kept = nodes.filter((n) => {
      if (kindFilter && n.kind !== kindFilter) return false;
      if (sectorFilter && !n.sectorTags.includes(sectorFilter)) return false;
      if (stateFilter && n.state !== stateFilter) return false;
      if (
        q &&
        ![n.name, n.org, n.title].some((s) => s?.toLowerCase().includes(q))
      )
        return false;
      return true;
    });
    const ids = new Set(kept.map((n) => n.stakeholderId));
    return {
      nodes: kept,
      edges: edges.filter((e) => ids.has(e.fromId) && ids.has(e.toId)),
    };
  }, [nodes, edges, kindFilter, sectorFilter, stateFilter, search]);

  /* ---------- Simulation ---------- */
  const [, setFrame] = useState(0);

  const filteredIds = useMemo(
    () => filtered.nodes.map((n) => n.stakeholderId),
    [filtered.nodes],
  );

  // Seed positions synchronously so the first paint already has coordinates
  // (also keeps SSR/test rendering deterministic); the rAF loop then relaxes
  // the layout in place.
  const sim = useMemo(() => initPositions(filteredIds, new Map()), [filteredIds]);

  useEffect(() => {
    if (filteredIds.length === 0) return;
    let alpha = 1;
    let raf = 0;
    const edges = filtered.edges;
    const loop = () => {
      tick(sim, edges, alpha);
      alpha *= 0.985;
      setFrame((f) => f + 1);
      if (alpha > 0.015) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [filteredIds, filtered.edges, sim]);

  /* ---------- Pan / zoom ---------- */
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);
  const dragNodeRef = useRef<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const sx = clientX - rect.left - rect.width / 2;
      const sy = clientY - rect.top - rect.height / 2;
      return {
        x: (sx - view.tx) / view.k,
        y: (sy - view.ty) / view.k,
      };
    },
    [view],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => {
      const k = Math.min(4, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      return { ...v, k };
    });
  }, []);

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragNodeRef.current) {
      const w = toWorld(e.clientX, e.clientY);
      const n = sim.get(dragNodeRef.current);
      if (n) {
        n.x = w.x;
        n.y = w.y;
        n.vx = 0;
        n.vy = 0;
      }
      setFrame((f) => f + 1);
      return;
    }
    const pan = panRef.current;
    if (pan) {
      setView((v) => ({
        ...v,
        tx: pan.tx + (e.clientX - pan.startX),
        ty: pan.ty + (e.clientY - pan.startY),
      }));
    }
  };

  const onSvgPointerUp = () => {
    panRef.current = null;
    dragNodeRef.current = null;
    setIsPanning(false);
  };

  /* ---------- Hover / selection ---------- */
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of filtered.edges) {
      d.set(e.fromId, (d.get(e.fromId) ?? 0) + 1);
      d.set(e.toId, (d.get(e.toId) ?? 0) + 1);
    }
    return d;
  }, [filtered.edges]);

  const selected = useMemo(
    () => nodes.find((n) => n.stakeholderId === selectedId) ?? null,
    [nodes, selectedId],
  );
  const neighbors = useMemo(() => {
    if (!selectedId) return [];
    const ids = new Set<string>();
    for (const e of edges) {
      if (e.fromId === selectedId) ids.add(e.toId);
      if (e.toId === selectedId) ids.add(e.fromId);
    }
    return nodes.filter((n) => ids.has(n.stakeholderId));
  }, [nodes, edges, selectedId]);

  const kindLabel = (k: StakeholderKind): string =>
    ({
      individual: t.advocacy.kindIndividual,
      committee: t.advocacy.kindCommittee,
      ministry: t.advocacy.kindMinistry,
      agency: t.advocacy.kindAgency,
      association: t.advocacy.kindAssociation,
      state_body: t.advocacy.kindStateBody,
      development_partner: t.advocacy.kindDevelopmentPartner,
    })[k];

  const selectCls =
    "rounded-md border border-ink-subtle bg-ink-surface px-2 py-1 text-xs text-ink-primary";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Filter bar */}
      <div
        role="region"
        aria-label={t.advocacy.tabStakeholders}
        className="flex flex-wrap items-center gap-2 rounded-md border border-ink-subtle bg-ink-elevated px-3 py-2"
      >
        <label className="flex min-w-48 flex-1 items-center gap-1.5 rounded-md border border-ink-subtle bg-ink-surface px-2 py-1">
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.advocacy.searchStakeholders}
            aria-label={t.advocacy.searchStakeholders}
            className="w-full bg-transparent text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="caption-label text-ink-muted">{t.advocacy.filterKind}</span>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as StakeholderKind | "")}
            className={selectCls}
          >
            <option value="">{t.advocacy.allKinds}</option>
            {ALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="caption-label text-ink-muted">{t.advocacy.filterSector}</span>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className={selectCls}
          >
            <option value="">{t.advocacy.allSectors}</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="caption-label text-ink-muted">{t.advocacy.filterState}</span>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className={selectCls}
          >
            <option value="">{t.advocacy.allStates}</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Canvas */}
      {filtered.nodes.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-md border border-dashed border-ink-subtle text-[13px] text-ink-muted">
          {t.advocacy.mapEmpty}
        </div>
      ) : (
        <svg
          ref={svgRef}
          role="img"
          aria-label={t.advocacy.tabStakeholders}
          data-testid="stakeholder-map"
          className={cn(
            "h-[520px] w-full touch-none rounded-md border border-ink-subtle bg-ink-surface/60",
            isPanning ? "cursor-grabbing" : "cursor-grab",
          )}
          onWheel={onWheel}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerLeave={onSvgPointerUp}
        >
          <g
            transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}
            // Centering handled by using the svg's own center via a nested group.
          >
            <g transform="translate(480 260)">
              {/* Edges */}
              {filtered.edges.map((e, i) => {
                const a = sim.get(e.fromId);
                const b = sim.get(e.toId);
                if (!a || !b) return null;
                const hovered = hoveredEdge === i;
                return (
                  <g key={`${e.fromId}-${e.toId}-${i}`}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={hovered ? "#3FAE9E" : "#2C3F63"}
                      strokeWidth={hovered ? 1.8 : 1}
                    />
                    {/* Wide invisible hover target */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={12}
                      onPointerEnter={() => setHoveredEdge(i)}
                      onPointerLeave={() => setHoveredEdge(null)}
                    />
                    {hovered && (
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 6}
                        textAnchor="middle"
                        className="pointer-events-none"
                        fill="#E6ECF5"
                        fontSize={11}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {e.label || e.relation}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {filtered.nodes.map((n) => {
                const sn = sim.get(n.stakeholderId);
                if (!sn) return null;
                const style = KIND_STYLE[n.kind];
                const r = 10 + Math.min(10, (degree.get(n.stakeholderId) ?? 0) * 1.6);
                const Icon = style.Icon;
                const hovered = hoveredNode === n.stakeholderId;
                const isSelected = selectedId === n.stakeholderId;
                return (
                  <g
                    key={n.stakeholderId}
                    data-testid={`stakeholder-node-${n.stakeholderId}`}
                    transform={`translate(${sn.x} ${sn.y})`}
                    className="cursor-pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragNodeRef.current = n.stakeholderId;
                      sn.pinned = true;
                      (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(
                        e.pointerId,
                      );
                    }}
                    onPointerUp={() => {
                      dragNodeRef.current = null;
                    }}
                    onPointerEnter={() => setHoveredNode(n.stakeholderId)}
                    onPointerLeave={() => setHoveredNode(null)}
                    onClick={() => setSelectedId(n.stakeholderId)}
                  >
                    <title>{`${n.name} — ${kindLabel(n.kind)}`}</title>
                    <circle
                      r={r + 3}
                      fill="transparent"
                      stroke={isSelected || hovered ? "#E6ECF5" : "transparent"}
                      strokeWidth={1.5}
                    />
                    <circle
                      r={r}
                      fill={style.color}
                      fillOpacity={0.22}
                      stroke={style.color}
                      strokeWidth={1.6}
                    />
                    <Icon
                      x={-r * 0.45}
                      y={-r * 0.45}
                      width={r * 0.9}
                      height={r * 0.9}
                      color={style.color}
                      strokeWidth={2}
                      aria-hidden
                    />
                    <text
                      y={r + 12}
                      textAnchor="middle"
                      fill={hovered || isSelected ? "#E6ECF5" : "#9AA8BF"}
                      fontSize={10.5}
                      fontFamily="IBM Plex Sans, sans-serif"
                      className="pointer-events-none select-none"
                    >
                      {n.name.length > 26 ? `${n.name.slice(0, 24)}…` : n.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      )}

      {/* Legend + honesty footer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-3" aria-label={t.advocacy.legendTitle}>
          {ALL_KINDS.map((k) => (
            <li key={k} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: KIND_STYLE[k].color }}
              />
              {kindLabel(k)}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ink-muted">{t.advocacy.mapFooter}</p>
      </div>

      {/* Detail drawer */}
      <StakeholderDrawer
        node={selected}
        neighbors={neighbors}
        kindLabel={kindLabel}
        onClose={() => setSelectedId(null)}
        onNavigate={(id) => setSelectedId(id)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                       */
/* ------------------------------------------------------------------ */

function StakeholderDrawer({
  node,
  neighbors,
  kindLabel,
  onClose,
  onNavigate,
}: {
  node: StakeholderNode | null;
  neighbors: StakeholderNode[];
  kindLabel: (k: StakeholderKind) => string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = !!node;
  useFocusReturn(open);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open, node?.stakeholderId]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const style = node ? KIND_STYLE[node.kind] : null;

  return (
    <AnimatePresence>
      {node && style && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.6)]"
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${t.advocacy.drawerTitle} — ${node.name}`}
            initial={{ x: 480 + 24 }}
            animate={{ x: 0 }}
            exit={{ x: 480 + 24 }}
            transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l border-ink-subtle bg-ink-elevated shadow-overlay"
          >
            <header className="flex items-start justify-between gap-3 border-b border-ink-subtle p-4">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${style.color}33`, color: style.color }}
                >
                  <style.Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="caption-label" style={{ color: style.color }}>
                    {kindLabel(node.kind)}
                  </p>
                  <h2 className="mt-0.5 text-lg font-semibold text-ink-primary">
                    {node.name}
                  </h2>
                  <p className="text-[13px] text-ink-secondary">
                    {node.title}
                    {node.org ? ` · ${node.org}` : ""}
                  </p>
                </div>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label={t.advocacy.close}
                className="rounded-md p-1.5 text-ink-secondary hover:bg-ink-surface hover:text-ink-primary"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Meta chips */}
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {node.chamber && (
                  <span className="rounded-full border border-ink-subtle bg-ink-surface px-2 py-0.5 text-ink-secondary">
                    {t.advocacy.chamber}: {node.chamber}
                  </span>
                )}
                {node.state && (
                  <span className="rounded-full border border-ink-subtle bg-ink-surface px-2 py-0.5 text-ink-secondary">
                    {t.advocacy.state}: {node.state}
                  </span>
                )}
                {node.sectorTags.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-civic/40 bg-civic/10 px-2 py-0.5 text-civic"
                  >
                    {s}
                  </span>
                ))}
              </div>

              <section>
                <h3 className="caption-label text-ink-muted">{t.advocacy.bio}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                  {node.bio}
                </p>
              </section>

              <section>
                <h3 className="caption-label text-ink-muted">
                  {t.advocacy.influenceArea}
                </h3>
                <p className="mt-1 text-[13px] text-ink-secondary">{node.influenceArea}</p>
              </section>

              <section className="rounded-md border border-civic/30 bg-civic/5 p-3">
                <h3 className="caption-label text-civic">{t.advocacy.lobbyAngle}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-primary">
                  {node.lobbyAngle}
                </p>
              </section>

              <section>
                <h3 className="caption-label flex items-center gap-2 text-ink-muted">
                  {t.advocacy.contactNote}
                  <span className="rounded-full border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-status-warning">
                    {t.advocacy.verifyCurrency} ·{" "}
                    {t.advocacy.asOf.replace("{date}", node.asOf ?? "")}
                  </span>
                </h3>
                <p className="mt-1 text-[13px] text-ink-secondary">{node.contactNote}</p>
              </section>

              <section>
                <h3 className="caption-label text-ink-muted">
                  {t.advocacy.relatedStakeholders}
                </h3>
                {neighbors.length === 0 ? (
                  <p className="mt-1 text-[13px] text-ink-muted">
                    {t.common.emptyGeneric}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {neighbors.map((nb) => {
                      const nbStyle = KIND_STYLE[nb.kind];
                      return (
                        <li key={nb.stakeholderId}>
                          <button
                            type="button"
                            onClick={() => onNavigate(nb.stakeholderId)}
                            className="flex w-full items-center gap-2.5 rounded-md border border-ink-subtle bg-ink-surface px-2.5 py-2 text-left hover:border-ink-strong"
                          >
                            <span
                              aria-hidden
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                              style={{
                                backgroundColor: `${nbStyle.color}33`,
                                color: nbStyle.color,
                              }}
                            >
                              <nbStyle.Icon className="h-3 w-3" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-ink-primary">
                                {nb.name}
                              </span>
                              <span className="block truncate text-[11px] text-ink-muted">
                                {kindLabel(nb.kind)} · {nb.org}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            <footer className="border-t border-ink-subtle p-3 text-[11px] text-ink-muted">
              {t.advocacy.mapFooter}
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
