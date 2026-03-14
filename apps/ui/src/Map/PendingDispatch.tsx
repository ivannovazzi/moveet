import { memo } from "react";
import type { Vehicle, DispatchAssignment, Position } from "@/types";
import { useMapContext } from "@/components/Map/hooks";

interface PendingDispatchProps {
  assignments: DispatchAssignment[];
  vehicles: Vehicle[];
}

const COLOR = "rgba(57, 153, 255, 0.7)";
const COLOR_SOLID = "#39f";

export default memo(function PendingDispatch({ assignments, vehicles }: PendingDispatchProps) {
  const { projection, transform } = useMapContext();

  if (!projection || assignments.length === 0) return null;

  const k = transform?.k ?? 1;
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  return (
    <g className="pending-dispatch">
      {assignments.map((assignment) => {
        const vehicle = vehicleMap.get(assignment.vehicleId);
        if (!vehicle || assignment.waypoints.length === 0) return null;

        const isMultiStop = assignment.waypoints.length > 1;

        if (isMultiStop) {
          // --- Multi-waypoint rendering ---
          const projected = assignment.waypoints.map(
            (wp) => projection([wp.position[1], wp.position[0]]) as Position | undefined
          );

          if (projected.some((p) => !p || !isFinite(p[0]) || !isFinite(p[1]))) return null;

          const pts = projected as Position[];
          const r = 6 / k;
          const stroke = 1.5 / k;
          const fontSize = 8 / k;
          const labelFontSize = 10 / k;
          const gap = 3 / k;

          return (
            <g key={assignment.vehicleId}>
              {/* Dashed connecting lines between consecutive waypoints */}
              {pts.map((pt, i) => {
                if (i === 0) return null;
                const prev = pts[i - 1];
                return (
                  <line
                    key={`line-${i}`}
                    x1={prev[0]}
                    y1={prev[1]}
                    x2={pt[0]}
                    y2={pt[1]}
                    stroke={COLOR}
                    strokeWidth={stroke}
                    strokeDasharray={`${4 / k} ${3 / k}`}
                  />
                );
              })}

              {/* Numbered circle markers at each waypoint */}
              {pts.map((pt, i) => (
                <g key={`wp-${i}`}>
                  <circle
                    cx={pt[0]}
                    cy={pt[1]}
                    r={r}
                    fill={COLOR_SOLID}
                    stroke="white"
                    strokeWidth={stroke}
                  />
                  <text
                    x={pt[0]}
                    y={pt[1]}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize={fontSize}
                    fontFamily="inherit"
                    fontWeight={700}
                    style={{ pointerEvents: "none" }}
                  >
                    {i + 1}
                  </text>
                </g>
              ))}

              {/* Vehicle name label at the first waypoint */}
              <text
                x={pts[0][0]}
                y={pts[0][1] - r - gap}
                textAnchor="middle"
                fill={COLOR}
                fontSize={labelFontSize}
                fontFamily="inherit"
                fontWeight={500}
                style={{ pointerEvents: "none" }}
              >
                {assignment.vehicleName}
              </text>
            </g>
          );
        }

        // --- Single waypoint rendering ---
        const dest = assignment.waypoints[0];
        const destPos = projection([dest.position[1], dest.position[0]]) as Position | undefined;

        if (!destPos || !isFinite(destPos[0]) || !isFinite(destPos[1])) return null;

        const r = 5 / k;
        const stroke = 1.5 / k;
        const fontSize = 10 / k;
        const gap = 3 / k;

        return (
          <g key={assignment.vehicleId}>
            {/* Target circle at destination */}
            <circle
              cx={destPos[0]}
              cy={destPos[1]}
              r={r}
              fill="none"
              stroke={COLOR_SOLID}
              strokeWidth={stroke}
            />
            <circle cx={destPos[0]} cy={destPos[1]} r={r * 0.3} fill={COLOR_SOLID} />

            {/* Vehicle name label */}
            <text
              x={destPos[0]}
              y={destPos[1] - r - gap}
              textAnchor="middle"
              fill={COLOR}
              fontSize={fontSize}
              fontFamily="inherit"
              fontWeight={500}
              style={{ pointerEvents: "none" }}
            >
              {assignment.vehicleName}
            </text>
          </g>
        );
      })}
    </g>
  );
});
