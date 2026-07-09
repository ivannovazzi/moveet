import { useMemo } from "react";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Position } from "@/types";
import { useDirections, type DirectionState } from "@/hooks/useDirections";
import { useDirectionHighlight } from "@/hooks/directionHighlightStore";
import { invertLatLng } from "@/utils/coordinates";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";

/** Convert a hex color string like "#39f" or "#3399ff" to [r,g,b,a]. */
function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

interface DirectionData {
  id: string;
  direction: DirectionState;
  color: string;
}

interface PathDatum extends DirectionData {
  path: [number, number][];
}

interface WaypointData {
  position: [number, number];
  index: number;
  isCurrent: boolean;
  isCompleted: boolean;
  color: string;
  label: string;
  stopsLeftLabel?: string;
  /** 0 (origin) → 1 (destination) — drives a size/opacity progression cue. */
  progress: number;
}

interface LabelData {
  id: string;
  position: [number, number];
  text: string;
  color: string;
}

interface DirectionProps {
  selected?: string;
  hovered?: string;
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

  const layers = useMemo(() => {
    const items: DirectionData[] = [];
    if (hovered && hoveredDirection) {
      items.push({
        id: `${hovered}--hovered`,
        direction: hoveredDirection,
        color: "#f93",
      });
    }
    if (selected && selectedDirection) {
      items.push({
        id: `${selected}--selected`,
        direction: selectedDirection,
        color: "#39f",
      });
    }

    if (items.length === 0) return [];

    // Build path data using geo coords [lng, lat] — deck.gl MapView handles projection
    const pathData: PathDatum[] = items.map((item) => {
      const coords: [number, number][] = item.direction.route.edges.map(
        (edge) => invertLatLng(edge.start.coordinates as Position) as [number, number]
      );
      const lastEdge = item.direction.route.edges[item.direction.route.edges.length - 1];
      if (lastEdge) {
        coords.push(invertLatLng(lastEdge.end.coordinates as Position) as [number, number]);
      }
      return { ...item, path: coords };
    });

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
          position: [lng, lat] as [number, number],
          index: i,
          isCurrent: i === cwi,
          isCompleted: i < cwi,
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

    // Build label data
    const distanceLabelData: LabelData[] = pathData
      .filter((d) => d.path.length >= 2)
      .map((d) => ({
        id: d.id,
        position: d.path[Math.floor(d.path.length / 2)],
        text: `${d.direction.route.distance.toFixed(1)} km`,
        color: d.color,
      }));

    const stopsLabelData: LabelData[] = waypointData
      .filter((wp) => wp.stopsLeftLabel)
      .map((wp) => ({
        id: `stops-${wp.index}`,
        position: wp.position,
        text: wp.stopsLeftLabel!,
        color: wp.color,
      }));

    const allLabelData = [...distanceLabelData, ...stopsLabelData];

    const pathLayer = new PathLayer<PathDatum>({
      id: "direction-paths",
      data: pathData,
      getPath: (d) => d.path,
      getColor: (d) => hexToRgba(d.color),
      getWidth: 3,
      widthUnits: "pixels",
      widthMinPixels: 2,
      jointRounded: true,
      capRounded: true,
    });

    const scatterLayer =
      waypointData.length > 0
        ? new ScatterplotLayer<WaypointData>({
            id: "direction-waypoints",
            data: waypointData,
            getPosition: (d) => d.position,
            // Size/opacity ramp from origin (small, dim) to destination (full
            // size, opaque) — a lightweight "progression" cue in place of an
            // arrowhead, which PathLayer can't render natively.
            getRadius: (d) => (d.isCurrent ? 7 : 4 + d.progress * 2),
            getFillColor: (d) =>
              d.isCurrent ? hexToRgba(d.color) : [0, 0, 0, Math.round(90 + d.progress * 120)],
            getLineColor: (d) => (d.isCurrent ? [255, 255, 255, 255] : hexToRgba(d.color)),
            getLineWidth: 1.5,
            stroked: true,
            lineWidthUnits: "pixels",
            radiusUnits: "pixels",
            radiusMinPixels: 4,
          })
        : null;

    const waypointTextLayer =
      waypointData.length > 0
        ? new TextLayer<WaypointData>({
            id: "direction-waypoint-labels",
            data: waypointData,
            getPosition: (d) => d.position,
            getText: (d) => d.label,
            getSize: 10,
            getColor: (d) => (d.isCurrent ? [255, 255, 255, 255] : hexToRgba(d.color)),
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            sizeUnits: "pixels",
            fontWeight: "bold",
          })
        : null;

    const distanceTextLayer =
      allLabelData.length > 0
        ? new TextLayer<LabelData>({
            id: "direction-distance-labels",
            data: allLabelData,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getSize: 12,
            getColor: (d) => hexToRgba(d.color),
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            sizeUnits: "pixels",
            background: true,
            getBackgroundColor: resolveMapColor("var(--color-popover)", 190),
            backgroundPadding: [4, 2],
          })
        : null;

    return [pathLayer, scatterLayer, waypointTextLayer, distanceTextLayer].filter(
      (l): l is NonNullable<typeof l> => l !== null
    );
  }, [hovered, hoveredDirection, selected, selectedDirection]);

  useRegisterLayers("directions", layers);

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

    const path: [number, number][] = [];
    for (let i = start; i < end; i++) {
      path.push(invertLatLng(edges[i].start.coordinates as Position) as [number, number]);
    }
    path.push(invertLatLng(edges[end - 1].end.coordinates as Position) as [number, number]);

    const core: [number, number, number, number] = [255, 255, 255, 255];
    const halo: [number, number, number, number] = [255, 255, 255, 70];
    // depth test always passes so the overlay paints over the coincident base
    // route path (same z-plane) instead of z-fighting with it. (luma.gl v9 uses
    // `depthCompare`, not the old `depthTest` flag.)
    const noDepth = { depthCompare: "always" as const };
    return [
      // Soft glow beneath the core so the highlight reads over both the blue
      // route line and warm traffic colouring.
      new PathLayer<{ path: [number, number][] }>({
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
      new PathLayer<{ path: [number, number][] }>({
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
      new ScatterplotLayer<{ position: [number, number] }>({
        id: "direction-step-highlight-start",
        data: [{ position: path[0] }],
        getPosition: (d) => d.position,
        getRadius: 6,
        radiusUnits: "pixels",
        radiusMinPixels: 5,
        getFillColor: hexToRgba("#39f"),
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
