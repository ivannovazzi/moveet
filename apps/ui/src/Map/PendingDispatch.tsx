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
        if (!vehicle) return null;

        // Destination is [lat, lng], projection expects [lng, lat]
        const destPos = projection([
          assignment.destination[1],
          assignment.destination[0],
        ]) as Position | undefined;

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
            <circle
              cx={destPos[0]}
              cy={destPos[1]}
              r={r * 0.3}
              fill={COLOR_SOLID}
            />

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
