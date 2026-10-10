import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, MapView } from "@deck.gl/core";
import { PathLayer, PolygonLayer, TextLayer } from "@deck.gl/layers";
import { webgl2Adapter } from "@luma.gl/webgl";
import Attribution, { type Credit } from "@/Map/Attribution";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import { resolveMapColor } from "@/lib/mapColor";
import { LABEL_TOKEN, mapLabelProps } from "@/lib/mapLabels";
import { cn } from "@/lib/utils";
import { adjustArea, type Outline, useAreaDraft } from "../areaDraft";
import { bboxAreaKm2 } from "../bbox";
import type { Bbox, GeofabrikOutline, MapLibrary } from "../mapsClient";
import { type Country, useBasemap, useOutlines } from "./basemap";
import {
  HANDLES,
  type Handle,
  MAX_ZOOM,
  MIN_ZOOM,
  OPENING_MAX_ZOOM,
  type PickerViewState,
  WORLD_VIEW,
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
 * The box is adjusted with eight handles and a grip in its middle; it never
 * grows past the server's area cap, so only a buildable box can be chosen.
 */

/** Below this size on screen the box shows no handles: they would cover it. */
const MIN_EDIT_PX = 28;

const TOKENS = {
  land: "var(--color-picker-land)",
  border: "var(--color-picker-border)",
  place: "var(--color-picker-outline)",
  box: "var(--color-overlay-draw)",
  extract: "var(--color-accent)",
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

interface PolygonDatum {
  polygon: [number, number][][];
}

const polygonsOf = (outline: Outline | null | undefined): PolygonDatum[] =>
  (outline ?? []).map((polygon) => ({ polygon }));

const outlinePolygons = (outlines: GeofabrikOutline[]): PolygonDatum[] =>
  outlines.flatMap((o) => polygonsOf(o.polygons));

export interface PickerMapProps {
  library: MapLibrary | null;
  /** The server's area cap: the box cannot be adjusted past it. */
  maxAreaKm2: number | null;
  /** Fixed canvas size, for tests (jsdom has no layout). */
  size?: { width: number; height: number };
}

export default function PickerMap({ library, maxAreaKm2, size: fixedSize }: PickerMapProps) {
  const { bbox, outline, preview, focus, extract } = useAreaDraft();
  const [containerRef, observed] = useResizeObserver();
  const size = fixedSize ?? observed;
  const basemap = useBasemap();
  const outlines = useOutlines();
  const [view, setView] = useState<AnimatedView>(WORLD_VIEW);
  const dragRef = useRef<Drag | null>(null);
  // Deck mounts only once the camera is framed: it then starts from that view
  // and never from the placeholder.
  const [framed, setFramed] = useState(false);

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
    adjustArea(next);
  };

  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

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

  const placeLayers = useMemo(() => {
    const shown = preview ?? (outline ? { bbox: null, outline } : null);
    if (!shown) return [];
    return [
      new PolygonLayer<PolygonDatum>({
        id: "picker-place",
        data: polygonsOf(shown.outline),
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
    () => [...countryLayers, ...extractLayers, ...placeLayers, ...labelLayers, ...boxLayers],
    [countryLayers, extractLayers, placeLayers, labelLayers, boxLayers]
  );

  const onViewStateChange = useCallback(({ viewState }: { viewState: unknown }) => {
    const v = viewState as PickerViewState;
    setView({ ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom)), pitch: 0, bearing: 0 });
  }, []);

  // ── Box handles, in screen pixels ──────────────────────────────────
  let screenBox: { left: number; top: number; right: number; bottom: number } | null = null;
  if (bbox && size.width > 0) {
    const [x0, y0] = projectLngLat(view, size.width, size.height, [bbox[0], bbox[3]]);
    const [x1, y1] = projectLngLat(view, size.width, size.height, [bbox[2], bbox[1]]);
    // Too small on screen to grab: zoom in to adjust it.
    if (x1 - x0 >= MIN_EDIT_PX && y1 - y0 >= MIN_EDIT_PX) {
      screenBox = { left: x0, top: y0, right: x1, bottom: y1 };
    }
  }

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
          getCursor={({ isDragging }) => (isDragging ? "grabbing" : "grab")}
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

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute top-2 left-2 z-20 flex flex-col gap-1 text-micro"
      >
        {basemap.status === "loading" && <PickerNote>Loading the world map…</PickerNote>}
        {basemap.status === "error" && <PickerNote tone="error">{basemap.error}</PickerNote>}
        {outlines.status === "ready" && outlines.data === null && (
          <PickerNote tone="warn">
            Geofabrik extracts are unavailable; showing countries only.
          </PickerNote>
        )}
        {!bbox && !preview && <PickerNote>Search a place to see it here.</PickerNote>}
      </div>

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
