import { useEffect, useRef, useMemo } from "react";
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

// Google Maps–style: green → yellow → orange → red
function congestionColor(factor: number): string {
  if (factor >= 0.85) return "#22c55e"; // green — free flow
  if (factor >= 0.7) return "#84cc16"; // lime — light traffic
  if (factor >= 0.55) return "#eab308"; // yellow — moderate
  if (factor >= 0.4) return "#f97316"; // orange — heavy
  return "#ef4444"; // red — jammed
}

// Aggregate congestion per streetId (worst = lowest factor wins)
function buildStreetCongestion(edges: TrafficEdge[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const edge of edges) {
    const existing = map.get(edge.streetId);
    if (existing === undefined || edge.congestion < existing) {
      map.set(edge.streetId, edge.congestion);
    }
  }
  return map;
}

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const { edges: trafficEdges } = useTraffic();
  const { network } = useNetwork();
  const { projection } = useMapContext();
  const gRef = useRef<SVGGElement>(null);

  const streetCongestion = useMemo(() => buildStreetCongestion(trafficEdges), [trafficEdges]);

  useEffect(() => {
    if (!gRef.current || !projection || network.features.length === 0) return;
    const pathGen = geoPath().projection(projection);
    const g = select(gRef.current);

    // Only render features that have traffic data (matched by streetId)
    const roadsWithTraffic = network.features.filter((f) => {
      const sid = f.properties.streetId ?? f.properties["@id"];
      return sid != null && streetCongestion.has(sid);
    });

    g.selectAll("path")
      .data(roadsWithTraffic, (_d, i) => i)
      .join("path")
      .attr("d", (d) => pathGen(d as Parameters<typeof pathGen>[0]) ?? "")
      .attr("fill", "none")
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("stroke-width", (d) => HIGHWAY_WIDTH[d.properties.highway ?? ""] ?? 1.5)
      .attr("stroke", (d) => {
        const sid = d.properties.streetId ?? d.properties["@id"];
        const c = streetCongestion.get(sid!)!;
        return congestionColor(c);
      })
      .attr("stroke-opacity", 0.85);
  }, [network, projection, streetCongestion]);

  if (!visible) return null;
  return <g ref={gRef} />;
}
