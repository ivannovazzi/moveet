import { useEffect, useRef, memo } from "react";
import { mean } from "d3";
import { useMapContext } from "../hooks";
import type { Position } from "@/types";

interface LabelProps {
  label: string;
  color?: string;
  width?: number;
  coordinates: Position | Position[];
  onClick?: () => void;
}

const Label = memo<LabelProps>(function Label({ label, color = "#4488ff", coordinates, onClick }) {
  const { projection, transform } = useMapContext();
  const textRef = useRef<SVGTextElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const k = transform?.k ?? 1;

  useEffect(() => {
    if (!projection || !textRef.current || !label || !coordinates) return;

    let center: Position;
    if (Array.isArray(coordinates[0])) {
      const pts = coordinates as Position[];
      const lngAvg = mean(pts, (d) => d[0]) ?? 0;
      const latAvg = mean(pts, (d) => d[1]) ?? 0;
      center = [lngAvg, latAvg];
    } else {
      center = coordinates as Position;
    }

    const projected = projection(center);
    if (projected) {
      textRef.current.setAttribute("x", projected[0].toString());
      textRef.current.setAttribute("y", projected[1].toString());
    }

    const box = textRef.current.getBBox();
    if (rectRef.current) {
      const pad = 3 / k;
      rectRef.current.setAttribute("x", (box.x - pad).toString());
      rectRef.current.setAttribute("y", (box.y - pad).toString());
      rectRef.current.setAttribute("width", (box.width + pad * 2).toString());
      rectRef.current.setAttribute("height", (box.height + pad * 2).toString());
    }
  }, [coordinates, projection, label, k]);

  return (
    <g ref={gRef} style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      <rect ref={rectRef} fill="rgba(0,0,0,0.75)" rx={3 / k} />
      <text ref={textRef} fill={color} fontSize={12 / k}>
        {label}
      </text>
    </g>
  );
});

export default Label;
