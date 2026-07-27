import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { Map as MapIcon, Table2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import DataTable, { type DataTableColumn } from "./DataTable";

export interface LgaDatum {
  id: string;
  name: string;
  /** Choropleth value 0–1 (e.g. opportunity score). */
  value: number;
  hotspot?: boolean;
  [key: string]: unknown;
}

export interface MapPanelProps {
  title: string;
  data: LgaDatum[];
  /** When provided, a MapLibre GL choropleth renders (GeoJSON with `name` +
   *  matching `value` join). Otherwise the static SVG LGA grid is used. */
  geoJson?: FeatureCollection;
  /** Legend label, e.g. "Opportunity score". */
  legendLabel?: string;
  /** Initial view. */
  defaultView?: "map" | "table";
  /** Presentation mode (landing page): hides table toggle controls. */
  presentation?: boolean;
  className?: string;
}

/** Kaduna State LGA names (23) laid out on a simplified 6×4 SVG grid. */
const KADUNA_LGA_GRID: string[] = [
  "Zangon Kataf", "Kaura", "Jema'a", "Kauru", "Lere", "Kubau",
  "Kachia", "Kajuru", "Chikun", "Kaduna South", "Kaduna North", "Ikara",
  "Jaba", "Kagarko", "Igabi", "Giwa", "Makarfi", "Kudan",
  "Sanga", "Birnin Gwari", "Zaria", "Sabon Gari", "Soba",
];

function colorFor(v: number): string {
  // Teal gradient from ink-elevated to accent primary
  const t = Math.max(0, Math.min(1, v));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(22, 63)}, ${mix(35, 174)}, ${mix(60, 158)})`;
}

function SimplifiedKadunaMap({
  data,
  presentation,
}: {
  data: LgaDatum[];
  presentation?: boolean;
}) {
  const byName = useMemo(() => {
    const m = new Map<string, LgaDatum>();
    data.forEach((d) => m.set(d.name, d));
    return m;
  }, [data]);
  const [selected, setSelected] = useState<string | null>(null);

  const cols = 6;
  const cellW = 108;
  const cellH = 64;
  const gap = 6;

  return (
    <svg
      viewBox={`0 0 ${cols * (cellW + gap)} ${4 * (cellH + gap)}`}
      className="h-auto w-full"
      role="img"
      aria-label="Simplified choropleth map of Kaduna State LGAs"
    >
      {KADUNA_LGA_GRID.map((name, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * (cellW + gap);
        const y = row * (cellH + gap);
        const datum = byName.get(name);
        const v = datum?.value ?? 0;
        const isSel = selected === name;
        return (
          <g
            key={name}
            onClick={() => setSelected(isSel ? null : name)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(isSel ? null : name);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`${name}: score ${v.toFixed(2)}`}
            className="cursor-pointer focus:outline-none"
          >
            <rect
              x={x}
              y={y}
              width={cellW}
              height={cellH}
              rx={4}
              fill={colorFor(v)}
              stroke={isSel ? "#63C7B8" : "#1E2C47"}
              strokeWidth={isSel ? 2 : 1}
            />
            {datum?.hotspot && (
              <circle
                cx={x + cellW - 12}
                cy={y + 12}
                r={5}
                fill="#C9A24B"
                className={cn(
                  !presentation && "origin-center",
                  "animate-hotspot-pulse motion-reduce:animate-none",
                )}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              />
            )}
            <text
              x={x + 6}
              y={y + cellH - 20}
              fontSize={9}
              fill="#E6ECF5"
              className="pointer-events-none select-none"
            >
              {name.length > 14 ? `${name.slice(0, 13)}…` : name}
            </text>
            <text
              x={x + 6}
              y={y + cellH - 7}
              fontSize={9}
              fill="#9AA8BF"
              fontFamily="'IBM Plex Mono', monospace"
              className="pointer-events-none select-none"
            >
              {v.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MapLibreView({
  geoJson,
  data,
}: {
  geoJson: FeatureCollection;
  data: LgaDatum[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let map: import("maplibre-gl").Map | null = null;
    const valueByName = new Map(data.map((d) => [d.name, d.value]));

    (async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;
        const joined: FeatureCollection = {
          ...geoJson,
          features: geoJson.features.map((f) => ({
            ...f,
            properties: {
              ...f.properties,
              value:
                valueByName.get(String(f.properties?.name ?? "")) ??
                Number(f.properties?.value ?? 0),
            },
          })),
        };
        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "bg",
                type: "background",
                paint: { "background-color": "#080E1A" },
              },
            ],
          },
          center: [7.45, 10.4],
          zoom: 6.2,
          attributionControl: false,
        });
        map.on("load", () => {
          if (!map) return;
          map.addSource("lgas", { type: "geojson", data: joined });
          map.addLayer({
            id: "lga-fill",
            type: "fill",
            source: "lgas",
            paint: {
              "fill-color": [
                "interpolate",
                ["linear"],
                ["get", "value"],
                0, "#16233C",
                0.5, "#2A6E66",
                1, "#3FAE9E",
              ],
              "fill-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "lga-line",
            type: "line",
            source: "lgas",
            paint: { "line-color": "#1E2C47", "line-width": 1 },
          });
        });
      } catch {
        if (!disposed) setError("Map engine unavailable — showing data grid.");
      }
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [geoJson, data]);

  if (error) {
    return (
      <p className="p-4 text-sm text-status-warning" role="alert">
        {error}
      </p>
    );
  }
  return (
    <div
      ref={containerRef}
      className="h-[420px] w-full rounded-b-md bg-ink-inset"
      aria-label="Kaduna State LGA choropleth map"
    />
  );
}

/** LGA/ward choropleth panel (Kaduna State) with legend, layer label and
 *  a low-bandwidth "view data as table" fallback toggle. */
export default function MapPanel({
  title,
  data,
  geoJson,
  legendLabel = "Opportunity score",
  defaultView = "map",
  presentation = false,
  className,
}: MapPanelProps) {
  const [view, setView] = useState<"map" | "table">(defaultView);

  const columns: DataTableColumn<LgaDatum>[] = [
    { id: "name", header: "LGA", accessor: (r) => r.name, sortValue: (r) => r.name },
    {
      id: "value",
      header: legendLabel,
      numeric: true,
      accessor: (r) => r.value.toFixed(2),
      sortValue: (r) => r.value,
    },
  ];

  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border border-ink-subtle bg-ink-surface",
        className,
      )}
      aria-label={title}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-subtle px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-primary">
          <Layers aria-hidden className="h-4 w-4 text-civic" />
          {title}
        </h3>
        {!presentation && (
          <div
            role="group"
            aria-label="Map view toggle"
            className="flex items-center gap-1"
          >
            <button
              type="button"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs",
                view === "map"
                  ? "border-civic bg-civic/10 text-civic"
                  : "border-ink-subtle text-ink-secondary hover:border-ink-strong",
              )}
            >
              <MapIcon aria-hidden className="h-3.5 w-3.5" />
              Map
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs",
                view === "table"
                  ? "border-civic bg-civic/10 text-civic"
                  : "border-ink-subtle text-ink-secondary hover:border-ink-strong",
              )}
            >
              <Table2 aria-hidden className="h-3.5 w-3.5" />
              View data as table
            </button>
          </div>
        )}
      </header>

      {view === "map" ? (
        <div className="bg-ink-inset p-2">
          {geoJson ? (
            <MapLibreView geoJson={geoJson} data={data} />
          ) : (
            <SimplifiedKadunaMap data={data} presentation={presentation} />
          )}
          <div
            className="flex items-center gap-2 px-2 pb-1 pt-2"
            aria-label={`Legend: ${legendLabel}`}
          >
            <span className="text-xs text-ink-muted">{legendLabel}</span>
            <span
              aria-hidden
              className="h-2 w-32 rounded-full"
              style={{
                background: "linear-gradient(90deg, #16233C, #2A6E66, #3FAE9E)",
              }}
            />
            <span className="font-mono text-[10px] text-ink-muted">0.0 → 1.0</span>
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={data.map((d) => ({ ...d, id: d.id }))}
          caption={legendLabel}
          exportFileName="kaduna-lga-data.csv"
        />
      )}
    </section>
  );
}
