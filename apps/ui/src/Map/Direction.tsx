import { useEffect, useState, memo } from "react";
import type { Waypoint, Position } from "@/types";
import { useDirections, type DirectionState } from "@/hooks/useDirections";
import { Polyline } from "@/components/Map/components/Polyline";
import { invertLatLng } from "@/utils/coordinates";
import { useMapContext } from "@/components/Map/hooks";
import Label from "@/components/Map/components/Label";

interface WaypointMarkersProps {
  waypoints: Waypoint[];
  currentWaypointIndex: number;
  color: string;
}

const WaypointMarkers = memo(function WaypointMarkers({
  waypoints,
  currentWaypointIndex,
  color,
}: WaypointMarkersProps) {
  const { projection, transform } = useMapContext();
  const k = transform?.k ?? 1;
  const radius = 10 / k;
  const fontSize = 10 / k;
  const strokeWidth = 1.5 / k;

  const remaining = waypoints.length - currentWaypointIndex;

  return (
    <>
      {waypoints.map((wp, i) => {
        const projected = projection
          ? (projection(invertLatLng(wp.position) as Position) as Position | null)
          : null;
        if (!projected) return null;

        const isCurrent = i === currentWaypointIndex;
        const isCompleted = i < currentWaypointIndex;

        const dotRadius = isCurrent ? radius * 1.3 : radius;
        const opacity = isCompleted ? 0.4 : 1;
        const fillColor = isCurrent ? color : "rgba(0,0,0,0.7)";
        const strokeColor = isCurrent ? "#fff" : color;

        return (
          <g key={i} opacity={opacity}>
            <circle
              cx={projected[0]}
              cy={projected[1]}
              r={dotRadius}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <text
              x={projected[0]}
              y={projected[1]}
              textAnchor="middle"
              dominantBaseline="central"
              fill={isCurrent ? "#fff" : color}
              fontSize={fontSize}
              fontWeight={isCurrent ? "bold" : "normal"}
              style={{ pointerEvents: "none" }}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      {remaining > 0 && (
        <Label
          label={`${remaining} stop${remaining === 1 ? "" : "s"} left`}
          coordinates={invertLatLng(waypoints[waypoints.length - 1].position) as Position}
          color={color}
        />
      )}
    </>
  );
});

interface DirectionLineProps {
  direction: DirectionState;
  color: string;
}

const DirectionLine = memo(function DirectionLine({ direction, color }: DirectionLineProps) {
  const { route, waypoints, currentWaypointIndex } = direction;
  const distance = `${route.distance.toFixed(1)} km`;
  const coordinates = route.edges.map((edge) => edge.start.coordinates).map(invertLatLng);
  const showWaypoints = waypoints && waypoints.length > 1;

  return (
    <>
      <Polyline coordinates={coordinates} color={color} />
      <Label label={distance} coordinates={coordinates} color={color} />
      {showWaypoints && (
        <WaypointMarkers
          waypoints={waypoints}
          currentWaypointIndex={currentWaypointIndex ?? 0}
          color={color}
        />
      )}
    </>
  );
});

interface DirectionProps {
  selected?: string;
  hovered?: string;
}

export default function DirectionMap({ selected, hovered }: DirectionProps) {
  const directions = useDirections();
  const [selectedDirection, setSelectedDirection] = useState<DirectionState | null>(null);
  const [hoveredDirection, setHoveredDirection] = useState<DirectionState | null>(null);

  useEffect(() => {
    if (selected && directions.size > 0) {
      setSelectedDirection(directions.get(selected) ?? null);
    } else {
      setSelectedDirection(null);
    }
  }, [directions, selected]);

  useEffect(() => {
    if (hovered && directions.size > 0) {
      setHoveredDirection(directions.get(hovered) ?? null);
    } else {
      setHoveredDirection(null);
    }
  }, [directions, hovered]);

  return (
    <>
      {hoveredDirection && (
        <DirectionLine direction={hoveredDirection} key={`${hovered}--hovered`} color={"#f93"} />
      )}
      {selectedDirection && (
        <DirectionLine direction={selectedDirection} key={`${selected}--selected`} color={"#39f"} />
      )}
    </>
  );
}
