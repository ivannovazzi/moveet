import { useEffect, useRef } from "react";
import { select, line as d3line } from "d3";
import { useTraffic } from "@/hooks/useTraffic";
import { useMapContext } from "@/components/Map/hooks";
import type { TrafficEdge } from "@/types";

const HIGHWAY_WIDTH: Record<string, number> = {
  motorway: 4,
  trunk: 3.5,
  primary: 3,
  secondary: 2,
  tertiary: 1.5,
};

function congestionColor(factor: number): string {
  if (factor >= 0.8) return "#22c55e";
  if (factor >= 0.6) return "#eab308";
  if (factor >= 0.4) return "#f97316";
  return "#ef4444";
}

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const edges = useTraffic();
  const { projection } = useMapContext();
  const gRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!gRef.current || !projection) return;
    const g = select(gRef.current);

    const lineGen = d3line<[number, number]>()
      .x((d) => d[0])
      .y((d) => d[1]);

    g.selectAll<SVGPathElement, TrafficEdge>("path")
      .data(edges, (d) => d.edgeId)
      .join("path")
      .attr("d", (d) => {
        const pts = d.coordinates
          .map((c) => projection(c))
          .filter(
            (p): p is [number, number] =>
              p != null && isFinite(p[0]) && isFinite(p[1])
          );
        return pts.length >= 2 ? lineGen(pts) : null;
      })
      .attr("fill", "none")
      .attr("stroke", (d) => congestionColor(d.congestion))
      .attr("stroke-width", (d) => HIGHWAY_WIDTH[d.highway] ?? 1)
      .attr("stroke-opacity", 0.8)
      .attr("stroke-linecap", "round");
  }, [edges, projection]);

  if (!visible) return null;
  return <g ref={gRef} />;
}
