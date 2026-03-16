import { useEffect, useRef, memo } from "react";
import { line, select } from "d3";
import type { Position } from "@/types";
import { useMapContext } from "../hooks";

interface PolylineProps {
  coordinates: Position[];
  color?: string;
  width?: number;
  opacity?: number;
  onClick?: () => void;
}

export const Polyline = memo<PolylineProps>(function Polyline({
  coordinates,
  color = "#4488ff",
  width = 1,
  opacity,
  onClick,
}) {
  const { projection } = useMapContext();
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!projection || !pathRef.current || coordinates.length < 2) return;

    const points = coordinates
      .map((coord) => projection(coord))
      .filter((p): p is Position => p !== null);

    if (points.length < 2) return;

    const lineGenerator = line()
      .x((d) => d[0])
      .y((d) => d[1]);

    select(pathRef.current).datum(points).attr("d", lineGenerator);
  }, [coordinates, projection]);

  return (
    <path
      ref={pathRef}
      stroke={color}
      strokeWidth={width}
      strokeOpacity={opacity ?? 1}
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    />
  );
});
