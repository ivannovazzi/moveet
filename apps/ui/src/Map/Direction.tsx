import { useEffect, useMemo, useState } from "react";
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer } from "@deck.gl/core";
import type { Position } from "@/types";
import { useDirections, type DirectionState } from "@/hooks/useDirections";
import { useDirectionHighlight } from "@/hooks/directionHighlightStore";
import { vehicleStore } from "@/hooks/vehicleStore";
import { findActiveEdgeIndex } from "@/utils/directionSteps";
import { invertLatLng } from "@/utils/coordinates";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useMapContext } from "@/components/Map/hooks";
import { resolveMapColor } from "@/lib/mapColor";
import {
  CASING_TOKEN,
  LABEL_PRIORITY,
  LABEL_TOKEN,
  mapLabelProps,
  useVisibleLabels,
  type LabelItem,
} from "@/lib/mapLabels";

type RGBA = [number, number, number, number];
type LngLat = [number, number];

const SELECTED_TOKEN = "var(--color-route-selected)";
const HOVER_TOKEN = "var(--color-route-hover)";
/** The driven part of the route recedes to the same grey as an idle vehicle. */
const TRAVELLED_TOKEN = "var(--color-status-idle)";

const ROUTE_WIDTH_PX = 5;
/** Dark outline under the remaining route so it separates from roads and traffic. */
const CASING_ALPHA = 210;
const CASING_WIDTH_PX = 9;
/** Soft glow under the casing; it is what makes the route findable at city zoom. */
const GLOW_ALPHA = 55;
const GLOW_WIDTH_PX = 18;
/** Already-driven part of the route: present for context, visually recessed. */
const TRAVELLED_ALPHA = 150;
const TRAVELLED_WIDTH_PX = 3;
/** Hover preview dash, in multiples of line width: [dash, gap]. */
const HOVER_DASH: [number, number] = [2.5, 1.5];
const SOLID: [number, number] = [0, 0];

/**
 * Chevron spacing on screen. Converted to meters for the current zoom, so the
 * rhythm stays constant while zooming. (Not CollisionFilterExtension: it
 * matches picking colours, and a non-pickable layer would filter out every
 * icon; making chevrons pickable would steal hover from the route and vehicles.)
 */
const ARROW_SPACING_PX = 72;
/** Distance-readout label size and offset, shared with the declutter pass. */
const DISTANCE_LABEL_SIZE = 12;
const DISTANCE_LABEL_OFFSET: [number, number] = [0, -20];
const MAX_ARROWS = 1500;
const ARROW_SIZE_PX = 12;
const ARROW_ALPHA = 235;
/** Arrows are resampled per half zoom level, not on every zoom frame. */
const ARROW_ZOOM_STEP = 0.5;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const CHEVRON_PX = 32;
let chevronIcon: { url: string; width: number; height: number; mask: boolean } | null = null;

/**
 * East-pointing chevron sprite, drawn once to a canvas and handed to IconLayer
 * as a PNG data URL. Not an SVG URL: loaders.gl decodes icons through
 * createImageBitmap, which rejects SVG blobs, so an SVG icon silently never
 * appears. Same approach as the vehicle atlas.
 */
function getChevronIcon() {
  if (chevronIcon) return chevronIcon;
  const canvas = document.createElement("canvas");
  canvas.width = CHEVRON_PX;
  canvas.height = CHEVRON_PX;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(11, 6);
    ctx.lineTo(21, 16);
    ctx.lineTo(11, 26);
    ctx.stroke();
  }
  chevronIcon = {
    url: ctx ? canvas.toDataURL() : "",
    width: CHEVRON_PX,
    height: CHEVRON_PX,
    mask: true,
  };
  return chevronIcon;
}
const dashStyle = new PathStyleExtension({ dash: true });

/** Ground meters per screen pixel in deck.gl's 512px-tile Web Mercator. */
function metersPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** How often the selected vehicle's progress along its route is re-sampled. */
const PROGRESS_POLL_MS = 1000;

interface DirectionData {
  id: string;
  direction: DirectionState;
  color: RGBA;
  /** Hover is a preview: dashed, no glow, casing or progress split. */
  preview: boolean;
}

interface PathDatum extends DirectionData {
  /** For a selected route with known progress, only the part still ahead. */
  path: LngLat[];
}

interface WaypointData {
  position: LngLat;
  index: number;
  isCurrent: boolean;
  isCompleted: boolean;
  /** From a hover preview rather than the committed (selected) route. */
  preview: boolean;
  color: RGBA;
  label: string;
  stopsLeftLabel?: string;
  /** 0 (origin) → 1 (destination) — drives a size/opacity progression cue. */
  progress: number;
}

interface LabelData {
  id: string;
  position: LngLat;
  text: string;
  color: RGBA;
}

interface ArrowDatum {
  position: LngLat;
  angle: number;
}

interface DestinationDatum {
  position: LngLat;
  halo: boolean;
  color: RGBA;
}

interface Progress {
  edgeIndex: number;
  /** Vehicle position, [lng, lat]. */
  position: LngLat;
}

interface DirectionProps {
  selected?: string;
  hovered?: string;
}

/** Route polyline in map order ([lng, lat]); one point per node. */
function routePath(direction: DirectionState): LngLat[] {
  const edges = direction.route.edges;
  const coords: LngLat[] = edges.map((edge) => invertLatLng(edge.start.coordinates) as LngLat);
  const last = edges[edges.length - 1];
  if (last) coords.push(invertLatLng(last.end.coordinates) as LngLat);
  return coords;
}

/**
 * Split a route at the vehicle: the driven part ends and the remaining part
 * starts at the vehicle itself, so the colour change sits under its sprite.
 */
export function splitRoute(
  path: LngLat[],
  progress: Progress | null
): { travelled: LngLat[]; remaining: LngLat[] } {
  if (!progress || progress.edgeIndex < 0 || path.length < 2) {
    return { travelled: [], remaining: path };
  }
  const i = Math.min(progress.edgeIndex, path.length - 2);
  return {
    travelled: [...path.slice(0, i + 1), progress.position],
    remaining: [progress.position, ...path.slice(i + 1)],
  };
}

/**
 * Chevron positions every `spacingM` along a path, each rotated to the local
 * direction of travel (deck.gl angles are degrees counter-clockwise from east,
 * matching the east-pointing chevron sprite).
 */
export function sampleArrows(path: LngLat[], spacingM: number): ArrowDatum[] {
  const arrows: ArrowDatum[] = [];
  let untilNext = spacingM / 2;
  for (let i = 0; i < path.length - 1 && arrows.length < MAX_ARROWS; i++) {
    const [lng0, lat0] = path[i];
    const [lng1, lat1] = path[i + 1];
    const kx = 111_320 * Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
    const dx = (lng1 - lng0) * kx;
    const dy = (lat1 - lat0) * 110_540;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    let along = untilNext;
    while (along <= len && arrows.length < MAX_ARROWS) {
      const t = along / len;
      arrows.push({ position: [lng0 + (lng1 - lng0) * t, lat0 + (lat1 - lat0) * t], angle });
      along += spacingM;
    }
    untilNext = along - len;
  }
  return arrows;
}

/**
 * Where the selected vehicle is along its route. Sampled from the vehicle
 * store on a slow poll rather than per frame: the split only needs to follow
 * the vehicle edge by edge, and state is only set when the vehicle moved, so a
 * parked vehicle never re-renders the route.
 */
function useRouteProgress(
  vehicleId: string | undefined,
  direction: DirectionState | undefined
): Progress | null {
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!vehicleId || !direction) {
      setProgress(null);
      return;
    }
    const update = () => {
      const vehicle = vehicleStore.getAll().get(vehicleId);
      if (!vehicle) {
        setProgress(null);
        return;
      }
      // Store and edge coordinates are both [lat, lng].
      const edgeIndex = findActiveEdgeIndex(direction.route.edges, vehicle.position);
      const position = invertLatLng(vehicle.position) as LngLat;
      setProgress((prev) =>
        prev &&
        prev.edgeIndex === edgeIndex &&
        prev.position[0] === position[0] &&
        prev.position[1] === position[1]
          ? prev
          : { edgeIndex, position }
      );
    };
    update();
    const timer = setInterval(update, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [vehicleId, direction]);

  return progress;
}

export default function DirectionMap({ selected, hovered }: DirectionProps) {
  const directions = useDirections();

  // Only the selected/hovered vehicles are ever rendered (at most 2 entries).
  // Key the memo on THEIR direction data rather than the whole `directions`
  // Map reference — `useDirections` hands back a new Map reference on every
  // WS update to ANY vehicle, so keying on it directly rebuilds every
  // path/waypoint layer whenever an unrelated vehicle reroutes, even though
  // the selected/hovered vehicle's own data didn't change.
  const hoveredDirection = hovered ? directions.get(hovered) : undefined;
  const selectedDirection = selected ? directions.get(selected) : undefined;
  const progress = useRouteProgress(selected, selectedDirection);
  const { viewState, viewport } = useMapContext();
  const zoomBucket = Math.round((viewState?.zoom ?? 12) / ARROW_ZOOM_STEP) * ARROW_ZOOM_STEP;

  // Selected route geometry, split at the vehicle. Shared by the route layers
  // and the chevrons, which rebuild on different inputs (progress vs zoom).
  const selectedRoute = useMemo(() => {
    if (!selectedDirection) return null;
    const full = routePath(selectedDirection);
    const { travelled, remaining } = splitRoute(full, progress);
    const edges = selectedDirection.route.edges;
    const from = progress && progress.edgeIndex >= 0 ? progress.edgeIndex : 0;
    const remainingKm =
      edges.length > 0
        ? edges.slice(from).reduce((km, e) => km + e.distance, 0)
        : selectedDirection.route.distance;
    return {
      travelled,
      remaining,
      destination: full.length > 0 ? full[full.length - 1] : null,
      remainingKm,
    };
  }, [selectedDirection, progress]);

  // The distance readouts are decluttered against every other map label, so
  // they are built here and attached below, once the pass has run.
  const built = useMemo(() => {
    // Resolved here, not at module load: resolveMapColor caches its first
    // answer, which at module-eval time predates the stylesheet.
    const casingRgba = resolveMapColor(CASING_TOKEN, CASING_ALPHA);
    const travelledRgba = resolveMapColor(TRAVELLED_TOKEN, TRAVELLED_ALPHA);
    const labelRgba = resolveMapColor(LABEL_TOKEN);

    const items: DirectionData[] = [];
    if (hovered && hoveredDirection && hovered !== selected) {
      items.push({
        id: `${hovered}--hovered`,
        direction: hoveredDirection,
        color: resolveMapColor(HOVER_TOKEN),
        preview: true,
      });
    }
    if (selected && selectedDirection) {
      items.push({
        id: `${selected}--selected`,
        direction: selectedDirection,
        color: resolveMapColor(SELECTED_TOKEN),
        preview: false,
      });
    }

    if (items.length === 0) return { layers: [] as Layer[], labelData: [] as LabelData[] };

    // Build path data using geo coords [lng, lat] — deck.gl MapView handles projection
    const travelled = selectedRoute?.travelled ?? [];
    const destination = selectedRoute?.destination ?? null;
    const remainingKm = selectedRoute?.remainingKm ?? 0;
    const pathData: PathDatum[] = items.map((item) => ({
      ...item,
      path: item.preview ? routePath(item.direction) : (selectedRoute?.remaining ?? []),
    }));
    const committed = pathData.filter((d) => !d.preview && d.path.length >= 2);
    const selectedColor = committed[0]?.color;

    // Build waypoint data
    const waypointData: WaypointData[] = [];
    for (const item of items) {
      const { waypoints, currentWaypointIndex } = item.direction;
      if (!waypoints || waypoints.length <= 1) continue;

      const cwi = currentWaypointIndex ?? 0;
      const remaining = waypoints.length - cwi;

      const lastWaypointIdx = waypoints.length - 1;
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const [lng, lat] = invertLatLng(wp.position as Position);

        waypointData.push({
          position: [lng, lat],
          index: i,
          isCurrent: i === cwi,
          isCompleted: i < cwi,
          preview: item.preview,
          color: item.color,
          label: String(i + 1),
          stopsLeftLabel:
            i === waypoints.length - 1 && remaining > 0
              ? `${remaining} stop${remaining === 1 ? "" : "s"} left`
              : undefined,
          progress: lastWaypointIdx === 0 ? 1 : i / lastWaypointIdx,
        });
      }
    }

    // Distance reads at the end of the route, where the eye lands, instead of
    // an arbitrary midpoint vertex.
    const labelData: LabelData[] = pathData
      .filter((d) => d.path.length >= 2)
      .map((d) => ({
        id: d.id,
        position: d.path[d.path.length - 1],
        text: d.preview
          ? `${d.direction.route.distance.toFixed(1)} km`
          : `${remainingKm.toFixed(1)} km left`,
        color: d.color,
      }));
    for (const wp of waypointData) {
      if (wp.stopsLeftLabel) {
        labelData.push({
          id: `stops-${wp.index}`,
          position: wp.position,
          text: wp.stopsLeftLabel,
          color: wp.color,
        });
      }
    }

    const glowLayer =
      committed.length > 0
        ? new PathLayer<PathDatum>({
            id: "direction-paths-glow",
            data: committed,
            getPath: (d) => d.path,
            getColor: (d) => [d.color[0], d.color[1], d.color[2], GLOW_ALPHA],
            getWidth: GLOW_WIDTH_PX,
            widthUnits: "pixels",
            jointRounded: true,
            capRounded: true,
          })
        : null;

    const travelledLayer =
      travelled.length >= 2
        ? new PathLayer<{ path: LngLat[] }>({
            id: "direction-paths-travelled",
            data: [{ path: travelled }],
            getPath: (d) => d.path,
            getColor: travelledRgba,
            getWidth: TRAVELLED_WIDTH_PX,
            widthUnits: "pixels",
            jointRounded: true,
            capRounded: true,
          })
        : null;

    const casingLayer =
      committed.length > 0
        ? new PathLayer<PathDatum>({
            id: "direction-paths-casing",
            data: committed,
            getPath: (d) => d.path,
            getColor: casingRgba,
            getWidth: CASING_WIDTH_PX,
            widthUnits: "pixels",
            jointRounded: true,
            capRounded: true,
          })
        : null;

    const pathLayer = new PathLayer<PathDatum, PathStyleExtensionProps<PathDatum>>({
      id: "direction-paths",
      data: pathData,
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      getWidth: (d) => (d.preview ? ROUTE_WIDTH_PX - 2 : ROUTE_WIDTH_PX),
      widthUnits: "pixels",
      widthMinPixels: 2,
      jointRounded: true,
      capRounded: true,
      getDashArray: (d) => (d.preview ? HOVER_DASH : SOLID),
      dashJustified: true,
      extensions: [dashStyle],
    });

    const destinationData: DestinationDatum[] =
      destination && selectedColor
        ? [
            { position: destination, halo: true, color: selectedColor },
            { position: destination, halo: false, color: selectedColor },
          ]
        : [];
    const destinationLayer =
      destinationData.length > 0
        ? new ScatterplotLayer<DestinationDatum>({
            id: "direction-destination",
            data: destinationData,
            getPosition: (d) => d.position,
            getRadius: (d) => (d.halo ? 15 : 7),
            getFillColor: (d) => (d.halo ? [d.color[0], d.color[1], d.color[2], 60] : d.color),
            getLineColor: (d) => (d.halo ? [0, 0, 0, 0] : labelRgba),
            getLineWidth: (d) => (d.halo ? 0 : 2.5),
            stroked: true,
            radiusUnits: "pixels",
            lineWidthUnits: "pixels",
          })
        : null;

    // The route runs to the current waypoint, so the destination pin already
    // marks it; a numbered dot under the pin would just double the marker.
    const markerData =
      destinationData.length > 0
        ? waypointData.filter((wp) => !(wp.isCurrent && !wp.preview))
        : waypointData;

    const scatterLayer =
      markerData.length > 0
        ? new ScatterplotLayer<WaypointData>({
            id: "direction-waypoints",
            data: markerData,
            getPosition: (d) => d.position,
            // Size/opacity ramp from origin (small, dim) to destination (full
            // size, opaque) — a lightweight "progression" cue.
            getRadius: (d) => (d.isCurrent ? 7 : 4 + d.progress * 2),
            getFillColor: (d) =>
              d.isCurrent
                ? d.color
                : resolveMapColor(CASING_TOKEN, Math.round(90 + d.progress * 120)),
            getLineColor: (d) => (d.isCurrent ? labelRgba : d.color),
            getLineWidth: 1.5,
            stroked: true,
            lineWidthUnits: "pixels",
            radiusUnits: "pixels",
            radiusMinPixels: 4,
          })
        : null;

    const waypointTextLayer =
      markerData.length > 0
        ? new TextLayer<WaypointData>({
            ...mapLabelProps(10),
            id: "direction-waypoint-labels",
            data: markerData,
            getPosition: (d) => d.position,
            getText: (d) => d.label,
            getColor: (d) => (d.isCurrent ? labelRgba : d.color),
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
          })
        : null;

    return {
      layers: [
        glowLayer,
        travelledLayer,
        casingLayer,
        pathLayer,
        destinationLayer,
        scatterLayer,
        waypointTextLayer,
      ].filter((l): l is NonNullable<typeof l> => l !== null) as Layer[],
      labelData,
    };
  }, [hovered, hoveredDirection, selected, selectedDirection, selectedRoute]);

  const distanceLabelItems = useMemo<LabelItem[]>(
    () =>
      built.labelData.map((d) => ({
        id: d.id,
        position: d.position,
        text: d.text,
        size: DISTANCE_LABEL_SIZE,
        priority: LABEL_PRIORITY.routeDistance,
        pixelOffset: DISTANCE_LABEL_OFFSET,
      })),
    [built]
  );

  const visibleDistances = useVisibleLabels(
    "direction-distance-labels",
    distanceLabelItems,
    viewport ?? null,
    zoomBucket
  );

  const layers = useMemo(() => {
    const data = built.labelData.filter((d) => visibleDistances.has(d.id));
    if (data.length === 0) return built.layers;
    return [
      ...built.layers,
      new TextLayer<LabelData>({
        ...mapLabelProps(DISTANCE_LABEL_SIZE),
        id: "direction-distance-labels",
        data,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: (d) => d.color,
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        getPixelOffset: DISTANCE_LABEL_OFFSET,
        background: true,
        getBackgroundColor: resolveMapColor("var(--color-popover)", 220),
        backgroundPadding: [6, 3],
      }),
    ];
  }, [built, visibleDistances]);

  useRegisterLayers("directions", layers);

  // ─── Direction chevrons ────────────────────────────────────────────
  const arrowLayers = useMemo(() => {
    const path = selectedRoute?.remaining ?? [];
    if (path.length < 2) return [];
    const spacingM = ARROW_SPACING_PX * metersPerPixel(zoomBucket, path[0][1]);
    const data = sampleArrows(path, spacingM);
    const icon = getChevronIcon();
    if (data.length === 0 || !icon.url) return [];
    return [
      new IconLayer<ArrowDatum>({
        id: "direction-arrows",
        data,
        getPosition: (d) => d.position,
        getIcon: () => icon,
        getAngle: (d) => d.angle,
        getColor: resolveMapColor(LABEL_TOKEN, ARROW_ALPHA),
        getSize: ARROW_SIZE_PX,
        sizeUnits: "pixels",
        billboard: false,
      }),
    ];
  }, [selectedRoute, zoomBucket]);

  // Above the route line (directions, 50), below the step highlight (52).
  useRegisterLayers("direction-arrows", arrowLayers, 51);

  // ─── Step highlight ────────────────────────────────────────────────
  // When a turn-by-turn step is hovered/pinned in the inspector, overlay the
  // matching sub-path (and a dot at the maneuver point) for the SELECTED
  // vehicle. Kept in its own memo + layer group so hovering a row only rebuilds
  // this cheap slice, not the base route path (which can span 800+ edges).
  const { hovered: hoveredStep, pinned: pinnedStep } = useDirectionHighlight();
  const step = hoveredStep ?? pinnedStep;

  const highlightLayers = useMemo(() => {
    if (!step || step.vehicleId !== selected || !selectedDirection) return [];
    const edges = selectedDirection.route.edges;
    const start = Math.max(0, step.start);
    const end = Math.min(edges.length, step.end);
    if (end <= start) return [];

    const path: LngLat[] = [];
    for (let i = start; i < end; i++) {
      path.push(invertLatLng(edges[i].start.coordinates as Position) as LngLat);
    }
    path.push(invertLatLng(edges[end - 1].end.coordinates as Position) as LngLat);

    const core: RGBA = resolveMapColor(LABEL_TOKEN);
    const halo: RGBA = resolveMapColor(LABEL_TOKEN, 70);
    // depth test always passes so the overlay paints over the coincident base
    // route path (same z-plane) instead of z-fighting with it. (luma.gl v9 uses
    // `depthCompare`, not the old `depthTest` flag.)
    const noDepth = { depthCompare: "always" as const };
    return [
      // Soft glow beneath the core so the highlight reads over both the blue
      // route line and warm traffic colouring.
      new PathLayer<{ path: LngLat[] }>({
        id: "direction-step-highlight-halo",
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: halo,
        getWidth: 12,
        widthUnits: "pixels",
        widthMinPixels: 9,
        jointRounded: true,
        capRounded: true,
        parameters: noDepth,
      }),
      new PathLayer<{ path: LngLat[] }>({
        id: "direction-step-highlight-path",
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: core,
        getWidth: 6,
        widthUnits: "pixels",
        widthMinPixels: 4,
        jointRounded: true,
        capRounded: true,
        parameters: noDepth,
      }),
      new ScatterplotLayer<{ position: LngLat }>({
        id: "direction-step-highlight-start",
        data: [{ position: path[0] }],
        getPosition: (d) => d.position,
        getRadius: 6,
        radiusUnits: "pixels",
        radiusMinPixels: 5,
        getFillColor: resolveMapColor(SELECTED_TOKEN),
        getLineColor: core,
        getLineWidth: 2,
        stroked: true,
        lineWidthUnits: "pixels",
        parameters: noDepth,
      }),
    ];
  }, [step, selected, selectedDirection]);

  // Sits just above the base "directions" group (50) but below vehicles (70).
  useRegisterLayers("direction-highlight", highlightLayers, 52);

  return null;
}
