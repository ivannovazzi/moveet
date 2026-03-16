import { useEffect, useRef, useMemo } from "react";
import { select, geoPath } from "d3";
import { useClock } from "@/hooks/useClock";
import { useNetwork } from "@/hooks/useNetwork";
import { useMapContext } from "@/components/Map/hooks";
import type { TimeOfDay } from "@/types";

const TIME_COLORS: Record<TimeOfDay, string> = {
  morning_rush: "#fb923c",
  midday: "#4ade80",
  evening_rush: "#ef4444",
  night: "#818cf8",
};

const ROAD_TIERS: Record<string, { width: number; opacityScale: number }> = {
  motorway: { width: 3.5, opacityScale: 1.0 },
  trunk: { width: 3.0, opacityScale: 0.95 },
  primary: { width: 2.5, opacityScale: 0.85 },
  secondary: { width: 1.8, opacityScale: 0.6 },
  tertiary: { width: 1.2, opacityScale: 0.35 },
};

const TIME_OPACITY: Record<TimeOfDay, number> = {
  morning_rush: 0.65,
  midday: 0.35,
  evening_rush: 0.8,
  night: 0.45,
};

const HIGHWAY_TYPES = new Set(Object.keys(ROAD_TIERS));

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const { clock } = useClock();
  const network = useNetwork();
  const { projection } = useMapContext();
  const gRef = useRef<SVGGElement>(null);

  const roads = useMemo(
    () => network.features.filter((f) => HIGHWAY_TYPES.has(f.properties.highway ?? "")),
    [network]
  );

  // Build paths once when roads/projection change
  useEffect(() => {
    if (!gRef.current || !projection || roads.length === 0) return;
    const pathGen = geoPath().projection(projection);
    const g = select(gRef.current);

    g.selectAll("path")
      .data(roads)
      .join("path")
      .attr("d", (d) => pathGen(d as Parameters<typeof pathGen>[0]) ?? "")
      .attr("fill", "none")
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("stroke-width", (d) => (ROAD_TIERS[d.properties.highway ?? ""] ?? ROAD_TIERS.tertiary).width);
  }, [roads, projection]);

  // Update colour/opacity cheaply on every timeOfDay change
  useEffect(() => {
    if (!gRef.current) return;
    const color = TIME_COLORS[clock.timeOfDay];
    const baseOpacity = TIME_OPACITY[clock.timeOfDay];

    select(gRef.current)
      .selectAll<SVGPathElement, (typeof roads)[number]>("path")
      .attr("stroke", color)
      .attr("stroke-opacity", (d) => baseOpacity * (ROAD_TIERS[d.properties.highway ?? ""] ?? ROAD_TIERS.tertiary).opacityScale);
  }, [clock.timeOfDay]);

  if (!visible) return null;

  return <g ref={gRef} />;
}
