import "@/lib/cesium-base";
import { useEffect, useRef } from "react";
import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  GeoJsonDataSource,
  ImageryLayer,
  OpenStreetMapImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { FeatureCollection } from "geojson";

/**
 * GEO-2 — token-free CesiumJS 3D view of Kaduna State LGAs.
 *
 * - Imagery: OpenStreetMap raster tiles (no Cesium Ion token required).
 * - Terrain: WGS84 ellipsoid (Cesium World Terrain needs Ion — see
 *   docs/UI-3D.md for how to enable it later).
 * - Data: real LGA boundary polygons extruded by per-LGA facility counts.
 *
 * This component is heavy; always consume it via React.lazy (the Geo3D page
 * does) so the main bundle stays free of cesium code.
 */

export interface Cesium3DViewProps {
  /** Real boundary polygons (e.g. /geo/kaduna-lgas.geojson). */
  geoJson: FeatureCollection;
  /** Extrusion driver: facility counts keyed by bare LGA name ("Kachia"). */
  values?: Record<string, number>;
  /** Click on an LGA polygon → bare LGA name. */
  onSelect?: (lgaName: string) => void;
  className?: string;
}

/** Kaduna State framing (approximate centre, metres above ellipsoid). */
const KADUNA_VIEW = { lon: 7.44, lat: 10.35, height: 430_000 };

/** Extrusion range (metres): a small base so zero-count LGAs still read as 3D. */
const EXTRUSION_BASE = 2_000;
const EXTRUSION_SPAN = 48_000;

/** "Birnin Gwari LGA" → "Birnin Gwari". */
function bareName(name: string): string {
  return name.replace(/ LGA$/, "");
}

/** Civic-ink teal ramp (matches MapPanel.colorFor), 0–1 normalised. */
function colorFor(t: number): Color {
  const c = Math.max(0, Math.min(1, t));
  const mix = (a: number, b: number) => (a + (b - a) * c) / 255;
  return new Color(mix(22, 63), mix(35, 174), mix(60, 158), 0.88);
}

export default function Cesium3DView({
  geoJson,
  values,
  onSelect,
  className,
}: Cesium3DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* Viewer lifecycle — created once, destroyed on unmount. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const viewer = new Viewer(el, {
      baseLayer: new ImageryLayer(
        new OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
        }),
      ),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: true, // render on demand — battery/bandwidth friendly
    });
    viewerRef.current = viewer;

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(
        KADUNA_VIEW.lon,
        KADUNA_VIEW.lat,
        KADUNA_VIEW.height,
      ),
    });
    viewer.scene.screenSpaceCameraController.enableTilt = true;
    viewer.cesiumWidget.creditContainer?.setAttribute(
      "style",
      "font-size:10px;opacity:0.7",
    );

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(
      (movement: ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer.scene.pick(movement.position) as
          | { id?: { properties?: Record<string, { getValue?: () => unknown }> } }
          | undefined;
        const props = picked?.id?.properties;
        const raw = props?.name?.getValue?.() ?? props?.lga?.getValue?.();
        if (typeof raw === "string" && raw) onSelectRef.current?.(bareName(raw));
      },
      ScreenSpaceEventType.LEFT_CLICK,
    );

    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  /* Data layer — reload polygons when boundaries or values change. */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !geoJson?.features?.length) return;
    let cancelled = false;

    const max = Math.max(1, ...Object.values(values ?? { _: 1 }));

    void GeoJsonDataSource.load(geoJson, {
      stroke: Color.fromCssColorString("#2C3F63"),
      fill: colorFor(0.4),
      strokeWidth: 2,
      clampToGround: false,
    }).then((ds) => {
      if (cancelled || viewer.isDestroyed()) return;
      viewer.dataSources.removeAll(true);
      for (const entity of ds.entities.values) {
        const raw =
          entity.properties?.name?.getValue?.() ??
          entity.properties?.lga?.getValue?.() ??
          entity.name ??
          "";
        const count = values?.[bareName(String(raw))] ?? 0;
        const t = count / max;
        if (entity.polygon) {
          entity.polygon.material = new ColorMaterialProperty(colorFor(t));
          entity.polygon.outline = new ConstantProperty(true);
          entity.polygon.outlineColor = new ConstantProperty(
            Color.fromCssColorString("#1E2C47"),
          );
          entity.polygon.height = new ConstantProperty(0);
          entity.polygon.extrudedHeight = new ConstantProperty(
            EXTRUSION_BASE + t * EXTRUSION_SPAN,
          );
        }
      }
      void viewer.dataSources.add(ds);
      viewer.scene.requestRender();
    });

    return () => {
      cancelled = true;
    };
  }, [geoJson, values]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", minHeight: 420 }}
      role="application"
      aria-label="3D geospatial view of Kaduna State LGAs"
    />
  );
}
