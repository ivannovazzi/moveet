import { useMemo } from "react";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Position } from "@/types";
import { useDirections, type DirectionState } from "@/hooks/useDirections";
import { invertLatLng } from "@/utils/coordinates";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";

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

  const layers = useMemo(() => {
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
      _pathType: "open",
    });

    const scatterLayer =
      waypointData.length > 0
        ? new ScatterplotLayer<WaypointData>({
            id: "direction-waypoints",
            data: waypointData,
            getPosition: (d) => d.position,
            getRadius: (d) => (d.isCurrent ? 7 : 5),
            getFillColor: (d) => (d.isCurrent ? hexToRgba(d.color) : [0, 0, 0, 180]),
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
            getBackgroundColor: [0, 0, 0, 190],
            backgroundPadding: [4, 2],
          })
        : null;

    return [pathLayer, scatterLayer, waypointTextLayer, distanceTextLayer].filter(
      (l): l is NonNullable<typeof l> => l !== null
    );
  }, [directions, selected, hovered]);

  useRegisterLayers("directions", layers);

  return null;
}
