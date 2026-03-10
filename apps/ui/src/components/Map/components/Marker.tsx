import React, { useMemo, useEffect, useState } from "react";
import type { Position } from "@/types";
import { useMapContext } from "../hooks";

interface MarkerProps {
  position: Position;
  children?: React.ReactNode;
  offset?: Position;
  animation?: number;
  className?: string;
  onClick?: (e: React.MouseEvent<SVGGElement>) => void;
  onMouseEnter?: (e: React.MouseEvent<SVGGElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<SVGGElement>) => void;
}

export const Marker: React.FC<MarkerProps> = ({
  position,
  children,
  offset,
  animation = 500,
  className,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => {
  const { projection } = useMapContext();
  const [isPlaced, setIsPlaced] = useState(false);

  const projected = useMemo(() => projection?.(position) ?? null, [position, projection]);

  // Enable transitions only after the first paint at the real position
  useEffect(() => {
    if (projected && !isPlaced) {
      const id = requestAnimationFrame(() => setIsPlaced(true));
      return () => cancelAnimationFrame(id);
    }
  }, [projected, isPlaced]);

  if (!projected) return null;

  const [x, y] = projected;

  const onMarkerClick = (e: React.MouseEvent<SVGGElement>) => {
    if (!onClick) return;
    e.stopPropagation();
    onClick(e);
  };

  return (
    <g
      onClick={onMarkerClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: isPlaced ? `transform ${animation}ms linear` : "none",
        cursor: onClick ? "pointer" : "default",
      }}
      className={className}
    >
      <g transform={`translate(${offset?.[0] ?? 0}, ${offset?.[1] ?? 0})`}>{children}</g>
    </g>
  );
};
