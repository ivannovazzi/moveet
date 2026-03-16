import { useEffect, useRef, useMemo, useCallback } from "react";
import { select, geoPath } from "d3";
import { useTraffic } from "@/hooks/useTraffic";
import { useNetwork } from "@/hooks/useNetwork";
import { useMapContext } from "@/components/Map/hooks";
import type { TrafficEdge } from "@/types";

const HIGHWAY_WIDTH: Record<string, number> = {
  motorway: 4,
  trunk: 3.5,
  primary: 3,
  secondary: 2,
  tertiary: 1.5,
};

const HIGHWAY_TYPES = new Set(Object.keys(HIGHWAY_WIDTH));

// Google Maps–style: green → yellow → orange → red
function congestionColor(factor: number): string {
  if (factor >= 0.85) return "#22c55e"; // green — free flow
  if (factor >= 0.7) return "#84cc16"; // lime — light traffic
  if (factor >= 0.55) return "#eab308"; // yellow — moderate
  if (factor >= 0.4) return "#f97316"; // orange — heavy
  return "#ef4444"; // red — jammed
}

// Build a spatial index: "lon,lat" → worst congestion factor
function buildCongestionIndex(edges: TrafficEdge[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const edge of edges) {
    for (const [lon, lat] of edge.coordinates) {
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
      const existing = index.get(key);
      if (existing === undefined || edge.congestion < existing) {
        index.set(key, edge.congestion);
      }
    }
  }
  return index;
}

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const trafficEdges = useTraffic();
  const network = useNetwork();
  const { projection } = useMapContext();
  const gRef = useRef<SVGGElement>(null);

  const roads = useMemo(
    () => network.features.filter((f) => HIGHWAY_TYPES.has(f.properties.highway ?? "")),
    [network]
  );

  const congestionIndex = useMemo(() => buildCongestionIndex(trafficEdges), [trafficEdges]);

  // Returns congestion or null if no traffic data touches this road
  const getRoadCongestion = useCallback(
    (coordinates: [number, number][]): number | null => {
      let worst: number | null = null;
      for (const [lon, lat] of coordinates) {
        const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
        const val = congestionIndex.get(key);
        if (val !== undefined) {
          if (worst === null || val < worst) worst = val;
        }
      }
      return worst;
    },
    [congestionIndex]
  );

  useEffect(() => {
    if (!gRef.current || !projection || roads.length === 0) return;
    const pathGen = geoPath().projection(projection);
    const g = select(gRef.current);

    // Only render roads that have traffic data
    const roadsWithTraffic = roads.filter(
      (d) => getRoadCongestion(d.geometry.coordinates) !== null
    );

    g.selectAll("path")
      .data(roadsWithTraffic, (_d, i) => i)
      .join("path")
      .attr("d", (d) => pathGen(d as Parameters<typeof pathGen>[0]) ?? "")
      .attr("fill", "none")
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("stroke-width", (d) => HIGHWAY_WIDTH[d.properties.highway ?? ""] ?? 1)
      .attr("stroke", (d) => {
        const c = getRoadCongestion(d.geometry.coordinates)!;
        return congestionColor(c);
      })
      .attr("stroke-opacity", 0.85);
  }, [roads, projection, getRoadCongestion]);

  if (!visible) return null;
  return <g ref={gRef} />;
}
