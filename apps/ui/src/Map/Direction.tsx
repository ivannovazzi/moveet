import { useMemo } from "react";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { COORDINATE_SYSTEM } from "@deck.gl/core";
import type { Position } from "@/types";
import { useDirections, type DirectionState } from "@/hooks/useDirections";
import { invertLatLng } from "@/utils/coordinates";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";

// ── helpers ─────────────────────────────────────────────────────────

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

interface WaypointData {
  position: [number, number];
  index: number;
  isCurrent: boolean;
  isCompleted: boolean;
  color: string;
  label: string;
  stopsLeftLabel?: string;
}

// ── component ───────────────────────────────────────────────────────

interface DirectionProps {
  selected?: string;
  hovered?: string;
}

export default function DirectionMap({ selected, hovered }: DirectionProps) {
  const directions = useDirections();
  const { projection } = useMapContext();

  const layers = useMemo(() => {
    if (!projection) return [];

    // Collect active directions
    const items: DirectionData[] = [];
    if (hovered) {
      const d = directions.get(hovered);
      if (d) items.push({ id: `${hovered}--hovered`, direction: d, color: "#f93" });
    }
    if (selected) {
      const d = directions.get(selected);
      if (d) items.push({ id: `${selected}--selected`, direction: d, color: "#39f" });
    }

    if (items.length === 0) return [];

    // Build path data: each item becomes one path
    const pathData = items.map((item) => {
      const coords = item.direction.route.edges.map((edge) => {
        const geo = invertLatLng(edge.start.coordinates as Position);
        const p = projection(geo);
        return p ? ([p[0], p[1]] as [number, number]) : null;
      });
      // Add the last edge's end coordinate
      const lastEdge = item.direction.route.edges[item.direction.route.edges.length - 1];
      if (lastEdge) {
        const geo = invertLatLng(lastEdge.end.coordinates as Position);
        const p = projection(geo);
        if (p) coords.push([p[0], p[1]] as [number, number]);
      }
      const path = coords.filter((c): c is [number, number] => c !== null);
      return { ...item, path };
    });

    // Build waypoint data
    const waypointData: WaypointData[] = [];
    for (const item of items) {
      const { waypoints, currentWaypointIndex } = item.direction;
      if (!waypoints || waypoints.length <= 1) continue;

      const cwi = currentWaypointIndex ?? 0;
      const remaining = waypoints.length - cwi;

      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const geo = invertLatLng(wp.position as Position);
        const p = projection(geo);
        if (!p) continue;

        const isCurrent = i === cwi;
        const isCompleted = i < cwi;

        waypointData.push({
          position: [p[0], p[1]] as [number, number],
          index: i,
          isCurrent,
          isCompleted,
          color: item.color,
          label: String(i + 1),
          stopsLeftLabel:
            i === waypoints.length - 1 && remaining > 0
              ? `${remaining} stop${remaining === 1 ? "" : "s"} left`
              : undefined,
        });
      }
    }

    // Build distance label data
    const distanceLabelData = pathData
      .filter((d) => d.path.length >= 2)
      .map((d) => {
        // Place label at the midpoint of the path
        const mid = d.path[Math.floor(d.path.length / 2)];
        return {
          id: d.id,
          position: mid,
          text: `${d.direction.route.distance.toFixed(1)} km`,
          color: d.color,
        };
      });

    // Also add "stops left" labels
    const stopsLabelData = waypointData
      .filter((wp) => wp.stopsLeftLabel)
      .map((wp) => ({
        id: `stops-${wp.index}`,
        position: wp.position,
        text: wp.stopsLeftLabel!,
        color: wp.color,
      }));

    const allLabelData = [...distanceLabelData, ...stopsLabelData];

    const pathLayer = new PathLayer<(typeof pathData)[number]>({
      id: "direction-paths",
      data: pathData,
      getPath: (d) => d.path,
      getColor: (d) => hexToRgba(d.color),
      getWidth: 3,
      widthUnits: "pixels",
      widthMinPixels: 2,
      jointRounded: true,
      capRounded: true,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    const scatterLayer =
      waypointData.length > 0
        ? new ScatterplotLayer<WaypointData>({
            id: "direction-waypoints",
            data: waypointData,
            getPosition: (d) => d.position,
            getRadius: (d) => (d.isCurrent ? 7 : 5),
            getFillColor: (d) => {
              if (d.isCurrent) return hexToRgba(d.color);
              return [0, 0, 0, 180];
            },
            getLineColor: (d) => {
              if (d.isCurrent) return [255, 255, 255, 255];
              return hexToRgba(d.color);
            },
            getLineWidth: 1.5,
            stroked: true,
            lineWidthUnits: "pixels",
            radiusUnits: "pixels",
            radiusMinPixels: 4,
            opacity: 1,
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
            parameters: { depthWriteEnabled: false },
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
            getColor: (d) => {
              if (d.isCurrent) return [255, 255, 255, 255];
              return hexToRgba(d.color);
            },
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            sizeUnits: "pixels",
            fontWeight: "bold",
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
            parameters: { depthWriteEnabled: false },
          })
        : null;

    const distanceTextLayer =
      allLabelData.length > 0
        ? new TextLayer<(typeof allLabelData)[number]>({
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
            getBackgroundColor: [0, 0, 0, 190],
            backgroundPadding: [4, 2],
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
            parameters: { depthWriteEnabled: false },
          })
        : null;

    return [pathLayer, scatterLayer, waypointTextLayer, distanceTextLayer].filter(
      (l): l is NonNullable<typeof l> => l !== null
    );
  }, [directions, selected, hovered, projection]);

  useRegisterLayers("directions", layers);

  return null;
}
