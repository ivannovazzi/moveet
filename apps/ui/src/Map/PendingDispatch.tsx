import { memo } from "react";
import type { Vehicle, DispatchAssignment, Position } from "@/types";
import { useMapContext } from "@/components/Map/hooks";

interface PendingDispatchProps {
  assignments: DispatchAssignment[];
  vehicles: Vehicle[];
}

const MARKER_COLOR = "#f93";
const LINE_COLOR = "rgba(255, 153, 51, 0.5)";
const LABEL_COLOR = "#f93";
const CROSSHAIR_SIZE = 6;

export default memo(function PendingDispatch({ assignments, vehicles }: PendingDispatchProps) {
  const { projection } = useMapContext();

  if (!projection || assignments.length === 0) return null;

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  return (
    <g className="pending-dispatch">
      {assignments.map((assignment) => {
        const vehicle = vehicleMap.get(assignment.vehicleId);
        if (!vehicle) return null;

        // Vehicle position is [lat, lng] in the Vehicle type, projection expects [lng, lat]
        const vehiclePos = projection([vehicle.position[1], vehicle.position[0]]) as
          | Position
          | undefined;
        // Destination is [lat, lng], projection expects [lng, lat]
        const destPos = projection([
          assignment.destination[1],
          assignment.destination[0],
        ]) as Position | undefined;

        if (!vehiclePos || !destPos) return null;
        if (!isFinite(vehiclePos[0]) || !isFinite(vehiclePos[1])) return null;
        if (!isFinite(destPos[0]) || !isFinite(destPos[1])) return null;

        return (
          <g key={assignment.vehicleId}>
            {/* Dashed line from vehicle to destination */}
            <line
              x1={vehiclePos[0]}
              y1={vehiclePos[1]}
              x2={destPos[0]}
              y2={destPos[1]}
              stroke={LINE_COLOR}
              strokeWidth={1}
              strokeDasharray="4 3"
              fill="none"
            />

            {/* Destination crosshair */}
            <line
              x1={destPos[0] - CROSSHAIR_SIZE}
              y1={destPos[1]}
              x2={destPos[0] + CROSSHAIR_SIZE}
              y2={destPos[1]}
              stroke={MARKER_COLOR}
              strokeWidth={1.5}
            />
            <line
              x1={destPos[0]}
              y1={destPos[1] - CROSSHAIR_SIZE}
              x2={destPos[0]}
              y2={destPos[1] + CROSSHAIR_SIZE}
              stroke={MARKER_COLOR}
              strokeWidth={1.5}
            />

            {/* Destination circle */}
            <circle
              cx={destPos[0]}
              cy={destPos[1]}
              r={CROSSHAIR_SIZE}
              fill="none"
              stroke={MARKER_COLOR}
              strokeWidth={1}
              opacity={0.7}
            />

            {/* Vehicle name label at destination */}
            <text
              x={destPos[0]}
              y={destPos[1] - CROSSHAIR_SIZE - 4}
              textAnchor="middle"
              fill={LABEL_COLOR}
              fontSize={8}
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
