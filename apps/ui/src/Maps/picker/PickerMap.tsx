import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, MapView, type PickingInfo } from "@deck.gl/core";
import { PathLayer, PolygonLayer, TextLayer } from "@deck.gl/layers";
import { webgl2Adapter } from "@luma.gl/webgl";
import { Button } from "@/components/Inputs";
import Attribution, { type Credit } from "@/Map/Attribution";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import { resolveMapColor } from "@/lib/mapColor";
import { LABEL_TOKEN, mapLabelProps } from "@/lib/mapLabels";
import { cn } from "@/lib/utils";
import { adjustArea, drawArea, type Outline, selectArea, useAreaDraft } from "../areaDraft";
import { bboxAreaKm2, formatArea, shrinkToArea } from "../bbox";
import type { Bbox, GeofabrikOutline, MapLibrary, MapPreset } from "../mapsClient";
import { type Country, useBasemap, useOutlines } from "./basemap";
import {
  HANDLES,
  type Handle,
  MAX_ZOOM,
  MIN_ZOOM,
  OPENING_MAX_ZOOM,
  type PickerViewState,
  WORLD_VIEW,
  drawBox,
  moveBox,
  projectLngLat,
  resizeBox,
  ring,
  unprojectPx,
  viewForBbox,
} from "./geometry";

/**
 * The New map area picker's world map: its own deck.gl view, independent of
 * the simulation map's camera, free to pan and zoom over the whole world.
 *
 * It shows, over Natural Earth's countries: the place being looked at in the
 * search results (its boundary from OpenStreetMap, and its extent), the box
 * the map will be built from, and the Geofabrik extract that box is cut from.
 * The box is adjusted with eight handles and a grip in its middle, or drawn
 * afresh anywhere with "Draw area"; it never grows past the server's area cap,
 * so only a buildable box can be chosen. A legend toggles three overlays:
 * the preset areas (click one to use it), the library's map extents, and
 * Geofabrik's extract outlines (hover for a name).
 *
 * Drags stay off React's render path: drawing paints a plain DOM rectangle
 * and commits once, on release; moving and resizing commit at most once per
 * animation frame.
 */

/** Below this size on screen the box shows no handles: they would cover it. */
const MIN_EDIT_PX = 28;
/** A press that moves less than this (px) is a click, not a drawn box. */
const MIN_DRAW_PX = 4;

const TOKENS = {
  land: "var(--color-picker-land)",
  border: "var(--color-picker-border)",
  place: "var(--color-picker-outline)",
  box: "var(--color-overlay-draw)",
  extract: "var(--color-accent)",
  preset: "var(--color-picker-preset)",
  library: "var(--color-picker-library)",
  region: "var(--color-picker-region)",
} as const;

const CREDIT_NATURAL_EARTH: Credit = {
  id: "natural-earth",
  label: "Natural Earth",
  href: "https://www.naturalearthdata.com/about/terms-of-use/",
};
const CREDIT_GEOFABRIK: Credit = {
  id: "geofabrik",
  label: "Geofabrik",
  href: "https://download.geofabrik.de/",
};
const CREDIT_OSM: Credit = {
  id: "osm",
  label: "© OpenStreetMap contributors",
  href: "https://www.openstreetmap.org/copyright",
};

const PICKER_VIEW = new MapView({
  id: "picker",
  repeat: false,
  controller: { scrollZoom: { smooth: false }, inertia: 0, dragRotate: false, touchRotate: false },
});

type Corner = [number, number];
/** A camera, optionally flying to itself. */
type AnimatedView = PickerViewState & {
  transitionDuration?: number;
  transitionInterpolator?: FlyToInterpolator;
};
type Drag =
  | { kind: "move"; startGeo: Corner; start: Bbox }
  | { kind: "resize"; handle: Handle; start: Bbox };

/** A box being drawn: where the press began, and the box so far. */
interface Sketch {
  anchor: Corner;
  anchorPx: Corner;
  bbox: Bbox | null;
  far: boolean;
}

export type OverlayId = "presets" | "library" | "regions";
const OVERLAYS: { id: OverlayId; label: string; token: string }[] = [
  { id: "presets", label: "Presets", token: TOKENS.preset },
  { id: "library", label: "Library maps", token: TOKENS.library },
  { id: "regions", label: "Geofabrik regions", token: TOKENS.region },
];

interface PolygonDatum {
  polygon: [number, number][][];
}
interface RegionDatum extends PolygonDatum {
  name: string;
  path: string;
}
interface LibraryDatum {
  id: string;
  label: string;
  bbox: Bbox;
  active: boolean;
}

const polygonsOf = (outline: Outline | null | undefined): PolygonDatum[] =>
  (outline ?? []).map((polygon) => ({ polygon }));

const outlinePolygons = (outlines: GeofabrikOutline[]): PolygonDatum[] =>
  outlines.flatMap((o) => polygonsOf(o.polygons));

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-popover)",
  color: "var(--color-popover-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  padding: "3px 8px",
  fontSize: "11px",
};

export interface PickerMapProps {
  library: MapLibrary | null;
  /** The server's area cap: the box cannot be adjusted past it. */
  maxAreaKm2: number | null;
  /** The server's preset areas (`/maps/presets`), drawn as a clickable overlay. */
  presets?: MapPreset[];
  /** Fixed canvas size, for tests (jsdom has no layout). */
  size?: { width: number; height: number };
}

const NO_PRESETS: MapPreset[] = [];

export default function PickerMap({
  library,
  maxAreaKm2,
  presets = NO_PRESETS,
  size: fixedSize,
}: PickerMapProps) {
  const { bbox, outline, preview, focus, extract } = useAreaDraft();
  const [containerRef, observed] = useResizeObserver();
  const size = fixedSize ?? observed;
  const basemap = useBasemap();
  const outlines = useOutlines();
  const [view, setView] = useState<AnimatedView>(WORLD_VIEW);
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<{ id: number; next: Bbox } | null>(null);
  // Deck mounts only once the camera is framed: it then starts from that view
  // and never from the placeholder.
  const [framed, setFramed] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [capped, setCapped] = useState(false);
  const sketchRef = useRef<Sketch | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<Record<OverlayId, boolean>>({
    presets: true,
    library: true,
    regions: true,
  });
  const [overPreset, setOverPreset] = useState(false);

  const activeBbox = library?.maps.find((m) => m.id === library.activeId)?.bbox ?? null;

  // Start on the active map, at about country scale, once the canvas has a size.
  useEffect(() => {
    if (framed || !size.width || !size.height) return;
    const start = bbox ?? activeBbox;
    setView(
      start ? viewForBbox(start, size.width, size.height, 120, OPENING_MAX_ZOOM) : WORLD_VIEW
    );
    setFramed(true);
  }, [framed, size.width, size.height, bbox, activeBbox]);

  // Fly to each place the form points at (a result as it arrives or is
  // hovered, a picked one). Adjusting the box on the map does not fly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fly once per focus request.
  useEffect(() => {
    if (!focus || !framed || !size.width || !size.height) return;
    setView({
      ...viewForBbox(focus.bbox, size.width, size.height, 64),
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator({ speed: 2.4 }),
    });
  }, [focus?.seq, framed]);

  // A pending frame's box is never dropped, even if the picker closes mid-drag.
  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current.id);
    },
    []
  );

  // ── Pointer: move and resize, never past the cap ───────────────────
  const geoAt = (e: PointerEvent<HTMLElement>): Corner | null => {
    const host = containerRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    return unprojectPx(view, size.width, size.height, [
      e.clientX - rect.left,
      e.clientY - rect.top,
    ]);
  };

  const begin = (e: PointerEvent<HTMLElement>, next: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = next;
  };

  const onMoveDown = (e: PointerEvent<HTMLElement>) => {
    const at = geoAt(e);
    if (e.button === 0 && bbox && at) begin(e, { kind: "move", startGeo: at, start: bbox });
  };

  const onHandleDown = (handle: Handle) => (e: PointerEvent<HTMLElement>) => {
    if (e.button === 0 && bbox) begin(e, { kind: "resize", handle, start: bbox });
  };

  /** Commits the latest dragged box now, rather than on the next frame. */
  const flushFrame = () => {
    const pending = frameRef.current;
    if (!pending) return;
    cancelAnimationFrame(pending.id);
    frameRef.current = null;
    adjustArea(pending.next);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    const at = d ? geoAt(e) : null;
    if (!d || !at) return;
    const next =
      d.kind === "move"
        ? moveBox(d.start, at[0] - d.startGeo[0], at[1] - d.startGeo[1])
        : resizeBox(d.start, d.handle, at);
    // Only a buildable box: a resize past the cap stops where it is.
    if (maxAreaKm2 !== null && bboxAreaKm2(next) > maxAreaKm2) return;
    if (next[0] >= next[2] || next[1] >= next[3]) return;
    // Pointer events can outpace the screen: commit at most once per frame.
    if (frameRef.current) {
      frameRef.current.next = next;
      return;
    }
    const id = requestAnimationFrame(() => {
      const pending = frameRef.current;
      frameRef.current = null;
      if (pending) adjustArea(pending.next);
    });
    frameRef.current = { id, next };
  };

  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    dragRef.current = null;
    flushFrame();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // ── Drawing a new box ──────────────────────────────────────────────
  const paintBand = (box: Bbox | null) => {
    const band = bandRef.current;
    if (!band) return;
    if (!box) {
      band.style.display = "none";
      return;
    }
    const [x0, y0] = projectLngLat(view, size.width, size.height, [box[0], box[3]]);
    const [x1, y1] = projectLngLat(view, size.width, size.height, [box[2], box[1]]);
    band.style.display = "block";
    band.style.left = `${x0}px`;
    band.style.top = `${y0}px`;
    band.style.width = `${Math.max(0, x1 - x0)}px`;
    band.style.height = `${Math.max(0, y1 - y0)}px`;
  };

  const stopDrawing = useCallback(() => {
    sketchRef.current = null;
    const band = bandRef.current;
    if (band) band.style.display = "none";
    setCapped(false);
    setDrawing(false);
  }, []);

  const onDrawDown = (e: PointerEvent<HTMLElement>) => {
    const at = geoAt(e);
    if (e.button !== 0 || !at) return;
    e.preventDefault();
    sketchRef.current = { anchor: at, anchorPx: [e.clientX, e.clientY], bbox: null, far: false };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Not an active pointer (a synthetic event): the surface still covers the map.
    }
  };

  const onDrawMove = (e: PointerEvent<HTMLElement>) => {
    const sketch = sketchRef.current;
    const at = sketch ? geoAt(e) : null;
    if (!sketch || !at) return;
    sketch.far ||=
      Math.abs(e.clientX - sketch.anchorPx[0]) >= MIN_DRAW_PX ||
      Math.abs(e.clientY - sketch.anchorPx[1]) >= MIN_DRAW_PX;
    if (!sketch.far) return;
    const drawn = drawBox(sketch.anchor, at, maxAreaKm2);
    sketch.bbox = drawn.bbox;
    paintBand(drawn.bbox);
    // Re-renders only when the note appears or goes.
    setCapped(drawn.capped);
  };

  const onDrawEnd = (e: PointerEvent<HTMLElement>) => {
    const sketch = sketchRef.current;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!sketch) return;
    // A click, not a drag: keep drawing.
    if (!sketch.bbox || sketch.bbox[0] >= sketch.bbox[2] || sketch.bbox[1] >= sketch.bbox[3]) {
      sketchRef.current = null;
      paintBand(null);
      return;
    }
    const drawn = sketch.bbox;
    stopDrawing();
    drawArea(drawn);
  };

  // Esc leaves drawing (and drops a box half drawn) without closing the dialog.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stopDrawing();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawing, stopDrawing]);

  // ── Layers ─────────────────────────────────────────────────────────
  const countries = basemap.status === "ready" ? basemap.data.countries : null;
  const regions = outlines.status === "ready" ? (outlines.data?.regions ?? null) : null;
  const labelZoom = Math.floor(view.zoom * 2) / 2;

  const countryLayers = useMemo(() => {
    if (!countries) return [];
    const polygons = countries.flatMap((c) => polygonsOf(c.geometry.coordinates));
    return [
      new PolygonLayer<PolygonDatum>({
        id: "picker-countries",
        data: polygons,
        getPolygon: (d) => d.polygon,
        getFillColor: resolveMapColor(TOKENS.land),
        getLineColor: resolveMapColor(TOKENS.border),
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        stroked: true,
        filled: true,
        pickable: false,
      }),
    ];
  }, [countries]);

  // Country names: a fixed small set, filtered by Natural Earth's own label zoom.
  const labelLayers = useMemo(() => {
    if (!countries) return [];
    return [
      new TextLayer<Country>({
        ...mapLabelProps(11),
        id: "picker-country-labels",
        data: countries.filter((c) => c.properties.minZoom <= labelZoom + 1.3),
        getText: (c) => c.properties.name,
        getPosition: (c) => c.properties.label,
        getColor: resolveMapColor(LABEL_TOKEN, 170),
        characterSet: "auto",
        pickable: false,
      }),
    ];
  }, [countries, labelZoom]);

  // Every extract's outline, deeper (smaller) ones on top so they are hovered first.
  const regionLayers = useMemo(() => {
    if (!regions || !shown.regions) return [];
    const data: RegionDatum[] = [...regions]
      .sort((a, b) => a.depth - b.depth)
      .flatMap((r) => r.polygons.map((polygon) => ({ polygon, name: r.name, path: r.path })));
    return [
      new PolygonLayer<RegionDatum>({
        id: "picker-regions",
        data,
        getPolygon: (d) => d.polygon,
        // A trace of fill so the whole region, not just its edge, is hoverable.
        getFillColor: resolveMapColor(TOKENS.region, 4),
        getLineColor: resolveMapColor(TOKENS.region, 110),
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        stroked: true,
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: resolveMapColor(TOKENS.region, 60),
      }),
    ];
  }, [regions, shown.regions]);

  const extractLayers = useMemo(() => {
    if (!regions || !extract.selected) return [];
    return [
      new PolygonLayer<PolygonDatum>({
        id: "picker-extract",
        data: outlinePolygons(regions.filter((r) => r.path === extract.selected)),
        getPolygon: (d) => d.polygon,
        getFillColor: resolveMapColor(TOKENS.extract, 22),
        getLineColor: resolveMapColor(TOKENS.extract, 200),
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        stroked: true,
        filled: true,
        pickable: false,
      }),
    ];
  }, [regions, extract.selected]);

  const libraryData = useMemo<LibraryDatum[]>(
    () =>
      (library?.maps ?? []).flatMap((m) =>
        m.bbox
          ? [{ id: m.id, label: m.label, bbox: m.bbox, active: m.id === library?.activeId }]
          : []
      ),
    [library]
  );

  const libraryLayers = useMemo(() => {
    if (!shown.library || libraryData.length === 0) return [];
    // The active map last, so it draws over any neighbour it overlaps.
    const data = [...libraryData].sort((a, b) => Number(a.active) - Number(b.active));
    return [
      new PathLayer<LibraryDatum>({
        id: "picker-library",
        data,
        getPath: (d) => ring(d.bbox),
        getColor: (d) => resolveMapColor(TOKENS.library, d.active ? 255 : 150),
        getWidth: (d) => (d.active ? 2.5 : 1.25),
        widthUnits: "pixels",
        pickable: false,
      }),
      new TextLayer<LibraryDatum>({
        ...mapLabelProps(10),
        id: "picker-library-labels",
        data,
        getText: (d) => (d.active ? `${d.label} (active)` : d.label),
        getPosition: (d) => [d.bbox[0], d.bbox[3]],
        getTextAnchor: "start",
        getAlignmentBaseline: "bottom",
        getPixelOffset: [2, -2],
        getColor: (d) => resolveMapColor(TOKENS.library, d.active ? 255 : 200),
        characterSet: "auto",
        pickable: false,
      }),
    ];
  }, [libraryData, shown.library]);

  const choosePreset = useCallback(
    (p: MapPreset) => {
      const fits = maxAreaKm2 === null || bboxAreaKm2(p.bbox) <= maxAreaKm2;
      const box = fits || maxAreaKm2 === null ? p.bbox : shrinkToArea(p.bbox, maxAreaKm2);
      selectArea(box, undefined, { kind: "preset", name: p.label });
    },
    [maxAreaKm2]
  );

  const presetLayers = useMemo(() => {
    if (!shown.presets || presets.length === 0) return [];
    return [
      new PolygonLayer<MapPreset>({
        id: "picker-presets",
        data: presets,
        getPolygon: (p) => ring(p.bbox),
        getFillColor: resolveMapColor(TOKENS.preset, 30),
        getLineColor: resolveMapColor(TOKENS.preset, 220),
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        stroked: true,
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: resolveMapColor(TOKENS.preset, 90),
        onClick: ({ object }: PickingInfo<MapPreset>) => {
          if (object) choosePreset(object);
          return true;
        },
        onHover: ({ object }: PickingInfo<MapPreset>) => setOverPreset(Boolean(object)),
      }),
      new TextLayer<MapPreset>({
        ...mapLabelProps(10),
        id: "picker-preset-labels",
        data: presets,
        getText: (p) => p.label,
        getPosition: (p) => [(p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2],
        getColor: resolveMapColor(TOKENS.preset, 255),
        characterSet: "auto",
        pickable: false,
      }),
    ];
  }, [presets, shown.presets, choosePreset]);

  const placeLayers = useMemo(() => {
    const shownPlace = preview ?? (outline ? { bbox: null, outline } : null);
    if (!shownPlace) return [];
    return [
      new PolygonLayer<PolygonDatum>({
        id: "picker-place",
        data: polygonsOf(shownPlace.outline),
        getPolygon: (d) => d.polygon,
        getFillColor: resolveMapColor(TOKENS.place, 28),
        getLineColor: resolveMapColor(TOKENS.place, 230),
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        stroked: true,
        filled: true,
        pickable: false,
      }),
      new PathLayer<{ path: [number, number][] }>({
        id: "picker-place-extent",
        data: preview ? [{ path: ring(preview.bbox) }] : [],
        getPath: (d) => d.path,
        getColor: resolveMapColor(TOKENS.place, 160),
        getWidth: 1,
        widthUnits: "pixels",
        pickable: false,
      }),
    ];
  }, [preview, outline]);

  const boxLayers = useMemo(() => {
    if (!bbox) return [];
    return [
      new PolygonLayer<{ polygon: [number, number][] }>({
        id: "picker-box",
        data: [{ polygon: ring(bbox) }],
        getPolygon: (d) => d.polygon,
        getFillColor: resolveMapColor(TOKENS.box, 40),
        getLineColor: resolveMapColor(TOKENS.box),
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        pickable: false,
      }),
    ];
  }, [bbox]);

  const layers = useMemo(
    () => [
      ...countryLayers,
      ...regionLayers,
      ...extractLayers,
      ...libraryLayers,
      ...presetLayers,
      ...placeLayers,
      ...labelLayers,
      ...boxLayers,
    ],
    [
      countryLayers,
      regionLayers,
      extractLayers,
      libraryLayers,
      presetLayers,
      placeLayers,
      labelLayers,
      boxLayers,
    ]
  );

  const onViewStateChange = useCallback(({ viewState }: { viewState: unknown }) => {
    const v = viewState as PickerViewState;
    setView({ ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom)), pitch: 0, bearing: 0 });
  }, []);

  const getTooltip = useCallback((info: PickingInfo) => {
    const object = info.object as { name?: string; label?: string } | undefined;
    if (!object) return null;
    if (info.layer?.id === "picker-regions" && object.name) {
      return { text: object.name, style: TOOLTIP_STYLE };
    }
    if (info.layer?.id === "picker-presets" && object.label) {
      return { text: `${object.label}: click to use this area`, style: TOOLTIP_STYLE };
    }
    return null;
  }, []);

  // ── Box handles, in screen pixels ──────────────────────────────────
  let screenBox: { left: number; top: number; right: number; bottom: number } | null = null;
  if (bbox && size.width > 0 && !drawing) {
    const [x0, y0] = projectLngLat(view, size.width, size.height, [bbox[0], bbox[3]]);
    const [x1, y1] = projectLngLat(view, size.width, size.height, [bbox[2], bbox[1]]);
    // Too small on screen to grab: zoom in to adjust it.
    if (x1 - x0 >= MIN_EDIT_PX && y1 - y0 >= MIN_EDIT_PX) {
      screenBox = { left: x0, top: y0, right: x1, bottom: y1 };
    }
  }

  const regionsUnavailable =
    outlines.status === "error" || (outlines.status === "ready" && outlines.data === null);
  const credits = [CREDIT_NATURAL_EARTH, ...(regions ? [CREDIT_GEOFABRIK] : []), CREDIT_OSM];
  const dragProps = {
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };

  return (
    <div
      ref={containerRef}
      data-testid="picker-map"
      className="relative h-full min-h-0 w-full overflow-hidden bg-[var(--color-picker-sea)]"
    >
      {framed && size.width > 0 && size.height > 0 && (
        <DeckGL
          width={size.width}
          height={size.height}
          views={PICKER_VIEW}
          viewState={view}
          onViewStateChange={onViewStateChange}
          layers={layers}
          getTooltip={getTooltip}
          getCursor={({ isDragging }) =>
            isDragging ? "grabbing" : overPreset ? "pointer" : "grab"
          }
          deviceProps={{ adapters: [webgl2Adapter] }}
        />
      )}

      {screenBox && (
        <div data-testid="picker-box-editor" className="pointer-events-none absolute inset-0">
          <button
            type="button"
            aria-label="Move the area"
            title="Drag to move the area"
            data-testid="picker-move"
            className="pointer-events-auto absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border-2 border-[var(--color-overlay-draw)] bg-background/80 shadow-elevated"
            style={{
              left: (screenBox.left + screenBox.right) / 2,
              top: (screenBox.top + screenBox.bottom) / 2,
            }}
            onPointerDown={onMoveDown}
            {...dragProps}
          />
          {HANDLES.map((h) => (
            <button
              key={h}
              type="button"
              aria-label={`Resize the area (${h})`}
              data-testid={`picker-handle-${h}`}
              className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 touch-none rounded-[3px] border-2 border-[var(--color-overlay-draw)] bg-background"
              style={handleStyle(h, screenBox)}
              onPointerDown={onHandleDown(h)}
              {...dragProps}
            />
          ))}
        </div>
      )}

      {drawing && (
        <div
          data-testid="picker-draw-surface"
          className="absolute inset-0 z-10 cursor-crosshair touch-none"
          onPointerDown={onDrawDown}
          onPointerMove={onDrawMove}
          onPointerUp={onDrawEnd}
          onPointerCancel={stopDrawing}
        >
          <div
            ref={bandRef}
            data-testid="picker-draw-band"
            className="pointer-events-none absolute hidden border-2 border-[var(--color-overlay-draw)] bg-[color-mix(in_oklab,var(--color-overlay-draw)_16%,transparent)]"
          />
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute top-2 left-2 z-20 flex flex-col gap-1 text-micro"
      >
        {basemap.status === "loading" && <PickerNote>Loading the world map…</PickerNote>}
        {basemap.status === "error" && <PickerNote tone="error">{basemap.error}</PickerNote>}
        {regionsUnavailable && (
          <PickerNote tone="warn">
            Geofabrik extracts are unavailable; showing countries only.
          </PickerNote>
        )}
        {drawing && <PickerNote>Drag on the map to draw the area. Esc cancels.</PickerNote>}
        {drawing && capped && maxAreaKm2 !== null && (
          <PickerNote tone="warn">Capped at the {formatArea(maxAreaKm2)} area limit.</PickerNote>
        )}
        {!bbox && !preview && !drawing && (
          <PickerNote>Search a place, or draw an area on the map.</PickerNote>
        )}
      </div>

      <div className="absolute top-2 right-2 z-20">
        <Button
          size="xs"
          type="button"
          aria-pressed={drawing}
          className={cn(
            "surface-glass glass-frost shadow-elevated",
            drawing && "border-[var(--color-overlay-draw)] text-foreground"
          )}
          onClick={() => (drawing ? stopDrawing() : setDrawing(true))}
        >
          {drawing ? "Cancel drawing" : bbox ? "Draw new area" : "Draw area"}
        </Button>
      </div>

      <fieldset
        aria-label="Map overlays"
        className="absolute bottom-2 left-2 z-20 flex flex-col gap-0.5 rounded-md border border-border surface-glass glass-frost px-2 py-1.5 text-micro text-muted-foreground shadow-elevated"
      >
        {OVERLAYS.map((o) => {
          const disabled = o.id === "regions" && regionsUnavailable;
          return (
            <label
              key={o.id}
              className={cn(
                "flex cursor-pointer items-center gap-1.5",
                disabled && "cursor-not-allowed opacity-50"
              )}
              title={disabled ? "Geofabrik regions could not be loaded" : undefined}
            >
              <input
                type="checkbox"
                checked={shown[o.id] && !disabled}
                disabled={disabled}
                onChange={(e) => setShown((s) => ({ ...s, [o.id]: e.target.checked }))}
                className="accent-[var(--color-accent)]"
              />
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-[2px] border"
                style={{ borderColor: o.token }}
              />
              {o.label}
            </label>
          );
        })}
      </fieldset>

      <div className="absolute right-2 bottom-2 z-20">
        <Attribution credits={credits} prefix="" suffix="" />
      </div>
    </div>
  );
}

function handleStyle(
  h: Handle,
  box: { left: number; top: number; right: number; bottom: number }
): React.CSSProperties {
  const midX = (box.left + box.right) / 2;
  const midY = (box.top + box.bottom) / 2;
  const left = h.includes("w") ? box.left : h.includes("e") ? box.right : midX;
  const top = h.includes("n") ? box.top : h.includes("s") ? box.bottom : midY;
  const cursor =
    h === "n" || h === "s"
      ? "ns-resize"
      : h === "e" || h === "w"
        ? "ew-resize"
        : h === "ne" || h === "sw"
          ? "nesw-resize"
          : "nwse-resize";
  return { left, top, cursor };
}

function PickerNote({ tone, children }: { tone?: "warn" | "error"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "w-fit rounded-md border border-border surface-glass glass-frost px-2 py-1 text-muted-foreground shadow-elevated",
        tone === "warn" && "text-status-warn",
        tone === "error" && "text-status-error"
      )}
    >
      {children}
    </span>
  );
}
