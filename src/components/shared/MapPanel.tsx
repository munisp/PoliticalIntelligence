import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
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

/** Facility marker overlay (geoJson mode), e.g. from geo.facilitiesNear. */
export interface MapMarker {
  lat: number;
  lon: number;
  label: string;
  /** Facility type — drives marker colour. */
  type?: string;
}

export interface MapPanelProps {
  title: string;
  data: LgaDatum[];
  /** When provided, real boundary polygons render (inline SVG
   *  equirectangular projection — no tile/WebGL dependency). Otherwise the
   *  static SVG LGA grid is used. */
  geoJson?: FeatureCollection;
  /** Raw per-unit values keyed by unit name ("Kachia" or "Kachia LGA").
   *  In geoJson mode these drive the choropleth (colour is normalised by
   *  the max value); `data[].value` is the fallback join. */
  values?: Record<string, number>;
  /** Per-unit facility counts for tooltips (same keying as `values`). */
  facilityCounts?: Record<string, number>;
  /** Click handler for a boundary unit (geoJson mode). */
  onSelectUnit?: (name: string) => void;
  /** Currently selected unit name — highlighted in geoJson mode. */
  selectedUnit?: string | null;
  /** Facility markers rendered over the polygons (geoJson mode). */
  markers?: MapMarker[];
  /** Render engine for geoJson mode: "svg" (default — dependency-free
   *  equirectangular projection, full tooltip/click support) or "maplibre"
   *  (WebGL upgrade when the engine can load). */
  engine?: "svg" | "maplibre";
  /** Provenance URL for the boundaries (e.g. OSM relation) — renders a
   *  "Boundaries: OSM live" chip in the header. */
  provenanceUrl?: string | null;
  /** Legend label, e.g. "Opportunity score". */
  legendLabel?: string;
  /** Initial view. */
  defaultView?: "map" | "table";
  /** Presentation mode (landing page): hides table toggle controls. */
  presentation?: boolean;
  /** Compact height for the geoJson SVG map (default 420). */
  mapHeight?: number;
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

/** Short display name: "Birnin Gwari LGA" → "Birnin Gwari". */
function bareName(name: string): string {
  return name.replace(/ LGA$/, "");
}

/** Look up a per-unit record tolerating the "… LGA" suffix. */
function unitLookup(
  rec: Record<string, number> | undefined,
  name: string,
): number | undefined {
  if (!rec) return undefined;
  const bare = bareName(name);
  return rec[bare] ?? rec[name] ?? rec[`${bare} LGA`];
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

/* ------------------------------------------------------------------ */
/* GeoJSON choropleth (real boundary polygons, inline SVG projection)  */
/* ------------------------------------------------------------------ */

type Ring = number[][];

function ringsOfGeometry(geom: Geometry): Ring[] {
  if (geom.type === "Polygon") return geom.coordinates as Ring[];
  if (geom.type === "MultiPolygon")
    return (geom.coordinates as Ring[][]).flat();
  return [];
}

interface ProjectedFeature {
  feature: Feature;
  name: string;
  /** SVG path data for all rings (evenodd fill). */
  d: string;
  /** Label/tooltip anchor (projected bbox centre of the largest ring). */
  cx: number;
  cy: number;
}

const MARKER_COLORS = [
  "#C9A24B",
  "#63C7B8",
  "#7EA2E8",
  "#E8836B",
  "#A98BD4",
  "#8FCB6B",
];

function markerColor(type: string | undefined): string {
  if (!type) return MARKER_COLORS[0];
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return MARKER_COLORS[h % MARKER_COLORS.length];
}

/** Real-polygon choropleth: simple equirectangular fit-to-bbox projection
 *  (no new deps). Hover tooltip shows unit name + value + facility count;
 *  click raises onSelectUnit. */
function GeoJsonChoropleth({
  geoJson,
  data,
  values,
  facilityCounts,
  onSelectUnit,
  selectedUnit,
  markers,
  presentation,
  height = 420,
}: {
  geoJson: FeatureCollection;
  data: LgaDatum[];
  values?: Record<string, number>;
  facilityCounts?: Record<string, number>;
  onSelectUnit?: (name: string) => void;
  selectedUnit?: string | null;
  markers?: MapMarker[];
  presentation?: boolean;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    name: string;
    x: number;
    y: number;
  } | null>(null);

  const valueByName = useMemo(() => {
    const m = new Map<string, number>();
    data.forEach((d) => m.set(d.name, d.value));
    return m;
  }, [data]);

  const { features, project, width, vbHeight } = useMemo(() => {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const f of geoJson.features) {
      for (const ring of ringsOfGeometry(f.geometry)) {
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    if (!Number.isFinite(minLon)) {
      minLon = 6; maxLon = 9; minLat = 9; maxLat = 11.8;
    }
    // Equirectangular with longitude scaled by cos(mean latitude).
    const latScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const spanX = Math.max(1e-6, (maxLon - minLon) * latScale);
    const spanY = Math.max(1e-6, maxLat - minLat);
    const W = 800;
    const pad = 12;
    const s = (W - pad * 2) / spanX;
    const H = Math.min(620, Math.max(220, spanY * s + pad * 2));
    const project = (lon: number, lat: number): [number, number] => [
      pad + (lon - minLon) * latScale * s,
      H - pad - (lat - minLat) * s,
    ];
    const features: ProjectedFeature[] = geoJson.features.map((f) => {
      const rings = ringsOfGeometry(f.geometry);
      let d = "";
      let big: Ring | null = null;
      for (const ring of rings) {
        if (!big || ring.length > big.length) big = ring;
        d +=
          ring
            .map(([lon, lat], i) => {
              const [x, y] = project(lon, lat);
              return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join("") + "Z";
      }
      let cx = W / 2;
      let cy = H / 2;
      if (big && big.length > 0) {
        let sx = 0;
        let sy = 0;
        for (const [lon, lat] of big) {
          const [x, y] = project(lon, lat);
          sx += x;
          sy += y;
        }
        cx = sx / big.length;
        cy = sy / big.length;
      }
      const name = String(
        f.properties?.name ?? f.properties?.lga ?? f.properties?.unit_id ?? "—",
      );
      return { feature: f, name, d, cx, cy };
    });
    return { features, project, width: W, vbHeight: H };
  }, [geoJson]);

  /** Raw value per feature (from `values` first, then the data join). */
  const rawValue = (name: string): number =>
    unitLookup(values, name) ?? valueByName.get(bareName(name)) ?? 0;

  const maxValue = useMemo(() => {
    let m = 0;
    for (const f of features) m = Math.max(m, rawValue(f.name));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, values, valueByName]);

  const colorOf = (name: string): string => {
    const raw = rawValue(name);
    // When raw values exceed 1 they are counts — normalise by the max.
    const v = maxValue > 1 ? raw / maxValue : raw;
    return colorFor(v);
  };

  const projectedMarkers = useMemo(
    () =>
      (markers ?? []).map((mk) => {
        const [x, y] = project(mk.lon, mk.lat);
        return { ...mk, x, y };
      }),
    [markers, project],
  );

  const hoverFeature = hover
    ? features.find((f) => f.name === hover.name)
    : null;

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${width} ${vbHeight}`}
        className="h-auto w-full"
        style={{ maxHeight: height }}
        role="img"
        aria-label="Choropleth map of Kaduna State LGA boundaries"
        onMouseLeave={() => setHover(null)}
      >
        {features.map((f) => {
          const isSel = selectedUnit === bareName(f.name) || selectedUnit === f.name;
          return (
            <path
              key={String(f.feature.properties?.unit_id ?? f.name)}
              d={f.d}
              fill={colorOf(f.name)}
              fillRule="evenodd"
              stroke={isSel ? "#63C7B8" : "#1E2C47"}
              strokeWidth={isSel ? 2 : 0.8}
              tabIndex={onSelectUnit ? 0 : undefined}
              role={onSelectUnit ? "button" : undefined}
              aria-label={`${f.name}: ${rawValue(f.name)}`}
              className={cn(
                onSelectUnit && "cursor-pointer focus:outline-none",
                "transition-[fill] duration-150",
              )}
              onMouseEnter={() => setHover({ name: f.name, x: f.cx, y: f.cy })}
              onFocus={() => setHover({ name: f.name, x: f.cx, y: f.cy })}
              onBlur={() => setHover(null)}
              onClick={() => onSelectUnit?.(bareName(f.name))}
              onKeyDown={(e) => {
                if (onSelectUnit && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelectUnit(bareName(f.name));
                }
              }}
            />
          );
        })}
        {projectedMarkers.map((mk, i) => (
          <g key={`${mk.label}-${i}`} aria-hidden={!mk.label}>
            <circle
              cx={mk.x}
              cy={mk.y}
              r={4.5}
              fill={markerColor(mk.type)}
              stroke="#080E1A"
              strokeWidth={1.2}
            >
              <title>{`${mk.label}${mk.type ? ` (${mk.type})` : ""}`}</title>
            </circle>
          </g>
        ))}
      </svg>

      {/* Hover tooltip: unit name + value + facility count */}
      {hover && hoverFeature && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-ink-subtle bg-ink-elevated px-2.5 py-1.5 text-[11px] shadow-overlay"
          style={{
            left: `${(hover.x / width) * 100}%`,
            top: `${(hover.y / vbHeight) * 100}%`,
          }}
        >
          <p className="font-medium text-ink-primary">{hover.name}</p>
          <p className="font-mono text-ink-secondary">
            value {rawValue(hover.name)}
            {unitLookup(facilityCounts, hover.name) != null &&
              ` · facilities ${unitLookup(facilityCounts, hover.name)}`}
          </p>
        </div>
      )}

      {/* Marker count badge */}
      {projectedMarkers.length > 0 && !presentation && (
        <span className="absolute bottom-2 right-2 rounded-full border border-ink-subtle bg-ink-base/85 px-2 py-0.5 font-mono text-[10px] text-ink-secondary">
          {projectedMarkers.length} facilities shown
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MapLibre enhancement (optional — only when the engine loads)        */
/* ------------------------------------------------------------------ */

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
  values,
  facilityCounts,
  onSelectUnit,
  selectedUnit,
  markers,
  engine = "svg",
  provenanceUrl,
  legendLabel = "Opportunity score",
  defaultView = "map",
  presentation = false,
  mapHeight = 420,
  className,
}: MapPanelProps) {
  const [view, setView] = useState<"map" | "table">(defaultView);

  // Table view is fed by the real per-unit values when provided.
  const tableRows = useMemo<LgaDatum[]>(() => {
    if (!values && !facilityCounts) return data;
    return data.map((d) => ({
      ...d,
      value: unitLookup(values, d.name) ?? d.value,
      facilityCount: unitLookup(facilityCounts, d.name),
    }));
  }, [data, values, facilityCounts]);

  const showFacilityCol =
    facilityCounts != null && Object.keys(facilityCounts).length > 0;

  const columns: DataTableColumn<LgaDatum>[] = [
    { id: "name", header: "LGA", accessor: (r) => r.name, sortValue: (r) => r.name },
    {
      id: "value",
      header: legendLabel,
      numeric: true,
      accessor: (r) =>
        typeof r.value === "number" && r.value <= 1 && !values
          ? r.value.toFixed(2)
          : String(r.value),
      sortValue: (r) => r.value,
    },
    ...(showFacilityCol
      ? [
          {
            id: "facilities",
            header: "Facilities",
            numeric: true,
            accessor: (r: LgaDatum) => String(r.facilityCount ?? 0),
            sortValue: (r: LgaDatum) => Number(r.facilityCount ?? 0),
          } satisfies DataTableColumn<LgaDatum>,
        ]
      : []),
  ];

  const provenanceHost = useMemo(() => {
    if (!provenanceUrl) return null;
    try {
      return new URL(provenanceUrl).host;
    } catch {
      return null;
    }
  }, [provenanceUrl]);

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
        <div className="flex items-center gap-2">
          {provenanceUrl && (
            <a
              href={provenanceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-status-success/40 bg-status-success/10 px-2 py-0.5 text-[10px] font-medium text-status-success"
              title={provenanceUrl}
            >
              Boundaries: {provenanceHost?.includes("openstreetmap")
                ? "OSM live"
                : (provenanceHost ?? "live source")}
            </a>
          )}
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
        </div>
      </header>

      {view === "map" ? (
        <div className="bg-ink-inset p-2">
          {geoJson && engine === "maplibre" ? (
            <MapLibreView geoJson={geoJson} data={data} />
          ) : geoJson ? (
            <GeoJsonChoropleth
              geoJson={geoJson}
              data={data}
              values={values}
              facilityCounts={facilityCounts}
              onSelectUnit={onSelectUnit}
              selectedUnit={selectedUnit}
              markers={markers}
              presentation={presentation}
              height={mapHeight}
            />
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
            <span className="font-mono text-[10px] text-ink-muted">
              {values && maxOf(values) > 1
                ? `0 → ${maxOf(values)}`
                : "0.0 → 1.0"}
            </span>
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={tableRows.map((d) => ({ ...d, id: d.id }))}
          caption={legendLabel}
          exportFileName="kaduna-lga-data.csv"
        />
      )}
    </section>
  );
}

function maxOf(rec: Record<string, number>): number {
  let m = 0;
  for (const k of Object.keys(rec)) m = Math.max(m, rec[k]);
  return m;
}
