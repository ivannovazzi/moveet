import { useMemo } from "react";
import { useMapContext } from "../hooks";
import type { Position } from "@/types";

function PoligonToPath(coordinates: Position[]) {
  return (
    coordinates
      .map(([x, y], i) => {
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ") + " Z"
  );
}

interface PolygonProps {
  coordinates: Position[];
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export const Polygon: React.FC<PolygonProps> = ({
  coordinates,
  fill = "none",
  fillOpacity = 1,
  stroke = "#000",
  strokeWidth = 1,
  opacity = 1,
}) => {
  const { projection } = useMapContext();

  const projected = useMemo(() => {
    if (!projection) return "";

    const projectedPoints = coordinates
      .map((coord) => projection(coord))
      .filter((point) => point !== null) as Position[];

    if (projectedPoints.length === 0) return "";

    return projectedPoints;
  }, [coordinates, projection]);

  if (!projected) return null;

  return (
    <path
      d={PoligonToPath(projected)}
      fill={fill}
      fillOpacity={fillOpacity}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
};
